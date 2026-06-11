/**
 * Stage 8: builder_pack_outcomes D1 helpers + route validation tests.
 * Uses a minimal in-memory DB mock so no actual D1 is needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { saveOutcome, listOutcomes, isValidOutcome, isValidTarget } =
  await import("../dist/workspace/outcomes.js");

// ─── Minimal D1 mock ─────────────────────────────────────────────────────────

function makeMockDb() {
  const state = { outcomes: [] };
  return {
    state,
    prepare(sql) {
      let bound = [];
      return {
        bind(...args) {
          bound = args;
          return this;
        },
        async run() {
          if (/INSERT INTO builder_pack_outcomes/.test(sql)) {
            const [id, project_id, user_key, target, selected_item_ids_json, outcome, note, created_at] = bound;
            state.outcomes.push({ id, project_id, user_key, target, selected_item_ids_json, outcome, note, created_at });
          }
          return { success: true };
        },
        async all() {
          if (/FROM builder_pack_outcomes/.test(sql)) {
            const [projectId, limit] = bound;
            const results = state.outcomes
              .filter((r) => r.project_id === projectId)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .slice(0, limit);
            return { results };
          }
          return { results: [] };
        },
      };
    },
  };
}

function makeEnv(overrides = {}) {
  return { DB: makeMockDb(), ANTHROPIC_API_KEY: "test", ...overrides };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

describe("outcome validation helpers", () => {
  it("isValidOutcome accepts valid statuses", () => {
    for (const s of ["worked", "partial", "failed", "not_checked"]) {
      assert.ok(isValidOutcome(s), `${s} should be valid`);
    }
  });

  it("isValidOutcome rejects unknown strings", () => {
    assert.ok(!isValidOutcome("success"), "success should be invalid");
    assert.ok(!isValidOutcome(""), "empty string should be invalid");
    assert.ok(!isValidOutcome(null), "null should be invalid");
  });

  it("isValidTarget accepts valid targets", () => {
    for (const t of ["claude_code", "codex", "both"]) {
      assert.ok(isValidTarget(t), `${t} should be valid`);
    }
  });

  it("isValidTarget rejects unknown strings", () => {
    assert.ok(!isValidTarget("gpt"), "gpt should be invalid");
    assert.ok(!isValidTarget(undefined), "undefined should be invalid");
  });
});

// ─── saveOutcome ─────────────────────────────────────────────────────────────

describe("saveOutcome", () => {
  it("saves outcome and returns shape with id", async () => {
    const env = makeEnv();
    const result = await saveOutcome(env, {
      projectId: "proj_test",
      userKey: "uk_abc",
      target: "claude_code",
      selectedItemIds: ["req_001", "req_002"],
      outcome: "worked",
      note: "잘 됐어요",
    });
    assert.ok(result.id.startsWith("bpo_"), "id should have bpo_ prefix");
    assert.equal(result.projectId, "proj_test");
    assert.equal(result.target, "claude_code");
    assert.deepEqual(result.selectedItemIds, ["req_001", "req_002"]);
    assert.equal(result.outcome, "worked");
    assert.equal(result.note, "잘 됐어요");
    assert.ok(result.createdAt, "createdAt should be set");
  });

  it("selectedItemIds are serialized to JSON in DB", async () => {
    const env = makeEnv();
    await saveOutcome(env, {
      projectId: "p1",
      userKey: "uk1",
      target: "codex",
      selectedItemIds: ["a", "b", "c"],
      outcome: "partial",
    });
    const row = env.DB.state.outcomes[0];
    assert.equal(row.selected_item_ids_json, JSON.stringify(["a", "b", "c"]));
  });

  it("note is optional — saves null when not provided", async () => {
    const env = makeEnv();
    const result = await saveOutcome(env, {
      projectId: "p2",
      userKey: "uk2",
      target: "both",
      selectedItemIds: [],
      outcome: "not_checked",
    });
    assert.equal(result.note, undefined);
    assert.equal(env.DB.state.outcomes[0].note, null);
  });
});

// ─── listOutcomes ─────────────────────────────────────────────────────────────

describe("listOutcomes", () => {
  it("returns outcomes for a project", async () => {
    const env = makeEnv();
    await saveOutcome(env, { projectId: "p1", userKey: "uk1", target: "claude_code", selectedItemIds: ["r1"], outcome: "worked" });
    await saveOutcome(env, { projectId: "p1", userKey: "uk1", target: "codex", selectedItemIds: ["r2"], outcome: "failed" });
    await saveOutcome(env, { projectId: "p2", userKey: "uk2", target: "both", selectedItemIds: [], outcome: "partial" });

    const results = await listOutcomes(env, "p1");
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.projectId === "p1"), "should only return p1 outcomes");
  });

  it("deserializes selectedItemIds from JSON", async () => {
    const env = makeEnv();
    await saveOutcome(env, { projectId: "p3", userKey: "uk3", target: "both", selectedItemIds: ["x", "y"], outcome: "worked" });
    const results = await listOutcomes(env, "p3");
    assert.deepEqual(results[0].selectedItemIds, ["x", "y"]);
  });

  it("returns empty array when no outcomes exist", async () => {
    const env = makeEnv();
    const results = await listOutcomes(env, "nonexistent");
    assert.deepEqual(results, []);
  });

  it("respects limit parameter", async () => {
    const env = makeEnv();
    for (let i = 0; i < 5; i++) {
      await saveOutcome(env, { projectId: "p4", userKey: "uk4", target: "both", selectedItemIds: [], outcome: "worked" });
    }
    const results = await listOutcomes(env, "p4", 3);
    assert.equal(results.length, 3);
  });
});
