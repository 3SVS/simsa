/**
 * workspace-admin-credits.ts
 *
 * Admin-only credit management endpoints.
 * Auth: x-admin-key header must match ADMIN_USAGE_STATS_KEY env secret.
 *
 * GET  /admin/credits?userKey=...                        — list balances for a user
 * POST /admin/credits/grant                              — manually grant credits
 * GET  /admin/credits/ledger?userKey=...                 — list ledger entries for a user
 * GET  /admin/credits/preview?range=...                  — dry-run preview (no writes)
 * GET  /admin/credits/monthly-preview?month=YYYY-MM      — monthly allowance + credit breakdown
 * GET  /admin/credits/pending?olderThanMinutes=15        — list old pending debit rows
 * POST /admin/credits/pending/:id/mark-failed            — manually mark pending as failed
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
  listPendingCreditLedgerEntries,
  markPendingCreditLedgerFailed,
} from "../workspace/credits.js";
import type { CreditType } from "../workspace/credits.js";
import {
  getMonthlyAllowanceRule,
  getCurrentAllowancePeriod,
  getPeriodFromMonthKey,
} from "../workspace/allowance-rules.js";
import { getCreditExecutionConfig } from "../workspace/credit-config.js";

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
   * GET /admin/credits/config
   * Returns the current credit execution feature flag state.
   * No DB queries — reads env vars only.
   */
  app.get("/admin/credits/config", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const config = getCreditExecutionConfig(c.env);
    const allowlistPreview = config.actualDebitAllowedUserKeys.slice(0, 5);
    return c.json({
      ok: true,
      actualDebitsEnabled: config.actualDebitsEnabled,
      blockingEnabled: config.blockingEnabled,
      envFlags: {
        ENABLE_ACTUAL_CREDIT_DEBITS: c.env.ENABLE_ACTUAL_CREDIT_DEBITS ?? "(unset)",
        ENABLE_CREDIT_BLOCKING: c.env.ENABLE_CREDIT_BLOCKING ?? "(unset)",
        ACTUAL_DEBIT_ALLOWED_USER_KEYS:
          c.env.ACTUAL_DEBIT_ALLOWED_USER_KEYS !== undefined
            ? c.env.ACTUAL_DEBIT_ALLOWED_USER_KEYS === ""
              ? "(empty)"
              : `(${config.actualDebitAllowedUserKeys.length} entries, set)`
            : "(unset)",
      },
      limitedRollout: {
        enabled: config.actualDebitsEnabled && config.actualDebitAllowedUserKeys.length > 0,
        allowedUserKeyCount: config.actualDebitAllowedUserKeys.length,
        allowedUserKeysPreview: allowlistPreview,
      },
    });
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

  /**
   * GET /admin/credits/pending?olderThanMinutes=15&limit=50
   * Lists debit ledger entries still in status='pending' after the given age threshold.
   * Read-only — no balance changes.
   */
  app.get("/admin/credits/pending", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const rawMinutes = c.req.query("olderThanMinutes");
    const rawLimit = c.req.query("limit");
    const olderThanMinutes = rawMinutes ? Math.max(1, parseInt(rawMinutes, 10) || 15) : 15;
    const limit = rawLimit ? Math.min(200, Math.max(1, parseInt(rawLimit, 10) || 50)) : 50;

    try {
      const entries = await listPendingCreditLedgerEntries(c.env, { olderThanMinutes, limit });
      return c.json({ ok: true as const, olderThanMinutes, entries });
    } catch (err) {
      console.error("[admin/credits/pending] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  /**
   * POST /admin/credits/pending/:ledgerEntryId/mark-failed
   * Marks a pending debit ledger entry as failed.
   * CRITICAL: Does NOT modify workspace_credit_balances. Balance-neutral operation.
   */
  app.post("/admin/credits/pending/:ledgerEntryId/mark-failed", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const ledgerEntryId = c.req.param("ledgerEntryId");
    if (!ledgerEntryId || ledgerEntryId.trim() === "") {
      return c.json({ ok: false, error: "missing_ledger_entry_id" }, 400);
    }

    let body: { adminReason?: string } = {};
    try {
      body = await c.req.json<{ adminReason?: string }>();
    } catch { /* allow missing body */ }

    const adminReason = typeof body.adminReason === "string" && body.adminReason.trim()
      ? body.adminReason.trim()
      : "manual admin cleanup";

    try {
      const result = await markPendingCreditLedgerFailed(c.env, { ledgerEntryId, adminReason });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 409;
        return c.json({ ok: false, error: result.error }, status);
      }
      return c.json({ ok: true as const, entry: result.entry });
    } catch (err) {
      console.error("[admin/credits/pending/mark-failed] failed:", err);
      return c.json({ ok: false, error: "update_failed" }, 500);
    }
  });

  /**
   * GET /admin/credits/rollout-checklist
   * Returns a structured checklist for verifying credit system readiness before production enablement.
   * Read-only — never activates production debits.
   */
  app.get("/admin/credits/rollout-checklist", async (c) => {
    const guard = authGuard(c.env, c.req.header("x-admin-key") ?? "");
    if (!guard.ok) {
      return c.json(
        { ok: false, error: guard.status === 503 ? "disabled" : "unauthorized" },
        guard.status,
      );
    }

    const config = getCreditExecutionConfig(c.env);
    const safeForProductionDefault = !config.actualDebitsEnabled && !config.blockingEnabled;

    const requiredChecks = [
      {
        id: "feature-flags-off",
        label: "Feature flags: 두 flag 모두 false",
        status: safeForProductionDefault ? ("passed" as const) : ("warning" as const),
        description:
          "ENABLE_ACTUAL_CREDIT_DEBITS 및 ENABLE_CREDIT_BLOCKING이 wrangler.toml에서 \"false\" 상태여야 합니다.",
      },
      {
        id: "migration-applied",
        label: "Migration 0037 배포됨",
        status: "manual" as const,
        description:
          "workspace_credit_ledger 테이블의 status 컬럼이 D1에 존재하는지 확인 (pnpm migrate:apply --remote 실행 여부).",
      },
      {
        id: "dry-run-preview",
        label: "Dry-run preview 정상 동작",
        status: "manual" as const,
        description:
          "GET /admin/credits/preview?range=7d 호출 시 ok:true, actualDebitsEnabled:false 반환 확인.",
      },
      {
        id: "idempotency-key-validation",
        label: "Idempotency key 검증 통과",
        status: "manual" as const,
        description:
          "POST /workspace/github/review 호출 시 Idempotency-Key 헤더 없으면 자동 생성, 잘못된 형식이면 400 반환 확인.",
      },
      {
        id: "duplicate-debit-blocked",
        label: "중복 차감 방지 확인",
        status: "manual" as const,
        description:
          "같은 Idempotency-Key로 PR review를 두 번 요청하면 두 번째는 duplicate:true 반환 (잔액 변경 없음) 확인.",
      },
      {
        id: "pending-ledger-review",
        label: "Pending 상태 장부 점검",
        status: "manual" as const,
        description:
          "GET /admin/credits/pending 에서 오래된 pending 항목 확인. status=pending이 오래 유지되면 중간 실패 가능성 있음. mark-failed로 수동 정리 가능.",
      },
      {
        id: "pending-cleanup-available",
        label: "Pending cleanup 기능 사용 가능",
        status: "passed" as const,
        description:
          "GET /admin/credits/pending + POST .../mark-failed 엔드포인트가 정상 동작하는지 확인됨. Balance 변경 없이 수동 정리 가능.",
      },
      {
        id: "actual-debit-allowlist-configured",
        label: "Actual debit allowlist 설정",
        status: (!config.actualDebitsEnabled
          ? ("manual" as const)
          : config.actualDebitAllowedUserKeys.length > 0
          ? ("passed" as const)
          : ("blocked" as const)),
        description:
          "ACTUAL_DEBIT_ALLOWED_USER_KEYS에 허용된 userKey가 최소 1개 이상 설정되어야 합니다. 비어 있으면 actualDebitsEnabled=true여도 실제 차감이 수행되지 않습니다.",
      },
      {
        id: "internal-actual-debit-test-run",
        label: "내부 userKey actual debit 테스트 실행",
        status: "manual" as const,
        description:
          "허용된 내부 userKey로 actual debit flag를 켜고 allowance/debit/ledger/balance 흐름을 검증해야 합니다. 테스트 후 ENABLE_ACTUAL_CREDIT_DEBITS를 반드시 false로 복구하세요.",
      },
    ];

    const recommendedScenarios = [
      {
        id: "safe-mode",
        label: "안전 모드 (현행 기본값)",
        flags: { actualDebitsEnabled: false, blockingEnabled: false },
        expectedOutcome:
          "모든 PR review 실행 허용. 크레딧 차감 및 차단 없음. 장부 기록은 grant 한정.",
      },
      {
        id: "debits-only",
        label: "차감만 활성 (비차단 과금)",
        flags: { actualDebitsEnabled: true, blockingEnabled: false },
        expectedOutcome:
          "PR review 실행 허용. 크레딧 차감됨. 잔액 부족 시에도 실행 허용 (차단 없음).",
      },
      {
        id: "full-enforcement",
        label: "차감 + 차단 (완전 적용)",
        flags: { actualDebitsEnabled: true, blockingEnabled: true },
        expectedOutcome:
          "PR review 실행 허용. 크레딧 차감됨. 잔액 부족 시 HTTP 402 반환 및 실행 차단.",
      },
    ];

    const productionEnableCriteria = [
      "모든 requiredChecks의 manual 항목을 운영자가 수동으로 확인했습니까?",
      "ENABLE_ACTUAL_CREDIT_DEBITS를 \"true\"로 변경하기 전 wrangler deploy로 배포 완료 여부 확인",
      "첫 번째 실제 debit 후 /admin/credits/ledger 에서 status=applied인 항목 확인",
      "잔액 부족 사용자에게 수동으로 크레딧 지급 (POST /admin/credits/grant) 할 준비 완료",
      "ENABLE_CREDIT_BLOCKING은 ENABLE_ACTUAL_CREDIT_DEBITS 활성 + 크레딧 충전 UX 완성 후에만 활성화",
      "status=pending 장부 항목 장기 잔류 모니터링 방법 수립",
      "오래된 pending ledger를 /admin/credits/pending 에서 조회하고 mark-failed로 수동 정리할 수 있어야 한다",
      "ACTUAL_DEBIT_ALLOWED_USER_KEYS에 테스트 대상 userKey 등록 후 ENABLE_ACTUAL_CREDIT_DEBITS 활성화",
      "내부 userKey actual debit test run이 성공해야 한다 (Stage 32 검증 문서 참고)",
    ];

    return c.json({
      ok: true as const,
      productionSafety: {
        actualDebitsEnabled: config.actualDebitsEnabled,
        blockingEnabled: config.blockingEnabled,
        safeForProductionDefault,
      },
      requiredChecks,
      recommendedScenarios,
      productionEnableCriteria,
    });
  });

  return app;
}
