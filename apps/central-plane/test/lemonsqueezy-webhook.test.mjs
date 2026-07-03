/**
 * Lemon Squeezy webhook — subscription + refund coverage.
 *
 * Covers (additive to test/lemonsqueezy.test.mjs, whose order_created
 * coverage is untouched):
 *   1. parseSubscriptionVariantCredits — happy path + fail-safe on
 *      malformed / non-object / bad-value input
 *   2. subscription_created / _updated — persists state in ls_subscriptions
 *      (incl. plan change), unknown variant → monthly_credits 0
 *   3. subscription_cancelled / _expired — records status, no clawback
 *   4. subscription_payment_success — grants mapped credits into the
 *      workspace credit ledger exactly once; duplicate delivery → no
 *      double grant; unknown variant / missing user_key / malformed
 *      mapping env → payment recorded, no grant
 *   5. order_created with a subscription variant → records order, does NOT
 *      grant the one-time paid credit
 *   6. order_refunded — deducts exactly the credits the order granted
 *      (saas paid_credits, may go negative), marks the row refunded,
 *      idempotent on redelivery; unknown order → ack + skip
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp } from "../dist/router.js";
import { parseSubscriptionVariantCredits } from "../dist/workspace/ls-subscriptions.js";

// ---- helpers ----------------------------------------------------------

function hmacHex(body, secret) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Mock D1 covering the SQL surface of the webhook route + ls-subscriptions
 * helpers. billing_orders INSERT enforces UNIQUE(provider, provider_order_id)
 * by throwing — like real D1 — because that collision is the race-proof
 * idempotency lock for subscription payments.
 */
function makeMockDb({ users = [], orders = [], subs = [], balances = [], ledger = [] } = {}) {
  const state = {
    users: users.map((u) => ({ ...u })),
    orders: orders.map((o) => ({ ...o })),
    subs: subs.map((s) => ({ ...s })),
    balances: balances.map((b) => ({ ...b })),
    ledger: ledger.map((l) => ({ ...l })),
  };
  return {
    state,
    prepare(sql) {
      let bound = [];
      const handlers = {
        async first() {
          if (/FROM saas_users WHERE LOWER\(email\)/.test(sql)) {
            const email = String(bound[0] ?? "").toLowerCase();
            return state.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
          }
          if (/FROM billing_orders[\s\S]*WHERE provider = \? AND provider_order_id = \?/.test(sql)) {
            return (
              state.orders.find(
                (o) => o.provider === bound[0] && o.provider_order_id === bound[1],
              ) ?? null
            );
          }
          if (/FROM ls_subscriptions[\s\S]*WHERE provider_subscription_id = \?/.test(sql)) {
            return state.subs.find((s) => s.provider_subscription_id === bound[0]) ?? null;
          }
          if (/SELECT balance FROM workspace_credit_balances WHERE user_key = \? AND credit_type = \?/.test(sql)) {
            return (
              state.balances.find((b) => b.user_key === bound[0] && b.credit_type === bound[1]) ??
              null
            );
          }
          if (/SELECT id FROM workspace_credit_ledger[\s\S]*user_key = \? AND source_event_id = \?/.test(sql)) {
            return (
              state.ledger.find(
                (l) =>
                  l.user_key === bound[0] &&
                  l.source_event_id === bound[1] &&
                  l.direction === "grant",
              ) ?? null
            );
          }
          return null;
        },
        async run() {
          if (/INSERT INTO billing_orders/.test(sql)) {
            const [
              id, user_id, provider, provider_order_id, product_variant_id, product_label,
              amount_cents, currency, status, credits_granted, pending_email,
              customer_email, created_at, paid_at, raw_payload,
            ] = bound;
            const dup = state.orders.some(
              (o) => o.provider === provider && o.provider_order_id === provider_order_id,
            );
            if (dup) throw new Error("D1_ERROR: UNIQUE constraint failed: billing_orders.provider, billing_orders.provider_order_id");
            state.orders.push({
              id, user_id, provider, provider_order_id, product_variant_id, product_label,
              amount_cents, currency, status, credits_granted, pending_email,
              customer_email, created_at, paid_at, refunded_at: null, linked_at: null, raw_payload,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (/UPDATE billing_orders[\s\S]*SET status = 'refunded'/.test(sql)) {
            const [, provider, provider_order_id] = bound;
            const order = state.orders.find(
              (o) =>
                o.provider === provider &&
                o.provider_order_id === provider_order_id &&
                o.status !== "refunded",
            );
            if (order) {
              order.status = "refunded";
              order.refunded_at = bound[0];
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (/UPDATE saas_users SET paid_credits = paid_credits \+ \?/.test(sql)) {
            const u = state.users.find((u) => u.id === bound[2]);
            if (u) u.paid_credits = (u.paid_credits ?? 0) + Number(bound[0] ?? 0);
            return { success: true, meta: { changes: u ? 1 : 0 } };
          }
          if (/UPDATE saas_users SET paid_credits = paid_credits - \?/.test(sql)) {
            const u = state.users.find((u) => u.id === bound[2]);
            if (u) u.paid_credits = (u.paid_credits ?? 0) - Number(bound[0] ?? 0);
            return { success: true, meta: { changes: u ? 1 : 0 } };
          }
          if (/INSERT INTO ls_subscriptions/.test(sql)) {
            const [
              id, provider_subscription_id, customer_id, product_id, variant_id,
              status, user_email, user_key, monthly_credits, renews_at, ends_at,
              last_event_name, created_at, updated_at,
            ] = bound;
            const existing = state.subs.find(
              (s) => s.provider_subscription_id === provider_subscription_id,
            );
            if (existing) {
              // COALESCE semantics from the ON CONFLICT clause
              existing.customer_id = customer_id ?? existing.customer_id;
              existing.product_id = product_id ?? existing.product_id;
              existing.variant_id = variant_id ?? existing.variant_id;
              existing.status = status;
              existing.user_email = user_email ?? existing.user_email;
              existing.user_key = user_key ?? existing.user_key;
              existing.monthly_credits = monthly_credits;
              existing.renews_at = renews_at ?? existing.renews_at;
              existing.ends_at = ends_at ?? existing.ends_at;
              existing.last_event_name = last_event_name;
              existing.updated_at = updated_at;
            } else {
              state.subs.push({
                id, provider: "lemonsqueezy", provider_subscription_id, customer_id,
                product_id, variant_id, status, user_email, user_key, monthly_credits,
                renews_at, ends_at, last_event_name, created_at, updated_at,
              });
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (/INSERT INTO workspace_credit_ledger/.test(sql)) {
            const [id, user_key, credit_type, amount, reason, source_event_id, metadata_json, created_at] = bound;
            state.ledger.push({
              id, user_key, project_id: null, credit_type, amount,
              direction: "grant", reason, source_event_id, metadata_json,
              status: "applied", created_at,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (/INSERT INTO workspace_credit_balances/.test(sql)) {
            const [id, user_key, credit_type, balance, created_at, updated_at] = bound;
            const existing = state.balances.find(
              (b) => b.user_key === user_key && b.credit_type === credit_type,
            );
            if (existing) {
              existing.balance += Number(balance ?? 0);
              existing.updated_at = updated_at;
            } else {
              state.balances.push({ id, user_key, credit_type, balance: Number(balance ?? 0), created_at, updated_at });
            }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          return { results: [] };
        },
      };
      return {
        bind: (...args) => { bound = args; return handlers; },
        first: handlers.first,
        all: handlers.all,
        run: handlers.run,
      };
    },
  };
}

const VARIANT_MAP = JSON.stringify({ 123456: 30, 789012: 100 });

function makeEnv(overrides = {}) {
  return {
    DB: makeMockDb(),
    ENVIRONMENT: "test",
    LEMONSQUEEZY_API_KEY: "ls_test_apikey",
    LEMONSQUEEZY_WEBHOOK_SECRET: "wh_test_secret",
    LEMONSQUEEZY_STORE_ID: "12345",
    LEMONSQUEEZY_VARIANT_ID_FIRST_PR: "98765",
    LS_SUBSCRIPTION_VARIANT_CREDITS: VARIANT_MAP,
    PUBLIC_BASE_URL: "https://worker.test",
    ...overrides,
  };
}

async function postWebhook(app, env, eventBody) {
  const body = JSON.stringify(eventBody);
  const sig = hmacHex(body, env.LEMONSQUEEZY_WEBHOOK_SECRET);
  return app.fetch(
    new Request("http://localhost/webhook/lemonsqueezy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": sig },
      body,
    }),
    env,
  );
}

function makeSubscriptionEvent({
  eventName = "subscription_created",
  subscriptionId = "sub_100",
  variantId = 123456,
  status = "active",
  email = "subscriber@example.com",
  custom = { user_key: "wk_alpha" },
} = {}) {
  return {
    meta: { event_name: eventName, custom_data: custom },
    data: {
      type: "subscriptions",
      id: subscriptionId,
      attributes: {
        store_id: 12345,
        customer_id: 777,
        order_id: 555,
        product_id: 42,
        variant_id: variantId,
        user_email: email,
        status,
        renews_at: "2026-08-01T00:00:00Z",
        ends_at: null,
      },
    },
  };
}

function makeInvoiceEvent({
  invoiceId = "inv_900",
  subscriptionId = 100,
  total = 1900,
  custom,
} = {}) {
  return {
    meta: { event_name: "subscription_payment_success", ...(custom ? { custom_data: custom } : {}) },
    data: {
      type: "subscription-invoices",
      id: invoiceId,
      attributes: {
        subscription_id: subscriptionId,
        customer_id: 777,
        user_email: "subscriber@example.com",
        billing_reason: "renewal",
        status: "paid",
        total,
        currency: "USD",
      },
    },
  };
}

// ---- parseSubscriptionVariantCredits -----------------------------------

test("parseSubscriptionVariantCredits: valid JSON → mapping", () => {
  const m = parseSubscriptionVariantCredits('{"123456":30,"789012":100}');
  assert.deepEqual(m, { 123456: 30, 789012: 100 });
});

test("parseSubscriptionVariantCredits: malformed JSON → {}", () => {
  assert.deepEqual(parseSubscriptionVariantCredits("{not json"), {});
});

test("parseSubscriptionVariantCredits: non-object / empty → {}", () => {
  assert.deepEqual(parseSubscriptionVariantCredits("[1,2]"), {});
  assert.deepEqual(parseSubscriptionVariantCredits('"str"'), {});
  assert.deepEqual(parseSubscriptionVariantCredits(""), {});
  assert.deepEqual(parseSubscriptionVariantCredits(undefined), {});
  assert.deepEqual(parseSubscriptionVariantCredits(null), {});
});

test("parseSubscriptionVariantCredits: drops non-positive / non-integer values, accepts numeric strings", () => {
  const m = parseSubscriptionVariantCredits('{"a":0,"b":-5,"c":1.5,"d":"30","e":"x","f":10}');
  assert.deepEqual(m, { d: 30, f: 10 });
});

// ---- subscription_created / updated ------------------------------------

test("subscription_created: persists state with mapped monthly credits + user_key", async () => {
  const app = createApp();
  const env = makeEnv();
  const r = await postWebhook(app, env, makeSubscriptionEvent());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.subscription_id, "sub_100");
  assert.equal(j.status, "active");
  assert.equal(j.monthly_credits, 30);

  const sub = env.DB.state.subs[0];
  assert.equal(sub.provider_subscription_id, "sub_100");
  assert.equal(sub.variant_id, "123456");
  assert.equal(sub.user_key, "wk_alpha");
  assert.equal(sub.monthly_credits, 30);
  assert.equal(sub.status, "active");
  // state only — no credits granted on created
  assert.equal(env.DB.state.ledger.length, 0);
  assert.equal(env.DB.state.balances.length, 0);
});

test("subscription_updated: plan change updates variant + monthly credits on same row", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent());
  const r = await postWebhook(app, env, makeSubscriptionEvent({
    eventName: "subscription_updated",
    variantId: 789012,
  }));
  const j = await r.json();
  assert.equal(j.monthly_credits, 100);
  assert.equal(env.DB.state.subs.length, 1, "upsert — still one row");
  assert.equal(env.DB.state.subs[0].variant_id, "789012");
  assert.equal(env.DB.state.subs[0].monthly_credits, 100);
  assert.equal(env.DB.state.subs[0].last_event_name, "subscription_updated");
});

test("subscription_created: unknown variant → recorded with monthly_credits 0", async () => {
  const app = createApp();
  const env = makeEnv();
  const r = await postWebhook(app, env, makeSubscriptionEvent({ variantId: 999999 }));
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.monthly_credits, 0);
  assert.equal(env.DB.state.subs[0].monthly_credits, 0);
});

// ---- subscription_cancelled / expired ----------------------------------

test("subscription_cancelled: records status, no clawback of granted credits", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100" }));
  // month's payment granted 30 credits
  await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  const balBefore = env.DB.state.balances.find((b) => b.user_key === "wk_alpha").balance;
  assert.equal(balBefore, 30);

  const r = await postWebhook(app, env, makeSubscriptionEvent({
    eventName: "subscription_cancelled",
    subscriptionId: "100",
    status: "cancelled",
  }));
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, "cancelled");
  assert.equal(env.DB.state.subs[0].status, "cancelled");
  // NO clawback
  const balAfter = env.DB.state.balances.find((b) => b.user_key === "wk_alpha").balance;
  assert.equal(balAfter, 30);
});

test("subscription_expired: records status", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "sub_e" }));
  const r = await postWebhook(app, env, makeSubscriptionEvent({
    eventName: "subscription_expired",
    subscriptionId: "sub_e",
    status: "expired",
  }));
  assert.equal((await r.json()).status, "expired");
  assert.equal(env.DB.state.subs[0].status, "expired");
});

// ---- subscription_payment_success ---------------------------------------

test("subscription_payment_success: grants mapped credits once into workspace ledger", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100" }));

  const r = await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.credits_granted, 30);
  assert.equal(j.duplicate_grant, false);

  const bal = env.DB.state.balances.find((b) => b.user_key === "wk_alpha" && b.credit_type === "review");
  assert.equal(bal.balance, 30);
  assert.equal(env.DB.state.ledger.length, 1);
  assert.equal(env.DB.state.ledger[0].source_event_id, "ls_subinv_inv_1");
  assert.equal(env.DB.state.ledger[0].direction, "grant");
  // invoice recorded as billing order (idempotency anchor)
  const order = env.DB.state.orders.find((o) => o.provider_order_id === "subinv_inv_1");
  assert.ok(order);
  assert.equal(order.credits_granted, 30);
  assert.equal(order.product_label, "ls-subscription-payment");
});

test("subscription_payment_success: duplicate delivery → no double grant", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100" }));
  await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));

  const r2 = await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  const j2 = await r2.json();
  assert.equal(j2.ok, true);
  assert.equal(j2.duplicate, true);

  const bal = env.DB.state.balances.find((b) => b.user_key === "wk_alpha");
  assert.equal(bal.balance, 30, "balance unchanged on duplicate");
  assert.equal(env.DB.state.ledger.length, 1, "no second ledger entry");
  assert.equal(env.DB.state.orders.length, 1, "no second order row");
});

test("subscription_payment_success: next month's invoice grants again (different invoice id)", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100" }));
  await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_jul", subscriptionId: 100 }));
  await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_aug", subscriptionId: 100 }));
  const bal = env.DB.state.balances.find((b) => b.user_key === "wk_alpha");
  assert.equal(bal.balance, 60);
  assert.equal(env.DB.state.ledger.length, 2);
});

test("subscription_payment_success: unknown variant → payment recorded, no grant", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100", variantId: 999999 }));
  const r = await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.credits_granted, 0);
  assert.equal(j.skipped, "unknown_variant");
  assert.equal(env.DB.state.ledger.length, 0);
  assert.equal(env.DB.state.balances.length, 0);
  // still recorded → replay stays idempotent
  assert.equal(env.DB.state.orders.length, 1);
  assert.equal(env.DB.state.orders[0].credits_granted, 0);
});

test("subscription_payment_success: no user_key anywhere → payment recorded, no grant", async () => {
  const app = createApp();
  const env = makeEnv();
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100", custom: null }));
  const r = await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  const j = await r.json();
  assert.equal(j.credits_granted, 0);
  assert.equal(j.skipped, "no_user_key");
  assert.equal(env.DB.state.ledger.length, 0);
});

test("subscription_payment_success: malformed LS_SUBSCRIPTION_VARIANT_CREDITS → safe no-op grant", async () => {
  const app = createApp();
  const env = makeEnv({ LS_SUBSCRIPTION_VARIANT_CREDITS: "{oops not json" });
  await postWebhook(app, env, makeSubscriptionEvent({ subscriptionId: "100" }));
  const r = await postWebhook(app, env, makeInvoiceEvent({ invoiceId: "inv_1", subscriptionId: 100 }));
  assert.equal(r.status, 200, "acks 200 — LS must not retry forever");
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.credits_granted, 0);
  assert.equal(env.DB.state.ledger.length, 0);
  assert.equal(env.DB.state.balances.length, 0);
});

// ---- order_created × subscription variant ------------------------------

test("order_created with subscription variant → recorded, one-time credit NOT granted", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      users: [
        { id: "usr_1", github_user_id: 1, github_login: "bae", email: "bae@example.com", tier: "free", paid_credits: 0 },
      ],
    }),
  });
  const orderEvent = {
    meta: { event_name: "order_created", custom_data: { user_key: "wk_alpha" } },
    data: {
      type: "orders",
      id: "order_sub_initial",
      attributes: {
        store_id: 12345, customer_id: 777, identifier: "x",
        user_email: "bae@example.com", user_name: "Bae", currency: "USD",
        status: "paid", total: 1900,
        first_order_item: { variant_id: 123456, variant_name: "Solo monthly", product_id: 42, product_name: "Solo" },
        created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
      },
    },
  };
  const r = await postWebhook(app, env, orderEvent);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.subscription_order, true);
  assert.equal(j.credits_granted, 0);
  const u = env.DB.state.users.find((u) => u.id === "usr_1");
  assert.equal(u.paid_credits, 0, "no spurious one-time credit for a subscription order");
  assert.equal(env.DB.state.orders[0].product_label, "ls-subscription-order");
  assert.equal(env.DB.state.orders[0].credits_granted, 0);
});

// ---- order_refunded -----------------------------------------------------

function makeRefundEvent(orderId = "order_aaa") {
  return {
    meta: { event_name: "order_refunded" },
    data: {
      type: "orders",
      id: orderId,
      attributes: {
        store_id: 12345, customer_id: 1, identifier: "x",
        user_email: "bae@example.com", user_name: "Bae", currency: "USD",
        status: "refunded", total: 300, refunded: true,
        created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z",
      },
    },
  };
}

function refundFixtureEnv() {
  return makeEnv({
    DB: makeMockDb({
      users: [
        { id: "usr_1", github_user_id: 1, github_login: "bae", email: "bae@example.com", tier: "free", paid_credits: 1 },
      ],
      orders: [
        {
          id: "bo_1", user_id: "usr_1", provider: "lemonsqueezy",
          provider_order_id: "order_aaa", product_variant_id: "98765",
          product_label: "first-pr-pass", amount_cents: 300, currency: "USD",
          status: "paid", credits_granted: 1, pending_email: null,
          customer_email: "bae@example.com", created_at: "x", paid_at: "x",
          refunded_at: null,
        },
      ],
    }),
  });
}

test("order_refunded: deducts granted credits once + marks row refunded", async () => {
  const app = createApp();
  const env = refundFixtureEnv();
  const r = await postWebhook(app, env, makeRefundEvent());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.refunded, true);
  assert.equal(j.credits_deducted, 1);

  const u = env.DB.state.users.find((u) => u.id === "usr_1");
  assert.equal(u.paid_credits, 0);
  assert.equal(env.DB.state.orders[0].status, "refunded");
  assert.ok(env.DB.state.orders[0].refunded_at);
});

test("order_refunded: duplicate delivery → idempotent, no double deduction", async () => {
  const app = createApp();
  const env = refundFixtureEnv();
  await postWebhook(app, env, makeRefundEvent());
  const r2 = await postWebhook(app, env, makeRefundEvent());
  const j2 = await r2.json();
  assert.equal(j2.ok, true);
  assert.equal(j2.duplicate, true);

  const u = env.DB.state.users.find((u) => u.id === "usr_1");
  assert.equal(u.paid_credits, 0, "deducted exactly once");
});

test("order_refunded: balance may go negative (credit already spent)", async () => {
  const app = createApp();
  const env = refundFixtureEnv();
  // user already spent the credit
  env.DB.state.users[0].paid_credits = 0;
  await postWebhook(app, env, makeRefundEvent());
  const u = env.DB.state.users.find((u) => u.id === "usr_1");
  assert.equal(u.paid_credits, -1, "negative balance is honest");
});

test("order_refunded: unlinked order (never granted) → refunded, nothing deducted", async () => {
  const app = createApp();
  const env = makeEnv({
    DB: makeMockDb({
      orders: [
        {
          id: "bo_p", user_id: null, provider: "lemonsqueezy",
          provider_order_id: "order_p", product_label: "first-pr-pass",
          amount_cents: 300, currency: "USD", status: "paid_unlinked",
          credits_granted: 1, pending_email: "buyer@nowhere.com",
          customer_email: "buyer@nowhere.com", created_at: "x", refunded_at: null,
        },
      ],
    }),
  });
  const r = await postWebhook(app, env, makeRefundEvent("order_p"));
  const j = await r.json();
  assert.equal(j.refunded, true);
  assert.equal(j.credits_deducted, 0);
  // refunded status also makes the order unclaimable by a later sign-up
  assert.equal(env.DB.state.orders[0].status, "refunded");
});

test("order_refunded: unknown order → ack + skip (manual review log)", async () => {
  const app = createApp();
  const env = makeEnv();
  const r = await postWebhook(app, env, makeRefundEvent("order_ghost"));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.skipped, "refund_unknown_order");
});

// ---- unrelated events still ack ------------------------------------------

test("unhandled subscription event (payment_failed) → ack + skip", async () => {
  const app = createApp();
  const env = makeEnv();
  const r = await postWebhook(app, env, {
    meta: { event_name: "subscription_payment_failed" },
    data: { type: "subscription-invoices", id: "inv_f", attributes: { subscription_id: 100 } },
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.skipped, "event=subscription_payment_failed");
});
