import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression guard for the bug class where an LLM route silently bypassed the
// Cloudflare AI Gateway. Direct Worker→Anthropic egress ~90% 403s, so every
// generate*() call in the workspace routes MUST pass
// c.env.CF_AI_GATEWAY_ANTHROPIC_URL. check-draft omitted it once and produced
// the recurring "확인 중 오류가 발생했습니다" — this test would have caught it.

const src = readFileSync(
  fileURLToPath(new URL("../src/routes/workspace.ts", import.meta.url)),
  "utf8",
);
const docSrc = readFileSync(
  fileURLToPath(new URL("../src/routes/workspace-document-intake.ts", import.meta.url)),
  "utf8",
);
const githubSrc = readFileSync(
  fileURLToPath(new URL("../src/routes/workspace-github.ts", import.meta.url)),
  "utf8",
);

const GENERATORS = [
  "generateIdeaToSpecDraft",
  "generateCheckDraft",
  "generateFixSuggestion",
];

describe("every LLM route goes through the AI Gateway", () => {
  for (const gen of GENERATORS) {
    it(`${gen}(...) passes CF_AI_GATEWAY_ANTHROPIC_URL`, () => {
      const callLines = src
        .split("\n")
        .filter((l) => l.includes(`${gen}(`) && !l.trimStart().startsWith("import"));
      assert.ok(callLines.length > 0, `${gen} call not found in workspace.ts`);
      for (const l of callLines) {
        assert.ok(
          l.includes("CF_AI_GATEWAY_ANTHROPIC_URL"),
          `${gen} call bypasses the AI Gateway: ${l.trim()}`,
        );
      }
    });
  }

  it("document-intake generation also routes through the gateway", () => {
    const callLines = docSrc
      .split("\n")
      .filter((l) => l.includes("generateIdeaToSpecDraft(") && !l.trimStart().startsWith("import"));
    assert.ok(callLines.length > 0);
    for (const l of callLines) {
      assert.ok(l.includes("CF_AI_GATEWAY_ANTHROPIC_URL"), `document-intake bypasses the gateway: ${l.trim()}`);
    }
  });

  it("recommend-answer (generateRecommendedAnswer) routes through the gateway", () => {
    // C2's route call is multi-line, so assert the gateway URL appears within
    // the call region (from the call to its closing `);`), like reviewPRAgainstItems.
    const idx = src.indexOf("generateRecommendedAnswer(");
    assert.ok(idx !== -1, "generateRecommendedAnswer call not found in workspace.ts");
    const end = src.indexOf(");", idx);
    const region = src.slice(idx, end === -1 ? idx + 600 : end);
    assert.ok(
      region.includes("CF_AI_GATEWAY_ANTHROPIC_URL"),
      "recommend-answer bypasses the AI Gateway",
    );
  });

  it("PR review (reviewPRAgainstItems) routes through the gateway", () => {
    // reviewPRAgainstItems is a multi-line call; assert the gateway URL appears
    // within the call region (from the call to its closing `);`). This was the
    // 5th Worker-side callAnthropic site audited after check-draft was found
    // bypassing the gateway.
    const idx = githubSrc.indexOf("await reviewPRAgainstItems(");
    assert.ok(idx !== -1, "reviewPRAgainstItems call not found in workspace-github.ts");
    const end = githubSrc.indexOf(");", idx);
    const region = githubSrc.slice(idx, end === -1 ? idx + 600 : end);
    assert.ok(
      region.includes("CF_AI_GATEWAY_ANTHROPIC_URL"),
      "PR review bypasses the AI Gateway",
    );
  });
});
