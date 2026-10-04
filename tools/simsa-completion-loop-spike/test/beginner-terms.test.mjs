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

  it("applies P0 to idea / plan / first-visit journeys", () => {
    assert.equal(isDefaultFlowJourney("J0 아이디어 갈래 입구: 첫 화면 → 스텝1 → 인터뷰 진입"), true);
    assert.equal(isDefaultFlowJourney("J2 기획서 갈래: 붙여넣기→변환→다음 행동"), true);
    assert.equal(isDefaultFlowJourney("J7 첫 방문 locale"), true);
  });

  // ★C-J1 (재정렬 §1 끊김 #13 · D-17 amend 2026-09-27): 문 (b)(c) = 기존 앱 여정 J1도
  // 기본 흐름이다. 종전엔 J1이 P2로만 남아 "만든 앱이 안 돼요" 문의 위반이 감사에
  // 안 보였다. 빌드 여정 J6(문 a의 인도 경로, B-8)도 기본 흐름으로 미리 등록한다.
  it("C-J1: the existing-app journeys (J1, J1b) and the build journey (J6) are default flow now", () => {
    assert.equal(isDefaultFlowJourney("J1 기존-앱 갈래: 주소 하나로 검수까지 완주 (AF 트레인)"), true);
    assert.equal(isDefaultFlowJourney("J1b 저장소만 연결: 막다른 골목이 없는가 (need_url)"), true);
    assert.equal(isDefaultFlowJourney("J6 빌드 여정: 만들기 → 잡 진행 → 내 앱 카드"), true);
  });

  // 문자 접미사(J1b·J2e)는 같은 여정의 변형이다. 종전 정규식(`^J2\b`)은 "J2e"에서
  // 단어 경계를 못 찾아 EN 기획서 입구를 기본 흐름에서 조용히 뺐다.
  it("C-J1: a letter-suffixed variant (J2e = EN plan entry) inherits its journey's severity", () => {
    assert.equal(isDefaultFlowJourney("J2e 기획서 갈래 입구(EN)"), true);
  });

  it("C-J1: developer / seeded journeys stay informational, and J10 is not J1", () => {
    assert.equal(isDefaultFlowJourney("J3 repo 연결 여정: GitHub 미연결 신규 유저"), false);
    assert.equal(isDefaultFlowJourney("J5 시드 세션: 런 상세 → 왜 이 판정 → 증거 로드"), false);
    assert.equal(isDefaultFlowJourney("J10 미래 여정"), false);
    assert.equal(isDefaultFlowJourney(""), false);
    assert.equal(isDefaultFlowJourney(undefined), false);
  });

  it("first-visit locale: ko-KR must see Korean, en-US must not", () => {
    assert.equal(firstVisitLocaleMismatch("ko-KR", ["무엇부터 시작할까요?"]).mismatch, false);
    assert.equal(firstVisitLocaleMismatch("ko-KR", ["Where do you want to start?"]).mismatch, true);
    assert.equal(firstVisitLocaleMismatch("en-US", ["Where do you want to start?"]).mismatch, false);
    assert.equal(firstVisitLocaleMismatch("en-US", ["무엇부터 시작할까요?"]).mismatch, true);
    assert.equal(firstVisitLocaleMismatch("ko-KR", []).mismatch, true);
  });
});

// ── C-J1: 초보자 판정의 심각도 규칙 자체를 순수 함수로 (종전: journey-audit.mjs 인라인) ──
// 규칙이 스크립트 안에 있으면 브라우저 없이 시험할 수 없다 — 그래서 J1이 P2로만
// 남던 것도 아무 테스트에 걸리지 않았다.
// Namespace import: on the pre-C-J1 lib the export is simply missing, so each
// test below fails on its own (TypeError) instead of the whole file failing to load.
const mod = await import("../lib/beginner-terms.mjs");

describe("beginnerFindings: severity per journey (C-J1)", () => {
  const J1 = "J1 기존-앱 갈래: 주소 하나로 검수까지 완주 (AF 트레인)";

  it("J1: a developer term other than GitHub is P0, with the text it was found in", () => {
    const out = mod.beginnerFindings({
      journeyName: J1,
      devTerms: [{ term: "PR", snippet: "고친 코드가 담긴 PR이 준비됐어요", where: "본문" }],
      accountCtas: [],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].sev, "P0");
    assert.match(out[0].what, /PR이 준비됐어요/, "the finding carries the matched text, not just a count");
  });

  it("J1: GitHub is the existing-app door's allowed optional step (D-17 amend) — P2, never dropped", () => {
    const out = mod.beginnerFindings({
      journeyName: J1,
      devTerms: [
        { term: "GitHub", snippet: "앱 주소 또는 GitHub 저장소", where: "본문" },
        { term: "Vercel", snippet: "Vercel에 배포하세요", where: "본문" },
      ],
      accountCtas: ["GitHub 연결하기", "Continue with Google"],
    });
    const p0 = out.filter((f) => f.sev === "P0").map((f) => f.what).join(" | ");
    const p2 = out.filter((f) => f.sev === "P2").map((f) => f.what).join(" | ");
    assert.match(p0, /Vercel/);
    assert.match(p0, /Continue with Google/);
    assert.doesNotMatch(p0, /GitHub/, "GitHub must not be P0 in the existing-app door");
    assert.match(p2, /GitHub 저장소/, "the allowed hit is still recorded (signal kept, severity lowered)");
    assert.match(p2, /GitHub 연결하기/);
  });

  it("J0 / J6: GitHub is NOT allowed outside the existing-app door", () => {
    for (const name of ["J0 아이디어 갈래 입구", "J6 빌드 여정: 만들기"]) {
      const out = mod.beginnerFindings({
        journeyName: name,
        devTerms: [{ term: "GitHub", snippet: "GitHub 써보셨어요?", where: "본문" }],
        accountCtas: ["GitHub로 로그인"],
      });
      assert.deepEqual(out.map((f) => f.sev), ["P0", "P0"], name);
    }
  });

  it("J3 / J5 (developer & seeded screens): same hits stay P2, legacy wording kept", () => {
    const out = mod.beginnerFindings({
      journeyName: "J3 repo 연결 여정: GitHub 미연결 신규 유저",
      devTerms: [{ term: "repo", snippet: "repo를 연결하세요", where: "셸" }],
      accountCtas: ["GitHub 연결하기"],
    });
    assert.deepEqual(out.map((f) => f.sev), ["P2", "P2"]);
    assert.match(out[0].what, /^개발 용어 노출 1건\(본문 0\) — \[셸\] repo: "repo를 연결하세요"$/);
    assert.match(out[1].what, /^외부 계정 CTA 1개 — GitHub 연결하기$/);
  });

  it("nothing found → no findings", () => {
    assert.deepEqual(mod.beginnerFindings({ journeyName: J1, devTerms: [], accountCtas: [] }), []);
    assert.deepEqual(mod.beginnerFindings({ journeyName: J1 }), []);
  });
});
