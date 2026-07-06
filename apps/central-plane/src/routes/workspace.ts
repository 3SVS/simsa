/**
 * Workspace generation routes.
 *
 * POST /workspace/idea-to-spec-draft
 *   Free beta — no auth required.
 *   Rate-limited: WORKSPACE_GENERATION_LIMIT_PER_HOUR (default 20) req/hour per IP.
 *   Calls Anthropic to generate a structured Korean product spec.
 *   Falls back to mock data on LLM failure so the client never breaks.
 *   Rate-limit hit returns HTTP 429 — NO mock fallback in that case.
 *
 * CORS: allowed for dashboard origins and localhost in dev.
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { ALLOWED_ORIGINS } from "./cors.js";
import { generateIdeaToSpecDraft, type IdeaToSpecDraftRequest } from "../workspace/generate.js";
import { normalizeBuiltWith } from "../workspace/built-with.js";
import { classifyTopics } from "../workspace/topic-tags.js";
import {
  generateCheckDraft,
  type WorkspaceCheckDraftRequest,
} from "../workspace/check.js";
import {
  generateFixSuggestion,
  type WorkspaceFixSuggestionRequest,
} from "../workspace/fix.js";
import {
  upsertProject,
  getProject,
  getOwnedProject,
  listProjectsByUser,
  saveCheckRun,
  saveFixSuggestion as saveFixSuggestionToDb,
} from "../workspace/db.js";
import {
  generateBuilderPack,
  type WorkspaceExportBuilderPackRequest,
} from "../workspace/export.js";
import { BRAND } from "../workspace/brand.js";
import {
  saveOutcome,
  listOutcomes,
  isValidOutcome,
  isValidTarget,
} from "../workspace/outcomes.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";
import { consumeUserDailyLimit } from "../workspace/rate-limit.js";
import {
  betaProjectCreateDailyLimit,
  BETA_PROJECT_CREATE_DAILY_BUCKET,
} from "../workspace/beta-limits.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT_PER_HOUR = 20;

// ALLOWED_ORIGINS centralized in ./cors.ts (Stage 91) — imported at top.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed: string =
    origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".conclave-ai.dev"))
      ? origin
      : (ALLOWED_ORIGINS[0] as string);
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Simsa-User-Key",
    "Access-Control-Max-Age": "86400",
  };
}

/** SHA-256 hex of `input` using the Web Crypto API available in Workers. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * UTC hour key, e.g. "2026-06-11T15".
 * Used as the rate-limit window bucket — resets every full UTC hour.
 */
function currentHourUtc(): string {
  return new Date().toISOString().slice(0, 13); // "2026-06-11T15"
}

/** Seconds until the next full UTC hour. */
function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

// ─── Rate limit D1 helpers ────────────────────────────────────────────────────

async function getRateLimitCount(
  db: D1Database,
  ipHash: string,
  hourUtc: string,
): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT count FROM workspace_rate_limit WHERE ip_hash = ? AND hour_utc = ?")
      .bind(ipHash, hourUtc)
      .first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    // Table may not exist yet in local dev — treat as 0
    return 0;
  }
}

async function incrementRateLimitCount(
  db: D1Database,
  ipHash: string,
  hourUtc: string,
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO workspace_rate_limit (ip_hash, hour_utc, count, first_at, last_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (ip_hash, hour_utc) DO UPDATE SET
           count = count + 1, last_at = excluded.last_at`,
      )
      .bind(ipHash, hourUtc, now, now)
      .run();
  } catch (err) {
    // Non-fatal — don't block the request on a rate-limit write failure
    console.warn("[workspace/rate-limit] upsert failed (non-fatal):", err);
  }
}

// ─── Route factory ────────────────────────────────────────────────────────────

export function createWorkspaceRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Preflight
  app.options("/workspace/*", (c) => {
    const origin = c.req.header("origin") ?? null;
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  });

  /**
   * POST /workspace/idea-to-spec-draft
   *
   * Body: IdeaToSpecDraftRequest
   *
   * Success (200): IdeaToSpecDraftResponse — source is "llm" or "mock-fallback"
   * Rate limited (429): { ok: false, error: "rate_limited", message, retryAfterSeconds }
   * Bad input (400): { ok: false, error: string }
   * Server error (500): { ok: false, error: "internal_error" }
   */
  app.post("/workspace/idea-to-spec-draft", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
        status: 400,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    const req = body as Partial<IdeaToSpecDraftRequest>;
    if (!req.idea || typeof req.idea !== "string" || !req.idea.trim()) {
      return new Response(JSON.stringify({ ok: false, error: "idea_required" }), {
        status: 400,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    // ── Rate limit ───────────────────────────────────────────────────────────
    const limitPerHour =
      parseInt(c.env.WORKSPACE_GENERATION_LIMIT_PER_HOUR ?? "", 10) || DEFAULT_LIMIT_PER_HOUR;

    const rawIp =
      c.req.header("cf-connecting-ip") ??
      (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
      "unknown";
    const ipHash = await sha256Hex(`workspace::${rawIp}`);
    const hourUtc = currentHourUtc();

    const currentCount = await getRateLimitCount(c.env.DB, ipHash, hourUtc);
    if (currentCount >= limitPerHour) {
      const retryAfterSeconds = secondsUntilNextHour();
      return new Response(
        JSON.stringify({
          ok: false,
          error: "rate_limited",
          message:
            "잠시 후 다시 시도해주세요. 제품 설명서 만들기 요청이 짧은 시간에 많이 발생했어요.",
          retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfterSeconds),
            ...headers,
          },
        },
      );
    }

    // ── Generate ─────────────────────────────────────────────────────────────
    const input: IdeaToSpecDraftRequest = {
      // 80k chars: a 20-30 page PRD is 30-60k chars and multi-file drops
      // concatenate, so 15k was still too small. 80k Korean chars is ~160k
      // tokens worst-case — safely inside Haiku's 200k context with the
      // prompt template + 3k output. (The old 1,000-char cap silently
      // discarded uploaded documents and degraded drafts to the mock.)
      idea: req.idea.trim().slice(0, 80_000),
      mode: req.mode ?? "standard",
      answers: Array.isArray(req.answers) ? req.answers : [],
      locale: req.locale ?? "ko",
    };

    let result;
    try {
      result = await generateIdeaToSpecDraft(input, c.env.ANTHROPIC_API_KEY, c.env.CF_AI_GATEWAY_ANTHROPIC_URL);
    } catch (err) {
      console.error("[workspace] unexpected generate error:", err);
      return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
        status: 500,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    // Increment rate-limit counter after successful generation (non-fatal)
    await incrementRateLimitCount(c.env.DB, ipHash, hourUtc);

    // Honest failure (2026-07-05): the LLM being down must LOOK down — a 503
    // the client renders as "다시 시도해주세요", never a fabricated draft.
    if (result.ok === false) {
      return new Response(JSON.stringify({ ok: false, error: "llm_unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey: typeof (body as Record<string, unknown>)["userKey"] === "string"
        ? String((body as Record<string, unknown>)["userKey"])
        : "anonymous",
      eventType: "workspace_idea_to_spec_generated",
      metadata: { source: result.source },
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  });

  // ── POST /workspace/projects ─────────────────────────────────────────────────
  // Save a workspace project to D1. No auth — user_key is client-generated UUID.
  app.post("/workspace/projects", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const b = body as Record<string, unknown>;
    if (!b["userKey"] || !b["title"]) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_and_title_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    try {
      // Overwrite-IDOR guard: a client-supplied id that already exists and
      // belongs to a DIFFERENT user_key must never be overwritten. Same-owner
      // upsert (dashboard re-save) keeps working; new ids keep working.
      let existing: Awaited<ReturnType<typeof getProject>> = null;
      if (typeof b["id"] === "string" && b["id"]) {
        existing = await getProject(c.env, b["id"]).catch(() => null);
        if (existing && existing.userKey !== String(b["userKey"])) {
          return new Response(JSON.stringify({ ok: false, error: "id_conflict" }), { status: 409, headers: { "content-type": "application/json", ...headers } });
        }
      }
      // beta_limits — TEMPORARY daily cap on NEW project creations (default
      // 20/day per userKey). Re-saves of an existing owned project (the
      // dashboard autosaves constantly) do NOT consume the budget. See
      // workspace/beta-limits.ts; re-tune from cost_meta after open.
      if (!existing) {
        const daily = await consumeUserDailyLimit(
          c.env,
          BETA_PROJECT_CREATE_DAILY_BUCKET,
          String(b["userKey"]),
          betaProjectCreateDailyLimit(c.env),
        );
        if (daily.limited) {
          return new Response(
            JSON.stringify({ ok: false, error: "rate_limited", scope: "beta_daily", retryAfterSeconds: daily.retryAfterSeconds }),
            { status: 429, headers: { "content-type": "application/json", "retry-after": String(daily.retryAfterSeconds), ...headers } },
          );
        }
      }
      const entryPath =
        b["entryPath"] === "idea" || b["entryPath"] === "code" || b["entryPath"] === "spec"
          ? (b["entryPath"] as string)
          : null;
      // topic_tags — deterministic classification of idea + spec (no LLM, no raw
      // text stored; only structured tags). acquisition — where the user arrived.
      const ideaText = typeof b["idea"] === "string" ? b["idea"] : "";
      const topicTags = classifyTopics(`${ideaText} ${JSON.stringify(b["productSpec"] ?? {})}`);
      const acqSource =
        b["acquisition"] && typeof b["acquisition"] === "object"
          ? (b["acquisition"] as Record<string, unknown>)["source"]
          : b["acquisitionSource"];
      // Capture-once: default "direct" only on CREATE. A re-save without an
      // acquisition passes undefined → the sticky upsert keeps the original.
      const acquisition =
        typeof acqSource === "string" && acqSource
          ? { source: acqSource.slice(0, 40) }
          : existing
            ? undefined
            : { source: "direct" };
      const id = await upsertProject(c.env, {
        id: typeof b["id"] === "string" ? b["id"] : undefined,
        userKey: String(b["userKey"]),
        title: String(b["title"]),
        idea: ideaText,
        understood: b["understood"] ?? {},
        productSpec: b["productSpec"] ?? {},
        items: b["items"] ?? [],
        // P1 envelope collection — normalized so unknown tools fall into `other`.
        builtWith: normalizeBuiltWith(b["builtWith"]),
        entryPath,
        topicTags,
        acquisition,
      });
      return new Response(JSON.stringify({ ok: true, id }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    } catch (err) {
      console.error("[workspace/projects] save failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "save_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }
  });

  // ── GET /workspace/projects?userKey=... ──────────────────────────────────────
  // userKey-scoped project list (powers the MCP list_projects tool).
  app.get("/workspace/projects", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    try {
      const projects = await listProjectsByUser(c.env, userKey);
      return new Response(JSON.stringify({ ok: true, projects }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    } catch (err) {
      console.error("[workspace/projects] list failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "fetch_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }
  });

  // ── GET /workspace/projects/:id?userKey=... ──────────────────────────────────
  // Ownership-enforced: 404 not_found for missing OR not-owned (no existence oracle).
  app.get("/workspace/projects/:id", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);
    const id = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    try {
      const project = await getOwnedProject(c.env, id, userKey);
      if (!project) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
      return new Response(JSON.stringify({ ok: true, project }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    } catch (err) {
      console.error("[workspace/projects] fetch failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "fetch_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }
  });

  // ── POST /workspace/check-draft ──────────────────────────────────────────────
  // Check spec + items for completeness. Rate-limited (check bucket).
  app.post("/workspace/check-draft", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);

    const limitPerHour = parseInt(c.env.WORKSPACE_GENERATION_LIMIT_PER_HOUR ?? "", 10) || DEFAULT_LIMIT_PER_HOUR;
    const rawIp = c.req.header("cf-connecting-ip") ?? (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "unknown";
    const ipHash = await sha256Hex(`workspace-check::${rawIp}`);
    const hourUtc = currentHourUtc();
    const count = await getRateLimitCount(c.env.DB, ipHash, hourUtc);
    if (count >= limitPerHour) {
      return new Response(JSON.stringify({ ok: false, error: "rate_limited", message: "잠시 후 다시 시도해주세요. 확인 요청이 너무 많이 발생했어요.", retryAfterSeconds: secondsUntilNextHour() }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(secondsUntilNextHour()), ...headers } });
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const req = body as Partial<WorkspaceCheckDraftRequest>;
    if (!req.productSpec || !Array.isArray(req.items)) {
      return new Response(JSON.stringify({ ok: false, error: "productSpec_and_items_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    // Ownership gate for the project-scoped side effect (check-run persistence).
    // Generation itself only uses client-supplied inputs, so it stays available
    // for local-only projects — but writing under a projectId requires a
    // userKey, and the write is silently skipped unless the project is owned.
    const checkUserKey = typeof (body as Record<string, unknown>)["userKey"] === "string"
      ? String((body as Record<string, unknown>)["userKey"])
      : "";
    let checkProjectOwned = false;
    if (req.projectId) {
      if (!checkUserKey) {
        return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
      }
      checkProjectOwned = Boolean(await getOwnedProject(c.env, req.projectId, checkUserKey).catch(() => null));
    }

    let result;
    try {
      // Route through the Cloudflare AI Gateway like every other LLM call —
      // direct Worker→Anthropic egress ~90% 403s, which surfaced as the
      // recurring "확인 중 오류가 발생했습니다". This was the ONE LLM route that
      // omitted the gateway URL.
      result = await generateCheckDraft({ productSpec: req.productSpec, items: req.items, projectId: req.projectId, locale: req.locale ?? "ko" }, c.env.ANTHROPIC_API_KEY, c.env.CF_AI_GATEWAY_ANTHROPIC_URL);
    } catch (err) {
      console.error("[workspace/check-draft] error:", err);
      return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }

    await incrementRateLimitCount(c.env.DB, ipHash, hourUtc);

    if (result.ok === false) {
      return new Response(JSON.stringify({ ok: false, error: "llm_unavailable" }), { status: 503, headers: { "content-type": "application/json", ...headers } });
    }

    // Best-effort persist check run to D1 — only into projects the caller owns.
    if (req.projectId && checkProjectOwned) {
      saveCheckRun(c.env, req.projectId, result.source, result).catch(() => undefined);
    }

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey: typeof (body as Record<string, unknown>)["userKey"] === "string"
        ? String((body as Record<string, unknown>)["userKey"])
        : "anonymous",
      projectId: req.projectId,
      eventType: "workspace_check_draft_run",
      metadata: { source: result.source },
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  // ── POST /workspace/fix-suggestion ──────────────────────────────────────────
  // Generate fix suggestion + builder brief for a failed/inconclusive/needs_decision item.
  app.post("/workspace/fix-suggestion", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = corsHeaders(origin);

    const limitPerHour = parseInt(c.env.WORKSPACE_GENERATION_LIMIT_PER_HOUR ?? "", 10) || DEFAULT_LIMIT_PER_HOUR;
    const rawIp = c.req.header("cf-connecting-ip") ?? (c.req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "unknown";
    const ipHash = await sha256Hex(`workspace-fix::${rawIp}`);
    const hourUtc = currentHourUtc();
    const count = await getRateLimitCount(c.env.DB, ipHash, hourUtc);
    if (count >= limitPerHour * 2) { // fix suggestions get 2x limit
      return new Response(JSON.stringify({ ok: false, error: "rate_limited", message: "잠시 후 다시 시도해주세요.", retryAfterSeconds: secondsUntilNextHour() }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(secondsUntilNextHour()), ...headers } });
    }

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const req = body as Partial<WorkspaceFixSuggestionRequest>;
    if (!req.item || !req.checkResult) {
      return new Response(JSON.stringify({ ok: false, error: "item_and_checkResult_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    // Ownership gate for the project-scoped side effect (fix-suggestion
    // persistence) — same pattern as /workspace/check-draft above.
    const fixUserKey = typeof (body as Record<string, unknown>)["userKey"] === "string"
      ? String((body as Record<string, unknown>)["userKey"])
      : "";
    let fixProjectOwned = false;
    if (req.projectId) {
      if (!fixUserKey) {
        return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
      }
      fixProjectOwned = Boolean(await getOwnedProject(c.env, req.projectId, fixUserKey).catch(() => null));
    }

    let result;
    try {
      result = await generateFixSuggestion(req as WorkspaceFixSuggestionRequest, c.env.ANTHROPIC_API_KEY, c.env.CF_AI_GATEWAY_ANTHROPIC_URL);
    } catch (err) {
      console.error("[workspace/fix-suggestion] error:", err);
      return new Response(JSON.stringify({ ok: false, error: "internal_error" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }

    await incrementRateLimitCount(c.env.DB, ipHash, hourUtc);

    if (result.ok === false) {
      return new Response(JSON.stringify({ ok: false, error: "llm_unavailable" }), { status: 503, headers: { "content-type": "application/json", ...headers } });
    }

    if (req.projectId && fixProjectOwned) {
      saveFixSuggestionToDb(c.env, req.projectId, req.item.id, result.suggestion).catch(() => undefined);
    }

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey: typeof (body as Record<string, unknown>)["userKey"] === "string"
        ? String((body as Record<string, unknown>)["userKey"])
        : "anonymous",
      projectId: req.projectId,
      eventType: "workspace_fix_suggestion_generated",
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  // ── POST /workspace/export-builder-pack ──────────────────────────────────────
  // Deterministic — no LLM, no rate limit. Assembles markdown files from project data.
  app.post("/workspace/export-builder-pack", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = { ...corsHeaders(origin), "Access-Control-Allow-Methods": "POST, OPTIONS" };

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const req = body as Partial<WorkspaceExportBuilderPackRequest>;
    if (!req.target || !["claude_code", "codex", "both"].includes(req.target)) {
      return new Response(JSON.stringify({ ok: false, error: "target_required: claude_code | codex | both" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    if (!req.project && !req.projectId) {
      return new Response(JSON.stringify({ ok: false, error: "project_or_projectId_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    // If projectId provided but no inline project, load from D1 — ownership
    // enforced: reading another user's project through this path was a
    // read-IDOR (title/idea/spec/items leak). 404 for missing OR not owned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let project: any = req.project;
    if (!project && req.projectId) {
      const exportUserKey = typeof (body as Record<string, unknown>)["userKey"] === "string"
        ? String((body as Record<string, unknown>)["userKey"])
        : "";
      if (!exportUserKey) {
        return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
      }
      try {
        const dbProj = await getOwnedProject(c.env, req.projectId, exportUserKey);
        if (!dbProj) {
          return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
        }
        project = {
          title: dbProj.title,
          idea: dbProj.idea ?? "",
          productSpec: dbProj.productSpec ?? {},
          items: Array.isArray(dbProj.items) ? dbProj.items : [],
        };
      } catch (err) {
        // Honest failure: a DB error must not become an empty "successful"
        // export (ok:true, fileCount:0) — say it failed so the user retries.
        console.error("[workspace/export] D1 load failed:", err);
        return new Response(JSON.stringify({ ok: false, error: "project_load_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
      }
    }

    // D1-b: thread projectId + resolved app base URL so the pack can embed the
    // `/p/{projectId}/connect` re-entry link. Env is resolved here (route) to
    // keep generateBuilderPack pure. Omitted cleanly when projectId is absent.
    const appBaseUrl = c.env.DASHBOARD_BASE_URL ?? BRAND.appUrl;
    const result = generateBuilderPack({
      project,
      projectId: req.projectId,
      appBaseUrl,
      target: req.target,
      format: req.format ?? "json",
      locale: req.locale ?? "ko",
      // Prep layer: the in-Simsa setup UI sends the collected services/env values
      // per-export. Passed straight into the pack (.env), never stored server-side.
      ...(req.services ? { services: req.services } : {}),
    });

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey: typeof (body as Record<string, unknown>)["userKey"] === "string"
        ? String((body as Record<string, unknown>)["userKey"])
        : "anonymous",
      projectId: req.projectId,
      eventType: "workspace_builder_pack_exported",
      metadata: { target: req.target },
    });

    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json", ...headers } });
  });

  // ── POST /workspace/builder-pack-outcomes ────────────────────────────────────
  // Save the result of sending a builder pack to Claude Code / Codex.
  app.post("/workspace/builder-pack-outcomes", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = { ...corsHeaders(origin), "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const b = body as Record<string, unknown>;
    if (!b["projectId"] || typeof b["projectId"] !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "projectId_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    const outcomeUserKey = typeof b["userKey"] === "string" ? b["userKey"] : "";
    if (!outcomeUserKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    if (!isValidTarget(b["target"])) {
      return new Response(JSON.stringify({ ok: false, error: "target_invalid: claude_code | codex | both" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }
    if (!isValidOutcome(b["outcome"])) {
      return new Response(JSON.stringify({ ok: false, error: "outcome_invalid: worked | partial | failed | not_checked" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const selectedItemIds = Array.isArray(b["selectedItemIds"])
      ? (b["selectedItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    // Ownership: 404 for missing OR not-owned project (no existence oracle).
    const ownedOutcomeProject = await getOwnedProject(c.env, b["projectId"], outcomeUserKey).catch(() => null);
    if (!ownedOutcomeProject) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }

    try {
      const outcome = await saveOutcome(c.env, {
        projectId: b["projectId"],
        userKey: outcomeUserKey,
        target: b["target"],
        selectedItemIds,
        outcome: b["outcome"],
        note: typeof b["note"] === "string" ? b["note"] : undefined,
      });
      return new Response(JSON.stringify({ ok: true, outcome }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    } catch (err) {
      console.error("[workspace/outcomes] save failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "save_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }
  });

  // ── GET /workspace/projects/:id/builder-pack-outcomes?userKey=... ────────────
  // Ownership-enforced: 404 not_found for missing OR not-owned project.
  app.get("/workspace/projects/:id/builder-pack-outcomes", async (c) => {
    const origin = c.req.header("origin") ?? null;
    const headers = { ...corsHeaders(origin), "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) {
      return new Response(JSON.stringify({ ok: false, error: "userKey_required" }), { status: 400, headers: { "content-type": "application/json", ...headers } });
    }

    const owned = await getOwnedProject(c.env, projectId, userKey).catch(() => null);
    if (!owned) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...headers } });
    }

    try {
      const outcomes = await listOutcomes(c.env, projectId, 50);
      return new Response(JSON.stringify({ ok: true, outcomes }), { status: 200, headers: { "content-type": "application/json", ...headers } });
    } catch (err) {
      console.error("[workspace/outcomes] list failed:", err);
      return new Response(JSON.stringify({ ok: false, error: "list_failed" }), { status: 500, headers: { "content-type": "application/json", ...headers } });
    }
  });

  return app;
}
