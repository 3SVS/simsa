import { describe, it } from "node:test";
import assert from "node:assert/strict";

// P1/P3 builder-pack portability (2026-07-17 target-fit eval, Bae 승인 P1~P3):
//  - D10 web_builder target — a self-contained prompt for chat-driven web
//    builders (Lovable/Replit/v0/Bolt): no file tree, no terminal, no git;
//    secrets via the builder's Secrets UI; deploy via its Publish button.
//  - D11 deploy-path flexibility — never mandate GitHub; offer the no-GitHub
//    drag-and-drop path and the "make a GitHub account first" path.
//  - D12 need-based service examples — walkthroughs match what the spec needs.
// Measured baseline: 10/10 packs were CLI-shaped and Vercel/Supabase-only.
// docs/simsa-target-fit-eval-2026-07-17.md

const { generateBuilderPack } = await import("../dist/workspace/export.js");

const SPEC = {
  productName: "출장 경비 정리 앱",
  oneLine: "영수증을 올리면 자동 분류하고 월별 리포트를 만듭니다",
  targetUsers: ["출장이 잦은 직장인"],
  problem: "영수증 정리에 시간이 많이 걸립니다.",
  included: ["영수증 사진 업로드", "자동 분류", "월별 리포트 이메일 발송"],
  excluded: ["법인카드 연동"],
  userFlow: ["사진 업로드", "분류 확인", "리포트 받기"],
  decisions: ["리포트는 월 1회"],
  openQuestions: ["보관 기간 정하기"],
};
const ITEMS = [
  { id: "req_001", title: "영수증 사진을 올릴 수 있어야 함", status: "not_started", criteria: ["JPG/PNG 지원"] },
  { id: "req_002", title: "월별 리포트가 이메일로 와야 함", status: "not_started", criteria: ["매월 1일 발송"] },
];
const SERVICES = [
  {
    id: "supabase", label: "Supabase", setupUrl: "https://supabase.com",
    envVars: [
      { key: "SUPABASE_URL", description: "프로젝트 주소" },
      { key: "SUPABASE_SERVICE_ROLE", description: "관리자 키", secret: true, value: "sk-REAL-SECRET" },
    ],
  },
];

const pack = (target, extra = {}) =>
  generateBuilderPack({ project: { title: SPEC.productName, productSpec: SPEC, items: ITEMS }, target, format: "json", locale: "ko", ...extra });

const fileOf = (res, suffix) => res.bundle.files.find((f) => f.path.endsWith(suffix));

describe("D10 — web_builder target", () => {
  it("emits WEB_BUILDER_PROMPT.md and neither CLI prompt", () => {
    const res = pack("web_builder");
    assert.ok(fileOf(res, "WEB_BUILDER_PROMPT.md"));
    assert.equal(fileOf(res, "CLAUDE_CODE_PROMPT.md"), undefined);
    assert.equal(fileOf(res, "CODEX_PROMPT.md"), undefined);
    assert.match(res.summary.recommendedNextStep, /WEB_BUILDER_PROMPT/);
    assert.match(fileOf(res, "README.md").content, /웹 빌더/);
  });

  it("'both' keeps its original meaning (two CLI prompts, no web-builder file)", () => {
    const res = pack("both");
    assert.ok(fileOf(res, "CLAUDE_CODE_PROMPT.md"));
    assert.ok(fileOf(res, "CODEX_PROMPT.md"));
    assert.equal(fileOf(res, "WEB_BUILDER_PROMPT.md"), undefined);
  });

  it("the prompt is SELF-CONTAINED — web builders cannot read the pack's other files", () => {
    const p = fileOf(pack("web_builder"), "WEB_BUILDER_PROMPT.md").content;
    assert.match(p, /출장 경비 정리 앱/);
    assert.match(p, /영수증 사진을 올릴 수 있어야 함/); // items inlined
    assert.match(p, /JPG\/PNG 지원/); // criteria inlined
    assert.match(p, /법인카드 연동/); // excluded inlined
    assert.doesNotMatch(p, /product\.md를 읽|items\.md에서/);
  });

  it("no CLI assumptions: no .env.local / 터미널 / git — Secrets UI + Publish instead", () => {
    const p = fileOf(pack("web_builder", { services: SERVICES }), "WEB_BUILDER_PROMPT.md").content;
    assert.doesNotMatch(p, /\.env\.local|터미널|git push|localhost|MCP/);
    assert.match(p, /Secrets/);
    assert.match(p, /게시\(Publish\/Deploy\)/);
  });

  it("services: env KEYS listed, real values never (no-store), Secrets UI instructed", () => {
    const p = fileOf(pack("web_builder", { services: SERVICES }), "WEB_BUILDER_PROMPT.md").content;
    assert.match(p, /SUPABASE_SERVICE_ROLE/);
    assert.doesNotMatch(p, /sk-REAL-SECRET/);
  });

  it("carries the regression hook back to Simsa when projectId+baseUrl present", () => {
    const res = pack("web_builder", { projectId: "proj_x1", appBaseUrl: "https://app.trysimsa.com" });
    assert.match(fileOf(res, "WEB_BUILDER_PROMPT.md").content, /\/p\/proj_x1\/connect/);
  });
});

// #296 Phase 4-lite (2026-07-17): the handoff deliverable — what a user gives a
// HUMAN (outside developer / native-app shop). Must state the platform verdict
// honestly (the PISTA failure was a web-assuming pack for a Kotlin app).
describe("handoff target — HANDOFF_BRIEF.md for humans", () => {
  it("emits HANDOFF_BRIEF.md and no agent prompt", () => {
    const res = pack("handoff");
    assert.ok(fileOf(res, "HANDOFF_BRIEF.md"));
    assert.equal(fileOf(res, "CLAUDE_CODE_PROMPT.md"), undefined);
    assert.equal(fileOf(res, "WEB_BUILDER_PROMPT.md"), undefined);
    assert.match(res.summary.recommendedNextStep, /HANDOFF_BRIEF/);
  });

  it("a web idea gets an honest 'web-buildable, stack is yours' verdict + the checklist", () => {
    const brief = fileOf(pack("handoff"), "HANDOFF_BRIEF.md").content;
    assert.match(brief, /웹앱.*구현 가능/);
    assert.match(brief, /수용 기준 체크리스트/);
    assert.match(brief, /JPG\/PNG 지원/); // criteria carried
    assert.match(brief, /법인카드 연동/); // excluded carried
  });

  it("a native idea gets the out-of-scope honesty section", () => {
    const res = generateBuilderPack({
      project: {
        title: "러닝 게임",
        idea: "아이폰에서 하는 3D 러닝 게임 앱",
        productSpec: { ...SPEC, productName: "러닝 게임", oneLine: "아이폰 3D 러닝 게임", included: ["3D 러닝 스테이지"] },
        items: ITEMS,
      },
      target: "handoff", format: "json", locale: "ko",
    });
    const brief = fileOf(res, "HANDOFF_BRIEF.md").content;
    assert.match(brief, /웹앱만으로는 완전히 구현할 수 없습니다/);
    assert.match(brief, /웹 검수 범위 밖/);
  });
});

describe("D11 — deploy path is a choice, never a GitHub mandate", () => {
  it("CLI prompts offer the no-GitHub drag-and-drop path AND the account-first path", () => {
    const p = fileOf(pack("claude_code"), "CLAUDE_CODE_PROMPT.md").content;
    assert.match(p, /GitHub을 강요하지 마라/);
    assert.match(p, /Netlify Drop/);
    assert.match(p, /New repository/); // 계정 생성 → 저장소 생성 단계
    assert.match(p, /서버 기능이 있는 앱.*(?:안 된다|권하라)/);
  });
});

describe("D12 — need-based service examples", () => {
  it("an email-sending spec gets the Resend walkthrough; uploads get Supabase Storage", () => {
    const p = fileOf(pack("claude_code"), "CLAUDE_CODE_PROMPT.md").content;
    assert.match(p, /Resend/);          // "월별 리포트 이메일 발송"
    assert.match(p, /Supabase Storage/); // "영수증 사진 업로드"
  });

  it("a spec without those needs gets neither, but always the base + deploy chooser", () => {
    const plain = {
      ...SPEC,
      included: ["할 일 추가", "할 일 완료 표시"],
      oneLine: "할 일을 적는 앱",
      problem: "할 일을 잊습니다.",
      userFlow: ["추가", "완료"],
    };
    const res = generateBuilderPack({
      project: {
        title: "할 일 앱",
        productSpec: plain,
        items: [{ id: "r1", title: "할 일을 추가할 수 있어야 함", status: "not_started", criteria: ["목록에 표시"] }],
      },
      target: "claude_code", format: "json", locale: "ko",
    });
    const p = fileOf(res, "CLAUDE_CODE_PROMPT.md").content;
    assert.doesNotMatch(p, /Resend|카카오맵|토스페이먼츠/);
    assert.match(p, /Supabase \(데이터베이스\)/);
    assert.match(p, /Netlify Drop/);
  });

  it("payment-flavored spec gets the test-key-only payment guidance", () => {
    const paySpec = { ...SPEC, included: ["구독료 결제", "결제 내역"] };
    const res = generateBuilderPack({
      project: { title: "구독 앱", productSpec: paySpec, items: ITEMS },
      target: "codex", format: "json", locale: "ko",
    });
    assert.match(fileOf(res, "CODEX_PROMPT.md").content, /테스트 키로만 구현/);
  });
});
