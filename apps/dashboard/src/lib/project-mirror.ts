"use client";

/**
 * Self-heal for the "project row missing in D1" class of failures.
 *
 * The dashboard is local-first: the authoritative project lives in
 * localStorage, and the D1 row is a best-effort mirror. When that mirror write
 * failed (429 beta cap, timeout, old bug), every ownership-gated server call —
 * most visibly POST /workspace/projects/:id/repo — 404s FOREVER, which the
 * 2026-07-10 live incident surfaced as "저장소 연결이 계속 풀려요" (the repo
 * link was never written at all).
 *
 * Since ALL the data needed to recreate the row is still local, the fix is to
 * re-mirror on demand: callers that hit an ownership 404 call this, then retry
 * the original request once.
 */
import { getLocalProject, loadExtendedProjectData, getUserKey } from "./workflow-store";
import { saveProjectToDb } from "./workspace-check-api";
import { isExampleProject } from "./mock-data";

/** Re-mirror the local project into D1. Returns true when the row now exists. */
export async function mirrorLocalProjectToDb(projectId: string): Promise<boolean> {
  if (isExampleProject(projectId)) return false; // demos are never mirrored
  const project = getLocalProject(projectId);
  if (!project) return false; // nothing local to mirror from
  const ext = loadExtendedProjectData(projectId);
  const criteria = ext?.itemCriteria ?? {};
  const notes = ext?.itemNotes ?? {};
  const res = await saveProjectToDb({
    id: projectId,
    userKey: getUserKey(),
    title: project.name,
    idea: project.description ?? "",
    understood: {},
    productSpec: ext?.productSpec ?? {},
    items: project.requirements.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      criteria: criteria[r.id] ?? [],
      note: notes[r.id] || undefined,
    })),
    entryPath: ext?.entryPath,
  });
  return res.ok;
}
