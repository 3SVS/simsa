> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 148 — MCP Manual Host QA Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-148-mcp-manual-host-qa-planning` (Stage 148~153 train) · **Base:** `main` @ `481fd72`
**Type:** planning (docs-only). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

Plans the private/manual MCP host QA that must pass **before any public publish** of
`@conclave-ai/mcp-workspace`. This stage produces the QA plan, host config strategy,
tool-by-tool matrix, pass/fail criteria, evidence checklist, and publish blockers. No
QA is *executed* here.

## 1. Current state
- `@conclave-ai/workspace-preview` — private shared package (preview helpers).
- `@conclave-ai/mcp-workspace` — **unpublished** (`0.8.2`).
- MCP Basic **9 tools** registered in the server runtime (Stage 142~143).
- **Basic-only mode** works without `CONCLAVE_USER_KEY` (Stage 142); local
  `smoke:basic` passes (Stage 144); README documents local setup (Stage 145); pack
  contents audited via `npm pack --dry-run` only (Stage 146~147).
- Merged to `main` `481fd72` (no deploy, no publish).

## 2. Why private dogfood is required before publish
- `smoke:basic` proves **in-process** registration + dispatch, but **not** that a real
  MCP host can spawn the binary, discover the tools over stdio, and call them with the
  registered Zod schemas. Host-side schema/transport incompatibilities only surface in
  a real host.
- Publishing is one-way reputationally: a broken first install (host can't list tools,
  Basic-only demands credentials, a handoff URL leaks input) is far more costly than a
  short private dogfood.
- Dogfood confirms the **honest** positioning (free, local, no credentials, no
  payment) actually holds end-to-end in the tools users will use.

## 3. Hosts to test
Priority order:
1. **Claude Desktop** — primary GUI MCP host; closest to a non-technical user's first
   experience.
2. **Claude Code / terminal local environment** — the developer/dogfood path; fastest
   to iterate.
3. **Generic MCP host using local `command` + `args`** — proves the config is
   host-agnostic (Cursor, Windsurf, etc. use the same shape).

> **Wording rule:** do not claim exact host-specific configuration file paths unless
> already verified in repo docs. Use the generic local-absolute-path example below and
> say "add an equivalent server entry in that host's MCP configuration file."

## 4. Local configuration strategy
**Basic-only is primary.** Build first, then point the host at the built entry by
**absolute path**, with empty `env`:

```json
{
  "mcpServers": {
    "simsa-basic": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/conclave-ai/packages/mcp-workspace/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

Connected mode is documented **separately and secondary**, placeholder only:

```json
{
  "env": {
    "CONCLAVE_USER_KEY": "your_user_key_here"
  }
}
```

Private dogfood rules: local absolute path only · build before host config · keep
`env` empty for Basic-only · **no** publish · **no** registry install · **no**
central-plane call · **no** hosted execution · **no** payment test · **no** PR-comment
post · **no** real secrets/credentials. Never include real credentials in any config.

## 5. Basic-only mode expected behavior
- **9 Basic tools** visible/callable.
- **No** connected tools visible; **no** `run_pr_review`; **no** `post_pr_comment`.
- **No** credentials required; **no** network/central-plane required.
- Server starts and stays up (no fatal exit on missing `CONCLAVE_USER_KEY`).

## 6. Manual tool QA matrix
Sample prompts below use the shared scenario in §7. Every Basic response must carry
`mutatesState:false, usesHostedExecution:false, requiresPayment:false,
derivedPreviewOnly:true` (handoff adds `handoff.boundary.*` all false).

| # | Tool | Sample input | Expected behavior | Pass | Fail | Evidence |
|---|------|--------------|-------------------|------|------|----------|
| 1 | `preview_acceptance_map` | `{type:"idea", rawInput:<scenario>}` | Returns `kind:"acceptance_map"` + derived items | `ok:true`, boundary preserved, non-empty preview | error/throw, network call, payment field true | response text (kind + boundary) |
| 2 | `preview_stage_plan` | `{type:"idea", rawInput:<scenario>}` | `kind:"stage_plan"` + stages | `ok:true`, boundary preserved | host can't call / crash | response text |
| 3 | `preview_agent_run_plan` | `{type:"idea", rawInput:<scenario>}` | `kind:"agent_run_plan"`; **does not run agents** | `ok:true`, no execution side effect | any agent actually runs / hosted exec | response text |
| 4 | `preview_evidence_plan` | `{type:"idea", rawInput:<scenario>}` | `kind:"evidence_plan"` + checks | `ok:true`, boundary preserved | crash / network | response text |
| 5 | `preview_acceptance_graph_summary` | snapshot from #1–#4 (or `{}`) | `kind:"acceptance_graph_summary"` | `ok:true`, defensive on empty | throw on missing fields | response text |
| 6 | `preview_recurring_blockers` | same snapshot | `kind:"recurring_blockers"` | `ok:true`, 0–N signals, no fabrication | reads server history / network | response text |
| 7 | `preview_agent_tool_memory` | same snapshot | `kind:"agent_tool_memory"` | `ok:true`, boundary preserved | crash / network | response text |
| 8 | `preview_template_signals` | same snapshot | `kind:"template_signals"` | `ok:true`, boundary preserved | crash / network | response text |
| 9 | `create_web_app_handoff_link` | `{intent:"save_workflow", title:<safe>}` | `kind:"web_app_handoff_link"`; URL = `https://app.trysimsa.com/projects/new/intake?…` | URL prefix correct, `boundary.requiresPayment/createsPersistence/assumesPaymentProvider:false`, sensitive input omitted + `warnings` | URL leaks secret/raw input / persists / payment | URL + omittedFields/warnings |

Also run a **malformed-input** pass (e.g. empty `rawInput`, invalid `type`, a
`title` containing `sk-…`): the tool must return a safe object / omit the sensitive
field and **not crash**.

## 7. Sample prompts (safe, no private data)
Scenario (paste as the product idea):

> Build a small landing page for an AI software review tool. It should explain the
> product, show three use cases, and include a request-access form.

Then ask the host, in turn:
- "Use Simsa Basic to create an acceptance map for this product idea."
- "Create a stage plan from the same idea."
- "Create an agent run plan." / "Create an evidence plan."
- "Create an acceptance graph summary from these previews."
- "Find recurring blockers." / "Create agent/tool memory." / "Create template signals."
- "Create a Simsa Web App handoff link."

Expected: responses include preview output **and** boundary metadata;
`requiresPayment:false`, `mutatesState:false`, `usesHostedExecution:false`; the
handoff link starts with `https://app.trysimsa.com/projects/new/intake`.

## 8. Pass/fail criteria
**Pass (all of):** host recognizes `simsa-basic`; 9 Basic tools listed/callable; ≥4
preview tools produce safe previews; handoff produces a safe URL; boundary metadata
preserved; no connected tools in Basic-only mode; no credential prompt; no server
crash; no secret printed.

**Fail / blocker (any of):** host can't start the server; Basic-only requires
`CONCLAVE_USER_KEY`; connected tools appear in Basic-only mode; `run_pr_review` or
`post_pr_comment` appears in Basic-only mode; a Basic tool calls network/central-plane;
a Basic tool mutates records; handoff link includes sensitive input;
payment/Stripe/hosted execution appears; server crashes on malformed input.

## 9. Evidence capture checklist
Per host run capture: date/time · OS + Node version · repo commit · build command
result · `smoke:basic` result · host config used (absolute path redacted if needed) ·
tool list (text or screenshot) · one sample preview response · handoff link response ·
any errors/warnings · pass/fail decision.

**Never capture:** real tokens · private customer code · confidential repo contents ·
raw credentials.

## 10. Out of scope
No npm publish · no public registry install · no payment · no hosted execution · no
central-plane calls in Basic-only mode · no PR comments · no auth/workspace
implementation · no production deploy.

## 11. Publish blockers
Do **not** publish if any hold: Basic-only mode fails in a real host · host cannot
list/call tools · a tool schema causes host incompatibility · handoff URL leaks
sensitive data · Basic tools require credentials · Basic tools expose connected/risky
tools unexpectedly · README is misleading · pack contents include unintended files ·
local smoke passes but host smoke fails without explanation.

## 12. Stage 148 decision
**Do not publish MCP yet.** Proceed to private dogfood with **local absolute path**
configuration. Use **Stage 149** to test Claude Desktop local config smoke first.

## 13. Recommended next stage
**Stage 149 — Claude Desktop Local Config Smoke.** Prepare local config instructions;
verify the build path; attempt a Claude Desktop local MCP connection if the
environment allows; if it cannot be driven from the terminal, produce an **operator
checklist for Bae to run manually** plus an evidence template. **Do not merge** the
train PR until the Stage 153 checkpoint + Bae approval.
