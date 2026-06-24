# Stage 142 — Register Read-only Preview Tools in MCP Server

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (Stage 141~147 train, PR #151) · **Base:** `main` @ `e3d6fa4`
**Type:** runtime wiring (MCP server). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane endpoint, no migration, no deploy, no auth/login, no token/secret output.**

Registers the **8 read-only MCP Basic preview tools** in the MCP server runtime and
introduces a **backward-compatible Basic-only mode**. The Stage 139 Web App handoff
tool is intentionally left for Stage 143. The existing connected/gated tools and the
with-`CONCLAVE_USER_KEY` startup path are unchanged.

## 1. What changed

### `packages/mcp-workspace/src/server.ts`
- Imports the 8 pure wrappers from `./mcp-basic-preview-tools.mjs`.
- New `BASIC_TOOL_META` (separate from `TOOL_META`): titles + descriptions for the
  free local tools. A dedicated `BASIC_SAFETY` suffix states the boundary at
  tool-selection time — *preview only · no network/central-plane · no credits · no
  AI/LLM · no mutation · no GitHub write · no hosted execution · no payment* — and
  keeps the **untrusted-DATA** injection warning. (Kept out of `TOOL_META` because
  those connected tools legitimately claim "reads/writes through Conclave's API",
  which is false for local previews.)
- Zod schemas: intake tools use `{ type: z.string().default("idea"), rawInput:
  z.string().default("") }`; snapshot tools use `z.string().optional()` for
  `workflowRecordId/title/sourceSummary` and `z.unknown().optional()` for every
  snapshot field (the wrappers are fully defensive).
- `runBasicPreviewTool(name, args)` — single dispatch path shared by the registered
  handlers **and** the tests, returning the standard `text()` envelope; unknown
  names yield a safe error envelope (never throws).
- `registerBasicPreviewTools(server)` — registers all 8 tools; called
  **unconditionally** at the top of `buildServer` (they need no client/env/network).
- `getMcpToolRegistrationPlan({ hasUserKey, enablePostComment })` — pure, exported
  registration plan: `basic_only` mode lists only the 8 local tools; `env_backed`
  mode adds the 9 connected tools, plus `post_pr_comment` only when
  `enablePostComment` **and** a userKey are present.
- `ServerOptions.client` is now **optional**. `buildServer` registers Basic tools,
  then `if (!client) return server;` — so without a client only the local preview
  tools exist; with a client all connected tools (and the gated write tool when
  enabled) register exactly as before.

### `packages/mcp-workspace/src/index.ts`
- **Basic-only mode:** when `CONCLAVE_USER_KEY` is missing the server **no longer
  exits**. It builds `buildServer({})` (no client), connects stdio, and logs a
  clear *"ready … in Basic-only mode"* notice to stderr. With a userKey the path is
  byte-for-byte the same as before (client + `enablePostComment` + full tool set).
- Re-exports the new `BASIC_TOOL_META`, `BASIC_PREVIEW_TOOL_NAMES`,
  `runBasicPreviewTool`, `getMcpToolRegistrationPlan`.

### Build (dist) wiring
- `tsc` does not emit `.mjs` files, so `dist/server.js`'s
  `import … from "./mcp-basic-preview-tools.mjs"` would 404 at runtime. New
  `scripts/copy-basic-tools.mjs` copies the Basic `.mjs` + `.d.mts` into `dist`
  (mirrors `packages/core/scripts/copy-seeds.mjs`); `build` now runs
  `tsc … && node scripts/copy-basic-tools.mjs`. Verified: `dist/` contains the
  wrappers and `dist/server.js` keeps the `.mjs` specifier; the full runtime import
  chain (`dist/server.js → dist/mcp-basic-preview-tools.mjs →
  @conclave-ai/workspace-preview`) resolves.

## 2. The 8 registered tools (read-only, free, local)
`preview_acceptance_map`, `preview_stage_plan`, `preview_agent_run_plan`,
`preview_evidence_plan` (intake → `{type, rawInput}`), and
`preview_acceptance_graph_summary`, `preview_recurring_blockers`,
`preview_agent_tool_memory`, `preview_template_signals` (snapshot-based). Each
returns `{ ok, kind, preview, mutatesState:false, usesHostedExecution:false,
requiresPayment:false, derivedPreviewOnly:true }`.

**Not registered here:** `create_web_app_handoff_link` (Stage 143);
`run_pr_review` / `post_pr_comment` / all other connected tools stay gated behind a
userKey (and `post_pr_comment` additionally behind `enablePostComment` +
`confirm:true`).

## 3. Boundary preserved
- Basic tools: no network, no `process.env`, no mutation, no credits, no AI, no
  payment, no payment-provider assumption — pure local previews.
- Connected tools: registered only when a `WorkspaceClient` (userKey) is present.
- Gated write tool: unchanged (`enablePostComment` + `confirm:true`).
- No new high-risk capability (deploy/billing/secret/shell/repo-write/publish).

## 4. Verification
- `packages/mcp-workspace`: **58/58** tests pass (was 45; +13 in the new
  `test/server-basic-mode.test.mjs`). Covers the registration plan (both modes +
  write-tool gating), `BASIC_TOOL_META` wording, dispatcher kinds + safe errors +
  no-throw on malformed args + no userKey/token/payment-provider leak, and
  `buildServer({})` / `buildServer({client})` not throwing.
- `@conclave-ai/mcp-workspace` typecheck ✓. Full monorepo typecheck **57/57** ✓.
- `@conclave-ai/workspace-preview` **186/186** tests pass (unchanged).
- Runtime smoke: `buildServer({})` ok; Basic-only plan = 8 tools; env-backed plan =
  18 tools incl. `post_pr_comment`; dispatch of `preview_acceptance_map` returns
  `ok:true, kind:acceptance_map, requiresPayment:false`.

## 5. Not done (by design / deferred)
No `npm publish`, no MCP publish, no version bump (`@conclave-ai/workspace-preview`
stays private; `@conclave-ai/mcp-workspace` stays `0.8.2`, unpublished). No payment
work, no Stripe or payment-provider assumption (provider remains **TBD**,
Korea-compatible first). No hosted execution, no central-plane endpoint, no DB
migration, no deploy, no auth/login, no domain/DNS, no token/secret output.

## 6. Recommended next stage
**Stage 143 — Register Web App Handoff Tool** (`create_web_app_handoff_link`), then
Stage 144 local smoke harness, 145 docs/install guide, 146/147 checkpoint
(`npm pack --dry-run` only). **Do not merge PR #151** until the Stage 147 checkpoint
+ Bae approval.
