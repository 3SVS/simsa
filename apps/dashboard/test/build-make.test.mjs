/**
 * B-8 (SI 티어 Train B) — 문 (a) "만들기"의 순수 로직.
 *
 * 서버 계약과의 대조는 **서버 소스를 읽어서** 한다: central-plane의 상태 목록·오류 코드·실패 문장이
 * 바뀌면 이 파일이 깨진다(그래야 화면이 모르는 상태를 조용히 "알 수 없음"으로 그리지 않는다).
 *
 * 네임스페이스 import — 옛 코드(모듈 없음)에서는 import 자체가 실패해 파일 전체가 실패한다(ERR_MODULE_NOT_FOUND).
 * 그건 "모듈이 없다"는 증거일 뿐 개별 테스트의 판별력 증거가 아니다(#578 검증 결함 7). 이 파일의 대상은 전부 새
 * 모듈(build-job-view.mjs)의 순수 로직이라 옛 트리에 대응물이 없다 — 개별 판별이 필요한 결함 재현은
 * build-make-verify-fixes.test.mjs(테스트마다 제 이유로 실패)에 있다.
 * Rule 6: 픽스처는 한국어 리얼 데이터 — 프로젝트 "(주)트루픽셀 예약 앱", 한글 호스트명(IDN) 포함.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const view = await import("../src/lib/build-job-view.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const cp = (f) => readFileSync(path.join(REPO, "apps/central-plane", f), "utf8");

const jobDb = cp("src/workspace/build-job-db.ts");
const route = cp("src/routes/workspace-build-jobs.ts");
const builderRun = cp("builder-container/builder-run.mjs");
const builderServer = cp("builder-container/server.mjs");
const stuck = cp("src/stuck-cleanup.ts");

/** `export const NAME = [ "a", "b" ] as const` 또는 `new Set([...])`의 문자열 목록. */
function stringList(src, re) {
  const m = re.exec(src);
  assert.ok(m, `pattern not found: ${re}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

const SERVER_STATUSES = stringList(jobDb, /export const BUILD_JOB_STATUSES = \[([^\]]*)\]/);
const SERVER_ACTIVE = stringList(jobDb, /export const BUILD_JOB_ACTIVE[^=]*= new Set\(\[([^\]]*)\]/);
const SERVER_ORDER = (() => {
  const m = /const STAGE_ORDER[^=]*= \{([^}]*)\}/.exec(jobDb);
  assert.ok(m, "STAGE_ORDER not found");
  return Object.fromEntries([...m[1].matchAll(/(\w+):\s*(\d+)/g)].map((x) => [x[1], Number(x[2])]));
})();

// ─── 상태 → 단계 (서버 상수와 대조) ───────────────────────────────────────────

describe("B-8 상태 머신 거울 — 서버 build-job-db.ts와 같은 상태·같은 순서", () => {
  it("BUILD_JOB_STATUSES가 서버와 정확히 같다", () => {
    assert.deepEqual([...view.BUILD_JOB_STATUSES], SERVER_STATUSES);
  });

  it("진행 중 상태(BUILD_JOB_ACTIVE)가 서버와 같다", () => {
    assert.deepEqual([...view.BUILD_ACTIVE_STATUSES].sort(), [...SERVER_ACTIVE].sort());
  });

  it("failed를 뺀 모든 서버 상태가 단계 하나에 매핑된다(모르는 상태로 떨어지지 않는다)", () => {
    for (const s of SERVER_STATUSES) {
      if (s === "failed") {
        assert.equal(view.stageForStatus(s), null);
        continue;
      }
      const stage = view.stageForStatus(s);
      assert.ok(stage && view.BUILD_STAGES.includes(stage), `${s} → ${stage}`);
    }
  });

  it("단계 순서는 서버 STAGE_ORDER를 거스르지 않는다(뒤 상태가 앞 단계로 보이지 않는다)", () => {
    const ordered = SERVER_STATUSES.filter((s) => s !== "failed").sort((a, b) => SERVER_ORDER[a] - SERVER_ORDER[b]);
    let prev = -1;
    for (const s of ordered) {
      const i = view.BUILD_STAGES.indexOf(view.stageForStatus(s));
      assert.ok(i >= prev, `${s}(${i}) must not come before the previous stage (${prev})`);
      prev = i;
    }
  });

  it("[가드] 컨테이너(builder-run.mjs)가 보고할 수 있는 상태는 전부 서버가 아는 상태다", () => {
    const containerStages = stringList(builderRun, /export const BUILD_STAGES = Object\.freeze\(\[([^\]]*)\]/);
    for (const s of containerStages) assert.ok(SERVER_STATUSES.includes(s), s);
  });

  it("모르는 상태·빈 값은 단계가 없다", () => {
    for (const v of ["", "running", "DONE", null, undefined, 3]) assert.equal(view.stageForStatus(v), null);
  });
});

describe("B-8 단계 줄 — 진행률 %가 아니라 단계 (D-4)", () => {
  it("진행 중 상태마다 current는 정확히 하나, 앞은 done, 뒤는 todo", () => {
    for (const status of view.BUILD_ACTIVE_STATUSES) {
      const row = view.buildStageRow({ status });
      const cur = row.findIndex((r) => r.state === "current");
      assert.equal(row.filter((r) => r.state === "current").length, 1, status);
      assert.equal(row[cur].key, view.stageForStatus(status));
      row.forEach((r, i) => assert.equal(r.state, i < cur ? "done" : i === cur ? "current" : "todo", `${status}@${r.key}`));
    }
  });

  it("done이면 전부 done", () => {
    assert.ok(view.buildStageRow({ status: "done" }).every((r) => r.state === "done"));
  });

  it("failed: failedStage가 알려진 상태면 그 자리에서 stopped", () => {
    const row = view.buildStageRow({ status: "failed", failedStage: "building" });
    assert.deepEqual(row.map((r) => r.state), ["done", "done", "done", "stopped", "todo", "todo", "todo"]);
  });

  it("failed: failedStage가 unknown(컨테이너가 failedAt으로 보냄)이면 타임라인에서 가장 멀리 간 곳", () => {
    const events = [{ stage: "queued" }, { stage: "failed" }];
    assert.equal(view.stoppedStage({ status: "failed", failedStage: "unknown" }, events), "prepare");
    const later = [{ stage: "queued" }, { stage: "scaffolding" }, { stage: "implementing" }, { stage: "failed" }];
    assert.equal(view.stoppedStage({ status: "failed", failedStage: "budget" }, later), "features");
  });

  it("failed인데 어디서 멈췄는지 모르면 아무 단계도 꾸미지 않는다(전부 todo)", () => {
    assert.ok(view.buildStageRow({ status: "failed", failedStage: "unknown" }, []).every((r) => r.state === "todo"));
  });

  it("모르는 상태(새 서버)는 전부 todo — 화면이 깨지지 않는다", () => {
    assert.ok(view.buildStageRow({ status: "reviewing" }).every((r) => r.state === "todo"));
    assert.ok(view.buildStageRow(null).every((r) => r.state === "todo"));
  });
});

// ─── 실패 종류 (서버 소스의 실패 문장 전수) ───────────────────────────────────

describe("B-8 실패 종류 — 서버가 실패를 만드는 모든 자리의 문장", () => {
  it("builder_stage_not_implemented → notImplemented ('아직 준비 중인 단계에서 멈췄어요')", () => {
    assert.match(builderRun, /builder_stage_not_implemented:\$\{/);
    const job = { status: "failed", failedStage: "unknown", error: "builder_stage_not_implemented:build" };
    assert.equal(view.buildFailureKind(job), "notImplemented");
  });

  it("컨테이너가 죽음·시간 초과·보고 끊김 → interrupted (어느 단계였든)", () => {
    assert.match(builderServer, /builder container was killed by \$\{sig\}/);
    assert.match(builderServer, /build job timed out after/);
    const staleMsg = /error: "(builder container did not report progress[^"]*)"/.exec(stuck);
    assert.ok(staleMsg, "stuck-cleanup build message");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "unknown", error: "builder container was killed by SIGTERM mid-job (deploy rollout or sleepAfter)" }), "interrupted");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "unknown", error: "build job timed out after 45 min" }), "interrupted");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "implementing", error: staleMsg[1] }), "interrupted");
  });

  it("디스패치 실패(failedStage queued) → startFailed", () => {
    assert.match(route, /failedStage: "queued", error: dispatch\.note \?\? "dispatch_failed"/);
    for (const error of ["builder_unavailable", "dispatch_failed", "container returned 500: boom", "container fetch failed: network"]) {
      assert.equal(view.buildFailureKind({ status: "failed", failedStage: "queued", error }), "startFailed", error);
    }
  });

  it("빌드가 green이 아닌데 done을 주장 → buildUnverified (D-4: 완성으로 치지 않았다 — 올렸는지는 모른다)", () => {
    assert.match(route, /failedStage: "building", error: `done claimed with build exit/);
    // ★의도된 변경 (PR #578 검증 결함 5): 종전 buildFailed("올리지 않았어요")는 서버가 모르는 것을 단정했다.
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "building", error: "done claimed with build exit 1" }), "buildUnverified");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "building", error: "tsc exited 2" }), "buildFailed");
  });

  it("예산 정지(D-7) → budget", () => {
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "budget", error: "stopped at WBS-3" }), "budget");
  });

  it("단계별: testing → testFailed · pushed/deploying → publishFailed · 모르는 것 → generic", () => {
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "testing", error: "3 tests failed" }), "testFailed");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "deploying", error: "upload 500" }), "publishFailed");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "pushed", error: "x" }), "publishFailed");
    assert.equal(view.buildFailureKind({ status: "failed", failedStage: "unknown", error: "unknown_error" }), "generic");
    assert.equal(view.buildFailureKind(null), "generic");
  });

  it("모든 종류가 BUILD_FAILURE_KINDS에 있다", () => {
    for (const k of ["notImplemented", "budget", "interrupted", "startFailed", "buildFailed", "buildUnverified", "testFailed", "publishFailed", "generic"]) {
      assert.ok(view.BUILD_FAILURE_KINDS.includes(k), k);
    }
  });

  it("준비 중 단계에서 멈춘 것은 다시 해도 같다 → 지시서 받아가기가 주 버튼, 나머지는 다시 시도가 주", () => {
    assert.deepEqual(view.failureActions("notImplemented"), { primary: "takeSpec", secondary: "retry" });
    for (const k of ["budget", "interrupted", "startFailed", "buildFailed", "buildUnverified", "testFailed", "publishFailed", "generic"]) {
      assert.deepEqual(view.failureActions(k), { primary: "retry", secondary: "takeSpec" }, k);
    }
  });
});

// ─── 폴링 중단 조건 ─────────────────────────────────────────────────────────

describe("B-8 폴링 — 끝나면·탭이 숨으면 멈춘다", () => {
  it("진행 중 상태는 5초마다(visual-check 폴링 관례)", () => {
    for (const s of view.BUILD_ACTIVE_STATUSES) assert.equal(view.nextBuildPollDelayMs(s), 5000, s);
  });

  it("끝난 상태·모르는 상태는 멈춘다(null) — 영원히 두드리지 않는다", () => {
    for (const s of ["done", "failed", "reviewing", "", null, undefined]) assert.equal(view.nextBuildPollDelayMs(s), null, String(s));
  });

  it("탭이 숨겨지면 멈추고, 보이면 다시 돈다", () => {
    assert.equal(view.nextBuildPollDelayMs("implementing", { hidden: true }), null);
    assert.equal(view.nextBuildPollDelayMs("implementing", { hidden: false }), 5000);
  });

  it("10분이 넘으면 15초로 늦춘다(45분 잡을 5초마다 끝까지 두드리지 않는다)", () => {
    assert.equal(view.nextBuildPollDelayMs("implementing", { elapsedMs: 9 * 60 * 1000 }), 5000);
    assert.equal(view.nextBuildPollDelayMs("implementing", { elapsedMs: 10 * 60 * 1000 }), 15000);
    assert.equal(view.nextBuildPollDelayMs("implementing", { elapsedMs: Number.NaN }), 5000);
  });
});

// ─── 시작 요청 오류 코드 → 문구 키 (서버 코드 전수) ─────────────────────────────

describe("B-8 시작 오류 — 서버 라우트의 사용자 대면 코드 전수", () => {
  // 라우트 팩토리 안, 내부 콜백(Bearer 토큰 — 컨테이너 전용) 앞의 POST·GET 핸들러가 쓰는 error 코드 전부.
  const factoryAt = route.indexOf("export function createWorkspaceBuildJobRoutes");
  const internalAt = route.indexOf('app.post("/internal/build-progress"');
  assert.ok(factoryAt > 0 && internalAt > factoryAt, "route layout changed — update this slice");
  const userFacing = route.slice(factoryAt, internalAt);
  const serverCodes = [...new Set([...userFacing.matchAll(/error: "([a-zA-Z_]+)"/g)].map((m) => m[1]))];

  it("[가드] 서버 코드 목록을 실제로 읽었다", () => {
    assert.ok(serverCodes.includes("dev_spec_required"), serverCodes.join(","));
    assert.ok(serverCodes.length >= 10, serverCodes.join(","));
  });

  it("서버가 내는 사용자 대면 코드는 전부 문구 표에 있다(새 코드가 생기면 여기서 깨진다)", () => {
    const missing = serverCodes.filter((c) => !Object.prototype.hasOwnProperty.call(view.START_ERROR_CODES, c));
    assert.deepEqual(missing, []);
  });

  it("상태가 맞을 때만 그 코드의 문구", () => {
    const n = (status, body) => view.startErrorNotice(status, body).errorKey;
    assert.equal(n(404, { ok: false, error: "not_found" }), "notSynced");
    assert.equal(n(409, { ok: false, error: "dev_spec_required" }), "needSpec");
    assert.equal(n(409, { ok: false, error: "dev_spec_has_no_work_items" }), "noWorkItems");
    assert.equal(n(503, { ok: false, error: "builder_unavailable" }), "notReady");
    assert.equal(n(503, { ok: false, error: "hosting_not_configured" }), "notReady");
    assert.equal(n(503, { ok: false, error: "llm_not_configured" }), "notReady");
    assert.equal(n(503, { ok: false, error: "callback_token_missing" }), "notReady");
    assert.equal(n(502, { ok: false, error: "hosting_d1_failed", detail: "cf_error" }), "hostingFailed");
    assert.equal(n(502, { ok: false, error: "hosting_namespace_failed" }), "hostingFailed");
    assert.equal(n(400, { ok: false, error: "userKey_required" }), "generic");
    assert.equal(n(400, { ok: false, error: "invalid_json" }), "generic");
  });

  it("비용 상한 트레인 코드: 429 daily_limit_reached(resetAt 전달) · 503 build_disabled", () => {
    const RESET = "2026-10-01T00:00:00.000Z";
    assert.deepEqual(view.startErrorNotice(429, { ok: false, error: "daily_limit_reached", kind: "build", limit: 3, resetAt: RESET }), {
      errorKey: "dailyLimitReached",
      resetAt: RESET,
      activeJobId: null,
    });
    assert.equal(view.startErrorNotice(503, { ok: false, error: "build_disabled" }).errorKey, "paused");
  });

  it("본문 없는 429·503(인프라)은 상한·멈춤·준비 안 됨을 주장하지 않는다 → generic", () => {
    assert.equal(view.startErrorNotice(429, null).errorKey, "generic");
    assert.equal(view.startErrorNotice(503, null).errorKey, "generic");
    assert.equal(view.startErrorNotice(500, { ok: false, error: "daily_limit_reached" }).errorKey, "generic");
    assert.equal(view.startErrorNotice(500, { ok: false, error: "builder_unavailable" }).errorKey, "generic");
  });

  it("이미 만드는 중(409) → 그 잡 id를 돌려준다(화면이 이어서 보여준다)", () => {
    assert.deepEqual(view.startErrorNotice(409, { ok: false, error: "build_already_active", activeJobId: "bj_7f3a9c1d2e", status: "implementing" }), {
      errorKey: "alreadyActive",
      resetAt: null,
      activeJobId: "bj_7f3a9c1d2e",
    });
  });

  it("옛 서버(빌드 라우트 없음) 방어: 전역 404 `{error:\"not found\"}`·JSON 아닌 404 → unavailable, 라우트의 not_found는 아니다", () => {
    assert.equal(view.startErrorNotice(404, { error: "not found", path: "/workspace/projects/wsp_x/build" }).errorKey, "unavailable");
    assert.equal(view.startErrorNotice(404, null).errorKey, "unavailable");
    assert.equal(view.isRouteMissing(404, { ok: false, error: "not_found" }), false);
    assert.equal(view.isRouteMissing(500, null), false);
  });

  it("네트워크 실패(0) → network · 모르는 코드 → generic", () => {
    assert.equal(view.startErrorNotice(0, null).errorKey, "network");
    assert.equal(view.startErrorNotice(418, { ok: false, error: "teapot" }).errorKey, "generic");
  });

  it("어조: 사용자 잘못이 아닌 것은 안내(info)", () => {
    for (const k of ["unavailable", "notReady", "paused", "dailyLimitReached", "alreadyActive"]) assert.equal(view.startErrorTone(k), "info", k);
    for (const k of ["notSynced", "needSpec", "noWorkItems", "hostingFailed", "network", "generic"]) assert.equal(view.startErrorTone(k), "error", k);
  });
});

// ─── 응답 경계 파싱 ─────────────────────────────────────────────────────────

describe("B-8 응답 파싱 — 필드마다 검사", () => {
  const raw = {
    id: "bj_7f3a9c1d2e",
    projectId: "wsp_tp7x9k2m1q",
    userKey: "uk_should_not_travel",
    slug: "app-7x9k2m1q",
    status: "implementing",
    failedStage: null,
    error: null,
    wbsDone: 2,
    wbsTotal: 5,
    budgetUsd: 10,
    spentUsd: 0.4213,
    deployedUrl: null,
    createdAt: "2026-09-30T05:00:00.000Z",
    updatedAt: "2026-09-30T05:03:00.000Z",
  };

  it("잡을 화면용으로 — userKey는 옮기지 않는다", () => {
    const j = view.parseBuildJob(raw);
    assert.equal(j.id, "bj_7f3a9c1d2e");
    assert.equal(j.status, "implementing");
    assert.equal(j.wbsDone, 2);
    assert.equal(j.wbsTotal, 5);
    assert.equal("userKey" in j, false);
  });

  it("id·status가 없거나 모양이 아니면 null", () => {
    for (const bad of [null, "x", 1, [], {}, { id: "bj_1" }, { status: "queued" }]) assert.equal(view.parseBuildJob(bad), null);
  });

  it("주소는 안전한 https만 — javascript:·http:·깨진 값은 버린다", () => {
    assert.equal(view.parseBuildJob({ ...raw, status: "done", deployedUrl: "javascript:alert(1)" }).deployedUrl, null);
    assert.equal(view.parseBuildJob({ ...raw, status: "done", deployedUrl: "http://app-7x9k2m1q.simsa.page" }).deployedUrl, null);
    assert.equal(view.parseBuildJob({ ...raw, status: "done", deployedUrl: "https://app-7x9k2m1q.simsa.page" }).deployedUrl, "https://app-7x9k2m1q.simsa.page/");
  });

  it("타임라인: 모양이 아닌 항목은 버린다", () => {
    const ev = view.parseBuildEvents([{ id: "bje_1", at: "t", stage: "queued", message: "repo_ready" }, null, { id: "bje_2" }, "x"]);
    assert.deepEqual(ev, [{ id: "bje_1", at: "t", stage: "queued", message: "repo_ready" }]);
    assert.deepEqual(view.parseBuildEvents(null), []);
  });

  it("최근 잡 복원 — 새로고침·재방문 시 가장 최근 것", () => {
    const jobs = [
      { id: "bj_old", createdAt: "2026-09-29T01:00:00.000Z" },
      { id: "bj_new", createdAt: "2026-09-30T01:00:00.000Z" },
      { id: "bj_mid", createdAt: "2026-09-29T12:00:00.000Z" },
    ];
    assert.equal(view.latestBuildJob(jobs).id, "bj_new");
    assert.equal(view.latestBuildJob([]), null);
    assert.equal(view.latestBuildJob(null), null);
  });
});

// ─── 가용성·사이드바 사실 (옛 서버 방어) ───────────────────────────────────────

describe("B-8 가용성 — 옛 서버면 만들기를 내밀지 않는다", () => {
  it("buildAvailability", () => {
    assert.equal(view.buildAvailability(null), "loading");
    assert.equal(view.buildAvailability({ ok: true }), "available");
    assert.equal(view.buildAvailability({ ok: false, status: 404, routeMissing: true }), "missing");
    assert.equal(view.buildAvailability({ ok: false, status: 404, routeMissing: false }), "available");
    assert.equal(view.buildAvailability({ ok: false, status: 500, routeMissing: false }), "unknown");
    assert.equal(view.buildAvailability({ ok: false, status: 0, routeMissing: false }), "unknown");
  });

  it("hostedBuildFact(사이드바 '내 앱'): 잡 있음 true · 없음/라우트 없음/프로젝트 없음 false · 일시 실패 null", () => {
    assert.equal(view.hostedBuildFact({ ok: true, jobs: [{ id: "bj_1" }] }), true);
    assert.equal(view.hostedBuildFact({ ok: true, jobs: [] }), false);
    assert.equal(view.hostedBuildFact({ ok: false, status: 404, routeMissing: true }), false);
    assert.equal(view.hostedBuildFact({ ok: false, status: 404, routeMissing: false }), false);
    assert.equal(view.hostedBuildFact({ ok: false, status: 503, routeMissing: false }), null);
    assert.equal(view.hostedBuildFact(null), null);
  });

  it("makePanelVisible: 아이디어·기획서 문만(D-17 S) · 앱 있는 문·역추론 지시서·옛 서버·닫힘은 숨김 · 모르면 보류", () => {
    // ★의도된 변경 (PR #578 검증 결함 2): 서버가 열었다고 확인한 경우(open true)에만 보인다.
    const v = (x) => view.makePanelVisible({ entryPath: "idea", presence: false, specSource: "generated", availability: "available", open: true, ...x });
    assert.equal(v({}), true);
    assert.equal(v({ entryPath: "spec" }), true);
    assert.equal(v({ entryPath: "code" }), false);
    assert.equal(v({ presence: true }), false);
    assert.equal(v({ specSource: "inferred" }), false);
    assert.equal(v({ availability: "missing" }), false);
    assert.equal(v({ availability: "loading" }), null);
    assert.equal(v({ presence: null }), null);
    assert.equal(v({ open: false }), false);
    assert.equal(v({ open: null }), null);
    // 목록 조회가 일시 실패해도(열림은 확인됨) 버튼은 보인다 — 누르면 서버가 정직하게 답한다(409면 그 잡을 잇는다).
    assert.equal(v({ availability: "unknown" }), true);
  });

  it("myAppEmptyState: 잡이 없을 때 내 앱 화면이 그리는 것 — 한 곳에서", () => {
    const s = (x) => view.myAppEmptyState({ availability: "available", open: true, entryPath: "idea", presence: false, specSource: "generated", devSpecLoaded: true, hasDevSpec: true, ...x });
    assert.equal(s({}), "make");
    assert.equal(s({ hasDevSpec: false }), "needSpec");
    assert.equal(s({ open: false }), "closed");
    assert.equal(s({ availability: "missing" }), "closed");
    assert.equal(s({ entryPath: "code" }), "notForThis");
    assert.equal(s({ presence: true, open: false }), "notForThis", "이미 앱이 있으면 닫힘보다 그 말이 먼저");
    assert.equal(s({ specSource: "inferred" }), "notForThis");
    assert.equal(s({ availability: "loading" }), "hold");
    assert.equal(s({ presence: null, open: false }), "hold", "앱 유무를 모르면 닫힘도 아직 말하지 않는다(뒤집힘 방지)");
    assert.equal(s({ open: null }), "hold");
    assert.equal(s({ devSpecLoaded: false }), "hold");
    assert.equal(s({ availability: "unknown" }), null);
  });

  it("makePanelState: 최근 잡 기준", () => {
    assert.equal(view.makePanelState(null), "make");
    assert.equal(view.makePanelState({ status: "implementing" }), "active");
    assert.equal(view.makePanelState({ status: "done" }), "done");
    assert.equal(view.makePanelState({ status: "failed" }), "make");
    assert.equal(view.makePanelState({ status: "reviewing" }), "make");
  });
});

// ─── 시작 전 안내 (개발자 모드 아닐 때 A 경로 문장 0) ────────────────────────────

describe("B-8 시작 전 안내 줄", () => {
  it("기본 흐름: 무엇을 · (안 만드는 것) · 예상 시간 · 비용 없음 · Simsa 주소 — A 경로 문장 없음", () => {
    assert.deepEqual(view.makeIntroKeys({ developerMode: false, hasExcluded: true }), ["what", "excluded", "eta", "free", "hosted"]);
    assert.deepEqual(view.makeIntroKeys({ developerMode: false, hasExcluded: false }), ["what", "eta", "free", "hosted"]);
    assert.ok(!view.makeIntroKeys({ developerMode: false, hasExcluded: true }).includes("devPath"));
  });

  it("개발자 모드일 때만 A 경로(내 저장소·내 배포) 문장", () => {
    assert.deepEqual(view.makeIntroKeys({ developerMode: true, hasExcluded: false }), ["what", "eta", "free", "hosted", "devPath"]);
  });

  it("[PILOT] 예상 소요 숫자는 컨테이너의 잡 상한과 같다(D-4 45분)", () => {
    const m = /JOB_TIMEOUT_MS = (\d+) \* 60 \* 1000/.exec(builderServer);
    assert.ok(m, "JOB_TIMEOUT_MS");
    assert.equal(view.BUILD_EXPECTED_MAX_MINUTES, Number(m[1]));
  });
});

// ─── 내 앱 카드 (D-6) ───────────────────────────────────────────────────────

describe("B-8 내 앱 카드", () => {
  const done = { status: "done", deployedUrl: "https://app-7x9k2m1q.simsa.page/" };

  // ★의도된 변경(#578 스위치 단일화 커밋): 신고 링크는 앱 origin의 /.well-known/simsa-report(B-7이 302로 보내는 입구)가
  // 아니라 B-7 신고 사이트 직행 — B-7 대조는 build-report-link-paused.test.mjs.
  it("신고 링크 — https://report.<루트>/?app=<slug> (B-7 신고 사이트 직행)", () => {
    assert.equal(view.hostedReportUrl("https://app-7x9k2m1q.simsa.page/"), "https://report.simsa.page/?app=app-7x9k2m1q");
    assert.equal(view.hostedReportUrl("https://app-7x9k2m1q.simsa.page/some/page?x=1"), "https://report.simsa.page/?app=app-7x9k2m1q");
    assert.equal(view.hostedReportUrl("javascript:alert(1)"), null);
    assert.equal(view.hostedReportUrl(null), null);
  });

  it("마지막 확인 결과: 이 앱 주소(호스트)를 검수한 끝난 런 중 최근 것 — 한글 호스트(IDN)도 같은 앱으로 본다", () => {
    const checks = [
      { id: "wvc_other", targetUrl: "https://truepixel-booking.vercel.app/", status: "done", createdAt: "2026-09-30T09:00:00.000Z" },
      { id: "wvc_running", targetUrl: "https://app-7x9k2m1q.simsa.page/", status: "running", createdAt: "2026-09-30T08:00:00.000Z" },
      { id: "wvc_old", targetUrl: "https://app-7x9k2m1q.simsa.page", status: "done", createdAt: "2026-09-30T06:00:00.000Z" },
      { id: "wvc_new", targetUrl: "https://APP-7x9k2m1q.simsa.page/예약", status: "uploaded", createdAt: "2026-09-30T07:00:00.000Z" },
    ];
    assert.equal(view.latestCheckForApp(checks, done.deployedUrl), "wvc_new");
    const idn = [{ id: "wvc_idn", targetUrl: "https://xn--2s2bq6m9rd4pan12cvrd.simsa.page/", status: "done", createdAt: "2026-09-30T06:00:00.000Z" }];
    assert.equal(view.latestCheckForApp(idn, "https://트루픽셀예약.simsa.page"), "wvc_idn");
    assert.equal(view.latestCheckForApp([], done.deployedUrl), null);
  });

  it("done일 때만 카드 — 주소·신고·(있으면) 확인 결과·(있으면) 받아가기", () => {
    assert.deepEqual(view.appCardView(done, []), {
      url: "https://app-7x9k2m1q.simsa.page/",
      reportUrl: "https://report.simsa.page/?app=app-7x9k2m1q",
      checkRunId: null,
      downloadUrl: null,
    });
    assert.equal(view.appCardView({ status: "implementing", deployedUrl: done.deployedUrl }), null);
    assert.equal(view.appCardView({ status: "done", deployedUrl: null }), null);
    assert.equal(view.appCardView({ ...done, downloadUrl: "https://central.example/dl/bj_1.zip" }).downloadUrl, "https://central.example/dl/bj_1.zip");
  });

  it("예산 줄(D-7): 서버가 준 값만 — 없으면 표시 안 함", () => {
    assert.deepEqual(view.budgetLine({ budgetUsd: 10, spentUsd: 0.4213 }), { budget: "10", spent: "0.42" });
    assert.deepEqual(view.budgetLine({ budgetUsd: 10, spentUsd: null }), { budget: "10", spent: "0" });
    assert.equal(view.budgetLine({ budgetUsd: null, spentUsd: 1 }), null);
    assert.equal(view.budgetLine({ budgetUsd: 0 }), null);
    assert.equal(view.budgetLine(null), null);
  });
});
