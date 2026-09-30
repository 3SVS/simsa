// build-job-view.mjs — 문 (a) "만들기"의 순수 로직 (SI 티어 Train B — B-8 · D-4 · D-6 · D-7 · D-17).
//
// 아이디어 문으로 들어와 지시서까지 만든 비개발자가 **계정 추가 없이** '만들기' 한 번 →
// 진행 상황을 **단계로**(퍼센트 아님, D-4) 보고 → 끝나면 '내 앱' 카드에서 주소·확인 결과·
// 신고 링크를 본다. 이 파일은 서버 응답을 화면이 그릴 모양으로만 바꾼다 — 네트워크·타이머·
// 저장소 없음(node --test가 전부 덮는다). 문구는 전부 사전(t.makeApp)에 있고 여기서는 키만 정한다.
//
// 서버 계약(apps/central-plane):
//   POST /workspace/projects/:id/build              → 202 { ok, job, dispatched } · 200(dispatched:false, job failed)
//   GET  /workspace/projects/:id/build-jobs         → { ok, jobs[], hostRoot }
//   GET  /workspace/projects/:id/build-jobs/:jobId  → { ok, job, events[] }
//   상태 머신: workspace/build-job-db.ts BUILD_JOB_STATUSES — 아래 목록은 그 **거울**이고,
//   test/build-make.test.mjs가 서버 소스와 대조한다(서버가 상태를 바꾸면 테스트가 깨진다).
//
// 정직성 규칙: 빌드 실행체는 아직 완성 전이다(kind=build는 builder_stage_not_implemented로 정직
// 실패할 수 있다). 그 실패를 "아직 준비 중인 단계에서 멈췄어요"로 **그대로** 말한다 — 성공처럼
// 꾸미지 않고, 모르는 코드는 일반 문구로 돌아간다(새 서버 코드에 화면이 깨지지 않게).

import { readDailyLimit } from "./daily-limit.mjs";

// ─── 상태 머신 거울 ───────────────────────────────────────────────────────────

/** central-plane build-job-db.ts BUILD_JOB_STATUSES와 같은 순서·같은 값. */
export const BUILD_JOB_STATUSES = Object.freeze([
  "queued",
  "scaffolding",
  "implementing",
  "building",
  "testing",
  "pushed",
  "deploying",
  "done",
  "failed",
]);

/** 서버가 아직 앞으로 움직일 수 있는 상태(build-job-db.ts BUILD_JOB_ACTIVE). */
export const BUILD_ACTIVE_STATUSES = Object.freeze([
  "queued",
  "scaffolding",
  "implementing",
  "building",
  "testing",
  "pushed",
  "deploying",
]);

/**
 * 화면이 보여주는 단계 — 쉬운 이름(사전 t.makeApp.stages.*)의 키. 서버 순서를 그대로 따른다
 * (testing이 pushed·deploying보다 먼저라 "작동 확인"이 "올리기"보다 앞선다 — 꾸미지 않는다).
 */
export const BUILD_STAGES = Object.freeze(["prepare", "skeleton", "features", "verify", "test", "publish", "done"]);

/** 서버 상태 → 화면 단계. failed는 단계가 아니다(stoppedStage가 멈춘 자리를 찾는다). */
const STATUS_STAGE = Object.freeze({
  queued: "prepare",
  scaffolding: "skeleton",
  implementing: "features",
  building: "verify",
  testing: "test",
  // 저장(pushed)과 올리기(deploying)는 사용자에게 한 단계다 — 코드를 어디에 두는지는 우리 일이다.
  pushed: "publish",
  deploying: "publish",
  done: "done",
});

/**
 * @param {unknown} status
 * @returns {string | null} 단계 키, failed·모르는 값은 null
 */
export function stageForStatus(status) {
  return typeof status === "string" && Object.prototype.hasOwnProperty.call(STATUS_STAGE, status)
    ? /** @type {Record<string, string>} */ (STATUS_STAGE)[status] ?? null
    : null;
}

/** @param {unknown} status */
export function isBuildActive(status) {
  return typeof status === "string" && BUILD_ACTIVE_STATUSES.includes(status);
}

/**
 * 실패한 잡이 **어디서** 멈췄는가. failedStage가 알려진 진행 상태면 그것, 아니면(컨테이너가
 * failedStage 대신 다른 필드를 보냈거나 "unknown") 타임라인에서 가장 멀리 간 진행 상태.
 * 둘 다 없으면 null — 모르는 자리를 꾸며 표시하지 않는다.
 * @param {{ status?: unknown, failedStage?: unknown } | null | undefined} job
 * @param {Array<{ stage?: unknown }> | null | undefined} events
 * @returns {string | null} 단계 키
 */
export function stoppedStage(job, events) {
  if (!job || job.status !== "failed") return null;
  if (isBuildActive(job.failedStage)) return stageForStatus(job.failedStage);
  let best = -1;
  for (const e of Array.isArray(events) ? events : []) {
    const i = e && typeof e.stage === "string" ? BUILD_ACTIVE_STATUSES.indexOf(e.stage) : -1;
    if (i > best) best = i;
  }
  return best >= 0 ? stageForStatus(BUILD_ACTIVE_STATUSES[best]) : null;
}

/**
 * 단계 줄 — 화면은 이것을 그대로 그린다(진행률 % 없음, D-4).
 *   done → 전부 done · 진행 중 → 앞은 done, 지금 current, 뒤는 todo ·
 *   failed → 멈춘 자리 stopped(모르면 전부 todo) · 모르는 상태 → 전부 todo.
 * @param {{ status?: unknown, failedStage?: unknown } | null | undefined} job
 * @param {Array<{ stage?: unknown }> | null | undefined} [events]
 * @returns {Array<{ key: string, state: "done" | "current" | "todo" | "stopped" }>}
 */
export function buildStageRow(job, events) {
  const status = job?.status;
  if (status === "done") return BUILD_STAGES.map((key) => ({ key, state: /** @type {const} */ ("done") }));
  const at = status === "failed" ? stoppedStage(job, events) : stageForStatus(status);
  const idx = at ? BUILD_STAGES.indexOf(at) : -1;
  const mark = status === "failed" ? "stopped" : "current";
  return BUILD_STAGES.map((key, i) => ({
    key,
    state: /** @type {"done" | "current" | "todo" | "stopped"} */ (idx < 0 ? "todo" : i < idx ? "done" : i === idx ? mark : "todo"),
  }));
}

// ─── 실패 종류 (잡이 failed로 끝났을 때) ──────────────────────────────────────
//
// 실패를 만드는 곳(서버 소스 전수, test/build-make.test.mjs가 문자열을 소스에서 뽑아 대조):
//   builder-container/builder-run.mjs  "builder_stage_not_implemented:<kind>"  (failedStage 없음 → "unknown")
//   builder-container/server.mjs       "builder container was killed by SIGTERM …" · "build job timed out after …"
//   routes/workspace-build-jobs.ts     디스패치 실패(failedStage "queued": "builder_unavailable" · "container returned …" ·
//                                      "container fetch failed: …" · "dispatch_failed") · "done claimed with build exit N"(building)
//   stuck-cleanup.ts                   "builder container did not report progress within 60 minutes …"(failedStage = 멈춘 상태)
//   D-7 예산 정지                      failedStage "budget"(설계 — B-6 실행체가 보낸다)

/** @typedef {"notImplemented" | "budget" | "interrupted" | "startFailed" | "buildFailed" | "buildUnverified" | "testFailed" | "publishFailed" | "generic"} BuildFailureKind */

export const BUILD_FAILURE_KINDS = Object.freeze([
  "notImplemented",
  "budget",
  "interrupted",
  "startFailed",
  "buildFailed",
  // #578 검증 결함 5: 컨테이너는 다 됐다(주소 포함)고 알렸지만 빌드가 green이 아니라 서버가 거절한 경우.
  // 서버는 그 주소에 무엇이 떠 있는지 모른다 — "올리지 않았어요"라고 단정하지 않는다.
  "buildUnverified",
  "testFailed",
  "publishFailed",
  "generic",
]);

/**
 * @param {{ status?: unknown, failedStage?: unknown, error?: unknown } | null | undefined} job
 * @returns {BuildFailureKind}
 */
export function buildFailureKind(job) {
  const error = typeof job?.error === "string" ? job.error : "";
  const stage = typeof job?.failedStage === "string" ? job.failedStage : "";
  if (/^builder_stage_not_implemented\b/.test(error)) return "notImplemented";
  if (stage === "budget" || /\bbudget\b/i.test(error)) return "budget";
  // 컨테이너가 죽었거나(롤아웃·sleepAfter) 시간 상한에 걸렸거나 보고가 끊긴 경우 — 어느 단계였든 "끊김".
  if (/did not report progress|was killed by|timed out/i.test(error)) return "interrupted";
  if (stage === "queued") return "startFailed";
  // workspace-build-jobs.ts /internal/build-done: ok:true + deployedUrl이 왔지만 buildExitCode≠0 → 거절(D-4).
  if (/^done claimed with build exit/.test(error)) return "buildUnverified";
  if (stage === "building") return "buildFailed";
  if (stage === "testing") return "testFailed";
  if (stage === "pushed" || stage === "deploying") return "publishFailed";
  return "generic";
}

/**
 * 실패 화면의 두 행동 중 무엇이 주(primary)인가 — 한 화면에 주 버튼은 하나.
 * "준비 중인 단계"에서 멈춘 것은 다시 해도 같은 자리에서 멈춘다 → 지시서 받아가기가 주.
 * 나머지는 다시 시도가 주(지시서 받아가기는 보조로 항상 있다).
 *
 * #578 검증 결함 3: 만들기가 지금 닫혀 있으면(서버가 열림을 확인하지 않음) [다시 시도]는 누르면 막힐 버튼이다 —
 * 내밀지 않고 지시서 받아가기 하나만 둔다.
 * @param {BuildFailureKind} kind
 * @param {{ canRetry?: boolean }} [opts] 기본 true(종전 계약)
 * @returns {{ primary: "retry" | "takeSpec", secondary: "retry" | "takeSpec" | null }}
 */
export function failureActions(kind, opts = {}) {
  if (opts.canRetry === false) return { primary: "takeSpec", secondary: null };
  return kind === "notImplemented"
    ? { primary: "takeSpec", secondary: "retry" }
    : { primary: "retry", secondary: "takeSpec" };
}

// ─── 폴링 (visual-check-run-state RUN_POLL_INTERVAL_MS 관례 — 5초) ──────────────

export const BUILD_POLL_INTERVAL_MS = 5000;
/** 오래 걸리는 잡(D-4 [PILOT] 45분 상한)을 5초마다 끝까지 두드리지 않는다. */
export const BUILD_POLL_SLOW_MS = 15000;
export const BUILD_POLL_SLOW_AFTER_MS = 10 * 60 * 1000;

/**
 * 다음 조회까지 기다릴 시간, 또는 멈춰야 하면 null.
 *   - 끝난 상태(done·failed)·모르는 상태 → null (영원히 두드리지 않는다)
 *   - 탭이 숨겨졌으면 → null (돌아오면 화면이 다시 시작한다)
 *   - 진행 중 → 처음 10분은 5초, 그 뒤는 15초
 * @param {unknown} status
 * @param {{ hidden?: boolean, elapsedMs?: number }} [opts]
 * @returns {number | null}
 */
export function nextBuildPollDelayMs(status, opts = {}) {
  if (!isBuildActive(status)) return null;
  if (opts.hidden === true) return null;
  const elapsed = typeof opts.elapsedMs === "number" && Number.isFinite(opts.elapsedMs) ? opts.elapsedMs : 0;
  return elapsed >= BUILD_POLL_SLOW_AFTER_MS ? BUILD_POLL_SLOW_MS : BUILD_POLL_INTERVAL_MS;
}

/**
 * 폴링을 켤 때 첫 조회까지 기다릴 시간 — 또는 켜지 않으면 null (#578 검증 결함 9: 화면 배선을 동작으로 고정).
 *   - 탭이 숨었거나 진행 중인 잡이 없으면 켜지 않는다
 *   - 탭이 돌아온 직후(resumed)는 기다리지 않고 바로(0) — 오래 떠 있던 화면이 5초 동안 옛 단계를 보이지 않게
 *   - 그 밖에는 nextBuildPollDelayMs(5초 · 10분 뒤 15초)
 * @param {{ visible: boolean, active: boolean, resumed: boolean, status: unknown, elapsedMs?: number }} input
 * @returns {number | null}
 */
export function buildPollStart(input) {
  if (input?.visible !== true || input?.active !== true) return null;
  if (input.resumed === true) return 0;
  return nextBuildPollDelayMs(input.status, { hidden: false, elapsedMs: input.elapsedMs });
}

/**
 * 폴링 루프 하나 — 내 앱 화면의 effect가 켜고, effect의 cleanup(탭 숨김·잡 바뀜·화면 떠남)이 stop으로 끈다.
 * 타이머는 주입한다(테스트는 가짜 타이머로 중단·재개를 **동작으로** 고정한다 — 결함 9).
 *   - firstDelayMs가 null이면 아무것도 하지 않는다
 *   - tick()이 다음 지연(ms)을 돌려주면 다시 예약하고, null이면 멈춘다(끝난 상태·모르는 상태)
 *   - stop() 뒤에는 예약을 지우고, **이미 떠난 조회가 늦게 돌아와도 다시 예약하지 않는다**
 *   - tick이 던지면 멈춘다(탭이 다시 보이면 화면이 새로 켠다)
 * @template H
 * @param {{ firstDelayMs: number | null, tick: () => Promise<number | null>, schedule: (fn: () => Promise<void>, ms: number) => H, cancel: (handle: H) => void }} opts
 * @returns {() => void} stop
 */
export function startBuildPolling(opts) {
  let stopped = false;
  /** @type {H | null} */
  let handle = null;
  /** 절대 던지지 않는다(tick 오류는 멈춤으로) — setTimeout이 약속을 버려도 처리되지 않은 거부가 없다. */
  const run = async () => {
    handle = null;
    /** @type {number | null} */
    let next = null;
    try {
      next = await opts.tick();
    } catch {
      next = null;
    }
    if (stopped || next === null || next === undefined) return;
    handle = opts.schedule(run, next);
  };
  if (opts.firstDelayMs !== null && opts.firstDelayMs !== undefined) handle = opts.schedule(run, opts.firstDelayMs);
  return () => {
    stopped = true;
    if (handle !== null) opts.cancel(handle);
    handle = null;
  };
}

// ─── 시작 요청 오류 (POST …/build) ────────────────────────────────────────────

/**
 * 서버 오류 코드 → 사전 키(t.makeApp.startErrors.*). 서버의 **사용자 대면** 코드 전수
 * (routes/workspace-build-jobs.ts의 POST·GET 핸들러)와 비용 상한 트레인이 쓰는 두 코드
 * (daily_limit_reached · build_disabled — 옛 서버는 보내지 않는다).
 * 테스트가 서버 소스의 코드 목록과 이 표를 대조한다 — 새 코드가 생기면 여기에 넣어야 통과한다.
 */
export const START_ERROR_CODES = Object.freeze({
  invalid_json: "generic",
  userKey_required: "generic",
  not_found: "notSynced",
  dev_spec_required: "needSpec",
  dev_spec_has_no_work_items: "noWorkItems",
  build_already_active: "alreadyActive",
  callback_token_missing: "notReady",
  builder_unavailable: "notReady",
  hosting_not_configured: "notReady",
  llm_not_configured: "notReady",
  hosting_namespace_failed: "hostingFailed",
  hosting_d1_failed: "hostingFailed",
  daily_limit_reached: "dailyLimitReached",
  build_disabled: "paused",
});

/** @typedef {"unavailable" | "notSynced" | "needSpec" | "noWorkItems" | "alreadyActive" | "notReady" | "paused" | "dailyLimitReached" | "hostingFailed" | "network" | "generic"} StartErrorKey */

/**
 * 옛 서버(빌드 라우트가 없음)의 404인가. central-plane의 전역 notFound는
 * `{ error: "not found", path }`(띄어쓰기)이고, 라우트가 프로젝트를 못 찾으면 `{ ok:false, error:"not_found" }`다.
 * 본문이 JSON이 아니어도(프록시·정적 404) 라우트가 없는 것으로 본다.
 * @param {number} status
 * @param {unknown} body
 */
export function isRouteMissing(status, body) {
  if (status !== 404) return false;
  const err = body && typeof body === "object" ? /** @type {{ error?: unknown }} */ (body).error : undefined;
  return err !== "not_found";
}

/**
 * 시작 요청의 응답(HTTP 상태 + 파싱된 본문)을 화면 알림으로.
 * 알려진 코드라도 **상태가 맞을 때만** 그 문구를 쓴다 — 본문 없는 429·503(인프라)은 "상한"·"멈춤"을
 * 주장하지 않는다(Train W 규칙과 같다).
 * @param {number} status HTTP 상태, 네트워크 실패는 0
 * @param {unknown} body
 * @returns {{ errorKey: StartErrorKey, resetAt: string | null, activeJobId: string | null }}
 */
export function startErrorNotice(status, body) {
  const none = { resetAt: null, activeJobId: null };
  if (status === 0) return { errorKey: "network", ...none };
  if (isRouteMissing(status, body)) return { errorKey: "unavailable", ...none };
  const b = body && typeof body === "object" ? /** @type {Record<string, unknown>} */ (body) : {};
  const code = typeof b.error === "string" ? b.error : "";
  const mapped = Object.prototype.hasOwnProperty.call(START_ERROR_CODES, code)
    ? /** @type {Record<string, StartErrorKey>} */ (START_ERROR_CODES)[code] ?? "generic"
    : "generic";
  if (mapped === "dailyLimitReached") {
    return status === 429 ? { errorKey: "dailyLimitReached", resetAt: readDailyLimit(body)?.resetAt ?? null, activeJobId: null } : { errorKey: "generic", ...none };
  }
  if (mapped === "paused" || mapped === "notReady") return status === 503 ? { errorKey: mapped, ...none } : { errorKey: "generic", ...none };
  if (mapped === "alreadyActive") {
    const activeJobId = typeof b.activeJobId === "string" && b.activeJobId ? b.activeJobId : null;
    return { errorKey: "alreadyActive", resetAt: null, activeJobId };
  }
  return { errorKey: mapped, ...none };
}

/**
 * 알림의 어조 — 사용자의 잘못이 아닌 것(상한·일시 중지·준비 안 됨·이미 진행 중·아직 열리지 않음)은
 * 빨간 오류가 아니라 안내로.
 * @param {StartErrorKey} key
 * @returns {"info" | "error"}
 */
export function startErrorTone(key) {
  return key === "unavailable" || key === "notReady" || key === "paused" || key === "dailyLimitReached" || key === "alreadyActive"
    ? "info"
    : "error";
}

/**
 * 알림 안에 [지시서 받아가기]를 함께 줄까 — **다시 눌러도 같은 곳에서 막힐** 시작 실패들(#578 검증 결함 3).
 * 아직 열리지 않음·저희 쪽 설정·잠시 멈춤·호스팅 자리 실패. 이때 "다시 시도"만 남기면 막다른 길이다.
 * (네트워크·일반 오류는 다시 해 볼 만하고, 지시서·작업이 없는 경우는 알림 자체가 다음 할 일을 말한다.)
 * @param {StartErrorKey} key
 */
export function startNoticeOffersTakeSpec(key) {
  return key === "unavailable" || key === "hostingFailed" || key === "notReady" || key === "paused";
}

// ─── 응답 경계 파싱 (대시보드에는 zod가 없다 — daily-limit.mjs처럼 필드마다 검사) ───────

/** @param {unknown} v */
const str = (v) => (typeof v === "string" ? v : null);
/** @param {unknown} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** https URL만 링크로 쓴다 — 서버가 준 값이라도 javascript:·http: 등은 버린다. */
export function safeHttpsUrl(v) {
  if (typeof v !== "string" || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 잡 하나(서버 DbBuildJob) → 화면용. id·status가 없으면 null(그리지 않는다).
 * userKey는 옮기지 않는다 — 화면이 쓸 일이 없는 값은 들고 다니지 않는다.
 * @param {unknown} raw
 */
export function parseBuildJob(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = str(r.id);
  const status = str(r.status);
  if (!id || !status) return null;
  return {
    id,
    status,
    slug: str(r.slug),
    failedStage: str(r.failedStage),
    error: str(r.error),
    wbsDone: num(r.wbsDone) ?? 0,
    wbsTotal: num(r.wbsTotal) ?? 0,
    budgetUsd: num(r.budgetUsd),
    spentUsd: num(r.spentUsd),
    deployedUrl: safeHttpsUrl(r.deployedUrl),
    // 코드 받아가기 — 서버가 주소를 줄 때만(지금 서버는 주지 않는다: 없는 기능을 그리지 않는다).
    downloadUrl: safeHttpsUrl(r.downloadUrl),
    createdAt: str(r.createdAt) ?? "",
    updatedAt: str(r.updatedAt) ?? "",
  };
}

/**
 * @param {unknown} raw
 * @returns {Array<{ id: string, at: string, stage: string, message: string }>}
 */
export function parseBuildEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (e);
    const id = str(r.id);
    const stage = str(r.stage);
    if (!id || !stage) continue;
    out.push({ id, at: str(r.at) ?? "", stage, message: str(r.message) ?? "" });
  }
  return out;
}

/**
 * 가장 최근 잡 — 새로고침·재방문 시 이 잡을 복원한다(서버 목록이 진실, 브라우저 저장 없음).
 * @template {{ createdAt: string }} J
 * @param {J[] | null | undefined} jobs
 * @returns {J | null}
 */
export function latestBuildJob(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;
  let best = null;
  for (const j of jobs) {
    if (!j) continue;
    if (!best || String(j.createdAt ?? "") > String(best.createdAt ?? "")) best = j;
  }
  return best;
}

/**
 * 목록 응답으로 본 "만들기를 여기서 쓸 수 있는가".
 *   available — 라우트가 있다(잡이 있든 없든, 또는 프로젝트가 아직 서버에 없음)
 *   missing   — 옛 서버: 라우트 자체가 없다 → 만들기 버튼을 숨기고 정직하게 안내
 *   unknown   — 네트워크·5xx: 모른다
 * @param {{ ok: boolean, status?: number, routeMissing?: boolean } | null | undefined} res
 * @returns {"loading" | "available" | "missing" | "unknown"}
 */
export function buildAvailability(res) {
  if (!res) return "loading";
  if (res.ok) return "available";
  if (res.routeMissing === true) return "missing";
  if (res.status === 404) return "available"; // 프로젝트가 서버에 아직 없음 — 라우트는 있다
  return "unknown";
}

/**
 * 서버가 "만들기가 지금 끝까지 된다"고 **확인해 줬는가**(GET /workspace/build-availability — #578 검증 결함 2).
 *   null  — 아직 묻는 중(화면은 만들기에 달린 것을 보류한다)
 *   true  — 서버가 buildEnabled:true로 답했다
 *   false — 그 밖 전부: 닫힘 · 옛 서버(경로 없음) · 네트워크·5xx · 모양이 다름.
 * 확인하지 못한 것을 열림으로 치지 않는다 — 누르면 막힐 버튼이 약속을 깨는 것보다, 늘 되는 길(지시서 받아
 * 직접 만들기)을 보이는 쪽이 정직하다.
 * @param {{ ok: boolean, open?: unknown } | null | undefined} res
 * @returns {boolean | null}
 */
export function buildOpenFact(res) {
  if (!res) return null;
  return res.ok === true && res.open === true;
}

/**
 * 개요 '지금 할 일'용 빌드 사실(#578 검증 결함 1): 가장 최근 잡 기준.
 *   null — 아직 묻는 중 · "none" — 잡 없음 · "active" · "done" · "failed"
 * 목록을 못 읽으면(옛 서버·프로젝트 없음·일시 실패) "none" — 만들기 행동은 모두 같은 화면(내 앱)으로 가고,
 * 그 화면이 다시 읽어 사실대로 말한다(잘못 고른 건 버튼 이름뿐, 목적지는 같다).
 * @param {{ ok: boolean, jobs?: Array<{ status?: unknown, createdAt?: string }> } | null | undefined} res
 * @returns {"none" | "active" | "done" | "failed" | null}
 */
export function hostedBuildState(res) {
  if (!res) return null;
  if (!res.ok) return "none";
  const latest = latestBuildJob(/** @type {Array<{ status?: unknown, createdAt: string }>} */ (Array.isArray(res.jobs) ? res.jobs : []));
  if (!latest) return "none";
  if (latest.status === "done") return "done";
  if (latest.status === "failed") return "failed";
  // 진행 중 — 또는 새 서버의 모르는 상태: "진행 상황 보기"가 가장 덜 틀린 이름이다(내 앱 화면이 사실대로 그린다).
  return "active";
}

/**
 * 사이드바 '내 앱'용 사실: 이 프로젝트에 Simsa가 만든(또는 만드는 중인) 앱이 있는가.
 * 라우트가 없거나 프로젝트가 서버에 없으면 확정적으로 없음(false), 일시 실패는 모름(null).
 * @param {{ ok: boolean, jobs?: unknown[], status?: number, routeMissing?: boolean } | null | undefined} res
 * @returns {boolean | null}
 */
export function hostedBuildFact(res) {
  if (!res) return null;
  if (res.ok) return Array.isArray(res.jobs) && res.jobs.length > 0;
  if (res.routeMissing === true || res.status === 404) return false;
  return null;
}

// ─── '만들기' 버튼을 어디에 보이나 (D-17: 아이디어·기획서 문의 만들기는 항상 S) ─────────

/**
 * 지시서 화면에 만들기 패널을 보일까.
 *   - 이미 만든 앱이 있는 문(코드 갈래·앱 있음 확정)이면 아니다 — 그 앱을 확인하는 길이다.
 *   - 이미 만든 앱에서 역추론한 지시서(inferred)면 아니다(같은 이유).
 *   - 옛 서버(라우트 없음)면 아니다 — 누르면 막히는 버튼을 내밀지 않는다.
 *   - ★서버가 만들기를 열었다고 확인하지 않았으면(open false) 아니다(#578 검증 결함 2). 라우트가 있어도 실행체가
 *     끝까지 못 하면 누르기 전 안내(45분·Simsa 주소)가 없는 기능을 약속한다. 그때는 종전대로 팩이 주 버튼.
 *   - 앱 유무·가용성·열림이 아직 모르면 null(잠시 그리지 않는다 — 그렸다 지우는 깜빡임 방지).
 * @param {{ entryPath?: string | null, presence: boolean | null, specSource?: string | null, availability: "loading" | "available" | "missing" | "unknown", open: boolean | null }} input
 * @returns {boolean | null}
 */
export function makePanelVisible(input) {
  if (input?.entryPath === "code" || input?.presence === true) return false;
  if (input?.specSource === "inferred") return false;
  if (input?.availability === "missing") return false;
  if (input?.open === false) return false;
  if (input?.availability === "loading" || input?.presence === null || input?.presence === undefined) return null;
  if (input?.open !== true) return null;
  return true;
}

/**
 * 내 앱 화면에 잡이 **없을 때** 무엇을 그리나 — 한 곳에서 정한다(#578 검증 결함 2).
 *   hold        — 아직 묻는 중(목록·앱 유무·열림·지시서)
 *   notForThis  — 이미 앱이 있는 문(코드 갈래·앱 있음·역추론 지시서): 새로 만들지 않는다(D-17)
 *   closed      — 옛 서버이거나 서버가 만들기를 열었다고 확인하지 않음: 정직한 안내 + 지시서 받아가기
 *   make        — 만들기 패널
 *   needSpec    — 지시서 먼저
 *   null        — 목록을 못 읽음(화면이 따로 다시 시도를 그린다)
 * 앱 유무를 모르는 동안은 "닫힘"도 말하지 않는다(나중에 "이미 앱이 있어요"로 뒤집히지 않게).
 * @param {{ availability: "loading" | "available" | "missing" | "unknown", open: boolean | null, entryPath?: string | null, presence: boolean | null, specSource?: string | null, devSpecLoaded: boolean, hasDevSpec: boolean }} input
 * @returns {"hold" | "notForThis" | "closed" | "make" | "needSpec" | null}
 */
export function myAppEmptyState(input) {
  if (input.availability === "loading") return "hold";
  if (input.availability === "unknown") return null;
  if (input.entryPath === "code" || input.specSource === "inferred" || input.presence === true) return "notForThis";
  if (input.presence === null || input.presence === undefined) return "hold";
  if (input.availability === "missing" || input.open === false) return "closed";
  if (input.open !== true || !input.devSpecLoaded) return "hold";
  return input.hasDevSpec ? "make" : "needSpec";
}

/**
 * 만들기 패널이 지금 무엇을 말하나 — 가장 최근 잡 기준.
 * @param {{ status?: unknown } | null | undefined} latestJob
 * @returns {"make" | "active" | "done"}
 */
export function makePanelState(latestJob) {
  if (!latestJob) return "make";
  if (latestJob.status === "done") return "done";
  if (isBuildActive(latestJob.status)) return "active";
  return "make"; // 실패·모르는 상태 → 다시 만들 수 있다
}

/**
 * 시작 전 안내 줄(사전 키, 순서대로). A 경로(내 저장소·내 배포) 문장은 개발자 모드일 때만 — 기본
 * 흐름에는 계정·개발 용어가 나오지 않는다(D-17).
 * @param {{ developerMode: boolean, hasExcluded: boolean }} input
 * @returns {Array<"what" | "excluded" | "eta" | "free" | "hosted" | "devPath">}
 */
export function makeIntroKeys(input) {
  /** @type {Array<"what" | "excluded" | "eta" | "free" | "hosted" | "devPath">} */
  const keys = ["what"];
  if (input?.hasExcluded === true) keys.push("excluded");
  keys.push("eta", "free", "hosted");
  if (input?.developerMode === true) keys.push("devPath");
  return keys;
}

/** D-4 [PILOT] 잡 전체 상한(builder-container/server.mjs JOB_TIMEOUT_MS) — 예상 소요 문장의 숫자. 파일럿 후 고정. */
export const BUILD_EXPECTED_MAX_MINUTES = 45;

// ─── 내 앱 카드 (D-6: Simsa 주소에서 운영 중 · 프로덕션 아님) ──────────────────────

// 신고 링크 — B-7(#575, 호스팅 사업자 의무)의 신고 사이트로 **직행**한다: `https://report.<루트>/?app=<slug>`.
// B-7은 신고 폼을 유저 앱과 다른 origin(report.<루트>)에 두고, 앱 주소의 /.well-known/simsa-report는 그리로 302만
// 한다(앱 origin에 폼을 두면 그 앱의 서비스 워커가 신고를 가로챌 수 있다). 카드가 앱 origin 경로를 거칠 이유가 없다.
// 아래 세 값은 apps/hosting-dispatch/src/route.ts(SLUG_RE · RESERVED_SLUGS · REPORT_HOST_LABEL)의 거울이고,
// 주소 모양은 B-7 hostingReportUrl(slug, rootDomain)과 같다 — test/build-report-link-paused.test.mjs가 대조한다.

/** 신고·이용 규칙 사이트의 서브도메인 라벨(B-7 REPORT_HOST_LABEL). */
export const HOSTED_REPORT_HOST_LABEL = "report";

/** 호스팅 slug 규칙(hosting-dispatch SLUG_RE와 같은 식 — 소문자·숫자·하이픈 3~40자, `--`·끝 하이픈 금지). */
export const HOSTED_SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;

/** 유저 앱이 가질 수 없는 라벨(hosting-dispatch RESERVED_SLUGS와 같은 목록). */
export const HOSTED_RESERVED_SLUGS = Object.freeze([
  "www", "api", "app", "admin", "mail", "email", "smtp", "imap", "pop", "ftp",
  "status", "docs", "help", "support", "billing", "pay", "payment", "login", "auth",
  "account", "accounts", "dashboard", "static", "assets", "cdn", "simsa", "conclave",
  "security", "abuse", "report", "root", "system", "internal", "dispatch",
]);
const RESERVED_SET = new Set(HOSTED_RESERVED_SLUGS);

/** @param {unknown} root */
function normalizeHostRoot(root) {
  return String(root ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/**
 * B-7 hostingReportUrl(slug, rootDomain)과 같은 모양: 라우터가 받는 slug면 `?app=<slug>`, 아니면 앱 지정 없이.
 * @param {string} slug
 * @param {string} rootDomain
 * @returns {string}
 */
export function hostingReportUrlFor(slug, rootDomain) {
  const base = `https://${HOSTED_REPORT_HOST_LABEL}.${normalizeHostRoot(rootDomain)}/`;
  return HOSTED_SLUG_RE.test(slug) && !RESERVED_SET.has(slug) ? `${base}?app=${slug}` : base;
}

/**
 * 앱 주소(`https://<slug>.<루트>/…`)의 신고 링크. 첫 라벨 = slug, 나머지 = 호스팅 루트(최소 두 라벨).
 * 한글 호스트는 URL이 xn--…로 바꾸므로 slug가 될 수 없어 앱 지정 없이 신고 사이트로 간다(깨진 app= 없음).
 * @param {unknown} appUrl 앱 주소(https)
 * @returns {string | null} https가 아니거나 서브도메인이 없는 주소면 null(호스팅 주소가 아니다)
 */
export function hostedReportUrl(appUrl) {
  const safe = safeHttpsUrl(appUrl);
  if (!safe) return null;
  const host = normalizeHostRoot(new URL(safe).hostname);
  const dot = host.indexOf(".");
  if (dot <= 0) return null;
  const root = host.slice(dot + 1);
  if (!root.includes(".")) return null;
  return hostingReportUrlFor(host.slice(0, dot), root);
}

/** visual-check 런 중 결과가 있는 것(project-steps.mjs FINISHED_RUN_STATUSES와 같은 규칙). */
const FINISHED_CHECK_STATUSES = new Set(["done", "uploaded"]);

/**
 * 이 앱 주소를 검수한 **끝난** 런 중 가장 최근 것. 주소는 호스트로 비교한다(경로·끝 슬래시 무관).
 * @param {Array<{ id?: string, targetUrl?: string, status?: string, createdAt?: string }> | null | undefined} checks
 * @param {unknown} appUrl
 * @returns {string | null} 런 id
 */
export function latestCheckForApp(checks, appUrl) {
  const safe = safeHttpsUrl(appUrl);
  if (!safe || !Array.isArray(checks)) return null;
  const host = new URL(safe).hostname.toLowerCase();
  let best = null;
  for (const c of checks) {
    if (!c || typeof c.id !== "string" || !FINISHED_CHECK_STATUSES.has(String(c.status ?? ""))) continue;
    let h = "";
    try {
      h = new URL(String(c.targetUrl ?? "")).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (h !== host) continue;
    if (!best || String(c.createdAt ?? "") > String(best.createdAt ?? "")) best = c;
  }
  return best ? /** @type {string} */ (best.id) : null;
}

/**
 * 끝난 잡의 '내 앱' 카드. done이 아니거나 주소가 안전한 https가 아니면 null.
 * @param {{ status?: unknown, deployedUrl?: unknown, downloadUrl?: unknown } | null | undefined} job
 * @param {Parameters<typeof latestCheckForApp>[0]} [checks]
 * @returns {{ url: string, reportUrl: string, checkRunId: string | null, downloadUrl: string | null } | null}
 */
export function appCardView(job, checks) {
  if (!job || job.status !== "done") return null;
  const url = safeHttpsUrl(job.deployedUrl);
  if (!url) return null;
  const reportUrl = hostedReportUrl(url);
  if (!reportUrl) return null;
  return { url, reportUrl, checkRunId: latestCheckForApp(checks, url), downloadUrl: safeHttpsUrl(job.downloadUrl) };
}

/**
 * 예산 줄(D-7: 예산은 UI에 보인다) — **서버가 준 값만.** 예산 값이 없거나 0 이하면 null(표시 안 함).
 * @param {{ budgetUsd?: unknown, spentUsd?: unknown } | null | undefined} job
 * @returns {{ budget: string, spent: string } | null}
 */
export function budgetLine(job) {
  const budget = num(job?.budgetUsd);
  if (budget === null || budget <= 0) return null;
  const spent = Math.max(0, num(job?.spentUsd) ?? 0);
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return { budget: fmt(budget), spent: fmt(spent) };
}

// ─── 지시서 받아가기 (#578 검증 결함 4) ─────────────────────────────────────────
//
// 라벨이 "지시서 받아가기"면 받는 것은 **지시서**여야 한다. 종전 목적지는 빌더 팩 화면(export)이었고, 거기 첫
// 질문은 "어떤 개발 AI용으로 받으시겠어요?"(Claude Code·Codex·Lovable·v0·Bolt) — 기본 흐름의 복구 동선에 A 경로
// 도구 고르기가 들어왔다. 이제 그 자리에서 지시서 문서 하나를 받는다. 문서는 서버의 지시서 렌더러가 만든 것 그대로
// (빌더 팩 응답의 `dev-spec/` 파일들 — 렌더러를 대시보드에 복제하지 않는다, #498 교훈).

const DEV_SPEC_FILE_RE = /(^|\/)dev-spec\/([^/]+\.md)$/;

/**
 * 빌더 팩 파일 목록 → 지시서 문서 하나(쉬운 요약 README가 맨 앞, 나머지는 번호순). 지시서 파일이 없으면 null.
 * 개발 도구용 프롬프트·비밀 파일(.env.local 등)은 `dev-spec/` 밖이라 들어가지 않는다.
 * 파일 이름은 제목을 살린다(Rule 6: 한글 그대로, 기호만 "-"로).
 * @param {Array<{ path: string, content: string }> | null | undefined} files
 * @param {{ title: string, locale: "ko" | "en" }} opts
 * @returns {{ filename: string, content: string } | null}
 */
export function devSpecDocument(files, opts) {
  const picked = [];
  for (const f of Array.isArray(files) ? files : []) {
    const m = f && typeof f.path === "string" ? DEV_SPEC_FILE_RE.exec(f.path) : null;
    if (m && typeof f.content === "string") picked.push({ name: /** @type {string} */ (m[2]), content: f.content });
  }
  if (picked.length === 0) return null;
  picked.sort((a, b) => (a.name === "README.md" ? -1 : b.name === "README.md" ? 1 : a.name.localeCompare(b.name)));
  const content = picked.map((p) => `<!-- dev-spec/${p.name} -->\n\n${p.content.trim()}\n`).join("\n---\n\n");
  const safe = String(opts?.title ?? "")
    .replace(/[^A-Za-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const stem = opts?.locale === "en" ? "dev-spec" : "개발지시서";
  return { filename: `${stem}-${safe || "project"}.md`, content };
}
