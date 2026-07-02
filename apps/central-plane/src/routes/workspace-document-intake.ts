/**
 * workspace-document-intake.ts — Stage 265 (Phase 3.5: document intake → spec draft)
 *
 * POST /workspace/projects/:id/sources/:sourceId/spec-draft
 *   Body: { userKey, locale? }
 *   Turns an uploaded PRD/기획서 (Stage 261 document source, R2-stored md/txt)
 *   into a DRAFT product spec + acceptance items via the SAME generation path
 *   as POST /workspace/idea-to-spec-draft (generateIdeaToSpecDraft — mock
 *   fallback when ANTHROPIC_API_KEY is absent, so the flow never hard-fails).
 *
 *   DRAFT ONLY — this endpoint never writes productSpec/items to the project
 *   row. The dashboard confirm flow persists via POST /workspace/projects.
 *
 *   Rate limit: shares the SAME hourly per-IP counter as idea-to-spec-draft
 *   (bucket namespace `workspace::`, WORKSPACE_GENERATION_LIMIT_PER_HOUR).
 *
 *   Errors:
 *     400 invalid_json | userKey_required | source_not_document
 *         | pdf_text_extraction_unsupported | unsupported_content_type
 *         | document_too_short | document_too_long
 *     403 forbidden          — project or source belongs to another userKey
 *     404 project_not_found | source_not_found | document_not_found
 *     429 rate_limited
 *     503 evidence_storage_unconfigured — EVIDENCE R2 binding absent
 */
import { Hono } from "hono";
import type { Env } from "../env.js";
import { corsMiddleware } from "./cors.js";
import { getProject } from "../workspace/db.js";
import { getProjectSourceById } from "../workspace/project-sources-db.js";
import {
  extractDocumentText,
  buildDocumentDraftPrompt,
} from "../workspace/document-intake.js";
import { generateIdeaToSpecDraft } from "../workspace/generate.js";
import { insertUsageEvent } from "../workspace/usage-events-db.js";

const DEFAULT_LIMIT_PER_HOUR = 20;

// ─── Rate limit helpers ──────────────────────────────────────────────────────
// Same D1 table + SAME bucket namespace (`workspace::`) as the idea-to-spec
// endpoint in routes/workspace.ts, so document intake and idea intake share
// one hourly generation counter per IP.

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function currentHourUtc(): string {
  return new Date().toISOString().slice(0, 13); // "2026-07-02T15"
}

function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

async function getRateLimitCount(db: D1Database, ipHash: string, hourUtc: string): Promise<number> {
  try {
    const row = await db
      .prepare("SELECT count FROM workspace_rate_limit WHERE ip_hash = ? AND hour_utc = ?")
      .bind(ipHash, hourUtc)
      .first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function incrementRateLimitCount(db: D1Database, ipHash: string, hourUtc: string): Promise<void> {
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
    console.warn("[workspace/document-intake] rate-limit upsert failed (non-fatal):", err);
  }
}

// ─── Route factory ───────────────────────────────────────────────────────────

export function createWorkspaceDocumentIntakeRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  app.post("/workspace/projects/:id/sources/:sourceId/spec-draft", async (c) => {
    const projectId = c.req.param("id");
    const sourceId = c.req.param("sourceId");

    // ── Body ────────────────────────────────────────────────────────────────
    let body: { userKey?: unknown; locale?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }
    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    const locale: "ko" | "en" = body.locale === "en" ? "en" : "ko";

    // ── Ownership: project ──────────────────────────────────────────────────
    const project = await getProject(c.env, projectId);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);
    if (project.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

    // ── Ownership: source ───────────────────────────────────────────────────
    const source = await getProjectSourceById(c.env, sourceId);
    if (!source || source.projectId !== projectId) {
      return c.json({ ok: false, error: "source_not_found" }, 404);
    }
    if (source.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);
    if (source.type !== "document") {
      return c.json({ ok: false, error: "source_not_document" }, 400);
    }

    // ── Fetch document from R2 ──────────────────────────────────────────────
    if (!c.env.EVIDENCE) return c.json({ ok: false, error: "evidence_storage_unconfigured" }, 503);
    if (source.reference === "pending") {
      return c.json({ ok: false, error: "document_not_found" }, 404);
    }
    const obj = await c.env.EVIDENCE.get(source.reference);
    if (!obj) return c.json({ ok: false, error: "document_not_found" }, 404);
    const bytes = await obj.arrayBuffer();

    // ── Extract + guard (deterministic, no LLM) ─────────────────────────────
    const extracted = extractDocumentText(bytes, source.contentType);
    if (!extracted.ok) {
      const message =
        extracted.error === "pdf_text_extraction_unsupported"
          ? "PDF 텍스트 추출은 아직 지원되지 않습니다. 문서를 md 또는 txt로 저장해 다시 업로드해주세요."
          : undefined;
      return c.json({ ok: false, error: extracted.error, ...(message ? { message } : {}) }, 400);
    }

    // ── Rate limit (same bucket as idea-to-spec-draft) ──────────────────────
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
      return c.json(
        {
          ok: false,
          error: "rate_limited",
          message: "잠시 후 다시 시도해주세요. 제품 설명서 만들기 요청이 짧은 시간에 많이 발생했어요.",
          retryAfterSeconds,
        },
        429,
        { "retry-after": String(retryAfterSeconds) },
      );
    }

    // ── Generate via the SAME path as idea-to-spec-draft ────────────────────
    // generateIdeaToSpecDraft degrades to a deterministic mock-fallback when
    // ANTHROPIC_API_KEY is absent or the LLM call fails — preserved here.
    const input = buildDocumentDraftPrompt(extracted.text, {
      title: project.title,
      idea: typeof project.idea === "string" ? project.idea : "",
    });

    let result;
    try {
      result = await generateIdeaToSpecDraft({ idea: input, locale }, c.env.ANTHROPIC_API_KEY);
    } catch (err) {
      console.error("[workspace/document-intake] unexpected generate error:", err);
      return c.json({ ok: false, error: "internal_error" }, 500);
    }

    await incrementRateLimitCount(c.env.DB, ipHash, hourUtc);

    // Record usage event (non-fatal)
    await insertUsageEvent(c.env, {
      userKey,
      projectId,
      eventType: "workspace_document_spec_draft_generated",
      metadata: { source: result.source, sourceId, contentType: source.contentType },
    });

    // DRAFT ONLY — never persist productSpec/items here; the dashboard confirm
    // flow saves via the existing POST /workspace/projects endpoint.
    const { ok: _ok, ...draft } = result;
    return c.json({
      ok: true,
      draft,
      source: { id: source.id, label: source.label ?? source.reference },
    });
  });

  return app;
}
