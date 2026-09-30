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

/** @typedef {"notImplemented" | "budget" | "interrupted" | "startFailed" | "buildFailed" | "testFailed" | "publishFailed" | "generic"} BuildFailureKind */

export const BUILD_FAILURE_KINDS = Object.freeze([
  "notImplemented",
  "budget",
  "interrupted",
  "startFailed",
  "buildFailed",
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
  if (stage === "building" || /^done claimed with build exit/.test(error)) return "buildFailed";
  if (stage === "testing") return "testFailed";
  if (stage === "pushed" || stage === "deploying") return "publishFailed";
  return "generic";
}

/**
 * 실패 화면의 두 행동 중 무엇이 주(primary)인가 — 한 화면에 주 버튼은 하나.
 * "준비 중인 단계"에서 멈춘 것은 다시 해도 같은 자리에서 멈춘다 → 지시서 받아가기가 주.
 * 나머지는 다시 시도가 주(지시서 받아가기는 보조로 항상 있다).
 * @param {BuildFailureKind} kind
 * @returns {{ primary: "retry" | "takeSpec", secondary: "retry" | "takeSpec" }}
 */
export function failureActions(kind) {
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
 *   - 앱 유무·가용성이 아직 모르면 null(잠시 그리지 않는다 — 그렸다 지우는 깜빡임 방지).
 * @param {{ entryPath?: string | null, presence: boolean | null, specSource?: string | null, availability: "loading" | "available" | "missing" | "unknown" }} input
 * @returns {boolean | null}
 */
export function makePanelVisible(input) {
  if (input?.entryPath === "code" || input?.presence === true) return false;
  if (input?.specSource === "inferred") return false;
  if (input?.availability === "missing") return false;
  if (input?.availability === "loading" || input?.presence === null || input?.presence === undefined) return null;
  return true;
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

/**
 * 호스팅된 앱의 신고 경로 — **B-7(호스팅 사업자 의무: 신고 링크)과 맞춰야 한다.**
 * B-7 헬퍼가 main에 들어오면 이 상수를 그 헬퍼로 바꾼다(한 곳에만 둔다).
 */
export const HOSTED_REPORT_PATH = "/.well-known/simsa-report";

/**
 * @param {unknown} appUrl 앱 주소(https)
 * @returns {string | null} `https://<slug>.<호스팅 루트>/.well-known/simsa-report`
 */
export function hostedReportUrl(appUrl) {
  const safe = safeHttpsUrl(appUrl);
  if (!safe) return null;
  return `${new URL(safe).origin}${HOSTED_REPORT_PATH}`;
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
