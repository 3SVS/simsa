> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 133 — MCP Basic Implementation Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-133-mcp-basic-implementation-planning` · **Base:** `main` @ `b62c74e`
**Type:** planning / strategy only (docs-only). **No MCP implementation/publish, no payment, no deploy, no migration.**

Opens the next train — **Stage 133~140 — MCP Basic Implementation** — defining
what Simsa MCP Basic exposes first, how it reuses existing deterministic helpers,
how it avoids mutation/billing/hosted-execution/liability risk, and how it hands
users back to the Simsa Web App.

## 1. Current product state
**Live Web App** (`app.trysimsa.com`, main `b62c74e`): unified intake · acceptance
map · stage plan · agent run plan · evidence plan · saved workflow records ·
archive/delete/admin · benchmark handoff preview · decision/outcome link preview ·
evolution action preview · acceptance graph derived view · recurring blocker
signals · agent/tool recommendation memory · template effectiveness signals.

**Current limits:** no full auth · no team workspace · no billing/payment
(**provider TBD**) · no hosted execution · **no real MCP Basic implementation
yet** · no outcome persistence yet.

## 2. Existing MCP package audit (`packages/mcp-workspace`)
- **Name/version:** `@conclave-ai/mcp-workspace@0.8.2`. **License** FSL-1.1-Apache-2.0.
  stdio server (`bin: conclave-mcp-workspace`). **Published status: NOT published**
  (Stage 62 did an `npm pack` dry run only).
- **Default base URL:** `https://conclave-ai.seunghunbae.workers.dev` (central-plane).
  **Config (env):** `CONCLAVE_USER_KEY` (required), `CONCLAVE_API_BASE_URL`,
  `CONCLAVE_ENABLE_PR_COMMENT_POST`, `CONCLAVE_AUDIT_LOG`. Audits to stderr.
- **Current tools** (`src/server.ts`, classified):
  - *safe preview/read:* `list_projects`, `get_project`, `list_pull_requests`,
    `get_review_history`, `get_review_run`, `compare_runs`,
    `create_fix_instructions` (deterministic brief), `preview_pr_comment` (renders
    body, does not post).
  - *execution-like:* `run_pr_review` (runs a review; can consume review credits).
  - *state-changing / high-risk:* `post_pr_comment` (**WRITE; disabled by default**,
    requires `CONCLAVE_ENABLE_PR_COMMENT_POST=true` **and** `confirm:true`).
- **Risk level:** moderate — the package already gates the one write tool well
  (off by default + confirm), but `run_pr_review` is execution-like and would
  consume credits; neither belongs in **free MCP Basic** by default.
- **Staleness:** predates the **Simsa rename**, the **Acceptance Graph / Moat**
  signals (Stages 126~129), and the **MCP Basic free/paid boundary** (Stage 131).
  Tool naming is PR-review centric ("conclave"), not the new acceptance-preview
  surface. **Stage 133 documents this staleness; it does not modify package code.**

## 3. MCP Basic product thesis
> MCP Basic lets users bring Simsa's acceptance planning into the agent tools they
> already use, while the Web App remains the system of record for saved workflows,
> accounts, payment, history, and advanced operations.

MCP Basic = free · preview-oriented · low-risk · provider-neutral · **mutation-free
by default** · useful inside Claude Code / ChatGPT / Cursor / Codex · designed to
drive users to the Web App for persistence.

## 4. Basic tool inventory (proposed MVP)
`preview_acceptance_map` · `preview_stage_plan` · `preview_agent_run_plan` ·
`preview_evidence_plan` · `preview_acceptance_graph_summary` ·
`preview_recurring_blockers` · `preview_agent_tool_memory` ·
`preview_template_signals` · `create_web_app_handoff_link`.

For each tool (spec to fill in implementation stages): purpose · input shape ·
output shape · data sensitivity · mutates state? (all **no**) · requires Web App
account? (all **no** for these) · free? (all **yes**) · rate-limit considerations.
These are **new, acceptance-preview tools** — distinct from the existing PR-review
tools, which stay gated/out of Basic.

## 5. Tool-to-Web-App / helper mapping
| MCP Basic tool | Source helper (today, in `apps/dashboard/src/lib`) |
| --- | --- |
| preview_acceptance_map | `intake-acceptance-map` |
| preview_stage_plan | `intake-stage-plan` |
| preview_agent_run_plan | `intake-agent-run-plan` |
| preview_evidence_plan | `intake-evidence-plan` |
| preview_acceptance_graph_summary | `acceptance-graph-derived` |
| preview_recurring_blockers | `recurring-blocker-detection` |
| preview_agent_tool_memory | `agent-tool-recommendation-memory` |
| preview_template_signals | `template-effectiveness-signals` |
| create_web_app_handoff_link | future safe handoff URL builder |

**Architectural question:** keep shared preview logic in dashboard libs, or move to
a `packages/…/workspace-preview` shared package used by both dashboard and MCP?
**Recommendation:** do **not** duplicate logic long-term — plan a future
**extraction of the pure deterministic helpers** (they are already `.mjs`+`.d.mts`,
no React/Next deps) into a shared package consumed by both. **Do not extract in
Stage 133** — Stage 134 is the extraction inventory/plan.

## 6. Data handling and privacy boundary
MCP Basic may process user-provided summaries + structured inputs for preview
generation. It must **not** store raw private content by default, **not** train on
raw private code/confidential content by default, and should **reject or warn**
against secrets/tokens. Handoff links carry **safe context only** (intake type,
safe summary, a temporary preview id if a future session store exists) — **no
secrets, no raw private content** unless the user explicitly chooses to save in the
Web App.

## 7. Safety and confirmation gates
- **Basic/free:** read/preview only · no mutation · no confirmation · rate limited.
- **Web App gated:** save workflow · archive/delete · history · admin · team
  (later).
- **Future confirmation-required:** post PR comment · run PR review · run
  benchmark · execute agent · hosted evidence analysis.
- **Prohibited from Basic:** deploy · billing action · secret access · arbitrary
  shell · repo write · package publish.

## 8. Free vs Web App gated boundary
- **Free MCP Basic:** preview/read/handoff · limited usage · no/limited temporary
  session · no hosted execution.
- **Web App gated:** saved workflows · history · admin/team · persistent
  benchmark/decision/action/outcome records · paid plan (later).
- **Hosted execution gated:** future usage credits · explicit confirmation · cost
  disclosure.

## 9. Payment provider boundary
**Payment provider is TBD. Do not assume Stripe.** Bae is not operating from a US
company by default; future payment work must evaluate **Korea-compatible providers
first**. **MCP is not the billing surface.** Future options to evaluate (not now):
Korea-compatible PG/payment provider · manual invoice / B2B billing for early
customers · bank transfer / tax-invoice workflow for Korean B2B · overseas payment
provider only after legal/entity review · US entity / Stripe Atlas path only as a
separate business decision. **No payment provider implemented in this train.**

## 10. Hosted execution boundary
**Hosted execution is not part of MCP Basic.** Future hosted execution (hosted LLM
review · hosted benchmark · hosted evidence analysis · hosted fix-instruction
generation · automated PR comment / outcome comparison) requires explicit
confirmation · cost/credit estimate · audit trail · provider boundary ·
rollback/cancel where relevant.

## 11. Implementation train proposal (Stage 133~140)
| Stage | Title | Deliverable |
| --- | --- | --- |
| 133 | MCP Basic Implementation Planning | this doc (planning) |
| 134 | Shared Preview Helper Extraction Plan / Inventory | how to reuse dashboard helpers in MCP without duplication / Next deps |
| 135 | MCP Basic Tool Skeleton | server scaffolding for the new preview tools (no publish) |
| 136 | MCP Preview Tool: Acceptance Map / Stage Plan / Agent Run Plan | 3 preview tools |
| 137 | MCP Preview Tool: Evidence Plan / Acceptance Graph / Blockers | 3 preview tools |
| 138 | MCP Preview Tool: Agent Tool Memory / Template Signals | 2 preview tools |
| 139 | MCP Web App Handoff Link | safe handoff URL builder + tool |
| 140 | MCP Basic Checkpoint | npm pack dry-run only; merge/publish decision |

If helper-extraction risk is high, **Stage 134 stays docs/inventory first**, then
the tool skeleton follows once the extraction plan is safe. **No publish until the
Stage 140 checkpoint.**

## 12. Verification strategy (future)
Unit tests per pure tool output · snapshot/fixture tests · malformed-input tests ·
no-secret-echo tests · no-mutation tests · no paid/hosted-execution tests in Basic
· local MCP server smoke only · **`npm pack` dry-run only at the checkpoint, not
publish**.

## 13. Risks and mitigations
- Duplicate logic dashboard↔MCP → shared-helper extraction plan (Stage 134).
- MCP accidentally exposes mutation/high-risk tools → Basic tool **allowlist**;
  existing `run_pr_review`/`post_pr_comment` stay out of Basic.
- Users confuse Basic preview with verified review → preview-only disclaimers
  (carried from Stages 120/126~129).
- Payment boundary misread as Stripe/implementation → provider-neutral wording;
  §9.
- Raw private code stored/logged → no raw-content storage by default; secret
  rejection/warning.
- Free MCP creates uncontrolled cost if hosted AI added too early → no hosted
  execution in Basic; rate limits.

## 14. Stage 133 decision
**Do not implement or publish MCP in Stage 133.** Use it to define the
implementation train, tool boundaries, helper-reuse strategy, and risk controls.

## 15. Recommended next stage
**Stage 134 — Shared Preview Helper Extraction Plan / Inventory:** decide how to
reuse the dashboard deterministic preview helpers inside MCP **without duplicating
logic or creating browser/Next dependencies** (the helpers are already pure
`.mjs`+`.d.mts`, which makes extraction low-risk).

---

*Planning only. No MCP implementation/publish, no package version bump, no npm, no
new central-plane endpoint, no migration, no payment/Stripe, no hosted execution,
no deploy, no domain/DNS change.*
