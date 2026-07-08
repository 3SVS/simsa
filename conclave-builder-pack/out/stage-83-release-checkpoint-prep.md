> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 83 — Release Checkpoint Preparation

**Status: PREP ONLY — no push, no deploy, no remote migration apply, no live verification.**

Stage 83 audits the Stage 77–82 evolution-record arc accumulated on
`claude/stage-79-82-evolution-loop` so an operator can safely execute the
release in one pass after explicit user approval. **This document does
not perform the release.** It writes the inventory, risk review, smoke
checklist, rollback plan, and go/no-go gate.

## 1. Release inventory

### Included stages

| Stage | Theme | Local commit |
|-------|-------|--------------|
| 77 | Persisted Evolution Action Packs | `c416eed` |
| 78 | Action Pack Follow-up Tracking | `87465cf` |
| 79 | Before/After Evolution Impact Comparison | `8d75b86` |
| 80 | Experiment Evolution Impact Summary | `979dd64` |
| 81 | Project Evolution Learning Signals | `56ec2fd` |
| 82 | Project Evolution Timeline | `9b916c8` |

Branch: `claude/stage-79-82-evolution-loop` (Stage 77/78 also live on the
same branch; they were committed before the operating-rule branch rename
applied to Stage 79).

### Files changed summary

44 files, +9,757 / −4 across:

- **2 migrations** (`0044`, `0045`)
- **6 new central-plane workspace helpers**
  - `evolution-action-pack.ts` (Stage 77 canonical pack builder)
  - `evolution-action-pack-db.ts` (Stage 77 + Stage 78 columns)
  - `evolution-impact.ts` (Stage 79)
  - `evolution-impact-summary.ts` (Stage 80)
  - `project-evolution-learning.ts` (Stage 81)
  - `project-evolution-timeline.ts` (Stage 82)
- **1 central-plane route file extended** (`workspace-experiment.ts` — 8 new endpoints + 1 shared `loadImpactForActionPack` helper)
- **6 new dashboard helpers** (`evolution-impact.mjs`, `evolution-impact-summary.mjs`, `action-pack-followup.mjs`, `project-evolution-learning.mjs`, `project-evolution-timeline.mjs`, + `.d.mts` companions)
- **2 dashboard pages extended** (`projects/[id]/page.tsx`, `projects/[id]/experiment/page.tsx`)
- **dashboard API wrapper** (`workspace-experiment-api.ts` — 8 new wrappers)
- **i18n** EN/KO/`.d.mts` — 156 new `evolution.*` keys total across stages
- **6 stage spec docs** in `conclave-builder-pack/out/stage-77*.md` … `stage-82*.md`
- **HANDOFF-2026-06-20.md** updated 6 times (one section per stage)
- **6 new test files** (3 helper-level + 3 dashboard parity/helper) + 1 shared endpoint test file with **65 endpoint tests** (Stages 77–82 surface)
- **1 golden fixture** (`evolution-action-pack-golden.json` — Stage 77 parity)

### Migrations included

| Migration | Stage | Type | Backward-compatible? |
|-----------|-------|------|----------------------|
| `0044_workspace_evolution_action_packs.sql` | 77 | `CREATE TABLE IF NOT EXISTS` + 2 indexes | Yes — new table, no existing-table impact |
| `0045_workspace_evolution_action_pack_followups.sql` | 78 | `ALTER TABLE … ADD COLUMN` × 6 (all nullable, no defaults) | Yes — additive, all columns nullable |

No Stage 79/80/81/82 migrations (impact / summary / learning / timeline
are all on-demand by deliberate design — formulas keep evolving).

### API endpoints added (Stage 77 → Stage 82, in addition order)

| Method | Path | Stage | Purpose |
|--------|------|-------|---------|
| `POST` | `…/agent-experiments/:experimentId/evolution-action-packs` | 77 | Server-build + persist a canonical action pack |
| `GET`  | `…/agent-experiments/:experimentId/evolution-action-packs` | 77 | Lightweight list of saved packs |
| `GET`  | `…/agent-experiments/:experimentId/evolution-action-packs/:actionPackId` | 77 | Full pack + rebuilt text |
| `PATCH`| `…/evolution-action-packs/:actionPackId/followup` | 78 | Record manual follow-up (status / PR / review run / benchmark / note) |
| `GET`  | `…/evolution-action-packs/:actionPackId/impact` | 79 | Deterministic before/after impact for one pack |
| `GET`  | `…/agent-experiments/:experimentId/evolution-impact-summary` | 80 | Experiment-wide rollup of per-pack impacts |
| `GET`  | `…/projects/:id/evolution-learning` | 81 | Project-wide recommendedAction effectiveness + top signals |
| `GET`  | `…/projects/:id/evolution-timeline` | 82 | Chronological 50-event project evolution stream |

All endpoints prefixed `/workspace/`.

### Dashboard screens changed

| Screen | Stages | Added sections |
|--------|--------|----------------|
| `/projects/:id` | 81, 82 | Evolution learning signals card · Evolution timeline card |
| `/projects/:id/experiment` | 77, 78, 79, 80 | Saved action packs list · Saved-pack detail card · Follow-up tracking form · Mark-as-copied button · Evolution impact sub-card · Evolution impact summary sub-card |

No new dashboard routes — all UI lives in existing pages.

### Tests passed (local, current HEAD = `9b916c8`)

```
central-plane: 1131/1131
dashboard:     188/188
typecheck:     54/54
lint:          clean (pre-existing export/page warning only)
i18n parity:   10/10
```

Net delta vs. pre-Stage-77 baseline:
- central-plane: 1005 → 1131 (**+126** tests)
- dashboard: 150 → 188 (**+38** tests)

### Known build caveat

`pnpm --filter @conclave-ai/dashboard build` fails locally with
`SELF_SIGNED_CERT_IN_CHAIN` fetching `Geist` / `Geist Mono` from Google
Fonts. **Environment-only** (the sandbox container blocks
`fonts.googleapis.com`); Vercel's build environment has no such block
and produces a clean build of the same code. Documented in every
Stage 77–82 report.

`pnpm --filter @conclave-ai/mcp-workspace test` fails with
`ERR_MODULE_NOT_FOUND: dist/server.js` when run **without** its `build`
step first. This is a **pre-existing turbo ordering issue** unrelated to
Stage 77–82 (verified by tracing the dependency through `turbo.json`).
After `pnpm turbo run build --filter @conclave-ai/mcp-workspace`, the
package's 14 tests pass. The fix is a turbo dependency tweak and should
NOT block this release — but it deserves its own follow-up.

### Release risks (overview — see §6 for full table)

- **Migration order** vs. central-plane deploy vs. dashboard deploy — must apply 0044 + 0045 before central-plane code that reads the new columns.
- **Dashboard expects new endpoints** — if dashboard ships before central-plane, every new card on `/projects/:id` and `/projects/:id/experiment` shows an error/empty state until the worker is updated.
- **On-demand impact / summary / learning / timeline** — N+M+P+B queries per request. Fine for typical project size but should be monitored once real traffic hits.
- **Saved pack text is canonical EN only** (Stage 77 limitation) — `Action pack saved` for KO users still displays the EN section text inside the pack body. UI chrome is localized.
- **Follow-up status machine is not enforced** (Stage 78 known limitation).
- **Timeline cap = 50 events**, no pagination beyond that (Stage 82 known limitation).

## 2. Migration review

### `0044_workspace_evolution_action_packs.sql`

```sql
CREATE TABLE IF NOT EXISTS workspace_evolution_action_packs (
  id                    TEXT NOT NULL PRIMARY KEY,
  project_id            TEXT NOT NULL,
  user_key              TEXT NOT NULL,
  experiment_id         TEXT NOT NULL,
  benchmark_id          TEXT,           -- nullable
  selected_candidate_id TEXT,           -- nullable
  recommended_action    TEXT NOT NULL,
  title                 TEXT NOT NULL,
  pack_json             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_evolution_action_packs_project_user
  ON workspace_evolution_action_packs(project_id, user_key);
CREATE INDEX IF NOT EXISTS idx_workspace_evolution_action_packs_experiment
  ON workspace_evolution_action_packs(experiment_id);
```

- **Idempotent**: `IF NOT EXISTS` on table and both indexes.
- **No existing-table impact**: new table only.
- **Backward-compatible**: removing the table later still leaves all
  pre-Stage-77 routes functional (action pack endpoints simply 500
  if the table is dropped, but no other endpoint depends on it).
- **Ownership scoping**: `(project_id, user_key)` composite index
  supports the list query; `experiment_id` index supports per-
  experiment lookups.

### `0045_workspace_evolution_action_pack_followups.sql`

```sql
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_status TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_pull_request_number INTEGER;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_review_run_id TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_benchmark_id TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followup_note TEXT;
ALTER TABLE workspace_evolution_action_packs ADD COLUMN followed_at TEXT;
```

- **Additive only**: 6 nullable columns, no defaults, no constraints.
- **Backward-compatible**: pre-Stage-78 reads of action packs continue
  to work (the DB-layer `normalizeStatus(null) → "not_started"`
  reflects the absence of the column safely).
- **No existing-row migration needed**: nullable columns produce `NULL`
  for rows inserted before 0045 ran.

### Order requirements

1. Apply `0044` (creates table) **before** any central-plane build that
   includes the Stage 77 routes — otherwise POST/GET action-pack
   endpoints throw "no such table".
2. Apply `0045` (adds follow-up columns) **before** any central-plane
   build that includes the Stage 78 PATCH followup route AND before any
   dashboard build that calls `patchEvolutionActionPackFollowup` —
   otherwise the PATCH throws "no such column: followup_status".
3. Both migrations should be applied **in one batch** since they target
   the same table and the central-plane build being deployed already
   reads both `followup_*` columns and the base `pack_json` column.

### Backward-compatibility on rollback

- Rolling back **central-plane only** (keep migrations in place):
  safe. Old worker code ignores the new table + columns; nothing
  reads them.
- Rolling back **dashboard only** (keep migrations + new central-plane):
  safe. New endpoints exist but nothing calls them.
- Rolling back **migrations** (drop columns / table): **not
  recommended**. Data loss + breaks the central-plane build that
  expects the columns to exist. If absolutely necessary, deploy a
  rolled-back central-plane first, then drop columns.

### Endpoints' behavior before migration

The Stage 77/78 DB writes will throw `D1_ERROR: no such table` /
`D1_ERROR: no such column` if the migration has not run. The endpoints
catch generic errors and return `500 save_failed` / `500 update_failed`.
The dashboard handles non-`ok` responses with localized error states.
**No crash loop, but every dashboard call to the new endpoints fails
visibly** — which is why migration must precede central-plane deploy.

## 3. API endpoint inventory

Each endpoint requires `userKey`. Ownership rules below describe what
the route enforces, not what the route assumes.

### `POST …/agent-experiments/:experimentId/evolution-action-packs` (Stage 77)

- **Purpose**: server-build canonical Evolution Action Pack from the
  current outcome scorecard + linked benchmark; persist pack snapshot.
- **userKey**: required (400 otherwise).
- **Ownership**: experiment.projectId must equal path `:id`; experiment.userKey must equal request userKey (404 / 403).
- **Happy-path smoke**: `POST` with userKey of an owned experiment → `201` with `actionPack.pack.recommendedAction`, `text`, `followup.status = "not_started"`.
- **Guardrail smoke**: `POST` without userKey → `400 userKey_required`. `POST` on someone else's experiment → `403 forbidden`. `POST` with the canonical "no benchmark, no decision" experiment → `recommendedAction = "create_benchmark"` pack.

### `GET …/agent-experiments/:experimentId/evolution-action-packs` (Stage 77)

- **Purpose**: lightweight list of saved packs for an experiment (id, title, recommendedAction, createdAt, followup fields).
- **userKey**: required.
- **Ownership**: same as POST.
- **Happy-path smoke**: list returns latest packs first; each item carries `followupStatus` (normalized to `"not_started"` for never-touched packs).
- **Guardrail smoke**: missing userKey → 400; other user → 403; unknown experiment → 404.

### `GET …/agent-experiments/:experimentId/evolution-action-packs/:actionPackId` (Stage 77)

- **Purpose**: full pack snapshot + rebuilt markdown text + follow-up snapshot.
- **userKey**: required.
- **Ownership**: pack.projectId, pack.experimentId, pack.userKey all must match.
- **Happy-path smoke**: detail returns same `actionPack.pack` shape as POST.
- **Guardrail smoke**: pack id from another experiment → 404; another user → 403.

### `PATCH …/evolution-action-packs/:actionPackId/followup` (Stage 78)

- **Purpose**: record manual follow-up (status / PR number / review run id / benchmark id / note).
- **userKey**: required.
- **Ownership**: pack ownership re-checked; linked `reviewRunId` and `benchmarkId` re-validated against project + userKey before linking.
- **Happy-path smoke**: `{ status: "copied" }` stamps `followedAt`; subsequent transitions keep the same stamp. PR number persists across reload.
- **Guardrail smoke**: invalid status → 400; PR number `< 1` → 400; review run owned by other user → 400 `review_run_mismatch`; note > 1000 chars → 400.

### `GET …/evolution-action-packs/:actionPackId/impact` (Stage 79)

- **Purpose**: deterministic before/after impact comparison for one pack.
- **userKey**: required.
- **Ownership**: pack ownership + linked benchmark / review run ownership re-checked (other-owner data absorbed into `limitations[]`, never leaked).
- **Happy-path smoke**: pack with benchmark + follow-up review run produces `improved` / `regressed` / `unchanged` / `inconclusive` per spec.
- **Guardrail smoke**: no benchmark + no follow-up → `inconclusive` + `missing_followup` + `missing_before`; different acceptance item sets → `inconclusive` + `different_acceptance_set`.

### `GET …/agent-experiments/:experimentId/evolution-impact-summary` (Stage 80)

- **Purpose**: experiment-wide rollup of per-pack impacts via shared `loadImpactForActionPack`.
- **userKey**: required.
- **Ownership**: experiment ownership + per-pack defensive re-check.
- **Happy-path smoke**: 3 packs all improved → `overallVerdict = "mostly_improved"` + reason `more_improved_than_regressed`.
- **Guardrail smoke**: 0 packs → `no_followups` + `no_saved_action_packs`. Packs without follow-ups → `no_followups`.

### `GET /workspace/projects/:id/evolution-learning` (Stage 81)

- **Purpose**: project-wide effectiveness per `recommendedAction` + top signals.
- **userKey**: required.
- **Ownership**: list experiments → per-item userKey filter (cross-tenant isolation: other-owner experiments contribute 0).
- **Happy-path smoke**: with ≥ 3 comparable packs across 2+ experiments, `topSignals` surfaces `action_often_improves` or `action_often_regresses`.
- **Guardrail smoke**: empty project → `[not_enough_data]`. Inconclusive-only → `[not_enough_data]`. Cross-tenant: other user's data invisible.

### `GET /workspace/projects/:id/evolution-timeline` (Stage 82)

- **Purpose**: chronological project evolution stream (≤ 50 events, newest first).
- **userKey**: required.
- **Ownership**: same as learning (per-item ownership filter).
- **Happy-path smoke**: events for `experiment_created` / `benchmark_created` / `decision_recorded` / `action_pack_saved` / `followup_recorded` / `impact_improved` all appear with relative `href` populated.
- **Guardrail smoke**: empty project → `eventCount: 0`. > 50 events → `limitations: ["timeline_truncated"]`.

## 4. Dashboard smoke checklist

**Manual smoke at release time** (do NOT run in Stage 83). Each row is
one acceptance criterion; pass = the UI behaves exactly as described.

### `/projects/:id` (project detail)

- [ ] Page loads without console errors.
- [ ] **Evolution learning signals card** renders: header, description, disclaimer line.
- [ ] No data: shows "Run more followed action packs to see project-level learning signals.".
- [ ] With data: 4-cell stat row (Experiments / Action packs / Followed / Comparable) shows real numbers.
- [ ] verdict counts row color-coded correctly (improved emerald / regressed red / inconclusive amber).
- [ ] recommendedAction effectiveness table shows rows in alphabetical order.
- [ ] Top signals: empty project shows `Not enough data yet.` pill.
- [ ] **Evolution timeline card** renders: header, description.
- [ ] Empty project: shows "Create experiments and save action packs to build this project's evolution timeline.".
- [ ] With data: events appear newest-first; each row has a colored type pill; localized timestamp via `toLocaleString()`.
- [ ] Open buttons navigate to `/projects/:id/experiment?experiment=…` or `/projects/:id/benchmark/<id>` correctly.
- [ ] `timeline_truncated` pill appears when an owner has > 50 events.
- [ ] EN/KO toggle: all labels switch language (verdict labels, event types, empty states, disclaimer).

### `/projects/:id/experiment`

- [ ] Saved experiment opens; outcome scorecard renders (Stage 75 baseline).
- [ ] **Evolution action pack** sub-card under Outcome quality:
  - [ ] Generate action pack works for `create_benchmark` / `fix_selected` / `accept` cases.
  - [ ] Copy action pack writes correct text to clipboard.
  - [ ] **Save action pack** call hits POST endpoint, list updates with the new pack.
  - [ ] Saved list reloads correctly on page reload.
  - [ ] **Open saved pack** loads detail card with sections.
  - [ ] **Mark as copied** flips followup status pill to Copied; sets Followed at timestamp.
  - [ ] **Copy saved pack** writes server-canonical EN markdown text.
- [ ] **Follow-up tracking form**:
  - [ ] Pre-populates from current pack snapshot.
  - [ ] Status dropdown lists all 7 states localized.
  - [ ] PR number / review run id / benchmark id / note inputs save and persist on reload.
  - [ ] Invalid PR number (< 1) shows server error inline.
- [ ] **Evolution impact** sub-card auto-loads:
  - [ ] Empty / inconclusive state shows `Link a follow-up review run or benchmark to calculate impact.`.
  - [ ] With data: Before / After / Delta tri-grid populated; verdict pill color matches verdict.
  - [ ] Reasons + Limitations chips render with i18n labels.
- [ ] **Evolution impact summary** sub-card (above saved list):
  - [ ] Empty state shows `Save an action pack and record follow-up results to see evolution impact.`.
  - [ ] With data: verdict pill, 6-cell metric grid, Average change row, recommendedAction breakdown rows.
- [ ] EN/KO toggle: all sub-cards localize correctly (status labels, verdict labels, reason labels, follow-up labels).

## 5. Local verification results

```
central-plane:    1131/1131 PASS  (Stage-77 baseline 1005 → +126)
dashboard:        188/188   PASS  (Stage-77 baseline 150  → +38)
typecheck:        54/54     PASS
lint:             clean (pre-existing /export/page.tsx warning only)
i18n parity:      10/10
mcp-workspace:    14/14 PASS after `pnpm turbo run build` (pre-existing
                  turbo ordering: build-then-test required)
```

Build status:

- Central-plane (Cloudflare Worker via `tsc`): **PASS** locally.
- Dashboard (`next build`): **SKIPPED** — sandbox env: Google Fonts
  blocked by `SELF_SIGNED_CERT_IN_CHAIN` fetching Geist / Geist Mono.
  Code is unchanged; Vercel's build env does not have this block.
- Per the operating rule:
  - **Push: skipped by operating rule.**
  - **Production deploy: skipped by operating rule.**
  - **Remote migration apply: skipped by operating rule.**
  - **Live verification: skipped by operating rule.**

## 6. Production risk review

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Migrations not applied before central-plane deploy → POST/PATCH 500s | **High** | Deploy order: D1 migrations → central-plane → dashboard. Operator confirms `pnpm migrate:apply` finished against `--remote` before pressing the worker deploy button. |
| R2 | Dashboard ships before central-plane → new cards error/empty until worker updated | **Medium** | Deploy order above. If dashboard accidentally ships first, the cards fall closed with the localized loading/error state — no crash, just unusable until worker catches up. Recoverable. |
| R3 | Central-plane deployed but dashboard rolled back → new endpoints exist but unused | **Low** | Safe. Old dashboard never calls new endpoints. |
| R4 | `0044`/`0045` partial apply (one migration runs, the other fails) | **Medium** | wrangler applies migrations in order and fails fast. If 0044 lands but 0045 fails, the Stage 78 PATCH followup endpoint returns 500; Stage 77 POST/GET still work. Re-run `pnpm migrate:apply` to land 0045. |
| R5 | On-demand N+M+P+B queries on `/evolution-timeline` for very large projects (> 50 experiments) | **Low** | Stage 72 list cap is 50 → bounded query count. Worth a per-route latency dashboard after release. |
| R6 | Cross-tenant data leakage via cross-tenant ownership scoping bug | **Low** | All endpoints re-validate `(projectId, userKey)` on every linked entity (benchmark, review run, action pack). Endpoint tests assert isolation: `cross-tenant isolation` tests on Stages 80, 81, 82. |
| R7 | Saved action pack text is canonical EN even for KO users | **Low** | Stage 77 documented limitation. UI chrome is localized; only the saved pack body is fixed EN. Acceptable for v0.13.x; revisit when KO becomes the primary locale. |
| R8 | Follow-up status state-machine not enforced (e.g., user can jump `not_started → completed`) | **Low** | Stage 78 known limitation. Status allowlist enforces validity but not transition graph. No data corruption risk; just sloppy audit trail if user does this. |
| R9 | Timeline cap = 50 events with no pagination | **Low** | Stage 82 known limitation. Surfaces as `timeline_truncated` pill. Operator can patch in pagination as a follow-up. |
| R10 | Vercel build env differs from sandbox; first Vercel deploy might surface a font fetch flake we never saw | **Low** | Vercel build env is the proven path (every dashboard deploy to date has used it). Mitigation: watch the deploy log on Vercel; if a font fetch fails there, rollback per §7. |
| R11 | Exposed Vercel token from earlier sessions (carry-over since Stage 75) | **Medium** | Operator must revoke + rotate before resuming deploy authority. See §9. |
| R12 | Pre-existing `mcp-workspace` test failure when run without build | **Low** | Unrelated to this release; document for follow-up. Does not block the release of central-plane + dashboard. |
| R13 | Action-pack POST trusts the recently-fixed test-mock outcome handler (Stage 80 bonus fix). Fixed in tests only; the real DB UPDATE behaves correctly. | **Low** | Real D1 path was always correct; only the test mock was wrong. No production risk. |

No high-severity risks beyond R1, which is fully mitigated by the
deploy order.

## 7. Rollback plan

### If a dashboard issue surfaces post-deploy

1. Vercel → Deployments → previous successful build → **Promote to Production**.
2. Verify in browser that the old `/projects/:id` and
   `/projects/:id/experiment` render as before. No central-plane
   change needed — new endpoints exist but are unused by the old
   dashboard.
3. Investigate; cut a fix; re-deploy.

### If a central-plane (Worker) issue surfaces post-deploy

1. Cloudflare Workers → previous version → **Rollback**.
2. New dashboard cards will start failing with their localized error
   state (no crash). Either also roll back the dashboard (per above)
   or accept the degraded state while investigating.
3. **Do NOT drop the migrations** unless the issue is specifically a
   migration-level problem. Additive nullable columns are safe under
   both old and new central-plane code.

### If a migration issue surfaces

- `0044` (CREATE TABLE) safe to drop only if no rows yet → `DROP TABLE IF EXISTS workspace_evolution_action_packs;` (data-loss). Prefer leaving the table in place and rolling back code.
- `0045` (ALTER ADD COLUMN ×6) — D1 / SQLite does NOT support `DROP COLUMN` directly. If the columns must go, the standard SQLite playbook is: create a new table without the columns, copy rows, drop old, rename. **Do not attempt this during an incident.** Roll back code only.

### If an endpoint-level issue surfaces

- Every dashboard component handles non-`ok` responses with a
  localized empty / error state.
- The "fail closed" pattern means a single endpoint regression does
  not break the rest of the dashboard.

## 8. Release go/no-go checklist

Operator confirms each item BEFORE running the release.

- [ ] Exposed Vercel token from earlier sessions revoked + rotated (carry-over since Stage 75).
- [ ] `pnpm test` green (central-plane 1131/1131 + dashboard 188/188).
- [ ] `pnpm typecheck` green (54/54).
- [ ] `pnpm lint` clean (only pre-existing `/export/page.tsx` warning).
- [ ] `0044_workspace_evolution_action_packs.sql` reviewed and applied to `--remote` D1.
- [ ] `0045_workspace_evolution_action_pack_followups.sql` reviewed and applied to `--remote` D1.
- [ ] Both migrations applied **in order**, both succeeded.
- [ ] Deploy order **confirmed**: D1 migrations → central-plane → dashboard.
- [ ] Smoke-test `userKey` + `projectId` ready in a non-production environment OR an existing demo project.
- [ ] Rollback plan (§7) reviewed.
- [ ] Bae has explicitly said one of:
  - "Release checkpoint 진행해"
  - "이제 push/deploy 해"
  - "Stage 77~82 묶어서 배포해"

**Until every box is checked AND Bae explicitly approves, no push, no
deploy, no remote migration apply, no live verification.**

## 9. Security / token cleanup reminder

- Any Vercel, GitHub, Cloudflare token used during Stage 75/76 prep
  must be **revoked and rotated** before resuming deploy authority.
- Token literals must **never** appear in:
  - This document
  - HANDOFF docs
  - Git commit messages
  - Test fixtures
  - Stage spec docs
  - Console logs streamed through the chat
- All endpoint tests assert (`assert.ok(!flat.includes(USER))`) that
  responses do not echo userKey values. No similar assertion for
  third-party tokens because we never embed them.
- The dashboard reads userKey from `localStorage`; it is never sent
  in chat-visible payloads from our side.

If a token must be referenced in operator notes for a specific deploy
run, redact it to the first/last 4 characters only — `vercel_abcd…wxyz`
— and store the full value out of band (1Password vault, etc.).

## 10. Operating-rule status (Stage 83)

- **Push: skipped by operating rule.**
- **Production deploy: skipped by operating rule.**
- **Remote migration apply: skipped by operating rule.**
- **Live verification: skipped by operating rule.**

Local commit allowed and used for this doc + HANDOFF update.

## 11. Recommendation

**READY for release checkpoint, pending operator confirmation of the
go/no-go checklist in §8.**

Stage 77–82 form a clean evolution-record arc:

```
Stage 77 (table) → Stage 78 (columns) → Stages 79/80/81/82 (on-demand reads)
```

The only blocking item is **operator approval** + the **Vercel token
rotation** (R11). All other checklist items are confirmable in seconds:
test results are stable on this branch, migrations are simple +
additive, no destructive operations are required, and the rollback
plan does not require data loss.

When Bae says "Release checkpoint 진행해" / "이제 push/deploy 해" /
"Stage 77~82 묶어서 배포해", the release is **a single forward pass**:

```
pnpm migrate:apply   # apps/central-plane, --remote, applies 0044 + 0045
pnpm ship            # apps/central-plane, preflight + wrangler deploy
# (no dashboard CLI — Vercel auto-deploys on push to main)
git push origin main
# Smoke test using §4 checklist on the production dashboard
```

Until that approval, this branch stays local.
