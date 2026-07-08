/**
 * workspace-pr-fix-brief.test.mjs
 *
 * Tests for the deterministic PR Fix Pack generator (pr-fix-brief.ts).
 * Uses node --test only. No network calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { generatePRFixBrief } = await import("../dist/workspace/pr-fix-brief.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PR_META = {
  number: 42,
  title: "feat: add auth module",
  headBranch: "feat/auth",
  baseBranch: "main",
  author: "tester",
  createdAt: "2026-06-12T00:00:00Z",
};

const MOCK_SPEC = {
  productName: "MyApp",
  oneLine: "간단한 메모 앱",
  included: ["회원가입", "로그인"],
  excluded: ["소셜 로그인"],
  openQuestions: ["세션 만료 정책 미결"],
};

const MOCK_ITEMS = [
  { id: "item-1", title: "로그인 기능", status: "failed", criteria: ["JWT 발급 확인", "에러 메시지 표시"] },
  { id: "item-2", title: "알림 설정", status: "inconclusive", criteria: [] },
  { id: "item-3", title: "결제 흐름", status: "needs_decision", criteria: [] },
  { id: "item-4", title: "대시보드", status: "passed", criteria: [] },
];

const MOCK_REVIEW_RESULTS = [
  {
    itemId: "item-1", title: "로그인 기능", status: "failed",
    userLabel: "안 맞음", reason: "JWT 토큰 발급 로직 없음",
    evidence: ["src/auth/login.ts"], nextAction: "JWT 발급 코드 추가",
  },
  {
    itemId: "item-2", title: "알림 설정", status: "inconclusive",
    userLabel: "확인 부족", reason: "구현 여부 불명확",
    evidence: [], nextAction: "알림 서비스 파일 확인",
  },
  {
    itemId: "item-3", title: "결제 흐름", status: "needs_decision",
    userLabel: "결정 필요", reason: "결제 게이트웨이 미결정",
    evidence: [], nextAction: "결제 게이트웨이 결정 후 진행",
  },
  {
    itemId: "item-4", title: "대시보드", status: "passed",
    userLabel: "통과", reason: "대시보드 구현 확인됨",
    evidence: ["src/dashboard/index.ts"], nextAction: "",
  },
];

function buildReq(overrides = {}) {
  return {
    projectId: "proj-test",
    productSpec: MOCK_SPEC,
    allItems: MOCK_ITEMS,
    selectedItemIds: ["item-1", "item-2", "item-3"],
    reviewResults: MOCK_REVIEW_RESULTS,
    prMeta: MOCK_PR_META,
    repoFullName: "myorg/myapp",
    runId: "wprr_test01",
    target: "both",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generatePRFixBrief — basic shape", () => {
  it("returns ok:true with deterministic source", () => {
    const res = generatePRFixBrief(buildReq());
    assert.equal(res.ok, true);
    assert.equal(res.source, "deterministic");
    assert.equal(res.projectId, "proj-test");
    assert.equal(res.prNumber, 42);
    assert.equal(res.repoFullName, "myorg/myapp");
    assert.equal(res.runId, "wprr_test01");
  });

  it("returns 7 files for target=both (README + product + items + pr-review-results + fix-brief + CLAUDE_CODE + CODEX)", () => {
    const res = generatePRFixBrief(buildReq({ target: "both" }));
    assert.ok(res.ok);
    assert.equal(res.brief.files.length, 7);
    const paths = res.brief.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.includes("README.md")));
    assert.ok(paths.some((p) => p.includes("product.md")));
    assert.ok(paths.some((p) => p.includes("items.md")));
    assert.ok(paths.some((p) => p.includes("pr-review-results.md")));
    assert.ok(paths.some((p) => p.includes("fix-brief.md")));
    assert.ok(paths.some((p) => p.includes("CLAUDE_CODE_FIX_PROMPT.md")));
    assert.ok(paths.some((p) => p.includes("CODEX_FIX_PROMPT.md")));
  });

  it("all files are under simsa-pr-fix-pack/ root", () => {
    const res = generatePRFixBrief(buildReq());
    assert.ok(res.ok);
    for (const f of res.brief.files) {
      assert.ok(f.path.startsWith("simsa-pr-fix-pack/"), `unexpected path: ${f.path}`);
      assert.ok(!f.path.toLowerCase().includes("conclave"), `old brand in path: ${f.path}`);
    }
  });
});

describe("generatePRFixBrief — target filtering", () => {
  it("target=claude_code: no CODEX file, has CLAUDE_CODE file (6 files)", () => {
    const res = generatePRFixBrief(buildReq({ target: "claude_code" }));
    assert.ok(res.ok);
    const paths = res.brief.files.map((f) => f.path);
    assert.equal(paths.some((p) => p.includes("CODEX_FIX_PROMPT.md")), false);
    assert.ok(paths.some((p) => p.includes("CLAUDE_CODE_FIX_PROMPT.md")));
    assert.equal(res.brief.files.length, 6);
  });

  it("target=codex: no CLAUDE_CODE file, has CODEX file (6 files)", () => {
    const res = generatePRFixBrief(buildReq({ target: "codex" }));
    assert.ok(res.ok);
    const paths = res.brief.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.includes("CODEX_FIX_PROMPT.md")));
    assert.equal(paths.some((p) => p.includes("CLAUDE_CODE_FIX_PROMPT.md")), false);
    assert.equal(res.brief.files.length, 6);
  });
});

describe("generatePRFixBrief — content correctness", () => {
  it("pr-review-results.md includes disclaimer about PR scope", () => {
    const res = generatePRFixBrief(buildReq());
    assert.ok(res.ok);
    const prReviewFile = res.brief.files.find((f) => f.path.includes("pr-review-results.md"));
    assert.ok(prReviewFile, "pr-review-results.md not found");
    assert.ok(
      prReviewFile.content.includes("전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"),
      "disclaimer not found in pr-review-results.md",
    );
  });

  it("fix-brief.md has '안 맞음' section for failed items", () => {
    const res = generatePRFixBrief(buildReq());
    assert.ok(res.ok);
    const fixFile = res.brief.files.find((f) => f.path.includes("fix-brief.md"));
    assert.ok(fixFile, "fix-brief.md not found");
    assert.ok(fixFile.content.includes("안 맞음"), "failed section header not found");
    assert.ok(fixFile.content.includes("로그인 기능"), "failed item not included");
  });

  it("plainSummary describes fixable item counts", () => {
    const res = generatePRFixBrief(buildReq());
    assert.ok(res.ok);
    assert.ok(res.brief.plainSummary.includes("1"), "should mention count");
    assert.notEqual(res.brief.plainSummary, "수정할 항목 없음");
  });
});

describe("generatePRFixBrief — selection filtering", () => {
  it("excludes passed items from fix files even if passed is in selectedItemIds", () => {
    const res = generatePRFixBrief(buildReq({ selectedItemIds: ["item-1", "item-4"] }));
    assert.ok(res.ok);
    const fixFile = res.brief.files.find((f) => f.path.includes("fix-brief.md"));
    assert.ok(fixFile);
    // item-4 (passed) should NOT appear in fix-brief
    assert.equal(fixFile.content.includes("대시보드"), false, "passed item should not appear in fix-brief");
  });

  it("emits warning when all selected items are passed", () => {
    const res = generatePRFixBrief(buildReq({ selectedItemIds: ["item-4"] }));
    assert.ok(res.ok);
    assert.ok(Array.isArray(res.warnings), "expected warnings array");
    assert.ok(res.warnings.length > 0, "expected at least one warning");
  });

  it("respects selectedItemIds — excludes items not selected", () => {
    const res = generatePRFixBrief(buildReq({ selectedItemIds: ["item-1"] }));
    assert.ok(res.ok);
    const itemsFile = res.brief.files.find((f) => f.path.includes("items.md"));
    assert.ok(itemsFile);
    assert.ok(itemsFile.content.includes("로그인 기능"), "selected item missing");
    assert.equal(itemsFile.content.includes("알림 설정"), false, "unselected item should not appear");
  });
});

describe("generatePRFixBrief — prompt content", () => {
  it("CLAUDE_CODE prompt mentions PR number and repo", () => {
    const res = generatePRFixBrief(buildReq({ target: "claude_code" }));
    assert.ok(res.ok);
    const ccFile = res.brief.files.find((f) => f.path.includes("CLAUDE_CODE_FIX_PROMPT.md"));
    assert.ok(ccFile);
    assert.ok(ccFile.content.includes("PR #42"), "PR number missing from Claude Code prompt");
    assert.ok(ccFile.content.includes("myorg/myapp"), "repo missing from Claude Code prompt");
  });

  it("CODEX prompt mentions constraint to not touch unrelated files", () => {
    const res = generatePRFixBrief(buildReq({ target: "codex" }));
    assert.ok(res.ok);
    const codexFile = res.brief.files.find((f) => f.path.includes("CODEX_FIX_PROMPT.md"));
    assert.ok(codexFile);
    assert.ok(
      codexFile.content.toLowerCase().includes("unrelated") ||
      codexFile.content.includes("Touch files unrelated"),
      "constraint line missing",
    );
  });
});
