"use client";

/**
 * Stage 262 — dashboard API client for persisted visual checks (시각 검수).
 * The runs are uploaded by the Simsa inspection tooling (Stage 261); the
 * dashboard lists them and renders the Korean non-dev report. Stage 264 adds
 * the one-click run dispatch (POST …/visual-checks/run, Stage 263 backend).
 * Stage 269 adds the repair loop client (POST/GET …/:runId/repair, Stage 268
 * backend): "[고치기]" turns a failed check into a repair branch + draft PR.
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

// Stage 264 — run dispatch (mirrors central-plane workspace-visual-check-runs.ts).

export type VisualCheckRunInput = {
  userKey: string;
  sourceId?: string;
  targetUrl?: string;
  intent?: string;
  /**
   * Language for the report PROSE. The report is written by the inspector at
   * run time and stored as-is, so this must be sent when the run is queued —
   * toggling the UI language afterwards re-labels the chrome but cannot
   * retranslate a finished report. Omitted → "ko".
   */
  locale?: "ko" | "en";
};

export type VisualCheckRunCheck = {
  id: string;
  projectId: string;
  targetUrl: string;
  intent: string;
  decision: string;
  works: boolean | null;
  status: string;
  executor: VisualCheckExecutor;
  createdAt: string;
};

export type VisualCheckRunResponse =
  | { ok: true; check: VisualCheckRunCheck; dispatched: boolean; note?: string }
  | { ok: false; error: string };

// Stage 269 — repair jobs (mirrors central-plane workspace-repair-jobs.ts).

export type RepairJobStatus = "queued" | "running" | "done" | "failed";

export type RepairJob = {
  id: string;
  visualCheckId: string;
  repoFullName: string;
  /** queued → running → done|failed; kept open (string) for forward compat. */
  status: string;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  /** D1 integer on the wire — may arrive as boolean or 0|1 (see isEnvCause). */
  envCause: boolean | 0 | 1;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RepairRequestResponse =
  | { ok: true; repair: RepairJob; dispatched: boolean; note?: string }
  | {
      ok: false;
      error: string;
      /** Korean user-facing message on 400 codes (run_not_repairable, …). */
      message?: string;
      /** Present on 409 repair_already_active. */
      activeJobId?: string;
    };

export type RepairGetResponse =
  | { ok: true; repair: RepairJob | null }
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

/**
 * Queue (and, when the cloud runner is available, dispatch) a new inspection.
 * With no explicit sourceId/targetUrl the backend falls back to the project's
 * most recent website source. Known error codes: website_source_required,
 * run_already_active, project_not_found, forbidden, invalid_intent.
 */
export async function runVisualCheck(
  projectId: string,
  input: VisualCheckRunInput,
): Promise<VisualCheckRunResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/run`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as VisualCheckRunResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Queue (and, when the sandbox is available, dispatch) a repair job for a
 * finished-but-not-working check. The backend creates a repair branch and a
 * DRAFT PR carrying the fix brief — it does NOT auto-apply code changes.
 * Known error codes: run_not_repairable, github_repo_required,
 * github_token_required, repair_already_active (409, with activeJobId),
 * run_not_found, project_not_found, forbidden.
 */
export async function requestRepair(
  projectId: string,
  runId: string,
  userKey: string,
): Promise<RepairRequestResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/repair`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as RepairRequestResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Latest repair job for the run (or null when none was ever started). */
export async function getRepair(
  projectId: string,
  runId: string,
  userKey: string,
): Promise<RepairGetResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/repair?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as RepairGetResponse;
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
