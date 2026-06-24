// Stage 142 — register read-only MCP Basic preview tools + Basic-only mode.
// Imports the compiled server (dist) so we test exactly what ships.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  buildServer,
  BASIC_TOOL_META,
  BASIC_PREVIEW_TOOL_NAMES,
  runBasicPreviewTool,
  getMcpToolRegistrationPlan,
} = await import("../dist/server.js");

const BASIC_NAMES = [
  "preview_acceptance_map",
  "preview_stage_plan",
  "preview_agent_run_plan",
  "preview_evidence_plan",
  "preview_acceptance_graph_summary",
  "preview_recurring_blockers",
  "preview_agent_tool_memory",
  "preview_template_signals",
];

/** Parse the JSON payload out of a text() envelope. */
function payload(envelope) {
  assert.equal(envelope.content[0].type, "text");
  return JSON.parse(envelope.content[0].text);
}

describe("getMcpToolRegistrationPlan", () => {
  it("Basic-only mode (no userKey) registers exactly the 8 local preview tools", () => {
    const plan = getMcpToolRegistrationPlan({ hasUserKey: false });
    assert.equal(plan.mode, "basic_only");
    assert.deepEqual(plan.basic.sort(), [...BASIC_NAMES].sort());
    assert.deepEqual(plan.connected, []);
    assert.deepEqual(plan.gated, []);
    assert.equal(plan.all.length, 8);
    // No connected/network/gated tool leaks into Basic-only mode.
    assert.ok(!plan.all.includes("run_pr_review"));
    assert.ok(!plan.all.includes("post_pr_comment"));
    assert.ok(!plan.all.includes("list_projects"));
  });

  it("env-backed mode registers Basic + connected tools, no write tool by default", () => {
    const plan = getMcpToolRegistrationPlan({ hasUserKey: true });
    assert.equal(plan.mode, "env_backed");
    assert.equal(plan.basic.length, 8);
    assert.ok(plan.connected.includes("list_projects"));
    assert.ok(plan.connected.includes("run_pr_review"));
    assert.deepEqual(plan.gated, []);
    assert.ok(!plan.all.includes("post_pr_comment"));
  });

  it("post_pr_comment is gated behind userKey AND enablePostComment", () => {
    const off = getMcpToolRegistrationPlan({ hasUserKey: true, enablePostComment: false });
    assert.ok(!off.gated.includes("post_pr_comment"));
    const on = getMcpToolRegistrationPlan({ hasUserKey: true, enablePostComment: true });
    assert.deepEqual(on.gated, ["post_pr_comment"]);
    assert.ok(on.all.includes("post_pr_comment"));
    // enablePostComment without a userKey never exposes the write tool.
    const noKey = getMcpToolRegistrationPlan({ hasUserKey: false, enablePostComment: true });
    assert.deepEqual(noKey.gated, []);
  });
});

describe("BASIC_TOOL_META", () => {
  it("has metadata for every Basic preview tool name", () => {
    for (const name of BASIC_PREVIEW_TOOL_NAMES) {
      assert.ok(BASIC_TOOL_META[name], `missing meta for ${name}`);
      assert.ok(BASIC_TOOL_META[name].title.length > 0);
    }
    assert.equal(Object.keys(BASIC_TOOL_META).length, 8);
  });

  it("descriptions state the free/local boundary and untrusted-input warning", () => {
    for (const [name, meta] of Object.entries(BASIC_TOOL_META)) {
      const d = meta.description;
      assert.match(d, /preview only/i, `${name} should say preview only`);
      assert.match(d, /no payment/i, `${name} should say no payment`);
      assert.match(d, /no network|locally/i, `${name} should say local/no-network`);
      assert.match(d, /no credits/i, `${name} should say no credits`);
      assert.match(d, /no AI\/LLM/i, `${name} should say no AI/LLM`);
      assert.match(d, /untrusted DATA/i, `${name} should warn untrusted data`);
      // Basic tools are local — must NOT claim they read/write through the API.
      assert.ok(!/through Conclave's API/i.test(d), `${name} must not claim API access`);
    }
  });
});

describe("runBasicPreviewTool", () => {
  it("intake tool returns a derived preview with the read-only boundary", () => {
    const r = payload(runBasicPreviewTool("preview_acceptance_map", { type: "idea", rawInput: "A todo app" }));
    assert.equal(r.ok, true);
    assert.equal(r.kind, "acceptance_map");
    assert.equal(r.mutatesState, false);
    assert.equal(r.usesHostedExecution, false);
    assert.equal(r.requiresPayment, false);
    assert.equal(r.derivedPreviewOnly, true);
    assert.ok(r.preview);
  });

  it("each intake tool maps to its expected kind", () => {
    const cases = [
      ["preview_acceptance_map", "acceptance_map"],
      ["preview_stage_plan", "stage_plan"],
      ["preview_agent_run_plan", "agent_run_plan"],
      ["preview_evidence_plan", "evidence_plan"],
    ];
    for (const [name, kind] of cases) {
      const r = payload(runBasicPreviewTool(name, { type: "prd", rawInput: "Build X with auth and billing." }));
      assert.equal(r.ok, true, name);
      assert.equal(r.kind, kind, name);
      assert.equal(r.requiresPayment, false, name);
    }
  });

  it("invalid intake type and empty input return safe error objects (no throw)", () => {
    const bad = payload(runBasicPreviewTool("preview_acceptance_map", { type: "bogus", rawInput: "x" }));
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "invalid_type");
    assert.equal(bad.requiresPayment, false);
    const empty = payload(runBasicPreviewTool("preview_stage_plan", { type: "idea", rawInput: "   " }));
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "missing_input");
  });

  it("snapshot tools accept opaque/empty snapshots and return a preview", () => {
    for (const name of [
      "preview_acceptance_graph_summary",
      "preview_recurring_blockers",
      "preview_agent_tool_memory",
      "preview_template_signals",
    ]) {
      const r = payload(runBasicPreviewTool(name, {}));
      assert.equal(r.ok, true, name);
      assert.equal(r.derivedPreviewOnly, true, name);
      assert.equal(r.requiresPayment, false, name);
      assert.ok(r.preview, name);
    }
  });

  it("unknown tool name returns a safe error envelope", () => {
    const r = payload(runBasicPreviewTool("preview_definitely_not_a_tool", {}));
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown_basic_tool/);
  });

  it("never throws on malformed args; output leaks no userKey/token/payment-provider", () => {
    for (const args of [null, undefined, 7, "x", [], { type: 1 }]) {
      assert.doesNotThrow(() => runBasicPreviewTool("preview_acceptance_map", args));
      assert.doesNotThrow(() => runBasicPreviewTool("preview_template_signals", args));
    }
    const blob = JSON.stringify(
      payload(runBasicPreviewTool("preview_acceptance_map", { type: "idea", rawInput: "hello" })),
    ).toLowerCase();
    assert.ok(!blob.includes("userkey"));
    assert.ok(!blob.includes("uk_"));
    assert.ok(!blob.includes("stripe"));
  });
});

describe("buildServer Basic-only mode", () => {
  it("builds a server with no client (Basic-only) without throwing", () => {
    const server = buildServer({});
    assert.ok(server);
    assert.equal(typeof server.connect, "function");
  });

  it("builds a server with a client (env-backed) without throwing", () => {
    // Methods are only invoked on tool call, not at registration time, so a stub
    // is enough to prove registration of the connected tools does not throw.
    const stub = {
      listProjects: async () => ({ ok: true }),
      getProject: async () => ({ ok: true }),
      listPullRequests: async () => ({ ok: true }),
      runPrReview: async () => ({ ok: true }),
      getReviewHistory: async () => ({ ok: true }),
      getReviewRun: async () => ({ ok: true }),
      createFixInstructions: async () => ({ ok: true }),
      compareRuns: async () => ({ ok: true }),
      previewPrComment: async () => ({ ok: true }),
      postPrComment: async () => ({ ok: true }),
    };
    assert.doesNotThrow(() => buildServer({ client: stub }));
    assert.doesNotThrow(() => buildServer({ client: stub, enablePostComment: true }));
  });
});
