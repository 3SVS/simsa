// Stage 136 — MCP Basic intake preview wrapper tests. Pure; no network/mutation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewAcceptanceMap,
  previewStagePlan,
  previewAgentRunPlan,
  previewEvidencePlan,
} from "../src/mcp-basic-preview-tools.mjs";

const WRAPPERS = [
  ["acceptance_map", previewAcceptanceMap],
  ["stage_plan", previewStagePlan],
  ["agent_run_plan", previewAgentRunPlan],
  ["evidence_plan", previewEvidencePlan],
];

function assertBoundary(r) {
  assert.equal(r.mutatesState, false);
  assert.equal(r.usesHostedExecution, false);
  assert.equal(r.requiresPayment, false);
  assert.equal(r.derivedPreviewOnly, true);
}

test("each wrapper returns a derived preview + boundary metadata", () => {
  for (const [kind, fn] of WRAPPERS) {
    const r = fn({ type: "github_repo", rawInput: "acme/web-app" });
    assert.equal(r.ok, true, kind);
    assert.equal(r.kind, kind);
    assert.ok(r.preview && typeof r.preview === "object", kind);
    assertBoundary(r);
  }
});

test("preview content matches the shared helper output shape", () => {
  const map = previewAcceptanceMap({ type: "prd", rawInput: "Overview: x. User can submit." });
  assert.ok(Array.isArray(map.preview.items));
  const stage = previewStagePlan({ type: "github_repo", rawInput: "acme/web-app" });
  assert.ok(Array.isArray(stage.preview.stages));
  const run = previewAgentRunPlan({ type: "github_repo", rawInput: "acme/web-app" });
  assert.ok(Array.isArray(run.preview.tasks));
  const ev = previewEvidencePlan({ type: "github_repo", rawInput: "acme/web-app" });
  assert.ok(Array.isArray(ev.preview.expectations));
  assert.equal(ev.preview.overallEvidenceStatus, "not_verified");
});

test("missing input returns safe error object (no throw)", () => {
  for (const [, fn] of WRAPPERS) {
    const r = fn({ type: "github_repo", rawInput: "" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_input");
    assert.ok(r.message.length > 0);
    assertBoundary(r);
  }
});

test("invalid type returns safe error object", () => {
  const r = previewAcceptanceMap({ type: "bogus", rawInput: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_type");
  assertBoundary(r);
});

test("malformed input does not throw", () => {
  for (const m of [null, undefined, 7, "x", {}, { type: 1, rawInput: 2 }]) {
    for (const [, fn] of WRAPPERS) {
      assert.doesNotThrow(() => fn(m));
    }
  }
});

test("deterministic output", () => {
  const a = previewAcceptanceMap({ type: "github_repo", rawInput: "acme/web-app" });
  const b = previewAcceptanceMap({ type: "github_repo", rawInput: "acme/web-app" });
  assert.deepEqual(a, b);
});

test("no Stripe/payment-provider strings in wrapper output", () => {
  const blob = JSON.stringify(previewEvidencePlan({ type: "github_repo", rawInput: "acme/web-app" })).toLowerCase();
  assert.ok(!blob.includes("stripe"));
});
