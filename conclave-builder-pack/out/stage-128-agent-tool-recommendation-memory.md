# Stage 128 — Agent/Tool Recommendation Memory

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).

## Goal
Deterministic **per-workflow Agent/Tool Recommendation Memory** derived from saved
workflow snapshots + the Stage 127 blocker view. First step toward Simsa's
agent/tool intelligence: which roles/tools appear, what evidence each tool is
expected to produce, where tool↔evidence align or mismatch, which pairings carry
blocker signals, and what to remember for similar workflows. **Not ML training,
not cross-project memory, no graph DB, no migration.**

```
Agent Run Plan + Evidence Plan + Blocker Signals → Agent/Tool Recommendation Memory
```

## Product principle
Vocabulary: derived recommendation memory / tool fit signal / evidence fit /
remember for similar workflows / candidate recommendation. Avoided: trained model
/ learned from all users / best tool guaranteed / proven agent performance /
verified tool quality. Per-workflow + derived only.

## Helper — `apps/dashboard/src/lib/agent-tool-recommendation-memory.mjs` (+ `.d.mts`)
`buildAgentToolRecommendationMemoryView(input): AgentToolRecommendationMemoryView`
— pure, deterministic, dashboard-side. Inputs `unknown`; defensive (malformed → no
throw). Memory items **not fabricated** when there are no tasks.

```ts
AgentToolMemoryItem = { id, role, recommendedTool, toolFit, taskIds[],
  stageNumbers[], expectedEvidenceTypes[], blockerTypes[], memoryNote,
  suggestedFutureUse }
AgentToolRecommendationMemoryView = { workflowRecordId?, title, summary, items[],
  topTool?, topRole?, evidenceFitSummary{strong,partial,weak,unknown},
  notIncludedYet[], confidence }
```

## Grouping behavior
Agent tasks grouped by **role + recommendedTool**; each item carries `taskIds`,
`stageNumbers`, `expectedEvidenceTypes`, `blockerTypes`. Clamped **0–8 items**.

## Evidence fit behavior (conservative)
Tool → expected evidence map: github_pr_review→pr_link/review_note/commit_link ·
claude_code/codex→commit_link/fix_summary/build_result/test_result ·
browser_check→screenshot/walkthrough · test_run→test_result/build_result ·
human_review→clarification_note/review_note/acceptance_checklist/release_decision_note
· none→(none). Item expected evidence is **enriched from the Evidence Plan's
per-stage evidence types**. Fit:
- **strong** — tool's evidence covers all of the item's expected evidence types
- **partial** — some overlap but not full
- **weak** — tool has known evidence but none overlaps
- **unknown** — tool=`none` or no expected evidence data

## Blocker association behavior
A blocker type is attached to an item when the blocker's `relatedTaskIds` overlap
the item's `taskIds` **or** the blocker's `relatedStageNumbers` overlap the item's
`stageNumbers`.

## topTool / topRole
Deterministic: most `taskIds` → strongest fit → lowest lexical tool label.
Omitted when there are no items.

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 127
Recurring Blocker Signals (`useMemo` from record + blocker view). Shows: summary ·
top pairing + evidence-fit summary · memory item cards (role/tool, fit, stages,
tasks, blockers, expected-evidence chips, memory note, suggested future use) ·
"Not included yet" · confidence. When none: *"No agent/tool recommendation memory
detected yet…"*. Labeled **"Derived preview only — tool fit is not based on
executed performance."**

## Deterministic limitations (intentional)
Per-workflow, derived from snapshots only — no cross-project memory/learning, no
model training, no persisted memory table, no graph DB, no LLM, no central-plane
mutation, no execution/benchmark.

## No persistence / migration / training
No D1 migration, no memory table, no cross-project learning, no model training, no
central-plane mutation, no MCP publish, no billing, no deploy.

## Verification
- `apps/dashboard`: **371/371** tests (+15 agent-tool-memory: per-type build,
  role+tool grouping, strong fit (browser_check, test_run), weak/partial/unknown
  fit, Evidence-Plan stage enrichment, blocker association by task/stage,
  deterministic topTool/topRole, no-items minimal input, cap 8, disclaimers,
  no trained/proven/best claims, malformed-no-throw, deterministic), typecheck
  clean, build green (`/projects/new/intake` 27.9 kB). Lint = pre-existing
  `export/page.tsx` warning only.
- `apps/central-plane`: **1181/1181** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 129 — Template Effectiveness Signals.
