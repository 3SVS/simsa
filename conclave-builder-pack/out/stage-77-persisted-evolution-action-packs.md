> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 77 — Persisted Evolution Action Packs

**Goal.** Promote the Stage 76 dashboard-side Evolution Action Pack into a saved
workflow asset on central-plane D1. The pack becomes revisitable & shareable
inside the experiment workflow — not a one-shot client preview that disappears
on reload. **No LLM. No agent auto-run. No branch/commit/patch. No billing or
scope change.** Server is the canonical builder; the client never supplies pack
content.

## Data model / migration

`apps/central-plane/migrations/0044_workspace_evolution_action_packs.sql`:

```sql
CREATE TABLE workspace_evolution_action_packs (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  user_key              TEXT NOT NULL,
  experiment_id         TEXT NOT NULL,
  benchmark_id          TEXT,                -- nullable
  selected_candidate_id TEXT,                -- nullable
  recommended_action    TEXT NOT NULL,
  title                 TEXT NOT NULL,
  pack_json             TEXT NOT NULL,       -- full EvolutionActionPack snapshot
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_workspace_evolution_action_packs_project_user
  ON workspace_evolution_action_packs(project_id, user_key);
CREATE INDEX idx_workspace_evolution_action_packs_experiment
  ON workspace_evolution_action_packs(experiment_id);
```

The scorecard remains on-demand (no persistence table) — only the action pack
artifact is saved.

## Central-plane canonical helper

`apps/central-plane/src/workspace/evolution-action-pack.ts` — pure, deterministic
TypeScript port of the dashboard `.mjs`. Exposes:

- `buildEvolutionActionPack(input, s)`
- `buildEvolutionActionPackText(pack, s, meta)`
- `resolveFocusItems(scorecard, benchmark, acceptanceItems)`
- `statusLabelFor(status, s)`
- `DEFAULT_EVOLUTION_STRINGS` — canonical EN bundle used by the route handler so
  saved packs are deterministic regardless of caller locale.

Saved packs are canonical English. UI chrome (Save button / Saved list / Open /
Copy) remains localized via dashboard i18n.

Same golden fixture asserted by both implementations:
`apps/central-plane/test/fixtures/evolution-action-pack-golden.json` (5 cases
covering all five recommendedAction branches).

## API endpoints

```
POST /workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs
GET  /workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs
GET  /workspace/projects/:id/agent-experiments/:experimentId/evolution-action-packs/:actionPackId
```

### POST — build + save

Body: `{ userKey }`. Server loads the scorecard via Stage 75 logic, pulls the
linked benchmark snapshot (if any), builds the canonical pack with
`DEFAULT_EVOLUTION_STRINGS`, persists `pack_json`, returns:

```json
{
  "ok": true,
  "actionPack": {
    "id": "weap_…",
    "experimentId": "wexp_…",
    "recommendedAction": "fix_selected",
    "title": "Fix the selected candidate",
    "createdAt": "…",
    "pack": { … },
    "text": "# Conclave Evolution Action Pack …"
  }
}
```

Client-supplied pack content is **never** trusted. The server builds it.

### GET list — lightweight

```json
{
  "ok": true,
  "actionPacks": [
    {
      "id": "weap_…",
      "experimentId": "wexp_…",
      "recommendedAction": "fix_selected",
      "title": "Fix the selected candidate",
      "createdAt": "…"
    }
  ]
}
```

List view does **not** include `pack` / `text`.

### GET detail — full

Re-parses `pack_json` and re-renders `text` deterministically via
`buildEvolutionActionPackText`. Choice: **text generated at read time** from
`pack_json` (not stored separately). Rationale: the helper is deterministic,
storing text would duplicate state and risk drift if the canonical helper ever
fixes a typo without re-saving rows.

## Ownership validation

- `userKey` required (400 if missing)
- experiment must belong to `project_id` (404 otherwise)
- experiment.userKey must equal request userKey (403 otherwise)
- action pack must belong to the same experiment + project (404 otherwise)
- action pack.userKey must equal request userKey (403 otherwise)

Linked benchmark is loaded only if `projectId + userKey` match — a stale
`benchmark_id` from a different owner never leaks data into the pack.

## Dashboard Save / List / Open / Copy UI

`/projects/:id/experiment` (Outcome quality section → Evolution action pack
sub-card):

- **Generate action pack** (Stage 76) — instant client preview, unchanged.
- **Save action pack** — calls POST; on success, server pack replaces client
  preview and the saved list updates (server version preferred after save, per
  spec contract).
- **Saved action packs** — list rendered below preview, lightweight items
  (title, recommended action label, created at). Loaded on mount + on save.
- **Open saved pack** — calls GET detail; shows the saved pack with section
  cards + a `Copy saved pack` button rendering the deterministic markdown text.
- **No saved action packs yet** — empty state.

Distinct from the Stage 76 client preview: the preview disappears when an
opened saved pack is showing, so the user sees the canonical artifact.

## Copy saved pack behavior

Reads `actionPack.text` from the detail response (server-rebuilt from
`pack_json` deterministically) and writes it to the clipboard. Same markdown
shape as Stage 76:

```
# Conclave Evolution Action Pack

Recommended action: Fix the selected candidate
Experiment: <title>

## Goal
…

## Focus acceptance items
1. Issue found — Task sharing permissions
…
```

No userKey or token in the rendered text (asserted by tests).

## I18N

Added to `apps/dashboard/src/i18n/dictionary.mjs` (EN + KO + `.d.mts`) under
`evolution.*`:

```
save · saved · saving · noSaved · open · copySaved · savedOk · saveFailed
createdAt · serverGenerated · serverGeneratedDesc
```

Parity test `i18n.test.mjs` still green (10/10).

## Tests / build

- **Central-plane helper** `evolution-action-pack.test.mjs` — 8 tests (5 golden
  fixture cases asserting all five action branches + 3 standalone behavioral
  tests).
- **Central-plane endpoints** `workspace-evolution-action-pack.test.mjs` — 15
  tests covering create-without-benchmark, create-with-benchmark + decision,
  missing userKey, unknown experiment, other-user 403, no-userKey/token leak
  in pack_json/text, list empty, list multiple, list ownership,
  detail returns full pack + text, detail pack from another experiment → 404,
  detail other-user → 403, detail missing userKey, detail unknown id → 404.
- **Dashboard parity** `evolution-action-pack-parity.test.mjs` — 5 golden cases
  asserting the `.mjs` mirror matches the canonical `.ts`. Existing 9
  `evolution-action-pack.test.mjs` tests unchanged.

```
central-plane: 1027/1027   (Stage 76 baseline 1005, +22)
dashboard:     155/155     (Stage 76 baseline 150, +5)
typecheck:     54/54
lint:          clean (pre-existing export warning only)
i18n parity:   10/10
```

Dashboard `pnpm build` (Next.js) failed locally because Google Fonts is
unreachable in this sandbox (self-signed cert in chain blocks `fonts.googleapis.com`)
— unrelated to Stage 77 code. Vercel build is unaffected.

## Live verification

To run on deploy (after `pnpm migrate:apply` on central-plane):

```bash
# 1. Save (build + persist) — strong outcome → accept pack saved
curl -sX POST \
  "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs" \
  -H 'content-type: application/json' \
  -d "{\"userKey\":\"$UK\"}"

# 2. List — lightweight items only
curl -s "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs?userKey=$UK"

# 3. Detail — full pack + rebuilt text
curl -s "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs/$PACK_ID?userKey=$UK"

# 4. Ownership guard — should 403
curl -s "$URL/workspace/projects/$PROJ/agent-experiments/$EXP/evolution-action-packs?userKey=uk_other"
```

Dashboard: `https://conclave-dashboard.vercel.app/projects/$PROJ/experiment?experiment=$EXP`

- Generate action pack (Stage 76 preview)
- Save action pack → "Action pack saved", saved list now has 1 item
- Reload page → saved list still has the item
- Open saved pack → server-generated detail renders with sections
- Copy saved pack → markdown text on clipboard
- EN/KO toggle localizes the chrome (saved list header, buttons, empty state)
- Without a benchmark/decision → saved pack is the `create_benchmark` variant
  (per spec: "Do not fake populated success")

## Known limitations

- Saved packs are **canonical English** (server canonical builder uses
  `DEFAULT_EVOLUTION_STRINGS`). The UI chrome around the saved pack is
  localized, but the pack section text is the EN snapshot at save time. Locale-
  scoped persistence is a Stage 78+ decision.
- Saved packs are **immutable** — no PATCH/DELETE in Stage 77. If the scorecard
  changes (new decision / benchmark), the user must save a new pack; old saved
  packs reflect their save-time evidence.
- Saved pack detail does not yet have a dedicated route — opening lives inside
  the experiment page sub-card. A `/projects/:id/experiment/$EXP/action-pack/$ID`
  route can land in a future stage if shareable links are needed.
- `acceptanceItems` fallback for focus titles is plumbed in the helper but the
  server only passes the benchmark snapshot (titles already there); wiring the
  project-spec items remains a forward-looking improvement (Stage 78 idea).
- `pack_json` stores the structured pack; `text` is rebuilt at read time. If
  the helper text rendering changes, stored packs implicitly inherit the new
  rendering — desired for chrome but means stored packs aren't strictly
  byte-frozen artifacts. Document if/when this matters.

## Stage 78 recommendation

- **Per-locale saved pack rendering.** Either store the locale used at save
  time and re-render at read time, or store a per-locale text alongside
  `pack_json`. Pick one when there's a real bilingual user.
- **Shareable saved-pack route** `/projects/:id/experiment/$EXP/action-pack/$ID`
  — same ownership check, easier copy-paste.
- **Saved-pack outcome record** — when the user actually accepts a saved pack
  (merges PR, runs the experiment), record that the pack drove the loop, so
  the next outcome scorecard can include "this loop followed action pack X".
