import { describe, it } from "node:test";
import assert from "node:assert/strict";

// SI 티어 A5: 수용 기준별 결과가 리포트에 어떻게 오르는가.
// broken → high finding · not_confirmed → medium finding(고장 아님) · no_problem/not_run → 요약에만.
// 점수 없음, EN/KO 동일 구조, 결과가 없으면 리포트는 종전과 동일.

const { buildNonDevReport, classifyFindings } = await import("../dist/nondev-report.js");

const base = {
  targetUrl: "https://app.example.com/",
  intentAnchor: "산책을 기록한다",
  loadStatus: 200,
  primaryActionFound: true,
  interacted: true,
  routeAfterClick: "https://app.example.com/",
  routeChanged: false,
  consoleErrors: [],
  networkFailures: [],
  decision: "User Acceptance Required",
  steps: [],
};

const results = [
  { acceptanceId: "AC-001", featureTitle: "산책 기록", then: "목록에 1건이 보인다", status: "no_problem" },
  { acceptanceId: "AC-002", featureTitle: "주간 통계", then: "합계가 보인다", status: "broken", note: "GET https://api.example.com/stats (net::ERR_FAILED)" },
  { acceptanceId: "AC-003", featureTitle: "공유", then: "링크가 복사된다", status: "not_confirmed", note: "no_primary_action" },
  { acceptanceId: "AC-004", featureTitle: "알림", then: "알림이 온다", status: "not_run", note: "budget" },
];

describe("acceptanceResults → findings", () => {
  it("broken은 high, not_confirmed는 medium, 나머지는 finding 아님", () => {
    const f = classifyFindings({ ...base, acceptanceResults: results }, "ko");
    const broken = f.find((x) => x.what.includes("주간 통계"));
    const nc = f.find((x) => x.what.includes("공유"));
    assert.ok(broken && broken.severity === "high", JSON.stringify(f));
    assert.ok(broken.what.includes("작동하지 않았어요") && broken.why.includes("합계가 보인다"));
    assert.equal(broken.evidence, "GET https://api.example.com/stats (net::ERR_FAILED)");
    assert.ok(nc && nc.severity === "medium");
    assert.ok(nc.why.includes("고장이라는 뜻은 아니에요"));
    assert.ok(!f.some((x) => x.what.includes("산책 기록")) && !f.some((x) => x.what.includes("알림")));
  });

  it("EN도 같은 구조·같은 개수", () => {
    const ko = classifyFindings({ ...base, acceptanceResults: results }, "ko");
    const en = classifyFindings({ ...base, acceptanceResults: results }, "en");
    assert.equal(ko.length, en.length);
    assert.ok(en.some((x) => x.what.includes("did not work as the spec describes")));
    assert.ok(en.some((x) => x.what.includes("could not be fully confirmed")));
  });
});

describe("buildNonDevReport.acceptance", () => {
  it("요약 개수 + 첫 노트 한 줄, 점수 없음", () => {
    const r = buildNonDevReport({ ...base, acceptanceResults: results }, "ko");
    assert.deepEqual({ ...r.acceptance, items: undefined }, { total: 4, noProblem: 1, notConfirmed: 1, broken: 1, notRun: 1, items: undefined });
    assert.equal(r.acceptance.items.length, 4);
    assert.equal(r.notes[0], "지시서의 확인 항목 4개 중 문제 없음 1 · 확인 못 함 1 · 작동 안 함 1 · 시간 부족으로 못 본 것 1.");
    assert.ok(!/\/100|score|점수/.test(JSON.stringify(r)));
    const en = buildNonDevReport({ ...base, acceptanceResults: results }, "en");
    assert.equal(en.notes[0], "Of 4 spec items: 1 no problem · 1 not confirmed · 1 not working · 1 not reached in time.");
  });

  it("not_run이 0이면 그 조각을 붙이지 않는다", () => {
    const r = buildNonDevReport({ ...base, acceptanceResults: results.slice(0, 3) }, "ko");
    assert.equal(r.notes[0], "지시서의 확인 항목 3개 중 문제 없음 1 · 확인 못 함 1 · 작동 안 함 1.");
  });

  it("결과가 없으면 종전 리포트 그대로(acceptance 필드 없음, notes 그대로)", () => {
    const before = buildNonDevReport(base, "ko");
    assert.equal("acceptance" in before, false);
    assert.equal(before.notes.length, 3);
    const empty = buildNonDevReport({ ...base, acceptanceResults: [] }, "ko");
    assert.deepEqual(empty, before);
  });
});
