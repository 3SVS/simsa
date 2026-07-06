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
});
