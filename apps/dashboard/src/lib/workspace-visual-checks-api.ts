"use client";

/**
 * Stage 262 — dashboard API client for persisted visual checks (시각 검수).
 * The runs are uploaded by the Simsa inspection tooling (Stage 261); the
 * dashboard lists them and renders the Korean non-dev report. Stage 264 adds
 * the one-click run dispatch (POST …/visual-checks/run, Stage 263 backend).
 * Stage 269 adds the repair loop client (POST/GET …/:runId/repair, Stage 268
 * backend): "[고치기]" turns a failed check into a repair branch + PR (code
 * changes since Stage 270, or a fix-brief draft PR as the fallback).
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
  /** Train C — C0 (0069): the run this one re-checked. The server has sent it since C0; absent on older servers. */
  sourceCheckId?: string | null;
  /** Train C — C2b (0069): the human acceptance label (plain string on the wire — normalize before use). */
  userVerdict?: string | null;
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
  /**
   * Train C — C2b (계약 3): one paste-ready block for chat builders (Lovable /
   * Bolt / v0 / Replit / Base44) in the report locale — no branch / terminal /
   * PR / commit vocabulary. Absent on runs written before Train C; the CLI
   * `agentPrompt` on the detail stays as before.
   */
  builderPrompt?: string;
  /** SI 티어 A5: 지시서 수용 기준별 결과(있을 때만). 개수이지 점수가 아니다. */
  acceptance?: {
    total: number;
    noProblem: number;
    notConfirmed: number;
    broken: number;
    notRun: number;
    items: Array<{ acceptanceId: string; featureTitle: string; then: string; status: "no_problem" | "not_confirmed" | "broken" | "not_run"; note?: string }>;
  };
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
  /** Train C — C0: the run this one re-checked (null/absent for first runs and old servers). */
  sourceCheckId?: string | null;
  /**
   * Train C — C2b (계약 2): the human acceptance label the user chose on this
   * report, if any. Kept as a plain string on the wire — normalizeUserVerdict()
   * maps it to the four known values (unknown → null) before rendering.
   */
  userVerdict?: string | null;
  userVerdictAt?: string | null;
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
  /**
   * Train C — C0 (계약 1): the run this one re-checks. The server inherits that
   * run's intent (when `intent` is absent) and targetUrl (when no sourceId /
   * targetUrl is given), and stores `source_check_id` on the new row. Built by
   * buildRecheckBody() — never hand-assembled in a page.
   */
  sourceCheckId?: string;
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
  /** Train C — C0: echoed back when the run was queued as a re-check. Absent on old servers. */
  sourceCheckId?: string | null;
};

/**
 * Train W — W-2 (D-7 amend): the extra fields of a 429 `daily_limit_reached`
 * answer. All optional — older servers never send them, and the values are a
 * JSON cast here, so the UI reads them only through readDailyLimit()
 * (lib/daily-limit.mjs), which validates each one. A 503 kill-switch answer
 * (`inspection_disabled` / `repair_disabled`) carries no extra fields.
 */
export type DailyLimitErrorFields = {
  kind?: "inspection" | "repair";
  limit?: number;
  resetAt?: string;
};

export type VisualCheckRunResponse =
  | { ok: true; check: VisualCheckRunCheck; dispatched: boolean; note?: string }
  | ({ ok: false; error: string } & DailyLimitErrorFields);

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
  /**
   * Stage 270: how the repair concluded — "auto_fix" (real code changes) or
   * "brief_only" (fix-brief draft PR). Null on legacy rows and while in
   * flight; kept open (string) for forward compat. See repairDoneKind().
   */
  mode?: string | null;
  /**
   * Train W — W-3 ③ (contract 3): did the repair container's post-apply check
   * cover every changed file? Computed over `autoFix.changedFiles` only
   * (SIMSA-FIX-BRIEF.md, committed alongside, is excluded). false = something
   * outside `node --check` (.js / .mjs) changed → on an auto_fix card the line
   * "we couldn't confirm the fixed code builds". true = all .js/.mjs and
   * passed; null = brief_only (no code changed) / legacy / undecidable. Absent
   * on old servers. Read only through showBuildUnverified().
   */
  buildVerified?: boolean | null;
  /** Stage 270: number of code files the repair changed (auto_fix). Null otherwise; absent on old servers. */
  changedFiles?: number | null;
  /**
   * Train C — C2a (0069): the re-check verify-sweep ran after this repair, and its outcome
   * (true works · false still broken · null not judged). Read by the C-3 receipt only through
   * buildReceiptView() — the fix and the verdict stay in separate sections.
   */
  verifyCheckId?: string | null;
  resolved?: boolean | null;
};

export type RepairRequestResponse =
  | { ok: true; repair: RepairJob; dispatched: boolean; note?: string }
  | ({
      ok: false;
      error: string;
      /** Korean user-facing message on 400 codes (run_not_repairable, …). */
      message?: string;
      /** Present on 409 repair_already_active. */
      activeJobId?: string;
    } & DailyLimitErrorFields);

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
 * run_already_active, project_not_found, forbidden, invalid_intent, and
 * (Train W) daily_limit_reached (429, with kind/limit/resetAt) and
 * inspection_disabled (503). Map the whole answer with runErrorNotice().
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
 * PR: auto_fix (Stage 270) → a non-draft PR with real code changes;
 * fallback brief_only → a DRAFT PR carrying only the fix brief. Which one is
 * known only when the job is done (RepairJob.mode).
 * Known error codes: run_not_repairable, github_repo_required,
 * github_token_required, repair_already_active (409, with activeJobId),
 * run_not_found, project_not_found, forbidden, and (Train W)
 * daily_limit_reached (429, with kind/limit/resetAt) and repair_disabled (503).
 * Map the whole answer with repairErrorNotice().
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

// ── Train C — C2b (2026-09-27 재정렬, 계약 2·4) — 사람 수용 라벨 + 복사 계측 ────

export type UserVerdictValue = "as_intended" | "works_but_different" | "still_broken" | "unsure";

export type UserVerdictResponse =
  | { ok: true; verdict: UserVerdictValue; at: string }
  | { ok: false; error: string };

/**
 * Record how the user received this report (D-19 north star:
 * `user_verdict = as_intended`). Re-submitting overwrites. Known error codes:
 * forbidden (403), run_not_found / project_not_found (404), invalid_verdict (400).
 * Until the server PR that adds this route is deployed the answer is a 404 —
 * the section shows its save-error copy and keeps the previous selection.
 */
export async function submitUserVerdict(
  projectId: string,
  runId: string,
  userKey: string,
  verdict: UserVerdictValue,
): Promise<UserVerdictResponse> {
  try {
    const resp = await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/verdict`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, verdict }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const data = (await resp
      .json()
      .catch(() => ({ ok: false, error: `HTTP ${resp.status}` }))) as UserVerdictResponse;
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export type FixPromptCopyTarget = "web_builder" | "cli";

/**
 * Contract 4 — usage event `workspace_fix_prompt_copied` { runId, target }.
 * "How the result was used" is one of the six data axes (D-8 envelope) and had
 * zero instrumentation before Train C. Fire-and-forget: measurement never
 * blocks the UX, so every failure (404 on an old server, network, CORS) is
 * swallowed here and the caller does not await the result.
 */
export async function recordFixPromptCopied(
  projectId: string,
  runId: string,
  userKey: string,
  target: FixPromptCopyTarget,
): Promise<void> {
  try {
    await fetch(
      `${CENTRAL_PLANE_URL}/workspace/projects/${encodeURIComponent(projectId)}/visual-checks/${encodeURIComponent(runId)}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userKey, type: "fix_prompt_copied", target }),
        keepalive: true,
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    // Telemetry only — never surface.
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
