/**
 * 2026-10-04 파일럿 사전 실측 — Simsa가 실제 앱 4개(+Gemini·Claude)에서 틀린 원인별 회귀 테스트.
 * 근거: docs/pilot-2026-10/simsa-accuracy-run-2026-10-04.md · 정답지 docs/pilot-2026-10/pilot-classes-answer-key.md
 *
 *   H1 404 미인식(v0 Vercel·Gemini Netlify) → "주소가 열리지 않아요", 안내 페이지를 누르지 않는다
 *   H2 입력 무관 고정 결과(ChatGPT 앱) → 껍데기
 *   H4 결과 언어 불일치(Lovable 중국어) → 사람 확인
 *   H5 같은 글자의 제목을 버튼 대신 누름 + API 키 요구(Claude 앱) → 진짜 버튼 · needs_user_credential
 *
 * 모든 단언은 고치기 전 코드에서 실패한다(4xx는 전부 Not Verified였고, 신호 함수·필드가 없었다).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const R = await import("../dist/nondev-report.js");
const { planVisualFlow, URL_SAMPLE_VALUE } = await import("../dist/visual-flow-plan.js");
const { clickControlByText } = await import("../inspector-container/click-target.mjs");

const base = {
  loadStatus: 200, networkFailures: [], interacted: true, routeAfterClick: null,
  primaryActionFound: true, visibleChangeAfterAction: true, consoleErrorCount: 0, persistedAfterReload: null,
};

describe("H1 — 앱이 없는 주소", () => {
  it("404·410은 Needs Fix(안 돼요), 401·403·407만 로그인 벽으로 보류", () => {
    for (const s of [404, 410, 400]) assert.equal(R.decideFromEvidence({ ...base, interacted: false, loadStatus: s }, []), "Needs Fix", String(s));
    for (const s of [401, 403, 407]) assert.equal(R.decideFromEvidence({ ...base, interacted: false, loadStatus: s }, []), "Not Verified", String(s));
    assert.equal(R.decisionToWorks("Needs Fix"), false);
  });

  it("200이어도 호스트의 '배포 없음' 페이지면 Needs Fix", () => {
    assert.equal(R.decideFromEvidence({ ...base, interacted: false, pageNotFound: true }, []), "Needs Fix");
  });

  it("v0(Vercel)·Gemini(Netlify)의 실제 안내 문구를 알아본다 — 긴 진짜 앱 화면은 아니다", () => {
    const vercel = "This page doesn’t exist It may have been moved, removed, or never existed. 404 DEPLOYMENT_NOT_FOUND icn1::h42tp-1791124002202-00b18619ea37 VIEW DOCUMENTATION COPY DEBUG PROMPT";
    const netlify = "Page not found Looks like you've followed a broken link or entered a URL that doesn't exist on this site. ← Back to our site If this is your site, and you weren't expecting a 404 for this path, please visit Netlify's \"page not found\" support guide for troubleshooting tips.";
    assert.equal(R.looksLikeHostNotFoundPage(vercel), true);
    assert.equal(R.looksLikeHostNotFoundPage(netlify), true);
    const realApp = "주소 점검기 · 배포 상태와 응답 코드를 한눈에 ".repeat(60) + " 도움말: DEPLOYMENT_NOT_FOUND 오류가 나면 다시 배포하세요";
    assert.ok(realApp.length > 1200);
    assert.equal(R.looksLikeHostNotFoundPage(realApp), false, "긴 페이지(진짜 앱)가 문구를 언급하는 것은 아니다");
    assert.equal(R.looksLikeHostNotFoundPage("오늘 할 일 ✅ 추가"), false);
  });

  it("리포트: page_not_found 하나로 말한다 — '무엇을 눌러야 할지 못 찾음'·콘솔 오류로 흐리지 않는다", () => {
    const rep = R.buildNonDevReport({
      targetUrl: "https://verifiy-sigma.vercel.app", intentAnchor: "", loadStatus: 404, primaryActionFound: false,
      interacted: false, routeAfterClick: null, routeChanged: false,
      consoleErrors: ["Failed to load resource: the server responded with a status of 404 ()"], networkFailures: [],
      decision: R.decideFromEvidence({ ...base, interacted: false, primaryActionFound: false, loadStatus: 404 }, []), steps: [],
    }, "ko");
    const codes = rep.findings.map((f) => f.code);
    assert.deepEqual(codes, ["page_not_found"]);
    assert.match(rep.findings[0].what, /주소가 열리지 않아요\(HTTP 404\)/);
    assert.equal(rep.works, false);
  });
});

describe("H2 — 입력 무관 고정 결과(껍데기)", () => {
  const before = "✓ 작동해? AI 서비스 검증 AI로 만든 서비스, 진짜 작동하나요? 서비스 주소 서비스 설명 (선택) 내 서비스 검사하기 →";
  const canned = (u) => `${before} ✓ 검사 완료 · 서비스 건강도 78/100 ${u} · 주요 사용자 흐름을 기준으로 검사했습니다. 사용할 수 있지만 수정이 필요한 부분이 있습니다. 2개의 문제를 발견했습니다. × 기능 오류 로그인 기능이 작동하지 않습니다 △ UI 문제 모바일 화면에서 버튼이 잘립니다`;

  it("ChatGPT 앱 모양: 두 입력에 같은 결과 + 요청 0 → 껍데기", () => {
    const a1 = R.addedTokens(before, canned("https://example.com/"), "https://example.com/");
    const a2 = R.addedTokens(before, canned("https://example.org/"), "https://example.org/");
    assert.ok(a1.size >= R.CANNED_MIN_TOKENS);
    assert.equal(R.isCannedResult({ added1: a1, added2: a2, requests1: 0, requests2: 0 }), true);
    assert.equal(R.decideFromEvidence({ ...base, cannedResult: true }, [{ ok: true }]), "Needs Fix");
  });

  it("처리 요청이 하나라도 있으면 판단하지 않는다(Bolt·F11은 이 이유로 못 잡는다 — 알려진 한계)", () => {
    const a1 = R.addedTokens(before, canned("https://example.com/"), "https://example.com/");
    assert.equal(R.isCannedResult({ added1: a1, added2: a1, requests1: 1, requests2: 1 }), false);
  });

  it("진짜 점검기(F12): 결과가 입력마다 다르면 껍데기가 아니다", () => {
    const b = "🔎 주소 점검기 앱 주소를 넣으면 실제로 열어 보고 응답 상태를 알려드려요. 앱 주소 점검하기";
    const r1 = `${b} 점검 결과 주소: example.com/ 응답 상태: 200 (열림) 응답 크기: 1256바이트 · 걸린 시간: 312ms`;
    const r2 = `${b} 점검 결과 주소: example.org/ 응답 상태: 200 (열림) 응답 크기: 1102바이트 · 걸린 시간: 845ms`;
    const a1 = R.addedTokens(b, r1, "https://example.com/");
    const a2 = R.addedTokens(b, r2, "https://example.org/");
    assert.equal(R.isCannedResult({ added1: a1, added2: a2, requests1: 0, requests2: 0 }), false);
  });

  it("할 일 앱처럼 한두 단어만 붙는 흐름은 껍데기로 보지 않는다", () => {
    const b = "✅ 오늘 할 일 할 일을 적고 추가 버튼을 누르세요 추가";
    const a1 = R.addedTokens(b, `${b} 📝 서울 삭제`, "서울");
    const a2 = R.addedTokens(b, `${b} 📝 부산 삭제`, "부산");
    assert.equal(R.isCannedResult({ added1: a1, added2: a2, requests1: 0, requests2: 0 }), false);
  });

  it("두 번째 값은 같은 종류로 다르게 — 주소·숫자·글", () => {
    assert.equal(R.variantTypedValue("https://example.com/"), "https://example.org/");
    assert.equal(R.variantTypedValue("5"), "12");
    assert.equal(R.variantTypedValue("서울"), "부산");
  });

  it("문구는 의도에 맞춘다(H3): 의도가 '검토'를 말하면 '실제로 검토하지 않고'", () => {
    assert.equal(R.intentMentionsReview("만든 서비스가 실제로 작동하는지 검토와 정확한 진단"), true);
    const f = R.classifyFindings({ targetUrl: "x", intentAnchor: "", loadStatus: 200, primaryActionFound: true, interacted: true,
      routeAfterClick: null, routeChanged: false, consoleErrors: [], networkFailures: [], decision: "Needs Fix",
      cannedResult: { intentMentionsReview: true } }, "ko");
    assert.equal(f[0].code, "canned_result");
    assert.match(f[0].what, /실제로 검토하지 않고/);
  });
});

describe("H4 — 결과 언어", () => {
  const koUi = "진단사 AI 앱 건강검진 링크 한 줄만 던지면, 문제가 어디에 있는지 알려주고 고칠 코드까지 드려요. 사이트 주소 코드 업로드 진단 시작";
  it("Lovable 실제 출력(중국어)을 잡는다", () => {
    const zh = "客户メモ帳 页面能够打开，但客户备忘录的核心保存功能尚不具备可用条件。代码使用疑似占位的 Supabase 地址和密钥，而且即使保存成功也不会更新列表";
    const m = R.detectOutputLanguageMismatch(koUi, zh);
    assert.equal(m?.found, "중국어");
    assert.equal(R.decideFromEvidence({ ...base, outputLanguageMismatch: true }, [{ ok: true }]), "User Acceptance Required");
  });
  it("한국어 결과에 한자 몇 개·영어 화면은 아니다", () => {
    assert.equal(R.detectOutputLanguageMismatch(koUi, "점검 결과: 저장 기능(保存)이 정상이에요. 목록도 잘 보여요. 다음 단계로 가세요."), null);
    assert.equal(R.detectOutputLanguageMismatch("Todo app add items", "页面能够打开但是核心保存功能尚不具备可用条件代码使用疑似占位的地址"), null);
  });
});

describe("H5 — 같은 글자 제목 + API 키 요구(Claude 앱)", () => {
  it("API 키를 넣으라는 안내를 잡고, 설명 문구만으로는 잡지 않는다", () => {
    const g = R.detectCredentialGate("먼저 '연결 설정'에 Claude API 키를 넣어 주세요. 키 없이 화면만 보시려면 위의 '예시 결과 보기'를 눌러 주세요.");
    assert.ok(g);
    assert.match(g.sample, /API 키/);
    assert.equal(R.detectCredentialGate("파일을 브라우저에서 직접 열면 본인의 Claude API 키로 점검합니다. 키는 안에서만 쓰이고 저장되지 않으며, 새로고침하면 지워집니다."), null);
    assert.equal(R.decideFromEvidence({ ...base, needsUserCredential: true }, [{ ok: true }]), "User Acceptance Required");
  });

  it("리포트에 needs_user_credential — 비개발자 막힘을 말한다", () => {
    const f = R.classifyFindings({ targetUrl: "x", intentAnchor: "", loadStatus: 200, primaryActionFound: true, interacted: true,
      routeAfterClick: null, routeChanged: false, consoleErrors: [], networkFailures: [], decision: "User Acceptance Required",
      needsUserCredential: { sample: "Claude API 키를 넣어 주세요" } }, "ko");
    assert.equal(f[0].code, "needs_user_credential");
    assert.match(f[0].what, /직접 API 키를 넣어야/);
    for (const c of ["page_not_found", "canned_result", "output_language_mismatch", "needs_user_credential"]) assert.ok(R.FINDING_CODES.includes(c), c);
  });

  it("글자가 같은 제목과 버튼이 있으면 버튼을 누른다", async () => {
    const clicked = [];
    const loc = (name, visible) => ({
      count: async () => (visible === null ? 0 : 1),
      nth: () => ({ isVisible: async () => !!visible, click: async () => { clicked.push(name); } }),
      first() { return this.nth(0); },
    });
    const page = {
      getByRole: (role) => (role === "button" ? loc("button", true) : loc("link", null)),
      getByText: () => loc("heading", true),
    };
    assert.equal(await clickControlByText(page, "점검 시작"), "button");
    assert.deepEqual(clicked, ["button"]);
  });

  it("버튼·링크가 없으면 종전대로 글자로 누른다(기존 동작 보존)", async () => {
    const clicked = [];
    const none = { count: async () => 0, nth: () => ({ isVisible: async () => false }), first() { return this.nth(0); } };
    const page = { getByRole: () => none, getByText: () => ({ first: () => ({ click: async () => clicked.push("text") }) }) };
    assert.equal(await clickControlByText(page, "시작"), "text");
    assert.deepEqual(clicked, ["text"]);
  });
});

describe("러너 배선(소스 계약) — 옛 코드에서 실패", () => {
  const runner = readFileSync(new URL("../inspector-container/inspector-run.mjs", import.meta.url), "utf8");
  const signup = readFileSync(new URL("../inspector-container/signup-run.mjs", import.meta.url), "utf8");
  const dockerfile = readFileSync(new URL("../inspector-container/Dockerfile", import.meta.url), "utf8");
  it("어떤 클릭도 글자 먼저(getByText(...).first().click)로 하지 않는다 — clickControlByText", () => {
    for (const src of [runner, signup]) {
      assert.doesNotMatch(src, /getByText\([^)]*\{ exact: true \}\)\.first\(\)\.click/);
      assert.match(src, /clickControlByText\(page,/);
    }
    assert.match(dockerfile, /click-target\.mjs/, "이미지에 새 모듈을 넣는다");
  });
  it("앱이 없으면 아무것도 누르지 않고(break drive), 신호를 리포트로 넘긴다", () => {
    assert.match(runner, /if \(appMissing\) break drive;/);
    assert.match(runner, /isCannedResult\(\{ added1, added2, requests1, requests2 \}\)/);
    assert.match(runner, /needsUserCredential: pilotSignals\.needsUserCredential/);
  });
});

describe("planner — 주소 칸에는 실제 주소를 넣는다", () => {
  it("type=url 또는 https 예시 칸 → 공개 주소, 그 밖은 종전 '서울'", () => {
    const cta = [{ text: "내 서비스 검사하기 →", selector: "x" }];
    const p1 = planVisualFlow({ intentAnchor: "", ctas: cta, inputs: [{ type: "url", placeholder: "https://내서비스.com", selector: "u" }], locale: "ko" });
    assert.equal(p1.find((s) => s.action === "type").value, URL_SAMPLE_VALUE);
    const p2 = planVisualFlow({ intentAnchor: "", ctas: [{ text: "추가", selector: "a" }], inputs: [{ type: "text", placeholder: "예: 우유 사기", selector: "t" }], locale: "ko" });
    assert.equal(p2.find((s) => s.action === "type").value, "서울");
  });
});
