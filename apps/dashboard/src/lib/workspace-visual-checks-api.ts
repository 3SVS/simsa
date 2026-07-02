"use client";

/**
 * Stage 262 — dashboard API client for persisted visual checks (시각 검수).
 * Read-only surface: the runs are uploaded by the Simsa inspection tooling
 * (Stage 261); the dashboard lists them and renders the Korean non-dev report.
 */

export const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";

// ─── Types (mirrors central-plane workspace-visual-checks.ts) ────────────────

export type VisualCheckExecutor = "local" | "container";

export type VisualCheckListItem = {
  id: string;
  targetUrl: string;
  decision: string;
  works: boolean | null;
  status: string;
  executor: VisualCheckExecutor;
  evidenceCount: number;
  createdAt: string;
};

export type NonDevFinding = {
  severity: "high" | "medium" | "low" | "info";
  what: string;
  why: string;
  how: string;
  evidence?: string;
};

export type NonDevReport = {
  title?: string;
  target?: string;
  intent?: string;
  verdict?: string;
  oneLine?: string;
  works?: boolean | null;
  findings?: NonDevFinding[];
  nextSteps?: string[];
  notes?: string[];
};

export type VisualCheckDetail = {
  id: string;
  projectId: string;
  targetUrl: string;
  intent: string;
  decision: string;
  works: boolean | null;
  status: string;
  executor: VisualCheckExecutor;
  report: NonDevReport | null;
  agentPrompt?: string;
  evidenceKeys: string[];
  createdAt: string;
};

export type VisualChecksListResponse =
  | { ok: true; checks: VisualCheckListItem[] }
  | { ok: false; error: string };

export type VisualCheckDetailResponse =
  | { ok: true; check: VisualCheckDetail }
  | { ok: false; error: string };

// ─── Calls ────────────────────────────────────────────────────────────────────

export async function listVisualChecks(
  projectId: string,
  userKey: string,
): Promise<VisualChecksListResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as VisualChecksListResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getVisualCheck(
  projectId: string,
  runId: string,
  userKey: string,
): Promise<VisualCheckDetailResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as VisualCheckDetailResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
