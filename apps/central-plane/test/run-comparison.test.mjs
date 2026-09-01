/**
 * run-comparison.test.mjs — 재검수가 정말 나아졌는지 (2026-09-01).
 *
 * Bae: *"맨날 다 됐다고 하고 알아보면 오류투성이인데 진짜로 한 번에 다 고쳐줄 수
 * 있을지 모르겠다."*
 *
 * 한 번에 다 고쳐진다는 보장은 없다. 그래서 이 모듈의 목적은 고침을 잘하는 게 아니라
 * **"다 고쳤다"를 구조적으로 말할 수 없게 만드는 것**이다.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { compareCheckRuns, comparisonSummary } = await import("../dist/run-comparison.js");
const r = (itemId, status) => ({ itemId, status });

describe("★회귀 — 되던 것이 안 되게 된 것", () => {
  it("통과 → 안 맞음은 회귀다", () => {
    const c = compareCheckRuns([r("a", "passed")], [r("a", "failed")]);
    assert.equal(c.items[0].change, "regressed");
    assert.equal(c.hasRegression, true);
  });

  it("★고친 자리만 보면 성공처럼 보인다 — 회귀가 함께 잡혀야 한다", () => {
    const c = compareCheckRuns(
      [r("a", "failed"), r("b", "passed")],
      [r("a", "passed"), r("b", "failed")],
    );
    assert.equal(c.counts.fixed, 1);
    assert.equal(c.counts.regressed, 1);
    assert.equal(c.allResolved, false, "하나 고치고 하나 깨뜨린 것을 '해결'이라 하면 안 된다");
  });

  it("요약이 회귀를 맨 앞에 놓는다", () => {
    const c = compareCheckRuns([r("a", "passed")], [r("a", "failed")]);
    assert.match(comparisonSummary(c, "ko"), /^되던 것/);
    assert.match(comparisonSummary(c, "en"), /^\d+ item\(s\) that used to work/);
  });
});

describe("★모르는 것을 나쁘다고 하지 않는다", () => {
  it("통과 → 확인 부족은 회귀가 아니라 불확실", () => {
    const c = compareCheckRuns([r("a", "passed")], [r("a", "inconclusive")]);
    assert.equal(c.items[0].change, "uncertain");
    assert.equal(c.hasRegression, false, "확인 못 한 것을 망가졌다고 하면 멀쩡한 수정을 되돌린다");
  });

  it("확인 부족 → 통과는 '고쳐진 것'으로 세지 않는다 — 나쁘다고 판정한 적이 없다", () => {
    const c = compareCheckRuns([r("a", "inconclusive")], [r("a", "passed")]);
    assert.equal(c.counts.fixed, 0);
    assert.equal(c.items[0].change, "still_ok");
  });
});

describe('★"다 고쳤다"는 언제만 말할 수 있는가', () => {
  it("안 맞음도 없고 회귀도 없고 불확실도 없을 때만", () => {
    const c = compareCheckRuns([r("a", "failed"), r("b", "passed")], [r("a", "passed"), r("b", "passed")]);
    assert.equal(c.allResolved, true);
    assert.match(comparisonSummary(c, "ko"), /모두 확인됐어요/);
  });

  it("★확인 부족이 하나라도 있으면 '다 해결'이 아니다", () => {
    const c = compareCheckRuns([r("a", "failed"), r("b", "passed")], [r("a", "passed"), r("b", "inconclusive")]);
    assert.equal(c.allResolved, false, "확인 부족을 성공으로 세면 '다 고쳤습니다'가 다시 거짓말이 된다");
  });

  it("남은 것이 있으면 숫자로 말한다 — 사용자가 남은 하나를 알고 넘어가야 한다", () => {
    const c = compareCheckRuns([r("a", "failed"), r("b", "failed")], [r("a", "passed"), r("b", "failed")]);
    assert.match(comparisonSummary(c, "ko"), /1개 고쳐졌고.*1개는 아직/);
  });

  it("첫 검수(이전 없음)는 전부 new — '고쳐졌다'가 성립하지 않는다", () => {
    const c = compareCheckRuns(null, [r("a", "passed"), r("b", "failed")]);
    assert.equal(c.counts.new, 2);
    assert.equal(c.counts.fixed, 0);
  });

  it("항목이 없으면 다 해결이라고 하지 않는다", () => {
    assert.equal(compareCheckRuns([], []).allResolved, false);
  });
});

describe("항목이 늘거나 줄어도 안전하다", () => {
  it("새 항목은 new로 센다", () => {
    const c = compareCheckRuns([r("a", "passed")], [r("a", "passed"), r("b", "failed")]);
    assert.equal(c.counts.new, 1);
  });

  it("사라진 항목은 결과에 없다(허위로 만들어내지 않는다)", () => {
    const c = compareCheckRuns([r("a", "passed"), r("gone", "failed")], [r("a", "passed")]);
    assert.equal(c.items.length, 1);
  });
});
