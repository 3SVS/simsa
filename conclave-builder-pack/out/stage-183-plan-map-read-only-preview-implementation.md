> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 183 — Plan Map Read-only Preview Implementation

**Date:** 2026-06-24
**Branch:** `feat/stage-182-183-plan-map-preview` (renamed from `docs/stage-182-simsa-plan-map`) · **Base / deployed main:** `a1e767b`
**Type:** dashboard UI (read-only, generated). **No deploy, no MCP/npm publish, no migration, no auth/OAuth/payment/billing/hosted execution, no domain/DNS, no DB persistence, no server write, no real team approval / audit / role logic, no token/secret output, no live-dashboard change (not deployed).**

## 1. Branch rename
`docs/stage-182-simsa-plan-map` → **`feat/stage-182-183-plan-map-preview`** (local, unpushed).
The Stage 182 IA doc (`9339a9e`) stays on this branch; Stage 183 implementation builds on it.

## 2. Implementation path — **Option A**
`/projects/[id]` already has a rich route tree (idea/spec/items/checks/github/benchmark/…)
and a working client data path (`getLocalProject(id) ?? getProject(id)` with
`requirements[]` + `spec`). So a new **`/projects/[id]/map`** route is the safe path — no
invented persistence.

## 3. Route / surface implemented
- **Primary:** `apps/dashboard/src/app/projects/[id]/map/page.tsx` — the read-only Plan Map.
- **Lightweight entry:** a **"Plan Map / Where are we?" card** added to the project overview
  (`projects/[id]/page.tsx`) linking to `/map`.

## 4. Project data approach
Read-only and **generated from existing local project data** (the same client loader the
overview uses): `title` ← `project.name`, `goal` ← `project.spec.goal`, `specCompleteness`
← `project.spec.completeness`, `items` ← `project.requirements` (id/title/status). If no
project resolves, the helper still returns a valid preview with fallback copy. **No server
fetch, no persistence, no write.**

## 5. Plan Map UX summary
A pure helper (`buildPlanMapPreview`) derives a deterministic journey skeleton — Intake →
Product brief → Acceptance items → Review & evidence → Release checkpoint → Merge → Deploy —
and computes each stage's status from the project's acceptance items + spec completeness.
The page shows: read-only badge + generated note · **"You are here"** (current stage / train /
next checkpoint) · **Done / Current / Next / Later** lanes · **Evidence** (completed /
not_verified / total) · **Blockers** (evidence, failed checks, and the always-present
"Blocked by identity decision") · **Approval gates** · a **"What happens if I approve?"** card
with "This stage prepares the plan only" + "This will not deploy anything" · and a
collaboration note. Visual tone = calm review/evidence map (cards, hairline borders, status
pills), not a Kanban board; existing brand/oxblood/gold/neutral tokens only.

## 6. Status taxonomy implemented
All 13 Stage-182 statuses ship as `planMap.status.*` (EN/KO): planned · ready · in_progress ·
blocked · needs_approval · verifying · completed · skipped · not_verified · deferred ·
failed_check · merged · deployed. Acceptance-item statuses map into them (passed→completed,
failed→failed_check, needs_decision→needs_approval, building→in_progress, not_started→planned,
inconclusive/unknown→**not_verified** — never inventing a pass).

## 7. Gate model implemented
9 read-only gate cards (`merge · deploy · migration · mcpPublish · npmPublish · auth ·
payment · dns · productionWrite`), each showing **risk** (low/medium/high), an
**"Approval required"** badge, **why** the gate exists, **what changes if approved**, and
**what stays unchanged**. **No functioning approve buttons** — gates are read-only/illustrative.

## 8. i18n changes
Added a full `planMap` namespace to `dictionary.mjs` (EN + KO) + the `Dictionary` type in
`dictionary.d.mts`: core copy, sections, trains, stages, status (13), risk, blockers, and
per-gate `{label, why, changes, unchanged}`. EN/KO **key parity preserved** (the structural
`i18n.test.mjs` parity test passes); all user-facing strings come from the dictionary.

## 9. Safety / read-only boundaries
- **Read-only & generated** — `buildPlanMapPreview` does no I/O, no persistence, never throws,
  exposes no `userKey`/`token`.
- **No write actions / no approve buttons** — gates are display-only.
- **Honest copy** — "Read-only preview", "Generated from this project's current context",
  "nothing is saved", "team approvals need a future sign-in", "This preview is single-browser
  and is not a real multi-user approval".
- **No guarantee language** — a test asserts the `planMap` copy contains no
  *certified / production-ready / secure / bug-free / final approval / guaranteed* claims.

## 10. Auth / workspace limitations (explicit)
The map shows a persistent **"Blocked by identity decision"** blocker and a collaboration
note. Team ownership, assigned reviewers, role-aware gates, and an approval audit trail are
**not** implemented and require the future auth/workspace model; `userKey` is tenant-scoping,
not identity. This preview makes **no multi-user approval claims**.

## 11. Tests added
`test/plan-map.test.mjs` (pure): read-only + never-throws on malformed input; valid status for
every stage; acceptance-item → Plan-Map status mapping; **unknown/missing evidence →
not_verified** (no invented pass); evidence + identity blockers; full gate set all requiring
approval with valid risk; current-marker placement; no `userKey`/`token` fields;
`normalizePlanMapStatus`; and a dictionary test (every status + gate label present in EN/KO,
**no guarantee language**).

## 12. Verification results
- `pnpm --filter @conclave-ai/dashboard test` — **254/254** (243 + 11 new plan-map tests).
- `pnpm --filter @conclave-ai/dashboard typecheck` — **ok** (exit 0).
- `pnpm --filter @conclave-ai/dashboard build` — **ok** (`/projects/[id]/map` route built, 4.96 kB).
- `pnpm typecheck` (monorepo) — **57/57 successful**.

## 13. Docs path
`conclave-builder-pack/out/stage-183-plan-map-read-only-preview-implementation.md`

## 14. Stage 183 decision
**Option A — Plan Map read-only preview ready** (pending the verification numbers in the
completion report): `/projects/[id]/map` + overview entry compile and render from existing
project data; pure helper + tests; no persistence/auth/write; EN/KO parity preserved; copy is
honest and read-only.

## 15. Deploy status
**Not deployed.** Code is local on `feat/stage-182-183-plan-map-preview`. Any dashboard deploy
of the Plan Map needs a separate Bae deploy approval (Stage 185).

## 16. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no
migration · no MCP publish · no npm publish · no auth/OAuth · no token/secret · no domain/DNS ·
no server write · no DB persistence · no real multi-user approval/audit/role logic.

## 17. Recommended next stage
**Stage 184 — Plan Map PR Prep / Push / Review Gate** (verify, push `feat/stage-182-183-…`,
open a PR against `main`; no merge without approval). Later: **Stage 185 — Dashboard Deploy /
Plan Map Visual Dogfood**, only after explicit Bae deploy approval.
