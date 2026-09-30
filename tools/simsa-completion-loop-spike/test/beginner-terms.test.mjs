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

  it("catches a Latin term followed by a Korean particle (PR이 · PR로 · repo를) — #558 검증 P2-9", () => {
    assert.deepEqual(devTermHits("고친 코드가 담긴 PR이 준비됐어요").map((h) => h.term), ["PR"]);
    assert.deepEqual(devTermHits("그 변경을 PR로 올렸어요").map((h) => h.term), ["PR"]);
    assert.deepEqual(devTermHits("repo를 연결하세요 · diff가 커요").map((h) => h.term), ["repo", "diff"]);
    // Still no look-alikes: PRD with a particle, a Hangul-prefixed token.
    assert.deepEqual(devTermHits("PRD를 붙여넣으세요 · 새PR"), []);
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
    // B-8: 아이디어 문 → 지시서 → 만들기 → 진행 화면은 기본 흐름(S, 계정 0) — 개발 용어·계정 버튼은 P0.
    assert.equal(isDefaultFlowJourney("J6 만들기: 아이디어 → 지시서 → 만들기 → 진행 화면"), true);
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
