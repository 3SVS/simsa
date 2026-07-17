import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P0-A feasibility honesty (2026-07-17). A non-dev's coding agent builds WEB
// apps; when the idea needs a native mobile app / 3D game / desktop binary /
// hardware / extension, generating a confident web spec is the PISTA failure.
// Design: docs/simsa-accuracy-p0-2026-07-17.md.

const { detectNonWebBuildable, buildPrompt, feasibilityWarning, generateIdeaToSpecDraft } =
  await import("../dist/workspace/generate.js");

describe("detectNonWebBuildable — deterministic, kinded", () => {
  it("flags native mobile apps and 3D/engine games", () => {
    const cases = [
      ["아이폰용 3D 액션 게임, 실시간 멀티플레이", "game"],   // 3d wins (also mobile)
      ["안드로이드 네이티브 앱으로 만들고 싶어", "mobile"],
      ["앱스토어에 출시할 iOS 앱", "mobile"],
      ["유니티로 만드는 게임", "game"],
      ["윈도우 데스크톱 설치형 프로그램", "desktop"],
      ["아두이노로 센서를 읽는 펌웨어", "hardware"],
      ["크롬 확장 프로그램", "extension"],
    ];
    for (const [idea, kind] of cases) {
      const r = detectNonWebBuildable({ idea });
      assert.equal(r.hit, true, `should flag: ${idea}`);
      assert.equal(r.kind, kind, `${idea} → kind`);
    }
  });

  it("does NOT flag web-buildable ideas — an explicit web marker vetoes", () => {
    for (const idea of [
      "개인 가계부 웹앱",
      "미용실 예약 웹사이트",
      "브라우저에서 하는 간단한 퍼즐 게임",   // browser game = web
      "모바일에서도 잘 보이는 반응형 웹앱",     // 'mobile' word but it's a web app
      "고객 리뷰를 요약하는 웹 서비스",
    ]) {
      assert.equal(detectNonWebBuildable({ idea }).hit, false, `should NOT flag: ${idea}`);
    }
  });

  it("bare '게임' is not native — only 3D / engine signals count", () => {
    assert.equal(detectNonWebBuildable({ idea: "웹으로 하는 단어 맞추기 게임" }).hit, false);
    assert.equal(detectNonWebBuildable({ idea: "3D 게임" }).hit, true);
  });

  // #296 Phase 2 (2026-07-17): the interview's explicit platform answer
  // outranks text inference — the PISTA idea text carried no native marker.
  it("interview platform='mobile' → mobile verdict even with no native marker in the text", () => {
    const r = detectNonWebBuildable({ idea: "가계부 앱", platform: "mobile" });
    assert.equal(r.hit, true);
    assert.equal(r.kind, "mobile");
  });
  it("interview platform='mobile' keeps a more specific text kind (3D game)", () => {
    const r = detectNonWebBuildable({ idea: "유니티 3D 게임", platform: "mobile" });
    assert.equal(r.hit, true);
    assert.equal(r.kind, "game");
  });
  it("interview platform='web' vetoes native text markers", () => {
    assert.equal(detectNonWebBuildable({ idea: "아이폰 느낌의 앱", platform: "web" }).hit, false);
  });
  it("platform='unknown' falls through to text detection", () => {
    assert.equal(detectNonWebBuildable({ idea: "가계부 웹앱", platform: "unknown" }).hit, false);
    assert.equal(detectNonWebBuildable({ idea: "안드로이드 네이티브 앱", platform: "unknown" }).hit, true);
  });
});

describe("feasibility guard is injected into the prompt only when non-web", () => {
  it("native idea → prompt forbids listing native features as done (ko + en)", () => {
    const ko = buildPrompt({ idea: "아이폰 3D 게임", locale: "ko" });
    assert.match(ko, /실현가능성 정직성/);
    assert.match(ko, /웹앱만|다 된다.*하지 마라|excluded에 넣/);
    const en = buildPrompt({ idea: "a native iPhone 3D game", locale: "en" });
    assert.match(en, /Feasibility honesty/i);
    assert.match(en, /web apps only|Do NOT list native features/i);
  });

  it("web idea → no feasibility guard", () => {
    assert.doesNotMatch(buildPrompt({ idea: "가계부 웹앱", locale: "ko" }), /실현가능성 정직성/);
    assert.doesNotMatch(buildPrompt({ idea: "a budget web app", locale: "en" }), /Feasibility honesty/i);
  });
});

describe("feasibilityWarning — the honest heads-up shown to the user", () => {
  it("names the kind and says the web part can be built but native needs specialists", () => {
    const ko = feasibilityWarning({ idea: "아이폰 네이티브 앱", locale: "ko" });
    assert.ok(ko && /전문 개발|웹으로 되는|정직/.test(ko), ko);
    const en = feasibilityWarning({ idea: "a native android app", locale: "en" });
    assert.ok(en && /specialist development/i.test(en), en);
  });
  it("is null for a web idea", () => {
    assert.equal(feasibilityWarning({ idea: "예약 웹앱", locale: "ko" }), null);
  });
});

describe("the warning actually rides on the generated draft (mock path)", () => {
  it("a mobile-game idea draft carries the feasibility warning first", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "아이폰 3D 멀티플레이 게임", locale: "ko" }, undefined);
    assert.equal(res.source, "mock-fallback");
    assert.ok((res.warnings ?? []).some((w) => /전문 개발|실현|웹으로 되는/.test(w)), JSON.stringify(res.warnings));
    // and it's first
    assert.match(res.warnings[0], /참고:|전문 개발|웹으로 되는/);
  });
  it("a plain web idea draft has NO feasibility warning", async () => {
    const res = await generateIdeaToSpecDraft({ idea: "동네 미용실 예약 웹앱", locale: "ko" }, undefined);
    assert.ok(!(res.warnings ?? []).some((w) => /전문 개발이 필요/.test(w)), JSON.stringify(res.warnings));
  });
});
