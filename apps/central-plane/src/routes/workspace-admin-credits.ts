/**
 * workspace-admin-credits.ts
 *
 * Admin-only credit management endpoints.
 * Auth: x-admin-key header must match ADMIN_USAGE_STATS_KEY env secret.
 *
 * GET  /admin/credits?userKey=...                      — list balances for a user
 * POST /admin/credits/grant                            — manually grant credits
 * GET  /admin/credits/ledger?userKey=...               — list ledger entries for a user
 * GET  /admin/credits/preview?range=...                — dry-run preview (no writes)
 * GET  /admin/credits/monthly-preview?month=YYYY-MM    — monthly allowance + credit breakdown
 *
 * No credit deduction on feature execution.
 * actualDebitsEnabled is always false.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import {
  listCreditBalances,
  listCreditLedger,
  grantCredits,
  getCreditBalance,
  previewCreditDebitFromUsageEvents,
  buildLedgerPreview,
} from "../workspace/credits.js";
import type { CreditType } from "../workspace/credits.js";
import {
  getMonthlyAllowanceRule,
  getCurrentAllowancePeriod,
  getPeriodFromMonthKey,
} from "../workspace/allowance-rules.js";

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authGuard(env: Env, provided: string): { ok: false; status: 503 | 401 } | { ok: true } {
  if (!env.ADMIN_USAGE_STATS_KEY) return { ok: false, status: 503 };
  if (provided !== env.ADMIN_USAGE_STATS_KEY) return { ok: false, status: 401 };
  return { ok: true };
}

const VALID_CREDIT_TYPES: CreditType[] = ["review", "fix", "workspace"];

// ─── Route factory ────────────────────────────────────────────────────────────

export function createWorkspaceAdminCreditsRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  /**
   * GET /admin/credits?userKey=...
   * Returns all credit balances for the given user.
   */
  app.get("/admin/credits", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const balances = await listCreditBalances(c.env, userKey);
      return c.json({ ok: true, userKey, balances });
    } catch (err) {
      console.error("[admin/credits] listBalances failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  /**
   * POST /admin/credits/grant
   * Body: { userKey, creditType, amount, reason }
   */
  app.post("/admin/credits/grant", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const b = body as Record<string, unknown>;
    const userKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    const creditType = typeof b["creditType"] === "string" ? b["creditType"] : "";
    const amount = typeof b["amount"] === "number" ? b["amount"] : NaN;
    const reason = typeof b["reason"] === "string" ? b["reason"].trim() : "";

    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    if (!VALID_CREDIT_TYPES.includes(creditType as CreditType))
      return c.json({ ok: false, error: "creditType_invalid", validTypes: VALID_CREDIT_TYPES }, 400);
    if (!Number.isInteger(amount) || amount <= 0)
      return c.json({ ok: false, error: "amount_must_be_positive_integer" }, 400);
    if (!reason)
      return c.json({ ok: false, error: "reason_required" }, 400);

    try {
      const result = await grantCredits(c.env, {
        userKey,
        creditType: creditType as CreditType,
        amount,
        reason,
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[admin/credits/grant] failed:", err);
      return c.json({ ok: false, error: "grant_failed", details: msg }, 500);
    }
  });

  /**
   * GET /admin/credits/ledger?userKey=...&limit=50
   */
  app.get("/admin/credits/ledger", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const limitRaw = parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    try {
      const entries = await listCreditLedger(c.env, userKey, limit);
      return c.json({ ok: true, userKey, entries });
    } catch (err) {
      console.error("[admin/credits/ledger] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  /**
   * GET /admin/credits/preview?range=24h|7d|30d&userKey=...
   * Dry-run preview of estimated debits from usage events.
   * Does NOT write to the ledger.
   * Stage 23: adds allowanceSummary, enforcementSummary, ledgerPreview.
   */
  app.get("/admin/credits/preview", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const rawRange = c.req.query("range") ?? "7d";
    const range = (["24h", "7d", "30d"] as const).includes(rawRange as "24h" | "7d" | "30d")
      ? rawRange as "24h" | "7d" | "30d"
      : "7d";
    const userKey = c.req.query("userKey") || undefined;

    try {
      const previewEntries = await previewCreditDebitFromUsageEvents(c.env, { range, userKey });
      const totalEstimatedCredits = previewEntries.reduce((s, e) => s + e.estimatedAmount, 0);
      const wouldBlockCount = previewEntries.filter((e) => e.wouldBlockIfEnforced).length;

      // Allowance summary — counts covered vs. billable events
      const totalCoveredByAllowance = previewEntries.reduce((sum, e) => {
        if (e.allowance != null && e.rawEventCount != null) {
          return sum + Math.max(0, e.rawEventCount - e.estimatedAmount);
        }
        return sum;
      }, 0);
      const allowanceSummary = {
        enabled: true as const,
        rule: "월 5회 PR 코드 확인 무료",
        totalCoveredByAllowance,
        totalBillableAfterAllowance: totalEstimatedCredits,
      };

      // Ledger preview — one entry per billable aggregated row (no DB writes)
      const ledgerPreview = buildLedgerPreview(previewEntries);

      const enforcementData = {
        actualDebitsEnabled: false as const,
        wouldBlockCount,
        checkedEventCount: previewEntries.length,
      };

      return c.json({
        ok: true,
        actualDebitsEnabled: false as const,
        range,
        totalEstimatedCredits,
        allowanceSummary,
        previewEntries,
        enforcementPreview: enforcementData,    // kept for backwards compat
        enforcementSummary: enforcementData,     // Stage 23 name
        ledgerPreview,
      });
    } catch (err) {
      console.error("[admin/credits/preview] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  /**
   * GET /admin/credits/monthly-preview?month=YYYY-MM&userKey=...
   * Per-user and per-project allowance + credit breakdown for a calendar month.
   * Reads only — no DB writes, no actual debits.
   */
  app.get("/admin/credits/monthly-preview", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const monthParam = c.req.query("month");
    const userKeyFilter = c.req.query("userKey") || undefined;

    let period: { periodKey: string; periodStart: string; periodEnd: string };
    if (monthParam) {
      const p = getPeriodFromMonthKey(monthParam);
      if (!p) return c.json({ ok: false, error: "month_invalid" }, 400);
      period = p;
    } else {
      period = getCurrentAllowancePeriod();
    }

    const { periodKey, periodStart, periodEnd } = period;

    try {
      type UserRunRow = { user_key: string; total_runs: number };
      type ProjectRunRow = { user_key: string; project_id: string | null; total_runs: number };

      const [userResult, projectResult] = await Promise.all([
        (userKeyFilter
          ? c.env.DB.prepare(
              `SELECT user_key, COUNT(*) as total_runs
               FROM workspace_usage_events
               WHERE event_type = 'workspace_pr_review_run'
                 AND created_at >= ? AND created_at < ? AND user_key = ?
               GROUP BY user_key
               ORDER BY total_runs DESC
               LIMIT 50`,
            ).bind(periodStart, periodEnd, userKeyFilter)
          : c.env.DB.prepare(
              `SELECT user_key, COUNT(*) as total_runs
               FROM workspace_usage_events
               WHERE event_type = 'workspace_pr_review_run'
                 AND created_at >= ? AND created_at < ?
               GROUP BY user_key
               ORDER BY total_runs DESC
               LIMIT 50`,
            ).bind(periodStart, periodEnd)
        ).all<UserRunRow>(),

        (userKeyFilter
          ? c.env.DB.prepare(
              `SELECT user_key, project_id, COUNT(*) as total_runs
               FROM workspace_usage_events
               WHERE event_type = 'workspace_pr_review_run'
                 AND created_at >= ? AND created_at < ? AND user_key = ?
               GROUP BY user_key, project_id
               ORDER BY total_runs DESC
               LIMIT 100`,
            ).bind(periodStart, periodEnd, userKeyFilter)
          : c.env.DB.prepare(
              `SELECT user_key, project_id, COUNT(*) as total_runs
               FROM workspace_usage_events
               WHERE event_type = 'workspace_pr_review_run'
                 AND created_at >= ? AND created_at < ?
               GROUP BY user_key, project_id
               ORDER BY total_runs DESC
               LIMIT 100`,
            ).bind(periodStart, periodEnd)
        ).all<ProjectRunRow>(),
      ]);

      const userRows = userResult.results ?? [];
      const projectRows = projectResult.results ?? [];

      const INCLUDED_RUNS = 5;

      // Fetch current review balances for all users in parallel
      const balanceMap = new Map<string, number>();
      await Promise.all(
        userRows.map(async (r) => {
          try {
            const bal = await getCreditBalance(c.env, r.user_key, "review");
            balanceMap.set(r.user_key, bal?.balance ?? 0);
          } catch {
            balanceMap.set(r.user_key, 0);
          }
        }),
      );

      // Per-user summaries with exact allowance calculation
      const users = userRows.map((r) => {
        const totalRuns = r.total_runs;
        const coveredByAllowance = Math.min(INCLUDED_RUNS, totalRuns);
        const billableRuns = Math.max(0, totalRuns - coveredByAllowance);
        const currentBalance = balanceMap.get(r.user_key) ?? 0;
        return {
          userKey: r.user_key,
          totalPrReviewRuns: totalRuns,
          coveredByAllowance,
          billableRuns,
          estimatedReviewCredits: billableRuns,     // creditCost=1
          currentReviewBalance: currentBalance,
          wouldBlockCount: Math.max(0, billableRuns - currentBalance),
        };
      });

      // Per-project summaries — distribute user's billable runs proportionally
      const userBillableMap = new Map(
        users.map((u) => [u.userKey, { billable: u.billableRuns, total: u.totalPrReviewRuns }]),
      );

      const projectMap = new Map<string, { totalRuns: number; estimatedBillable: number }>();
      for (const r of projectRows) {
        const pid = r.project_id ?? "(no project)";
        const userInfo = userBillableMap.get(r.user_key);
        let projectBillable = 0;
        if (userInfo && userInfo.total > 0) {
          projectBillable = Math.round(r.total_runs * (userInfo.billable / userInfo.total));
        }
        const cur = projectMap.get(pid) ?? { totalRuns: 0, estimatedBillable: 0 };
        projectMap.set(pid, {
          totalRuns: cur.totalRuns + r.total_runs,
          estimatedBillable: cur.estimatedBillable + projectBillable,
        });
      }

      const projects = Array.from(projectMap.entries())
        .map(([projectId, info]) => ({
          projectId,
          totalPrReviewRuns: info.totalRuns,
          billableRuns: info.estimatedBillable,
          estimatedReviewCredits: info.estimatedBillable,
        }))
        .sort((a, b) => b.totalPrReviewRuns - a.totalPrReviewRuns);

      const allowanceRule = getMonthlyAllowanceRule("workspace_pr_review_run");

      return c.json({
        ok: true,
        actualDebitsEnabled: false as const,
        month: periodKey,
        ...(userKeyFilter ? { userKey: userKeyFilter } : {}),
        allowanceRule: {
          eventType: "workspace_pr_review_run",
          includedRuns: allowanceRule?.includedRuns ?? INCLUDED_RUNS,
          creditType: "review",
        },
        users,
        projects,
      });
    } catch (err) {
      console.error("[admin/credits/monthly-preview] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  return app;
}
