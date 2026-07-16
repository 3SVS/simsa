/**
 * visual-flow-plan.test.mjs — Stage 260A. Deterministic deep-flow planner. Imports dist.
 *
 * Verifies the planner drives a REAL journey (not just one CTA): it clicks a safe intent CTA when
 * present, otherwise TYPES a benign query into the primary search input, always ends by observing,
 * and never plans a forbidden/destructive action.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planVisualFlow, pickSafeCta, pickPrimaryInput } from "../dist/visual-flow-plan.js";

const intent = "골퍼가 코스가 지금 플레이 가능한지 확인하는 흐름을 시작할 수 있어야 한다";

test("pickSafeCta chooses the highest-priority safe intent CTA, skips forbidden", () => {
  const cta = pickSafeCta(
    [
      { text: "결제하기", selector: "b1" },
      { text: "코스 검색", selector: "b2" },
      { text: "시작하기", selector: "b3" },
    ],
    ["결제", "delete"],
  );
  assert.ok(cta);
  assert.ok(cta.text === "코스 검색" || cta.text === "시작하기"); // both match; forbidden 결제 excluded
});

test("plan clicks a safe CTA then observes", () => {
  const plan = planVisualFlow({ intentAnchor: intent, ctas: [{ text: "시작하기", selector: "#start" }], inputs: [] });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].action, "click");
  assert.equal(plan[0].selector, "#start");
  assert.equal(plan[1].action, "observe");
});

test("with NO CTA but a search input, plan TYPES a benign query then observes (the deep flow)", () => {
  const plan = planVisualFlow({
    intentAnchor: intent,
    ctas: [],
    inputs: [{ placeholder: "골프장 검색 (이름, 지역)", type: "text", selector: "#q" }],
  });
  assert.equal(plan.length, 2);
  assert.equal(plan[0].action, "type");
  assert.equal(plan[0].selector, "#q");
  assert.equal(plan[0].value, "서울"); // deterministic benign default
  assert.equal(plan[1].action, "observe");
});

test("custom sampleQuery is honored", () => {
  const plan = planVisualFlow({
    intentAnchor: intent,
    ctas: [],
    inputs: [{ placeholder: "검색", type: "search", selector: "#q" }],
    sampleQuery: "부산",
  });
  assert.equal(plan[0].value, "부산");
});

test("forbidden CTA is never planned; falls through to input", () => {
  const plan = planVisualFlow({
    intentAnchor: intent,
    ctas: [{ text: "계정 삭제", selector: "#del" }],
    inputs: [{ placeholder: "검색", type: "text", selector: "#q" }],
    forbidden: ["삭제"],
  });
  assert.equal(plan[0].action, "type"); // 삭제 CTA skipped
});

test("intent alignment: a 'check' intent prefers the search box over a non-search signup CTA", () => {
  // The golf-now case: intent is about checking playability; a "보험 가입하기" CTA exists AND a
  // "골프장 검색" input exists. The planner must TYPE into search, not click the signup CTA.
  const plan = planVisualFlow({
    intentAnchor: "코스가 지금 플레이 가능한지 확인하는 흐름을 시작할 수 있어야 한다",
    ctas: [{ text: "🛡️ 비 보험 가입하기 →", selector: "text=보험 가입하기" }],
    inputs: [{ placeholder: "골프장 검색 (이름, 지역)", type: "text", selector: "#q" }],
  });
  assert.equal(plan[0].action, "type");
  assert.equal(plan[0].selector, "#q");
});

test("intent alignment: a search-like CTA still wins even for a check intent", () => {
  const plan = planVisualFlow({
    intentAnchor: "코스 조건을 확인하는 흐름",
    ctas: [{ text: "코스 검색", selector: "text=코스 검색" }],
    inputs: [{ placeholder: "골프장 검색", type: "text", selector: "#q" }],
  });
  assert.equal(plan[0].action, "click"); // "코스 검색" is itself the intent action
  assert.equal(plan[0].targetText, "코스 검색");
});

test("no CTA and no input → single safe observe (nothing to drive)", () => {
  const plan = planVisualFlow({ intentAnchor: intent, ctas: [], inputs: [] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "observe");
});

test("pickPrimaryInput prefers a search-like input", () => {
  const i = pickPrimaryInput([
    { placeholder: "이메일", type: "email", selector: "#e" },
    { placeholder: "골프장 검색", type: "text", selector: "#s" },
  ]);
  assert.equal(i.selector, "#s");
});

// Step labels are Simsa's own prose and the report quotes them verbatim
// ("The '<label>' step didn't complete"), so a Korean label lands untranslated
// inside an English sentence. Live 2026-07-16: an EN report came back with
// "The '핵심 버튼 '...' 누르기' step didn't complete." — the report dictionary was
// complete; the planner was the leak.
const HANGUL = /[가-힣]/;

test("locale 'en' plans English step labels (report quotes these verbatim)", () => {
  const plan = planVisualFlow({
    intentAnchor: "a visitor should be able to start the main flow",
    ctas: [{ text: "Get started", selector: "text=Get started" }],
    inputs: [],
    locale: "en",
  });
  for (const s of plan) {
    assert.ok(!HANGUL.test(s.label), `EN plan leaked Korean: "${s.label}"`);
  }
  assert.ok(plan.some((s) => s.label.includes("Get started")), "should still quote the real CTA text");
});

test("locale 'en' types an English sample query — a Korean term finds nothing in an English app", () => {
  const plan = planVisualFlow({
    intentAnchor: "search for something",
    ctas: [],
    inputs: [{ placeholder: "Search", type: "search", selector: "#s" }],
    locale: "en",
  });
  const typed = plan.find((s) => s.action === "type");
  assert.ok(typed, "should plan a type step");
  assert.equal(typed.value, "Seoul");
  assert.ok(!HANGUL.test(typed.label));
});

test("an explicit sampleQuery still wins over the locale default", () => {
  const plan = planVisualFlow({
    intentAnchor: "search for something",
    ctas: [],
    inputs: [{ placeholder: "Search", type: "search", selector: "#s" }],
    locale: "en",
    sampleQuery: "Busan",
  });
  assert.equal(plan.find((s) => s.action === "type").value, "Busan");
});

test("the observe-only fallback is localized too", () => {
  const plan = planVisualFlow({ intentAnchor: "x", ctas: [], inputs: [], locale: "en" });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, "observe");
  assert.ok(!HANGUL.test(plan[0].label), `leaked: "${plan[0].label}"`);
});

test("locale defaults to ko, and an unknown locale falls back to ko (no silent English for KO users)", () => {
  for (const locale of [undefined, "fr", "", null, 42]) {
    const plan = planVisualFlow({
      intentAnchor: "골퍼가 확인",
      ctas: [{ text: "시작하기", selector: "text=시작하기" }],
      inputs: [],
      ...(locale === undefined ? {} : { locale }),
    });
    assert.ok(plan.some((s) => HANGUL.test(s.label)), `locale ${JSON.stringify(locale)} should stay Korean`);
  }
});
