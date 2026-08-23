/**
 * workspace-sources.ts — Stage 261
 *
 * Unified project source connections (website / github_repo / document).
 *
 * POST   /workspace/projects/:id/sources                    — connect website or github_repo (JSON)
 * POST   /workspace/projects/:id/sources/document           — upload PRD/md/txt/pdf (multipart, R2)
 * GET    /workspace/projects/:id/sources?userKey=            — list
 * GET    /workspace/projects/:id/sources/:sourceId/file      — download an uploaded document (R2 proxy)
 * DELETE /workspace/projects/:id/sources/:sourceId?userKey=  — disconnect (deletes R2 object for documents)
 *
 * Ownership is enforced server-side: the project must belong to the userKey.
 * Document storage requires the EVIDENCE R2 binding; without it those routes
 * return 503 (evidence_storage_unconfigured) and the JSON source types keep working.
 */
import { Hono } from "hono";
import { corsMiddleware } from "./cors.js";
import type { Env } from "../env.js";
import { getProject } from "../workspace/db.js";
import { normalizeGithubRepoRef } from "../workspace/github-repo-ref.js";
import {
  insertProjectSource,
  listProjectSources,
  getProjectSourceById,
  deleteProjectSource,
} from "../workspace/project-sources-db.js";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_LABEL_LEN = 120;
const MAX_REFERENCE_LEN = 500;
const MAX_SOURCES_PER_PROJECT = 50;

const DOCUMENT_EXTENSIONS: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  pdf: "application/pdf",
};

/** owner/repo — same shape GitHub accepts. */
// 저장소 참조 정규화는 github-repo-ref.ts 단일 출처를 쓴다. 종전엔 이 파일이
// bare "owner/repo"만 받는 정규식을 따로 갖고 있어, 사용자가 브라우저에서 복사한
// GitHub **주소를 붙여넣으면 invalid_repo로 거절**했다 — 정작 그 값을 소비하는
// 수리 작업은 이미 주소를 정규화하고 있었는데도. (Bae 2026-08-23 실사용 지적)

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Keep only a safe basename for the R2 key (no traversal, no odd chars). */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
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

export function createWorkspaceSourcesRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", corsMiddleware);

  // ── POST /workspace/projects/:id/sources (website | github_repo) ───────────
  app.post("/workspace/projects/:id/sources", async (c) => {
    const projectId = c.req.param("id");

    let body: { userKey?: unknown; type?: unknown; reference?: unknown; label?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid_json" }, 400);
    }

    const userKey = typeof body.userKey === "string" ? body.userKey : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const type = body.type;
    if (type !== "website" && type !== "github_repo") {
      // documents go through the multipart route
      return c.json({ ok: false, error: "invalid_type" }, 400);
    }

    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!reference || reference.length > MAX_REFERENCE_LEN) {
      return c.json({ ok: false, error: "invalid_reference" }, 400);
    }
    if (type === "website" && !isValidHttpUrl(reference)) {
      return c.json({ ok: false, error: "invalid_url" }, 400);
    }
    // 관대하게 받되 저장은 정규화된 owner/repo 하나로 — 같은 저장소가 형태만
    // 달라 중복 행이 되지 않도록.
    let storedReference = reference;
    if (type === "github_repo") {
      const normalized = normalizeGithubRepoRef(reference);
      if (!normalized) return c.json({ ok: false, error: "invalid_repo" }, 400);
      storedReference = normalized;
    }

    const label = typeof body.label === "string" ? body.label.trim().slice(0, MAX_LABEL_LEN) : undefined;

    const owned = await requireOwnedProject(c.env, projectId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const existing = await listProjectSources(c.env, projectId);
      if (existing.length >= MAX_SOURCES_PER_PROJECT) {
        return c.json({ ok: false, error: "source_limit_reached" }, 400);
      }
      const source = await insertProjectSource(c.env, { projectId, userKey, type, reference: storedReference, label });
      return c.json({ ok: true, source }, 201);
    } catch (err) {
      console.error("[workspace/sources POST] failed:", err);
      return c.json({ ok: false, error: "save_failed" }, 500);
    }
  });

  // ── POST /workspace/projects/:id/sources/document (multipart upload → R2) ──
  app.post("/workspace/projects/:id/sources/document", async (c) => {
    const projectId = c.req.param("id");
    if (!c.env.EVIDENCE) return c.json({ ok: false, error: "evidence_storage_unconfigured" }, 503);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ ok: false, error: "invalid_form" }, 400);
    }

    const userKey = typeof form.get("userKey") === "string" ? (form.get("userKey") as string) : "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    // Workers' FormData typing narrows entries to string; duck-type the File.
    const entry = form.get("file") as unknown;
    const isFileLike =
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as File).arrayBuffer === "function" &&
      typeof (entry as File).size === "number";
    if (!isFileLike) return c.json({ ok: false, error: "file_required" }, 400);
    const file = entry as File;
    if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
      return c.json({ ok: false, error: "file_too_large" }, 400);
    }

    const filename = safeFilename(file.name || "document");
    const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
    const contentType = DOCUMENT_EXTENSIONS[ext];
    if (!contentType) return c.json({ ok: false, error: "unsupported_file_type" }, 400);

    const rawLabel = form.get("label");
    const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim().slice(0, MAX_LABEL_LEN) : filename;

    const owned = await requireOwnedProject(c.env, projectId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const existing = await listProjectSources(c.env, projectId);
      if (existing.length >= MAX_SOURCES_PER_PROJECT) {
        return c.json({ ok: false, error: "source_limit_reached" }, 400);
      }

      // Insert first so the R2 key embeds the source id (stable, collision-free).
      const source = await insertProjectSource(c.env, {
        projectId,
        userKey,
        type: "document",
        reference: "pending",
        label,
        contentType,
        sizeBytes: file.size,
      });
      const key = `docs/${userKey}/${projectId}/${source.id}/${filename}`;
      await c.env.EVIDENCE.put(key, await file.arrayBuffer(), { httpMetadata: { contentType } });
      await c.env.DB.prepare(`UPDATE project_sources SET reference = ? WHERE id = ?`).bind(key, source.id).run();

      return c.json({ ok: true, source: { ...source, reference: key } }, 201);
    } catch (err) {
      console.error("[workspace/sources document POST] failed:", err);
      return c.json({ ok: false, error: "upload_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/sources ────────────────────────────────────
  app.get("/workspace/projects/:id/sources", async (c) => {
    const projectId = c.req.param("id");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    const owned = await requireOwnedProject(c.env, projectId, userKey);
    if (!owned.ok) return c.json({ ok: false, error: owned.error }, owned.status);

    try {
      const sources = await listProjectSources(c.env, projectId);
      return c.json({ ok: true, sources });
    } catch (err) {
      console.error("[workspace/sources GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── GET /workspace/projects/:id/sources/:sourceId/file (document download) ─
  app.get("/workspace/projects/:id/sources/:sourceId/file", async (c) => {
    const projectId = c.req.param("id");
    const sourceId = c.req.param("sourceId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);
    if (!c.env.EVIDENCE) return c.json({ ok: false, error: "evidence_storage_unconfigured" }, 503);

    try {
      const source = await getProjectSourceById(c.env, sourceId);
      if (!source || source.projectId !== projectId || source.type !== "document") {
        return c.json({ ok: false, error: "not_found" }, 404);
      }
      if (source.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      const obj = await c.env.EVIDENCE.get(source.reference);
      if (!obj) return c.json({ ok: false, error: "not_found" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": source.contentType ?? "application/octet-stream",
          "cache-control": "private, max-age=60",
        },
      });
    } catch (err) {
      console.error("[workspace/sources file GET] failed:", err);
      return c.json({ ok: false, error: "query_failed" }, 500);
    }
  });

  // ── DELETE /workspace/projects/:id/sources/:sourceId ───────────────────────
  app.delete("/workspace/projects/:id/sources/:sourceId", async (c) => {
    const projectId = c.req.param("id");
    const sourceId = c.req.param("sourceId");
    const userKey = c.req.query("userKey") ?? "";
    if (!userKey) return c.json({ ok: false, error: "userKey_required" }, 400);

    try {
      const source = await getProjectSourceById(c.env, sourceId);
      if (!source || source.projectId !== projectId) return c.json({ ok: false, error: "not_found" }, 404);
      if (source.userKey !== userKey) return c.json({ ok: false, error: "forbidden" }, 403);

      if (source.type === "document" && c.env.EVIDENCE && source.reference !== "pending") {
        await c.env.EVIDENCE.delete(source.reference).catch(() => {});
      }
      await deleteProjectSource(c.env, sourceId);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[workspace/sources DELETE] failed:", err);
      return c.json({ ok: false, error: "delete_failed" }, 500);
    }
  });

  return app;
}
