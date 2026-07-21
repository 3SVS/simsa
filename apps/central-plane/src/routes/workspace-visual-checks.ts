/**
 * workspace-visual-checks.ts — Stage 261
 *
 * Simsa visual completion-check runs: persisted reports + R2 evidence.
 *
 * POST /workspace/projects/:id/visual-checks                        — save a run (report + prompt, JSON)
 * POST /workspace/projects/:id/visual-checks/:runId/evidence?name=  — upload one evidence file (raw body → R2)
 * GET  /workspace/projects/:id/visual-checks?userKey=                — list (lightweight)
 * GET  /workspace/projects/:id/visual-checks/:runId?userKey=         — detail (report + agent prompt + evidence keys)
 * GET  /workspace/projects/:id/visual-checks/:runId/evidence/*       — serve one evidence file (R2 proxy)
 *
 * Ownership enforced server-side (project belongs to userKey; run belongs to
 * both). Evidence names are allowlisted (screenshots/*.png|jpg, video/*.webm)
 * so R2 keys are always checks/{userKey}/{projectId}/{runId}/{name}.
 * NO numeric score anywhere (Simsa policy §20).
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getProject } from "../workspace/db.js";
import { listProjectReviewRuns } from "../workspace/pr-review-db.js";
import { assembleLiveEvidence } from "../workspace/evidence-live.js";
import {
  insertVisualCheck,
  listVisualChecks,
  getVisualCheckById,
  appendVisualCheckEvidenceKey,
  VISUAL_CHECK_EXECUTORS,
} from "../workspace/visual-check-db.js";
import type { VisualCheckExecutor, DbVisualCheck } from "../workspace/visual-check-db.js";

const MAX_REPORT_BYTES = 512 * 1024; // 512KB report snapshot
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per screenshot
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB flow video
const MAX_EVIDENCE_FILES = 30;

/** Allowed evidence names → content type. Keeps R2 keys fully server-shaped. */
const EVIDENCE_NAME_RE = /^(screenshots\/[A-Za-z0-9._-]{1,80}\.(png|jpg|jpeg)|video\/[A-Za-z0-9._-]{1,80}\.webm)$/;

function evidenceContentType(name: string): string {
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

async function requireOwnedProject(
  env: Env,
  projectId: string,
  userKey: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const project = await getProject(env, projectId);
  if (!project) return { ok: false, status: 404, error: "project_not_found" };
  if (project.userKey !== userKey) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

async function requireOwnedRun(
  env: Env,
  projectId: string,
  runId: string,
  userKey: string,
): Promise<{ ok: true; run: DbVisualCheck } | { ok: false; status: 403 | 404; error: string }> {
  const run = await getVisualCheckById(env, runId);
  if (!run || run.projectId !== projectId) return { ok: false, status: 404, error: "not_found" };
  if (run.userKey !== userKey) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true, run };
}

export function createWorkspaceVisualChecksRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  // ── POST /workspace/projects/:id/visual-checks ─────────────────────────────
  app.post("/workspace/projects/:id/visual-checks", async (c) => {
    const projectId = c.req.param("id");

    let body: {
      userKey?: unknown;
      targetUrl?: unknown;
      intent?: unknown;
      decision?: unknown;
      works?: unknown;
      executor?: unknown;
      report?: unknown;
      agentPrompt?: unknown;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const targetUrl = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
    const intent = typeof body.intent === "string" ? body.intent.trim() : "";
    const decision = typeof body.decision === "string" ? body.decision.trim() : "";
    if (!targetUrl || targetUrl.length > 500) return c.json({ ok: false, error: "invalid_target_url" }, 400);
    if (!intent || intent.length > 1000) return c.json({ ok: false, error: "invalid_intent" }, 400);
    if (!decision || decision.length > 64) return c.json({ ok: false, error: "invalid_decision" }, 400);

    const works = body.works === true ? true : body.works === false ? false : null;

    const executor: VisualCheckExecutor = VISUAL_CHECK_EXECUTORS.includes(body.executor as VisualCheckExecutor)
      ? (body.executor as VisualCheckExecutor)
      : "local";

    if (body.report === undefined || body.report === null || typeof body.report !== "object") {
      return c.json({ ok: false, error: "report_required" }, 400);
    }
    const reportJson = JSON.stringify(body.report);
    if (reportJson.length > MAX_REPORT_BYTES) return c.json({ ok: false, error: "report_too_large" }, 400);

    const agentPrompt = typeof body.agentPrompt === "string" ? body.agentPrompt : undefined;
    if (agentPrompt && agentPrompt.length > MAX_PROMPT_BYTES) {
      return c.json({ ok: false, error: "agent_prompt_too_large" }, 400);
    }

    const owned = await requireOwnedProject(c.env, projectId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const run = await insertVisualCheck(c.env, {
        projectId,
        userKey,
        targetUrl,
        intent,
        decision,
        works,
        executor,
        reportJson,
        agentPrompt,
      });
      return c.json(
        {
          ok: true,
          check: {
            id: run.id,
            projectId,
            targetUrl: run.targetUrl,
            decision: run.decision,
            works: run.works,
            status: run.status,
            executor: run.executor,
            createdAt: run.createdAt,
          },
        },
        201,
      );
    } catch (err) {
      console.error("[workspace/visual-checks POST] failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
  });

  // ── POST /workspace/projects/:id/visual-checks/:runId/evidence?name=... ────
  app.post("/workspace/projects/:id/visual-checks/:runId/evidence", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    const userKey = c.req.query("userKey") ?? "";
    const name = c.req.query("name") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    if (!c.env.EVIDENCE) return c.json({ ok: false, error: "evidence_storage_unconfigured" }, 503);
    if (!EVIDENCE_NAME_RE.test(name)) return c.json({ ok: false, error: "invalid_evidence_name" }, 400);

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);
    if (owned.run.evidenceKeys.length >= MAX_EVIDENCE_FILES) {
      return c.json({ ok: false, error: "evidence_limit_reached" }, 400);
    }

    const bytes = await c.req.arrayBuffer();
    const maxBytes = name.endsWith(".webm") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (bytes.byteLength <= 0 || bytes.byteLength > maxBytes) {
      return c.json({ ok: false, error: "evidence_too_large" }, 400);
    }

    try {
      const key = `checks/${userKey}/${projectId}/${runId}/${name}`;
      await c.env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: evidenceContentType(name) } });
      const keys = await appendVisualCheckEvidenceKey(c.env, runId, name);
      return c.json({ ok: true, name, evidenceCount: keys.length }, 201);
    } catch (err) {
      console.error("[workspace/visual-checks evidence POST] failed:", err);
      return c.json({ ok: false, error: "upload_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/visual-checks ──────────────────────────────
  app.get("/workspace/projects/:id/visual-checks", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const owned = await requireOwnedProject(c.env, projectId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const checks = await listVisualChecks(c.env, projectId);
      return c.json({ ok: true, checks });
    } catch (err) {
      console.error("[workspace/visual-checks GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/visual-checks/:runId/evidence/* ────────────
  // (registered BEFORE the :runId detail route so the wildcard wins)
  app.get("/workspace/projects/:id/visual-checks/:runId/evidence/*", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    if (!c.env.EVIDENCE) return c.json({ ok: false, error: "evidence_storage_unconfigured" }, 503);

    const marker = `/evidence/`;
    const path = new URL(c.req.url).pathname;
    const name = decodeURIComponent(path.slice(path.indexOf(marker) + marker.length));
    if (!EVIDENCE_NAME_RE.test(name)) return c.json({ ok: false, error: "invalid_evidence_name" }, 400);

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);
    if (!owned.run.evidenceKeys.includes(name)) return c.json({ ok: false, error: "not_found" }, 404);

    try {
      const key = `checks/${userKey}/${projectId}/${runId}/${name}`;
      const obj = await c.env.EVIDENCE.get(key);
      if (!obj) return c.json({ ok: false, error: "not_found" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": evidenceContentType(name),
          "cache-control": "private, max-age=300",
        },
      });
    } catch (err) {
      console.error("[workspace/visual-checks evidence GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/visual-checks/:runId ───────────────────────
  app.get("/workspace/projects/:id/visual-checks/:runId", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    let report: unknown = null;
    try {
      report = JSON.parse(owned.run.reportJson);
    } catch {
      report = null;
    }

    return c.json({
      ok: true,
      check: {
        id: owned.run.id,
        projectId: owned.run.projectId,
        targetUrl: owned.run.targetUrl,
        intent: owned.run.intent,
        decision: owned.run.decision,
        works: owned.run.works,
        status: owned.run.status,
        executor: owned.run.executor,
        report,
        agentPrompt: owned.run.agentPrompt,
        evidenceKeys: owned.run.evidenceKeys,
        createdAt: owned.run.createdAt,
      },
    });
  });

  // ── GET /workspace/projects/:id/evidence/:runId ────────────────────────────
  // Train M-1a (2026-07-21, design locked): "왜 이 판정인가" 증거 체인.
  // 저장된 사실(스펙/items · 시각 런 · 최신 PR 리뷰 결과)을 GET 시점에
  // acceptance-graph로 재도출(on-demand — 저장 없음·네트워크 없음·결정론).
  // 새 판정을 만들지 않는다: 이미 내려진 판정에 근거를 붙일 뿐이다.
  app.get("/workspace/projects/:id/evidence/:runId", async (c) => {
    const projectId = c.req.param("id");
    const runId = c.req.param("runId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const owned = await requireOwnedRun(c.env, projectId, runId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const project = await getProject(c.env, projectId);
      const parse = (v: unknown): unknown => {
        if (typeof v !== "string") return v ?? null;
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      };
      // A finished review = terminal verdict status with a stored result.
      const latest = (await listProjectReviewRuns(c.env, projectId, { limit: 5 })).find(
        (r) => (r.status === "passed" || r.status === "failed" || r.status === "inconclusive") && r.resultJson,
      );
      let latestReview: { repoFullName?: string; prNumber?: number; results?: Array<{ itemId?: string; title?: string; status?: string }> } | null = null;
      if (latest) {
        const parsed = parse(latest.resultJson) as { results?: Array<{ itemId?: string; title?: string; status?: string }> } | null;
        latestReview = {
          repoFullName: latest.repoFullName,
          prNumber: latest.prNumber,
          results: parsed?.results ?? [],
        };
      }

      const evidence = assembleLiveEvidence({
        projectId,
        entryPath: project?.entryPath ?? null,
        productSpec: (project ? parse(project.productSpec) : null) as never,
        items: (project ? parse(project.items) : null) as never,
        run: {
          id: owned.run.id,
          intent: owned.run.intent,
          decision: owned.run.decision,
          works: owned.run.works,
          reportJson: owned.run.reportJson,
        },
        latestReview,
      });

      return c.json({ ok: true, evidence });
    } catch (err) {
      console.error("[workspace/evidence GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  return app;
}
