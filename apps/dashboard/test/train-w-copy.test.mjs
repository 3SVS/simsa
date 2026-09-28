/**
 * Train W — 사전(KO/EN) 문구 계약.
 *
 *  W-2 (D-7 amend): 429·503 정직 카피 — KO는 서버·대시보드 계약 문장 그대로.
 *  W-3 ① queued 카피 정직화: 서버는 디스패치가 안 되면 행을 **즉시 실패로** 바꾼다(fail-fast,
 *       workspace-visual-check-runs.ts "nothing ever picks a queued row up later"). 그런데 화면은
 *       "대기열에만 등록됐어요. 준비되면 순서대로 진행돼요"라고 말했다 — 아무도 집어 가지 않는 줄을
 *       기다리라고 한 셈. 대기(queued) 칩·본문은 "순서를 기다리는 중"이고, 걸리는 시간은 실측
 *       근거가 있는 것만 말한다: 검수 요청→리포트 170~250초(docs/simsa-bm-economics-2026-09-27.md
 *       T2 행, HANDOFF-2026-09-24 done 191s·HANDOFF-2026-09-25 done 249s) → "보통 3~4분".
 *       수리는 실측 표본이 없어 숫자를 말하지 않는다.
 *  W-3 ② "공개 저장소는 로그인 불필요"의 범위: **읽기만**. 고치려면 연결이 필요하다(D-15·재정렬 §1 #4).
 *  W-3 ③ 수리 결과 카드 1줄(계약 4) + auto_fix 완료 문구(코드를 실제로 고친 PR인데 "코드 자동 수정은
 *       아직"이라고 말하던 카드와 빌드 미확인 1줄이 서로 모순되지 않게).
 *  D-17: 새 문구에 초보자 금칙어 0 (tools/simsa-completion-loop-spike/lib/beginner-terms.mjs).
 *
 * 각 검사는 고치기 전 사전에서 실패한다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { DICTIONARIES } = await import("../src/i18n/dictionary.mjs");
const { devTermHits } = await import("../../../tools/simsa-completion-loop-spike/lib/beginner-terms.mjs");

const ko = DICTIONARIES.ko;
const en = DICTIONARIES.en;
const HANGUL = /[가-힣]/;

/** Train W가 새로 들인 문구 — 두 언어 모두 있어야 하고, 초보자 금칙어가 0이어야 한다. */
function trainWStrings(d) {
  const vc = d.visualChecks;
  return {
    "runErrors.dailyLimitReached": vc.runErrors.dailyLimitReached,
    "runErrors.dailyLimitReachedAt": vc.runErrors.dailyLimitReachedAt,
    "runErrors.inspectionDisabled": vc.runErrors.inspectionDisabled,
    "repair.errors.dailyLimitReached": vc.repair.errors.dailyLimitReached,
    "repair.errors.dailyLimitReachedAt": vc.repair.errors.dailyLimitReachedAt,
    "repair.errors.repairDisabled": vc.repair.errors.repairDisabled,
    statusQueued: vc.statusQueued,
    progressBodyQueued: vc.progressBodyQueued,
    progressBody: vc.progressBody,
    runQueuedOnly: vc.runQueuedOnly,
    "repair.statusQueued": vc.repair.statusQueued,
    "repair.progressBodyQueued": vc.repair.progressBodyQueued,
    "repair.buildUnverified": vc.repair.buildUnverified,
  };
}

describe("W-2 계약 문장 (KO 그대로)", () => {
  it("검수 상한·일시 중지", () => {
    assert.equal(ko.visualChecks.runErrors.dailyLimitReached, "오늘 확인 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.");
    assert.equal(ko.visualChecks.runErrors.inspectionDisabled, "지금은 확인을 잠시 멈췄어요. 곧 다시 열게요.");
  });

  it("수리 상한·일시 중지 (동일 패턴)", () => {
    assert.equal(ko.visualChecks.repair.errors.dailyLimitReached, "오늘 고치기 횟수를 다 썼어요. 내일(자정 UTC 이후) 다시 할 수 있어요.");
    assert.equal(ko.visualChecks.repair.errors.repairDisabled, "지금은 고치기를 잠시 멈췄어요. 곧 다시 열게요.");
  });

  it("시각이 들어가는 변형은 {when} 자리 하나 — 두 언어 모두", () => {
    for (const d of [ko, en]) {
      for (const s of [d.visualChecks.runErrors.dailyLimitReachedAt, d.visualChecks.repair.errors.dailyLimitReachedAt]) {
        assert.equal(typeof s, "string");
        assert.equal(s.split("{when}").length - 1, 1, s);
      }
    }
  });

  it("EN 동등 문구 — 한글 0, 비어 있지 않음, 상한 문구는 날짜 기준(UTC 자정)을 말한다", () => {
    for (const [k, s] of Object.entries(trainWStrings(en))) {
      assert.equal(typeof s, "string", k);
      assert.ok(s.trim().length > 0, k);
      assert.ok(!HANGUL.test(s), `${k}: ${s}`);
    }
    assert.match(en.visualChecks.runErrors.dailyLimitReached, /midnight UTC/);
    assert.match(en.visualChecks.repair.errors.dailyLimitReached, /midnight UTC/);
  });
});

describe("D-17: Train W 새 문구에 초보자 금칙어 0 (KO/EN)", () => {
  for (const [loc, d] of [["ko", ko], ["en", en]]) {
    it(`[${loc}]`, () => {
      for (const [k, s] of Object.entries(trainWStrings(d))) {
        assert.equal(typeof s, "string", `${loc}.${k} missing`);
        assert.deepEqual(devTermHits(s), [], `${loc}.${k}: "${s}"`);
      }
    });
  }
});

describe("W-3 ① queued 카피 정직화", () => {
  it("대기 칩은 '순서를 기다리는 중' — 검수·수리 모두", () => {
    assert.match(ko.visualChecks.statusQueued, /순서/);
    assert.match(ko.visualChecks.repair.statusQueued, /순서/);
    assert.match(en.visualChecks.statusQueued, /turn/i);
    assert.match(en.visualChecks.repair.statusQueued, /turn/i);
  });

  it("대기 본문은 실측 근거가 있는 시간(검수 170~250초 → 보통 3~4분)만 말한다", () => {
    assert.match(ko.visualChecks.progressBodyQueued, /순서를 기다리는 중이에요/);
    assert.match(ko.visualChecks.progressBodyQueued, /보통 3~4분/);
    assert.match(en.visualChecks.progressBodyQueued, /usually takes 3–4 minutes/);
    assert.match(ko.visualChecks.progressBody, /보통 3~4분/);
    assert.match(en.visualChecks.progressBody, /usually takes 3–4 minutes/);
  });

  it("수리 대기는 실측 표본이 없어 숫자를 말하지 않는다", () => {
    assert.match(ko.visualChecks.repair.progressBodyQueued, /순서를 기다리는 중이에요/);
    assert.ok(!/\d/.test(ko.visualChecks.repair.progressBodyQueued), ko.visualChecks.repair.progressBodyQueued);
    assert.ok(!/\d/.test(en.visualChecks.repair.progressBodyQueued), en.visualChecks.repair.progressBodyQueued);
  });

  it("디스패치 실패(dispatched:false)는 서버가 즉시 실패 처리한다 — '대기열에서 순서대로 진행'이라고 하지 않는다", () => {
    assert.ok(!/대기열에만|순서대로 진행/.test(ko.visualChecks.runQueuedOnly), ko.visualChecks.runQueuedOnly);
    assert.ok(!/added to the queue|picked up/i.test(en.visualChecks.runQueuedOnly), en.visualChecks.runQueuedOnly);
    assert.match(ko.visualChecks.runQueuedOnly, /다시/);
    assert.match(en.visualChecks.runQueuedOnly, /try again/i);
  });
});

describe("W-3 ② '공개 저장소는 로그인 불필요'의 범위 = 읽기만", () => {
  const koHints = [ko.branch.submitHint, ko.sources.githubHint, ko.sources.reach.repoReadablePublic];
  const enHints = [en.branch.submitHint, en.sources.githubHint, en.sources.reach.repoReadablePublic];

  it("KO: '읽기만'과 '고치려면 연결'을 함께 말한다", () => {
    for (const s of koHints) {
      assert.match(s, /읽기만/, s);
      assert.match(s, /고치려면/, s);
      assert.match(s, /연결/, s);
    }
  });

  it("EN: 'reading only' and fixing needs a connection", () => {
    for (const s of enHints) {
      assert.match(s, /reading only/i, s);
      assert.match(s, /fix/i, s);
      assert.match(s, /connect/i, s);
    }
  });
});

describe("W-3 ③ 수리 결과 카드", () => {
  it("빌드 미확인 1줄 (계약 4 KO 그대로)", () => {
    assert.equal(ko.visualChecks.repair.buildUnverified, "고친 코드가 실제로 빌드되는지는 확인하지 못했어요.");
    assert.match(en.visualChecks.repair.buildUnverified, /couldn't confirm/i);
  });

  it("auto_fix 완료 문구는 '코드 자동 수정은 아직'이라고 하지 않는다 (지시서만 올린 잡의 문구와 분리)", () => {
    for (const d of [ko, en]) {
      const r = d.visualChecks.repair;
      assert.equal(typeof r.doneTitleAutoFix, "string");
      assert.equal(typeof r.doneBodyAutoFix, "string");
      assert.ok(!/SIMSA-FIX-BRIEF|아직|not applied/i.test(r.doneBodyAutoFix), r.doneBodyAutoFix);
    }
    // 지시서만 올린 잡(brief_only)의 기존 문구는 그대로 — 그 경계는 여전히 사실이다.
    assert.ok(ko.visualChecks.repair.doneBody.includes("SIMSA-FIX-BRIEF.md"));
    assert.ok(en.visualChecks.repair.doneBody.includes("SIMSA-FIX-BRIEF.md"));
  });
});
