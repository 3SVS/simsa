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
  /**
   * 이걸 고치면 **다음 검수에서 무엇까지 확인해 드릴 수 있는지**(순환의 고리).
   * 검수를 막았던 앱의 누락(가입 불가·확인 메일 미도착·탈퇴 없음)에만 붙는다.
   */
  unlocks?: string;
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
  | {
      ok: true;
      checks: VisualCheckListItem[];
      /** 로그인 뒤 검수를 켤 수 있는 상태인가(메일 수신 설정 여부). 없으면 UI가
       *  체크박스를 비활성으로 두고 이유를 말한다 — 켰는데 아무 일도 안 일어나는
       *  것이 가장 나쁜 침묵이다. */
      signupAvailable?: boolean;
    }
  | { ok: false; error: string };

export type VisualCheckDetailResponse =
  | { ok: true; check: VisualCheckDetail }
  | { ok: false; error: string };

// Stage 264 — run dispatch (mirrors central-plane workspace-visual-check-runs.ts).

export type VisualCheckRunInput = {
  userKey: string;
  /**
   * 로그인 뒤 화면까지 확인할지 (기본 꺼짐). 켜면 우리가 그 앱에 **일회용 테스트
   * 계정을 하나 만들고**, 확인이 끝나면 정리한다. 남의 앱에 계정을 만드는 일이라
   * 사용자가 명시적으로 켜야 하고, 서버가 그 기본을 강제한다.
   */
  withSignup?: boolean;
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
  // Train E (2026-07-21): repair PR 제목/본문은 컨테이너가 잡 시점에 짓는다 —
  // 리더의 언어가 잡과 함께 이동해야 한다(런 생성과 동일 독트린). 미전송 = ko.
  locale: "ko" | "en" = "ko",
): Promise<RepairRequestResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/repair`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, locale }),
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

// ── Train M-1b (2026-07-21, design locked) — "왜 이 판정인가" 증거 체인 ──────

export type EvidenceCriterion = {
  id: string;
  text: string;
  status: "verified" | "broken" | "not_verified";
  observedBy: string[];
};

export type RunEvidence = {
  pack: {
    riskFlags: Record<string, boolean>;
    notVerified: string[];
    verified: string[];
    broken: string[];
    humanGateRequired: boolean;
  };
  gate: { decision: string; reasons: string[]; nextSafestAction: string };
  criteria: EvidenceCriterion[];
  browserFacts: {
    works: boolean | null;
    decision: string;
    consoleErrors: string[];
    failedInteractions: string[];
    screenshotCount: number;
  };
  interpretations: string[];
};

export type RunEvidenceResponse =
  | { ok: true; evidence: RunEvidence }
  | { ok: false; error: string };

export async function fetchRunEvidence(
  projectId: string,
  runId: string,
  userKey: string,
): Promise<RunEvidenceResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/evidence/${encodeURIComponent(runId)}?userKey=${encodeURIComponent(userKey)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as RunEvidenceResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
