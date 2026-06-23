// Stage 104 — GitHub repo intake preview tests. Pure/deterministic; no fetch/API.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGitHubRepoIntakePreview,
  SAMPLE_GITHUB_REPO,
} from "../src/intake-github-repo.mjs";

test("parses owner/repo", () => {
  const p = buildGitHubRepoIntakePreview("acme/widget");
  assert.equal(p.owner, "acme");
  assert.equal(p.repo, "widget");
  assert.equal(p.normalizedRepo, "acme/widget");
  assert.equal(p.repoUrl, "https://github.com/acme/widget");
});

test("parses https github URL", () => {
  const p = buildGitHubRepoIntakePreview("https://github.com/acme/widget");
  assert.equal(p.normalizedRepo, "acme/widget");
});

test("parses github.com/owner/repo without scheme", () => {
  const p = buildGitHubRepoIntakePreview("github.com/acme/widget");
  assert.equal(p.normalizedRepo, "acme/widget");
});

test("parses PR URL and flags PR-vs-repo question", () => {
  const p = buildGitHubRepoIntakePreview("https://github.com/acme/widget/pull/123");
  assert.equal(p.normalizedRepo, "acme/widget");
  assert.ok(p.missingQuestions.some((q) => /PR change or the whole repo/.test(q)));
});

test("parses tree URL and keeps repo", () => {
  const p = buildGitHubRepoIntakePreview("https://github.com/acme/widget/tree/main");
  assert.equal(p.normalizedRepo, "acme/widget");
});

test("strips .git suffix", () => {
  const p = buildGitHubRepoIntakePreview("https://github.com/acme/widget.git");
  assert.equal(p.repo, "widget");
});

test("detects repo types", () => {
  assert.equal(buildGitHubRepoIntakePreview("acme/web-dashboard").likelyRepoType, "app");
  assert.equal(buildGitHubRepoIntakePreview("acme/billing-api").likelyRepoType, "api");
  assert.equal(buildGitHubRepoIntakePreview("acme/product-docs").likelyRepoType, "docs");
  assert.equal(buildGitHubRepoIntakePreview("acme/js-sdk").likelyRepoType, "library");
  assert.equal(buildGitHubRepoIntakePreview("acme/platform-monorepo").likelyRepoType, "monorepo");
  assert.equal(buildGitHubRepoIntakePreview("acme/widget").likelyRepoType, "unknown");
});

test("type-specific question appears (app)", () => {
  const p = buildGitHubRepoIntakePreview("acme/web-app");
  assert.ok(p.missingQuestions.some((q) => /first user journey/.test(q)));
});

test("handles invalid input without throwing", () => {
  for (const bad of ["", "   ", "justtext", "/", "owner", null]) {
    const p = buildGitHubRepoIntakePreview(bad);
    assert.equal(p.owner, "Unknown");
    assert.equal(p.likelyRepoType, "unknown");
    assert.equal(p.confidence, "low");
  }
});

test("preview shape: focus areas, items, 3-6 questions", () => {
  for (const r of [SAMPLE_GITHUB_REPO, "acme/billing-api", "bad"]) {
    const p = buildGitHubRepoIntakePreview(r);
    assert.ok(p.reviewFocusAreas.length >= 3);
    assert.ok(p.candidateAcceptanceItems.length >= 4);
    assert.ok(p.missingQuestions.length >= 3 && p.missingQuestions.length <= 6);
  }
});

test("is deterministic", () => {
  assert.deepEqual(
    buildGitHubRepoIntakePreview(SAMPLE_GITHUB_REPO),
    buildGitHubRepoIntakePreview(SAMPLE_GITHUB_REPO),
  );
});
