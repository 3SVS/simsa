import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { TOOL_META } = await import("../dist/server.js");
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("tool descriptions", () => {
  it("run_pr_review states it may consume a review credit", () => {
    assert.match(TOOL_META.run_pr_review.description, /credit/i);
  });

  it("non-billable read tools say so", () => {
    for (const t of ["list_projects", "get_review_history", "preview_pr_comment", "compare_runs"]) {
      assert.match(TOOL_META[t].description, /no credits/i, `${t} should say no credits`);
    }
  });

  it("post_pr_comment is marked disabled-by-default and confirm-required", () => {
    const d = TOOL_META.post_pr_comment.description;
    assert.match(d, /disabled by default/i);
    assert.match(d, /confirm/i);
    assert.match(d, /write action/i);
  });

  it("every tool warns that PR/review text is untrusted data (injection defense)", () => {
    for (const [name, meta] of Object.entries(TOOL_META)) {
      assert.match(meta.description, /untrusted DATA/i, `${name} missing untrusted-data warning`);
    }
  });
});

describe("README packaging", () => {
  it("contains no raw GitHub token or token env in config", () => {
    assert.ok(!/ghp_[A-Za-z0-9]/.test(README), "must not contain a GitHub PAT");
    assert.ok(!/github_pat_/i.test(README), "must not contain a fine-grained PAT");
    assert.ok(!/GITHUB_TOKEN/.test(README), "must not put a GITHUB_TOKEN in config");
  });

  it("documents the required key, billing line, and safety warning", () => {
    assert.match(README, /CONCLAVE_USER_KEY/);
    assert.match(README, /1 review credit/i);
    assert.match(README, /You pay for acceptance reviews/i);
    assert.match(README, /Never paste raw GitHub tokens/i);
  });

  it("includes both an agent config and a local-dev config example", () => {
    assert.match(README, /"conclave-mcp-workspace"/);
    assert.match(README, /"--filter", "@conclave-ai\/mcp-workspace", "start"/);
  });
});
