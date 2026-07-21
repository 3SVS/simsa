/**
 * evidence-live.test.mjs — Train M-1a (design locked 2026-07-21).
 *
 * Pins:
 *   - 결정론: 같은 입력 → 같은 pack/gate (두 번 조립해 deepEqual)
 *   - PR 리뷰 per-item 결과 → per-criterion verified/broken (3열 체인 근거)
 *   - works=false + 리포트 findings → crossReview 블로커 → gate "Needs Fix"
 *   - works=null → visual notVerified (정직) / works=false는 notVerified 아님
 *   - Browser facts와 interpretations(AI Opinion) 분리 운반
 *   - 숫자 점수 금지: receipt가 assertNoNumericScores 통과
 *   - parseReportFacts: corrupt JSON에도 throw 없음
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleLiveEvidence, parseReportFacts } from "../dist/workspace/evidence-live.js";
import { createReceipt, assertNoNumericScores } from "../dist/evidence-pack.js";

const BASE = {
  projectId: "proj_1",
  productSpec: {
    productName: "빵집 예약",
    oneLine: "동네 빵집 픽업 예약 앱",
    problem: "전화 예약이 불편하다",
    targetUsers: ["동네 주민"],
    included: ["예약 생성", "픽업 시간 선택"],
    excluded: ["결제"],
    openQuestions: [],
  },
  items: [
    { id: "item-1", title: "예약을 만들 수 있다" },
    { id: "item-2", title: "픽업 시간을 고를 수 있다" },
    { id: "item-3", title: "예약 목록을 볼 수 있다" },
  ],
};

const REVIEW = {
  repoFullName: "acme/bakery",
  prNumber: 4,
  results: [
    { itemId: "item-1", title: "예약을 만들 수 있다", status: "passed" },
    { itemId: "item-2", title: "픽업 시간을 고를 수 있다", status: "failed" },
    // item-3: 리뷰가 다루지 않음 → not_verified
  ],
};

const RUN_OK = { id: "wvc_1", intent: "예약 완주 확인", decision: "Ready", works: true, reportJson: null };

test("결정론: 같은 입력 → 같은 evidence (전 필드 deepEqual)", () => {
  const a = assembleLiveEvidence({ ...BASE, run: RUN_OK, latestReview: REVIEW });
  const b = assembleLiveEvidence({ ...BASE, run: RUN_OK, latestReview: REVIEW });
  assert.deepEqual(a, b);
});

test("PR 리뷰 per-item 결과 → per-criterion 상태 + observedBy (3열 체인)", () => {
  const ev = assembleLiveEvidence({ ...BASE, run: RUN_OK, latestReview: REVIEW });
  const byId = new Map(ev.criteria.map((c) => [c.id, c]));
  assert.equal(byId.get("item-1").status, "verified");
  assert.equal(byId.get("item-2").status, "broken");
  assert.equal(byId.get("item-3").status, "not_verified");
  assert.deepEqual(byId.get("item-1").observedBy, ["예약을 만들 수 있다"]);
  assert.deepEqual(byId.get("item-3").observedBy, []);
});

test("works=false + findings → 시각 검수가 블로커로, gate=Needs Fix", () => {
  const report = JSON.stringify({
    findings: [{ what: "예약 버튼을 눌러도 아무 일도 일어나지 않아요" }],
    steps: [{ label: "예약 시도", ok: false, screenshot: "s1.png" }],
    consoleErrors: ["TypeError: reserve is not a function"],
  });
  const ev = assembleLiveEvidence({
    ...BASE,
    run: { id: "wvc_2", intent: "예약 완주", decision: "Needs Fix", works: false, reportJson: report },
    latestReview: null,
  });
  assert.equal(ev.gate.decision, "Needs Fix");
  assert.ok(ev.pack.broken.some((b) => b.includes("예약 버튼")));
  // works=false는 "실패를 확인함" — visual notVerified가 아니다.
  assert.equal(ev.pack.visualEvidence.notVerified, false);
  // Browser facts(사실)와 interpretations(해석) 분리.
  assert.deepEqual(ev.browserFacts.consoleErrors, ["TypeError: reserve is not a function"]);
  assert.deepEqual(ev.browserFacts.failedInteractions, ["예약 시도"]);
  assert.deepEqual(ev.interpretations, ["예약 버튼을 눌러도 아무 일도 일어나지 않아요"]);
});

test("works=null → visual notVerified (근거 없으면 Not Verified, 절대 Pass 아님)", () => {
  const ev = assembleLiveEvidence({
    ...BASE,
    run: { id: "wvc_3", intent: "확인", decision: "Not Judged", works: null, reportJson: null },
    latestReview: null,
  });
  assert.equal(ev.pack.visualEvidence.notVerified, true);
  assert.ok(ev.pack.notVerified.some((n) => n.includes("visual")));
  assert.notEqual(ev.gate.decision, "Ready");
});

test("숫자 점수 금지: receipt가 assertNoNumericScores 통과", () => {
  const ev = assembleLiveEvidence({ ...BASE, run: RUN_OK, latestReview: REVIEW });
  const receipt = createReceipt(ev.pack, "release_gate");
  assert.equal(assertNoNumericScores(receipt), true);
});

test("스펙/items 부재 → acceptanceCriteriaMissing, 조작 없이 정직한 gate", () => {
  const ev = assembleLiveEvidence({
    projectId: "proj_bare",
    productSpec: null,
    items: null,
    run: RUN_OK,
    latestReview: null,
  });
  assert.equal(ev.pack.riskFlags.acceptanceCriteriaMissing, true);
  assert.equal(ev.criteria.length, 0);
});

test("parseReportFacts: corrupt/이상 형태에도 throw 없음", () => {
  assert.deepEqual(parseReportFacts(null).consoleErrors, []);
  assert.deepEqual(parseReportFacts("{not json").interpretations, []);
  assert.equal(parseReportFacts(JSON.stringify({ steps: "nope", findings: 42 })).screenshotCount, 0);
});
