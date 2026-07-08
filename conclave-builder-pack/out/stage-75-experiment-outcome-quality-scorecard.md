> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 75 — Outcome Quality Scorecard

**Goal.** Answer one question deterministically: *did this experiment actually move
the idea toward a better product outcome?* — using **only** acceptance results and
recorded evidence. No LLM judgment, no "the AI says this is good."

## What shipped

A deterministic scorecard, **computed on demand** (no new D1 table — the score
formula will keep evolving, so persisting it now would be premature migration debt).

### Backend (`apps/central-plane`)

- `src/workspace/experiment-outcome-scorecard.ts` — pure helper `computeOutcomeScorecard`.
  - **Basis candidate** = `selectedCandidateId` → benchmark winner → blocker basis → first candidate.
  - **Quality metrics** (from the basis candidate's benchmark metrics + item outcomes):
    `acceptancePassRate`, `unresolvedBlockerCount`, `criticalIssueCount`,
    `notVerifiedCount`, `needsDecisionCount`, `evidenceCoverageRate`, `score`, `grade`.
  - **Score** = `passed*3 − failed*3 − needsDecision*2 − inconclusive*1 + evidenceCovered*0.5`.
  - **Grade** = `inconclusive` (no benchmark / no selected / no items / null pass rate)
    → `strong` (passRate ≥ 0.85 & no critical & ≤1 not-verified)
    → `promising` (passRate ≥ 0.65 & ≤1 critical) → `needs_work`.
  - **Next evolution** (rule-based, first match):
    `create_benchmark` → `clarify_acceptance_items` / `rerun_experiment` (no selection)
    → `clarify` (misaligned acceptance sets) → `accept` (strong)
    → `fix_selected` (remaining blockers) → `clarify` (≥2 not-verified)
    → `rerun` (≥2 critical) → `accept`.
  - **Suggested focus items** = non-passed items, prioritised `failed > needs_decision > inconclusive`, top 5.
  - **Reasons** = explainable codes (`strong_acceptance_result`,
    `selected_candidate_has_remaining_blockers`, `acceptance_set_misaligned`,
    `high_not_verified_count`, `missing_benchmark`, `missing_selected_candidate`).
- `src/routes/workspace-experiment.ts` — `GET …/agent-experiments/:experimentId/outcome-scorecard?userKey=`.
  Ownership-validated (project + userKey), loads the linked benchmark via
  `candidate.benchmarkId`, reuses existing benchmark calc (no duplication), returns
  `{ ok: true, scorecard }`.

### Dashboard (`apps/dashboard`)

- `src/lib/outcome-labels.mjs` (+ `.d.mts`) — pure `gradeLabelKey` / `actionLabelKey` /
  `reasonLabelKey` mapping server codes → i18n keys (keeps the contract testable, UI thin).
- `src/lib/workspace-experiment-api.ts` — `getOutcomeScorecard` + `OutcomeScorecard` type.
- `src/app/projects/[id]/experiment/page.tsx` — **Outcome quality** section in the open
  experiment detail: grade badge + score, metric grid (pass rate / critical / not verified /
  needs decision / unresolved blockers / evidence coverage), recommended next step + reasons,
  suggested focus item chips, and actions **Open benchmark evidence** /
  **Create fix instructions** / **Plan another experiment**. Reloads on open / decision / handoff.
- i18n `outcome.*` namespace (EN + KO + `.d.mts`).

## Product copy guardrails

Deliberately avoided "Best agent" / "AI says this is good". Used **"Outcome quality"**,
an acceptance-based grade, and the standing disclaimer:

> *This scorecard is based on acceptance results and recorded evidence, not a subjective model judgment.*

## Tests

- `apps/central-plane/test/experiment-outcome-scorecard.test.mjs` — 9 (grade tiers,
  recommendation routing, focus priority, evidence coverage, score formula).
- `apps/central-plane/test/workspace-agent-experiment.test.mjs` — +3 endpoint tests
  (no-benchmark → inconclusive/create_benchmark; auth 400/403; benchmark+selected → graded).
- `apps/dashboard/test/outcome-labels.test.mjs` — 6 (every code maps to an existing
  EN+KO key, fallbacks).
- Full suites green: central-plane **1005**, dashboard **141**, repo typecheck **54**.

## Not done (out of scope / guardrails honoured)

No D1 table, no acceptance-item auto-create/edit, no LLM judgment, no benchmark
score/recommendation logic change, no new migration, no MCP tool, no billing/debit change.
