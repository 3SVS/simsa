/**
 * workspace/ls-subscriptions.ts
 *
 * Lemon Squeezy subscription support for the webhook receiver
 * (src/routes/lemonsqueezy-webhook.ts):
 *
 *   1. Variant → monthly-credit mapping from env var
 *      LS_SUBSCRIPTION_VARIANT_CREDITS (JSON, parsed fail-safe).
 *   2. Subscription state persistence (ls_subscriptions, migration 0053).
 *   3. Idempotent monthly credit grants into the workspace credit ledger —
 *      mirrors grantCredits() in ./credits.ts but records a source_event_id
 *      derived from the LS invoice id so re-delivered webhooks never
 *      double-grant. (credits.ts itself is intentionally untouched.)
 *   4. Refund helpers — guarded billing_orders status flip (the idempotency
 *      lock) + saas_users.paid_credits deduction that may go negative.
 *
 * Idempotency layers for subscription_payment_success:
 *   - Primary (race-proof): billing_orders UNIQUE(provider, provider_order_id)
 *     with provider_order_id = `subinv_<invoiceId>` — the same dedup contract
 *     order_created already relies on. The INSERT is attempted BEFORE the
 *     grant; a collision means another delivery already owns this invoice.
 *   - Secondary (audit + belt-and-suspenders): the ledger grant checks for an
 *     existing (user_key, source_event_id, direction='grant') row first. Note
 *     the Stage 26 unique index only covers direction='debit', so this check
 *     is best-effort — the billing_orders insert above is the real lock.
 */
import type { Env } from "../env.js";
import type { CreditType } from "./credits.js";

// ─── Variant → monthly credits mapping ───────────────────────────────────────

/**
 * Parse LS_SUBSCRIPTION_VARIANT_CREDITS fail-safe.
 *
 * Expected shape: {"123456":30,"789012":100} — keys are LS variant ids
 * (stringified numbers), values positive integer monthly credit amounts.
 *
 * Any malformed input (invalid JSON, non-object, array) → {} (no grants,
 * caller logs). Individual entries with non-positive / non-integer values
 * are dropped; numeric strings ("30") are accepted.
 */
export function parseSubscriptionVariantCredits(
  raw: string | undefined | null,
): Record<string, number> {
  if (!raw || typeof raw !== "string") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      JSON.stringify({ evt: "ls_variant_credits_malformed", reason: "invalid_json" }),
    );
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(
      JSON.stringify({ evt: "ls_variant_credits_malformed", reason: "not_an_object" }),
    );
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) out[String(k)] = n;
  }
  return out;
}

// ─── Subscription state persistence (ls_subscriptions) ──────────────────────

export interface LsSubscriptionUpsert {
  providerSubscriptionId: string;
  customerId: number | null;
  productId: string | null;
  variantId: string | null;
  status: string;
  userEmail: string | null;
  userKey: string | null;
  monthlyCredits: number;
  renewsAt: string | null;
  endsAt: string | null;
  lastEventName: string;
}

function randId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Upsert the latest known state for an LS subscription. One row per
 * provider_subscription_id; COALESCE keeps previously-learned fields
 * (user_key, email, variant) when a later event omits them.
 */
export async function upsertLsSubscription(
  env: Env,
  s: LsSubscriptionUpsert,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO ls_subscriptions
       (id, provider, provider_subscription_id, customer_id, product_id, variant_id,
        status, user_email, user_key, monthly_credits, renews_at, ends_at,
        last_event_name, created_at, updated_at)
     VALUES (?, 'lemonsqueezy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider_subscription_id) DO UPDATE SET
       customer_id     = COALESCE(excluded.customer_id, customer_id),
       product_id      = COALESCE(excluded.product_id, product_id),
       variant_id      = COALESCE(excluded.variant_id, variant_id),
       status          = excluded.status,
       user_email      = COALESCE(excluded.user_email, user_email),
       user_key        = COALESCE(excluded.user_key, user_key),
       monthly_credits = excluded.monthly_credits,
       renews_at       = COALESCE(excluded.renews_at, renews_at),
       ends_at         = COALESCE(excluded.ends_at, ends_at),
       last_event_name = excluded.last_event_name,
       updated_at      = excluded.updated_at`,
  )
    .bind(
      randId("lssub"),
      s.providerSubscriptionId,
      s.customerId,
      s.productId,
      s.variantId,
      s.status,
      s.userEmail,
      s.userKey,
      s.monthlyCredits,
      s.renewsAt,
      s.endsAt,
      s.lastEventName,
      now,
      now,
    )
    .run();
}

export interface LsSubscriptionRow {
  providerSubscriptionId: string;
  variantId: string | null;
  status: string;
  userEmail: string | null;
  userKey: string | null;
  monthlyCredits: number;
}

export async function getLsSubscriptionByProviderId(
  env: Env,
  providerSubscriptionId: string,
): Promise<LsSubscriptionRow | null> {
  const r = await env.DB.prepare(
    `SELECT provider_subscription_id, variant_id, status, user_email, user_key, monthly_credits
       FROM ls_subscriptions
      WHERE provider_subscription_id = ? LIMIT 1`,
  )
    .bind(providerSubscriptionId)
    .first<{
      provider_subscription_id: string;
      variant_id: string | null;
      status: string;
      user_email: string | null;
      user_key: string | null;
      monthly_credits: number;
    }>();
  if (!r) return null;
  return {
    providerSubscriptionId: r.provider_subscription_id,
    variantId: r.variant_id,
    status: r.status,
    userEmail: r.user_email,
    userKey: r.user_key,
    monthlyCredits: r.monthly_credits ?? 0,
  };
}

// ─── Idempotent subscription credit grant (workspace ledger) ────────────────

export interface SubscriptionGrantInput {
  userKey: string;
  creditType: CreditType;
  amount: number;
  reason: string;
  /** e.g. `ls_subinv_<invoiceId>` — derived from the LS event/invoice id. */
  sourceEventId: string;
  metadata?: Record<string, unknown>;
}

export type SubscriptionGrantResult = {
  ok: true;
  duplicate: boolean;
  newBalance: number;
  ledgerEntryId: string;
};

/**
 * Grant subscription credits into the workspace credit ledger, idempotent
 * on (user_key, source_event_id). Mirrors credits.ts grantCredits() —
 * balance UPSERT + 'grant' ledger row — but records source_event_id so the
 * grant is traceable to (and deduplicated by) the LS invoice.
 */
export async function grantSubscriptionCreditsIdempotent(
  env: Env,
  input: SubscriptionGrantInput,
): Promise<SubscriptionGrantResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive integer");
  }
  if (!input.sourceEventId) {
    throw new Error("sourceEventId is required");
  }

  // Ledger-level dedup (best-effort — the billing_orders UNIQUE insert in the
  // webhook route is the race-proof lock; see file header).
  const existing = await env.DB.prepare(
    `SELECT id FROM workspace_credit_ledger
      WHERE user_key = ? AND source_event_id = ? AND direction = 'grant' LIMIT 1`,
  )
    .bind(input.userKey, input.sourceEventId)
    .first<{ id: string }>();

  if (existing) {
    const bal = await env.DB.prepare(
      `SELECT balance FROM workspace_credit_balances WHERE user_key = ? AND credit_type = ?`,
    )
      .bind(input.userKey, input.creditType)
      .first<{ balance: number }>();
    return {
      ok: true,
      duplicate: true,
      newBalance: bal?.balance ?? 0,
      ledgerEntryId: existing.id,
    };
  }

  const now = new Date().toISOString();
  const ledgerId = randId("wcl");
  const balanceId = randId("wcb");

  // Ledger row first (audit anchor with source_event_id), then balance UPSERT.
  await env.DB.prepare(
    `INSERT INTO workspace_credit_ledger
       (id, user_key, project_id, credit_type, amount, direction, reason,
        source_event_id, metadata_json, status, created_at)
     VALUES (?, ?, NULL, ?, ?, 'grant', ?, ?, ?, 'applied', ?)`,
  )
    .bind(
      ledgerId,
      input.userKey,
      input.creditType,
      input.amount,
      input.reason,
      input.sourceEventId,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO workspace_credit_balances (id, user_key, credit_type, balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_key, credit_type) DO UPDATE SET
       balance = balance + excluded.balance,
       updated_at = excluded.updated_at`,
  )
    .bind(balanceId, input.userKey, input.creditType, input.amount, now, now)
    .run();

  const bal = await env.DB.prepare(
    `SELECT balance FROM workspace_credit_balances WHERE user_key = ? AND credit_type = ?`,
  )
    .bind(input.userKey, input.creditType)
    .first<{ balance: number }>();

  return {
    ok: true,
    duplicate: false,
    newBalance: bal?.balance ?? input.amount,
    ledgerEntryId: ledgerId,
  };
}

// ─── Refund helpers ──────────────────────────────────────────────────────────

export interface RefundableOrder {
  id: string;
  userId: string | null;
  creditsGranted: number;
  status: string;
  productLabel: string;
}

export async function getBillingOrderForRefund(
  env: Env,
  provider: string,
  providerOrderId: string,
): Promise<RefundableOrder | null> {
  const r = await env.DB.prepare(
    `SELECT id, user_id, credits_granted, status, product_label
       FROM billing_orders
      WHERE provider = ? AND provider_order_id = ? LIMIT 1`,
  )
    .bind(provider, providerOrderId)
    .first<{
      id: string;
      user_id: string | null;
      credits_granted: number;
      status: string;
      product_label: string;
    }>();
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    creditsGranted: r.credits_granted ?? 0,
    status: r.status,
    productLabel: r.product_label,
  };
}

/**
 * Guarded status flip — the refund idempotency lock. Only one delivery of
 * order_refunded can win the UPDATE (D1 is single-writer per database);
 * every later delivery sees status='refunded' and gets changes=0.
 * Returns true when THIS call performed the flip.
 */
export async function markBillingOrderRefunded(
  env: Env,
  provider: string,
  providerOrderId: string,
): Promise<boolean> {
  const result = (await env.DB.prepare(
    `UPDATE billing_orders
        SET status = 'refunded', refunded_at = ?
      WHERE provider = ? AND provider_order_id = ? AND status != 'refunded'`,
  )
    .bind(new Date().toISOString(), provider, providerOrderId)
    .run()) as { meta?: { changes?: number } };
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Deduct paid credits from a saas user — the honest reversal of the
 * grantPaidCredits() call that order_created made. Intentionally has no
 * floor: the balance may go negative (user already spent the refunded
 * credit). grantPaidCredits() itself refuses n<=0, hence this dedicated
 * deduction helper.
 */
export async function deductSaasPaidCredits(
  env: Env,
  userId: string,
  n: number,
): Promise<void> {
  if (!Number.isInteger(n) || n <= 0) return;
  await env.DB.prepare(
    `UPDATE saas_users SET paid_credits = paid_credits - ?, last_active_at = ? WHERE id = ?`,
  )
    .bind(n, new Date().toISOString(), userId)
    .run();
}
