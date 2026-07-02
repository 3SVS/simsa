/**
 * workspace-visual-check-runs.ts — Stage 263
 *
 * Cloud execution of Simsa visual completion checks. A dashboard/API client
 * asks "run inspection"; the Worker inserts a queued workspace_visual_checks
 * row (Stage 261 storage) and dispatches the job into the SimsaInspector
 * Cloudflare Container (Playwright + Chromium). The container uploads
 * evidence through the EXISTING Stage 261 evidence endpoint and reports the
 * result back here.
 *
 *   POST /workspace/projects/:id/visual-checks/run   — queue + dispatch a run
 *   POST /internal/visual-check-running              — container ack: queued → running
 *   POST /internal/visual-check-done                 — container result: → done|failed
 *
 * SECURITY:
 *   - Ownership enforced (project belongs to userKey) — same pattern as the
 *     Stage 261 routes.
 *   - The Worker NEVER inspects arbitrary URLs. The target must be (or origin-
 *     match) one of the project's registered `website` sources; a project with
 *     no website source gets 400 website_source_required.
 *   - /internal/* endpoints require Bearer INTERNAL_CALLBACK_TOKEN (mirrors
 *     /internal/job-done in saas.ts).
 *
 * Graceful degradation: when the INSPECTOR DO binding / callback token is
 * absent or the container refuses the job (e.g. still provisioning), the row is
 * created, immediately marked failed (fail-fast — nothing consumes queued rows
 * later), and the response carries dispatched:false + note so the caller can
 * retry right away. The stuck sweep (stuck-cleanup.ts) remains a backstop for
 * runs that dispatched but died silently.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getProject } from "../workspace/db.js";
import { getProjectSourceById, listProjectSources } from "../workspace/project-sources-db.js";
import {
  findActiveVisualCheckForProject,
  getVisualCheckById,
  insertQueuedVisualCheck,
  markVisualCheckDone,
  markVisualCheckFailed,
  markVisualCheckRunning,
} from "../workspace/visual-check-db.js";

const MAX_INTENT_CHARS = 1000;
const MAX_TARGET_URL_CHARS = 500;
const MAX_REPORT_BYTES = 512 * 1024; // matches Stage 261 create route
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_ERROR_CHARS = 500;

/** Generic Korean intent used when the caller doesn't provide one. */
export const DEFAULT_INSPECTION_INTENT =
  "사용자가 앱을 열어 핵심 기능이 실제로 작동하는지 눈으로 확인할 수 있어야 한다";

function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** True when `target` shares an origin with any registered website source. */
export function targetMatchesWebsiteSources(target: URL, references: string[]): boolean {
  for (const ref of references) {
    const src = parseHttpUrl(ref.trim());
    if (src && src.origin === target.origin) return true;
  }
  return false;
}

function requireInternalToken(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  const expected = c.env.INTERNAL_CALLBACK_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "callback_disabled" };
  const auth = c.req.header("authorization") ?? c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || m[1] !== expected) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}

/**
 * Dispatch the queued run into the SimsaInspector container DO. Mirrors
 * spawnSandbox in saas.ts: fire-and-forget from the caller's perspective —
 * the container acks 202 and reports back via /internal/visual-check-*.
 */
export async function dispatchInspection(
  env: Env,
  args: {
    runId: string;
    projectId: string;
    userKey: string;
    targetUrl: string;
    intent: string;
    publicBaseUrl: string;
  },
): Promise<{ dispatched: boolean; note?: string }> {
  if (!env.INSPECTOR) {
    return { dispatched: false, note: "inspector_unavailable" };
  }
  if (!env.INTERNAL_CALLBACK_TOKEN) {
    return { dispatched: false, note: "callback_token_missing" };
  }
  const base = args.publicBaseUrl.replace(/\/+$/, "");
  const payload = {
    runId: args.runId,
    projectId: args.projectId,
    userKey: args.userKey,
    targetUrl: args.targetUrl,
    intent: args.intent,
    baseUrl: base,
    callbackUrl: `${base}/internal/visual-check-done`,
    runningUrl: `${base}/internal/visual-check-running`,
    callbackToken: env.INTERNAL_CALLBACK_TOKEN,
  };
  try {
    const id = env.INSPECTOR.idFromName(`vc-${args.runId}`);
    const stub = env.INSPECTOR.get(id);
    const r = await stub.fetch("http://inspector/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const tail = await r.text();
      return { dispatched: false, note: `container returned ${r.status}: ${tail.slice(0, 200)}` };
    }
    return { dispatched: true };
  } catch (err) {
    return { dispatched: false, note: `container fetch failed: ${(err as Error).message.slice(0, 200)}` };
  }
}

export function createWorkspaceVisualCheckRunRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/workspace/*", corsMiddleware);

  // ── POST /workspace/projects/:id/visual-checks/run ─────────────────────────
  app.post("/workspace/projects/:id/visual-checks/run", async (c) => {
    const projectId = c.req.param("id");

    let body: { userKey?: unknown; sourceId?: unknown; targetUrl?: unknown; intent?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    // Ownership — identical pattern to the Stage 261 routes.
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    // Intent: optional, ≤1000 chars, sensible Korean generic default.
    let intent = DEFAULT_INSPECTION_INTENT;
    if (body.intent !== undefined) {
      if (typeof body.intent !== "string" || body.intent.trim().length === 0 || body.intent.length > MAX_INTENT_CHARS) {
        return c.json({ ok: false, error: "invalid_intent" }, 400);
      }
      intent = body.intent.trim();
    }

    // Resolve the inspection target. NEVER an arbitrary URL: it must come
    // from — or origin-match — a registered website source of THIS project.
    let targetUrl: string;
    if (body.sourceId !== undefined) {
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      const source = sourceId ? await getProjectSourceById(c.env, sourceId) : null;
      if (!source || source.projectId !== projectId || source.userKey !== userKey || source.type !== "website") {
        return c.json({ ok: false, error: "invalid_source" }, 400);
      }
      const parsed = parseHttpUrl(source.reference.trim());
      if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
      targetUrl = parsed.toString();
    } else {
      const sources = await listProjectSources(c.env, projectId);
      const websites = sources.filter((s) => s.type === "website");
      if (websites.length === 0) return c.json({ ok: false, error: "website_source_required" }, 400);

      if (body.targetUrl !== undefined) {
        const raw = typeof body.targetUrl === "string" ? body.targetUrl.trim() : "";
        if (!raw || raw.length > MAX_TARGET_URL_CHARS) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        const parsed = parseHttpUrl(raw);
        if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        if (!targetMatchesWebsiteSources(parsed, websites.map((w) => w.reference))) {
          return c.json({ ok: false, error: "target_url_not_registered" }, 400);
        }
        targetUrl = parsed.toString();
      } else {
        // Convenience: no explicit target → most recent website source.
        const latest = websites[0]!;
        const parsed = parseHttpUrl(latest.reference.trim());
        if (!parsed) return c.json({ ok: false, error: "invalid_target_url" }, 400);
        targetUrl = parsed.toString();
      }
    }

    // Concurrency guard: one active cloud run per project.
    const active = await findActiveVisualCheckForProject(c.env, projectId);
    if (active) {
      return c.json({ ok: false, error: "run_already_active", activeRunId: active.id }, 409);
    }

    let run;
    try {
      run = await insertQueuedVisualCheck(c.env, { projectId, userKey, targetUrl, intent });
    } catch (err) {
      console.error("[visual-check-runs POST run] insert failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }

    const publicBaseUrl = c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
    const dispatch = await dispatchInspection(c.env, {
      runId: run.id,
      projectId,
      userKey,
      targetUrl,
      intent,
      publicBaseUrl,
    });

    // Fail fast when the dispatch didn't take: nothing ever picks a queued row
    // up later (dispatch is fire-once), so leaving it 'queued' would wedge the
    // one-active-run guard for 30 min until the stuck sweep. A failed row is
    // honest and lets the user retry immediately (live finding, Stage 263.1).
    let status = run.status;
    if (!dispatch.dispatched) {
      try {
        await markVisualCheckFailed(c.env, run.id, dispatch.note ?? "dispatch_failed");
        status = "failed";
      } catch (err) {
        console.error("[visual-check-runs POST run] fail-fast mark failed:", err);
      }
    }

    return c.json(
      {
        ok: true,
        check: {
          id: run.id,
          projectId,
          targetUrl: run.targetUrl,
          intent: run.intent,
          decision: run.decision,
          works: run.works,
          status,
          executor: run.executor,
          createdAt: run.createdAt,
        },
        dispatched: dispatch.dispatched,
        ...(dispatch.note ? { note: dispatch.note } : {}),
      },
      202,
    );
  });

  // ── POST /internal/visual-check-running ────────────────────────────────────
  // Container ack: the job actually started executing (queued → running).
  // Bearer INTERNAL_CALLBACK_TOKEN required, mirroring /internal/job-done.
  app.post("/internal/visual-check-running", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as { runId?: string } | null;
    if (!body || typeof body.runId !== "string" || !body.runId) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const run = await getVisualCheckById(c.env, body.runId);
    if (!run) return c.json({ error: "not_found" }, 404);

    const transitioned = await markVisualCheckRunning(c.env, body.runId);
    return c.json({ ok: true, transitioned });
  });

  // ── POST /internal/visual-check-done ───────────────────────────────────────
  // Container result callback. Evidence files were already uploaded via the
  // Stage 261 evidence endpoint (which validates names/sizes) — this endpoint
  // only finalizes the row.
  app.post("/internal/visual-check-done", async (c) => {
    const auth = requireInternalToken(c);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const body = (await c.req.json().catch(() => null)) as
      | {
          runId?: string;
          ok?: boolean;
          decision?: string;
          works?: boolean | null;
          report?: unknown;
          agentPrompt?: string;
          error?: string;
        }
      | null;
    if (!body || typeof body.runId !== "string" || !body.runId || typeof body.ok !== "boolean") {
      return c.json({ error: "invalid_request" }, 400);
    }

    const run = await getVisualCheckById(c.env, body.runId);
    if (!run) return c.json({ error: "not_found" }, 404);

    if (!body.ok) {
      const error = typeof body.error === "string" && body.error ? body.error : "inspection failed";
      await markVisualCheckFailed(c.env, body.runId, error.slice(0, MAX_ERROR_CHARS));
      return c.json({ ok: true, status: "failed" });
    }

    const decision = typeof body.decision === "string" && body.decision.trim() && body.decision.length <= 64
      ? body.decision.trim()
      : "Not Judged";
    const works = body.works === true ? true : body.works === false ? false : null;

    let reportJson = "{}";
    if (body.report !== undefined && body.report !== null && typeof body.report === "object") {
      const serialized = JSON.stringify(body.report);
      if (serialized.length > MAX_REPORT_BYTES) return c.json({ error: "report_too_large" }, 400);
      reportJson = serialized;
    }
    const agentPrompt = typeof body.agentPrompt === "string" && body.agentPrompt ? body.agentPrompt : undefined;
    if (agentPrompt && agentPrompt.length > MAX_PROMPT_BYTES) {
      return c.json({ error: "agent_prompt_too_large" }, 400);
    }

    await markVisualCheckDone(c.env, body.runId, {
      decision,
      works,
      reportJson,
      ...(agentPrompt ? { agentPrompt } : {}),
    });
    return c.json({ ok: true, status: "done" });
  });

  return app;
}
