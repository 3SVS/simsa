import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BANNED_USER_FACING_TERMS } from "./fixtures/workspace-ideas.mjs";

const { generateBuilderPack } = await import("../dist/workspace/export.js");

const MOCK_SPEC = {
  productName: "회의록 자동 요약 앱",
  oneLine: "회의를 녹음하면 요약과 할 일이 자동으로 정리됩니다",
  targetUsers: ["회의가 많은 팀"],
  problem: "회의 후 내용 정리에 시간이 많이 걸립니다.",
  included: ["녹음 파일 업로드", "STT 변환", "요약 생성", "할 일 추출"],
  excluded: ["실시간 녹음", "화상 회의 연동", "번역"],
  userFlow: ["파일 업로드", "변환·요약", "확인"],
  decisions: ["사용자가 확인한 할 일만 전송"],
  openQuestions: ["파일 크기 상한선 결정 필요"],
};

const MOCK_ITEMS = [
  { id: "req_001", title: "녹음 파일을 올릴 수 있어야 함", status: "not_started", criteria: ["mp3 지원"] },
  { id: "req_002", title: "텍스트로 변환되어야 함", status: "failed", criteria: [] },
  { id: "req_003", title: "요약이 생성되어야 함", status: "inconclusive", criteria: ["요약 길이 명시"] },
];

const MOCK_CHECK_RESULTS = {
  results: [
    { itemId: "req_001", status: "passed", title: "녹음 파일을 올릴 수 있어야 함", reason: "포함 기능과 일치합니다.", evidence: ["포함 목록에 있음"], nextAction: "" },
    { itemId: "req_002", status: "failed", title: "텍스트로 변환되어야 함", reason: "완성 기준이 없습니다.", evidence: [], nextAction: "완성 기준을 추가하세요." },
  ],
  summary: { passed: 1, failed: 1, inconclusive: 0, needsDecision: 0 },
};

const MOCK_FIX = {
  req_002: {
    itemId: "req_002",
    suggestion: {
      plainSummary: "완성 기준을 추가하면 됩니다.",
      builderBrief: {
        title: "STT 변환 완성 기준 추가",
        goal: "STT 결과를 검증할 수 있도록 완성 기준을 추가한다.",
        tasks: ["완성 기준 항목을 추가한다"],
        doneWhen: ["텍스트 변환 결과가 화면에 표시된다"],
        doNotDo: ["번역 기능은 포함하지 않는다"],
        verifyBy: ["변환 결과 확인"],
      },
    },
  },
};

function makeReq(target, overrides = {}) {
  return {
    project: {
      title: MOCK_SPEC.productName,
      productSpec: MOCK_SPEC,
      items: MOCK_ITEMS,
      ...overrides,
    },
    target,
    format: "json",
    locale: "ko",
  };
}

describe("workspace export-builder-pack", () => {
  it("returns ok:true and files array", () => {
    const res = generateBuilderPack(makeReq("both"));
    assert.equal(res.ok, true);
    assert.equal(res.source, "deterministic");
    assert.ok(Array.isArray(res.bundle.files));
    assert.ok(res.bundle.files.length > 0);
    assert.ok(res.summary.fileCount === res.bundle.files.length);
  });

  it("claude_code target includes CLAUDE_CODE_PROMPT.md, not CODEX_PROMPT.md", () => {
    const res = generateBuilderPack(makeReq("claude_code"));
    const paths = res.bundle.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith("CLAUDE_CODE_PROMPT.md")), "CLAUDE_CODE_PROMPT.md missing");
    assert.ok(!paths.some((p) => p.endsWith("CODEX_PROMPT.md")), "CODEX_PROMPT.md should not be present");
  });

  it("codex target includes CODEX_PROMPT.md, not CLAUDE_CODE_PROMPT.md", () => {
    const res = generateBuilderPack(makeReq("codex"));
    const paths = res.bundle.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith("CODEX_PROMPT.md")), "CODEX_PROMPT.md missing");
    assert.ok(!paths.some((p) => p.endsWith("CLAUDE_CODE_PROMPT.md")), "CLAUDE_CODE_PROMPT.md should not be present");
  });

  it("both prompts hand-hold a beginner through external-service setup + return-to-Simsa", () => {
    const res = generateBuilderPack(makeReq("both"));
    const prompts = res.bundle.files
      .filter((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md") || f.path.endsWith("CODEX_PROMPT.md"))
      .map((f) => f.content);
    assert.equal(prompts.length, 2);
    for (const p of prompts) {
      // beginner setup guidance: signup URLs + exact key-finding path + warning
      assert.match(p, /완전 초보자 가정/);
      assert.ok(p.includes("https://supabase.com"), "Supabase signup URL");
      assert.ok(p.includes("service_role") && p.includes("Reveal"), "exact service_role key path");
      assert.ok(p.includes("https://vercel.com"), "Vercel signup URL");
      assert.match(p, /환경변수/); // don't hardcode keys
      // return-to-Simsa: either the deployed URL or the project files
      assert.match(p, /Simsa로 다시 확인받기/);
      assert.ok(p.includes("배포된 앱 URL") && p.includes("프로젝트 파일"), "URL or files re-entry");
    }
  });

  it("both target includes both prompt files", () => {
    const res = generateBuilderPack(makeReq("both"));
    const paths = res.bundle.files.map((f) => f.path);
    assert.ok(paths.some((p) => p.endsWith("CLAUDE_CODE_PROMPT.md")), "CLAUDE_CODE_PROMPT.md missing");
    assert.ok(paths.some((p) => p.endsWith("CODEX_PROMPT.md")), "CODEX_PROMPT.md missing");
  });

  it("product.md includes product name", () => {
    const res = generateBuilderPack(makeReq("both"));
    const productFile = res.bundle.files.find((f) => f.path.endsWith("product.md"));
    assert.ok(productFile, "product.md missing");
    assert.ok(productFile.content.includes(MOCK_SPEC.productName), "product name not found in product.md");
  });

  it("checks.md includes 사전 점검 안내", () => {
    const res = generateBuilderPack(makeReq("both", { checkResults: MOCK_CHECK_RESULTS }));
    const checksFile = res.bundle.files.find((f) => f.path.endsWith("checks.md"));
    assert.ok(checksFile, "checks.md missing");
    assert.ok(checksFile.content.includes("사전 점검"), "사전 점검 안내 not found in checks.md");
    assert.ok(checksFile.content.includes("실제 코드"), "실제 코드 disclaimer not found");
  });

  it("checks.md without results still includes 사전 점검 안내", () => {
    const res = generateBuilderPack(makeReq("both"));
    const checksFile = res.bundle.files.find((f) => f.path.endsWith("checks.md"));
    assert.ok(checksFile, "checks.md missing");
    assert.ok(checksFile.content.includes("사전 점검"), "안내 missing even without results");
  });

  it("fixes.md includes fix suggestion when provided", () => {
    const res = generateBuilderPack(makeReq("both", { checkResults: MOCK_CHECK_RESULTS, fixSuggestions: MOCK_FIX }));
    const fixFile = res.bundle.files.find((f) => f.path.endsWith("fixes.md"));
    assert.ok(fixFile, "fixes.md missing");
    assert.ok(fixFile.content.includes("완성 기준을 추가하면 됩니다"), "fix summary not in fixes.md");
  });

  it("all files use conclave-build-pack/ path prefix", () => {
    const res = generateBuilderPack(makeReq("both"));
    for (const f of res.bundle.files) {
      assert.ok(f.path.startsWith("conclave-build-pack/"), `${f.path} does not start with conclave-build-pack/`);
    }
  });

  it("no banned developer terms in generated file content", () => {
    const res = generateBuilderPack(makeReq("both", { checkResults: MOCK_CHECK_RESULTS, fixSuggestions: MOCK_FIX }));
    for (const file of res.bundle.files) {
      for (const term of BANNED_USER_FACING_TERMS) {
        assert.ok(
          !file.content.includes(term),
          `Banned term "${term}" found in ${file.path}`,
        );
      }
    }
  });

  it("returns empty files when no project provided", () => {
    const res = generateBuilderPack({ target: "both", format: "json" });
    assert.equal(res.ok, true);
    assert.equal(res.bundle.files.length, 0);
  });

  it("CLAUDE_CODE_PROMPT.md contains all 7 required instructions", () => {
    const res = generateBuilderPack(makeReq("claude_code"));
    const file = res.bundle.files.find((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md"));
    assert.ok(file, "file missing");
    // 7 numbered steps
    for (let i = 1; i <= 7; i++) {
      assert.ok(file.content.includes(`${i}.`), `instruction ${i} missing`);
    }
    assert.ok(file.content.includes("완성 기준"), "완성 기준 instruction missing");
    assert.ok(file.content.includes("제외"), "scope constraint missing");
    assert.ok(file.content.includes("질문"), "ask-before-code instruction missing");
    assert.ok(file.content.includes("보고"), "report instruction missing");
    assert.ok(file.content.includes("포함된 항목만 구현"), "selection constraint missing");
  });

  it("CODEX_PROMPT.md has all required sections", () => {
    const res = generateBuilderPack(makeReq("codex"));
    const file = res.bundle.files.find((f) => f.path.endsWith("CODEX_PROMPT.md"));
    assert.ok(file, "file missing");
    assert.ok(file.content.includes("## Goal"), "Goal section missing");
    assert.ok(file.content.includes("## Context"), "Context section missing");
    assert.ok(file.content.includes("## Constraints"), "Constraints section missing");
    assert.ok(file.content.includes("## Done when"), "Done when section missing");
    assert.ok(file.content.includes("## Do not do"), "Do not do section missing");
    assert.ok(file.content.includes("## Verify by"), "Verify by section missing");
    assert.ok(file.content.includes("## Final response format"), "Final response format section missing");
  });
});

// ─── Stage 7: selectedItemIds tests ──────────────────────────────────────────

describe("workspace export-builder-pack (Stage 7: selectedItemIds)", () => {
  it("export without selectedItemIds includes all items", () => {
    const res = generateBuilderPack(makeReq("both"));
    assert.equal(res.summary.totalItems, MOCK_ITEMS.length);
    assert.equal(res.summary.selectedItems, MOCK_ITEMS.length);

    const itemsFile = res.bundle.files.find((f) => f.path.endsWith("items.md"));
    assert.ok(itemsFile, "items.md missing");
    for (const item of MOCK_ITEMS) {
      assert.ok(itemsFile.content.includes(item.title), `${item.title} missing from items.md`);
    }
  });

  it("export with selectedItemIds includes only selected items in items.md", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      selectedItemIds: ["req_001"],
    });
    assert.equal(res.summary.totalItems, MOCK_ITEMS.length);
    assert.equal(res.summary.selectedItems, 1);

    const itemsFile = res.bundle.files.find((f) => f.path.endsWith("items.md"));
    assert.ok(itemsFile, "items.md missing");
    assert.ok(itemsFile.content.includes("녹음 파일을 올릴 수 있어야 함"), "selected item missing");
    assert.ok(!itemsFile.content.includes("텍스트로 변환되어야 함"), "non-selected item should not appear");
  });

  it("product.md keeps full context even when items are filtered", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      selectedItemIds: ["req_001"],
    });
    const productFile = res.bundle.files.find((f) => f.path.endsWith("product.md"));
    assert.ok(productFile, "product.md missing");
    assert.ok(productFile.content.includes(MOCK_SPEC.productName), "product name missing");
    assert.ok(productFile.content.includes(MOCK_SPEC.problem), "problem missing from product.md");
    assert.ok(productFile.content.includes(MOCK_SPEC.included[0]), "included features missing");
  });

  it("checks.md filters to selected items only", () => {
    const res = generateBuilderPack({
      ...makeReq("both", { checkResults: MOCK_CHECK_RESULTS }),
      selectedItemIds: ["req_001"],
    });
    const checksFile = res.bundle.files.find((f) => f.path.endsWith("checks.md"));
    assert.ok(checksFile, "checks.md missing");
    // req_001 is "passed" — should appear
    assert.ok(checksFile.content.includes("녹음 파일을 올릴 수 있어야 함"), "selected item missing from checks");
    // req_002 is "failed" but NOT selected — should NOT appear
    assert.ok(!checksFile.content.includes("텍스트로 변환되어야 함"), "non-selected item should not appear in checks");
  });

  it("summary.selectedItems reflects the filter", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      selectedItemIds: ["req_001", "req_002"],
    });
    assert.equal(res.summary.selectedItems, 2);
    assert.equal(res.summary.totalItems, MOCK_ITEMS.length);
  });

  it("empty selectedItemIds falls back to all items", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      selectedItemIds: [],
    });
    assert.equal(res.summary.selectedItems, MOCK_ITEMS.length);
  });

  it("Claude prompt says only selected items should be implemented", () => {
    const res = generateBuilderPack({
      ...makeReq("claude_code"),
      selectedItemIds: ["req_001"],
    });
    const file = res.bundle.files.find((f) => f.path.endsWith("CLAUDE_CODE_PROMPT.md"));
    assert.ok(file, "CLAUDE_CODE_PROMPT.md missing");
    assert.ok(file.content.includes("포함된 항목만 구현"), "scope constraint missing");
    assert.ok(file.content.includes("포함되지 않은 항목은 건드리지"), "non-selected warning missing");
    assert.ok(file.content.includes("녹음 파일을 올릴 수 있어야 함"), "selected item missing from prompt");
  });

  it("Codex prompt has Selected tasks section", () => {
    const res = generateBuilderPack({
      ...makeReq("codex"),
      selectedItemIds: ["req_002"],
    });
    const file = res.bundle.files.find((f) => f.path.endsWith("CODEX_PROMPT.md"));
    assert.ok(file, "CODEX_PROMPT.md missing");
    assert.ok(file.content.includes("## Selected tasks"), "Selected tasks section missing");
    assert.ok(file.content.includes("텍스트로 변환되어야 함"), "selected item missing from Codex prompt");
  });

  it("README shows item count when filtered", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      selectedItemIds: ["req_001"],
    });
    const readme = res.bundle.files.find((f) => f.path.endsWith("README.md"));
    assert.ok(readme, "README.md missing");
    assert.ok(readme.content.includes("1개"), "filtered item count missing from README");
    assert.ok(readme.content.includes(`${MOCK_ITEMS.length}개 중`), "total item count missing from README");
  });
});

// ─── D1-b: regression re-entry hook ──────────────────────────────────────────

describe("workspace export-builder-pack (D1-b: regression hook)", () => {
  const HOOK_FILES = ["README.md", "CLAUDE_CODE_PROMPT.md", "CODEX_PROMPT.md"];

  function filesEndingWith(res, suffixes) {
    return res.bundle.files.filter((f) => suffixes.some((s) => f.path.endsWith(s)));
  }

  it("embeds the /p/{projectId}/connect link when projectId + appBaseUrl are given", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      projectId: "proj_abc123",
      appBaseUrl: "https://app.trysimsa.com",
    });
    const expected = "https://app.trysimsa.com/p/proj_abc123/connect";
    for (const file of filesEndingWith(res, HOOK_FILES)) {
      assert.ok(file.content.includes(expected), `connect link missing from ${file.path}`);
      assert.ok(file.content.includes("## After building"), `hook heading missing from ${file.path}`);
    }
  });

  it("omits the hook cleanly when projectId is absent (no broken /p//connect)", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      appBaseUrl: "https://app.trysimsa.com",
    });
    for (const file of res.bundle.files) {
      assert.ok(!file.content.includes("/p//connect"), `broken link in ${file.path}`);
      assert.ok(!file.content.includes("/connect"), `hook should be absent in ${file.path}`);
      assert.ok(!file.content.includes("## After building"), `hook heading leaked in ${file.path}`);
    }
  });

  it("omits the hook cleanly when appBaseUrl is absent", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      projectId: "proj_abc123",
    });
    for (const file of res.bundle.files) {
      assert.ok(!file.content.includes("/connect"), `hook should be absent in ${file.path}`);
    }
  });

  it("never emits /p//connect even if projectId is blank", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      projectId: "   ",
      appBaseUrl: "https://app.trysimsa.com",
    });
    for (const file of res.bundle.files) {
      assert.ok(!file.content.includes("/p//connect"), `broken link in ${file.path}`);
      assert.ok(!file.content.includes("/connect"), `hook should be absent in ${file.path}`);
    }
  });

  it("strips a trailing slash from appBaseUrl (no double slash)", () => {
    const res = generateBuilderPack({
      ...makeReq("both"),
      projectId: "proj_abc123",
      appBaseUrl: "https://app.trysimsa.com/",
    });
    const readme = res.bundle.files.find((f) => f.path.endsWith("README.md"));
    assert.ok(readme, "README.md missing");
    assert.ok(
      readme.content.includes("https://app.trysimsa.com/p/proj_abc123/connect"),
      "trailing slash not normalised",
    );
    assert.ok(!readme.content.includes(".com//p/"), "double slash present");
  });

  it("hook introduces no banned developer terms", () => {
    const res = generateBuilderPack({
      ...makeReq("both", { checkResults: MOCK_CHECK_RESULTS, fixSuggestions: MOCK_FIX }),
      projectId: "proj_abc123",
      appBaseUrl: "https://app.trysimsa.com",
    });
    for (const file of res.bundle.files) {
      for (const term of BANNED_USER_FACING_TERMS) {
        assert.ok(!file.content.includes(term), `Banned term "${term}" found in ${file.path}`);
      }
    }
  });
});
