> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 141 — MCP Server Runtime Wiring Planning / Tool Registration Boundary

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` · **Base:** `main` @ `e3d6fa4`
**Type:** planning / boundary only (docs-only). **No runtime wiring, no publish, no payment, no deploy, no migration.**

Plans how to safely register the existing 9 MCP Basic wrappers into the MCP server
runtime — keeping Basic **read-only, local, free, and env-less** while existing
network-backed and gated tools keep their requirements.

## 1. Current MCP Basic foundation (after Stage 134~140, merged)
- `@conclave-ai/workspace-preview` (private, unpublished) holds all deterministic
  preview helpers.
- `packages/mcp-workspace/src/mcp-basic-tools.mjs` — registry of the **9** Basic
  tools (metadata only).
- `packages/mcp-workspace/src/mcp-basic-preview-tools.mjs` — the **9 wrapper
  functions** (pure, read-only, boundary metadata, defensive). **Not yet
  registered on the MCP `Server`.**

## 2. Existing MCP server audit (`packages/mcp-workspace`)
- **Entrypoint:** `src/index.ts` (`bin: conclave-mcp-workspace`). Transport:
  **stdio** (`StdioServerTransport`). Server: `new McpServer({name:"conclave-
  workspace", version})` built by `buildServer(opts)`.
- **Tool registration pattern:** `server.registerTool(name, { ...TOOL_META[name],
  inputSchema: { <zod fields> } }, async (args) => text(result))`. **Schema
  validation = Zod** (per-field object). **Response helper** `text(result)` →
  `{ content: [{ type:"text", text: JSON.stringify(result, null, 2) }] }`.
- **Config (`buildServer`):** `ServerOptions = { client: WorkspaceClient;
  enablePostComment?: boolean }`. `enablePostComment` defaults **false**.
- **Env (index.ts):** `CONCLAVE_USER_KEY` is **required** — the server writes a
  stderr error and **exits** if it is missing. `CONCLAVE_API_BASE_URL` /
  `CONCLAVE_CENTRAL_PLANE_URL` optional (default central-plane URL).
  `CONCLAVE_AUDIT_LOG` (default on, stderr). `CONCLAVE_ENABLE_PR_COMMENT_POST`
  toggles the gated write tool.
- **Network:** `WorkspaceClient` issues central-plane `fetch` calls on every
  method, injecting `userKey` (GET query / write body). **All 10 existing tools
  are network-backed and userKey-scoped.**
- **Error pattern:** results are returned as JSON text; the client surfaces
  `{ok:false,error}` shapes rather than throwing into the protocol.
- **Tests:** `test/server.test.mjs` (imports `dist/`), `test/client.test.mjs`,
  plus the Stage 135~139 `mcp-basic-tools` / `mcp-basic-preview-tools` tests
  (import `src/` directly).

## 3. Current tool categories
- **Existing connected (network, userKey):** `list_projects`, `get_project`,
  `list_pull_requests`, `get_review_history`, `get_review_run`, `compare_runs`,
  `create_fix_instructions`, `preview_pr_comment`.
- **Existing execution-like:** `run_pr_review` (may consume a review credit).
- **Existing gated write:** `post_pr_comment` (off by default + `confirm:true`).
- **New MCP Basic local (wrappers, not yet registered):** `preview_acceptance_map`,
  `preview_stage_plan`, `preview_agent_run_plan`, `preview_evidence_plan`,
  `preview_acceptance_graph_summary`, `preview_recurring_blockers`,
  `preview_agent_tool_memory`, `preview_template_signals`,
  `create_web_app_handoff_link`.

## 4. Basic runtime wiring target
Register the 9 Basic tools via `registerTool` using their pure wrappers — **no
`WorkspaceClient`, no network, no env**. Each handler calls the corresponding
`mcp-basic-preview-tools` function and returns its result via the existing `text()`
helper. Basic tools must remain: read-only · local deterministic · no central-plane
call · **no env required** · no saved-workflow mutation · no GitHub write · no PR
comment · no hosted execution · no payment · no Stripe/payment-provider assumption.

**Key design decision (env boundary):** today `index.ts` **exits** without
`CONCLAVE_USER_KEY`. Target: a Basic-only user (no userKey) should still get a
working server exposing the 9 Basic local tools, while the connected/gated tools
are only registered when their env is present.
- **Proposed approach (Stage 142+, not now):** `buildServer` registers the Basic
  local tools **unconditionally** (they need no client); connected/gated tools are
  registered **only when a `client` is provided** (i.e. userKey present). `index.ts`
  starts in "Basic-only mode" when `CONCLAVE_USER_KEY` is absent (no client built,
  no exit) and logs a notice that connected features need a userKey. This must be
  **backward compatible** — with a userKey, all tools behave exactly as today.
- **Risk:** changing the startup contract could regress current connected usage;
  Stage 142 will keep the userKey path identical and only relax the *Basic-only*
  path. Stage 141 documents the target; no behavior change yet.

## 5. Input/output schema plan (Zod, per the existing pattern)
- **preview_acceptance_map / preview_stage_plan / preview_agent_run_plan /
  preview_evidence_plan:** `{ type: z.string(), rawInput: z.string() }`. (The
  wrapper validates `type` against the intake-type allowlist and returns a safe
  error object for empty/invalid input.)
- **preview_acceptance_graph_summary:** `{ workflowRecordId?, title?, sourceSummary?,
  acceptanceMap?, stagePlan?, agentRunPlan?, evidencePlan?, decisionOutcomePreview?,
  evolutionActionPreview? }` — snapshot fields as `z.unknown().optional()`.
- **preview_recurring_blockers:** same snapshot fields **plus** `acceptanceGraphView?`.
- **preview_agent_tool_memory:** `{ workflowRecordId?, title?, sourceSummary?,
  agentRunPlan?, evidencePlan?, recurringBlockerDetectionView? }`.
- **preview_template_signals:** `{ workflowRecordId?, title?, sourceSummary?,
  acceptanceGraphView?, recurringBlockerDetectionView?, agentToolMemoryView?,
  evidencePlan?, stagePlan?, decisionOutcomePreview?, evolutionActionPreview? }`.
- **create_web_app_handoff_link:** `{ intent?, intakeType?, title?, safeSummary?,
  previewKind?, previewId?, baseUrl? }` (all `z.string().optional()`).

`unknown` snapshot inputs map to `z.unknown().optional()`; the wrappers are already
defensive, so malformed input yields a conservative preview, never a throw.

## 6. Response boundary
Every Basic tool response (already produced by the wrappers) carries:
`{ ok, kind, …, mutatesState:false, usesHostedExecution:false,
requiresPayment:false, derivedPreviewOnly:true }`. The handoff response additionally
carries `boundary { containsRawPrivateContent:false, containsSecrets:false,
createsPersistence:false, requiresPayment:false, assumesPaymentProvider:false }`,
making explicit it **does not persist data, create an account, trigger payment, or
execute tools**. Responses are serialized with the existing `text()` helper.

## 7. Safety and confirmation boundary
- **Basic local tools:** enabled by default · no env · no network · no mutation ·
  no confirmation required.
- **Connected tools:** registered only when the required env (`CONCLAVE_USER_KEY`)
  is present; clearly read/network.
- **Risky/gated tools:** `run_pr_review` (credit) and `post_pr_comment`
  (`enablePostComment` + `confirm:true`) stay gated and are **not part of the free
  Basic default**. **No new high-risk tools** (deploy/billing/secret/shell/
  repo-write/publish) are introduced.

## 8. Local smoke plan (Stage 142~147)
- MCP server starts with Basic tools available; in Basic-only mode (no userKey) it
  starts without exiting.
- Each Basic tool, when invoked, returns the expected `kind` + boundary metadata.
- Basic tools make **no central-plane call** and **read no `process.env`**.
- Missing/malformed input returns a safe object (server does not crash).
- Connected tools still require userKey; `post_pr_comment` still needs
  `enablePostComment` + `confirm:true`.
- A scripted stdio smoke (list tools, call one preview tool) under
  `packages/mcp-workspace/scripts/` (Stage 144) — local only.

## 9. Pack / publish boundary
`npm pack --dry-run` only at the Stage 146/147 checkpoint. **No `npm publish`, no
version bump** until Bae explicitly approves. `@conclave-ai/workspace-preview`
stays `private`. `@conclave-ai/mcp-workspace` stays at its current version,
unpublished.

## 10. Risks and mitigations
- **Startup-contract regression** (relaxing the userKey requirement) → keep the
  with-userKey path byte-for-byte equivalent; only add a Basic-only branch; cover
  both with tests (Stage 142+).
- **Accidental network/env in a Basic handler** → Basic handlers call only
  `mcp-basic-preview-tools` (pure, audited); no `client` passed to them; tests
  assert no central-plane call / no `process.env`.
- **Schema drift** → Zod schemas mirror the wrapper input types; wrappers remain
  the source of truth and stay defensive.
- **Scope creep into publish/runtime execution** → Stage 141 is docs-only; runtime
  registration starts at Stage 142; publish deferred to the Stage 147 checkpoint.

## 11. Stage 141 decision
**Do not publish or expose MCP Basic publicly yet.** This stage defines the safe
runtime-wiring boundary. Proceed to Stage 142 only after confirming the Basic local
tools can be registered **without** enabling network, mutation, hosted execution,
or payment behavior — and **without** breaking the existing userKey path.

## 12. Recommended next stage
**Stage 142 — Register Read-only Preview Tools in MCP Server.** Scope: register the
**8 preview tools** (wrapper-level), keep the handoff tool for Stage 143 (smaller
scope), change **no** connected/network tools, add local tests only, **no publish**.

---

*Planning only. No runtime wiring, no MCP publish, no version bump, no central-plane
endpoint, no migration, no payment/Stripe, no hosted execution, no auth/login, no
deploy, no domain/DNS change.*
