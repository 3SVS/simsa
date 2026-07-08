> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 78 — Action Pack Follow-up Tracking

**Goal.** Connect a saved Evolution Action Pack to whatever the user actually
did next — the follow-up PR / review run / benchmark — so saved packs stop
being write-once artifacts and become evolution-loop **records**. Manual entry
only: no LLM judgement, no agent auto-run, no benchmark auto-create, no
branch/commit/patch, no billing or scope change. Outcome scorecard formula
(Stage 75) unchanged.

## Follow-up data model / migration

`apps/central-plane/migrations/0045_workspace_evolution_action_pack_followups.sql`:

```sql
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_status TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_pull_request_number INTEGER;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_review_run_id TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_benchmark_id TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_note TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followed_at TEXT;
```

Option A (single-table ALTER) chosen — all six columns nullable, older rows
are normalised to `followup_status: "not_started"` in the DB-layer mapping
(`normalizeStatus`) so the API never returns `null` status. No back-fill,
no DB-level default.

### Status allowlist

```
not_started · copied · in_progress · reviewed · benchmarked · completed · abandoned
```

`FOLLOWUP_STATUSES` exported from both the central-plane DB layer and the
dashboard helper.

## Follow-up API endpoint

```
PATCH /workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId/followup
```

Body:

```json
{
  "userKey": "uk_…",
  "status": "reviewed",
  "pullRequestNumber": 12,
  "reviewRunId": "wprr_…",
  "benchmarkId": "wab_…",
  "note": "Applied the fix_selected pack to Builder B's PR."
}
```

### Behavior

1. `userKey` required (400 otherwise)
2. Status must be in the allowlist (400 otherwise)
3. Experiment + pack ownership matched (404 / 403)
4. `pullRequestNumber` if provided must be a positive integer (400 otherwise)
5. `reviewRunId` if provided must belong to same project + userKey (400 otherwise)
6. `benchmarkId` if provided must belong to same project + userKey (400 otherwise)
7. `note` ≤ 1000 chars (400 otherwise)
8. **`followed_at` stamped the first time** the user moves out of `not_started`
   and `followed_at` is empty. Subsequent transitions keep the original
   timestamp — the "first followed at" semantic stays stable.
9. **Does not auto-create review or benchmark.** The user records what already
   exists.

Returns the full updated action pack detail (matching the GET detail shape).

## Ownership / validation behavior

Same scopes as Stage 77 plus:

- `reviewRunId` re-validated through `getReviewRunById` + project/user match —
  prevents linking a run from another user's project.
- `benchmarkId` re-validated through `getAgentBenchmarkById` + project/user
  match — same reason.
- `note` length-guarded server-side (`NOTE_MAX = 1000`).
- A pack id under the wrong `experimentId` → 404 (the existing Stage 77 detail
  GET 404 path is reused).

Errors surfaced: `invalid_json`, `userKey_required`, `invalid_status`,
`not_found`, `forbidden`, `invalid_pr_number`, `review_run_not_found`,
`review_run_mismatch`, `benchmark_not_found`, `benchmark_mismatch`,
`invalid_note`, `note_too_long`, `corrupt_pack`, `update_failed`.

## Saved action pack list/detail changes

Both list and detail responses now surface follow-up:

**List item:**

```json
{
  "id": "weap_…",
  "experimentId": "wexp_…",
  "recommendedAction": "fix_selected",
  "title": "Fix the selected candidate",
  "createdAt": "…",
  "followupStatus": "reviewed",
  "followupPullRequestNumber": 12,
  "followupReviewRunId": "wprr_…",
  "followupBenchmarkId": null,
  "followedAt": "…"
}
```

**Detail:**

```json
{
  "id": "weap_…",
  "…": "…",
  "pack": { … },
  "text": "…",
  "followup": {
    "status": "reviewed",
    "pullRequestNumber": 12,
    "reviewRunId": "wprr_…",
    "benchmarkId": null,
    "note": "…",
    "followedAt": "…"
  }
}
```

POST response (new pack) also includes `followup: { status: "not_started" }`
so the dashboard never has to guess defaults.

## Dashboard follow-up UI

`/projects/:id/experiment` — Evolution action pack sub-card → opened saved pack
detail now has a **Follow-up** sub-card:

- Status badge (current saved status, localized)
- Status `<select>` (7 options, localized labels)
- PR number `<input type="number" min={1}>`
- Review run ID `<input>` (free-text; matches the existing experiment-page
  pattern where review run linking accepts a `wprr_…` id)
- Benchmark ID `<input>` (free-text; optional)
- Note `<textarea maxLength={1000}>`
- **Save follow-up** button (handles the PATCH; shows Saving / Saved /
  Could not save states)
- **Mark as copied** button (in the saved-pack header next to Copy saved pack)
- `Followed at: …` timestamp once stamped

Saved-list rows now show a follow-up status pill (color-coded:
completed/benchmarked = green, abandoned = gray, not_started = white,
in-flight = indigo) + a PR badge if a PR number is set.

The follow-up form syncs from the opened pack's `followup` snapshot via a
dedicated `useEffect` — switching saved packs resets the form to the picked
pack's state.

## Copy / Mark-as-copied behavior

**Per spec recommendation, copy and mark-as-copied are decoupled.**

- `Copy saved pack` (Stage 77) — clipboard write only. No follow-up PATCH.
  Rationale: copying does not always mean the user followed the action.
- `Mark as copied` (Stage 78) — explicit PATCH with `{ status: "copied" }`.
  Sets `followed_at` if previously unset. Decoupled so the audit trail reflects
  a user intent, not a clipboard event.

The Save follow-up button is the canonical "I want to record the full state"
control; Mark as copied is the one-tap fast path.

## I18N

`evolution.*` namespace +22 keys (EN + KO + `.d.mts`):

```
followup · followupStatus · followupDesc · markCopied
saveFollowup · savingFollowup · followupSaved · followupFailed
statusNotStarted · statusCopied · statusInProgress · statusReviewed
statusBenchmarked · statusCompleted · statusAbandoned
followupPullRequestNumber · followupReviewRun · followupBenchmark
followupNote · followedAt
```

The status label keys mirror the central-plane allowlist exactly, so the
helper-side `followupStatusLabelKey(status)` is a pure mapping any test can
assert against the dictionary.

i18n parity test `i18n.test.mjs` still green (10/10).

## Tests / build

- **Central-plane endpoints** (`workspace-evolution-action-pack.test.mjs`)
  Stage 78 additions:
  - POST response includes follow-up snapshot (defaults to not_started)
  - GET list includes followupStatus normalized
  - PATCH status-only → followedAt stamped
  - PATCH not_started → followedAt not stamped
  - PATCH PR number persisted + survives reload (list)
  - PATCH reviewRunId from same owner → linked
  - PATCH reviewRunId from another user → 400 mismatch
  - PATCH unknown reviewRunId → 400
  - PATCH missing userKey → 400
  - PATCH invalid status → 400
  - PATCH invalid PR number (-3) → 400
  - PATCH other user → 403
  - PATCH unknown action pack → 404
  - PATCH pack id from another experiment → 404
  - PATCH note > 1000 → 400
  - PATCH note within limit persisted
  - followedAt stable across subsequent transitions
  - GET detail after PATCH: follow-up persisted across reload

- **Dashboard helper** (`action-pack-followup.test.mjs`) — 8 tests:
  status allowlist parity with central, every status maps to a real dictionary
  key, fallback to statusNotStarted, payload builder drops empty optionals,
  rejects invalid PR numbers, list-item mapping with and without follow-up.

```
central-plane: 1045/1045   (Stage 77 1027 → +18)
dashboard:     163/163     (Stage 77 155 → +8)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `next build` blocked locally on Google Fonts (self-signed cert in
chain in this sandbox) — unrelated to Stage 78. Vercel build unaffected.

## Live verification

Apply migration 0045, deploy central-plane, deploy dashboard, then:

```bash
# Mark a saved pack as copied (no PR yet)
curl -sX PATCH \
  "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs/$PACK/followup" \
  -H 'content-type: application/json' \
  -d "{\"userKey\":\"$UK\",\"status\":\"copied\"}"

# Set PR number + status in_progress
curl -sX PATCH "$URL/…/$PACK/followup" \
  -d "{\"userKey\":\"$UK\",\"status\":\"in_progress\",\"pullRequestNumber\":12}"

# Link a real follow-up review run
curl -sX PATCH "$URL/…/$PACK/followup" \
  -d "{\"userKey\":\"$UK\",\"status\":\"reviewed\",\"reviewRunId\":\"wprr_…\"}"

# Reload list — followupStatus + followupPullRequestNumber persist
curl -s "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs?userKey=$UK"

# Ownership guard — should 400 review_run_mismatch
curl -sX PATCH "$URL/…/$PACK/followup" \
  -d "{\"userKey\":\"$UK\",\"status\":\"reviewed\",\"reviewRunId\":\"wprr_owned_by_someone_else\"}"
```

Dashboard checks:

- Open a saved pack → Follow-up form pre-populated with current state
- Change status → Save follow-up → list row reflects new status pill + PR badge
- `Mark as copied` → status pill flips to Copied + `Followed at` timestamp
  appears (and stays stable on later transitions)
- EN/KO toggle localizes every status label + form chrome
- Without a real follow-up review run: status + PR-number + note path still
  works; do not fake a populated link

## Known limitations

- **Status transitions are not enforced as a state machine.** Spec implies
  copied → in_progress → reviewed → benchmarked → completed, but the server
  accepts any allowlisted value. Stage 79 can layer a deterministic state
  machine if needed (or leave the user in control — TBD).
- **Single follow-up slot per pack.** If a user uses the same saved pack for
  two PR attempts, the second overwrites the first. Spec is explicit about
  pack immutability; multi-attempt tracking is a separate stage.
- **No saved-pack outcome comparison yet.** The follow-up data is recorded
  but the outcome scorecard does not yet compare original-vs-follow-up
  benchmarks. That is Stage 79's job (per spec).
- **`note` is free-text only**, no structured fields. Sufficient for MVP audit.
- **Review run / benchmark inputs are free-text on the dashboard.** A dropdown
  using the existing review history could be wired in, but the current
  experiment page already exposes the review history under a separate section,
  so MVP UX is text input.
- Follow-up form lives inside the experiment page. A dedicated saved-pack
  route (`/projects/:id/experiment/$EXP/action-pack/$ID`) is still deferred
  to Stage 79+ (Stage 77 limitation carries over).

## Stage 79 recommendation

- **Pack outcome comparison.** Use the now-recorded follow-up review run /
  benchmark id to compute "before vs after using this action pack": did the
  unresolved blocker count drop? did the acceptance pass rate climb? Surface
  on the outcome scorecard as a "this loop followed action pack X" annotation.
- **Optional state-machine on follow-up status** — block illegal transitions
  if the comparison data justifies it (e.g. "benchmarked" requires a
  followup_benchmark_id).
- **Federated sync for follow-up signals.** Anonymized `{action, status,
  outcome_delta, day_bucket, sha256}` would let the federation learn which
  recommended_actions actually move the needle.
- **Shared link route** for a saved pack + its follow-up, so action-pack
  recipients (teammates / agents) can see the loop record.
- (Carry-over) Revoke exposed Vercel token from earlier sessions.
