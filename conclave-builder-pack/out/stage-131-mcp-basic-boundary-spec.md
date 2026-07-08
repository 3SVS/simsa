> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 131 — MCP Basic Boundary Spec

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).
**Type:** spec / strategy only (docs-only). **No MCP publish, no MCP runtime change, no code, no migration.**

Defines the boundary for **Simsa MCP Basic** (free distribution layer) vs the
**Simsa Web App** (paid operating system) vs **future hosted execution** (paid
usage/credit layer), plus safety/confirmation gates and data handling.

## 1. Current MCP state
- Stage 61 introduced `packages/mcp-workspace`.
- Stage 62 packaged `@conclave-ai/mcp-workspace@0.8.2` via `npm pack` dry run —
  **not published.**
- Existing tool surface covers workspace/project/PR-review/fix/comment tools from
  earlier product stages.
- The current package **predates** the Simsa Web App free/paid strategy and the
  Acceptance Graph / Moat signals. **Stage 131 does not publish or modify runtime
  behavior** — it only specifies the boundary.

## 2. Strategic boundary
> **Simsa Web App = paid operating system · Simsa MCP Basic = free distribution
> layer · Hosted execution = future paid usage/credit layer.**

- **MCP Basic** optimizes for: discovery · lightweight planning · acceptance
  previews · handoff into the Web App · agent-workflow embedding.
- **Web App** owns: account/payment · saved workflow records · team/admin ·
  history · benchmark management · decision/outcome/action management · future
  usage credits.

## 3. MCP Basic free tools (proposed; read/preview/handoff)
`preview_acceptance_map` · `preview_stage_plan` · `preview_agent_run_plan` ·
`preview_evidence_plan` · `preview_acceptance_graph_summary` ·
`preview_recurring_blockers` · `preview_agent_tool_memory` ·
`preview_template_signals` · `create_web_app_handoff_link`.

These are **read/preview/handoff oriented** and **must not mutate production data
by default.** Free MCP Basic requires no payment but may require: a lightweight
anonymous usage key · a rate limit · no persistence (or very limited temporary
session memory).

## 4. Web App paid / account-gated capabilities
save workflow record · reopen workflow history · archive/restore/delete saved
records · admin workflows console · team/workspace sharing (later) · benchmark
handoff management · persistent decision/outcome history (later) · persistent
action pack + follow-up tracking · cross-project learning (with consent, later) ·
usage/admin reporting.

MCP routes users to the Web App for these, e.g.: *"This feature requires a Simsa
workspace. Open Simsa to save this workflow, manage history, or unlock team
features."*

## 5. Future hosted execution capabilities (paid usage/credit layer)
hosted LLM review · hosted benchmark execution · hosted evidence analysis · hosted
fix instruction generation · PR comment automation · outcome comparison
automation. These require: **explicit user confirmation · clear cost/credit
disclosure · provider/cost boundary explanation · audit/history record.** **Not in
free MCP Basic.**

## 6. Safety and confirmation gates
- **Read-only preview tools** — no confirmation; rate limit required; no secrets
  accepted.
- **State-changing tools** — explicit confirmation; generally open the Web App or
  require an authenticated Web App token.
- **High-risk tools** (repo write · PR comment post · benchmark execution · agent
  execution · deployment · billing · secret access) — **not exposed in MCP Basic.**
  If exposed later: authenticated account + explicit confirmation + audit trail.

## 7. Data handling policy
**MCP Basic can process:** user-provided prompt/summary · acceptance item
structure · stage plan structure · evidence type metadata · tool/role metadata ·
anonymized usage metrics.

**MCP Basic must NOT collect/store by default:** raw private code for training ·
secrets/tokens · full private repo content · customer confidential data · private
workflow snapshots for model training without consent.

**Policy:** raw content is used only for the user-requested preview/session unless
explicitly saved in the Web App; structural metadata may improve product quality
in aggregate **when safe and disclosed.**

## 8. Usage limits and rate limits
- **Free MCP Basic:** daily/monthly preview limit · payload size limit · no bulk
  project ingestion · no hosted execution · no persistent history.
- **Web App paid:** higher limits · saved workflows · history · team/admin.
- **Hosted execution (later):** usage credit based on hosted LLM/benchmark/
  evidence-analysis cost.
- **No complex credit system yet.**

## 9. Pricing / credit implications
**Do not introduce complex credits in MCP Basic. Do not let MCP become the billing
surface — payment happens in the Simsa Web App.**
- Free: MCP Basic preview tools + limited Web App preview/beta usage.
- Paid Web App: saved workflow history · team/admin · persistent benchmark/
  decision/action/outcome records (later).
- Usage credits (later): hosted execution only.
- **External provider cost:** external Claude/Cursor/Codex/OpenAI usage stays
  under the **user's connected provider account** unless Simsa explicitly offers
  hosted execution.

## 10. UX handoff back to Web App
CTAs: *Open in Simsa · Save this workflow in Simsa · Continue with history in
Simsa · Manage team/admin in Simsa · Unlock benchmark and outcome history in
Simsa.* Handoff links preserve **safe context only**: intake type · a temporary
generated-preview id (if any) · **no secrets · no raw private content** unless the
user explicitly chooses to transfer/save. (Consistent with the Stage 119 mailto
safe-context approach.)

## 11. Security and liability policy
External-execution / preview warning: *"This MCP tool provides preview and workflow
support. It does not guarantee that software is bug-free, secure, compliant, or
production-ready. Final decisions remain with the user or team."* External
providers: *"External tool or agent calls may follow the connected provider's cost
and data handling policies. Review before running."* Security: **do not request or
print tokens/secrets; do not accept secrets as normal input; do not expose
billing/deploy/repo-write tools in Basic.** (Previously exposed Vercel token was
operator-revoked/rotated; token hygiene maintained — no token values output.)

## 12. Future implementation stages (later train, after Stage 132)
- Future Stage A — MCP Basic Tool Inventory Refactor
- Future Stage B — MCP Basic Preview Tool Implementation
- Future Stage C — MCP Handoff Link to Web App
- Future Stage D — MCP Usage Limits
- Future Stage E — MCP Paid Feature Gate
- Future Stage F — Hosted Execution Credit Planning

Likely a **later train**, not the current Stage 126~132 train.

## 13. Stage 131 decision
**Do not publish or expand MCP runtime in this train.** Stage 131 defines the
free-vs-paid, read-vs-mutate, and preview-vs-execution boundaries only. The **Stage
132 checkpoint** decides whether the next train is MCP Basic implementation,
outcome persistence, or auth/workspace.

## 14. Recommended next stage
**Stage 132 — Moat Train Checkpoint**: prepare PR #148 for the merge/deploy
decision and summarize what the Acceptance Graph / Moat Train achieved.

---

*Spec only. No MCP publish/runtime change, no package version bump, no npm, no
code, no DB/migration, no central-plane mutation, no billing, no deploy.*
