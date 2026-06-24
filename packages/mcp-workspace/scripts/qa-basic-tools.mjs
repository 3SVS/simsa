#!/usr/bin/env node
// Stage 151 — tool-by-tool manual QA for all 9 Simsa MCP Basic tools.
//
// Reuses the real stdio MCP protocol path (Stage 150): spawns the built server and
// drives initialize -> tools/call for every Basic tool with safe synthetic fixtures,
// chaining the 4 intake previews into the 4 snapshot tools, then the handoff tool.
// Also checks malformed input (no crash) and sensitive-field omission. Basic-only,
// no credentials, no network. Prints a short, secret-free per-tool summary.
//
// child_process/stdio is used HERE (a dev QA harness) only — product runtime never
// spawns processes. Exposes runBasicToolsQa() for tests.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER_ENTRY = resolve(join(packageRoot, "dist", "index.js"));

const CLEARED_ENV = [
  "CONCLAVE_USER_KEY",
  "CONCLAVE_API_BASE_URL",
  "CONCLAVE_CENTRAL_PLANE_URL",
  "CONCLAVE_ENABLE_PR_COMMENT_POST",
  "CONCLAVE_MCP_ENABLE_POST_COMMENT",
  "MCP_ENABLE_POST_COMMENT",
];

const SCENARIO =
  "Build a small landing page for an AI software review tool. It should explain the product, show three use cases, and include a request-access form.";

const EXPECTED_KINDS = {
  preview_acceptance_map: "acceptance_map",
  preview_stage_plan: "stage_plan",
  preview_agent_run_plan: "agent_run_plan",
  preview_evidence_plan: "evidence_plan",
  preview_acceptance_graph_summary: "acceptance_graph_summary",
  preview_recurring_blockers: "recurring_blockers",
  preview_agent_tool_memory: "agent_tool_memory",
  preview_template_signals: "template_signals",
  create_web_app_handoff_link: "web_app_handoff_link",
};

// Built at runtime so no literal token-like string lives in source (keeps the
// secret scanner clean). These are obviously fake, for omission testing only.
const FAKE_SECRET_TITLE = "sk-" + "FAKEPLACEHOLDERFORTESTONLY";
const FAKE_SECRET_SUMMARY = "token" + "=" + "FAKEPLACEHOLDERFORTESTONLY";

function payloadOf(callResult) {
  const block = callResult?.content?.find((c) => c.type === "text");
  return JSON.parse(block.text);
}

function boundaryOk(p) {
  return (
    p &&
    p.mutatesState === false &&
    p.usesHostedExecution === false &&
    p.requiresPayment === false &&
    p.derivedPreviewOnly === true
  );
}

export async function runBasicToolsQa() {
  const failures = [];
  const results = {};
  const check = (name, cond) => {
    if (!cond) failures.push(name);
    return cond;
  };

  if (!existsSync(SERVER_ENTRY)) {
    return { ok: false, toolsTested: 0, results, failures: [`dist/index.js not found at ${SERVER_ENTRY}; build first`] };
  }

  const env = { ...getDefaultEnvironment() };
  for (const k of CLEARED_ENV) delete env[k];

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY], env, stderr: "ignore" });
  const client = new Client({ name: "simsa-basic-qa", version: "0.0.0" }, { capabilities: {} });

  let malformedPass = false;
  let sensitiveOmitPass = false;
  try {
    await client.connect(transport);

    const call = async (name, args) => payloadOf(await client.callTool({ name, arguments: args }));
    const assertTool = (name, p) => {
      const ok = p.ok === true && p.kind === EXPECTED_KINDS[name] && boundaryOk(p);
      results[name] = ok ? "pass" : "fail";
      check(`${name} ok+kind+boundary`, ok);
      return p;
    };

    // 1-4: intake tools.
    const am = assertTool("preview_acceptance_map", await call("preview_acceptance_map", { type: "idea", rawInput: SCENARIO }));
    const sp = assertTool("preview_stage_plan", await call("preview_stage_plan", { type: "idea", rawInput: SCENARIO }));
    const arp = assertTool("preview_agent_run_plan", await call("preview_agent_run_plan", { type: "idea", rawInput: SCENARIO }));
    const ep = assertTool("preview_evidence_plan", await call("preview_evidence_plan", { type: "idea", rawInput: SCENARIO }));

    // 5-8: snapshot tools, chained from the intake previews (realistic input).
    const baseSnapshot = {
      title: "AI software review landing page",
      sourceSummary: "MCP Basic tool-by-tool QA",
      acceptanceMap: am.preview,
      stagePlan: sp.preview,
      agentRunPlan: arp.preview,
      evidencePlan: ep.preview,
    };
    const graph = assertTool("preview_acceptance_graph_summary", await call("preview_acceptance_graph_summary", baseSnapshot));
    const blockers = assertTool(
      "preview_recurring_blockers",
      await call("preview_recurring_blockers", { ...baseSnapshot, acceptanceGraphView: graph.preview }),
    );
    const memory = assertTool(
      "preview_agent_tool_memory",
      await call("preview_agent_tool_memory", {
        title: baseSnapshot.title,
        sourceSummary: baseSnapshot.sourceSummary,
        agentRunPlan: arp.preview,
        evidencePlan: ep.preview,
        recurringBlockerDetectionView: blockers.preview,
      }),
    );
    assertTool(
      "preview_template_signals",
      await call("preview_template_signals", {
        title: baseSnapshot.title,
        sourceSummary: baseSnapshot.sourceSummary,
        acceptanceGraphView: graph.preview,
        recurringBlockerDetectionView: blockers.preview,
        agentToolMemoryView: memory.preview,
        evidencePlan: ep.preview,
        stagePlan: sp.preview,
      }),
    );

    // 9: handoff.
    const handoff = assertTool(
      "create_web_app_handoff_link",
      await call("create_web_app_handoff_link", {
        intent: "new_intake",
        intakeType: "idea",
        title: "AI software review landing page",
        safeSummary: "Landing page preview from MCP Basic",
        previewKind: "template_signals",
      }),
    );
    const hb = handoff.handoff?.boundary ?? {};
    check(
      "handoff url + boundary",
      (handoff.handoff?.url ?? "").startsWith("https://app.trysimsa.com/projects/new/intake") &&
        hb.containsRawPrivateContent === false &&
        hb.containsSecrets === false &&
        hb.createsPersistence === false &&
        hb.requiresPayment === false &&
        hb.assumesPaymentProvider === false,
    );

    // Malformed / weak input: must not crash (call resolves with a safe object).
    const empty = await call("preview_acceptance_map", { type: "idea", rawInput: "" });
    const badType = await call("preview_stage_plan", { type: "definitely_not_a_type", rawInput: SCENARIO });
    const emptySnap = await call("preview_template_signals", {});
    malformedPass =
      empty.ok === false &&
      empty.error === "missing_input" &&
      badType.ok === false &&
      badType.error === "invalid_type" &&
      emptySnap.ok === true;
    check("malformed input safe (no crash)", malformedPass);

    // Sensitive omission: fake secret-like title/summary must be omitted + warned.
    const sens = await call("create_web_app_handoff_link", { title: FAKE_SECRET_TITLE, safeSummary: FAKE_SECRET_SUMMARY });
    const omitted = sens.handoff?.omittedFields ?? [];
    const queryBlob = JSON.stringify(sens.handoff?.query ?? {});
    sensitiveOmitPass =
      omitted.includes("title") &&
      omitted.includes("safeSummary") &&
      (sens.handoff?.warnings?.length ?? 0) >= 1 &&
      !/sk-|token=/i.test(queryBlob);
    check("sensitive fields omitted", sensitiveOmitPass);
  } catch (err) {
    failures.push(`threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
  }

  return {
    ok: failures.length === 0,
    toolsTested: Object.keys(EXPECTED_KINDS).length,
    results,
    malformedPass,
    sensitiveOmitPass,
    networkRequired: false,
    credentialsRequired: false,
    failures,
  };
}

function printResult(r) {
  if (r.ok) {
    const lines = ["MCP Basic tool-by-tool QA passed:", `- tools tested: ${r.toolsTested}`];
    for (const name of Object.keys(EXPECTED_KINDS)) lines.push(`- ${name}: ${r.results[name] ?? "n/a"}`);
    lines.push("- malformed input: pass", "- sensitive omission: pass", "- credentials: not required", "- network: not required", "");
    process.stdout.write(lines.join("\n"));
  } else {
    process.stdout.write(["MCP Basic tool-by-tool QA FAILED:", ...r.failures.map((f) => `- ${f}`), ""].join("\n"));
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || (process.argv[1]?.endsWith("qa-basic-tools.mjs") ?? false);
if (isMain) {
  runBasicToolsQa().then((result) => {
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  });
}
