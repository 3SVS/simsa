/**
 * Train W — W-2·W-3 클라이언트 오류 매핑·수리 결과 표기 (순수 함수).
 *
 *  W-2 (D-7 amend [PILOT]): 서버 계약
 *      429 { ok:false, error:"daily_limit_reached", kind, limit, resetAt }
 *      503 { ok:false, error:"inspection_disabled" | "repair_disabled" }
 *    → 검수 시작·재검수(mapRunError / runErrorNotice)와 수리 요청(repairErrorKey /
 *      repairErrorNotice)이 각자의 문구로 말한다. 옛 서버(코드 없음·본문 없는 429/503)는
 *      "상한"이나 "멈춤"을 **주장하지 않고** 일반 문구로 돌아간다 — 인프라 503을 "우리가 멈췄어요"로
 *      말하면 그것도 거짓말이다.
 *  W-3 ③ (D-4 keep — 게이트가 아닌 라벨): 코드를 실제로 고친 잡(mode auto_fix)의 buildVerified === false일
 *      때만 "고친 코드가 실제로 빌드되는지는 확인하지 못했어요" 1줄. true·null·필드 없음(옛 서버)은 표기 없음.
 *      brief_only 잡은 서버가 buildVerified=null을 낸다(계약 확정, #558 검증 P2-2·P2-13).
 *
 * 네임스페이스 import — 옛 코드에서 새 함수가 없으면 **그 검사만** 실패한다(파일 전체 로드 실패가
 * 아니라). 각 검사는 고치기 전 코드에서 실패하고, "행동 보존" 표시가 붙은 것만 옛 코드에서도 통과한다.
 *
 * 표시 규칙(#558 검증 P2-12 — 회귀 증거를 부풀리지 않는다):
 *   [행동 보존]         옛 코드에서도 통과 — 회귀 증거 아님.
 *   [행동 보존·새 API]  옛 코드에서는 "함수 없음(TypeError)"으로만 실패 — 종전 동작을 새 함수 이름으로
 *                       확인하는 것이라 역시 회귀 증거로 세지 않는다.
 *   [가드]              옛 코드에서도 통과(하네스 자체 검사·전체 스캔·소스 대조) — 회귀 증거 아님.
 *   표시 없음           새 동작. 옛 코드에서 값이 달라서 또는 새 API가 없어서 실패(PR 코멘트 표에 둘을 나눠 적음).
 *   (#558 검증 2차 P2-7: main UI는 빌드 미확인 줄을 한 번도 그린 적이 없으므로, "표기 없음"을 단언하는
 *    음성 케이스는 종전 동작을 새 함수 이름으로 확인하는 것 → [행동 보존·새 API].)
 * 픽스처 id는 프로덕션 모양(수리 잡 wrj_ · 검수 wvc_ 접두어, P2-15).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as runState from "../src/lib/visual-check-run-state.mjs";
import * as repairState from "../src/lib/repair-state.mjs";

const RESET = "2026-09-29T00:00:00.000Z";

describe("W-2 검수 요청: mapRunError에 상한·일시 중지 코드", () => {
  it("daily_limit_reached → dailyLimitReached, inspection_disabled → inspectionDisabled", () => {
    assert.equal(runState.mapRunError("daily_limit_reached"), "dailyLimitReached");
    assert.equal(runState.mapRunError("inspection_disabled"), "inspectionDisabled");
  });

  it("[행동 보존] 본문 없는 429/503(인프라)은 상한·멈춤을 주장하지 않는다 → generic", () => {
    assert.equal(runState.mapRunError(429), "generic");
    assert.equal(runState.mapRunError("HTTP 429"), "generic");
    assert.equal(runState.mapRunError(503), "generic");
    assert.equal(runState.mapRunError("HTTP 503"), "generic");
  });

  it("[행동 보존] 옛 서버의 모르는 코드는 여전히 generic", () => {
    assert.equal(runState.mapRunError("rate_limited"), "generic");
    assert.equal(runState.mapRunError("save_failed"), "generic");
  });
});

describe("W-2 검수 요청: runErrorNotice(응답 본문 전체) — resetAt을 화면까지 나른다", () => {
  it("검수 상한(kind inspection) → dailyLimitReached + resetAt", () => {
    assert.deepEqual(
      runState.runErrorNotice({ ok: false, error: "daily_limit_reached", kind: "inspection", limit: 10, resetAt: RESET }),
      { errorKey: "dailyLimitReached", resetAt: RESET },
    );
  });

  it("resetAt이 없거나 깨졌으면 null (화면은 일반 문구)", () => {
    assert.deepEqual(runState.runErrorNotice({ ok: false, error: "daily_limit_reached", kind: "inspection" }), {
      errorKey: "dailyLimitReached",
      resetAt: null,
    });
    assert.deepEqual(runState.runErrorNotice({ ok: false, error: "daily_limit_reached", resetAt: "tomorrow" }), {
      errorKey: "dailyLimitReached",
      resetAt: null,
    });
  });

  it("503 inspection_disabled → inspectionDisabled, resetAt 없음", () => {
    assert.deepEqual(runState.runErrorNotice({ ok: false, error: "inspection_disabled" }), {
      errorKey: "inspectionDisabled",
      resetAt: null,
    });
  });

  it("상한이 아닌 오류는 resetAt을 싣지 않는다 (엉뚱한 본문의 resetAt 무시)", () => {
    assert.deepEqual(
      runState.runErrorNotice({ ok: false, error: "run_already_active", activeRunId: "wvc_mfk2a1b3c", resetAt: RESET }),
      { errorKey: "runAlreadyActive", resetAt: null },
    );
  });

  it("[행동 보존·새 API] 옛 서버·네트워크 실패·쓰레기 → generic", () => {
    assert.deepEqual(runState.runErrorNotice({ ok: false, error: "HTTP 429" }), { errorKey: "generic", resetAt: null });
    assert.deepEqual(runState.runErrorNotice({ ok: false, error: "TypeError: fetch failed" }), {
      errorKey: "generic",
      resetAt: null,
    });
    assert.deepEqual(runState.runErrorNotice(null), { errorKey: "generic", resetAt: null });
    assert.deepEqual(runState.runErrorNotice(undefined), { errorKey: "generic", resetAt: null });
  });
});

describe("W-2 검수 요청: runErrorTone — 상한·멈춤은 사용자 잘못이 아니다(빨간 오류 아님)", () => {
  it("상한·멈춤·진행 중·주소 필요 → info, 그 밖 → error", () => {
    for (const k of ["dailyLimitReached", "inspectionDisabled", "runAlreadyActive", "websiteSourceRequired"]) {
      assert.equal(runState.runErrorTone(k), "info", k);
    }
    for (const k of ["forbidden", "projectNotFound", "invalidIntent", "generic"]) {
      assert.equal(runState.runErrorTone(k), "error", k);
    }
  });

  it("SERVICE_GATE_TOAST_MS — 약 50자 문장을 읽을 시간 (기본 3초 토스트보다 길게, #558 검증 P2-4)", () => {
    assert.equal(typeof runState.SERVICE_GATE_TOAST_MS, "number");
    assert.ok(runState.SERVICE_GATE_TOAST_MS >= 8000, String(runState.SERVICE_GATE_TOAST_MS));
  });

  it("isServiceGateKey — 새 프로젝트의 자동 첫 검수가 조용히 삼키면 안 되는 두 경우", () => {
    assert.equal(runState.isServiceGateKey("dailyLimitReached"), true);
    assert.equal(runState.isServiceGateKey("inspectionDisabled"), true);
    for (const k of ["runAlreadyActive", "websiteSourceRequired", "generic", "forbidden", undefined]) {
      assert.equal(runState.isServiceGateKey(k), false, String(k));
    }
  });
});

describe("W-2 수리 요청: repairErrorKey·repairErrorNotice (kind별 — 수리는 수리의 문구)", () => {
  it("daily_limit_reached → dailyLimitReached, repair_disabled → repairDisabled", () => {
    assert.equal(repairState.repairErrorKey("daily_limit_reached"), "dailyLimitReached");
    assert.equal(repairState.repairErrorKey("repair_disabled"), "repairDisabled");
  });

  it("[행동 보존] 본문 없는 429/503은 generic (상한·멈춤 주장 금지)", () => {
    assert.equal(repairState.repairErrorKey(429), "generic");
    assert.equal(repairState.repairErrorKey("HTTP 503"), "generic");
  });

  it("수리 상한(kind repair) → resetAt을 싣는다", () => {
    assert.deepEqual(
      repairState.repairErrorNotice({ ok: false, error: "daily_limit_reached", kind: "repair", limit: 5, resetAt: RESET }),
      { errorKey: "dailyLimitReached", resetAt: RESET },
    );
  });

  it("503 repair_disabled → repairDisabled", () => {
    assert.deepEqual(repairState.repairErrorNotice({ ok: false, error: "repair_disabled" }), {
      errorKey: "repairDisabled",
      resetAt: null,
    });
  });

  it("[행동 보존·새 API] 옛 서버의 기존 코드는 그대로 (repair_already_active 등) · 모르는 코드는 generic", () => {
    assert.deepEqual(repairState.repairErrorNotice({ ok: false, error: "repair_already_active", activeJobId: "wrj_mfk2a1b3c" }), {
      errorKey: "alreadyActive",
      resetAt: null,
    });
    assert.deepEqual(repairState.repairErrorNotice({ ok: false, error: "HTTP 429" }), {
      errorKey: "generic",
      resetAt: null,
    });
    assert.deepEqual(repairState.repairErrorNotice(null), { errorKey: "generic", resetAt: null });
  });

  it("repairErrorTone — 상한·멈춤은 info", () => {
    assert.equal(repairState.repairErrorTone("dailyLimitReached"), "info");
    assert.equal(repairState.repairErrorTone("repairDisabled"), "info");
    assert.equal(repairState.repairErrorTone("generic"), "error");
    assert.equal(repairState.repairErrorTone("forbidden"), "error");
  });
});

describe("W-3 ③ 수리 결과: showBuildUnverified (계약 3 — false일 때만)", () => {
  const done = { status: "done", mode: "auto_fix" };

  it("auto_fix + buildVerified === false → 표기", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: false }), true);
  });

  // PR #558 검증 P2-2·P2-13 — mode가 null(레거시·모르는 값)이면 카드는 repairDoneKind → briefOnly
  // ("코드가 자동으로 수정된 건 아직 아니에요")를 그리는데, 옛 코드는 같은 카드에 "고친 코드가 빌드되는지
  // 확인 못 했어요"를 같이 띄웠다. 계약 확정: 빌드 표기는 **코드를 실제로 고친 잡(auto_fix)**에만.
  // 서버 쪽 계약 문장: brief_only → buildVerified=null, 계산 대상은 autoFix.changedFiles만
  // (SIMSA-FIX-BRIEF.md 제외) — 서버 PR이 같은 값을 고정한다.
  it("mode가 null·모르는 값이면 buildVerified:false라도 표기하지 않는다 (지시서 문구와 모순 금지)", () => {
    assert.equal(repairState.showBuildUnverified({ status: "done", mode: null, buildVerified: false }), false);
    assert.equal(repairState.showBuildUnverified({ status: "done", buildVerified: false }), false);
    assert.equal(repairState.showBuildUnverified({ status: "done", mode: "magic", buildVerified: false }), false);
  });

  it("빌드 표기가 뜨면 완료 문구는 반드시 auto_fix 문구다 (같은 기준)", () => {
    for (const mode of ["auto_fix", "brief_only", null, undefined, "magic"]) {
      for (const buildVerified of [true, false, null, undefined]) {
        const job = { status: "done", mode, buildVerified };
        if (repairState.showBuildUnverified(job)) {
          assert.equal(repairState.repairDoneKind(job), "autoFix", JSON.stringify(job));
        }
      }
    }
  });

  it("[행동 보존·새 API] true · null(레거시 판단 불가) · 필드 없음(옛 서버) → 표기 없음", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: true }), false);
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: null }), false);
    assert.equal(repairState.showBuildUnverified({ ...done }), false);
  });

  it("[행동 보존·새 API] 엄격 비교 — 0·'false'·undefined는 false가 아니다", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: 0 }), false);
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: "false" }), false);
  });

  it("[행동 보존·새 API] 끝나지 않은 잡·지시서만 올린 잡(brief_only — 코드 변경 없음)은 표기하지 않는다", () => {
    assert.equal(repairState.showBuildUnverified({ status: "running", buildVerified: false }), false);
    assert.equal(repairState.showBuildUnverified({ status: "failed", buildVerified: false }), false);
    assert.equal(repairState.showBuildUnverified({ status: "done", mode: "brief_only", buildVerified: false }), false);
    assert.equal(repairState.showBuildUnverified(null), false);
    assert.equal(repairState.showBuildUnverified(undefined), false);
  });
});

describe("W-3 ③ 수리 결과: repairDoneKind — 코드를 실제로 고친 잡의 완료 문구", () => {
  it("auto_fix → autoFix (고친 코드가 담긴 PR)", () => {
    assert.equal(repairState.repairDoneKind({ status: "done", mode: "auto_fix" }), "autoFix");
  });

  it("[행동 보존·새 API] brief_only · null(Stage 270 이전 행) · 모르는 값 → briefOnly (지시서만)", () => {
    assert.equal(repairState.repairDoneKind({ status: "done", mode: "brief_only" }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done", mode: null }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done" }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done", mode: "magic" }), "briefOnly");
    assert.equal(repairState.repairDoneKind(null), "briefOnly");
  });
});
