import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P1 non-developer language (2026-07-17). Live measurement found openQuestions
// naming developer tools in 3/6 drafts (Firebase/AWS/Chart.js/API) — decisions
// the target user cannot make. Fix = prompt rule + deterministic category
// rewrite at the single draft choke point. HANDOFF-2026-07-17 § 남은 것.

const { sanitizeOpenQuestions, filterQuestionsForNonDev, applySoloSpecGuard, buildPrompt, generateIdeaToSpecDraft } =
  await import("../dist/workspace/generate.js");

describe("sanitizeOpenQuestions — deterministic category rewrite", () => {
  it("rewrites the live-measured leaks into plain decisions (ko)", () => {
    const out = sanitizeOpenQuestions(
      [
        "Firebase와 AWS 중 어떤 것을 쓸지 결정",
        "Chart.js로 차트를 그릴지 결정",
        "외부 API 연동 범위 확정",
        "STT 서비스 선택",
      ],
      "ko",
      "동네 미용실 예약 웹앱",
    );
    for (const q of out) {
      assert.doesNotMatch(q, /firebase|aws|chart\.js|\bapi\b|\bstt\b/i, q);
    }
    assert.ok(out.includes("자료를 어디에 어떻게 보관할지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("차트·그래프를 어떤 모습으로 보여줄지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("외부 서비스와 무엇을 주고받을지 정하기"), JSON.stringify(out));
    assert.ok(out.includes("음성 인식을 어느 수준까지 지원할지 정하기"), JSON.stringify(out));
  });

  it("rewrites in English for locale=en", () => {
    const out = sanitizeOpenQuestions(
      ["Choose between Firebase and AWS", "Pick an OAuth provider"],
      "en",
      "a budget web app",
    );
    assert.deepEqual(out, [
      "Decide where and how your data is kept",
      "Decide how sign-in works",
    ]);
  });

  it("dedupes questions that collapse onto the same plain decision", () => {
    const out = sanitizeOpenQuestions(
      ["Firebase 요금제 확인", "PostgreSQL 스키마 설계", "결과 화면 구성 정하기"],
      "ko",
      "가계부 웹앱",
    );
    assert.deepEqual(out, ["자료를 어디에 어떻게 보관할지 정하기", "결과 화면 구성 정하기"]);
  });

  it("keeps jargon-free questions untouched", () => {
    const qs = ["파일 크기 상한선 (예: 500MB)", "구체적인 기능 범위 정하기"];
    assert.deepEqual(sanitizeOpenQuestions(qs, "ko", "메모 웹앱"), qs);
  });

  it("a term the user typed themselves is exempt — their words, not a leak", () => {
    const out = sanitizeOpenQuestions(
      ["Firebase 무료 요금제로 충분한지 확인", "AWS 요금 확인"],
      "ko",
      "Firebase에 데이터를 저장하는 재고 관리 웹앱",
    );
    // Firebase kept (user said it); AWS still rewritten.
    assert.equal(out[0], "Firebase 무료 요금제로 충분한지 확인");
    assert.equal(out[1], "자료를 어디에 어떻게 보관할지 정하기");
  });

  it("does not false-positive on ordinary words (rest, library app in user words)", () => {
    const out = sanitizeOpenQuestions(
      ["도서관 좌석 예약 규칙 정하기", "Decide the rest of the features later"],
      "ko",
      "도서관 좌석 예약 웹앱",
    );
    assert.deepEqual(out, ["도서관 좌석 예약 규칙 정하기", "Decide the rest of the features later"]);
  });
});

// D13 (P2, 2026-07-17 target-fit eval): the pilates case asked "모바일 앱으로도
// 만들지"(the coding AI can't build one) and "데이터를 어디에 저장할지"(not the
// user's decision). Prompt rule + this deterministic filter.
describe("filterQuestionsForNonDev — un-decidable questions are dropped", () => {
  const q = (question) => ({ question });
  const FILLER = [q("핵심 화면에 무엇이 먼저 보여야 하나요?"), q("주로 휴대폰에서 쓰나요?"), q("성공 기준은 무엇인가요?")];

  it("drops a native-app option question for a web idea", () => {
    const out = filterQuestionsForNonDev(
      [q("회원 조회 화면을 모바일 앱(iOS/Android)으로도 만들까요?"), ...FILLER],
      "필라테스 수강권 관리 웹앱",
    );
    assert.equal(out.length, 3);
    assert.ok(!out.some((x) => /모바일 앱/.test(x.question)));
  });

  it("keeps it when the user themselves asked for android", () => {
    const out = filterQuestionsForNonDev(
      [q("안드로이드 지원이 필요한가요?"), ...FILLER],
      "안드로이드에서도 쓰고 싶은 기록 앱",
    );
    assert.equal(out.length, 4);
  });

  it("drops a storage-location question and a tool-name question", () => {
    const out = filterQuestionsForNonDev(
      [q("데이터는 어디에 저장하고 싶으신가요?"), q("Firebase 요금제를 확인하셨나요?"), ...FILLER],
      "가계부 웹앱",
    );
    assert.equal(out.length, 3);
  });

  it("never drops below 3 questions", () => {
    const bad = [q("어디에 저장할까요?"), q("Firebase를 쓸까요?"), q("모바일 앱으로 만들까요?"), q("AWS 리전은요?")];
    const out = filterQuestionsForNonDev(bad, "메모 웹앱");
    assert.equal(out.length, 3);
  });

  it("keeps ordinary decidable questions untouched (retention ≠ storage location)", () => {
    const qs = [q("녹음 원본은 저장해야 하나요, 요약 후 삭제해야 하나요?"), ...FILLER];
    assert.equal(filterQuestionsForNonDev(qs, "회의 요약 웹앱").length, 4);
  });

  it("the new D17 axes (publishing/plan/scale, Bae 2026-07-17) pass the filter", () => {
    const qs = [
      q("만든 앱을 누가 어디서 쓰게 할까요 — 나만 링크로, 아니면 누구나 검색해서?"),
      q("무료 범위로 시작할까요, 월 몇천 원 정도의 유료 서비스를 쓸 의향이 있나요?"),
      q("예상 회원 수는 어느 정도인가요 — 30명 정도, 아니면 3,000명 이상?"),
      q("자기 주소(도메인)가 필요한가요?"),
    ];
    assert.equal(filterQuestionsForNonDev(qs, "필라테스 수강권 웹앱").length, 4);
  });
});

describe("the prompt forbids native-app options and tech decisions in questions (ko + en)", () => {
  it("ko + en prompts carry the D13 rule", () => {
    assert.match(buildPrompt({ idea: "가계부 웹앱", locale: "ko" }), /네이티브 앱 선택지를 제시하지 마라/);
    assert.match(buildPrompt({ idea: "a budget web app", locale: "en" }), /Never offer a native mobile app/);
  });
});

describe("the prompt forbids tool names in openQuestions (ko + en)", () => {
  it("ko prompt carries the rule and the schema hint", () => {
    const ko = buildPrompt({ idea: "가계부 웹앱", locale: "ko" });
    assert.match(ko, /openQuestions·decisions에도 개발 도구·서비스 이름/);
    assert.match(ko, /도구 이름 없이 일반인 언어로/);
  });
  it("en prompt carries the rule and the schema hint", () => {
    const en = buildPrompt({ idea: "a budget web app", locale: "en" });
    assert.match(en, /Do NOT name developer tools or services/);
    assert.match(en, /plain language, no tool names/);
  });
});

// D15 (2026-07-17): the 7/16 assessment found a solo app's SPEC BODY still
// carrying 회원가입/로그인 (the solo guard only cleaned questions). Prompt rule
// + deterministic strip; an explicit user ask for a login/lock is the veto,
// but a NEGATED mention ("로그인 필요 없어요") is not an ask.
describe("applySoloSpecGuard — solo spec ships auth-free", () => {
  const draft = () => ({
    productSpec: {
      included: ["산책 기록", "회원가입/로그인", "사료 기록"],
      userFlow: ["1. 로그인", "2. 기록 입력", "3. 확인"],
    },
    items: [
      { title: "회원가입과 로그인이 되어야 함" },
      { title: "산책을 기록할 수 있어야 함" },
      { title: "사료 급여를 기록할 수 있어야 함" },
      { title: "병원 방문을 기록할 수 있어야 함" },
    ],
  });

  it("strips login/account artifacts from included, userFlow, items", () => {
    const out = applySoloSpecGuard(draft(), "나 혼자 쓰는 반려견 기록 앱. 로그인 필요 없어요.");
    assert.deepEqual(out.productSpec.included, ["산책 기록", "사료 기록"]);
    assert.equal(out.productSpec.userFlow.some((f) => /로그인/.test(f)), false);
    assert.equal(out.items.length, 3);
    assert.equal(out.items.some((i) => /로그인/.test(i.title)), false);
  });

  it("an explicit ask for a login keeps it (veto)", () => {
    const out = applySoloSpecGuard(draft(), "혼자 쓰지만 비밀번호 잠금은 있으면 좋겠어요");
    assert.equal(out.items.length, 4);
  });

  it("never drops items below 3", () => {
    const thin = { productSpec: { included: [], userFlow: [] }, items: [
      { title: "로그인" }, { title: "계정 만들기" }, { title: "산책 기록" },
    ] };
    assert.equal(applySoloSpecGuard(thin, "혼자 쓰는 앱").items.length, 3);
  });

  it("rides the real draft path: a solo mock draft has no auth items", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "나 혼자 쓰는 반려견 산책 기록 웹앱. 로그인 필요 없어요.", locale: "ko" },
      undefined,
    );
    const all = [
      ...res.productSpec.included,
      ...res.productSpec.userFlow,
      ...res.items.map((i) => i.title),
    ].join(" ");
    assert.doesNotMatch(all, /로그인|회원\s*가입/);
  });
});

describe("the choke point sanitizes real drafts (mock path)", () => {
  it("meeting mock's 'STT 서비스 선택' never reaches the user", async () => {
    const res = await generateIdeaToSpecDraft(
      { idea: "회의 녹음을 요약해서 할 일을 뽑아주는 앱", locale: "ko" },
      undefined,
    );
    assert.equal(res.source, "mock-fallback");
    for (const q of res.productSpec.openQuestions) {
      assert.doesNotMatch(q, /\bstt\b|firebase|aws|\bapi\b/i, q);
    }
    assert.ok(
      res.productSpec.openQuestions.includes("음성 인식을 어느 수준까지 지원할지 정하기"),
      JSON.stringify(res.productSpec.openQuestions),
    );
  });
});
