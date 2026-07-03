#!/usr/bin/env node
// Stage 149 — print a Claude Desktop (or any MCP host) local config for Simsa MCP
// Basic, with the absolute path to the built server resolved for THIS checkout.
//
// Local-only and read-only: it resolves a path, checks the build exists, and prints
// JSON to stdout. It does NOT modify any Claude Desktop config file, does NOT include
// credentials (env is empty for Basic-only mode), and makes no network call.
//
// Exposes buildClaudeDesktopBasicConfig() for tests; prints when run directly
// (`pnpm --filter @simsa/mcp-workspace print:claude-desktop-basic-config`).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // packages/mcp-workspace/scripts
const packageRoot = dirname(here); // packages/mcp-workspace

/** Absolute path to the built entry point for this checkout. */
export function resolveServerEntry() {
  return resolve(join(packageRoot, "dist", "index.js"));
}

/**
 * Build the Basic-only MCP host config object. `env` is intentionally empty —
 * Basic-only mode needs no credentials. Throws (with a clear message) if the build
 * is missing, so the operator runs the build first.
 */
export function buildClaudeDesktopBasicConfig({ requireBuilt = true } = {}) {
  const entry = resolveServerEntry();
  if (requireBuilt && !existsSync(entry)) {
    throw new Error(
      `dist/index.js not found at ${entry}. Run: pnpm --filter @simsa/mcp-workspace build`,
    );
  }
  return {
    mcpServers: {
      // User-facing display/config entry name (Claude Desktop shows this). Only the
      // local server entry name is branded; internal package names are unchanged.
      "Simsa-Basic": {
        command: "node",
        args: [entry],
        env: {},
      },
    },
  };
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1]?.endsWith("print-claude-desktop-basic-config.mjs") ?? false);
if (isMain) {
  try {
    const config = buildClaudeDesktopBasicConfig();
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
