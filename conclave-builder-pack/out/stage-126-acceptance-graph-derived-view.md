> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 126 — Acceptance Graph Derived View v1

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).

## Goal
First **derived Acceptance Graph view** from existing saved agent workflow records
— showing Simsa can extract structured acceptance intelligence from saved
snapshots. **A derived view, not a persisted graph database; no new migration, no
model training.**

```
Saved workflow record snapshots → derived graph nodes/edges + signal summary
```

## Product principle
Not a fancy visualization yet — the value is the **signal summary** + the proof
that structured intelligence is extractable. Vocabulary: derived view / graph
summary / acceptance signals / evidence gaps / decision signals / action signals.
Avoided: trained model / automatic correctness / verified graph / production-ready
insight.

## Helper — `apps/dashboard/src/lib/acceptance-graph-derived.mjs` (+ `.d.mts`)
`buildAcceptanceGraphDerivedView(input): AcceptanceGraphDerivedView` — pure,
deterministic, dashboard-side. Inputs are the saved record's `unknown` snapshots
(+ optional decision/outcome + evolution-action previews); every accessor is
defensive (malformed → conservative fallback, never throws). Relationships that
cannot be determined are **skipped, never invented**.

```ts
AcceptanceGraphDerivedView = {
  workflowRecordId?, title, summary,
  nodes: AcceptanceGraphNode[],      // type, label, summary?
  edges: AcceptanceGraphEdge[],      // type, from, to, label
  signalSummary: { acceptanceItemCount, stageCount, agentTaskCount,
                   evidenceExpectationCount, notVerifiedCount,
                   decisionCandidateCount, actionPreviewCount,
                   topAcceptanceAreas[], topEvidenceTypes[] },
  notIncludedYet: string[],
  confidence: "low" | "medium" | "high",
}
```

## Derivation behavior
- **Nodes**: always an `intake` node; then `acceptance_item` (≤12),
  `acceptance_area` (deduped), `stage` (≤8), `agent_task` (≤10),
  `evidence_expectation` (≤10), `decision_candidate` (≤5, from decision/outcome
  preview), `action_preview` (≤7, from evolution-action preview).
- **Edges** (deterministic, **capped at 40**, skip-when-unknown):
  `intake → item` generated_from · `item → area` belongs_to · `item → evidence`
  requires_evidence (title match) · `stage → task` assigned_to_role (stageNumber
  match) · `evidence → decision` suggests_decision (`decisionImpact === type`
  match) · `decision → action` creates_action (semantic map: fix→create_fix_
  instructions, rerun→rerun_agent, defer→defer_scope, not_verified→collect_
  evidence/clarify, accept→none) · `release-readiness item → release stage`
  blocks_release.

## Signal summary behavior (the main value)
Counts computed over the **full source arrays** (not the capped node lists):
acceptance item / stage / agent-task / evidence-expectation / not_verified /
decision-candidate / action-preview counts, plus `topAcceptanceAreas` and
`topEvidenceTypes` (top 5 each, count-desc, deterministic tiebreak).

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 115
Evolution Action Pack Preview, derived via `useMemo` from the opened record +
decision/outcome + action previews. Shows: signal-summary grid, top acceptance
areas + top evidence types (chips), node/edge counts with a **sample** of nodes
and edges (not a full visualization), "Not included yet", confidence. Labeled
**"Derived preview only — no graph database or model training is created."**

## No graph DB / migration / training
No D1 migration, no graph table, no persisted graph, no model training, no LLM
call, no central-plane mutation, no MCP publish, no billing, no deploy. Pure
dashboard derivation from already-saved snapshots.

## Verification
- `apps/dashboard`: **344/344** tests (+11 acceptance-graph-derived: per-type
  build, intake + item/stage/task/evidence nodes, decision/action nodes,
  deterministic edges, signal counts + top areas/evidence, decision→action
  semantic edges, blocks_release, node/edge caps, disclaimers, malformed-no-throw,
  empty→intake-only, deterministic), typecheck clean, build green
  (`/projects/new/intake` 24.4 kB). Lint = pre-existing `export/page.tsx` warning
  only.
- `apps/central-plane`: **1181/1181** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 127 — Recurring Blocker Detection.
