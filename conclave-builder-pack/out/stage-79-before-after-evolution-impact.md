> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 79 — Before/After Evolution Impact Comparison

**Goal.** Use the follow-up data recorded in Stage 78 to answer the previously
unanswerable question: *did this action pack actually improve the outcome?*
Build a deterministic before/after comparison between the action pack's source
benchmark and the linked follow-up benchmark or review run. **No LLM, no agent
auto-run, no benchmark auto-create, no branch/commit/patch, no billing/scope
change. No persistence in Stage 79.** Stage 75 scorecard formula unchanged.

## Impact comparison model

`apps/central-plane/src/workspace/evolution-impact.ts` — pure, deterministic,
no network/random/LLM. Exposed:

- `snapshotFromBenchmark(benchmark, { sourceId, selectedCandidateId?, packTargetCandidateId? })`
- `snapshotFromReviewRun(resultJson, { sourceId })`
- `buildImpactComparison({ actionPackId, experimentId, projectId, recommendedAction, before, after, limitations? })`

Types (TS, mirrored to dashboard `EvolutionImpactComparison`):

```ts
type EvolutionImpactSnapshot = {
  source: "benchmark" | "review_run";
  sourceId: string;
  passRate, passedCount, failedCount, inconclusiveCount, needsDecisionCount,
  criticalIssueCount, notVerifiedCount, blockerCount, totalCount: number;
  itemIds?: string[];
};
type EvolutionImpactDelta = {
  passRateDelta: number | null;
  passedDelta, criticalIssueDelta, notVerifiedDelta, blockerDelta: number;
};
type EvolutionImpactVerdict = "improved" | "regressed" | "unchanged" | "inconclusive";
```

`blockerCount = failed + needsDecision + inconclusive` (uniform across both
source types). `passRate` is `null` only when total = 0 — never derived from
fuzzy estimates.

## Before / after source selection

### Before (priority order)

1. `actionPack.benchmarkId` column (Stage 77 — the benchmark linked to the pack
   at save time).
2. Fallback: walk the experiment's candidates, pick the first `benchmarkId`.
3. If neither resolves → `before = null`, verdict = inconclusive + reason
   `missing_before`.

When the benchmark loads, the basis candidate is chosen by:
`selectedCandidateId` → `packTargetCandidateId` (read from `pack_json`) →
`recommendation.winnerCandidateId` → `blockerBasisCandidateId` → first
candidate. Same hierarchy as Stage 75 scorecard for consistency.

### After (priority order)

1. `followup_benchmark_id` (Stage 78) — snapshot from candidate metrics.
2. `followup_review_run_id` (Stage 78) — snapshot built directly from
   `resultJson.results[]` by counting `passed / failed / inconclusive /
   needs_decision`.
3. If neither resolves → `after = null`, verdict = inconclusive + reason
   `missing_followup` + `missing_after`.

Both sides re-validate `projectId + userKey` on the linked benchmark /
review run. A row from another owner is treated as unloadable; the
`limitations` array gets a hint (`before_benchmark_other_owner`,
`after_review_run_other_owner`, …) so the dashboard can show *why* the
comparison couldn't include that data.

## Delta / verdict rules

```
passRateDelta     = after.passRate     - before.passRate            (null if either null)
passedDelta       = after.passedCount  - before.passedCount
criticalIssueDelta = after.criticalIssueCount - before.criticalIssueCount
notVerifiedDelta  = after.notVerifiedCount   - before.notVerifiedCount
blockerDelta      = after.blockerCount  - before.blockerCount
```

Improvement signals (per spec):
- `passRateDelta > 0` → reason `pass_rate_increased`
- `criticalIssueDelta < 0` → reason `critical_issues_decreased`
- `blockerDelta < 0` → reason `blockers_decreased`
- `notVerifiedDelta < 0` → reason `not_verified_decreased`

Regression signals:
- `passRateDelta < 0` → reason `pass_rate_decreased`
- `criticalIssueDelta > 0` → reason `critical_issues_increased`
- `blockerDelta > 0` → reason `blockers_increased`
- (per spec: `notVerifiedDelta > 0` is *not* counted as regression — high
  not-verified is an evidence-quality concern, not a regression.)

Verdict (first match wins):

```
before||after missing                    → inconclusive (missing_*)
item ID sets differ (when both present)  → inconclusive + different_acceptance_set
hasImprovement && hasRegression          → inconclusive + mixed_signals
hasImprovement                           → improved
hasRegression                            → regressed
neither                                  → unchanged
```

The acceptance-set guard only fires when **both** snapshots expose `itemIds`.
Skipping the guard when one side has no item IDs prevents false negatives
(summary-only counts vs. item-level results).

## API endpoint

```
GET /workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId/impact?userKey=…
```

- `userKey` required (400 otherwise)
- Project + experiment + pack ownership (404 / 403)
- Loads before + after deterministically per spec, builds comparison via the
  canonical helper, returns `{ ok: true, impact }`.
- **No D1 table, no migration.** Impact is computed on demand; the formula
  will keep evolving and persisting early creates migration debt (same
  rationale as Stage 75 scorecard).

## Dashboard impact UI

`/projects/:id/experiment` — opened saved-pack detail card → new
**Evolution impact** sub-card immediately after Follow-up:

- Auto-loads on opened pack change + on `userKey` / experiment change.
- Verdict pill (color-coded: improved = emerald, regressed = red, unchanged =
  gray, inconclusive = amber).
- Three sibling cards: Before · After · Delta — each with pass rate, critical
  issues, not verified, blockers.
- Reasons list (chips, localized via `impactReasonLabelKey`).
- Limitations list (preserved as raw codes so QA can read them).
- Empty state: `Link a follow-up review run or benchmark to calculate impact.`
- Inconclusive explanation: `Impact is inconclusive because the required
  comparison data is missing or not aligned.`
- Loading + error states surface inline; the verdict block stays hidden
  until ready.

`apps/dashboard/src/lib/evolution-impact.mjs` (`.d.mts`) — display utilities:
`impactVerdictLabelKey`, `impactReasonLabelKey`, `formatDeltaInt` (signed),
`formatDeltaPercent`, `formatRate`, `isImpactEmpty`. Pure, tested.

## I18N

`evolution.*` namespace +38 keys (EN + KO + `.d.mts`):

- header / verdict chips: `impact`, `impactDesc`, `calculateImpact`,
  `impactVerdict`, `verdictImproved`/`verdictRegressed`/`verdictUnchanged`/`verdictInconclusive`
- snapshot block: `impactBefore`, `impactAfter`, `impactDelta`, `impactPassRate`,
  `impactCritical`, `impactNotVerified`, `impactBlockers`
- delta block: `deltaPassRate`, `deltaCritical`, `deltaNotVerified`,
  `deltaBlockers`
- 12 reasons: `reasonPassRateUp`, `reasonCriticalDown`, `reasonBlockersDown`,
  `reasonNotVerifiedDown`, `reasonPassRateDown`, `reasonCriticalUp`,
  `reasonBlockersUp`, `reasonMissingFollowup`, `reasonMissingBefore`,
  `reasonMissingAfter`, `reasonDifferentAcceptanceSet`, `reasonMixedSignals`
- empty/explanations: `impactMissingFollowup`, `impactInconclusiveExplanation`
- list headers: `impactReasons`, `impactLimitations`

i18n parity test still 10/10.

## Tests / build

- **Central helper** (`evolution-impact.test.mjs`) — 14 tests:
  - missing before+after / only after / only before → inconclusive variants
  - improved / regressed / unchanged paths
  - mixed signals → inconclusive + mixed_signals reason
  - different acceptance set → inconclusive + different_acceptance_set
  - alignment guard skipped when one side has no item IDs (no false negative)
  - `snapshotFromBenchmark` picks selected / falls back to winner→basis→first
  - `snapshotFromReviewRun` counts statuses, handles malformed / empty input
  - response leaks no userKey / token

- **Central endpoints** (`workspace-evolution-action-pack.test.mjs`) +9 Stage 79
  tests:
  - GET impact: missing userKey 400, unknown pack 404, cross-experiment 404,
    other user 403, no benchmark + no follow-up → inconclusive
  - improvement path (benchmark before + review-run follow-up) → improved
  - regression path → regressed
  - different acceptance set → inconclusive
  - full data: no userKey/token leakage in response

- **Dashboard helpers** (`evolution-impact.test.mjs`) — 8 tests: verdict label
  parity vs dictionary, reason label parity for all 12 reasons, delta
  formatters, rate formatter, `isImpactEmpty`, fallback for unknown input.

```
central-plane: 1068/1068   (Stage 78 1045 → +23)
dashboard:     171/171     (Stage 78 163 → +8)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `next build` blocked locally on Google Fonts (`SELF_SIGNED_CERT_IN_CHAIN`
fetching Geist/Geist Mono) — sandbox network policy, unrelated to Stage 79
code. Same environment issue documented in Stage 77/78.

## Local verification

Per the new operating rule:

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule** (Stage 79 added no
  migration anyway; the impact model is on-demand only).
- **Live verification: skipped by operating rule.**

Local verification:

```
central-plane test: 1068/1068
dashboard test:     171/171
typecheck:          54/54
lint:               clean (pre-existing export/page warning only)
next build:         skipped (sandbox env: Google Fonts blocked by self-signed
                    cert; documented in Stage 77/78, unrelated to Stage 79)
```

## Known limitations

- **No persistence.** Each impact GET recomputes from D1. Fine for MVP; if
  later stages add comparisons that aggregate across packs, persistence will
  become attractive.
- **Item-level alignment is exact match only.** Sorted itemId sets compared
  for equality; renamed item IDs across before/after look like
  `different_acceptance_set`. No fuzzy matching (per spec: "Do not overbuild
  fuzzy matching").
- **Cross-owner follow-up data falls silently into limitations.** A
  `followup_review_run_id` pointing to a row owned by another user is
  unloadable (defense in depth) but produces `after = null` rather than 403.
  Stage 78's PATCH ownership check should prevent this happening at write
  time; the read-side check is a redundant guard.
- **Before basis candidate is the same as scorecard's** (selected → winner →
  basis → first). If the action pack was for `accept` and the user later
  changed `selectedCandidateId`, the before snapshot follows the *current*
  selection, not the save-time selection. Stage 80+ can lock the basis in
  the saved pack snapshot if needed.
- **Verdict thresholds are zero-based.** Even a +1% pass rate counts as
  improvement. A configurable epsilon could land in a later stage if real
  data shows too much noise.
- **No CSV / export.** The impact UI is read-only.

## Stage 80 recommendation

- **Aggregate impact view across saved packs.** For an experiment, show
  "5 saved packs, 3 improved, 1 regressed, 1 inconclusive" so the user can
  see whether their evolution loops actually trend the right way.
- **Federated impact signal** (anonymized): `{recommendedAction, verdict,
  hasFollowup, day_bucket, sha256}`. Lets the federation learn which
  `recommendedAction` types most often lead to improvement.
- **State-machine on follow-up status driven by impact.** E.g. once impact
  has been computed and shows `improved` + `verdict==strong`, allow the
  follow-up status to advance to `completed` automatically (user-confirmed,
  not server-side automatic).
- **Lock saved-pack basis at save time.** Record the resolved basis candidate
  + selected candidate inside `pack_json` so impact's before snapshot is
  stable across later experiment decision changes.
- **Configurable thresholds** for what counts as a meaningful delta.
- (Carry-over) Revoke exposed Vercel token from earlier sessions.
