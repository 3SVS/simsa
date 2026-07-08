> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 114 — Agent Run Decision and Outcome Link

**Date:** 2026-06-23
**Train:** Agent Workflow Train (Stage 110~116) · branch `feat/stage-110-agent-run-plan` · PR #144 (do not merge until Stage 116).

## Goal
Add a deterministic **Decision / Outcome Link Preview** for a saved agent
workflow record. It shows how Simsa would eventually connect a workflow + its
benchmark handoff (Stage 113) to a decision (`accept / fix / rerun / defer /
not_verified`) and to the outcome concepts from Stages 74~76 (outcome decision,
outcome quality scorecard, action pack).

```
Saved Agent Workflow Record → Decision / Outcome Link Preview (this stage)
```

**Not** actual decision persistence, benchmark-result interpretation, or scorecard
creation — a planning/preview layer only.

## Product principle
Do not claim a decision was made. Vocabulary: decision candidate / outcome link
preview / needs evidence / not verified / decision criteria / future outcome.
Avoided as current claims: final decision / winner selected / accepted /
verified / passed / production ready (only appear as possible *future* decision
values or inside the `notIncludedYet` negations). Message: *Simsa does not just
compare outputs — it prepares the decision criteria needed to accept, fix, rerun,
defer, or keep work not verified.*

## Helper — `apps/dashboard/src/lib/intake-decision-outcome-link.mjs` (+ `.d.mts`)
`buildDecisionOutcomeLinkPreview(input): OutcomeLinkPreview` — pure,
deterministic, dashboard-side. Inputs are the saved record's `unknown` snapshots
(+ optional benchmark handoff preview), so every accessor is defensive.

```ts
OutcomeLinkPreview = {
  workflowRecordId?: string;
  title: string;
  summary: string;
  recommendedDecisionCandidate: "accept"|"fix"|"rerun"|"defer"|"not_verified";
  decisionCandidates: DecisionCandidate[]; // type,label,rationale,requiredEvidence,blockingQuestions,relatedAcceptanceItems,relatedStageNumbers
  outcomeScorecardSignals: { evidenceCompleteness; acceptanceCoverage; unresolvedRisk; releaseReadiness }; // each low|medium|high
  futureOutcomeLinks: string[];
  notIncludedYet: string[];
  confidence: "low"|"medium"|"high";
}
```

### Decision candidate behavior
**All 5 candidates are always produced**, each with a rationale describing when it
applies and fields derived from the Evidence Plan expectations:
- **accept** — required evidence from primary-flow/release-readiness areas
  (fallback "Evidence for the primary flow / release readiness"); blocking
  questions from missing-evidence questions; relates to all acceptance items/stages.
- **fix / rerun / defer** — derived from expectations whose `decisionImpact`
  matches; carry those items, stages, and evidence types (fallbacks: fix→fix
  summary/commit link, rerun→test/build result, defer→release decision note).
- **not_verified** — items with `not_verified`/`needs_decision` status; generic
  review/clarification evidence.

**Recommended candidate is conservative**: defaults to **`not_verified`** (no
real evidence is collected). Only a strong signal overrides it — `fix` when ≥2
fix-impact expectations, else `defer` when ≥2 defer-impact expectations.

### Scorecard signal behavior (signals for future linkage, not results)
- **evidenceCompleteness** — distinct expected evidence types: ≥6 high · ≥3
  medium · else low.
- **acceptanceCoverage** — acceptance item count: ≥6 high · ≥3 medium · else low.
- **unresolvedRisk** — missing questions + fix + rerun counts: ≥5 high · ≥2
  medium · else low.
- **releaseReadiness** — `medium` only when a release stage/gate AND
  release-readiness evidence exist; otherwise `low`. **Never `high`** (cannot be
  confirmed without collected evidence).

### Future outcome links / disclaimers
`futureOutcomeLinks`: link decision candidate → outcome decision · evidence
completeness → outcome scorecard · fix/rerun → action pack · unresolved risk →
follow-up tracking. `notIncludedYet`: no final decision saved · no benchmark
result interpreted · no outcome scorecard created · no action pack generated.

## UI — `/projects/new/intake`
Renders inside the **opened saved workflow record detail**, after the Stage 113
Benchmark Handoff Preview, derived deterministically via `useMemo` from the opened
record + handoff. Shows: recommended decision candidate, the 5 decision
candidates (recommended highlighted; rationale, items/stages, required-evidence
chips, blocking questions), outcome scorecard signals grid, future outcome links,
"Not included yet", confidence. Labeled **"Preview only — no decision, scorecard,
or action pack is created."** Appears only after a record is opened.

## Deterministic limitations (intentional)
Composed purely from saved snapshots — no decision persistence, no scorecard
generation/persistence, no action pack, no benchmark execution/interpretation, no
model/GitHub call, no central-plane mutation.

## No persistence / migration / execution
No D1 migration; no write to experiment/outcome/decision tables; no central-plane
endpoint; no agent execution, evidence upload, deploy, or domain change.

## Verification
- `apps/dashboard`: **295/295** tests (+9 decision-outcome), typecheck clean,
  build green (`/projects/new/intake` 18 kB). Lint = pre-existing
  `export/page.tsx` exhaustive-deps warning only.
- `apps/central-plane`: **1164/1164** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 115 — Evolution Action Pack from Agent Workflow.
