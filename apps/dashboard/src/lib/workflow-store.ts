"use client";

import type { Project, RequirementItem } from "./mock-data";

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

const DRAFT_KEY = "conclave_wf_draft";
const PROJECTS_KEY = "conclave_wf_projects";

export function saveDraft(draft: WorkflowDraft): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function loadDraft(): WorkflowDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as WorkflowDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DRAFT_KEY);
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
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function loadLocalProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
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
  } catch {
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
  } catch {
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
