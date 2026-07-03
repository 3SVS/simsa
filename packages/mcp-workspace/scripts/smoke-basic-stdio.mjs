#!/usr/bin/env node
// Stage 150 — terminal stdio MCP smoke for Simsa MCP Basic.
//
// Unlike Stage 144 (which calls the built exports in-process), this spawns the built
// server as a real child process and talks the MCP protocol over stdio with the SDK
// client: initialize -> tools/list -> tools/call. It runs in Basic-only mode with
// connected-mode env cleared, so it needs no credentials and no network.
//
// child_process/stdio is used HERE (a dev smoke) only — product runtime never spawns
// processes. Exposes runStdioSmoke() for tests; prints a short, secret-free summary
// when run directly (`pnpm --filter @simsa/mcp-workspace smoke:basic:stdio`).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER_ENTRY = resolve(join(packageRoot, "dist", "index.js"));

const EXPECTED_BASIC = [
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
// Connected-mode env removed so the spawned server runs Basic-only.
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

function payloadOf(callResult) {
  const block = callResult?.content?.find((c) => c.type === "text");
  return JSON.parse(block.text);
}

/**
 * Run the real stdio MCP smoke. Returns a structured result; never throws (errors are
 * captured into failures). Always closes the transport / child process.
 */
export async function runStdioSmoke() {
  const failures = [];
  const check = (name, cond) => {
    if (!cond) failures.push(name);
  };

  if (!existsSync(SERVER_ENTRY)) {
    return {
      ok: false,
      mode: "unknown",
      toolCount: 0,
      initialize: false,
      listed: false,
      failures: [`dist/index.js not found at ${SERVER_ENTRY}; run build first`],
    };
  }

  // Start from the SDK's safe default env and strip any connected-mode vars.
  const env = { ...getDefaultEnvironment() };
  for (const k of CLEARED_ENV) delete env[k];

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "simsa-basic-stdio-smoke", version: "0.0.0" }, { capabilities: {} });

  let initialize = false;
  let listed = false;
  let toolCount = 0;
  const calls = {};
  try {
    await client.connect(transport); // performs MCP initialize
    initialize = true;

    const { tools } = await client.listTools();
    listed = true;
    const names = tools.map((t) => t.name);
    toolCount = names.length;
    check("exactly 9 tools", names.length === 9);
    for (const t of EXPECTED_BASIC) check(`tool present: ${t}`, names.includes(t));
    for (const t of MUST_BE_ABSENT) check(`tool absent: ${t}`, !names.includes(t));

    // preview_acceptance_map
    const am = payloadOf(await client.callTool({ name: "preview_acceptance_map", arguments: { type: "idea", rawInput: SCENARIO } }));
    calls.preview_acceptance_map = am.ok === true && am.kind === "acceptance_map";
    check("preview_acceptance_map ok", am.ok === true && am.kind === "acceptance_map");
    check("preview_acceptance_map boundary", am.requiresPayment === false && am.mutatesState === false && am.usesHostedExecution === false);

    // preview_stage_plan
    const sp = payloadOf(await client.callTool({ name: "preview_stage_plan", arguments: { type: "idea", rawInput: SCENARIO } }));
    calls.preview_stage_plan = sp.ok === true && sp.kind === "stage_plan";
    check("preview_stage_plan ok", sp.ok === true && sp.kind === "stage_plan");
    check("preview_stage_plan boundary", sp.requiresPayment === false && sp.mutatesState === false && sp.usesHostedExecution === false);

    // create_web_app_handoff_link
    const hl = payloadOf(
      await client.callTool({
        name: "create_web_app_handoff_link",
        arguments: {
          intent: "new_intake",
          intakeType: "idea",
          title: "AI software review landing page",
          safeSummary: "Landing page preview from MCP Basic",
          previewKind: "acceptance_map",
        },
      }),
    );
    calls.create_web_app_handoff_link = hl.ok === true && hl.kind === "web_app_handoff_link";
    check("create_web_app_handoff_link ok", hl.ok === true && hl.kind === "web_app_handoff_link");
    check("handoff url is app.trysimsa.com intake", (hl.handoff?.url ?? "").startsWith("https://app.trysimsa.com/projects/new/intake"));
    check("handoff boundary", hl.handoff?.boundary?.requiresPayment === false && hl.handoff?.boundary?.assumesPaymentProvider === false);
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
    ok: failures.length === 0 && initialize && listed,
    mode: "basic_only",
    toolCount,
    initialize,
    listed,
    calls,
    networkRequired: false,
    credentialsRequired: false,
    failures,
  };
}

function printResult(r) {
  if (r.ok) {
    process.stdout.write(
      [
        "MCP Basic stdio smoke passed:",
        `- mode: ${r.mode}`,
        `- tools: ${r.toolCount}`,
        "- initialize: ok",
        "- tools/list: ok",
        "- preview_acceptance_map: ok",
        "- preview_stage_plan: ok",
        "- create_web_app_handoff_link: ok",
        "- network: not required",
        "- credentials: not required",
        "",
      ].join("\n"),
    );
  } else {
    process.stdout.write(["MCP Basic stdio smoke FAILED:", ...r.failures.map((f) => `- ${f}`), ""].join("\n"));
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || (process.argv[1]?.endsWith("smoke-basic-stdio.mjs") ?? false);
if (isMain) {
  runStdioSmoke().then((result) => {
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
  });
}
