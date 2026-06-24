# Stage 135 — MCP Basic Tool Skeleton

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).

## Goal
Create the skeleton needed for MCP Basic — the shared **`@conclave-ai/workspace-
preview`** package + the **MCP Basic tool registry** — **without** moving helper
logic or wiring tools into the MCP server runtime. No publish.

## Package skeleton — `packages/workspace-preview`
New **internal, unpublished** package (`"private": true`), pure ESM. Auto-
discovered via the existing `pnpm-workspace.yaml` (`packages/*`). Entry points map
directly to `src` `.mjs`/`.d.mts` (no build step — pure helpers).
```text
packages/workspace-preview/
  package.json          # @conclave-ai/workspace-preview, private, type:module
  tsconfig.json         # noEmit, allowJs, validates .d.mts (no dist build)
  src/index.mjs · index.d.mts     # public entry (re-exports safety for now)
  src/safety.mjs · safety.d.mts   # package safety metadata
  test/safety.test.mjs
```
**Hard package rules** (encoded in `safety.mjs` + tests): No React · No Next · No
browser API · No network · No env · No mutation · No hosted execution · No payment
provider · No secrets.

## workspace-preview safety exports (`src/safety.mjs`)
- `WORKSPACE_PREVIEW_PACKAGE` — `{ name, purpose, isPublished:false,
  allowsNetwork:false, allowsMutation:false, allowsHostedExecution:false,
  assumesPaymentProvider:false, paymentProvider:"TBD" }`.
- `WORKSPACE_PREVIEW_SAFETY_RULES` — 8 rules (no React/Next, browser, env, network,
  mutation, hosted execution, payment, secrets).
- `getWorkspacePreviewSafetySummary()` — returns **defensive copies**.

## MCP Basic tool registry skeleton — `packages/mcp-workspace/src/mcp-basic-tools.mjs`
Pure metadata **registry only** — no execution, **no server runtime wiring** (per
Stage 135 rule). `.mjs`+`.d.mts`; the test imports it directly from `../src` (tsc
ignores `.mjs` for the existing dist build, so the PR-review tools are untouched).
- `MCP_BASIC_TOOL_DEFINITIONS` — the **9** approved Basic tools, each
  `{ name, purpose, category: "preview"|"handoff", risk:"low", mutatesState:false,
  requiresPayment:false, usesHostedExecution:false, requiresConfirmation:false,
  webAppGated:false }`.
- `MCP_BASIC_PROHIBITED_VERBS` — leading-action verbs disallowed for Basic
  (run/execute/post/deploy/billing/payment/secret/token/publish/write). Checked
  against the **leading segment** only — nouns like "run" inside `agent_run_plan`
  are fine; `run_pr_review` would be rejected.
- `listMcpBasicToolDefinitions()` / `getMcpBasicToolDefinition(name)` — defensive
  copies; `null` for unknown (incl. the existing `post_pr_comment`).

The 9 tools: `preview_acceptance_map` · `preview_stage_plan` ·
`preview_agent_run_plan` · `preview_evidence_plan` ·
`preview_acceptance_graph_summary` · `preview_recurring_blockers` ·
`preview_agent_tool_memory` · `preview_template_signals` ·
`create_web_app_handoff_link`.

## What is intentionally NOT implemented (Stage 135)
No preview tool logic (helpers not moved yet — Stages 136~138) · no MCP server
runtime wiring of Basic tools · no Web App handoff URL builder (Stage 139) · no
publish / version bump / npm · no payment provider · no hosted execution. The
existing `mcp-workspace` PR-review tools and the gated `post_pr_comment` are
unchanged.

## Safety expectations (enforced by tests)
Every Basic tool: `mutatesState:false`, `requiresPayment:false`,
`usesHostedExecution:false`, `requiresConfirmation:false`, `risk:"low"`. No
prohibited leading verb. No Stripe/billing/payment-provider string anywhere in the
registry or safety metadata.

## Verification
- `@conclave-ai/workspace-preview`: **7/7** tests · typecheck clean.
- `@conclave-ai/mcp-workspace`: **22/22** tests (existing 14 + new 8) · typecheck
  clean (build unaffected; `.mjs` registry ignored by the dist build).
- Monorepo `turbo run typecheck`: **57/57** (+1 = workspace-preview).
- `apps/dashboard`: **386/386** (unchanged, untouched).
- No new external dependencies.

## Next stage
Stage 136 — MCP Preview Tool: Acceptance Map / Stage Plan / Agent Run Plan (begin
moving Class A helpers into `workspace-preview` and wrap them as MCP tools).
