import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreG1App, summarizeG1, expectedDecisionOk } from "./g1-score.mjs";

const MUST = ["I1", "I2", "I3", "I4"];
const v = (acId, verdict, extra = {}) => ({ acId, verdict, quotes: ["q"], ...extra });

test("짚음·반대·놓침을 칸별로 나눈다", () => {
  const app = { expected: "broken", mustFailed: ["I3", "I4"] };
  const s = scoreG1App(app, MUST, { decision: "Needs Fix", verdicts: [v("I1", "pass"), v("I2", "pass"), v("I3", "fail"), v("I4", "not_verified")] });
  assert.equal(s.keyCells, 2);
  assert.deepEqual(s.hits.map((h) => h.acId), ["I3"]);
  assert.deepEqual(s.misses.map((m) => m.acId), ["I4"]);
  assert.equal(s.opposite.length, 0);
  assert.equal(s.okDecision, true);
});

test("정답 ❌ 칸을 pass로 보면 반대 판정", () => {
  const s = scoreG1App({ expected: "broken", mustFailed: ["I3"] }, MUST, { decision: "Ready", verdicts: [v("I3", "pass")] });
  assert.deepEqual(s.opposite, ["I3"]);
  assert.equal(s.okDecision, false);
});

test("의도 불일치 칸은 mismatch·fail 둘 다 짚음으로 세고 따로 집계한다", () => {
  const app = { expected: "broken_or_hold", mustFailed: ["I3", "I4"], mismatch: ["I3", "I4"] };
  const s = scoreG1App(app, MUST, { decision: "Needs Fix", verdicts: [v("I3", "mismatch"), v("I4", "fail")] });
  assert.equal(s.mismatchKey, 2);
  assert.equal(s.mismatchHits, 2);
});

test("없는 결함: 묶음 파생·미확인 칸·간헐 칸은 따로 센다", () => {
  const app = { expected: "broken", mustFailed: ["I3"], unknown: ["I2"], intermittent: ["I1"] };
  const r = {
    decision: "Needs Fix",
    verdicts: [v("I1", "fail"), v("I2", "fail"), v("I3", "fail"), v("I4", "fail")],
    defectGroups: [],
  };
  const s = scoreG1App(app, MUST, r);
  assert.deepEqual(s.intermittentHits.map((x) => x.acId), ["I1"]);
  assert.deepEqual(s.unknownFails.map((x) => x.acId), ["I2"]);
  assert.deepEqual(s.extra.map((x) => x.acId), ["I4"]);
  const s2 = scoreG1App(app, MUST, { ...r, defectGroups: [{ acIds: ["I3", "I4"] }] });
  assert.deepEqual(s2.derived.map((x) => x.acId), ["I4"]);
  assert.equal(s2.extra.length, 0);
});

test("첫 화면 고장 앱은 ENTRY 칸 하나", () => {
  const app = { expected: "broken", mustFailed: [], entryBroken: true };
  const hit = scoreG1App(app, MUST, { decision: "Needs Fix", entry: { broken: { cause: "not_found" }, artifactId: "a1" }, verdicts: [] });
  assert.equal(hit.keyCells, 1);
  assert.equal(hit.hits[0].cited, true);
  const miss = scoreG1App(app, MUST, { decision: "Not Verified", entry: { broken: null }, verdicts: [] });
  assert.equal(miss.misses.length, 1);
  const opp = scoreG1App(app, MUST, { decision: "Ready", entry: { broken: null }, verdicts: [] });
  assert.deepEqual(opp.opposite, ["ENTRY"]);
});

test("새벽 전용 칸은 낮엔 분모 밖, 짚으면 기록만", () => {
  const app = { expected: "broken_or_hold", mustFailed: ["A6"], timeDependent: true };
  const day = scoreG1App(app, ["A6"], { decision: "Not Verified", verdicts: [v("A6", "not_verified")] }, 13);
  assert.equal(day.keyCells, 0);
  assert.equal(day.timeDependent.length, 1);
  const night = scoreG1App(app, ["A6"], { decision: "Needs Fix", verdicts: [v("A6", "fail")] }, 3);
  assert.equal(night.keyCells, 1);
  assert.equal(night.hits.length, 1);
});

test("합계와 합격선", () => {
  const rows = [
    { score: scoreG1App({ expected: "broken", mustFailed: ["I3", "I4"] }, MUST, { decision: "Needs Fix", verdicts: [v("I3", "fail"), v("I4", "fail")] }) },
    { score: scoreG1App({ expected: "broken", mustFailed: ["I3"] }, MUST, { decision: "Needs Fix", verdicts: [v("I3", "fail", { quotes: [] })] }) },
    { id: "x", error: "boom" },
  ];
  const s = summarizeG1(rows);
  assert.equal(s.keyCells, 3);
  assert.equal(s.hits, 3);
  assert.equal(s.hitPct, 100);
  assert.equal(s.citedPct, 66.7);
  assert.equal(s.gate.cited100, false);
  assert.equal(s.gate.noErrors, false);
  assert.equal(s.gate.pass, false);
});

test("기대 판정 규칙", () => {
  assert.equal(expectedDecisionOk("works", "Not Verified"), true);
  assert.equal(expectedDecisionOk("works", "Needs Fix"), false);
  assert.equal(expectedDecisionOk("broken_or_hold", "Ready"), false);
});
