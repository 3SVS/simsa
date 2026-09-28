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
 *  W-3 ③ (D-4 keep — 게이트가 아닌 라벨): 수리 잡 뷰 buildVerified === false일 때만
 *      "고친 코드가 실제로 빌드되는지는 확인하지 못했어요" 1줄. true·null·필드 없음(옛 서버)은 표기 없음.
 *
 * 네임스페이스 import — 옛 코드에서 새 함수가 없으면 **그 검사만** 실패한다(파일 전체 로드 실패가
 * 아니라). 각 검사는 고치기 전 코드에서 실패하고, "행동 보존" 표시가 붙은 것만 옛 코드에서도 통과한다.
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
      runState.runErrorNotice({ ok: false, error: "run_already_active", resetAt: RESET }),
      { errorKey: "runAlreadyActive", resetAt: null },
    );
  });

  it("옛 서버·네트워크 실패·쓰레기 → generic", () => {
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

  it("옛 서버의 기존 코드는 그대로 (repair_already_active 등) · 모르는 코드는 generic", () => {
    assert.deepEqual(repairState.repairErrorNotice({ ok: false, error: "repair_already_active", activeJobId: "rj_1" }), {
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

  it("buildVerified === false → 표기", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: false }), true);
    // mode를 모르는 행이라도 서버가 false라고 했으면 말한다.
    assert.equal(repairState.showBuildUnverified({ status: "done", mode: null, buildVerified: false }), true);
  });

  it("true · null(레거시 판단 불가) · 필드 없음(옛 서버) → 표기 없음", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: true }), false);
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: null }), false);
    assert.equal(repairState.showBuildUnverified({ ...done }), false);
  });

  it("엄격 비교 — 0·'false'·undefined는 false가 아니다", () => {
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: 0 }), false);
    assert.equal(repairState.showBuildUnverified({ ...done, buildVerified: "false" }), false);
  });

  it("끝나지 않은 잡·지시서만 올린 잡(brief_only — 코드 변경 없음)은 표기하지 않는다", () => {
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

  it("brief_only · null(Stage 270 이전 행) · 모르는 값 → briefOnly (지시서만)", () => {
    assert.equal(repairState.repairDoneKind({ status: "done", mode: "brief_only" }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done", mode: null }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done" }), "briefOnly");
    assert.equal(repairState.repairDoneKind({ status: "done", mode: "magic" }), "briefOnly");
    assert.equal(repairState.repairDoneKind(null), "briefOnly");
  });
});
