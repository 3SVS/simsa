> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 124 — Private Beta Checkpoint

**Date:** 2026-06-23
**PR:** #146 · **Branch:** `feat/stage-118-saved-workflow-management` · **HEAD:** `d804dcf`
**Status:** checkpoint — decision-ready. **Not merged, not deployed, no migration (none in this train).**

Decision-ready handoff for the Stage 118~124 Beta Readiness / Team Usage train.
Evaluate this as a **beta safety / operations train**, not a core product feature
train. Mirrors the PR #146 description.

## Summary
This train wraps beta-readiness layers around the (already-live) saved agent
workflow feature so Simsa can run a **controlled private beta** without
overclaiming auth, execution, billing, or team-workspace readiness.

## Included stages
- **118** Saved Workflow Management Hardening — tenant-scoped archive/restore/delete
- **119** Beta Feedback Capture — safe `mailto` feedback
- **120** Preview-only Onboarding / Empty States — comprehension + empty states
- **121** Admin Beta Console — operator view/manage saved-workflow summaries
- **122** Usage Limits / Cost Boundary UI — honest "no billing/execution" copy
- **123** Auth / Workspace Boundary Decision — private/invite-only, no real auth yet
- **124** Private Beta Checkpoint (this document)

## Beta readiness improvements
Users/operators can now archive/delete records; send safe feedback (no raw
content); understand preview-only behavior; an operator can oversee/clean records;
users see no-billing/no-execution boundaries; the private-beta auth boundary is
documented.

## User-facing changes (`/projects/new/intake`)
Onboarding panel + preview-language legend; before-input empty state + secrets
warning; "Beta usage boundary" panel + "no billing active" note; Saved workflow
plans: Show-archived toggle, per-record Open/Archive/Restore/Delete (delete
confirmed), tenant-scope + retention + usage notes; feedback links (page /
Evidence Plan / saved detail) that open `mailto` with **safe context only**.

## Admin/operator changes (`/admin/workflows`)
New page: admin-key input (not stored), userKey/status filters + include-archived,
summary cards (total/planned/needs-evidence/archived/unique userKeys), per-record
archive/restore/delete. Summaries only (no snapshot JSON). Disclaimers: userKey is
tenant scoping not full auth; counts are activity signals not billing metrics.

## Auth / tenant boundary (honest)
Saved workflow records stay scoped by the existing **client-supplied `userKey`**;
cross-`userKey` list/detail/PATCH/DELETE is blocked (cross-tenant detail → 404,
verified). Admin console gated by `x-admin-key` (existing `ADMIN_USAGE_STATS_KEY`).
This is **tenant scoping, not full account authentication**; private beta stays
**invite/manual, not open signup**. Real auth/workspace deferred to a future train
(Stage 123).

## Usage / cost boundary
Deterministic, low-cost previews; lightweight snapshots; **no agent/benchmark/LLM
execution and no billing/enforcement**. Copy avoids active-billing language
(verified). Future AI/agent execution will need explicit usage limits.

## Surfaces changed (vs `origin/main`, 22 files, +2107/-57)
central-plane: `routes/workspace-agent-workflow.ts`,
`workspace/agent-workflow-record-db.ts`, `test/workspace-agent-workflow.test.mjs`.
dashboard libs (+`.d.mts`/tests): `workspace-agent-workflow-api.ts`,
`admin-agent-workflows-api.ts`, `beta-feedback`, `beta-onboarding`,
`beta-usage-boundary`. dashboard pages: `app/projects/new/intake/page.tsx`,
`app/admin/workflows/page.tsx`. Docs: stage-118…123.

## Surfaces intentionally unchanged
`apps/simsa-landing`, `apps/simsa-dev`, `.github/workflows/**`, `packages/**`,
billing/payment, domain/DNS, **migrations (none added)**, auth provider/session,
the internal `@conclave-ai/*` namespace, and the existing `/projects/new` flow.
Audited — none changed.

## Verification (HEAD d804dcf)
- central-plane: **1181/1181** · dashboard: **333/333** · both typecheck clean.
- monorepo `turbo run typecheck`: **56/56**.
- dashboard build: **green** (`/projects/new/intake` 22.5 kB, `/admin/workflows`
  2.59 kB).
- **Migration audit: no migration files changed** in this train (archive reuses
  the `status` column; admin reuses the table + admin-key convention; Stage 123
  docs-only).
- **Secret scan** over the 22 changed files: **no sensitive literals found**
  (no token values output; previously exposed Vercel token remains
  operator-revoked/rotated).

## Known warnings
Only the pre-existing `apps/dashboard/src/app/projects/[id]/export/page.tsx`
`react-hooks/exhaustive-deps` warning. Not introduced by this train; non-blocking.

## Production deploy implications
This train **changes central-plane code** (`PATCH`/`DELETE
/workspace/agent-workflows/:id`, `GET` `includeArchived`, admin endpoints), so
**dashboard-only deploy is not sufficient** — the dashboard archive/delete/admin
UI calls these routes. **No D1 migration is needed.** A full rollout = central-
plane deploy → dashboard deploy.

## Rollout options
- **A — Merge only, no deploy:** code on main; improvements not live.
- **B — Merge + dashboard deploy only:** not recommended (archive/delete/admin UI
  calls central-plane routes that wouldn't be live).
- **C — Merge + central-plane deploy + dashboard deploy + smoke:** recommended
  (no migration). Order: merge → central-plane → dashboard → smoke.
- **D — Hold PR open:** only if blockers found.

## Recommendation
**READY TO MERGE + CONTROLLED ROLLOUT** (Option C), pending Bae approval:
1. squash merge PR #146
2. deploy central-plane (Actions → deploy-central-plane → `confirm=deploy`;
   **apply-migrations can be false** — no migration in this train)
3. deploy dashboard (repo root; project `conclave-dashboard`; alias
   app.trysimsa.com)
4. smoke (below)

**Merge / deploy are NOT executed in this stage.** If any blocker is found →
*READY TO MERGE BUT HOLD DEPLOY* or *NOT READY*.

## Smoke plan (after approval)
**Saved workflow management** (`app.trysimsa.com/projects/new/intake`): list loads;
archive own record; archived hidden by default; Show-archived reveals it; restore;
delete (confirm) removes it; cross-userKey archive/delete/detail stays blocked.
**Feedback/onboarding:** onboarding panel + preview-language legend + usage-boundary
panel appear; feedback links open `mailto` with safe context only (no raw
input/snapshot/userKey).
**Admin** (`app.trysimsa.com/admin/workflows`): admin key required; summaries load
with valid key; no snapshot JSON; filters work; archive/restore/delete work;
disclaimer present.
**Regression (unchanged):** `app.trysimsa.com`, `/projects/new`, `trysimsa.com`,
`trysimsa.com/demo`, `simsa.dev`, `conclave-dashboard.vercel.app`.

## Rollback plan
- central-plane deploy fails → roll back Worker; do not deploy dashboard.
- dashboard deploy fails → roll back dashboard (central-plane may remain; unused).
- admin endpoint issue → roll back central-plane; do not expose `/admin/workflows`.
- archive/delete issue → roll back central-plane + dashboard save-management UI.
- **No migration rollback needed** (no migration introduced).

## Risks → mitigations
- Admin console exposes cross-userKey **summaries** → no snapshot JSON in admin
  list; admin-key gated (existing convention).
- Admin key is a shared secret, not RBAC → matches existing admin routes;
  documented; RBAC deferred (Stage 123).
- Delete is a hard delete → UI confirmation + archive offers non-destructive hide.
- `userKey` is tenant scoping, not full auth → documented; invite-only beta.
- Dashboard management depends on central-plane → Option C deploys backend first.
- Beta copy must not overclaim → tests assert no completion/active-billing/secure-
  workspace claims; no agent/benchmark/billing execution added.

## Recommendation (final)
**READY TO MERGE + CONTROLLED ROLLOUT** (Option C) pending Bae review. No merge,
deploy, or migration executed in this stage.
