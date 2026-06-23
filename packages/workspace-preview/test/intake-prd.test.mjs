// Stage 102 — PRD/spec intake preview tests. Pure/deterministic; no backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrdIntakePreview, SAMPLE_PRD } from "../src/intake-prd.mjs";

test("empty/minimal input returns a fallback preview", () => {
  const p = buildPrdIntakePreview("   ");
  assert.match(p.productIntent, /converted into acceptance items/);
  assert.deepEqual(p.likelyUsers, ["User", "Operator"]);
  assert.ok(p.candidateAcceptanceItems.length >= 4);
  assert.ok(p.missingQuestions.length >= 3 && p.missingQuestions.length <= 6);
  assert.equal(p.confidence, "low");
});

test("detects users from PRD text", () => {
  const p = buildPrdIntakePreview("Users: Founder and admin manage the team.");
  assert.ok(p.likelyUsers.includes("Founder"));
  assert.ok(p.likelyUsers.includes("Admin"));
  assert.ok(p.likelyUsers.includes("Team"));
});

test("detects action-oriented flows", () => {
  const p = buildPrdIntakePreview(
    "User can create a project and submit it. Operator can review and approve.",
  );
  const flows = p.candidateUserFlows.join(" ");
  assert.match(flows, /create the main item/);
  assert.match(flows, /submit a request/);
  assert.match(flows, /review results/);
  assert.match(flows, /approve work/);
});

test("creates acceptance-style items", () => {
  const p = buildPrdIntakePreview("User can submit a form.");
  assert.ok(
    p.candidateAcceptanceItems.some((i) => /without errors/.test(i)),
  );
  assert.ok(
    p.candidateAcceptanceItems.some((i) => /Release readiness/.test(i)),
  );
});

test("always includes missing questions (3–6)", () => {
  const p = buildPrdIntakePreview("A vague document with no signals.");
  assert.ok(p.missingQuestions.length >= 3 && p.missingQuestions.length <= 6);
  assert.ok(p.missingQuestions.some((q) => /successful outcome/.test(q)));
});

test("detects payment-specific question", () => {
  const p = buildPrdIntakePreview("Users can pay at checkout for a subscription.");
  assert.ok(
    p.missingQuestions.some((q) => /payment failures and refunds/.test(q)),
    "expected a payment question",
  );
});

test("detects repo/PR-specific question", () => {
  const p = buildPrdIntakePreview("A founder connects a GitHub repo to review.");
  assert.ok(
    p.missingQuestions.some((q) => /repository or branch/.test(q)),
  );
});

test("is deterministic", () => {
  assert.deepEqual(
    buildPrdIntakePreview(SAMPLE_PRD),
    buildPrdIntakePreview(SAMPLE_PRD),
  );
});

test("sample PRD reaches higher confidence", () => {
  const p = buildPrdIntakePreview(SAMPLE_PRD);
  assert.ok(["medium", "high"].includes(p.confidence));
  assert.ok(p.likelyUsers.includes("Founder"));
});
