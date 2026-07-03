/**
 * v0.14.5 — Lemon Squeezy webhook receiver.
 *
 * POST /webhook/lemonsqueezy
 *
 * Auth: `X-Signature` header containing HMAC-SHA256(rawBody, secret)
 * where `secret` is the value Bae set when creating the webhook in the
 * LS dashboard. Stored as Worker secret LEMONSQUEEZY_WEBHOOK_SECRET.
 *
 * Events handled:
 *   - order_created                — one-time purchase (first-PR pass, future
 *                                    boosters) → grant paid_credit. When the
 *                                    order's variant is a subscription variant
 *                                    (LS_SUBSCRIPTION_VARIANT_CREDITS), it is
 *                                    the subscription's initial order → record
 *                                    only, credits come from
 *                                    subscription_payment_success instead.
 *   - order_refunded               — guarded billing_orders status flip
 *                                    (idempotency lock) + deduct the credits
 *                                    the order granted (balance may go
 *                                    negative) + structured log for manual
 *                                    review.
 *   - subscription_created         — persist state in ls_subscriptions.
 *   - subscription_updated         — persist state (incl. plan/variant change).
 *   - subscription_cancelled       — record status; NO clawback of credits.
 *   - subscription_expired         — record status; NO clawback of credits.
 *   - subscription_payment_success — grant that month's credits into the
 *                                    workspace credit ledger, idempotent on
 *                                    the LS invoice id (source_event_id =
 *                                    `ls_subinv_<invoiceId>`; billing_orders
 *                                    row `subinv_<invoiceId>` is the
 *                                    race-proof dedup lock).
 *
 * Everything else is accepted-but-ignored (ack 200 so LS doesn't retry
 * forever).
 *
 * Idempotency: provider_order_id is UNIQUE on billing_orders. If LS
 * re-sends the same event (network blip, retry), the second INSERT
 * collides → we 200 with `duplicate: true`. Subscription payments extend
 * the same mechanism with the `subinv_` prefix (LS invoice ids and order
 * ids are separate sequences, so the prefix keeps the namespaces apart).
 * Refunds use a guarded UPDATE (status != 'refunded') as their lock.
 *
 * Pending-link: when the order's email doesn't match any saas_user,
 * we still record the order with status='paid_unlinked' + pending_email
 * populated. db/saas.ts:upsertUser claims pending orders by email
 * the next time that email signs up via CLI or GH App install.
 *
 * Subscription credit target: workspace credit ledger, keyed by the
 * `user_key` passed through checkout custom_data (meta.custom_data.user_key).
 * Without a user_key we persist subscription state + the invoice order row
 * and log for manual review — never guess an account.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  parseWebhookEvent,
  verifyWebhookSignature,
  type WebhookOrderAttrs,
} from "../lemonsqueezy.js";
import {
  claimPendingBillingForUser,
  createBillingOrderPaid,
  findBillingOrderByProvider,
  findUserByEmail,
  grantPaidCredits,
} from "../db/saas.js";
import {
  deductSaasPaidCredits,
  getBillingOrderForRefund,
  getLsSubscriptionByProviderId,
  grantSubscriptionCreditsIdempotent,
  markBillingOrderRefunded,
  parseSubscriptionVariantCredits,
  upsertLsSubscription,
} from "../workspace/ls-subscriptions.js";

// Map product label (from LS custom_data or first_order_item.variant_name)
// → credits granted. First-PR pass = 1 review. Booster = 5 (planned).
const CREDITS_FOR: Record<string, number> = {
  "first-pr-pass": 1,
  "booster-5": 5,
};

// LS subscription attributes — the subset we read. Defensive: every field
// optional, values re-checked at use sites.
interface WebhookSubscriptionAttrs {
  store_id?: number;
  customer_id?: number;
  order_id?: number;
  product_id?: number;
  variant_id?: number;
  user_email?: string;
  status?: string;
  renews_at?: string | null;
  ends_at?: string | null;
}

// LS subscription-invoice attributes (subscription_payment_success).
interface WebhookSubscriptionInvoiceAttrs {
  subscription_id?: number;
  customer_id?: number;
  user_email?: string;
  billing_reason?: string;
  status?: string;
  total?: number;
  currency?: string;
}

const SUBSCRIPTION_STATE_EVENTS = new Set([
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "subscription_expired",
]);

function customDataUserKey(custom: Record<string, string> | undefined): string | null {
  if (!custom) return null;
  if (typeof custom["user_key"] === "string" && custom["user_key"]) return custom["user_key"];
  if (typeof custom["userKey"] === "string" && custom["userKey"]) return custom["userKey"];
  return null;
}

export function createLemonsqueezyWebhookRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post("/webhook/lemonsqueezy", async (c) => {
    if (!c.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
      return c.json({ error: "webhook_disabled" }, 503);
    }
    const sig = c.req.header("x-signature") ?? c.req.header("X-Signature") ?? null;
    const rawBody = await c.req.text();
    const ok = await verifyWebhookSignature(rawBody, sig, c.env.LEMONSQUEEZY_WEBHOOK_SECRET);
    if (!ok) {
      return c.json({ error: "signature_mismatch" }, 401);
    }

    let event;
    try {
      event = parseWebhookEvent(JSON.parse(rawBody));
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!event) return c.json({ error: "invalid_event_shape" }, 400);

    const eventName = event.meta.event_name;

    // ── order_created ────────────────────────────────────────────────────
    if (eventName === "order_created") {
      const orderId = event.data.id;

      // Idempotency check — short-circuit if we already processed.
      const existing = await findBillingOrderByProvider(c.env, "lemonsqueezy", orderId);
      if (existing) {
        return c.json({ ok: true, duplicate: true, order_id: orderId });
      }

      const attrs = event.data.attributes as WebhookOrderAttrs;
      if (attrs.status !== "paid") {
        // LS sometimes emits order_created for failed/pending orders.
        // Only credit on `paid`.
        return c.json({ ok: true, skipped: `status=${attrs.status}` });
      }

      const email = (attrs.user_email ?? "").toLowerCase().trim();
      const linkedUser = email ? await findUserByEmail(c.env, email) : null;
      const now = new Date().toISOString();
      const id = `bo_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const variantId = attrs.first_order_item?.variant_id !== undefined
        ? String(attrs.first_order_item.variant_id)
        : null;

      // Subscription initial order — LS emits order_created for the first
      // subscription payment too. Record the order (dedup anchor) but grant
      // NOTHING here: subscription_payment_success grants the month's
      // credits. Without this guard a new subscription would also pocket a
      // spurious one-time "first-pr-pass" credit.
      const variantCredits = parseSubscriptionVariantCredits(c.env.LS_SUBSCRIPTION_VARIANT_CREDITS);
      if (variantId && variantCredits[variantId] !== undefined) {
        await createBillingOrderPaid(c.env, {
          id,
          userId: linkedUser?.id ?? null,
          provider: "lemonsqueezy",
          providerOrderId: orderId,
          productVariantId: variantId,
          productLabel: "ls-subscription-order",
          amountCents: typeof attrs.total === "number" ? attrs.total : 0,
          currency: attrs.currency ?? "USD",
          status: "paid",
          creditsGranted: 0,
          customerEmail: email || null,
          pendingEmail: null,
          createdAt: now,
          paidAt: now,
          rawPayload: rawBody,
        });
        return c.json({
          ok: true,
          order_id: orderId,
          credits_granted: 0,
          subscription_order: true,
          linked: Boolean(linkedUser),
        });
      }

      // Determine product label from custom_data, fallback to variant id.
      const customLabel = event.meta.custom_data?.product_label;
      const productLabel = customLabel && CREDITS_FOR[customLabel]
        ? customLabel
        : "first-pr-pass"; // safe default for MVP
      const credits = CREDITS_FOR[productLabel] ?? 0;

      await createBillingOrderPaid(c.env, {
        id,
        userId: linkedUser?.id ?? null,
        provider: "lemonsqueezy",
        providerOrderId: orderId,
        productVariantId: variantId,
        productLabel,
        amountCents: typeof attrs.total === "number" ? attrs.total : 0,
        currency: attrs.currency ?? "USD",
        status: linkedUser ? "paid" : "paid_unlinked",
        creditsGranted: credits,
        customerEmail: email || null,
        pendingEmail: linkedUser ? null : (email || null),
        createdAt: now,
        paidAt: now,
        rawPayload: rawBody,
      });

      if (linkedUser) {
        await grantPaidCredits(c.env, linkedUser.id, credits);
      }
      // else: pending. upsertUser will claim it on next sign-in matching email.

      return c.json({
        ok: true,
        order_id: orderId,
        credits_granted: credits,
        linked: Boolean(linkedUser),
      });
    }

    // ── order_refunded ───────────────────────────────────────────────────
    if (eventName === "order_refunded") {
      const orderId = event.data.id;
      const order = await getBillingOrderForRefund(c.env, "lemonsqueezy", orderId);
      if (!order) {
        console.warn(JSON.stringify({
          evt: "ls_order_refunded_unknown_order",
          order_id: orderId,
          note: "no billing_orders row — manual review",
        }));
        return c.json({ ok: true, skipped: "refund_unknown_order", order_id: orderId });
      }

      // Guarded flip is the idempotency lock: only the first delivery wins.
      const won = await markBillingOrderRefunded(c.env, "lemonsqueezy", orderId);
      if (!won) {
        return c.json({ ok: true, duplicate: true, refunded: true, order_id: orderId });
      }

      // Deduct exactly what the order granted. Grants from order_created go
      // to saas_users.paid_credits, so the reversal targets the same balance.
      // No floor — negative is honest when the credit was already spent.
      // paid_unlinked orders never granted (and can no longer be claimed once
      // status='refunded'), so there is nothing to deduct for them.
      let creditsDeducted = 0;
      if (order.userId && order.creditsGranted > 0) {
        await deductSaasPaidCredits(c.env, order.userId, order.creditsGranted);
        creditsDeducted = order.creditsGranted;
      }

      console.warn(JSON.stringify({
        evt: "ls_order_refunded",
        order_id: orderId,
        billing_order_id: order.id,
        product_label: order.productLabel,
        user_id: order.userId,
        credits_deducted: creditsDeducted,
        previously_unlinked: !order.userId,
        note: "manual review: verify refund + resulting balance",
      }));

      return c.json({
        ok: true,
        order_id: orderId,
        refunded: true,
        credits_deducted: creditsDeducted,
      });
    }

    // ── subscription_created / updated / cancelled / expired ─────────────
    if (SUBSCRIPTION_STATE_EVENTS.has(eventName)) {
      const subscriptionId = event.data.id;
      const attrs = event.data.attributes as WebhookSubscriptionAttrs;
      const variantId = attrs.variant_id !== undefined ? String(attrs.variant_id) : null;
      const variantCredits = parseSubscriptionVariantCredits(c.env.LS_SUBSCRIPTION_VARIANT_CREDITS);
      const monthlyCredits = variantId !== null ? (variantCredits[variantId] ?? 0) : 0;

      if (variantId !== null && variantCredits[variantId] === undefined) {
        console.warn(JSON.stringify({
          evt: "ls_unknown_subscription_variant",
          event_name: eventName,
          subscription_id: subscriptionId,
          variant_id: variantId,
          note: "variant not in LS_SUBSCRIPTION_VARIANT_CREDITS — no credits will be granted",
        }));
      }

      const status = typeof attrs.status === "string" && attrs.status
        ? attrs.status
        : eventName === "subscription_cancelled"
          ? "cancelled"
          : eventName === "subscription_expired"
            ? "expired"
            : "active";

      await upsertLsSubscription(c.env, {
        providerSubscriptionId: subscriptionId,
        customerId: typeof attrs.customer_id === "number" ? attrs.customer_id : null,
        productId: attrs.product_id !== undefined ? String(attrs.product_id) : null,
        variantId,
        status,
        userEmail: typeof attrs.user_email === "string" && attrs.user_email
          ? attrs.user_email.toLowerCase().trim()
          : null,
        userKey: customDataUserKey(event.meta.custom_data),
        monthlyCredits,
        renewsAt: typeof attrs.renews_at === "string" ? attrs.renews_at : null,
        endsAt: typeof attrs.ends_at === "string" ? attrs.ends_at : null,
        lastEventName: eventName,
      });

      // cancelled / expired: state recorded above; already-granted credits
      // are deliberately NOT clawed back.
      return c.json({
        ok: true,
        subscription_id: subscriptionId,
        status,
        monthly_credits: monthlyCredits,
      });
    }

    // ── subscription_payment_success ─────────────────────────────────────
    if (eventName === "subscription_payment_success") {
      const invoiceId = event.data.id;
      const providerOrderId = `subinv_${invoiceId}`;
      const attrs = event.data.attributes as WebhookSubscriptionInvoiceAttrs;

      // Dedup short-circuit — same mechanism as order_created.
      const existing = await findBillingOrderByProvider(c.env, "lemonsqueezy", providerOrderId);
      if (existing) {
        return c.json({ ok: true, duplicate: true, invoice_id: invoiceId });
      }

      const subscriptionId = attrs.subscription_id !== undefined
        ? String(attrs.subscription_id)
        : null;
      const sub = subscriptionId
        ? await getLsSubscriptionByProviderId(c.env, subscriptionId)
        : null;
      const variantCredits = parseSubscriptionVariantCredits(c.env.LS_SUBSCRIPTION_VARIANT_CREDITS);
      const variantId = sub?.variantId ?? null;
      const credits = variantId !== null ? (variantCredits[variantId] ?? 0) : 0;
      const userKey = sub?.userKey ?? customDataUserKey(event.meta.custom_data);
      const email = (attrs.user_email ?? sub?.userEmail ?? "").toLowerCase().trim();
      const willGrant = Boolean(userKey) && credits > 0;
      const now = new Date().toISOString();

      // Record the invoice as a billing_orders row FIRST — the UNIQUE
      // (provider, provider_order_id) constraint is the race-proof lock.
      // A collision here means a concurrent/duplicate delivery already owns
      // this invoice → ack duplicate, grant nothing.
      try {
        await createBillingOrderPaid(c.env, {
          id: `bo_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          userId: null,
          provider: "lemonsqueezy",
          providerOrderId,
          productVariantId: variantId,
          productLabel: "ls-subscription-payment",
          amountCents: typeof attrs.total === "number" ? attrs.total : 0,
          currency: attrs.currency ?? "USD",
          status: "paid",
          creditsGranted: willGrant ? credits : 0,
          customerEmail: email || null,
          pendingEmail: null,
          createdAt: now,
          paidAt: now,
          rawPayload: rawBody,
        });
      } catch {
        return c.json({ ok: true, duplicate: true, invoice_id: invoiceId });
      }

      if (!willGrant) {
        console.warn(JSON.stringify({
          evt: "ls_subscription_payment_no_grant",
          invoice_id: invoiceId,
          subscription_id: subscriptionId,
          variant_id: variantId,
          has_user_key: Boolean(userKey),
          reason: !userKey ? "no_user_key" : "unknown_variant",
          note: "manual review: payment recorded, no credits granted",
        }));
        return c.json({
          ok: true,
          invoice_id: invoiceId,
          subscription_id: subscriptionId,
          credits_granted: 0,
          skipped: !userKey ? "no_user_key" : "unknown_variant",
        });
      }

      const grant = await grantSubscriptionCreditsIdempotent(c.env, {
        userKey: userKey as string,
        creditType: "review",
        amount: credits,
        reason: `ls-subscription-payment:${subscriptionId ?? "unknown"}`,
        sourceEventId: `ls_subinv_${invoiceId}`,
        metadata: {
          provider: "lemonsqueezy",
          invoiceId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...(variantId ? { variantId } : {}),
        },
      });

      return c.json({
        ok: true,
        invoice_id: invoiceId,
        subscription_id: subscriptionId,
        credits_granted: credits,
        duplicate_grant: grant.duplicate,
      });
    }

    // Anything else (subscription_payment_failed, subscription_paused, ...)
    // — ack but don't process.
    return c.json({ ok: true, skipped: `event=${eventName}` });
  });

  return app;
}

/**
 * Helper used by saas-auth's upsertUser. Exported here so the route
 * file stays the single source of truth on credit-grant semantics.
 *
 * Idempotent: only claims orders whose status is 'paid_unlinked' AND
 * pending_email matches AND user_id is null.
 */
export async function claimPendingOrdersForEmail(
  env: Env,
  email: string,
  userId: string,
): Promise<{ claimed: number; creditsGranted: number }> {
  return claimPendingBillingForUser(env, email, userId);
}
