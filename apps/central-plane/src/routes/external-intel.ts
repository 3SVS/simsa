/**
 * External-intel routes.
 *
 * Public read for the CLI's RAG inject path:
 *   GET /seeds/external-intel/:domain  → { domain, answer_keys[], failures[] }
 *
 * Admin triggers (INTERNAL_CALLBACK_TOKEN):
 *   POST /admin/run-cve-advisory-miner
 *   POST /admin/run-mcp-registry-miner
 *   POST /admin/run-shadcn-block-miner
 *   POST /admin/run-awesome-list-miner
 *
 * Each miner's weekly/daily cron in src/index.ts calls the runner
 * directly; these admin endpoints are for manual one-off catch-up runs.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { listIntelForDomain } from "../external-intel.js";
import { runCveAdvisoryMiner } from "../cve-advisory-miner.js";
import { runMcpRegistryMiner } from "../mcp-registry-miner.js";
import { runShadcnBlockMiner } from "../shadcn-block-miner.js";
import { runAwesomeListMiner } from "../awesome-list-miner.js";
import { runDeployTrendWatcher } from "../deploy-trend-watcher.js";
import { runReengageNudges } from "../workspace/reengage.js";

function requireInternalToken(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false as const, status: 503 as const, error: "admin_disabled" };
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || m[1] !== expected) return { ok: false as const, status: 401 as const, error: "unauthorized" };
  return { ok: true as const };
}

export function createExternalIntelRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/seeds/external-intel/:domain", async (c) => {
    const domain = c.req.param("domain");
    if (domain !== "code" && domain !== "design") {
      return c.json(
        { error: "invalid_domain", error_description: "domain must be 'code' or 'design'" },
        400,
      );
    }
    const limitRaw = c.req.query("limit");
    const limit = Math.max(1, Math.min(200, Number.parseInt(limitRaw ?? "50", 10) || 50));
    const intel = await listIntelForDomain(c.env, domain, limit);
    return c.json({
      domain,
      answer_keys: intel.answer_keys,
      failures: intel.failures,
      counts: {
        answer_keys: intel.answer_keys.length,
        failures: intel.failures.length,
      },
    });
  });

  app.post("/admin/run-cve-advisory-miner", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runCveAdvisoryMiner(c.env);
    return c.json(result);
  });

  app.post("/admin/run-mcp-registry-miner", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runMcpRegistryMiner(c.env);
    return c.json(result);
  });

  app.post("/admin/run-shadcn-block-miner", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runShadcnBlockMiner(c.env);
    return c.json(result);
  });

  app.post("/admin/run-awesome-list-miner", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runAwesomeListMiner(c.env);
    return c.json(result);
  });

  // ── D14: deploy/service trend review queue ─────────────────────────────────
  // The watcher only FILLS the queue; a human reviews and edits
  // workspace/service-examples.ts, then marks rows applied/dismissed.

  app.post("/admin/run-deploy-trend-watcher", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runDeployTrendWatcher(c.env);
    return c.json(result);
  });

  // G1 — 복귀 넛지 수동 실행 (크론과 동일 로직; 라이브 실증·캐치업용).
  app.post("/admin/run-reengage", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const result = await runReengageNudges(c.env);
    return c.json(result);
  });

  app.get("/admin/deploy-trends", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const status = c.req.query("status") ?? "pending";
    const rows = await c.env.DB.prepare(
      `SELECT * FROM deploy_trend_suggestions WHERE status = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(status)
      .all()
      .catch(() => ({ results: [] }));
    return c.json({ ok: true, status, suggestions: rows.results ?? [] });
  });

  app.post("/admin/deploy-trends/:id/status", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);
    const id = c.req.param("id");
    let body: { status?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const status = body.status;
    if (status !== "applied" && status !== "dismissed" && status !== "pending") {
      return c.json({ ok: false, error: "status must be applied | dismissed | pending" }, 400);
    }
    const r = await c.env.DB.prepare(`UPDATE deploy_trend_suggestions SET status = ? WHERE id = ?`)
      .bind(status, id)
      .run()
      .catch(() => null);
    if (!r || r.meta.changes === 0) return c.json({ ok: false, error: "not_found" }, 404);
    return c.json({ ok: true, id, status });
  });

  return app;
}
