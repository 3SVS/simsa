/**
 * workspace/verify-sweep.ts — 기준평가 §3-1: find→fix→**verify** 원 닫기 (v1 + Train C · C2a).
 *
 * 신호: App 설치 repo에서 수리 PR(head=fix/simsa-{runId})이 머지되면 웹훅이
 * `workspace_repair_merged` 이벤트를 기록한다(협의체 스폰 아님 — 킬스위치
 * 정신 준수, 기록만). 이 스윕은 10분 크론에서 그 이벤트를 소비해 **원래 런과
 * 같은 intent/target으로 재검수를 자동 디스패치**한다.
 *
 * 왜 크론 경유(즉시 아님): 머지 → 유저 플랫폼(Vercel 등) 자동 배포에 시차가
 * 있다. 머지 직후 재검수는 구버전을 검사하는 거짓 신호 — 5분 그레이스 후
 * 스윕이 정직한 타이밍이다.
 *
 * 무마이그레이션 설계: 새 테이블 없이 usage events를 신호 큐로 재사용.
 * 중복 방지는 결정론 — "이벤트 이후 그 프로젝트에 생성된 재검수 런 존재"면
 * 소비 완료로 간주(런 행 자체가 처리 장부).
 *
 * Train C · C2a (재정렬 2026-09-27, W2~W3 (b)):
 *   - 재검수 dispatch에 프로젝트 지시서의 **acceptancePlan**을 싣는다 — 원 런과 같은
 *     자(尺)로 재야 "고쳐졌다"가 같은 기준의 답이 된다.
 *   - 새 런 행 `source_check_id` = 원 런(C0 계보) · region/envelope는 원 런에서 복사
 *     (크론에는 요청 컨텍스트가 없다).
 *   - 원 런의 최근 수리 잡에 `verify_check_id` = 새 런 → 콜백이 `resolved`를 찍는다.
 *
 * Train W · W-2 (재정렬 D-7 amend [PILOT], 2026-09-28):
 *   - 킬스위치 INSPECTION_ENABLED="off"면 **행을 만들지 않고** summary.skipped_disabled를 올린다.
 *     신호는 소비되지 않으므로(장부 = 런 행) 다시 켜면 24시간 창 안의 신호가 다음 스윕에서 처리된다.
 *     dispatchInspection 내부도 같은 헬퍼로 막는다(이중 안전).
 *   - 시스템이 시작한 재검수는 **유저 일일 상한에 세지 않는다**(유저가 누른 게 아니다). 대신
 *     스윕당 최대 VERIFY_SWEEP_MAX_DISPATCH(10)건 — 넘는 신호는 skipped_sweep_cap으로 다음 스윕에.
 *
 * 정직 한계(v1, 기록):
 *   - App 미설치 repo는 머지 신호가 없다 → 기존 수동 "수리 확인 재검수" CTA 유지.
 *   - [해소 0065] 재검수 locale: 런 행에 locale이 저장되어 원 런의 언어를
 *     따른다. locale 미기록 레거시 행만 ko로 폴백.
 */
import type { Env } from "../env.js";
import { acceptancePlanFromDevSpec } from "../acceptance-plan.js";
import { getProject } from "./db.js";
import { listRecentUsageEventsByType } from "./usage-events-db.js";
import { getLatestRepairJobForRun, setRepairJobVerifyCheck } from "./repair-job-db.js";
import {
  getVisualCheckById,
  insertQueuedVisualCheck,
  listVisualChecks,
  findActiveVisualCheckForProject,
  markVisualCheckFailed,
} from "./visual-check-db.js";
import { dispatchInspection } from "../routes/workspace-visual-check-runs.js";
import { inspectionEnabled } from "./service-switches.js";

export const REPAIR_MERGED_EVENT = "workspace_repair_merged";
/** 파라미터(원칙 아님): 배포 그레이스 / 신호 유효 기간. */
const GRACE_MS = 5 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Train W · W-2 [PILOT] — re-inspections one sweep may start (rows created =
 * attempts, dispatched or not). The sweep runs every 10 minutes and is not
 * charged to any user's daily cap, so this is its own cost ceiling.
 */
export const VERIFY_SWEEP_MAX_DISPATCH = 10;

export interface VerifySweepSummary {
  scanned: number;
  dispatched: number;
  skipped_already_verified: number;
  skipped_active_run: number;
  skipped_grace: number;
  skipped_missing_run: number;
  dispatch_failures: number;
  /** W-2: INSPECTION_ENABLED="off" — eligible signals left for a later sweep, no row. */
  skipped_disabled: number;
  /** W-2: past VERIFY_SWEEP_MAX_DISPATCH this sweep — left for the next one, no row. */
  skipped_sweep_cap: number;
}

export async function runVerifySweep(
  env: Env,
  opts: { nowMs?: number; publicBaseUrl?: string } = {},
): Promise<VerifySweepSummary> {
  const summary: VerifySweepSummary = {
    scanned: 0,
    dispatched: 0,
    skipped_already_verified: 0,
    skipped_active_run: 0,
    skipped_grace: 0,
    skipped_missing_run: 0,
    dispatch_failures: 0,
    skipped_disabled: 0,
    skipped_sweep_cap: 0,
  };
  let attempts = 0;
  const now = opts.nowMs ?? Date.now();
  const sinceIso = new Date(now - WINDOW_MS).toISOString();
  const events = await listRecentUsageEventsByType(env, REPAIR_MERGED_EVENT, sinceIso).catch(() => []);

  for (const ev of events) {
    summary.scanned++;
    const runId = typeof ev.metadata?.["runId"] === "string" ? (ev.metadata["runId"] as string) : null;
    if (!runId) {
      summary.skipped_missing_run++;
      continue;
    }
    // 배포 그레이스: 머지 직후는 구버전 검사 위험 — 다음 스윕에서 처리.
    if (now - Date.parse(ev.createdAt) < GRACE_MS) {
      summary.skipped_grace++;
      continue;
    }
    const origin = await getVisualCheckById(env, runId).catch(() => null);
    if (!origin) {
      summary.skipped_missing_run++;
      continue;
    }
    // 소비 장부 = 런 행: 이벤트 이후 이 프로젝트에 생성된 런이 있으면 완료.
    const runs = await listVisualChecks(env, origin.projectId).catch(() => []);
    if (runs.some((r) => r.id !== runId && r.createdAt > ev.createdAt)) {
      summary.skipped_already_verified++;
      continue;
    }
    // 프로젝트당 활성 런 1개 규칙 존중 — 다음 스윕에서 재시도.
    const active = await findActiveVisualCheckForProject(env, origin.projectId).catch(() => null);
    if (active) {
      summary.skipped_active_run++;
      continue;
    }
    // W-2: kill switch — same helper dispatchInspection enforces, asked before
    // any row exists. The signal stays unconsumed (no run row = no ledger entry).
    if (!inspectionEnabled(env)) {
      summary.skipped_disabled++;
      continue;
    }
    // W-2: per-sweep ceiling (system re-inspections are not charged to users).
    if (attempts >= VERIFY_SWEEP_MAX_DISPATCH) {
      summary.skipped_sweep_cap++;
      continue;
    }
    attempts++;

    // C2a: 같은 자(尺) — 프로젝트 지시서의 수용 기준 시나리오. 지시서가 없으면 빈 배열
    // (종전대로 핵심 흐름만). 프로젝트 조회 실패도 종전 동작으로 정직하게 폴백.
    const project = await getProject(env, origin.projectId).catch(() => null);
    const acceptancePlan = acceptancePlanFromDevSpec(project?.devSpec);

    let run;
    try {
      run = await insertQueuedVisualCheck(env, {
        projectId: origin.projectId,
        userKey: origin.userKey,
        targetUrl: origin.targetUrl,
        intent: origin.intent,
        locale: origin.locale ?? "ko",
        // 0069: 크론에는 요청이 없다 — 봉투는 원 런에서 물려받고 계보를 남긴다.
        region: origin.region,
        envelopeJson: origin.envelopeJson,
        sourceCheckId: origin.id,
      });
    } catch (err) {
      console.error("[verify-sweep] insert failed:", err);
      summary.dispatch_failures++;
      continue;
    }
    // C2a: 수리 잡 ↔ 재검수 런 연결. 콜백(/internal/visual-check-done)이 이 링크로
    // resolved를 찍는다. 실패해도 재검수는 진행한다(계측이 UX를 막지 않는다).
    const repairJob = await getLatestRepairJobForRun(env, runId).catch(() => null);
    if (repairJob) {
      await setRepairJobVerifyCheck(env, repairJob.id, run.id).catch((err) => {
        console.error("[verify-sweep] verify_check_id link failed:", err);
      });
    }
    const dispatch = await dispatchInspection(env, {
      runId: run.id,
      projectId: origin.projectId,
      userKey: origin.userKey,
      targetUrl: origin.targetUrl,
      intent: origin.intent,
      locale: origin.locale ?? "ko", // 0065: 원 런의 언어 — 레거시 행만 ko 폴백
      acceptancePlan,
      publicBaseUrl: opts.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? "https://conclave-ai.seunghunbae.workers.dev",
    });
    if (dispatch.dispatched) {
      summary.dispatched++;
      console.log(`[verify-sweep] re-inspection dispatched: run=${run.id} after merged repair of ${runId}`);
    } else {
      summary.dispatch_failures++;
      await markVisualCheckFailed(env, run.id, dispatch.note ?? "dispatch_failed").catch(() => undefined);
    }
  }
  return summary;
}

/**
 * PR #561 review P1 — is this merged `fix/simsa-<runId>` PR really the repair
 * Simsa made for that run? The webhook asks before it records a signal.
 *
 * The run id is public (it IS the repair branch name on public repos), so the
 * branch name alone proves nothing: anyone could merge a same-named branch in
 * a repo of their own App installation and get a re-inspection started in the
 * victim's project — on our bill, outside every daily cap — and overwrite the
 * victim's repair-job verify link (the basis of `resolved`, the S2 billing
 * condition). A signal counts only when ALL hold:
 *   - the job is this run's job, of the same project and user as the run
 *   - the PR's base repository is the job's repository (case-insensitive — GitHub names are)
 *   - the head branch lives in that same repository (the container pushes
 *     there; a fork's head.repo differs, a deleted fork's is unknown → no)
 *   - the head branch is exactly the job's branch
 * Pure; the webhook passes the parsed payload fields.
 */
export function repairMergeSignalMatches(input: {
  runId: string;
  run: { id: string; projectId: string; userKey: string };
  job: { visualCheckId: string; projectId: string; userKey: string; repoFullName: string; branchName?: string | null };
  headRef: string;
  baseRepoFullName: string;
  headRepoFullName: string;
}): boolean {
  const { runId, run, job } = input;
  const same = (a: string, b: string) => a.length > 0 && a.toLowerCase() === b.toLowerCase();
  if (run.id !== runId || job.visualCheckId !== runId) return false;
  if (job.projectId !== run.projectId || job.userKey !== run.userKey) return false;
  if (!same(input.baseRepoFullName, job.repoFullName)) return false;
  if (!same(input.headRepoFullName, input.baseRepoFullName)) return false;
  const expectedBranch = job.branchName && job.branchName.length > 0 ? job.branchName : `fix/simsa-${runId}`;
  return input.headRef === expectedBranch;
}
