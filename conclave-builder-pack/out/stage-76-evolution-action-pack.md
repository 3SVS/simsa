> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 76 — Evolution Action Pack

**Goal.** Turn the Stage 75 Outcome Quality Scorecard's `recommendedAction` +
`suggestedFocusItemIds` into a **deterministic, copy-ready instruction pack** a human
can hand to an agent (Claude Code / Codex / Cursor) or a teammate. No LLM, no agent
auto-run, no branch/commit/patch, no persistence table — generated on demand on the
dashboard from the scorecard (+ optional benchmark snapshot).

## Evolution action pack model

`apps/dashboard/src/lib/evolution-action-pack.mjs` (+ `.d.mts`) — pure + deterministic.
All user-facing text comes in via the localized `s` (strings) bundle = `t.evolution`,
matching the `buildCandidatePrompt` convention (already-localized parts in).

```ts
type EvolutionActionPack = {
  projectId; experimentId;
  recommendedAction: "accept" | "fix_selected" | "rerun_experiment"
                   | "clarify_acceptance_items" | "create_benchmark";
  title; summary; targetCandidateId?; focusItemIds: string[];
  sections: { title; body }[];
};
```

Functions: `buildEvolutionActionPack(input, s)`, `buildEvolutionActionPackText(pack, s, meta)`,
`resolveFocusItems(scorecard, benchmark, acceptanceItems)`, `statusLabelFor(status, s)`.
The forward-looking input type (`SavedExperiment` / `AgentBenchmarkResult` / `acceptanceItems`)
is stable so Stage 77 can move generation to central-plane persistence without reshaping it.

## recommendedAction → pack behavior

| Action | Sections |
|---|---|
| `accept` | Decision · Evidence summary · Pre-merge checklist · Next review (no code-rewrite instructions) |
| `fix_selected` | Goal · Focus acceptance items · Constraints · Expected output · After completion (targets selected candidate) |
| `rerun_experiment` | Why rerun · Suggested experiment setup · Candidate roles · How to compare results |
| `clarify_acceptance_items` | Why clarify · Items needing clarification · Questions to answer · After clarification |
| `create_benchmark` | Why benchmark first · Required inputs · Steps · What to expect |

Tone for `fix_selected`: *"Improve the selected implementation. Do not rewrite the
product intent. Focus only on the listed acceptance items and preserve already-passing
behavior."* `accept` adds no code-modification instructions; `clarify` does **not**
auto-edit acceptance items; `rerun` does **not** auto-create an experiment.

## Focus item resolution

`suggestedFocusItemIds` → title resolved from, in order: basis candidate's
`benchmark.itemOutcomesByCandidate` → `benchmark.remainingBlockers` → project
acceptance items → **fallback to itemId** (never invents a title). Status shown when
available: Issue found (`failed`) / Needs decision (`needs_decision`) / Not verified
(`inconclusive`).

## Dashboard UI

In the Outcome quality section on `/projects/:id/experiment`: an **Evolution action pack**
sub-card — desc, **Generate action pack** (fetches the benchmark snapshot for focus
titles, best effort), preview (recommended action chip + target candidate + each section
as title/body), and **Copy action pack** (deterministic markdown). When the scorecard
fails to load: *"Create a benchmark and record a decision before generating an action
pack."* With a scorecard present (even `create_benchmark`/inconclusive) the pack is
available.

## Relationship with Fix instructions (distinct surfaces, not renamed)

- **Fix instructions** — from a PR review / benchmark blocker; fix one implementation.
- **Evolution action pack** — from the experiment outcome scorecard; decide the next
  loop: accept / fix / rerun / clarify / benchmark.

## i18n

`evolution.*` namespace (EN + KO + `.d.mts`) — panel UI, action labels, status labels,
section titles + bodies, evidence template. Parity test green (10/10).

## Tests / build

- `apps/dashboard/test/evolution-action-pack.test.mjs` — 9 (one pack per action, focus
  status labels, focus→itemId fallback, acceptance-item title fallback, copy markdown
  shape + **no userKey/token leak**).
- Dashboard **150/150**, i18n parity **10/10**, typecheck **54/54**, lint clean
  (pre-existing export warning only), build green.

## Live verification

Dashboard redeployed to `https://conclave-dashboard.vercel.app`. `/projects/:id/experiment`
renders; with a scorecard the Generate action pack button + preview + Copy work. EN/KO
toggle localizes the pack (sections follow UI language).

## Known limitations

- Generation is dashboard-side and not persisted (Stage 77 → central-plane).
- Full `fix_selected` pack with resolved focus titles needs a benchmark + selected
  candidate; the `create_benchmark`/inconclusive pack works with no benchmark.
- Acceptance-item title fallback is wired in the helper but the dashboard currently
  passes only the benchmark snapshot (titles already present there); project-spec items
  wiring is deferred.

## Stage 77 recommendation

Persist action packs in central-plane (mirror Stage 65/72 pattern: migration + canonical
`.ts` helper sharing a golden fixture with the `.mjs`, ownership-validated POST/GET),
so packs are revisitable/shareable and can carry the resolved focus titles server-side.
