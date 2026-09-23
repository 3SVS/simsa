import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  devTermHits,
  accountCtaLabels,
  isDefaultFlowJourney,
  firstVisitLocaleMismatch,
  DEV_TERMS,
} from "../lib/beginner-terms.mjs";

describe("beginner-terms: developer vocabulary in the default flow (Train N6)", () => {
  it("finds terms and returns the surrounding text, one per distinct term", () => {
    const body = "몇 가지만 알려주세요 GitHub 써보셨어요? 있고 익숙해요 … 앱의 데이터는 어디에 저장되나요? Supabase Firebase 만든 도구 안에 있어요";
    const hits = devTermHits(body);
    assert.deepEqual(hits.map((h) => h.term), ["GitHub", "Supabase", "Firebase"]);
    assert.ok(hits[0].snippet.includes("GitHub 써보셨어요"));
  });

  it("does not fire on look-alikes (PRD, v0.13 in a version string, report, difference)", () => {
    assert.deepEqual(devTermHits("PRD를 붙여넣으세요. version v0.13.2 released. See the report for the difference."), []);
    assert.deepEqual(devTermHits("Open the PR · v0 · repo").map((h) => h.term), ["repo", "PR", "v0"].sort((a, b) => DEV_TERMS.indexOf(a) - DEV_TERMS.indexOf(b)));
  });

  it("caps the list and never returns bare counts", () => {
    const body = DEV_TERMS.join(" · ");
    const hits = devTermHits(body, { max: 3 });
    assert.equal(hits.length, 3);
    for (const h of hits) assert.ok(h.snippet.length > 0);
  });

  it("flags sign-in / connect buttons for external providers, deduplicated", () => {
    const labels = ["새 프로젝트", "GitHub에서 별 주기", "Continue with Google", "GitHub에서 별 주기", "저장하고 시작하기"];
    assert.deepEqual(accountCtaLabels(labels), ["GitHub에서 별 주기", "Continue with Google"]);
    assert.deepEqual(accountCtaLabels(["만들기", "다음 →"]), []);
    // The user's own app address is not an account CTA even if it lives on vercel.app.
    assert.deepEqual(accountCtaLabels(["https://simsa-autofix-test.vercel.app/", "my-shop.vercel.app"]), []);
  });

  it("applies P0 only to idea / plan / first-visit journeys", () => {
    assert.equal(isDefaultFlowJourney("J0 아이디어 갈래 입구: 첫 화면 → 스텝1 → 인터뷰 진입"), true);
    assert.equal(isDefaultFlowJourney("J2 기획서 갈래: 붙여넣기→변환→다음 행동"), true);
    assert.equal(isDefaultFlowJourney("J7 첫 방문 locale"), true);
    assert.equal(isDefaultFlowJourney("J1 기존-앱 갈래: 주소 하나로 검수까지 완주 (AF 트레인)"), false);
    assert.equal(isDefaultFlowJourney("J3 repo 연결 여정: GitHub 미연결 신규 유저"), false);
  });

  it("first-visit locale: ko-KR must see Korean, en-US must not", () => {
    assert.equal(firstVisitLocaleMismatch("ko-KR", ["무엇부터 시작할까요?"]).mismatch, false);
    assert.equal(firstVisitLocaleMismatch("ko-KR", ["Where do you want to start?"]).mismatch, true);
    assert.equal(firstVisitLocaleMismatch("en-US", ["Where do you want to start?"]).mismatch, false);
    assert.equal(firstVisitLocaleMismatch("en-US", ["무엇부터 시작할까요?"]).mismatch, true);
    assert.equal(firstVisitLocaleMismatch("ko-KR", []).mismatch, true);
  });
});
