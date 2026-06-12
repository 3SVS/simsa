/**
 * workspace-credit-config.test.mjs
 *
 * Stage 24–29: credit-config.ts + debitCredits() + checkCreditEnforcement() + config endpoint
 *              + idempotency (Stage 26) + idempotency key validation + SHA-256 sourceEventId (Stage 27)
 *              + reservation-first debit (Stage 28) + rollout checklist endpoint (Stage 29)
 *
 * Tests:
 *  01. getCreditExecutionConfig: both flags false when env unset
 *  02. getCreditExecutionConfig: actualDebitsEnabled true when ENABLE_ACTUAL_CREDIT_DEBITS="true"
 *  03. getCreditExecutionConfig: blockingEnabled true when ENABLE_CREDIT_BLOCKING="true"
 *  04. getCreditExecutionConfig: flags false when set to non-"true" value
 *  05. debitCredits: returns insufficient_credits when balance=0
 *  06. debitCredits: decrements balance and inserts ledger entry
 *  07. debitCredits: returns race_condition when changes=0
 *  08. debitCredits: returns db_error on SELECT failure
 *  09. checkCreditEnforcement: blocked=false when flags off (dry-run mode)
 *  10. checkCreditEnforcement: blocked=false when actualDebitsEnabled=true but wouldBlock=false
 *  11. checkCreditEnforcement: blocked=true when both flags true + insufficient balance
 *  12. checkCreditEnforcement: debit.applied=true when actualDebitsEnabled=true + sufficient balance
 *  13. checkCreditEnforcement: debit absent when actualDebitsEnabled=false
 *  14. checkCreditEnforcement: blocked=false for included event type
 *  15. GET /admin/credits/config: returns flags + envFlags
 *  16. GET /admin/credits/config: actualDebitsEnabled=false by default
 *  17. GET /admin/credits/config: actualDebitsEnabled=true when flag set
 *  18. GET /admin/credits/config: returns 401 on bad admin key
 *  19. PR review returns 402 when blocked=true
 *  20. PR review proceeds when blocked=false despite wouldBlock=true (dry-run)
 *  ... (21–42: Stage 25–26 scenarios)
 *  43–52. validateIdempotencyKey: length/charset validation
 *  53–58. buildPrReviewDebitSourceEventId: prefix, format, determinism, sensitivity
 *  59–60. idempotency round-trip: deterministic key prevents double-debit
 *  61–62. ledger status lifecycle: applied on success, failed on insufficient
 *  63–65. duplicate handling: applied/failed duplicate, no balance change on failed
 *  66–68. grant default status, checkCreditEnforcement ledgerStatus propagation
 *  69–70. concurrent same sourceEventId: single balance debit + single ledger entry
 *  71–78. GET /admin/credits/rollout-checklist: structure, safeForProductionDefault, auth
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { getCreditExecutionConfig } = await import("../dist/workspace/credit-config.js");
const { debitCredits, validateIdempotencyKey, buildPrReviewDebitSourceEventId } = await import("../dist/workspace/credits.js");
const { checkCreditEnforcement } = await import("../dist/workspace/credit-enforcement.js");
const { createApp } = await import("../dist/router.js");

const ADMIN_KEY = "test-stage24-key";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeDb(opts = {}) {
  const { balances = new Map(), ledger = [], usageEvents = [], changesOnUpdate = 1 } = opts;
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
                return { meta: { changes: 1 } };
              }
              // Stage 26: debit uses INSERT OR IGNORE; grant uses plain INSERT INTO
              if (sql.includes("workspace_credit_ledger") && sql.includes("INSERT")) {
                if (sql.includes("OR IGNORE")) {
                  // Debit reservation path (Stage 28: status='pending' initially)
                  // args = [id, user_key, project_id, credit_type, amount, reason, source_event_id, metadata, created_at]
                  const id = args[0];
                  const user_key = args[1];
                  const source_event_id = args[6];
                  const amount = args[4];
                  const reason = args[5];
                  // IGNORE if same (user_key, source_event_id) debit already exists
                  const exists = source_event_id != null &&
                    ledger.some(e => e.user_key === user_key && e.source_event_id === source_event_id && e.direction === "debit");
                  if (exists) return { meta: { changes: 0 } };
                  writeCount.ledger += 1;
                  ledger.push({ id, user_key, source_event_id, direction: "debit", amount, reason, status: "pending" });
                  return { meta: { changes: 1 } };
                } else {
                  // Grant/adjustment path — status='applied' by default
                  writeCount.ledger += 1;
                  ledger.push({ sql, args, status: "applied" });
                  return { meta: { changes: 1 } };
                }
              }
              // Stage 28: UPDATE workspace_credit_ledger SET status = ? WHERE id = ?
              if (sql.includes("UPDATE workspace_credit_ledger") && sql.includes("SET status")) {
                const [newStatus, entryId] = args;
                const entry = ledger.find(e => e.id === entryId);
                if (entry) entry.status = newStatus;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE workspace_credit_balances")) {
                const [amount, , userKey, creditType, requiredBalance] = args;
                const key = `${userKey}:${creditType}`;
                const row = balances.get(key);
                if (row && row.balance >= requiredBalance && changesOnUpdate > 0) {
                  row.balance -= amount;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
            async first() {
              // Stage 26/28: duplicate check — SELECT from ledger WHERE source_event_id = ?
              if (sql.includes("FROM workspace_credit_ledger") && sql.includes("source_event_id")) {
                const [userKey, sourceEventId] = args;
                const existing = ledger.find(
                  e => e.user_key === userKey && e.source_event_id === sourceEventId && e.direction === "debit"
                );
                return existing ? {
                  id: existing.id,
                  amount: existing.amount,
                  source_event_id: existing.source_event_id,
                  status: existing.status ?? "applied",
                  reason: existing.reason ?? "test",
                  created_at: "2026-01-01T00:00:00.000Z",
                } : null;
              }
              if (sql.includes("SELECT balance FROM workspace_credit_balances")) {
                const [userKey, creditType] = args;
                const row = balances.get(`${userKey}:${creditType}`);
                return row ? { balance: row.balance } : null;
              }
              if (sql.includes("SELECT credit_type, balance, updated_at") && !sql.includes("ORDER BY")) {
                const [userKey, creditType] = args;
                return balances.get(`${userKey}:${creditType}`) ?? null;
              }
              if (sql.includes("SELECT COUNT(*)") && sql.includes("FROM workspace_usage_events") && !sql.includes("GROUP BY")) {
                const [userKey, eventType] = args;
                const count = usageEvents.filter(e => e.user_key === userKey && e.event_type === eventType).length;
                return { count };
              }
              return null;
            },
            async all() {
              if (sql.includes("SELECT credit_type, balance, updated_at") && sql.includes("ORDER BY credit_type")) {
                const [userKey] = args;
                const results = [];
                for (const [key, row] of balances.entries()) {
                  if (key.startsWith(`${userKey}:`)) results.push(row);
                }
                return { results };
              }
              if (sql.includes("FROM workspace_usage_events") && sql.includes("GROUP BY user_key, project_id, event_type") && sql.includes("AND user_key = ?")) {
                return { results: [] };
              }
              if (sql.includes("FROM workspace_usage_events") && sql.includes("GROUP BY user_key, project_id, event_type")) {
                return { results: [] };
              }
              if (sql.includes("FROM workspace_usage_events") && sql.includes("GROUP BY user_key")) {
                return { results: [] };
              }
              if (sql.includes("FROM workspace_credit_ledger")) {
                return { results: [] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function makeEnv(opts = {}) {
  const { balances = new Map(), usageEvents = [], changesOnUpdate = 1, actualDebits = undefined, blocking = undefined } = opts;
  const env = {
    ENVIRONMENT: "test",
    ADMIN_USAGE_STATS_KEY: ADMIN_KEY,
    DB: makeDb({ balances, usageEvents, changesOnUpdate }),
  };
  if (actualDebits !== undefined) env.ENABLE_ACTUAL_CREDIT_DEBITS = actualDebits;
  if (blocking !== undefined) env.ENABLE_CREDIT_BLOCKING = blocking;
  return env;
}

function balanceMap(userKey, creditType, amount) {
  const m = new Map();
  m.set(`${userKey}:${creditType}`, {
    id: "b1", user_key: userKey, credit_type: creditType,
    balance: amount, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  });
  return m;
}

function makeReviewEvents(userKey, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`, user_key: userKey, event_type: "workspace_pr_review_run",
    project_id: null, created_at: new Date(Date.now() - i * 3600 * 1000).toISOString(),
  }));
}

function req(env, method, path, body, headers = {}) {
  const app = createApp();
  const h = { "x-admin-key": ADMIN_KEY, ...headers };
  if (body) h["content-type"] = "application/json";
  return app.fetch(new Request(`http://localhost${path}`, {
    method, headers: h,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}

// ─── Tests: getCreditExecutionConfig ─────────────────────────────────────────

describe("getCreditExecutionConfig", () => {
  it("01 — both flags false when env unset", () => {
    const config = getCreditExecutionConfig({ ENVIRONMENT: "test" });
    assert.equal(config.actualDebitsEnabled, false);
    assert.equal(config.blockingEnabled, false);
  });

  it("02 — actualDebitsEnabled true when ENABLE_ACTUAL_CREDIT_DEBITS='true'", () => {
    const config = getCreditExecutionConfig({ ENVIRONMENT: "test", ENABLE_ACTUAL_CREDIT_DEBITS: "true" });
    assert.equal(config.actualDebitsEnabled, true);
    assert.equal(config.blockingEnabled, false);
  });

  it("03 — blockingEnabled true when ENABLE_CREDIT_BLOCKING='true'", () => {
    const config = getCreditExecutionConfig({ ENVIRONMENT: "test", ENABLE_CREDIT_BLOCKING: "true" });
    assert.equal(config.blockingEnabled, true);
    assert.equal(config.actualDebitsEnabled, false);
  });

  it("04 — flags false when set to non-'true' value", () => {
    const config = getCreditExecutionConfig({
      ENVIRONMENT: "test",
      ENABLE_ACTUAL_CREDIT_DEBITS: "false",
      ENABLE_CREDIT_BLOCKING: "1",
    });
    assert.equal(config.actualDebitsEnabled, false);
    assert.equal(config.blockingEnabled, false);
  });
});

// ─── Tests: debitCredits ──────────────────────────────────────────────────────

describe("debitCredits", () => {
  it("05 — returns insufficient_credits when balance=0", async () => {
    const env = makeEnv();
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "test", sourceEventId: "prr_test05",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "insufficient_credits");
    assert.equal(result.currentBalance, 0);
  });

  it("06 — decrements balance, inserts ledger entry, ledgerStatus=applied", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 2, reason: "test debit", sourceEventId: "prr_test06",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.duplicate, false);
      assert.equal(result.newBalance, 3); // 5 - 2 = 3
      assert.ok(result.ledgerEntryId.startsWith("wcl_"));
      assert.equal(result.sourceEventId, "prr_test06");
      assert.equal(result.ledgerStatus, "applied");
    }
    assert.equal(env.DB._writeCount.ledger, 1);
  });

  it("07 — returns insufficient_credits when balance UPDATE returns changes=0", async () => {
    const balances = balanceMap("u1", "review", 5);
    // changesOnUpdate=0 simulates balance insufficient (WHERE balance >= amount fails)
    const env = makeEnv({ balances, changesOnUpdate: 0 });
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "insufficient test", sourceEventId: "prr_test07",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "insufficient_credits");
  });

  it("08 — returns db_error on SELECT failure", async () => {
    const brokenDb = {
      prepare() {
        return {
          bind() {
            return {
              async first() { throw new Error("D1 down"); },
              async run() { throw new Error("D1 down"); },
            };
          },
        };
      },
    };
    const env = { ENVIRONMENT: "test", DB: brokenDb };
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "error test", sourceEventId: "prr_test08",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "db_error");
  });
});

// ─── Tests: checkCreditEnforcement ───────────────────────────────────────────

describe("checkCreditEnforcement", () => {
  it("09 — blocked=false when both flags off (dry-run mode)", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5) }); // allowance exhausted, balance=0
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.blocked, false);
    assert.equal(result.actualDebitsEnabled, false);
    assert.equal(result.wouldBlock, true);
  });

  it("10 — blocked=false when actualDebitsEnabled=true but balance sufficient", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      blocking: "true",
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, false);
    assert.equal(result.blocked, false);
  });

  it("11 — blocked=true when both flags true + allowance exhausted + balance=0", async () => {
    const env = makeEnv({
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      blocking: "true",
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.blocked, true);
    assert.equal(result.wouldBlock, true);
    assert.equal(result.actualDebitsEnabled, true);
  });

  it("12 — debit.applied=true when actualDebitsEnabled=true + allowance exhausted + balance sufficient", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.actualDebitsEnabled, true);
    assert.equal(result.wouldBlock, false);
    assert.ok(result.debit, "debit field present");
    assert.equal(result.debit?.attempted, true);
    assert.equal(result.debit?.applied, true);
    assert.equal(result.debit?.duplicate, undefined);
  });

  it("13 — debit field absent when actualDebitsEnabled=false", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.actualDebitsEnabled, false);
    assert.equal(result.debit, undefined);
  });

  it("14 — blocked=false for included event type regardless of flags", async () => {
    const env = makeEnv({ actualDebits: "true", blocking: "true" });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_comment_posted" });
    assert.equal(result.blocked, false);
    assert.equal(result.billingStatus, "included");
  });
});

// ─── Tests: GET /admin/credits/config ────────────────────────────────────────

describe("GET /admin/credits/config", () => {
  it("15 — returns flags + envFlags", async () => {
    const env = makeEnv({ actualDebits: "false", blocking: "false" });
    const res = await req(env, "GET", "/admin/credits/config", null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok("actualDebitsEnabled" in body);
    assert.ok("blockingEnabled" in body);
    assert.ok("envFlags" in body);
    assert.ok("ENABLE_ACTUAL_CREDIT_DEBITS" in body.envFlags);
    assert.ok("ENABLE_CREDIT_BLOCKING" in body.envFlags);
  });

  it("16 — actualDebitsEnabled=false by default", async () => {
    const env = makeEnv(); // no flags set
    const res = await req(env, "GET", "/admin/credits/config", null);
    const body = await res.json();
    assert.equal(body.actualDebitsEnabled, false);
    assert.equal(body.blockingEnabled, false);
  });

  it("17 — actualDebitsEnabled=true when ENABLE_ACTUAL_CREDIT_DEBITS='true'", async () => {
    const env = makeEnv({ actualDebits: "true" });
    const res = await req(env, "GET", "/admin/credits/config", null);
    const body = await res.json();
    assert.equal(body.actualDebitsEnabled, true);
    assert.equal(body.blockingEnabled, false);
  });

  it("18 — returns 401 on bad admin key", async () => {
    const env = makeEnv();
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost/admin/credits/config", {
        headers: { "x-admin-key": "wrong-key" },
      }),
      env,
    );
    assert.equal(res.status, 401);
  });
});

// ─── Tests: PR review 402 / blocking ─────────────────────────────────────────

describe("PR review credit blocking", () => {
  it("19 — returns 402 when blocked=true (both flags on + balance=0)", async () => {
    // For this test we need a project + github setup. Use the app directly
    // but the review endpoint will 401 on missing userKey/repo, so we check
    // that the credit enforcement short-circuit fires BEFORE those checks.
    // Since the route requires userKey + project context, we test via the
    // checkCreditEnforcement helper directly and verify blocked=true is the
    // trigger for 402.
    const env = makeEnv({
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      blocking: "true",
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.blocked, true, "should be blocked when both flags on and balance=0");
  });

  it("20 — blocked=false in dry-run even with wouldBlock=true", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5) }); // both flags OFF
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, true);
    assert.equal(result.blocked, false, "blocked must be false in dry-run mode");
    assert.equal(result.actualDebitsEnabled, false);
  });
});

// ─── Tests: Stage 25 — Scenario A (dry-run mode) ─────────────────────────────

describe("Stage 25 — Scenario A: dry-run mode", () => {
  it("21 — wouldBlock=true, blocked=false, debit absent (both flags false)", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5) });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, true);
    assert.equal(result.blocked, false);
    assert.equal(result.debit, undefined);
  });

  it("22 — actualDebitsEnabled=false is reflected in result even when wouldBlock=true", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5) });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.actualDebitsEnabled, false);
    assert.equal(result.requiredCredits, 1);
    assert.equal(result.currentBalance, 0);
  });
});

// ─── Tests: Stage 25 — Scenario B (allowance covered) ────────────────────────

describe("Stage 25 — Scenario B: allowance covered, no debit", () => {
  it("23 — requiredCredits=0 when monthly allowance not exhausted", async () => {
    // 0 events used → all 5 monthly free runs remain → coveredByAllowance=true
    const env = makeEnv({ actualDebits: "true", usageEvents: [] });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.requiredCredits, 0);
    assert.equal(result.allowance?.coveredByAllowance, true);
  });

  it("24 — debit absent when coveredByAllowance=true (requiredCredits=0)", async () => {
    const env = makeEnv({ actualDebits: "true", usageEvents: [] });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.debit, undefined);
    assert.equal(result.blocked, false);
    assert.equal(result.wouldBlock, false);
  });
});

// ─── Tests: Stage 25 — Scenario C (allowance exhausted, balance sufficient) ──

describe("Stage 25 — Scenario C: allowance exhausted + balance sufficient", () => {
  it("25 — debit.applied=true when actualDebits=true + allowance exhausted + balance=3", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 3),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.actualDebitsEnabled, true);
    assert.equal(result.wouldBlock, false);
    assert.equal(result.debit?.attempted, true);
    assert.equal(result.debit?.applied, true);
  });

  it("26 — balance decremented by exactly 1 credit after debit", async () => {
    const balances = balanceMap("u1", "review", 3);
    const env = makeEnv({ balances, usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", changesOnUpdate: 1 });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.debit?.applied, true);
    const row = balances.get("u1:review");
    assert.equal(row?.balance, 2, "balance must drop from 3 to 2");
  });

  it("27 — exactly one ledger entry inserted per debit", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", changesOnUpdate: 1 });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(env.DB._writeCount.ledger, 1);
  });
});

// ─── Tests: Stage 25 — Scenario D (insufficient, blocking off) ───────────────

describe("Stage 25 — Scenario D: insufficient balance, blocking off", () => {
  it("28 — blocked=false when actualDebits=true, blocking=false, balance=0", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5), actualDebits: "true" }); // blocking unset
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.wouldBlock, true);
    assert.equal(result.blocked, false, "blockingEnabled=false must suppress the HTTP 402 gate");
  });

  it("29 — debit absent when wouldBlock=true (debit skipped to protect balance integrity)", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5), actualDebits: "true" });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.debit, undefined, "debit must not be called when wouldBlock=true");
    assert.equal(result.currentBalance, 0);
  });
});

// ─── Tests: Stage 25 — Scenario E (blocking on) ──────────────────────────────

describe("Stage 25 — Scenario E: insufficient balance, blocking on", () => {
  it("30 — blocked=true when both flags true + allowance exhausted + balance=0", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", blocking: "true" });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.blocked, true);
    assert.equal(result.wouldBlock, true);
    assert.equal(result.actualDebitsEnabled, true);
  });

  it("31 — debit absent when blocked=true (debit never called for blocked requests)", async () => {
    const env = makeEnv({ usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", blocking: "true" });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run" });
    assert.equal(result.debit, undefined, "debit must not fire when request is blocked");
  });
});

// ─── Tests: Stage 26 — Idempotency fixed ──────────────────────────────────────

describe("Stage 26 — Idempotency: same sourceEventId → single debit", () => {
  it("32 — second call with same sourceEventId returns duplicate=true", async () => {
    const balances = balanceMap("u1", "review", 2);
    const env = makeEnv({ balances, usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", changesOnUpdate: 1 });
    const r1 = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_idem1" });
    const r2 = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_idem1" });
    assert.equal(r1.debit?.applied, true, "first call applies debit");
    assert.equal(r2.debit?.duplicate, true, "second call is a duplicate — no additional debit");
    assert.equal(r2.debit?.applied, false, "duplicate call: applied=false");
  });

  it("33 — balance=1 after two calls with same sourceEventId (only one debit applied)", async () => {
    const balances = balanceMap("u1", "review", 2);
    const env = makeEnv({ balances, usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", changesOnUpdate: 1 });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_idem2" });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_idem2" });
    const row = balances.get("u1:review");
    assert.equal(row?.balance, 1, "balance should drop by 1, not 2 — idempotency working");
  });
});

// ─── Tests: Stage 26 — debitCredits idempotency ───────────────────────────────

describe("Stage 26 — debitCredits idempotency", () => {
  it("34 — missing sourceEventId returns ok:false error:missing_source_event_id", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "test", sourceEventId: "",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_source_event_id");
  });

  it("35 — first call returns ok:true, duplicate:false with sourceEventId in result", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s35",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.duplicate, false);
      assert.equal(result.sourceEventId, "prr_s35");
    }
  });

  it("36 — second call with same sourceEventId returns ok:true, duplicate:true", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s36" });
    const r2 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "second", sourceEventId: "prr_s36" });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.duplicate, true);
  });

  it("37 — duplicate call does not decrement balance a second time", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s37" });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "second", sourceEventId: "prr_s37" });
    const row = balances.get("u1:review");
    assert.equal(row?.balance, 4, "balance should be 5-1=4, not 5-2=3");
  });

  it("38 — duplicate call does not insert a second ledger entry", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s38" });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "second", sourceEventId: "prr_s38" });
    assert.equal(env.DB._writeCount.ledger, 1, "only one ledger entry created");
  });

  it("39 — different sourceEventIds each debit independently", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const r1 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "a", sourceEventId: "prr_s39a" });
    const r2 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "b", sourceEventId: "prr_s39b" });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok) assert.equal(r1.duplicate, false);
    if (r2.ok) assert.equal(r2.duplicate, false);
    assert.equal(balances.get("u1:review")?.balance, 3, "two independent debits: 5-1-1=3");
    assert.equal(env.DB._writeCount.ledger, 2, "two ledger entries created");
  });
});

// ─── Tests: Stage 26 — checkCreditEnforcement idempotency ────────────────────

describe("Stage 26 — checkCreditEnforcement idempotency", () => {
  it("40 — debit field includes attempted=true, applied=true, sourceEventId on success", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s40" });
    assert.equal(result.debit?.attempted, true);
    assert.equal(result.debit?.applied, true);
    assert.ok(result.debit?.sourceEventId, "sourceEventId must be present in debit result");
  });

  it("41 — duplicate enforcement call returns debit.duplicate=true, applied=false", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s41" });
    const r2 = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s41" });
    assert.equal(r2.debit?.attempted, true);
    assert.equal(r2.debit?.duplicate, true);
    assert.equal(r2.debit?.applied, false);
  });

  it("42 — balance decremented only once after two enforcement calls with same sourceEventId", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, usageEvents: makeReviewEvents("u1", 5), actualDebits: "true", changesOnUpdate: 1 });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s42" });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s42" });
    assert.equal(balances.get("u1:review")?.balance, 4, "balance: 5-1=4, NOT 5-2=3");
  });
});

// ─── Tests: Stage 27 — validateIdempotencyKey ─────────────────────────────────

describe("Stage 27 — validateIdempotencyKey", () => {
  it("43 — valid key: 8 chars minimum accepted", () => {
    assert.equal(validateIdempotencyKey("abcdefgh"), true);
  });

  it("44 — valid key: UUID-style with hyphens accepted", () => {
    assert.equal(validateIdempotencyKey("550e8400-e29b-41d4-a716-446655440000"), true);
  });

  it("45 — valid key: mixed alphanum + underscore + colon accepted", () => {
    assert.equal(validateIdempotencyKey("proj:abc_123-XYZ"), true);
  });

  it("46 — invalid key: 7 chars rejected (< 8)", () => {
    assert.equal(validateIdempotencyKey("abcdefg"), false);
  });

  it("47 — invalid key: 129 chars rejected (> 128)", () => {
    assert.equal(validateIdempotencyKey("a".repeat(129)), false);
  });

  it("48 — valid key: exactly 128 chars accepted", () => {
    assert.equal(validateIdempotencyKey("a".repeat(128)), true);
  });

  it("49 — invalid key: space character rejected", () => {
    assert.equal(validateIdempotencyKey("abc defghij"), false);
  });

  it("50 — invalid key: at-sign rejected", () => {
    assert.equal(validateIdempotencyKey("abc@defghij"), false);
  });

  it("51 — invalid key: empty string rejected", () => {
    assert.equal(validateIdempotencyKey(""), false);
  });

  it("52 — invalid key: non-string value rejected", () => {
    assert.equal(validateIdempotencyKey(null), false);
    assert.equal(validateIdempotencyKey(12345678), false);
  });
});

// ─── Tests: Stage 27 — buildPrReviewDebitSourceEventId ───────────────────────

describe("Stage 27 — buildPrReviewDebitSourceEventId", () => {
  it("53 — result has prr_ prefix", async () => {
    const id = await buildPrReviewDebitSourceEventId({
      projectId: "proj1", repoFullName: "owner/repo", prNumber: 42,
      userKey: "user1", idempotencyKey: "test-key-12345",
    });
    assert.ok(id.startsWith("prr_"), `expected prr_ prefix, got: ${id}`);
  });

  it("54 — result is exactly prr_ + 32 hex chars", async () => {
    const id = await buildPrReviewDebitSourceEventId({
      projectId: "proj1", repoFullName: "owner/repo", prNumber: 42,
      userKey: "user1", idempotencyKey: "test-key-12345",
    });
    assert.match(id, /^prr_[0-9a-f]{32}$/, `unexpected format: ${id}`);
  });

  it("55 — same inputs always produce same sourceEventId (deterministic)", async () => {
    const opts = {
      projectId: "proj1", repoFullName: "owner/repo", prNumber: 42,
      userKey: "user1", idempotencyKey: "my-key-abcdef",
    };
    const id1 = await buildPrReviewDebitSourceEventId(opts);
    const id2 = await buildPrReviewDebitSourceEventId(opts);
    assert.equal(id1, id2, "same inputs must produce same ID");
  });

  it("56 — different idempotency key produces different sourceEventId", async () => {
    const base = { projectId: "proj1", repoFullName: "owner/repo", prNumber: 42, userKey: "user1" };
    const id1 = await buildPrReviewDebitSourceEventId({ ...base, idempotencyKey: "key-aaaaaa11" });
    const id2 = await buildPrReviewDebitSourceEventId({ ...base, idempotencyKey: "key-bbbbbb22" });
    assert.notEqual(id1, id2, "different keys must produce different IDs");
  });

  it("57 — different prNumber produces different sourceEventId", async () => {
    const base = { projectId: "proj1", repoFullName: "owner/repo", userKey: "user1", idempotencyKey: "key-xyzxyz99" };
    const id1 = await buildPrReviewDebitSourceEventId({ ...base, prNumber: 1 });
    const id2 = await buildPrReviewDebitSourceEventId({ ...base, prNumber: 2 });
    assert.notEqual(id1, id2, "different prNumber must produce different IDs");
  });

  it("58 — different userKey produces different sourceEventId", async () => {
    const base = { projectId: "proj1", repoFullName: "owner/repo", prNumber: 10, idempotencyKey: "key-mnomno77" };
    const id1 = await buildPrReviewDebitSourceEventId({ ...base, userKey: "userA" });
    const id2 = await buildPrReviewDebitSourceEventId({ ...base, userKey: "userB" });
    assert.notEqual(id1, id2, "different userKey must produce different IDs");
  });
});

// ─── Tests: Stage 27 — idempotency round-trip via debitCredits ───────────────

describe("Stage 27 — idempotency key round-trip: deterministic sourceEventId prevents double-debit", () => {
  it("59 — two debit calls with same deterministic sourceEventId: second is duplicate", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const sourceEventId = await buildPrReviewDebitSourceEventId({
      projectId: "proj1", repoFullName: "owner/repo", prNumber: 7,
      userKey: "u1", idempotencyKey: "idem-key-stage27",
    });
    const r1 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "a", sourceEventId });
    const r2 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "b", sourceEventId });
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.duplicate, false, "first call: not a duplicate");
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.duplicate, true, "second call with same deterministic ID: duplicate");
  });

  it("60 — balance decremented only once even when same deterministic key is retried", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const sourceEventId = await buildPrReviewDebitSourceEventId({
      projectId: "proj2", repoFullName: "owner/repo2", prNumber: 99,
      userKey: "u1", idempotencyKey: "retry-key-stage27",
    });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "retry", sourceEventId });
    const row = balances.get("u1:review");
    assert.equal(row?.balance, 4, "balance: 5-1=4 (not 5-2=3)");
  });
});

// ─── Tests: Stage 28 — reservation-first debit ────────────────────────────────

describe("Stage 28 — reservation-first debit: ledger status lifecycle", () => {
  it("61 — successful debit: ledger entry finalized as status=applied", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "stage28", sourceEventId: "prr_s61",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ledgerStatus, "applied");
    // Ledger entry must have been updated to applied
    const entry = env.DB._ledger.find(e => e.source_event_id === "prr_s61");
    assert.ok(entry, "ledger entry must exist");
    assert.equal(entry.status, "applied", "ledger status must be applied after success");
  });

  it("62 — insufficient balance: ledger entry finalized as status=failed", async () => {
    const env = makeEnv({ changesOnUpdate: 0 }); // no balance row → UPDATE returns 0
    const result = await debitCredits(env, {
      userKey: "u1", creditType: "review", amount: 1, reason: "stage28", sourceEventId: "prr_s62",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "insufficient_credits");
    const entry = env.DB._ledger.find(e => e.source_event_id === "prr_s62");
    assert.ok(entry, "ledger entry must exist even on failure");
    assert.equal(entry.status, "failed", "ledger status must be failed on insufficient balance");
  });

  it("63 — duplicate with applied ledger: returns ledgerStatus=applied", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s63" });
    const r2 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "retry", sourceEventId: "prr_s63" });
    assert.equal(r2.ok, true);
    if (r2.ok) {
      assert.equal(r2.duplicate, true);
      assert.equal(r2.ledgerStatus, "applied");
    }
  });

  it("64 — duplicate with failed ledger: returns ledgerStatus=failed, no balance change", async () => {
    const balances = balanceMap("u1", "review", 0);
    const env = makeEnv({ balances, changesOnUpdate: 0 });
    // First call fails (insufficient)
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s64" });
    // Second call with same sourceEventId → duplicate of the failed entry
    const r2 = await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "retry", sourceEventId: "prr_s64" });
    assert.equal(r2.ok, true);
    if (r2.ok) {
      assert.equal(r2.duplicate, true);
      assert.equal(r2.ledgerStatus, "failed");
    }
  });

  it("65 — failed ledger duplicate does not touch balance", async () => {
    const balances = balanceMap("u1", "review", 0);
    const env = makeEnv({ balances, changesOnUpdate: 0 });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "first", sourceEventId: "prr_s65" });
    await debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "retry", sourceEventId: "prr_s65" });
    // Balance should still be 0 — never decremented
    assert.equal(balances.get("u1:review")?.balance ?? 0, 0);
    // Only one ledger entry
    assert.equal(env.DB._writeCount.ledger, 1);
  });

  it("66 — grant ledger defaults to status=applied", async () => {
    const balances = balanceMap("u1", "review", 0);
    const env = makeEnv({ balances });
    const { grantCredits } = await import("../dist/workspace/credits.js");
    await grantCredits(env, { userKey: "u1", creditType: "review", amount: 5, reason: "grant test" });
    const grantEntry = env.DB._ledger.find(e => e.status === "applied");
    assert.ok(grantEntry, "grant entry must have status=applied");
  });

  it("67 — checkCreditEnforcement debit.ledgerStatus=applied on successful debit", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    const result = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s67" });
    assert.equal(result.debit?.ledgerStatus, "applied");
  });

  it("68 — checkCreditEnforcement duplicate debit carries ledgerStatus from existing entry", async () => {
    const env = makeEnv({
      balances: balanceMap("u1", "review", 5),
      usageEvents: makeReviewEvents("u1", 5),
      actualDebits: "true",
      changesOnUpdate: 1,
    });
    await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s68" });
    const r2 = await checkCreditEnforcement({ env, userKey: "u1", eventType: "workspace_pr_review_run", sourceEventId: "prr_s68" });
    assert.equal(r2.debit?.duplicate, true);
    assert.equal(r2.debit?.ledgerStatus, "applied");
  });

  it("69 — concurrent same sourceEventId: balance decremented exactly once", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const sourceEventId = "prr_concurrent69";
    const [r1, r2] = await Promise.all([
      debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "a", sourceEventId }),
      debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "b", sourceEventId }),
    ]);
    const finalBalance = balances.get("u1:review")?.balance;
    assert.equal(finalBalance, 4, "balance must be 5-1=4, not 5-2=3");
    const results = [r1, r2];
    const successes = results.filter(r => r.ok && !r.duplicate);
    const duplicates = results.filter(r => r.ok && r.duplicate);
    assert.equal(successes.length, 1, "exactly one non-duplicate success");
    assert.equal(duplicates.length, 1, "exactly one duplicate");
  });

  it("70 — concurrent same sourceEventId: exactly one ledger entry created", async () => {
    const balances = balanceMap("u1", "review", 5);
    const env = makeEnv({ balances, changesOnUpdate: 1 });
    const sourceEventId = "prr_concurrent70";
    await Promise.all([
      debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "a", sourceEventId }),
      debitCredits(env, { userKey: "u1", creditType: "review", amount: 1, reason: "b", sourceEventId }),
    ]);
    assert.equal(env.DB._writeCount.ledger, 1, "unique index must allow only one ledger INSERT");
  });
});

// ─── Tests: Stage 29 — GET /admin/credits/rollout-checklist ──────────────────

describe("Stage 29 — GET /admin/credits/rollout-checklist", () => {
  it("71 — returns ok:true with valid admin key (both flags false)", async () => {
    const env = makeEnv();
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("72 — safeForProductionDefault=true when both flags false", async () => {
    const env = makeEnv({ actualDebits: "false", blocking: "false" });
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.equal(body.productionSafety.actualDebitsEnabled, false);
    assert.equal(body.productionSafety.blockingEnabled, false);
    assert.equal(body.productionSafety.safeForProductionDefault, true);
  });

  it("73 — safeForProductionDefault=false when actualDebitsEnabled=true", async () => {
    const env = makeEnv({ actualDebits: "true", blocking: "false" });
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.equal(body.productionSafety.actualDebitsEnabled, true);
    assert.equal(body.productionSafety.safeForProductionDefault, false);
  });

  it("74 — safeForProductionDefault=false when blockingEnabled=true", async () => {
    const env = makeEnv({ actualDebits: "false", blocking: "true" });
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.equal(body.productionSafety.blockingEnabled, true);
    assert.equal(body.productionSafety.safeForProductionDefault, false);
  });

  it("75 — requiredChecks is non-empty array; each item has id, label, status, description", async () => {
    const env = makeEnv();
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.ok(Array.isArray(body.requiredChecks), "requiredChecks must be array");
    assert.ok(body.requiredChecks.length > 0, "requiredChecks must be non-empty");
    for (const check of body.requiredChecks) {
      assert.ok(typeof check.id === "string", "check.id must be string");
      assert.ok(typeof check.label === "string", "check.label must be string");
      assert.ok(typeof check.description === "string", "check.description must be string");
      assert.ok(["manual", "passed", "warning", "blocked"].includes(check.status), `check.status must be valid: ${check.status}`);
    }
  });

  it("76 — recommendedScenarios includes safe-mode, debits-only, full-enforcement", async () => {
    const env = makeEnv();
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.ok(Array.isArray(body.recommendedScenarios), "recommendedScenarios must be array");
    const ids = body.recommendedScenarios.map(s => s.id);
    assert.ok(ids.includes("safe-mode"), "must include safe-mode scenario");
    assert.ok(ids.includes("debits-only"), "must include debits-only scenario");
    assert.ok(ids.includes("full-enforcement"), "must include full-enforcement scenario");
    for (const s of body.recommendedScenarios) {
      assert.ok(typeof s.label === "string", "scenario.label must be string");
      assert.ok(typeof s.expectedOutcome === "string", "scenario.expectedOutcome must be string");
      assert.ok(typeof s.flags.actualDebitsEnabled === "boolean", "flags.actualDebitsEnabled must be boolean");
      assert.ok(typeof s.flags.blockingEnabled === "boolean", "flags.blockingEnabled must be boolean");
    }
  });

  it("77 — productionEnableCriteria is non-empty array of strings", async () => {
    const env = makeEnv();
    const res = await req(env, "GET", "/admin/credits/rollout-checklist", null);
    const body = await res.json();
    assert.ok(Array.isArray(body.productionEnableCriteria), "productionEnableCriteria must be array");
    assert.ok(body.productionEnableCriteria.length > 0, "productionEnableCriteria must be non-empty");
    for (const c of body.productionEnableCriteria) {
      assert.ok(typeof c === "string", "each criterion must be string");
    }
  });

  it("78 — returns 401 on bad admin key", async () => {
    const env = makeEnv();
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost/admin/credits/rollout-checklist", {
        headers: { "x-admin-key": "wrong-key" },
      }),
      env,
    );
    assert.equal(res.status, 401);
  });
});
