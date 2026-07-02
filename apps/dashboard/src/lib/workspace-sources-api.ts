"use client";

/**
 * Stage 262 — dashboard API client for unified project sources (연결):
 * website URL, GitHub repo (owner/repo), uploaded documents (PRD/md/txt/pdf).
 * Ownership is enforced server-side; the userKey travels with every call.
 */

export const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

// ─── Types (mirrors central-plane workspace-sources.ts) ──────────────────────

export type ProjectSourceType = "website" | "github_repo" | "document";

export type ProjectSource = {
  id: string;
  type: ProjectSourceType;
  reference: string;
  label?: string;
  contentType?: string;
  sizeBytes?: number;
  createdAt: string;
};

export type SourcesListResponse =
  | { ok: true; sources: ProjectSource[] }
  | { ok: false; error: string };

export type SourceMutationResponse =
  | { ok: true; source: ProjectSource }
  | { ok: false; error: string };

export type SourceDeleteResponse = { ok: true } | { ok: false; error: string };

// ─── Calls ────────────────────────────────────────────────────────────────────

export async function listProjectSources(
  projectId: string,
  userKey: string,
): Promise<SourcesListResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/sources?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as SourcesListResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function connectProjectSource(
  projectId: string,
  input: { userKey: string; type: "website" | "github_repo"; reference: string; label?: string },
): Promise<SourceMutationResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/sources`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as SourceMutationResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function uploadProjectDocument(
  projectId: string,
  userKey: string,
  file: File,
  label?: string,
): Promise<SourceMutationResponse> {
  try {
    const form = new FormData();
    form.set("userKey", userKey);
    if (label && label.trim()) form.set("label", label.trim());
    form.set("file", file);
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/sources/document`,
      { method: "POST", body: form, signal: AbortSignal.timeout(60000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as SourceMutationResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function deleteProjectSource(
  projectId: string,
  sourceId: string,
  userKey: string,
): Promise<SourceDeleteResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}?userKey=${encodeURIComponent(userKey)}`,
      { method: "DELETE", signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as SourceDeleteResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Download URL for an uploaded document (opens in a new tab / browser viewer). */
export function buildSourceFileUrl(projectId: string, sourceId: string, userKey: string): string {
  return `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/file?userKey=${encodeURIComponent(userKey)}`;
}
