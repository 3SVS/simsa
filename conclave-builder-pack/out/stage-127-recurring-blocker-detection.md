> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 127 — Recurring Blocker Detection

**Date:** 2026-06-24
**Train:** Acceptance Graph / Moat (Stage 126~132) · branch `feat/stage-126-acceptance-graph-view` · PR #148 (do not merge until Stage 132 checkpoint).

## Goal
First **moat signal** feature: deterministic **Recurring Blocker Detection** from
the derived Acceptance Graph (Stage 126) + saved workflow snapshots. Simsa begins
to identify repeated acceptance blockers and evidence gaps from workflow
**structure** — still preview-only, derived, **no model training, no graph DB, no
new migration.**

```
Acceptance Graph Derived View → Recurring Blocker Signals
```

## Product principle
Not "universal truth discovered". The claim is: *these blocker patterns appear
repeatedly in this workflow and may deserve attention before review, release, or
rerun.* Vocabulary: recurring blocker signal / repeated evidence gap / likely
review blocker / needs attention / derived from this saved workflow. Avoided:
proven root cause / guaranteed blocker / verified defect / model-learned issue /
production risk confirmed.

## Helper — `apps/dashboard/src/lib/recurring-blocker-detection.mjs` (+ `.d.mts`)
`buildRecurringBlockerDetectionView(input): RecurringBlockerDetectionView` —
pure, deterministic, dashboard-side. Reuses Stage 126
`buildAcceptanceGraphDerivedView` (uses the supplied graph view, or builds one).
Inputs are `unknown` snapshots; every accessor is defensive (malformed → no
throw). **Blockers are NOT fabricated when signal is weak.**

```ts
RecurringBlockerSignal = { id, type, severity, title, summary, sourceSignals[],
  relatedAcceptanceAreas[], relatedEvidenceTypes[], relatedStageNumbers[],
  relatedTaskIds[], suggestedNextAction }
RecurringBlockerDetectionView = { workflowRecordId?, title, summary, blockers[],
  topBlockerType?, blockerCountByType, notIncludedYet[], confidence }
```

## Detection rules (0–6 blockers)
- **missing_evidence** — same evidence type recurs (≥2) across expectations, or
  high evidence count + not_verified.
- **not_verified_cluster** — `notVerifiedCount >= 2` (high when ≥4).
- **release_readiness_gap** — release area/stage present AND its evidence is
  unresolved (not_verified/needed/needs_decision) → **high**.
- **fix_rerun_cluster** — ≥2 fix/rerun signals across decision impacts + action
  previews (high when ≥3).
- **unclear_acceptance_scope** — missing questions / `missing_detail` items /
  clarify actions.
- **tooling_gap** (conservative) — a recommended tool's expected evidence types
  (browser_check→screenshot/walkthrough, test_run→test/build, github_pr_review→
  pr_link/review_note) appear nowhere AND there are not_verified items.

## Severity rules
- **high**: release readiness gap · fix/rerun cluster with multiple signals ·
  not_verified cluster with many items.
- **medium**: repeated missing evidence · unclear acceptance scope · moderate
  not_verified cluster.
- **low**: single weak signal (e.g. conservative tooling gap).

Each blocker carries one `suggestedNextAction` (collect evidence / resolve
not-verified / not release-ready until evidence / focused fix-or-rerun / clarify
scope / align tool with evidence). `topBlockerType` = highest severity, then
type order. `blockerCountByType` covers all six types.

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 126
Acceptance Graph Derived View (`useMemo` from record + graph view + decision/
action previews). Shows: summary · top blocker type · blocker cards (type,
severity, title, summary, source signals, related areas/evidence/stages,
suggested next action) · "Not included yet" · confidence. When none:
*"No recurring blocker signals detected yet. This does not mean the workflow is
verified…"*. Labeled **"Derived preview only — blocker signals are not verified
defects."**

## Deterministic limitations (intentional)
Single-workflow, derived from snapshots only — no cross-project model/training, no
persisted blocker table, no graph database, no LLM, no central-plane mutation, no
auto-fix/rerun.

## No persistence / migration / training
No D1 migration, no blocker table, no graph DB, no model training, no central-plane
mutation, no MCP publish, no billing, no deploy.

## Verification
- `apps/dashboard`: **356/356** tests (+12 recurring-blocker: per-type build,
  missing-evidence, not_verified cluster (high), release readiness gap (high),
  fix/rerun cluster, unclear scope, conservative tooling gap (+ negative case),
  no-blockers on minimal input, cap at 6, disclaimers, no verified/proven claims,
  malformed-no-throw, deterministic), typecheck clean, build green
  (`/projects/new/intake` 26.6 kB). Lint = pre-existing `export/page.tsx` warning
  only.
- `apps/central-plane`: **1181/1181** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 128 — Agent/Tool Recommendation Memory.
