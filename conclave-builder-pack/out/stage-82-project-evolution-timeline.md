> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 82 — Project Evolution Timeline

**Goal.** Show the project's evolution as a single chronological story —
`experiment → benchmark → decision → action pack → follow-up → impact` —
so Conclave isn't just a per-pack/per-experiment dashboard but a record of
how AI-built software actually evolved. Pure deterministic timeline,
on-demand only, no LLM, no subjective summaries. **No persistence. No
federated/global signal. Stage 75 scorecard + Stage 79/80/81 verdict rules
unchanged.**

## Timeline model

`apps/central-plane/src/workspace/project-evolution-timeline.ts` — pure
deterministic builder. Exposed:

- `buildProjectEvolutionTimeline({ projectId, experiments, benchmarks, actionPacks })`

Event shape (`ProjectEvolutionTimelineEvent`):

```ts
{
  id: string;        // stable: "<type>:<entity_id>"
  type: 9 enum values;
  occurredAt: string;
  experimentId? / benchmarkId? / actionPackId?;
  title: string;     // canonical English; dashboard re-localizes via i18n
  summary: string;   // experiment / benchmark / action-pack title
  status? / recommendedAction? / verdict?;
  href: string;      // relative dashboard path
}
```

The nine event types:

```
experiment_created · benchmark_created · decision_recorded
action_pack_saved · followup_recorded
impact_improved · impact_regressed · impact_unchanged · impact_inconclusive
```

Every title is a fixed canonical English string from a `CANONICAL_TITLE`
table; the dashboard re-localizes via `timelineEventLabelKey(type)` → i18n
key. Per spec: deterministic event titles + structured fields only, no
LLM-generated summaries.

## Source data / event construction

Per spec mapping (event type → source field):

| Event                  | Source                                    | occurredAt              |
|------------------------|-------------------------------------------|-------------------------|
| `experiment_created`   | `experiments[*]`                          | `exp.createdAt`         |
| `decision_recorded`    | `experiments[*].decidedAt` (when present) | `exp.decidedAt`         |
| `benchmark_created`    | unique `benchmarkId`s from owned experiments' candidates | `benchmark.createdAt` |
| `action_pack_saved`    | `actionPacks[*]`                          | `pack.createdAt`        |
| `followup_recorded`    | `pack.followup.followedAt` (when present) | `followedAt`            |
| `impact_*`             | Stage 79 `loadImpactForActionPack` result | `followedAt`            |

Per Stage 82 spec recommendation, **impact events are only emitted when the
pack actually has a follow-up** (`followedAt` set). For packs with
`followup.status === "not_started"`, the route handler skips the impact
computation entirely — saves a benchmark/review-run fetch per fresh pack
AND avoids displaying impact verdicts that were never recorded.

The HTTP handler is the only place that talks to D1. The pure builder
takes pre-loaded inputs so it stays trivially testable.

### Reuse of Stage 79

Impact verdicts come from the SAME shared `loadImpactForActionPack(env,
row, opts)` helper used by Stage 79 GET impact, Stage 80 GET summary, and
Stage 81 GET learning. Four surfaces, one verdict formula — no drift.

### Cross-tenant isolation

Identical pattern to Stages 80/81:

1. `listExperiments(projectId)` returns lightweight items
2. Per-item `getExperimentById` ownership check (silent skip if userKey mismatch)
3. Per-owned-experiment, the benchmark IDs collected from candidates are
   re-validated through `getAgentBenchmarkById` projectId + userKey match
4. Per pack row, same defensive project/experiment/userKey re-check

Verified end-to-end by the `cross-tenant isolation` endpoint test — an
experiment created by `uk_other` in the same `project_id` namespace
contributes 0 events to user `uk_owner`'s timeline.

## Sorting / limit rules

```
sort: occurredAt DESC, then id ASC (golden stability)
cap:  50 events
overflow: limitations.push("timeline_truncated")
```

Tie-break by event id is alphabetical for deterministic ordering when
multiple events share an exact timestamp (e.g., impact_* + followup_recorded
are both anchored to `followedAt`).

## API endpoint

```
GET /workspace/projects/:id/evolution-timeline?userKey=…
```

- `userKey` required (400 otherwise)
- Walks experiments + benchmarks + action packs (+ impacts via Stage 79
  helper for followed packs)
- Calls `buildProjectEvolutionTimeline` → returns `{ ok: true, timeline }`
- **No D1 table, no migration.** On-demand only.

Errors: `userKey_required` / `timeline_failed`.

`getProjectEvolutionTimeline(projectId, userKey)` wrapper in
`apps/dashboard/src/lib/workspace-experiment-api.ts`.

## Dashboard timeline UI

`/projects/:id` — **project detail page** (per spec placement), in a new
section *Evolution timeline* below the Evolution learning signals section.

`EvolutionTimelineCard`:

- Reads userKey via `getUserKey()`, auto-loads on mount + when userKey
  resolves
- Loading / error / empty states inline
- Empty state copy:
  `Create experiments and save action packs to build this project's evolution timeline.`
- Each event as a card row via `TimelineEventRow`:
  - Color-coded event-type pill via `badgeClassForEventType()`:
    - impact_improved = emerald
    - impact_regressed = red
    - impact_unchanged = gray
    - impact_inconclusive = amber
    - decision_recorded = indigo
    - benchmark_created = blue
    - experiment_created = slate
    - action_pack_saved = purple
    - followup_recorded = teal
  - Localized event title (via `timelineEventLabelKey` → `t.evolution[key]`)
  - Optional `status` and `recommendedAction` mono-font chips
  - Summary line (experiment / benchmark / action-pack title)
  - Localized timestamp via `toLocaleString()`
  - **Open** link via Next.js `<Link href={event.href}>` when href is set —
    server emits relative paths (`/projects/:id/experiment?experiment=…`
    or `/projects/:id/benchmark/:benchmarkId`); dashboard does not derive
- Limitations row at the bottom — `timeline_truncated` is rendered as a
  localized amber pill.

`apps/dashboard/src/lib/project-evolution-timeline.mjs` (+`.d.mts`) —
display-only utilities: `TIMELINE_EVENT_TYPES`, `timelineEventLabelKey`,
`timelineLimitationLabelKey`, `timelineHasNoEvents`.

## I18N

`evolution.*` +15 keys (EN + KO + `.d.mts`):

- chrome: `timelineTitle`, `timelineDesc`, `timelineEmpty`, `timelineOpen`
- 9 event labels: `timelineExperimentCreated`, `timelineBenchmarkCreated`,
  `timelineDecisionRecorded`, `timelineActionPackSaved`,
  `timelineFollowupRecorded`, `timelineImpactImproved`,
  `timelineImpactRegressed`, `timelineImpactUnchanged`,
  `timelineImpactInconclusive`
- limitation: `timelineTruncated`

i18n parity test still 10/10.

## Tests / build (local only)

- **Central builder** (`project-evolution-timeline.test.mjs`) — 15 tests:
  empty project, every event type happy path, decision only when decidedAt
  set, followup only when followedAt set, impact only when both follow-up
  AND impact provided, no impact when followup missing (defensive — would
  be filtered at the route layer anyway), every impact verdict maps
  correctly (improved/regressed/unchanged/inconclusive), sort desc by
  occurredAt, tie-break by event id, cap at 50 events + `timeline_truncated`
  limitation, href encoding for unsafe ids, no userKey/token leakage.
- **Central endpoint** (`workspace-evolution-action-pack.test.mjs`) +9
  Stage 82 tests: missing userKey 400, empty project, experiment_created
  surfaces with href, action_pack_saved per pack, followup_recorded when
  followedAt stamped, impact_improved end-to-end with benchmark + review-
  run follow-up, events sorted desc by experiment createdAt, cross-tenant
  isolation, no userKey/token leakage in real-data response.
- **Dashboard helpers** (`project-evolution-timeline.test.mjs`) — 5 tests:
  TIMELINE_EVENT_TYPES enumerates the spec 9, event label parity for all
  9 event types vs dictionary, fallback for unknown input,
  `timelineLimitationLabelKey` maps `timeline_truncated` + passes through
  unknown codes, `timelineHasNoEvents` predicate, inline chrome strings
  exist in dictionary.

```
central-plane: 1131/1131   (Stage 81 1107 → +24)
dashboard:     188/188     (Stage 81 183 → +5)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `next build` blocked locally on Google Fonts
(`SELF_SIGNED_CERT_IN_CHAIN` fetching Geist/Geist Mono) — sandbox network
policy, unrelated to Stage 82 code. Same environment issue documented in
Stages 77–81.

## Local verification

```
central-plane test: 1131/1131
dashboard test:     188/188
typecheck:          54/54
lint:               clean (pre-existing export/page warning only)
next build:         skipped (sandbox env: Google Fonts blocked by
                    SELF_SIGNED_CERT_IN_CHAIN — unrelated to Stage 82)
```

Per the operating rule:

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule** (Stage 82 added no
  migration — timeline is on-demand only).
- **Live verification: skipped by operating rule.**

## Known limitations

- **No persistence.** Each timeline GET recomputes from D1.
- **Cap at 50 events** with `timeline_truncated` limitation. Pagination
  beyond the most-recent 50 is a Stage 83+ item.
- **N+M+P+B queries per request** (1 list-experiments + M getExperimentById
  + M listCandidates + M listEvolutionActionPacks + P getEvolutionActionPackById
  + P loadImpactForActionPack + B getAgentBenchmarkById). Fine for typical
  project size (< 50 experiments per Stage 72 limit).
- **No event filtering / type toggles.** The card shows all event types in
  one stream. Filter chips can land in Stage 83+.
- **Server emits relative dashboard hrefs.** Couples the server format
  loosely to the dashboard URL structure; if the dashboard route shape
  changes, the server format must follow.
- **No grouping by week / day.** Events are a flat list. A grouped
  timeline view is a Stage 83+ idea.
- **No federated / cross-project view.** Per-project only.
- **Status state-machine still absent** (carry-over from earlier stages).

## Stage 83 recommendation

Stage 82 closes the Stage 79–82 evolution-record arc. Strong candidates
for the next stage:

- **Release checkpoint** — apply the Stage 77–82 migrations to remote D1,
  deploy central-plane + dashboard, and run live verification. Per the
  operating rule, this requires explicit user trigger ("Release checkpoint
  진행해" / "이제 push/deploy 해" / "Stage 79~82 묶어서 배포해").
- **Federated impact signal export** — anonymized, opt-in (decision #21
  wire format): `{kind, recommendedAction, verdict, comparable, day_bucket,
  sha256}`. Becomes possible AFTER release because real cross-project data
  starts existing.
- **Timeline event filtering** (event-type chips) once real projects have
  enough events that filtering is useful.
- **Configurable thresholds / state machine** — let `mostly_improved` +
  every-followed-pack-has-benchmark auto-suggest marking the experiment
  complete.
- **Trend over time** — sliding window of (week, project,
  improvementRate). Now that Stage 82 timestamps are in place, this is
  cheap to build.
- (Carry-over) Revoke exposed Vercel token from earlier sessions.
