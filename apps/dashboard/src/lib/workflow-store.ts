"use client";

import type { Project, RequirementItem } from "./mock-data";
import {
  PROJECTS_BASE,
  DRAFT_BASE,
  ACTIVE_NS_KEY,
  ANON_NS,
  namespaceFor,
  projectsKeyFor,
  draftKeyFor,
  mergeProjectsById,
  planNamespaceTransition,
} from "./project-namespace.mjs";

export type WorkflowDraft = {
  ideaText: string;
  understanding: Understanding | null;
  answers: Record<string, string>;
  spec: GeneratedSpec | null;
  requirements: RequirementItem[];
};

export type Understanding = {
  summary: string;
  targetUsers: string[];
  mainFlow: string[];
};

export type GeneratedSpec = {
  productName: string;
  tagline: string;
  targetUser: string;
  problem: string;
  included: string[];
  excluded: string[];
  userFlows: string[];
  decisions: string[];
  openDecisions: string[];
};

// ─── Account-scoped storage keys ─────────────────────────────────────────────
// Projects/drafts live under a per-account namespace (see project-namespace.mjs)
// so a second account on the same browser never inherits the first account's
// projects. `conclave_active_ns` records the current identity's namespace;
// `setActiveAccountNamespace` / `clearActiveAccount` reconcile it on sign-in and
// sign-out. Old un-namespaced blobs are migrated into the current namespace once.

function activeNamespace(): string {
  if (typeof window === "undefined") return ANON_NS;
  try {
    return localStorage.getItem(ACTIVE_NS_KEY) || ANON_NS;
  } catch {
    return ANON_NS;
  }
}

function readProjectsAt(key: string): Project[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch (err) {
    console.error("[workflow-store] corrupt localStorage entry — data hidden from UI:", err);
    return [];
  }
}

// One-time move of the pre-namespace global blobs into the current namespace, so
// existing users don't see their local projects vanish when this ships. The
// legacy keys are the bare bases (no ":ns" suffix); after the move they're
// removed, making this idempotent.
function migrateLegacyBlobs(): void {
  if (typeof window === "undefined") return;
  try {
    const ns = activeNamespace();
    const legacyProjects = localStorage.getItem(PROJECTS_BASE);
    if (legacyProjects !== null) {
      const dest = projectsKeyFor(ns);
      const merged = mergeProjectsById(readProjectsAt(dest), readProjectsAt(PROJECTS_BASE));
      localStorage.setItem(dest, JSON.stringify(merged));
      localStorage.removeItem(PROJECTS_BASE);
    }
    const legacyDraft = localStorage.getItem(DRAFT_BASE);
    if (legacyDraft !== null) {
      const dest = draftKeyFor(ns);
      if (localStorage.getItem(dest) === null) localStorage.setItem(dest, legacyDraft);
      localStorage.removeItem(DRAFT_BASE);
    }
  } catch (err) {
    console.error("[workflow-store] legacy migration failed:", err);
  }
}

export function saveDraft(draft: WorkflowDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(draftKeyFor(activeNamespace()), JSON.stringify(draft));
}

export function loadDraft(): WorkflowDraft | null {
  if (typeof window === "undefined") return null;
  migrateLegacyBlobs();
  try {
    const raw = localStorage.getItem(draftKeyFor(activeNamespace()));
    return raw ? (JSON.parse(raw) as WorkflowDraft) : null;
  } catch (err) {
    console.error("[workflow-store] corrupt localStorage entry — data hidden from UI:", err);
    return null;
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(draftKeyFor(activeNamespace()));
}

/**
 * Fired on window whenever the projects bucket changes (save/delete), so
 * always-mounted listeners (AppSidebar) can re-read without a route change.
 * Live finding 2026-07-15: deleting on /projects left the sidebar entry
 * behind until the next navigation — same class as the 2026-07-10 create
 * bug, fixed at the store level this time so every future mutator is covered.
 */
export const PROJECTS_CHANGED_EVENT = "simsa:projects-changed";

function notifyProjectsChanged(): void {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT)); } catch { /* non-DOM env */ }
}

export function saveProject(project: Project): void {
  if (typeof window === "undefined") return;
  const projects = loadLocalProjects();
  const idx = projects.findIndex((p) => p.id === project.id);
  if (idx >= 0) {
    projects[idx] = project;
  } else {
    projects.unshift(project);
  }
  localStorage.setItem(projectsKeyFor(activeNamespace()), JSON.stringify(projects));
  notifyProjectsChanged();
}

export function loadLocalProjects(): Project[] {
  if (typeof window === "undefined") return [];
  migrateLegacyBlobs();
  return readProjectsAt(projectsKeyFor(activeNamespace()));
}

/**
 * Delete a project and every local sibling blob it owns: its extended data
 * (`conclave_wf_ext_*`), builder-pack outcomes (`conclave_outcomes_*`), and its
 * entry in the sync-failed list. The projects list is authoritative for the UI,
 * so removing it from the active namespace bucket makes the project vanish
 * immediately. Server-side D1/R2 cleanup is a separate best-effort mirror call.
 * Returns true if a project with that id was present and removed.
 */
export function deleteProject(id: string): boolean {
  if (typeof window === "undefined") return false;
  const key = projectsKeyFor(activeNamespace());
  const projects = readProjectsAt(key);
  const remaining = projects.filter((p) => p.id !== id);
  const existed = remaining.length !== projects.length;
  localStorage.setItem(key, JSON.stringify(remaining));
  // Sibling blobs keyed by project id — leaving these would orphan storage.
  try { localStorage.removeItem(EXT_KEY(id)); } catch { /* storage unavailable */ }
  try { localStorage.removeItem(OUTCOMES_KEY(id)); } catch { /* storage unavailable */ }
  // Drop from the sync-failed list so a deleted project never re-surfaces a banner.
  try {
    const raw = localStorage.getItem(SYNC_FAILED_KEY);
    if (raw) {
      const list = (JSON.parse(raw) as string[]).filter((x) => x !== id);
      localStorage.setItem(SYNC_FAILED_KEY, JSON.stringify(list));
    }
  } catch { /* storage unavailable or corrupt — nothing else to do */ }
  notifyProjectsChanged();
  return existed;
}

/**
 * Reconcile the active namespace to a signed-in identity. Call on every
 * confirmed sign-in (with the account email/id) and on sign-out (with null).
 * Moving FROM anonymous TO an account "claims" the anonymous projects into the
 * account bucket so pre-sign-in work isn't stranded; a different account never
 * inherits them.
 */
export function setActiveAccountNamespace(accountId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    migrateLegacyBlobs();
    const prevNs = activeNamespace();
    const { nextNs, claimAnon } = planNamespaceTransition(prevNs, accountId);
    if (claimAnon) {
      const anonKey = projectsKeyFor(ANON_NS);
      const anonProjects = readProjectsAt(anonKey);
      if (anonProjects.length) {
        const destKey = projectsKeyFor(nextNs);
        const merged = mergeProjectsById(readProjectsAt(destKey), anonProjects);
        localStorage.setItem(destKey, JSON.stringify(merged));
        localStorage.removeItem(anonKey);
      }
    }
    localStorage.setItem(ACTIVE_NS_KEY, nextNs);
  } catch (err) {
    console.error("[workflow-store] namespace reconcile failed:", err);
  }
}

/** Sign-out: return to the (empty) anonymous bucket; account data is preserved. */
export function clearActiveAccount(): void {
  setActiveAccountNamespace(null);
}

export function getLocalProject(id: string): Project | undefined {
  return loadLocalProjects().find((p) => p.id === id);
}

export function generateProjectId(): string {
  const ts = Date.now().toString(36).slice(-5);
  const rand = Math.random().toString(36).slice(2, 5);
  return `proj_${ts}${rand}`;
}

// ─── User key (anonymous, persisted) ─────────────────────────────────────────

const USER_KEY_STORAGE = "conclave_user_key";

export function getUserKey(): string {
  if (typeof window === "undefined") return "server";
  let key = localStorage.getItem(USER_KEY_STORAGE);
  if (!key) {
    key = `uk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem(USER_KEY_STORAGE, key);
  }
  return key;
}

// ─── Extended project data (productSpec, check results, fix suggestions) ─────

import type { WorkspaceProductSpec } from "./workspace-types";
import type { CheckDraftResponse, FixSuggestionResponse } from "./workspace-check-api";

export type ExtendedProjectData = {
  productSpec?: WorkspaceProductSpec;
  itemCriteria?: Record<string, string[]>;
  /** Per-item free-text notes the user attaches to checking items (editable). */
  itemNotes?: Record<string, string>;
  checkResults?: CheckDraftResponse;
  fixSuggestions?: Record<string, FixSuggestionResponse>;
  /** Which branch this project entered through — the progress map adapts to it
   *  (code branch: prepare step is optional, review never locks on items). */
  entryPath?: "idea" | "code" | "spec";
  /** C2 (openQuestions 질문화): answers the user settled for spec.openDecisions,
   *  keyed by the decision text. Kept out of the core spec so example projects
   *  aren't mutated — the spec page reads this to mark a decision "resolved". */
  resolvedOpenDecisions?: Record<string, string>;
};

const EXT_KEY = (id: string) => `conclave_wf_ext_${id}`;

export function saveExtendedProjectData(projectId: string, patch: Partial<ExtendedProjectData>): void {
  if (typeof window === "undefined") return;
  const existing = loadExtendedProjectData(projectId) ?? {};
  localStorage.setItem(EXT_KEY(projectId), JSON.stringify({ ...existing, ...patch }));
}

export function loadExtendedProjectData(projectId: string): ExtendedProjectData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(EXT_KEY(projectId));
    return raw ? (JSON.parse(raw) as ExtendedProjectData) : null;
  } catch (err) {
    console.error("[workflow-store] corrupt localStorage entry — data hidden from UI:", err);
    return null;
  }
}

// ─── Builder pack outcome recording ──────────────────────────────────────────

import type { ExportTarget } from "./workspace-export-api";

export type OutcomeStatus = "worked" | "partial" | "failed" | "not_checked";

export type BuilderPackOutcome = {
  id: string;
  projectId: string;
  target: ExportTarget;
  selectedItemIds: string[];
  outcome: OutcomeStatus;
  note?: string;
  createdAt: string;
};

const OUTCOMES_KEY = (projectId: string) => `conclave_outcomes_${projectId}`;

export function saveOutcome(outcome: BuilderPackOutcome): void {
  if (typeof window === "undefined") return;
  const existing = loadOutcomes(outcome.projectId);
  existing.unshift(outcome);
  localStorage.setItem(OUTCOMES_KEY(outcome.projectId), JSON.stringify(existing.slice(0, 50)));
}

export function loadOutcomes(projectId: string): BuilderPackOutcome[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OUTCOMES_KEY(projectId));
    return raw ? (JSON.parse(raw) as BuilderPackOutcome[]) : [];
  } catch (err) {
    console.error("[workflow-store] corrupt localStorage entry — data hidden from UI:", err);
    return [];
  }
}

export function generateOutcomeId(): string {
  const ts = Date.now().toString(36).slice(-5);
  const rand = Math.random().toString(36).slice(2, 5);
  return `oc_${ts}${rand}`;
}

// ── Server-sync failure flag (UX P1: silent .catch(() => undefined) saves) ──
// Local-first saves fire-and-forget to the server; when that write fails the
// user must still learn about it. Callers mark the project here and the
// project overview shows a one-time dismissible banner.
const SYNC_FAILED_KEY = "simsa:sync-failed";

export function markProjectSyncFailed(projectId: string): void {
  try {
    const raw = window.localStorage.getItem(SYNC_FAILED_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(projectId)) list.push(projectId);
    window.localStorage.setItem(SYNC_FAILED_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — nothing else we can do */
  }
}

export function consumeProjectSyncFailed(projectId: string): boolean {
  try {
    const raw = window.localStorage.getItem(SYNC_FAILED_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw) as string[];
    if (!list.includes(projectId)) return false;
    window.localStorage.setItem(SYNC_FAILED_KEY, JSON.stringify(list.filter((x) => x !== projectId)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply PR-review run results to the local project's requirement statuses.
 *
 * Review results lived only in the run — the project list kept showing
 * "0% · 시작 전 N" even after items passed (2026-07-05 live finding). Any
 * surface that lands a finished run calls this so 목록/개요 진행률이 실제
 * 검수 결과를 반영한다. Unknown itemIds are ignored (deleted items).
 */
export function applyReviewResultsToLocalProject(
  projectId: string,
  results: ReadonlyArray<{ itemId: string; status: string }>,
): void {
  if (typeof window === "undefined" || results.length === 0) return;
  const project = getLocalProject(projectId);
  if (!project) return; // mock/demo projects are read-only
  const byId = new Map(results.map((r) => [r.itemId, r.status]));
  const allowed = new Set(["passed", "failed", "inconclusive", "needs_decision"]);
  let changed = false;
  const requirements = project.requirements.map((req) => {
    const next = byId.get(req.id);
    if (next && allowed.has(next) && next !== req.status) {
      changed = true;
      return { ...req, status: next as typeof req.status };
    }
    return req;
  });
  if (changed) saveProject({ ...project, requirements });
}
