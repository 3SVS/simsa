> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 151 — Tool-by-tool Manual QA

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (Stage 148~153 train, PR #152) · **Base:** `main` @ `481fd72`
**Type:** QA evidence (terminal stdio). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Exercise **all 9** Simsa MCP Basic tools end-to-end over the real stdio MCP path,
verify expected `kind` + safety boundary for each, chain the 4 intake previews into the
4 snapshot tools, and confirm malformed input doesn't crash and the handoff omits
sensitive-looking fields — all Basic-only, no credentials, no network.

## 2. QA method
`packages/mcp-workspace/scripts/qa-basic-tools.mjs` (script: `qa:basic-tools`,
exports `runBasicToolsQa()`) reuses the **Stage 150 real stdio path**: spawns
`dist/index.js` via the SDK `Client` + `StdioClientTransport` with connected-mode env
stripped, then `initialize` + `tools/call` for every Basic tool. `child_process`/stdio
is used in this **dev QA harness only** — product runtime never spawns processes.
Tested by `test/qa-basic-tools.test.mjs` (real spawn, 30s timeout, asserts exit-0
equivalent: `ok:true`, all 9 pass, malformed + sensitive checks pass).

## 3. Fixture
One safe synthetic product idea (no private data):
> Build a small landing page for an AI software review tool. It should explain the
> product, show three use cases, and include a request-access form.

## 4. Tool-by-tool results matrix
| Tool | Expected kind | Input type | Result | Boundary verified | Notes |
|------|---------------|-----------|--------|-------------------|-------|
| `preview_acceptance_map` | `acceptance_map` | intake `{type:"idea", rawInput}` | **pass** | ✓ | mutates/hosted/payment false, derivedPreviewOnly true |
| `preview_stage_plan` | `stage_plan` | intake | **pass** | ✓ | |
| `preview_agent_run_plan` | `agent_run_plan` | intake | **pass** | ✓ | does not run agents |
| `preview_evidence_plan` | `evidence_plan` | intake | **pass** | ✓ | |
| `preview_acceptance_graph_summary` | `acceptance_graph_summary` | snapshot (chained) | **pass** | ✓ | |
| `preview_recurring_blockers` | `recurring_blockers` | snapshot + graph view | **pass** | ✓ | no server history read |
| `preview_agent_tool_memory` | `agent_tool_memory` | snapshot + blocker view | **pass** | ✓ | |
| `preview_template_signals` | `template_signals` | snapshot + graph/blocker/memory views | **pass** | ✓ | |
| `create_web_app_handoff_link` | `web_app_handoff_link` | `{intent, intakeType, title, safeSummary, previewKind}` | **pass** | ✓ | URL = `app.trysimsa.com/projects/new/intake`; handoff boundary 5 flags false |

Each asserts `ok:true` + expected `kind` + `boundary.{mutatesState,usesHostedExecution,requiresPayment}=false` + `derivedPreviewOnly=true`. The handoff additionally asserts `handoff.url` prefix + `handoff.boundary.{containsRawPrivateContent,containsSecrets,createsPersistence,requiresPayment,assumesPaymentProvider}=false`.

## 5. Snapshot chaining result
The 4 intake previews' `.preview` outputs were fed as the snapshot fields
(`acceptanceMap`, `stagePlan`, `agentRunPlan`, `evidencePlan`), and the derived
`graph` / `blockers` / `memory` views were chained forward into the later snapshot
tools (recurring-blockers ← graph; agent-tool-memory ← blockers;
template-signals ← graph + blockers + memory). All 4 snapshot tools returned
`ok:true` with the expected kind and boundary — realistic chaining, and the helpers
stayed defensive throughout. **Pass.**

## 6. Malformed / weak input checks
- `preview_acceptance_map` with empty `rawInput` → `ok:false, error:"missing_input"` (no crash).
- `preview_stage_plan` with unknown `type` → `ok:false, error:"invalid_type"` (no crash).
- `preview_template_signals` with `{}` snapshot → `ok:true` (defensive, conservative preview).

**Pass** — every malformed call resolved with a safe object; no server crash.

## 7. Sensitive omission check
Handoff called with a fake secret-like `title` and `safeSummary` (constructed at
runtime so **no literal token string exists in source** — keeps the secret scanner
clean) → both fields appear in `handoff.omittedFields`, ≥1 `handoff.warnings`, and the
emitted `handoff.query` contains no `sk-`/`token=` value. **Pass.**

## 8. Basic-only boundary confirmation
Across the whole QA run: server ran with credential env stripped, **9** tools only
(no `list_projects`/`get_project`/`list_pull_requests`/`run_pr_review`/`post_pr_comment`
— confirmed by Stage 150 and the registration tests), no central-plane call, no
network, no payment/Stripe/hosted-execution behavior. `credentials: not required`,
`network: not required`.

## 9. Known limitations
- Snapshot inputs are derived from the intake previews of one safe fixture; broader
  real-world snapshots are covered by the helper unit tests in
  `@conclave-ai/workspace-preview` (186 tests). The helpers are defensive, so QA
  asserts `ok:true`+kind+boundary rather than exact derived content.
- This is the real stdio MCP protocol from a script (not a GUI host); Claude Desktop
  app-side confirmation remains Bae's manual step (Stage 149).
- Local-path spawn (`node dist/index.js`); package remains unpublished.

## 10. Stage 151 decision
**Option A — Tool-by-tool QA passed.** All 9 Basic tools passed terminal QA, snapshot
chaining works, malformed input is safe, and sensitive fields are omitted — ready for
the private dogfood checkpoint evidence. No publish.

## 11. Recommended next stage
**Stage 152 — Failure / Troubleshooting Docs** (document the failure modes and operator
fixes: build missing, server won't start, tools not listed, Basic-only vs connected
confusion, sensitive-field omission behavior). **Do not merge** the train PR until the
Stage 153 checkpoint + Bae approval.
