// Stage 101 — unified intake model tests. Pure/deterministic; no backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_INTAKE_TYPES,
  INTAKE_OUTPUTS,
  INTAKE_OUTPUT_LABELS,
  INTAKE_META,
  isWorkspaceIntakeType,
  buildIntakeDraft,
} from "../src/intake.mjs";

test("there are 6 unique intake types", () => {
  assert.equal(WORKSPACE_INTAKE_TYPES.length, 6);
  assert.equal(new Set(WORKSPACE_INTAKE_TYPES).size, 6);
  assert.deepEqual(WORKSPACE_INTAKE_TYPES, [
    "idea",
    "prd",
    "product_url",
    "github_repo",
    "pull_request",
    "ai_built_app",
  ]);
});

test("every type has complete, non-empty meta", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const meta = INTAKE_META[type];
    assert.ok(meta, `missing meta for ${type}`);
    assert.equal(meta.type, type);
    for (const field of ["label", "description", "placeholder", "inputHint"]) {
      assert.ok(meta[field] && meta[field].length > 0, `${type}.${field} empty`);
    }
  }
});

test("all 6 outputs have labels", () => {
  assert.equal(INTAKE_OUTPUTS.length, 6);
  for (const out of INTAKE_OUTPUTS) {
    assert.ok(INTAKE_OUTPUT_LABELS[out], `missing label for ${out}`);
  }
});

test("isWorkspaceIntakeType validates", () => {
  assert.ok(isWorkspaceIntakeType("idea"));
  assert.ok(isWorkspaceIntakeType("ai_built_app"));
  assert.ok(!isWorkspaceIntakeType("nope"));
  assert.ok(!isWorkspaceIntakeType(""));
  assert.ok(!isWorkspaceIntakeType(null));
});

test("buildIntakeDraft: every type yields the full set of expected outputs", () => {
  for (const type of WORKSPACE_INTAKE_TYPES) {
    const draft = buildIntakeDraft(type, "some input");
    assert.equal(draft.type, type);
    assert.deepEqual(draft.expectedOutputs, INTAKE_OUTPUTS);
    assert.ok(draft.title.length > 0);
    assert.ok(draft.sourceSummary.length > 0);
    assert.equal(draft.rawInput, "some input");
  }
});

test("buildIntakeDraft is deterministic", () => {
  const a = buildIntakeDraft("idea", "An app that reviews AI-built drafts");
  const b = buildIntakeDraft("idea", "An app that reviews AI-built drafts");
  assert.deepEqual(a, b);
  assert.equal(a.title, "Idea: An app that reviews AI-built drafts");
});

test("buildIntakeDraft handles empty input deterministically", () => {
  const d = buildIntakeDraft("prd", "   ");
  assert.equal(d.rawInput, "");
  assert.equal(d.title, "PRD / spec intake");
  assert.match(d.sourceSummary, /no input provided yet/);
});

test("buildIntakeDraft truncates a long first line", () => {
  const long = "x".repeat(200);
  const d = buildIntakeDraft("idea", long);
  assert.ok(d.title.includes("…"));
  assert.ok(d.title.length < 120);
});

test("buildIntakeDraft rejects unknown type", () => {
  assert.throws(() => buildIntakeDraft("bogus", "x"), /unknown intake type/);
});
