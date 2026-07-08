> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 80 — Experiment Evolution Impact Summary

**Goal.** Roll up Stage 79's per-pack before/after impact into one
experiment-level **Evolution Impact Summary** so the user can see whether the
evolution loops they ran on this experiment trend the right way overall — not
just one pack at a time. Deterministic aggregation that reuses (never
re-implements) Stage 79's `buildImpactComparison` per pack. **No LLM. No
agent auto-run. No benchmark auto-create. No impact-summary persistence
(formula will keep evolving). Stage 75 scorecard formula unchanged.**

## Aggregate impact summary model

`apps/central-plane/src/workspace/evolution-impact-summary.ts` — pure
deterministic aggregator. Exposed:

- `buildEvolutionImpactSummary({ projectId, experimentId, entries })`

Entry shape (`EvolutionImpactSummaryEntry`):

```ts
{ comparison: EvolutionImpactComparison; followed: boolean; recommendedAction: string }
```

Output shape (`EvolutionImpactSummary`):

```ts
{
  projectId, experimentId,
  actionPackCount, followedPackCount,
  verdictCounts: { improved, regressed, unchanged, inconclusive },
  recommendedActionCounts: Record<string, number>,
  recommendedActionVerdicts: Array<{ recommendedAction, total, improved, regressed, unchanged, inconclusive }>,
  averageDelta: { passRateDelta, criticalIssueDelta, notVerifiedDelta, blockerDelta }, // each null when no pack contributed
  overallVerdict: "mostly_improved" | "mixed" | "mostly_inconclusive" | "no_followups" | "regressed",
  reasons: EvolutionImpactSummaryReason[],
  limitations: string[],
}
```

Reason enum:

```
no_saved_action_packs · no_followups
more_improved_than_regressed · regressions_detected
mostly_inconclusive · mixed_results
not_enough_comparable_data
```

`recommendedActionVerdicts` is alphabetically sorted so UI tables and golden
tests stay stable. `limitations` is the de-duplicated, sorted union of every
per-pack limitation, so the user sees in one place which packs hit
"before_benchmark_other_owner" or "pack_json_unreadable" etc.

## Source data / reuse of Stage 79 impact helper

The summary endpoint deliberately does **not** re-derive verdict rules — it
loops every saved action pack for the experiment and runs each through
**Stage 79's `buildImpactComparison`** via the new shared
`loadImpactForActionPack(env, row, opts)` helper extracted from the
Stage 79 route. The same helper now powers BOTH endpoints:

- `GET …/evolution-action-packs/:actionPackId/impact` (Stage 79, per pack)
- `GET …/evolution-impact-summary` (Stage 80, aggregate)

so the per-pack verdict can never drift between the two surfaces.

Source resolution per pack (unchanged from Stage 79):
- **before**: `pack.benchmarkId` (Stage 77 column) → experiment's linked
  benchmark fallback (hoisted ONCE per summary call) → null
- **after**: `followup_benchmark_id` (Stage 78) → `followup_review_run_id`
  fallback → null

The experiment-candidates fallback lookup is hoisted before the loop, so a
10-pack summary makes a single candidates query instead of 10.

## Followed pack detection

A pack counts as "followed" when ANY of these is true (per spec):

- `followup_status !== "not_started"`
- `followup_review_run_id` is set
- `followup_benchmark_id` is set
- `followup_pull_request_number` is set

This means `Mark as copied` (Stage 78) counts a pack as followed even when
no review/benchmark exists yet — the impact comparison itself will still come
back inconclusive, but the followed-count rises so the user can see the
intent was recorded. Documented as a known limitation.

## Average delta / overall verdict rules

### Average delta

Simple **unweighted** mean per metric (per Stage 80 spec — no weighting by
total item count). Each metric's mean ignores packs whose delta is null:

```
averageDelta.passRateDelta     = mean of comparison.delta.passRateDelta (non-null only)
averageDelta.criticalIssueDelta = …
averageDelta.notVerifiedDelta   = …
averageDelta.blockerDelta       = …
```

When no pack contributed any delta, every metric is `null` and the reason
list gains `not_enough_comparable_data`.

### Overall verdict (first matching rule wins)

```
actionPackCount == 0                                 → no_followups + no_saved_action_packs
followedPackCount == 0                               → no_followups + no_followups
inconclusive / total >= 0.70                         → mostly_inconclusive + mostly_inconclusive
verdictCounts.regressed > verdictCounts.improved     → regressed + regressions_detected
verdictCounts.improved  > verdictCounts.regressed && improved > 0
                                                     → mostly_improved + more_improved_than_regressed
else                                                 → mixed + mixed_results
```

Language constraint (per spec) — chrome text must use evidential phrasing
("Acceptance signals improved across more followed action packs than they
regressed.") not subjective claims ("the product is now better"). All summary
reason copy follows that rule.

## API endpoint

```
GET /workspace/projects/:id/agent-experiments/:experimentId/evolution-impact-summary?userKey=…
```

- `userKey` required (400 otherwise)
- Project + experiment ownership (404 / 403)
- Iterates saved packs via `listEvolutionActionPacks`, calls
  `getEvolutionActionPackById` per id for the full row (so `pack_json`,
  `selectedCandidateId`, `benchmarkId`, follow-up snapshot are all present)
- Defensive ownership re-check per row (skip silently if project/experiment/
  userKey shifted — would not happen in normal flow, immutable since Stage 77)
- Builds entries → calls `buildEvolutionImpactSummary` → returns
  `{ ok: true, summary }`
- **No D1 persistence, no migration.** On-demand only.

## Dashboard summary UI

`/projects/:id/experiment` — Outcome quality section, **above** the Saved
action packs list (per spec placement):

- New **Evolution impact summary** sub-card auto-loads on mount and re-fetches
  whenever `savedPacks` changes (after Save action pack, after follow-up
  Save — since both call `setSavedPacks(...)`)
- Color-coded overall verdict pill: mostly_improved = emerald, regressed =
  red, mixed = gray, mostly_inconclusive = amber, no_followups = white
- Two empty states, localized:
  - 0 saved packs → `Save an action pack and record follow-up results to see
    evolution impact.`
  - Packs saved, none followed → `Record follow-up review runs or benchmarks
    to compare before/after impact.`
- Metric grid (6 cells): Action packs · Followed packs · Improved (emerald) ·
  Regressed (red) · Unchanged (gray) · Inconclusive (amber)
- Average change panel: 4-column passRate / critical / not-verified / blockers
- Recommended action breakdown list: one row per action with
  `total · ↑improved · ↓regressed · =unchanged · ?inconclusive`
- Reasons list (localized bullets) + Limitations list (raw codes as chips
  for QA / debugging)
- Loading + error states inline

Helper `apps/dashboard/src/lib/evolution-impact-summary.mjs` (+`.d.mts`) —
display-only utilities: `summaryVerdictLabelKey`, `summaryReasonLabelKey`,
`formatAverageDeltaPercent`, `formatAverageDeltaCount`, `summaryHasNoFollowups`.

## I18N

`evolution.*` +30 keys (EN + KO + `.d.mts`):

- header: `summaryTitle`, `summaryDesc`, `summaryOverall`
- 5 verdict labels: `summaryMostlyImproved`, `summaryMixed`,
  `summaryMostlyInconclusive`, `summaryNoFollowups`, `summaryRegressed`
- metric labels: `summaryActionPacks`, `summaryFollowedPacks`,
  `summaryImprovedPacks`, `summaryRegressedPacks`, `summaryUnchangedPacks`,
  `summaryInconclusivePacks`, `summaryAverageChange`, `summaryActionBreakdown`
- empty states: `summaryEmptyPacks`, `summaryEmptyFollowups`
- 7 reason labels: `summaryReasonNoSavedPacks`, `summaryReasonNoFollowups`,
  `summaryReasonMoreImproved`, `summaryReasonRegressions`,
  `summaryReasonMostlyInconclusive`, `summaryReasonMixedResults`,
  `summaryReasonNotEnoughData`
- list headers: `summaryReasonsLabel`, `summaryLimitationsLabel`

i18n parity test still 10/10.

## Tests / build (local only)

- **Central aggregator** (`evolution-impact-summary.test.mjs`) — 11 tests:
  no entries / no followed / mostly_inconclusive / regressed / mostly_improved
  / mixed paths; recommendedAction breakdown counts; average delta ignores
  nulls; average all-null + not_enough_comparable_data; limitation dedup +
  sort; no userKey/token leakage.
- **Central endpoint** (`workspace-evolution-action-pack.test.mjs`) +8 Stage 80
  tests: missing userKey 400, unknown experiment 404, other user 403, no
  saved packs → no_followups + no_saved_action_packs, saved packs without
  follow-ups → no_followups + no_followups, mostly_improved end-to-end with
  benchmark + reviewRunId follow-up, recommendedAction breakdown surfaces
  every action, no userKey/token leakage in response.
- **Dashboard helpers** (`evolution-impact-summary.test.mjs`) — 6 tests:
  verdict / reason label parity vs dictionary, formatter signs + null
  fallback for percent + count, `summaryHasNoFollowups` empty-state
  predicate.
- **Bonus mock fix in `workspace-evolution-action-pack.test.mjs`**: added the
  missing `SET outcome` candidate UPDATE handler so updateCandidateOutcome
  no longer corrupts `benchmark_id`. This was a latent bug introduced in
  Stage 78 but only surfaced now because Stage 80 tests exercise both
  decision and POST action-pack in the same env.

```
central-plane: 1087/1087   (Stage 79 1068 → +19)
dashboard:     177/177     (Stage 79 171 → +6)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `next build` blocked locally on Google Fonts (`SELF_SIGNED_CERT_IN_CHAIN`
fetching Geist/Geist Mono) — sandbox network policy, unrelated to Stage 80
code. Same environment issue documented in Stages 77 / 78 / 79.

## Local verification

```
central-plane test: 1087/1087
dashboard test:     177/177
typecheck:          54/54
lint:               clean (pre-existing export/page warning only)
next build:         skipped (sandbox env: Google Fonts blocked by
                    SELF_SIGNED_CERT_IN_CHAIN — unrelated to Stage 80)
```

Per the operating rule:

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule** (Stage 80 added no
  migration — summary is on-demand only).
- **Live verification: skipped by operating rule.**

## Known limitations

- **No persistence.** Every summary GET recomputes from D1. Acceptable while
  the formula evolves; persistence becomes attractive when summaries cross
  more than one experiment.
- **`Mark as copied` counts as followed even without a review/benchmark.**
  Documented in the followed-pack detection rule. The impact for such a pack
  is still inconclusive, so the user sees followedPackCount > 0 but
  improved + regressed counts stay at 0.
- **Average delta is unweighted.** A 4-item pack and a 40-item pack
  contribute equally. When real evolution loops produce wildly different
  scales, switching to item-count weighting is a Stage 81+ decision.
- **N + 1 DB queries.** One `listEvolutionActionPacks` + per-pack
  `getEvolutionActionPackById` + per-pack `getAgentBenchmarkById` /
  `getReviewRunById`. Fine for typical 1–10 packs/experiment; if real users
  hit dozens, a JOIN-style fetch becomes worth it.
- **No cross-experiment view.** Per-experiment only. Project-level rollup is
  Stage 81+.
- **Status state-machine still absent** (Stage 78 / 79 limitation).

## Stage 81 recommendation

- **Project-level rollup.** "Across all of project P's experiments,
  X improved / Y regressed / Z inconclusive." Becomes useful once a project
  has multiple completed experiments.
- **Federated impact signal** (anonymized): `{recommendedAction,
  overallVerdict, packCount, day_bucket, sha256}`. Let the federation learn
  which actions actually move the needle across the user base.
- **Item-count weighted averages** behind a feature flag, so we can compare
  unweighted vs weighted on real data before flipping the default.
- **Summary persistence (snapshot at decision)** — record the summary at
  the moment the experiment is "completed" so the dashboard can show "this
  experiment's evolution impact at completion time" historically.
- **Status state-machine driven by summary** — if `mostly_improved` and
  every followed pack has a benchmark, suggest the user mark the experiment
  itself completed.
- (Carry-over) Revoke exposed Vercel token from earlier sessions.
