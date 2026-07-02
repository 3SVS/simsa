/**
 * workspace-credits.ts
 *
 * Stage 33: user-facing credit endpoints.
 * No admin key required — caller provides their own userKey.
 *
 * GET  /workspace/credits?userKey=...                  — balance + allowance summary
 * POST /workspace/credits/top-up-requests              — create top-up request
 * GET  /workspace/credits/top-up-requests?userKey=...  — list user's requests
 *
 * These endpoints expose only per-user summary data.
 * Ledger rows, sourceEventId, and internal status are NOT exposed.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { listCreditBalances } from "../workspace/credits.js";
import type { CreditType } from "../workspace/credits.js";
import { getAllowanceDryRun } from "../workspace/allowance-usage.js";
import { getMarketplaceEntitlement } from "../workspace/marketplace-entitlement.js";
import { getCreditExecutionConfig, isActualDebitAllowedForUser } from "../workspace/credit-config.js";
import {
  createTopUpRequest,
  listTopUpRequests,
} from "../workspace/credit-topup.js";

const VALID_CREDIT_TYPES: CreditType[] = ["review", "fix", "workspace"];

export function createWorkspaceCreditsRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Stage 91: browser-facing CORS (preflight + headers on every response).
  app.use("*", corsMiddleware);

  /**
   * GET /workspace/credits?userKey=...
   * Returns balance + monthly allowance summary for a user.
   * Does NOT expose ledger rows, sourceEventId, or internal status.
   */
  app.get("/workspace/credits", async (c) => {
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const config = getCreditExecutionConfig(c.env);
      const actualDebitAllowedForUser = isActualDebitAllowedForUser(config, userKey);

      const rawBalances = await listCreditBalances(c.env, userKey);

      // Build labeled balance list; ensure review credit always present
      const balances: Array<{ creditType: CreditType; label: string; balance: number }> = rawBalances.map((b) => ({
        creditType: b.creditType,
        label: b.creditType === "review"
          ? "Review credit"
          : b.creditType === "fix"
          ? "Fix credit"
          : "Workspace credit",
        balance: b.balance,
      }));
      if (!balances.some((b) => b.creditType === "review")) {
        balances.unshift({ creditType: "review", label: "Review credit", balance: 0 });
      }

      // Paid GitHub Marketplace plan raises the monthly included runs.
      // getMarketplaceEntitlement is fail-safe (any error → null → base allowance).
      const entitlement = await getMarketplaceEntitlement(c.env, userKey);

      const allowanceDryRun = await getAllowanceDryRun({
        env: c.env,
        userKey,
        eventType: "workspace_pr_review_run",
        entitlement,
      });

      return c.json({
        ok: true,
        userKey,
        balances,
        allowance: {
          review: {
            period: "monthly" as const,
            periodKey: allowanceDryRun?.periodKey ?? "",
            includedRuns: allowanceDryRun?.includedRuns ?? 5,
            usedThisPeriod: allowanceDryRun?.usedThisPeriod ?? 0,
            remainingIncludedRuns: allowanceDryRun?.remainingIncludedRuns ?? 5,
          },
        },
        ...(entitlement ? { entitlement } : {}),
        actualDebitsEnabled: config.actualDebitsEnabled,
        actualDebitAllowedForUser,
      });
    } catch (err) {
      console.error("[workspace/credits] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  /**
   * POST /workspace/credits/top-up-requests
   * Body: { userKey, creditType?, requestedAmount, note? }
   * Creates a pending top-up request. Admin fulfills via /admin/credits/top-up-requests/:id/fulfill.
   */
  app.post("/workspace/credits/top-up-requests", async (c) => {
    let body: { userKey?: string; creditType?: string; requestedAmount?: unknown; note?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const { userKey, creditType, note } = body;
    const requestedAmount = body.requestedAmount;

    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    if (typeof requestedAmount !== "number") {
      return c.json({ ok: false, error: "requestedAmount_required" }, 400);
    }
    if (creditType !== undefined && !VALID_CREDIT_TYPES.includes(creditType as CreditType)) {
      return c.json({ ok: false, error: "invalid_credit_type" }, 400);
    }

    try {
      const result = await createTopUpRequest(c.env, {
        userKey,
        creditType: (creditType as CreditType | undefined) ?? "review",
        requestedAmount,
        note,
      });

      if (!result.ok) {
        if (result.error === "too_many_open_requests") {
          return c.json({
            ok: false,
            error: result.error,
            message: "최대 3개의 충전 요청만 동시에 진행할 수 있어요.",
          }, 429);
        }
        if (result.error === "invalid_amount") {
          return c.json({
            ok: false,
            error: result.error,
            message: "충전 요청 금액은 1 이상 100 이하여야 해요.",
          }, 400);
        }
        return c.json({ ok: false, error: result.error }, 400);
      }

      return c.json({ ok: true, request: result.request }, 201);
    } catch (err) {
      console.error("[workspace/credits/top-up-requests POST] failed:", err);
      return c.json({ ok: false, error: "create_failed" }, 500);
    }
  });

  /**
   * GET /workspace/credits/top-up-requests?userKey=...
   * Returns the user's own top-up request history (max 20, latest first).
   * Does NOT expose other users' requests.
   */
  app.get("/workspace/credits/top-up-requests", async (c) => {
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const requests = await listTopUpRequests(c.env, userKey);
      return c.json({ ok: true, requests });
    } catch (err) {
      console.error("[workspace/credits/top-up-requests GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  return app;
}
