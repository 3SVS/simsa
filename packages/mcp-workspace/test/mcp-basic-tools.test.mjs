// Stage 135 — MCP Basic tool registry tests. Pure metadata; no runtime wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MCP_BASIC_TOOL_DEFINITIONS,
  MCP_BASIC_PROHIBITED_VERBS,
  listMcpBasicToolDefinitions,
  getMcpBasicToolDefinition,
} from "../src/mcp-basic-tools.mjs";

const EXPECTED = [
  "preview_acceptance_map",
  "preview_stage_plan",
  "preview_agent_run_plan",
  "preview_evidence_plan",
  "preview_acceptance_graph_summary",
  "preview_recurring_blockers",
  "preview_agent_tool_memory",
  "preview_template_signals",
  "create_web_app_handoff_link",
];

test("registry includes exactly the 9 approved Basic tool names", () => {
  const names = MCP_BASIC_TOOL_DEFINITIONS.map((t) => t.name);
  assert.deepEqual([...names].sort(), [...EXPECTED].sort());
  assert.equal(names.length, 9);
  assert.equal(new Set(names).size, 9);
});

test("all tools are preview or handoff", () => {
  for (const t of MCP_BASIC_TOOL_DEFINITIONS) {
    assert.ok(["preview", "handoff"].includes(t.category), `bad category ${t.category}`);
  }
});

test("all tools are low risk, mutation-free, payment-free, no hosted execution, no confirm, not web-app-gated", () => {
  for (const t of MCP_BASIC_TOOL_DEFINITIONS) {
    assert.equal(t.risk, "low", t.name);
    assert.equal(t.mutatesState, false, t.name);
    assert.equal(t.requiresPayment, false, t.name);
    assert.equal(t.usesHostedExecution, false, t.name);
    assert.equal(t.requiresConfirmation, false, t.name);
    assert.equal(t.webAppGated, false, t.name);
  }
});

test("no prohibited action verb leads any Basic tool name", () => {
  // The leading segment is the action verb; nouns like "run" inside
  // "agent_run_plan" are allowed. A tool like "run_pr_review" would be rejected.
  for (const t of MCP_BASIC_TOOL_DEFINITIONS) {
    const leadVerb = t.name.split("_")[0];
    assert.ok(
      !MCP_BASIC_PROHIBITED_VERBS.includes(leadVerb),
      `tool "${t.name}" must not lead with prohibited verb "${leadVerb}"`,
    );
    assert.ok(["preview", "create"].includes(leadVerb), `unexpected lead verb "${leadVerb}"`);
  }
});

test("every tool has a non-empty purpose", () => {
  for (const t of MCP_BASIC_TOOL_DEFINITIONS) {
    assert.ok(typeof t.purpose === "string" && t.purpose.length > 0, t.name);
  }
});

test("getMcpBasicToolDefinition returns item or null", () => {
  assert.equal(getMcpBasicToolDefinition("preview_stage_plan")?.name, "preview_stage_plan");
  assert.equal(getMcpBasicToolDefinition("nope"), null);
  assert.equal(getMcpBasicToolDefinition("post_pr_comment"), null);
});

test("listMcpBasicToolDefinitions returns defensive copies", () => {
  const list = listMcpBasicToolDefinitions();
  list[0].name = "MUTATED";
  assert.notEqual(MCP_BASIC_TOOL_DEFINITIONS[0].name, "MUTATED");
});

test("no Stripe/payment-provider assumption in registry", () => {
  const blob = JSON.stringify(MCP_BASIC_TOOL_DEFINITIONS).toLowerCase();
  assert.ok(!blob.includes("stripe"));
  assert.ok(!blob.includes("billing"));
});
