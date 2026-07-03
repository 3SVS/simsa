#!/usr/bin/env node
// Stage 144 — MCP Basic local smoke harness.
//
// Proves the built server can run MCP Basic WITHOUT any credentials or network:
// the 9 free Basic tools register, connected/network tools do not, and the
// preview + handoff dispatch return safe, boundary-preserving results. Local-only:
// no central-plane call, no env required, nothing published or deployed.
//
// Exposes runBasicSmoke() for tests; runs + prints a short, secret-free summary
// when invoked directly (`pnpm --filter @simsa/mcp-workspace smoke:basic`).
import { getMcpToolRegistrationPlan, runBasicPreviewTool } from "../dist/server.js";

const BASIC_TOOLS = [
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
const MUST_BE_ABSENT = ["list_projects", "get_project", "list_pull_requests", "run_pr_review", "post_pr_comment"];
// Env that real (connected) mode reads — cleared so the smoke proves Basic-only
// works with no credentials/config present.
const CLEARED_ENV = [
  "CONCLAVE_USER_KEY",
  "CONCLAVE_API_BASE_URL",
  "CONCLAVE_CENTRAL_PLANE_URL",
  "CONCLAVE_ENABLE_PR_COMMENT_POST",
  "CONCLAVE_MCP_ENABLE_POST_COMMENT",
];

function payload(envelope) {
  return JSON.parse(envelope.content[0].text);
}

/**
 * Run the local registration + dispatch smoke. Returns a structured result; never
 * throws. Clears credential/config env during the run and restores it afterward,
 * so importing this module in tests has no side effects.
 */
export function runBasicSmoke() {
  const saved = {};
  for (const k of CLEARED_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  const failures = [];
  const check = (name, cond) => {
    if (!cond) failures.push(name);
  };

  try {
    // Registration plan as a Basic-only (no userKey) host would see it.
    const plan = getMcpToolRegistrationPlan({ hasUserKey: false });
    check("mode is basic_only", plan.mode === "basic_only");
    check("exactly 9 Basic tools", plan.basic.length === 9 && plan.all.length === 9);
    for (const t of BASIC_TOOLS) check(`Basic tool present: ${t}`, plan.all.includes(t));
    for (const t of MUST_BE_ABSENT) check(`connected/gated tool absent: ${t}`, !plan.all.includes(t));

    // Preview dispatch.
    const preview = payload(runBasicPreviewTool("preview_acceptance_map", { type: "idea", rawInput: "A simple todo app" }));
    check("preview_acceptance_map ok", preview.ok === true);
    check("preview boundary.requiresPayment false", preview.requiresPayment === false);
    check("preview boundary.mutatesState false", preview.mutatesState === false);

    // Handoff dispatch.
    const handoff = payload(runBasicPreviewTool("create_web_app_handoff_link", { intent: "save_workflow", title: "Smoke app" }));
    const url = handoff.handoff?.url ?? "";
    check("create_web_app_handoff_link ok", handoff.ok === true);
    check("handoff url is app.trysimsa.com intake", url.startsWith("https://app.trysimsa.com/projects/new/intake"));
    check("handoff boundary.requiresPayment false", handoff.handoff?.boundary?.requiresPayment === false);
    check("handoff boundary.assumesPaymentProvider false", handoff.handoff?.boundary?.assumesPaymentProvider === false);

    // Malformed input must not crash.
    let crashed = false;
    for (const bad of [null, undefined, 7, "x", [], { type: 1 }]) {
      try {
        runBasicPreviewTool("preview_acceptance_map", bad);
        runBasicPreviewTool("create_web_app_handoff_link", bad);
      } catch {
        crashed = true;
      }
    }
    check("malformed input does not crash", !crashed);

    return {
      ok: failures.length === 0,
      mode: plan.mode,
      toolCount: plan.all.length,
      previewOk: preview.ok === true,
      handoffOk: handoff.ok === true,
      networkRequired: false,
      credentialsRequired: false,
      failures,
    };
  } catch (err) {
    return {
      ok: false,
      mode: "unknown",
      toolCount: 0,
      previewOk: false,
      handoffOk: false,
      networkRequired: false,
      credentialsRequired: false,
      failures: [...failures, `threw: ${err instanceof Error ? err.message : String(err)}`],
    };
  } finally {
    for (const k of CLEARED_ENV) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  }
}

function printResult(r) {
  if (r.ok) {
    process.stdout.write(
      [
        "MCP Basic smoke passed:",
        `- mode: ${r.mode}`,
        `- tools: ${r.toolCount}`,
        "- preview_acceptance_map: ok",
        "- create_web_app_handoff_link: ok",
        "- network: not required",
        "- credentials: not required",
        "",
      ].join("\n"),
    );
  } else {
    process.stdout.write(
      ["MCP Basic smoke FAILED:", ...r.failures.map((f) => `- ${f}`), ""].join("\n"),
    );
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || (process.argv[1]?.endsWith("smoke-basic.mjs") ?? false);
if (isMain) {
  const result = runBasicSmoke();
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
}
