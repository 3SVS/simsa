/**
 * workspace-admin-credits.test.mjs
 *
 * Stage 23: ledger preview + allowance summary + monthly-preview endpoint.
 *
 * Tests:
 *  01. GET /admin/credits — 503 when key not set
 *  02. GET /admin/credits — 401 on key mismatch
 *  03. GET /admin/credits — 400 when userKey missing
 *  04. GET /admin/credits — returns empty array when no balances
 *  05. POST /admin/credits/grant — grants credits and returns balance + ledger entry
 *  06. POST /admin/credits/grant — second grant increments balance
 *  07. POST /admin/credits/grant — rejects amount = 0
 *  08. POST /admin/credits/grant — rejects non-integer amount
 *  09. POST /admin/credits/grant — rejects invalid creditType
 *  10. POST /admin/credits/grant — rejects missing reason
 *  11. GET /admin/credits after grant — balance reflects grant
 *  12. GET /admin/credits/ledger — returns ledger entries ordered by created_at DESC
 *  13. GET /admin/credits/ledger — 401 on missing key
 *  14. GET /admin/credits/preview — actualDebitsEnabled is false
 *  15. GET /admin/credits/preview — maps workspace_pr_review_run to review credit (allowance-exhausted)
 *  16. GET /admin/credits/preview — does NOT include included events
 *  17. GET /admin/credits/preview — totalEstimatedCredits sums billable events after allowance
 *  18. GET /admin/credits/preview — userKey filter scopes to one user
 *  19. GET /admin/credits/preview — empty when no billable events
 *  20. GET /admin/credits/preview — invalid range defaults to 7d
 *  21. GET /admin/credits/preview — allowance field present on pr_review_run entry
 *  22. GET /admin/credits/preview — estimatedAmount=0 when all events covered by allowance
 *  23. GET /admin/credits/preview — estimatedAmount=1 when allowance exhausted (6 events)
 *  24. GET /admin/credits/preview — totalEstimatedCredits correct after allowance
 *  25. GET /admin/credits/preview — allowanceSummary present
 *  26. GET /admin/credits/preview — allowanceSummary.totalBillableAfterAllowance matches totalEstimatedCredits
 *  27. GET /admin/credits/preview — allowanceSummary.totalCoveredByAllowance counts covered events
 *  28. GET /admin/credits/preview — ledgerPreview array present
 *  29. GET /admin/credits/preview — ledgerPreview includes only events with estimatedAmount > 0
 *  30. GET /admin/credits/preview — ledgerPreview excludes allowance-covered entries
 *  31. GET /admin/credits/preview — ledgerPreview entries have direction=preview_debit
 *  32. GET /admin/credits/preview — ledgerPreview does not write to workspace_credit_ledger
 *  33. GET /admin/credits/monthly-preview — returns user summary with allowance applied
 *  34. GET /admin/credits/monthly-preview — wouldBlockCount uses current review balance
 *  35. GET /admin/credits/monthly-preview — userKey filter scopes to one user
 *  36. GET /admin/credits/monthly-preview — returns project summary
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { createApp } = await import("../dist/router.js");

const ADMIN_KEY = "test-credits-admin-key";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function makeDb(usageEvents = []) {
  const balances = new Map();  // key: `${userKey}:${creditType}` → { id, user_key, credit_type, balance, created_at, updated_at }
  const ledger = [];           // array of ledger rows
  const stored = [...usageEvents];

  function filterUsageByCutoff(cutoff) {
    return stored.filter((e) => e.created_at >= cutoff);
  }

  return {
    _balances: balances,
    _ledger: ledger,
    _usageEvents: stored,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              // UPSERT workspace_credit_balances
              if (sql.includes("INSERT INTO workspace_credit_balances") && sql.includes("ON CONFLICT")) {
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
              // INSERT workspace_credit_ledger
              if (sql.includes("INSERT INTO workspace_credit_ledger")) {
                const [id, userKey, projectId, creditType, amount, reason, metadataJson, createdAt] = args;
                ledger.push({ id, user_key: userKey, project_id: projectId, credit_type: creditType, amount, direction: "grant", reason, source_event_id: null, metadata_json: metadataJson, created_at: createdAt });
              }
            },
            async first() {
              // Allowance period count — SELECT COUNT(*) FROM workspace_usage_events (no GROUP BY)
              if (sql.includes("SELECT COUNT(*)") && sql.includes("FROM workspace_usage_events") && !sql.includes("GROUP BY")) {
                const [userKey, eventType] = args; // args[2]=periodStart, args[3]=periodEnd (ignored in mock)
                const count = stored.filter(e => e.user_key === userKey && e.event_type === eventType).length;
                return { count };
              }
              // SELECT balance from credit_balances
              if (sql.includes("SELECT balance FROM workspace_credit_balances")) {
                const [userKey, creditType] = args;
                const key = `${userKey}:${creditType}`;
                const row = balances.get(key);
                return row ? { balance: row.balance } : null;
              }
              // SELECT credit_type, balance, updated_at (single row for getCreditBalance)
              if (sql.includes("SELECT credit_type, balance, updated_at") && !sql.includes("ORDER BY")) {
                const [userKey, creditType] = args;
                return balances.get(`${userKey}:${creditType}`) ?? null;
              }
              return null;
            },
            async all() {
              // listCreditBalances — SELECT credit_type, balance, updated_at ... WHERE user_key = ?
              if (sql.includes("SELECT credit_type, balance, updated_at") && sql.includes("ORDER BY credit_type")) {
                const [userKey] = args;
                const results = [];
                for (const [key, row] of balances.entries()) {
                  if (key.startsWith(`${userKey}:`)) results.push(row);
                }
                return { results: results.sort((a, b) => a.credit_type.localeCompare(b.credit_type)) };
              }
              // listCreditLedger
              if (sql.includes("FROM workspace_credit_ledger") && sql.includes("WHERE user_key")) {
                const [userKey, limit] = args;
                const results = ledger
                  .filter((r) => r.user_key === userKey)
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .slice(0, limit ?? 50);
                return { results };
              }
                // Monthly user-level query — SELECT user_key, COUNT(*) as total_runs
              // Must come before preview handlers due to overlapping GROUP BY patterns
              if (sql.includes("as total_runs") && !sql.includes("project_id, COUNT")) {
                const userFilter = sql.includes("AND user_key = ?") ? args[2] : null;
                const userMap = new Map();
                for (const e of stored) {
                  if (e.event_type !== "workspace_pr_review_run") continue;
                  if (userFilter && e.user_key !== userFilter) continue;
                  userMap.set(e.user_key, (userMap.get(e.user_key) ?? 0) + 1);
                }
                const results = Array.from(userMap.entries())
                  .map(([user_key, total_runs]) => ({ user_key, total_runs }))
                  .sort((a, b) => b.total_runs - a.total_runs)
                  .slice(0, 50);
                return { results };
              }
              // Monthly project-level query — SELECT user_key, project_id, COUNT(*) as total_runs
              if (sql.includes("as total_runs") && sql.includes("project_id, COUNT")) {
                const userFilter = sql.includes("AND user_key = ?") ? args[2] : null;
                const projectMap = new Map();
                for (const e of stored) {
                  if (e.event_type !== "workspace_pr_review_run") continue;
                  if (userFilter && e.user_key !== userFilter) continue;
                  const k = `${e.user_key}|${e.project_id ?? ""}`;
                  const cur = projectMap.get(k) ?? { user_key: e.user_key, project_id: e.project_id ?? null, total_runs: 0 };
                  cur.total_runs++;
                  projectMap.set(k, cur);
                }
                return {
                  results: Array.from(projectMap.values())
                    .sort((a, b) => b.total_runs - a.total_runs)
                    .slice(0, 100),
                };
              }
              // previewCreditDebitFromUsageEvents — with userKey filter
              if (sql.includes("FROM workspace_usage_events") && sql.includes("AND user_key = ?")) {
                const [cutoff, userKey] = args;
                const rows = filterUsageByCutoff(cutoff).filter((e) => e.user_key === userKey);
                return { results: aggregateUsageRows(rows) };
              }
              // previewCreditDebitFromUsageEvents — without userKey filter
              if (sql.includes("FROM workspace_usage_events") && sql.includes("GROUP BY user_key")) {
                const [cutoff] = args;
                const rows = filterUsageByCutoff(cutoff);
                return { results: aggregateUsageRows(rows) };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

function aggregateUsageRows(rows) {
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

function makeUsageEvent(userKey, eventType, daysAgo = 1, projectId = null) {
  const d = new Date(Date.now() - daysAgo * 86400 * 1000);
  return { id: `e_${Math.random().toString(36).slice(2)}`, user_key: userKey, event_type: eventType, project_id: projectId, metadata_json: null, created_at: d.toISOString() };
}

function makeEnv(override = {}) {
  return { ENVIRONMENT: "test", ADMIN_USAGE_STATS_KEY: ADMIN_KEY, DB: makeDb(), ...override };
}

function makeEnvWithUsage(events, override = {}) {
  return { ENVIRONMENT: "test", ADMIN_USAGE_STATS_KEY: ADMIN_KEY, DB: makeDb(events), ...override };
}

function makeReviewEvents(userKey, count) {
  return Array.from({ length: count }, (_, i) => makeUsageEvent(userKey, "workspace_pr_review_run", (i + 1) * 0.1));
}

function req(method, path, body) {
  const app = createApp();
  const headers = { "x-admin-key": ADMIN_KEY };
  if (body) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    makeEnv(),
  );
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("admin credit endpoints", () => {
  it("01 — GET /admin/credits 503 when key not set", async () => {
    const env = makeEnv({ ADMIN_USAGE_STATS_KEY: undefined });
    const res = await reqWithEnv(env, "GET", "/admin/credits?userKey=u1", null);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "disabled");
  });

  it("02 — GET /admin/credits 401 on key mismatch", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost/admin/credits?userKey=u1", { headers: { "x-admin-key": "wrong" } }),
      makeEnv(),
    );
    assert.equal(res.status, 401);
  });

  it("03 — GET /admin/credits 400 when userKey missing", async () => {
    const res = await req("GET", "/admin/credits", null);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "userKey_required");
  });

  it("04 — GET /admin/credits returns empty array when no balances", async () => {
    const res = await req("GET", "/admin/credits?userKey=u1", null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.balances, []);
  });

  it("05 — POST /admin/credits/grant creates balance + ledger entry", async () => {
    const env = makeEnv();
    const res = await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 5, reason: "welcome grant",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.balance.balance, 5);
    assert.equal(body.balance.creditType, "review");
    assert.equal(body.ledgerEntry.direction, "grant");
    assert.equal(body.ledgerEntry.amount, 5);
    assert.equal(body.ledgerEntry.reason, "welcome grant");
  });

  it("06 — POST /admin/credits/grant second grant increments balance", async () => {
    const env = makeEnv();
    await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 3, reason: "first",
    });
    const res = await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 2, reason: "second",
    });
    const body = await res.json();
    assert.equal(body.balance.balance, 5);
  });

  it("07 — POST /admin/credits/grant rejects amount = 0", async () => {
    const res = await req("POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 0, reason: "test",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "amount_must_be_positive_integer");
  });

  it("08 — POST /admin/credits/grant rejects non-integer amount", async () => {
    const res = await req("POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 1.5, reason: "test",
    });
    assert.equal(res.status, 400);
  });

  it("09 — POST /admin/credits/grant rejects invalid creditType", async () => {
    const res = await req("POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "unknown", amount: 1, reason: "test",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "creditType_invalid");
  });

  it("10 — POST /admin/credits/grant rejects missing reason", async () => {
    const res = await req("POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 1, reason: "",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "reason_required");
  });

  it("11 — GET /admin/credits reflects granted balance", async () => {
    const env = makeEnv();
    await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 10, reason: "test",
    });
    const res = await reqWithEnv(env, "GET", "/admin/credits?userKey=u1", null);
    const body = await res.json();
    const reviewBalance = body.balances.find((b) => b.creditType === "review");
    assert.ok(reviewBalance);
    assert.equal(reviewBalance.balance, 10);
  });

  it("12 — GET /admin/credits/ledger returns entries", async () => {
    const env = makeEnv();
    await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 5, reason: "grant A",
    });
    await reqWithEnv(env, "POST", "/admin/credits/grant", {
      userKey: "u1", creditType: "review", amount: 3, reason: "grant B",
    });
    const res = await reqWithEnv(env, "GET", "/admin/credits/ledger?userKey=u1", null);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.entries.length, 2);
    assert.ok(body.entries.every((e) => e.direction === "grant"));
  });

  it("13 — GET /admin/credits/ledger 401 on missing key", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost/admin/credits/ledger?userKey=u1"),
      makeEnv(),
    );
    assert.equal(res.status, 401);
  });

  it("14 — GET /admin/credits/preview actualDebitsEnabled is false", async () => {
    const res = await req("GET", "/admin/credits/preview", null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.actualDebitsEnabled, false);
  });

  it("15 — preview maps workspace_pr_review_run to review credit (allowance exhausted)", async () => {
    // 7 events: 5 covered by allowance, 2 billable → estimatedAmount=2
    const env = makeEnvWithUsage(makeReviewEvents("u1", 7));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find((e) => e.eventType === "workspace_pr_review_run");
    assert.ok(entry, "entry present");
    assert.equal(entry.creditType, "review");
    assert.equal(entry.estimatedAmount, 2);
  });

  it("16 — preview does NOT include included events", async () => {
    const env = makeEnvWithUsage([
      makeUsageEvent("u1", "workspace_pr_comment_posted"),
      makeUsageEvent("u1", "workspace_telegram_notification_sent"),
    ]);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.deepEqual(body.previewEntries, []);
    assert.equal(body.totalEstimatedCredits, 0);
  });

  it("17 — preview totalEstimatedCredits sums billable events after allowance", async () => {
    // u1: 6 events (1 billable), u2: 7 events (2 billable), u1 included: 0
    const env = makeEnvWithUsage([
      ...makeReviewEvents("u1", 6),
      ...makeReviewEvents("u2", 7),
      makeUsageEvent("u1", "workspace_pr_comment_posted"), // 0 credit
    ]);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.totalEstimatedCredits, 3);
  });

  it("18 — preview userKey filter scopes to one user", async () => {
    // u1: 6 events (1 billable), u2: 7 events (2 billable) — filter to u1
    const env = makeEnvWithUsage([
      ...makeReviewEvents("u1", 6),
      ...makeReviewEvents("u2", 7),
    ]);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d&userKey=u1", null);
    const body = await res.json();
    assert.equal(body.totalEstimatedCredits, 1);
    assert.ok(body.previewEntries.every((e) => e.userKey === "u1"));
  });

  it("19 — preview empty when no billable events", async () => {
    const res = await req("GET", "/admin/credits/preview", null);
    assert.equal((await res.json()).totalEstimatedCredits, 0);
  });

  it("20 — preview invalid range defaults to 7d", async () => {
    const res = await req("GET", "/admin/credits/preview?range=bad", null);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.range, "7d");
  });

  it("21 — preview entry includes allowance field for pr_review_run", async () => {
    // 6 events: entry should include allowance metadata
    const env = makeEnvWithUsage(makeReviewEvents("u1", 6));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find((e) => e.eventType === "workspace_pr_review_run");
    assert.ok(entry, "entry present");
    assert.ok(entry.allowance, "allowance field present");
    assert.equal(entry.allowance.includedRuns, 5);
    assert.ok(entry.allowance.periodKey.match(/^\d{4}-\d{2}$/), `periodKey: ${entry.allowance.periodKey}`);
  });

  it("22 — estimatedAmount=0 when all events covered by allowance (3 events)", async () => {
    const env = makeEnvWithUsage(makeReviewEvents("u1", 3));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find((e) => e.eventType === "workspace_pr_review_run");
    // Entry still present (not filtered out), but estimatedAmount=0 since covered
    if (entry) {
      assert.equal(entry.estimatedAmount, 0);
      assert.ok(entry.allowance?.coveredByAllowance, "coveredByAllowance should be true");
    }
    assert.equal(body.totalEstimatedCredits, 0);
  });

  it("23 — estimatedAmount=1 when allowance exhausted (6 events)", async () => {
    const env = makeEnvWithUsage(makeReviewEvents("u1", 6));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    const entry = body.previewEntries.find((e) => e.eventType === "workspace_pr_review_run");
    assert.ok(entry, "entry present");
    assert.equal(entry.estimatedAmount, 1);
    assert.equal(body.totalEstimatedCredits, 1);
  });

  it("24 — totalEstimatedCredits correct after allowance with multiple users", async () => {
    // u1: 5 events (0 billable — exactly at limit), u2: 8 events (3 billable)
    const env = makeEnvWithUsage([
      ...makeReviewEvents("u1", 5),
      ...makeReviewEvents("u2", 8),
    ]);
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.totalEstimatedCredits, 3);
  });

  it("25 — preview includes allowanceSummary", async () => {
    const env = makeEnvWithUsage(makeReviewEvents("u1", 6));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.ok(body.allowanceSummary, "allowanceSummary present");
    assert.equal(body.allowanceSummary.enabled, true);
    assert.equal(typeof body.allowanceSummary.totalCoveredByAllowance, "number");
    assert.equal(typeof body.allowanceSummary.totalBillableAfterAllowance, "number");
    assert.ok(body.allowanceSummary.rule, "rule string present");
  });

  it("26 — allowanceSummary.totalBillableAfterAllowance matches totalEstimatedCredits", async () => {
    // 8 events: 5 covered, 3 billable
    const env = makeEnvWithUsage(makeReviewEvents("u1", 8));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.allowanceSummary.totalBillableAfterAllowance, body.totalEstimatedCredits);
    assert.equal(body.allowanceSummary.totalBillableAfterAllowance, 3);
  });

  it("27 — allowanceSummary.totalCoveredByAllowance counts covered events", async () => {
    // 8 total: 5 covered, 3 billable
    const env = makeEnvWithUsage(makeReviewEvents("u1", 8));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.allowanceSummary.totalCoveredByAllowance, 5);
  });

  it("28 — preview includes ledgerPreview array", async () => {
    const env = makeEnvWithUsage(makeReviewEvents("u1", 6));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.ok(Array.isArray(body.ledgerPreview), "ledgerPreview is array");
  });

  it("29 — ledgerPreview includes only events with estimatedAmount > 0", async () => {
    // 6 events: 1 billable
    const env = makeEnvWithUsage(makeReviewEvents("u1", 6));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.ledgerPreview.length, 1);
    assert.ok(body.ledgerPreview.every((e) => e.amount > 0));
  });

  it("30 — ledgerPreview excludes allowance-covered entries (3 events, all covered)", async () => {
    const env = makeEnvWithUsage(makeReviewEvents("u1", 3));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.equal(body.ledgerPreview.length, 0);
  });

  it("31 — ledgerPreview entries have direction=preview_debit", async () => {
    // 7 events: 2 billable
    const env = makeEnvWithUsage(makeReviewEvents("u1", 7));
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    const body = await res.json();
    assert.ok(body.ledgerPreview.length > 0, "ledgerPreview not empty");
    assert.ok(body.ledgerPreview.every((e) => e.direction === "preview_debit"));
  });

  it("32 — ledgerPreview does not write to workspace_credit_ledger (DB ledger stays empty)", async () => {
    const db = makeDb(makeReviewEvents("u1", 8));
    const env = { ENVIRONMENT: "test", ADMIN_USAGE_STATS_KEY: ADMIN_KEY, DB: db };
    const res = await reqWithEnv(env, "GET", "/admin/credits/preview?range=7d", null);
    assert.equal(res.status, 200);
    assert.equal(db._ledger.length, 0, "workspace_credit_ledger must remain empty");
  });

  it("33 — monthly-preview returns user summary with allowance applied", async () => {
    // 7 events: 5 covered, 2 billable
    const env = makeEnvWithUsage(makeReviewEvents("u1", 7));
    const res = await reqWithEnv(env, "GET", "/admin/credits/monthly-preview", null);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.actualDebitsEnabled, false);
    assert.ok(Array.isArray(body.users), "users array present");
    const u1 = body.users.find((u) => u.userKey === "u1");
    assert.ok(u1, "u1 in users");
    assert.equal(u1.totalPrReviewRuns, 7);
    assert.equal(u1.coveredByAllowance, 5);
    assert.equal(u1.billableRuns, 2);
    assert.equal(u1.estimatedReviewCredits, 2);
  });

  it("34 — monthly-preview wouldBlockCount uses current review balance", async () => {
    // u1: 8 total, 3 billable. Grant balance=1. wouldBlockCount = max(0, 3-1) = 2
    const db = makeDb(makeReviewEvents("u1", 8));
    const env = { ENVIRONMENT: "test", ADMIN_USAGE_STATS_KEY: ADMIN_KEY, DB: db };
    await reqWithEnv(env, "POST", "/admin/credits/grant", { userKey: "u1", creditType: "review", amount: 1, reason: "test" });
    const res = await reqWithEnv(env, "GET", "/admin/credits/monthly-preview", null);
    const body = await res.json();
    const u1 = body.users.find((u) => u.userKey === "u1");
    assert.ok(u1);
    assert.equal(u1.currentReviewBalance, 1);
    assert.equal(u1.wouldBlockCount, 2);
  });

  it("35 — monthly-preview with userKey filter scopes to one user", async () => {
    const env = makeEnvWithUsage([
      ...makeReviewEvents("u1", 6),
      ...makeReviewEvents("u2", 7),
    ]);
    const res = await reqWithEnv(env, "GET", "/admin/credits/monthly-preview?userKey=u1", null);
    const body = await res.json();
    assert.ok(body.users.every((u) => u.userKey === "u1"), "only u1 in users");
    assert.equal(body.users[0].billableRuns, 1);
  });

  it("36 — monthly-preview returns project summary", async () => {
    const events = [
      ...Array.from({ length: 4 }, (_, i) => makeUsageEvent("u1", "workspace_pr_review_run", i + 1, "proj-a")),
      ...Array.from({ length: 3 }, (_, i) => makeUsageEvent("u1", "workspace_pr_review_run", i + 1, "proj-b")),
    ];
    const env = makeEnvWithUsage(events);
    const res = await reqWithEnv(env, "GET", "/admin/credits/monthly-preview", null);
    const body = await res.json();
    assert.ok(Array.isArray(body.projects), "projects array present");
    const totalProjectRuns = body.projects.reduce((s, p) => s + p.totalPrReviewRuns, 0);
    assert.equal(totalProjectRuns, 7, "all runs accounted in projects");
    // u1: 7 total, 2 billable
    const totalBillable = body.projects.reduce((s, p) => s + p.billableRuns, 0);
    assert.ok(totalBillable >= 1 && totalBillable <= 2, `total billable ${totalBillable} within expected range`);
  });
});
