> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 150 — Claude Code / Terminal Local Smoke

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (Stage 148~153 train, PR #152) · **Base:** `main` @ `481fd72`
**Type:** local terminal stdio smoke. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Provide a terminal-driven smoke that is closer to a real MCP host than Stage 144:
spawn the built server as a real **stdio child process** and drive the MCP protocol
(initialize → tools/list → tools/call) with the SDK client, in Basic-only mode with no
credentials and no network. Produces local dogfood evidence.

## 2. Difference from the Stage 144 smoke
- **Stage 144 (`smoke:basic`)** — in-process: calls the built exports
  (`getMcpToolRegistrationPlan`, `runBasicPreviewTool`) directly. Proves registration +
  dispatch logic.
- **Stage 150 (`smoke:basic:stdio`)** — out-of-process: spawns `dist/index.js` and
  speaks the **actual MCP protocol over stdio** via `@modelcontextprotocol/sdk` `Client`
  + `StdioClientTransport`. Proves a real host can initialize the server, discover the
  tools, and call them with the registered Zod schemas. **Full stdio MCP protocol smoke
  was achieved.**

## 3. Smoke script path
`packages/mcp-workspace/scripts/smoke-basic-stdio.mjs` (script:
`pnpm --filter @conclave-ai/mcp-workspace smoke:basic:stdio`). Exports
`runStdioSmoke()` for the test. `child_process`/stdio is used **only in this dev smoke**
(via the SDK transport) — the product runtime never spawns processes.

## 4. What the smoke verifies
- The built server starts as a child process and **MCP initialize succeeds**.
- **tools/list** returns exactly **9** Basic tools.
- **tools/call** succeeds for `preview_acceptance_map`, `preview_stage_plan`, and
  `create_web_app_handoff_link`, with boundary metadata preserved.
- Connected/risky tools are **absent** in Basic-only mode.
- No central-plane credentials or network are required.

## 5. Basic-only env behavior
The smoke starts from the SDK's safe default child environment
(`getDefaultEnvironment()`) and strips any connected-mode vars
(`CONCLAVE_USER_KEY`, `CONCLAVE_API_BASE_URL`, `CONCLAVE_CENTRAL_PLANE_URL`,
`CONCLAVE_ENABLE_PR_COMMENT_POST`, `CONCLAVE_MCP_ENABLE_POST_COMMENT`,
`MCP_ENABLE_POST_COMMENT`) before spawning, so the server runs Basic-only. No env
values are printed.

## 6. Tool list checks
Asserts **exactly 9** tools, **including** `preview_acceptance_map`,
`preview_stage_plan`, `preview_agent_run_plan`, `preview_evidence_plan`,
`preview_acceptance_graph_summary`, `preview_recurring_blockers`,
`preview_agent_tool_memory`, `preview_template_signals`,
`create_web_app_handoff_link`; and **excluding** `list_projects`, `get_project`,
`list_pull_requests`, `run_pr_review`, `post_pr_comment`.

## 7. Tool call checks
- `preview_acceptance_map` (`{type:"idea", rawInput:<scenario>}`) → `ok:true`,
  `kind:"acceptance_map"`, `requiresPayment/mutatesState/usesHostedExecution:false`.
- `preview_stage_plan` (same input) → `ok:true`, `kind:"stage_plan"`, boundary false.
- `create_web_app_handoff_link` (`{intent:"new_intake", intakeType:"idea",
  title, safeSummary, previewKind:"acceptance_map"}`) → `ok:true`,
  `kind:"web_app_handoff_link"`, `handoff.url` starts with
  `https://app.trysimsa.com/projects/new/intake`,
  `handoff.boundary.requiresPayment:false`, `assumesPaymentProvider:false`.

## 8. Output evidence
`pnpm --filter @conclave-ai/mcp-workspace smoke:basic:stdio` prints (exit 0):
```
MCP Basic stdio smoke passed:
- mode: basic_only
- tools: 9
- initialize: ok
- tools/list: ok
- preview_acceptance_map: ok
- preview_stage_plan: ok
- create_web_app_handoff_link: ok
- network: not required
- credentials: not required
```
Secret-free output (no raw private content, tokens, or credentials).

## 9. Limitations
- This drives the **real MCP protocol over stdio** from a script, which is the same
  transport/initialize/tools handshake a host uses — but it is **not** a GUI host. The
  Claude Desktop app-side confirmation (Stage 149) remains a separate manual check by
  Bae (tool visibility in the app UI, no credential prompt, etc.).
- Spawns via `node dist/index.js` by **local path** — the package stays unpublished
  (no registry install).
- The test does a real process spawn (~1–2s); it is stable because each step is
  awaited and the transport is always closed, but it requires the package to be built
  first (CI builds before tests).

## 10. Stage 150 decision
**Option A — Terminal stdio smoke ready.** Full stdio MCP protocol smoke (initialize +
tools/list + tools/call) passes from terminal and is ready for private dogfood
evidence. No publish.

## 11. Recommended next stage
**Stage 151 — Tool-by-tool Manual QA** (exercise all 9 Basic tools — including the 4
snapshot tools and the malformed-input pass — with recorded expected/actual evidence,
building on the §6 matrix in Stage 148). **Do not merge** the train PR until the Stage
153 checkpoint + Bae approval.
