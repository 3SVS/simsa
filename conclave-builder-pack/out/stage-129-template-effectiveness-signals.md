> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 129 — Template Effectiveness Signals

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).

## Goal
Deterministic **per-workflow Template Effectiveness Signals** derived from the
Stage 126 graph view + Stage 127 blocker view + Stage 128 agent/tool memory +
evidence/stage snapshots. Surfaces which acceptance/evidence/stage/tool/decision/
action **patterns** align well and which need refinement. **Not a trained model,
not cross-project effectiveness, no graph/metrics DB, no migration.**

```
Acceptance Graph + Blocker Signals + Agent/Tool Memory → Template Effectiveness Signals
```

## Product principle
Vocabulary: template signal / pattern signal / derived effectiveness signal /
evidence alignment / needs refinement / candidate template improvement. Avoided:
proven template / best-performing template / statistically validated / trained
effectiveness model / guaranteed improvement. Derived from the current saved
workflow only.

## Helper — `apps/dashboard/src/lib/template-effectiveness-signals.mjs` (+ `.d.mts`)
`buildTemplateEffectivenessSignalsView(input): TemplateEffectivenessSignalsView` —
pure, deterministic, dashboard-side. Inputs `unknown`; defensive (malformed → no
throw). Signals **not fabricated** when source data is insufficient (0–8).

```ts
TemplateEffectivenessSignal = { id, type, quality, title, summary, sourcePattern,
  supportingSignals[], blockerTypes[], relatedAcceptanceAreas[],
  relatedEvidenceTypes[], relatedStageNumbers[], suggestedTemplateImprovement }
TemplateEffectivenessSignalsView = { workflowRecordId?, title, summary, signals[],
  qualityCounts{strong_alignment,partial_alignment,needs_refinement,
  under_specified,unknown}, topNeedsRefinement[], notIncludedYet[], confidence }
```

## Signal derivation behavior (0–8)
- **acceptance_area_pattern** — leading top area: strong (has evidence, no
  blocker) · needs_refinement (area has a blocker) · under_specified (no evidence
  relation).
- **evidence_pattern** — leading top evidence type: strong/partial (tool memory
  fit) · needs_refinement (in a missing-evidence/not_verified blocker) ·
  under_specified (no agent/tool fit).
- **stage_pattern** — when ≥2 stages: strong (tasks + evidence) · needs_refinement
  (stage numbers overlap blockers) · under_specified (no task/evidence relation).
- **tool_pattern** — leading agent/tool memory item: strong (strong fit, no
  blocker) · partial · needs_refinement (blocker types) · unknown.
- **decision_pattern** (conservative) — needs_refinement when recommended decision
  is fix/rerun/defer/not_verified; strong only when accept; else unknown.
- **action_pattern** — needs_refinement when actions include collect_evidence /
  create_fix_instructions / rerun_agent; partial when tied to items/stages.

Each signal carries a `suggestedTemplateImprovement`. `qualityCounts` covers all
5 qualities. `topNeedsRefinement` = up to 5 titles where quality is
needs_refinement or under_specified.

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 128
Agent/Tool Recommendation Memory (`useMemo` from record + graph/blocker/memory/
decision/action views). Shows: summary · quality counts · top needs refinement ·
signal cards (type, quality, title, summary, supporting signals, blocker types,
related areas/evidence/stages, suggested template improvement) · "Not included
yet" · confidence. When none: *"No template effectiveness signals detected yet…"*.
Labeled **"Derived preview only — template effectiveness is not statistically
validated."**

## Deterministic limitations (intentional)
Single-workflow, derived from snapshots only — no cross-project analytics, no
model training, no persisted template-metrics table, no graph DB, no LLM, no
central-plane mutation, no execution.

## No persistence / migration / training
No D1 migration, no template metrics table, no cross-project analytics, no model
training, no central-plane mutation, no MCP publish, no billing, no deploy.

## Verification
- `apps/dashboard`: **386/386** tests (+15 template-effectiveness: per-type build,
  core signal types, area-with-blocker → needs_refinement, area-without-evidence →
  under_specified, evidence strong via tool fit, tool needs_refinement on blocker,
  stage strong, decision conservative, action needs_refinement, quality counts +
  topNeedsRefinement, no-signals empty input, cap, disclaimers, no proven/
  validated/trained claims, malformed-no-throw, deterministic), typecheck clean,
  build green (`/projects/new/intake` 30 kB). Lint = pre-existing `export/page.tsx`
  warning only.
- `apps/central-plane`: **1181/1181** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 130 — Outcome Improvement Graph Planning.
