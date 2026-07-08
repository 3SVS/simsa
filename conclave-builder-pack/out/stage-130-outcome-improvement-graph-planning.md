> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 130 — Outcome Improvement Graph Planning

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).
**Type:** planning / strategy only (docs-only). **No outcome persistence, no migration, no code change.**

Plans how Simsa will eventually connect derived acceptance-graph signals to
**observed outcome changes** — the long-term moat. Honest by construction: we do
**not** have outcome-improvement data yet; we only have derived previews and saved
workflow snapshots.

## 1. Current state
- **Stage 126** — Acceptance Graph Derived View (nodes/edges/signal summary from
  saved workflow snapshots).
- **Stage 127** — Recurring Blocker Signals (missing evidence, not_verified
  cluster, release readiness gap, fix/rerun cluster, unclear scope, tooling gap).
- **Stage 128** — Agent/Tool Recommendation Memory (role/tool/evidence fit derived
  from agent run + evidence plans).
- **Stage 129** — Template Effectiveness Signals (per-workflow pattern signals,
  not statistically validated).

All are **derived previews** — no graph DB, no cross-project analytics, no model
training, **no actual outcome tracking yet.**

## 2. Why outcome improvement matters
The Acceptance Graph is useful, but the durable moat comes from connecting graph
signals to **outcomes** — letting Simsa eventually answer: did the workflow improve
after a fix? did evidence collection reduce not_verified items? did a tool pairing
lead to fewer blockers? did a template refinement reduce ambiguity? did a decision
path lead to safe release, defer, or rerun?

## 3. Outcome Improvement Graph thesis
> Simsa's moat compounds when every workflow can connect planned acceptance
> structure to observed outcome changes.

Path: `Intake → acceptance item → stage → evidence expectation → blocker signal →
agent/tool pairing → template signal → action → follow-up → outcome → improvement
signal`. **It must not certify success** — it shows whether observed workflow state
moved in a better, worse, or still-unverified direction.

## 4. What counts as an outcome
Future outcome types: `acceptance_status_change` · `evidence_attached` ·
`blocker_resolved` · `blocker_recurred` · `fix_applied` · `rerun_completed` ·
`decision_recorded` · `release_deferred` · `release_accepted_by_human` ·
`user_feedback_received`.

**Outcome ≠ "software is correct."** Outcome = "the workflow state changed in a
measurable way."

## 5. Future data model (proposal — not implemented)
```text
OutcomeEvent
- id, userKey/workspaceId (later), projectId, workflowRecordId
- sourceSignalId, sourceSignalType
- outcomeType
- beforeStatus, afterStatus
- evidenceRefs
- actorType: user | admin | agent | system
- createdAt

ImprovementSignal
- id, workflowRecordId
- sourcePatternType, sourcePatternId
- improvementDirection: improved | worsened | unchanged | still_not_verified
- confidence, summary, createdAt
```
A future **migration should wait** until the real outcome-collection UX is
designed (avoid a schema that doesn't match how outcomes are actually recorded).

## 6. Future lifecycle
1. Saved workflow created · 2. Acceptance Graph derived · 3. Blocker/template/tool
signals derived · 4. User chooses action (collect evidence / fix / rerun / defer /
accept) · 5. Follow-up created · 6. User records result · 7. OutcomeEvent created ·
8. ImprovementSignal derived · 9. Project learning updates · 10. Cross-project
pattern aggregated **with consent**. **This train only reaches steps 1–3.**

## 7. Safe data collection boundaries
Structural metadata first · no raw private code training by default · no
secret/token collection · no private repo content ingestion by default ·
user-controlled saved records · explicit future consent for cross-project
analytics. **Do not treat user feedback or outcome records as universal truth —
use them as workflow signals.**

## 8. Product surfaces (future — not implemented)
Workflow outcome timeline · before/after acceptance status · blocker recurrence
panel · evidence improvement panel · agent/tool outcome memory · template
improvement history · project learning summary · team/admin outcome dashboard
(later).

## 9. MCP implications
Simsa **MCP Basic stays preview/read/handoff oriented**; outcome **recording lives
primarily in the Web App**. Future MCP *may* preview outcome impact, open a
workflow outcome link, suggest evidence to attach, or propose a follow-up action.
Paid/advanced stays in Web App: persistent outcome history · team/admin outcome
dashboard · hosted execution outcome analysis · cross-project learning.

## 10. Pricing / credit implications
**Do not charge per derived preview yet.** Boundary: Free/MCP Basic = preview +
handoff; Paid Web App = saved history, outcome timeline, team/admin learning,
persistent benchmark/action/outcome records; Usage credits (later) = hosted AI
review, benchmark execution, evidence analysis, automated outcome comparison.

## 11. Liability / trust policy
Outcome improvement is **not certification**; outcome signals are workflow-state
changes; final accept/release decisions remain with the user/team. Avoid claiming
verified success / secure / bug-free / compliant / guaranteed improvement.
Recommended copy: *"Outcome improvement signals show how a workflow changed after
evidence, fixes, reruns, or decisions. They do not certify that the software is
bug-free, secure, compliant, or production-ready."*

## 12. Suggested future implementation stages (later train, after Stage 132)
- Future Stage A — Outcome Event Model Planning
- Future Stage B — Manual Outcome Recording
- Future Stage C — Workflow Outcome Timeline
- Future Stage D — Improvement Signal Derivation
- Future Stage E — Project Learning Update from Outcomes
- Future Stage F — Team/Admin Outcome Dashboard

These should be a **later train**, after the MCP Basic Boundary Spec (Stage 131)
and the Stage 132 checkpoint.

## 13. Stage 130 decision
**Do not implement outcome persistence yet.** Keep the Outcome Improvement Graph
as a planning artifact. Use the **Stage 132 checkpoint** to decide whether the
next train is MCP Basic, outcome persistence, or auth/workspace.

## 14. Recommended next stage
**Stage 131 — MCP Basic Boundary Spec**: specify what Simsa MCP Basic exposes for
free, what requires a Web App account/payment, what remains future hosted
execution, and what safety/confirmation gates are required.

---

*Planning only. No outcome graph table, no migration, no code, no central-plane
mutation, no MCP publish, no billing, no deploy.*
