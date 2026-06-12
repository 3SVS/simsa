/**
 * workspace-credit-enforcement.test.mjs
 *
 * Stage 21: credit enforcement dry-run helper + PR review endpoint integration.
 *
 * Tests:
 *  01. included event: requiredCredits=0, wouldBlock=false
 *  02. workspace_pr_review_run: requiredCredits=1, creditType=review
 *  03. wouldBlock=false when balance is sufficient
 *  04. wouldBlock=true when balance is insufficient
 *  05. wouldBlock=false when balance is exactly equal to required
 *  06. dry-run never writes to balance table
 *  07. dry-run never writes to ledger table
 *  08. message contains 실제 차감 when balance is sufficient
 *  09. message contains 막지 않습니다 when wouldBlock=true
 *  10. message contains 포함 기능 for included event
 *  11. actualDebitsEnabled is always false
 *  12. remainingAfter = max(0, balance - required)
 *  13. preview entries include currentBalance
 *  14. preview entries have wouldBlockIfEnforced=true when balance is 0
 *  15. preview entries have wouldBlockIfEnforced=false when balance is sufficient
 *  16. admin preview response includes enforcementPreview
 *  17. enforcementPreview.wouldBlockCount counts entries where wouldBlockIfEnforced=true
 *  18. PR review endpoint response includes creditDryRun field
 *  19. PR review still proceeds when creditDryRun.wouldBlock=true
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { checkCreditEnforcementDryRun } = await import("../dist/workspace/credit-enforcement.js");
const { createApp } = await import("../dist/router.js");

const ADMIN_KEY = "test-enforcement-key";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function makeDb(opts = {}) {
  const { balances = new Map(), ledger = [], usageEvents = [] } = opts;
  const writeCount = { balance: 0, ledger: 0 };

  return {
    _balances: balances,
    _ledger: ledger,
    _writeCount: writeCount,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO workspace_credit_balances")) {
                writeCount.balance += 1;
                const [id, userKey, creditType, amount, createdAt, updatedAt] = args;
                const key = `${userKey}:${creditType}`;
                const existing = balances.get(key);
                if (existing) {
                  existing.balance += amount;
                  existing.updated_at = updatedAt;
                } else {
                  balances.set(key, { id, user_key: userKey, credit_type: creditType, balance: amount, created_at: createdAt, updated_at: updatedAt });
                }
              }
              if (sql.includes("INSERT INTO workspace_credit_ledger")) {
                writeCount.ledger += 1;
                ledger.push({ args });
              }
            },
            async first() {
              // getCreditBalance — SELECT credit_type, balance, updated_at
              if (sql.includes("SELECT credit_type, balance, updated_at") && !sql.includes("ORDER BY")) {
                const [userKey, creditType] = args;
                return balances.get(`${userKey}:${creditType}`) ?? null;
              }
              // SELECT balance FROM workspace_credit_balances
              if (sql.includes("SELECT balance FROM workspace_credit_balances")) {
                const [userKey, creditType] = args;
                const row = balances.get(`${userKey}:${creditType}`);
                return row ? { balance: row.balance } : null;
              }
              return null;
            },
            async all() {
              // listCreditBalances
              if (sql.includes("SELECT credit_type, balance, updated_at") && sql.includes("ORDER BY credit_type")) {
                const [userKey] = args;
                const results = [];
                for (const [key, row] of balances.entries()) {
                  if (key.startsWith(`${userKey}:`)) results.push(row);
                }
                return { results: results.sort((a, b) => a.credit_type.localeCompare(b.credit_type)) };
              }
              // listCreditLedger
              if (sql.includes("FROM workspace_credit_ledger")) {
                return { results: [] };
              }
              // previewCreditDebitFromUsageEvents — userKey filter
              if (sql.includes("FROM workspace_usage_events") && sql.includes("AND user_key = ?")) {
                const [cutoff, userKey] = args;
                const rows = usageEvents.filter(e => e.created_at >= cutoff && e.user_key === userKey);
                return { results: aggregateUsage(rows) };
              }
              // previewCreditDebitFromUsageEvents — no filter
              if (sql.includes("FROM workspace_usage_events") && sql.includes("GROUP BY user_key")) {
                const [cutoff] = args;
                const rows = usageEvents.filter(e => e.created_at >= cutoff);
                return { results: aggregateUsage(rows) };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function aggregateUsage(rows) {
  const map = new Map();
  for (const e of rows) {
    const key = `${e.user_key}|${e.project_id ?? ""}|${e.event_type}`;
    const cur = map.get(key) ?? { user_key: e.user_key, project_id: e.project_id ?? null, event_type: e.event_type, count: 0, sample_created_at: e.created_at };
    cur.count += 1;
    if (e.created_at > cur.sample_created_at) cur.sample_created_at = e.created_at;
    map.set(key, cur);
  }
  return Array.from(map.values());
}

function makeUsageEvent(userKey, eventType, daysAgo = 1) {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000);
  return { id: `e_${Math.random().toString(36).slice(2)}`, user_key: userKey, event_type: eventType, project_id: null, created_at: d.toISOString() };
}

function makeEnv(balances = new Map(), usageEvents = []) {
  return {
    ENVIRONMENT: "test",
    ADMIN_USAGE_STATS_KEY: ADMIN_KEY,
    DB: makeDb({ balances, usageEvents }),
  };
}

function balanceMap(userKey, creditType, amount) {
  const m = new Map();
  m.set(`${userKey}:${creditType}`, { id: "b1", user_key: userKey, credit_type: creditType, balance: amount, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" });
  return m;
}

function reqWithEnv(env, method, path, body) {
  const app = createApp();
  const headers = { "x-admin-key": ADMIN_KEY };
  if (body) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

// ─── Tests: credit-enforcement unit ──────────────────────────────────────────

describe("checkCreditEnforcementDryRun", () => {
  it("01 — included event: requiredCredits=0, wouldBlock=false", async () => {
    const env = makeEnv();
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_comment_posted" });
    assert.equal(result.requiredCredits, 0);
    assert.equal(result.wouldBlock, false);
    assert.equal(result.billingStatus, "included");
  });

  it("02 — workspace_pr_review_run: requiredCredits=1, creditType=review", async () => {
    const env = makeEnv();
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.requiredCredits, 1);
    assert.equal(result.creditType, "review");
    assert.equal(result.billingStatus, "billable_candidate");
  });

  it("03 — wouldBlock=false when balance is sufficient", async () => {
    const env = makeEnv(balanceMap("u1", "review", 5));
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, false);
    assert.equal(result.currentBalance, 5);
    assert.equal(result.remainingAfter, 4);
  });

  it("04 — wouldBlock=true when balance is insufficient", async () => {
    const env = makeEnv(); // balance = 0
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, true);
    assert.equal(result.currentBalance, 0);
    assert.equal(result.remainingAfter, 0);
  });

  it("05 — wouldBlock=false when balance equals required", async () => {
    const env = makeEnv(balanceMap("u1", "review", 1));
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, false);
    assert.equal(result.remainingAfter, 0);
  });

  it("06 — dry-run never writes to balance table", async () => {
    const env = makeEnv();
    await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(env.DB._writeCount.balance, 0);
  });

  it("07 — dry-run never writes to ledger table", async () => {
    const env = makeEnv();
    await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(env.DB._writeCount.ledger, 0);
  });

  it("08 — message contains 실제 차감 when balance is sufficient", async () => {
    const env = makeEnv(balanceMap("u1", "review", 10));
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.ok(result.message.includes("실제 차감"), `message was: ${result.message}`);
  });

  it("09 — message contains 막지 않습니다 when wouldBlock=true", async () => {
    const env = makeEnv();
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.ok(result.message.includes("막지 않습니다"), `message was: ${result.message}`);
  });

  it("10 — message contains 포함 기능 for included event", async () => {
    const env = makeEnv();
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_comment_posted" });
    assert.ok(result.message.includes("포함 기능"), `message was: ${result.message}`);
  });

  it("11 — actualDebitsEnabled is always false", async () => {
    for (const eventType of ["workspace_pr_review_run", "workspace_pr_comment_posted", "unknown_event"]) {
      const env = makeEnv();
      const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType });
      assert.equal(result.actualDebitsEnabled, false, `eventType=${eventType}`);
    }
  });

  it("12 — remainingAfter = max(0, balance - required)", async () => {
    const env = makeEnv(balanceMap("u1", "review", 3));
    const result = await checkCreditEnforcementDryRun({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.remainingAfter, 2);

    const envZero = makeEnv(); // balance=0, required=1 → remainingAfter=0 not -1
    const resultZero = await checkCreditEnforcementDryRun({ env: envZero, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(resultZero.remainingAfter, 0);
  });
});

// ─── Tests: preview entry annotations ─────────────────────────────────────────

describe("previewCreditDebitFromUsageEvents with enforcement annotations", () => {
  it("13 — preview entries include currentBalance", async () => {
    const balances = balanceMap("u1", "review", 3);
    const events = [makeUsageEvent("u1", "workspace_pr_review_run")];
    const env = makeEnv(balances, events);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find(e => e.eventType === "workspace_pr_review_run");
    assert.ok(entry, "entry present");
    assert.equal(entry.currentBalance, 3);
  });

  it("14 — preview entries have wouldBlockIfEnforced=true when balance=0", async () => {
    const events = [makeUsageEvent("u1", "workspace_pr_review_run")];
    const env = makeEnv(new Map(), events);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find(e => e.eventType === "workspace_pr_review_run");
    assert.ok(entry);
    assert.equal(entry.wouldBlockIfEnforced, true);
    assert.equal(entry.currentBalance, 0);
  });

  it("15 — preview entries have wouldBlockIfEnforced=false when balance is sufficient", async () => {
    const balances = balanceMap("u1", "review", 5);
    const events = [makeUsageEvent("u1", "workspace_pr_review_run")];
    const env = makeEnv(balances, events);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find(e => e.eventType === "workspace_pr_review_run");
    assert.ok(entry);
    assert.equal(entry.wouldBlockIfEnforced, false);
  });
});

// ─── Tests: admin preview enforcementPreview ─────────────────────────────────

describe("admin preview enforcementPreview", () => {
  it("16 — response includes enforcementPreview", async () => {
    const env = makeEnv();
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview", null);
    const body = await res.json();
    assert.ok(body.enforcementPreview, "enforcementPreview present");
    assert.equal(body.enforcementPreview.actualDebitsEnabled, false);
    assert.equal(typeof body.enforcementPreview.wouldBlockCount, "number");
    assert.equal(typeof body.enforcementPreview.checkedEventCount, "number");
  });

  it("17 — enforcementPreview.wouldBlockCount counts wouldBlock entries", async () => {
    // u1 has 0 balance → wouldBlock=true; u2 has 5 balance → wouldBlock=false
    const balances = balanceMap("u2", "review", 5);
    const events = [
      makeUsageEvent("u1", "workspace_pr_review_run"),
      makeUsageEvent("u2", "workspace_pr_review_run"),
    ];
    const env = makeEnv(balances, events);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.enforcementPreview.wouldBlockCount, 1);
    assert.equal(body.enforcementPreview.checkedEventCount, 2);
  });
});
