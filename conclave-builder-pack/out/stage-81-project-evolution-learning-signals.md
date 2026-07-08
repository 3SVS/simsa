> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 81 — Project Evolution Learning Signals

**Goal.** Roll Stage 79's per-pack and Stage 80's per-experiment impact up to
the **project level** so the user can see which `recommendedAction` types
actually moved their outcome — not just per loop, but across the whole
project. Pure deterministic aggregation that reuses the Stage 79
`loadImpactForActionPack` helper for every pack. **No LLM. No agent auto-run.
No persistence (rank thresholds will keep evolving). No federated/global
learning signal yet. Stage 75 scorecard formula and Stage 79/80 verdict
rules unchanged.**

## Project-level learning model

`apps/central-plane/src/workspace/project-evolution-learning.ts` — pure
deterministic aggregator. Exposed:

- `buildProjectEvolutionLearning({ projectId, experimentCount, entries })`

Entry shape (`ProjectLearningEntry`):

```ts
{ comparison: EvolutionImpactComparison; followed: boolean; recommendedAction: string }
```

Output shape (`ProjectEvolutionLearningSignals`):

```ts
{
  projectId,
  experimentCount, actionPackCount, followedPackCount, comparablePackCount,
  verdictCounts: { improved, regressed, unchanged, inconclusive },
  recommendedActionEffectiveness: Array<{
    recommendedAction, total, followed, comparable,
    improved, regressed, unchanged, inconclusive,
    improvementRate: number | null,   // improved / comparable
    regressionRate:  number | null    // regressed / comparable
  }>,
  averageDelta: { passRateDelta, criticalIssueDelta, notVerifiedDelta, blockerDelta },
  topSignals: ProjectLearningSignal[],
  limitations: string[],
}
```

`ProjectLearningSignal` union:

```ts
| { type: "action_often_improves";  recommendedAction; improved; totalComparable }
| { type: "action_often_regresses"; recommendedAction; regressed; totalComparable }
| { type: "not_enough_data" }
```

`recommendedActionEffectiveness` is alphabetically sorted; `limitations` is
the deduplicated, sorted union of every per-pack limitation. `topSignals`
is capped at 5 entries per spec.

## Source data / Stage 79 helper reuse

Stage 81 **never re-derives verdict rules**. The HTTP endpoint walks every
experiment owned by the userKey, hoists the experiment-fallback benchmark id
once per experiment (Stage 80 pattern), then for each saved action pack
runs the existing Stage 79 `loadImpactForActionPack(env, row, opts)` helper
to produce the `EvolutionImpactComparison`. The aggregator only counts +
ranks. Three surfaces — per-pack impact (Stage 79), per-experiment summary
(Stage 80), project-level learning (Stage 81) — share the same per-pack
verdict formula via the single shared helper.

Cross-tenant isolation:

1. `listExperiments(env, projectId)` returns lightweight items (no userKey).
2. Per item, `getExperimentById` returns the full row + userKey; experiments
   whose `userKey` !== request userKey are skipped silently before any
   action-pack query runs.
3. Per action pack row, the same project / experiment / userKey defensive
   recheck from Stages 79/80 applies before the impact load.

Verified end-to-end by the new `cross-tenant isolation` endpoint test:
an experiment created as `uk_other` in the same `project_id` namespace
contributes 0 packs and 0 experiments to user `uk_owner`'s response.

## Comparable / effectiveness rules

Per Stage 81 spec recommendation:

```
comparable = comparison.delta !== null  AND  comparison.verdict !== "inconclusive"
```

This excludes `mixed_signals`, `missing_followup`, `missing_before`,
`missing_after`, and `different_acceptance_set` packs from the learning
signal — they have a delta but the per-pack verdict already said the data
is not trustworthy. An `unchanged` pack with a real zero delta IS
comparable.

Per `recommendedAction`:

```
improvementRate = improved  / comparable   (null when comparable = 0)
regressionRate  = regressed / comparable   (null when comparable = 0)
```

## Top signal rules

Deterministic + conservative. First gate is project-wide:

```
comparablePackCount < 3        → topSignals = [{ type: "not_enough_data" }]
```

Otherwise, walk effectiveness in alphabetical order. For each action with
`comparable >= 2`:

```
improvementRate >= 0.67  → push { action_often_improves, ... }
regressionRate  >= 0.5   → push { action_often_regresses, ... }
```

Cap at 5 signals. If the project crosses the comparable bar but no per-
action signal fires (e.g. 3 comparable packs across 3 different actions),
the response still surfaces `{ type: "not_enough_data" }` so the dashboard
empty state has something to display.

Language constraint (per spec): chrome copy stays evidential ("Early signal:
fix_selected often improved (3/3)") and never overclaims ("this action is
the best", "always works"). All dictionary strings follow that rule.

## API endpoint

```
GET /workspace/projects/:id/evolution-learning?userKey=…
```

- `userKey` required (400 otherwise)
- Walks `listExperiments` → per item `getExperimentById` ownership filter →
  per owned experiment, `listEvolutionActionPacks` → per pack
  `getEvolutionActionPackById` → `loadImpactForActionPack` → entries
- Calls `buildProjectEvolutionLearning` → returns `{ ok: true, learning }`
- **No D1 persistence, no migration.** On-demand only.

`getProjectEvolutionLearning(projectId, userKey)` wrapper in
`apps/dashboard/src/lib/workspace-experiment-api.ts`.

## Dashboard learning signals UI

`/projects/:id` — **project detail page** (per spec preference: "Project
detail page, because this is project-level"). New section *Evolution
learning signals* below the requirements list:

- `EvolutionLearningCard` component reads userKey from `getUserKey()` and
  auto-loads on mount + when `userKey` resolves.
- 4-cell stat row: Experiments · Action packs · Followed packs · Comparable
  packs.
- Empty state (per spec): when no comparable packs, show
  `Run more followed action packs to see project-level learning signals.`
- When data is sufficient:
  - Color-coded verdict counts (Improved emerald / Regressed red /
    Unchanged gray / Inconclusive amber).
  - Average change panel (4 columns: passRate / critical / not-verified /
    blockers, signed).
  - Recommended action effectiveness table — one row per action with
    `comparable/total ↑↓?` AND improvement/regression rates.
- Top signals list — always rendered (incl. the `not_enough_data` empty
  pill) so QA can confirm the empty state is reached.
- Limitations chip list (raw codes for debugging).
- Final-line **disclaimer**:
  `This is based on project-local evidence, not a global model judgment.`

`apps/dashboard/src/lib/project-evolution-learning.mjs` (+`.d.mts`) —
display-only utilities: `topSignalLabelKey`, `formatRatePercent`,
`formatAverageDeltaPercent`, `formatAverageDeltaCount`, `learningHasNoData`.

## I18N

`evolution.*` +22 keys (EN + KO + `.d.mts`):

- header / chrome: `learningTitle`, `learningDesc`, `learningDisclaimer`
- stat labels: `learningExperiments`, `learningActionPacks`,
  `learningFollowedPacks`, `learningComparablePacks`
- analysis labels: `learningTopSignals`, `learningEffectiveness`,
  `learningImprovementRate`, `learningRegressionRate`, `learningAverageChange`
- empty states: `learningEmpty`, `learningNotEnoughData`
- signal copy: `learningEarlySignal`, `learningOftenImproved`,
  `learningOftenRegressed`, `signalActionImproves`,
  `signalActionRegresses`, `signalNotEnoughData`

i18n parity 10/10.

## Tests / build (local only)

- **Central aggregator** (`project-evolution-learning.test.mjs`) — 13 tests:
  every overall-verdict path (no entries / no comparable / mostly improved /
  often regresses), comparable definition matches spec (mixed_signals
  excluded), improvementRate/regressionRate null when comparable=0,
  project below MIN_PROJECT_COMPARABLE → not_enough_data, alphabetical
  effectiveness order, unweighted average mean, top signals capped at 5,
  dedup+sort limitations, no userKey/token leakage.
- **Central endpoints** (`workspace-evolution-action-pack.test.mjs`) +7
  Stage 81 tests: missing userKey 400, empty project → not_enough_data,
  experiments but no packs, only inconclusive packs, action_often_improves
  emerges across multiple experiments (full benchmark + follow-up review
  run flow per experiment), cross-tenant isolation (other user's
  experiments excluded), no leakage in real-data response.
- **Dashboard helpers** (`project-evolution-learning.test.mjs`) — 6 tests:
  signal label parity vs dictionary (including null/undefined/garbage
  fallback), `formatRatePercent` without sign, `formatAverageDeltaPercent`
  with sign, `formatAverageDeltaCount` with one decimal + sign,
  `learningHasNoData` predicate covers every empty-state combination,
  dictionary presence asserts for chrome copy that's used inline.
- **Test mock extension**: action-pack test mock now also serves
  `listExperiments(projectId)` results (was previously not needed because
  Stage 77/78/79/80 endpoints never enumerated experiments at the project
  level).

```
central-plane: 1107/1107   (Stage 80 1087 → +20)
dashboard:     183/183     (Stage 80 177 → +6)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `next build` blocked locally on Google Fonts (`SELF_SIGNED_CERT_IN_CHAIN`
fetching Geist/Geist Mono) — sandbox network policy, unrelated to Stage 81
code. Same environment issue documented in Stages 77–80.

## Local verification

```
central-plane test: 1107/1107
dashboard test:     183/183
typecheck:          54/54
lint:               clean (pre-existing export/page warning only)
next build:         skipped (sandbox env: Google Fonts blocked by
                    SELF_SIGNED_CERT_IN_CHAIN — unrelated to Stage 81)
```

Per the operating rule:

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule** (Stage 81 added no
  migration — learning signals are on-demand only).
- **Live verification: skipped by operating rule.**

## Known limitations

- **No persistence.** Each learning GET recomputes from D1. Acceptable
  while thresholds (0.67 improvement, 0.5 regression, 3 / 2 comparable
  gates) are still being tuned.
- **Project-wide N+M+P queries.** For a project with M experiments and P
  packs, that's 1 list + M `getExperimentById` + M `listExperimentCandidates`
  + M `listEvolutionActionPacks` + P `getEvolutionActionPackById` + P
  before-benchmark fetches + P follow-up fetches. Fine for typical project
  sizes (< 50 experiments per Stage 72 limit); a JOIN-style fetch becomes
  worth it when individual projects exceed that.
- **`listExperiments` capped at 50** (Stage 72 default). A 51st experiment
  silently drops out of the rollup until pagination is added.
- **No cross-project view.** Per-project only.
- **`Mark as copied` only counts as followed (not comparable)** — same
  policy as Stage 80. The impact for such a pack is inconclusive, so
  followed > comparable is the expected steady-state pattern.
- **Top-signal thresholds are hard-coded** (0.67 improvement, 0.5
  regression, 3 / 2 comparable counts). Will need tuning once real
  projects produce signal.
- **No trend / history.** Snapshot of current state only. Comparing
  "this week's learning vs last week's" is a Stage 82+ idea.
- **No federated / cross-tenant signal** (per Stage 81 prohibition).

## Stage 82 recommendation

- **Federated impact signal export** — anonymized, opt-in: `{kind,
  recommendedAction, verdict, comparable, day_bucket, sha256}`.
  Pipe to the federation rollup so cross-project learning becomes
  possible without leaking project content. (Matches the decision-21
  federated sync wire format.)
- **Trend over time** — keep a sliding window of (week, project,
  improvementRate) so the UI can show "the project's improvement rate is
  trending up / down". This is the natural follow-up to Stage 81's
  snapshot view.
- **Configurable thresholds** per project — let power users tune the
  improvement / regression bars when their projects have larger pack
  populations.
- **Project-level summary persistence at experiment-completion** — record
  the project's learning snapshot at the moment any experiment is
  decision-completed so historical "what we knew at the time" reads stay
  cheap.
- **Cross-project view (org-level)** for users with multiple projects —
  same aggregator, called once per project, surfaced as a leaderboard.
- (Carry-over) Revoke exposed Vercel token from earlier sessions.
