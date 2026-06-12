/**
 * workspace-admin-credits.ts
 *
 * Admin-only credit management endpoints.
 * Auth: x-admin-key header must match ADMIN_USAGE_STATS_KEY env secret.
 *
 * GET  /admin/credits?userKey=...          — list balances for a user
 * POST /admin/credits/grant               — manually grant credits
 * GET  /admin/credits/ledger?userKey=...  — list ledger entries for a user
 * GET  /admin/credits/preview?range=...   — dry-run preview (no writes)
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
  previewCreditDebitFromUsageEvents,
} from "../workspace/credits.js";
import type { CreditType } from "../workspace/credits.js";

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

      return c.json({
        ok: true,
        actualDebitsEnabled: false,
        range,
        totalEstimatedCredits,
        previewEntries,
        enforcementPreview: {
          actualDebitsEnabled: false,
          wouldBlockCount,
          checkedEventCount: previewEntries.length,
        },
      });
    } catch (err) {
      console.error("[admin/credits/preview] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  return app;
}
