#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WorkspaceClient, stderrAudit } from "./client.js";
import { buildServer } from "./server.js";

export { WorkspaceClient, stderrAudit } from "./client.js";
export {
  buildServer,
  TOOL_META,
  BASIC_TOOL_META,
  BASIC_PREVIEW_TOOL_NAMES,
  runBasicPreviewTool,
  getMcpToolRegistrationPlan,
} from "./server.js";
export type { ServerOptions } from "./server.js";

const DEFAULT_BASE_URL = "https://conclave-ai.seunghunbae.workers.dev";

const HELP = `conclave-mcp-workspace — Conclave acceptance/PR-review workflow as MCP tools (stdio)

Configure via environment, then launch from an MCP client (Claude Code, Cursor, …):

  CONCLAVE_USER_KEY               (required) your workspace user key (uk_…)
  CONCLAVE_API_BASE_URL           (optional) central-plane URL; default ${DEFAULT_BASE_URL}
  CONCLAVE_ENABLE_PR_COMMENT_POST (optional) "true" to expose the write tool
                                  post_pr_comment (disabled by default)
  CONCLAVE_AUDIT_LOG              (optional) "false" to silence the stderr audit log

Example MCP client config:
  {
    "mcpServers": {
      "conclave-workspace": {
        "command": "conclave-mcp-workspace",
        "env": { "CONCLAVE_USER_KEY": "uk_..." }
      }
    }
  }

Never put a raw GitHub token here — Conclave uses your connected GitHub account
through central-plane; the token never leaves central-plane.
`;

function envFlag(...names: string[]): boolean {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined) return v.trim().toLowerCase() === "true";
  }
  return false;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  const userKey = process.env.CONCLAVE_USER_KEY?.trim();
  const transport = new StdioServerTransport();

  // Basic-only mode: no CONCLAVE_USER_KEY → start anyway, exposing only the free
  // local preview tools. No client is built, so no connected/network/gated tool
  // is registered. This is NOT a fatal error.
  if (!userKey) {
    const server = buildServer({});
    await server.connect(transport);
    process.stderr.write(
      "conclave-mcp-workspace: ready on stdio in Basic-only mode " +
        "(no CONCLAVE_USER_KEY — local preview tools only; set CONCLAVE_USER_KEY to enable connected tools).\n",
    );
    return;
  }

  // Accept the documented names, with back-compat aliases from Stage 61.
  const baseUrl =
    process.env.CONCLAVE_API_BASE_URL?.trim() ||
    process.env.CONCLAVE_CENTRAL_PLANE_URL?.trim() ||
    DEFAULT_BASE_URL;
  const enablePostComment = envFlag("CONCLAVE_ENABLE_PR_COMMENT_POST", "CONCLAVE_MCP_ENABLE_POST_COMMENT");
  const auditOff = (process.env.CONCLAVE_AUDIT_LOG ?? "").trim().toLowerCase() === "false";

  const client = new WorkspaceClient({ baseUrl, userKey, audit: auditOff ? () => {} : stderrAudit });
  const server = buildServer({ client, enablePostComment });
  await server.connect(transport);
  process.stderr.write(
    `conclave-mcp-workspace: ready on stdio (base=${baseUrl}, post_pr_comment=${enablePostComment ? "on" : "off"})\n`,
  );
}

// Run when invoked as a binary (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.js");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`conclave-mcp-workspace: fatal ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
