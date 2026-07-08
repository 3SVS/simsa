> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 116 — Agent Workflow Train Checkpoint

**Date:** 2026-06-23
**PR:** #144 · **Branch:** `feat/stage-110-agent-run-plan` · **HEAD:** `2b1e52d`
**Status:** checkpoint — decision-ready. **Not merged, not deployed, migration not applied.**

This document is the decision-ready handoff for merging / migrating / deploying
the Stage 110~116 Agent Workflow Train. It mirrors the PR #144 description.

---

## Summary
The Agent Workflow Train turns a saved intake workflow into a full, deterministic
**preview chain** showing what work should happen, who should do it, what evidence
is needed, how a benchmark comparison would be prepared, how decision criteria
would be linked, and what next actions would be suggested — **without executing
anything**. Stage 112/112B added the only backend in the train: a tenant-scoped
D1 table + read/write central-plane routes to persist the workflow snapshot.

## Included stages
- **Stage 110** — Stage Plan → Agent Run Plan (`intake-agent-run-plan`)
- **Stage 111** — Acceptance Item Evidence Model (`intake-evidence-plan`)
- **Stage 112** — Persisted Agent Workflow Records (migration 0046 + routes + save/load UI)
- **Stage 112B** — Agent Workflow Record Tenant Scoping (`user_key`)
- **Stage 113** — Intake Run to Benchmark Handoff (`intake-benchmark-handoff`)
- **Stage 114** — Agent Run Decision and Outcome Link (`intake-decision-outcome-link`)
- **Stage 115** — Evolution Action Pack from Agent Workflow (`intake-evolution-action-preview`)
- **Stage 116** — Checkpoint (this document)

## User-facing flow (`/projects/new/intake`)
Intake → Acceptance Map → Stage Plan → Agent Run Plan → Evidence Plan → **Save
workflow plan** → Saved workflow plans (list) → (open record) Benchmark Handoff
Preview → Decision / Outcome Link Preview → Evolution Action Pack Preview. Every
preview is deterministic, dashboard-side, and labeled preview-only. The existing
`/projects/new` idea-to-spec flow is untouched.

## Saved workflow persistence
Saving is **optional** — the preview works without it. On save, the dashboard
POSTs the snapshot (acceptance map + stage plan + agent run plan + evidence plan +
source summary + excerpt) to central-plane, which stores it in
`workspace_agent_workflow_records` with a `wawr_` id. List/detail re-read it.
Snapshots are stored as TEXT; each snapshot is capped (≤200 KB) and the raw input
is stored as a length-limited excerpt (≤2000 chars) only.

## Tenant scoping (Stage 112B)
Every record is scoped to a `user_key`. POST creates under the caller's `userKey`;
GET list returns only that user's records (the `projectId` filter applies within
scope); GET detail returns the record only when `record.user_key === userKey`,
otherwise **404** (does not reveal another tenant's record). `user_key` is never
exposed in responses or the dashboard UI.

**Nuance (do not overclaim):** the repo convention is a **client-supplied
`userKey`** (dashboard `getUserKey()`, an anonymous localStorage key sent in the
POST body / GET query), the same model used by the existing workspace
benchmark/experiment/credit APIs. This is **tenant scoping, not full
session/auth security.** Hardening to server-derived identity would be a separate
future change.

## Surfaces changed (vs `origin/main`, 29 files, +4455/-2)
- Dashboard libs (+ `.d.mts`): `intake-agent-run-plan`, `intake-evidence-plan`,
  `intake-benchmark-handoff`, `intake-decision-outcome-link`,
  `intake-evolution-action-preview`, `workspace-agent-workflow-api.ts`
- Dashboard tests: `intake-agent-run-plan`, `intake-evidence-plan`,
  `intake-benchmark-handoff`, `intake-decision-outcome-link`,
  `intake-evolution-action-preview`
- Dashboard page: `src/app/projects/new/intake/page.tsx`
- Central-plane: `migrations/0046_workspace_agent_workflow_records.sql`,
  `src/workspace/agent-workflow-record-db.ts`,
  `src/routes/workspace-agent-workflow.ts`, `src/router.ts`,
  `test/workspace-agent-workflow.test.mjs`
- Docs: `conclave-builder-pack/out/stage-110…115` + this checkpoint

## Surfaces intentionally unchanged
`apps/simsa-landing`, `apps/simsa-dev`, `.github/workflows/**`, `packages/**`,
billing/payment, domain/DNS, OAuth/CORS allowlists, the internal `@conclave-ai/*`
namespace, and the existing `/projects/new` flow. Audited — none changed.

## Verification (HEAD 2b1e52d)
- dashboard tests: **306/306**
- central-plane tests: **1164/1164**
- dashboard typecheck: clean · central-plane typecheck: clean
- monorepo `turbo run typecheck`: **56/56**
- dashboard build: **green** (`/projects/new/intake` 20.1 kB)

## Known warnings
Only the pre-existing `apps/dashboard/src/app/projects/[id]/export/page.tsx`
`react-hooks/exhaustive-deps` warning. **Not introduced by this train;
non-blocking.** No new warnings/errors from Stages 110~116.

## Migration readiness (0046)
Confirmed in `0046_workspace_agent_workflow_records.sql`:
`user_key TEXT NOT NULL` ✓ · `project_id` nullable ✓ · all four snapshot columns
`… _json TEXT NOT NULL` ✓ · `status TEXT NOT NULL DEFAULT 'planned'` ✓ · indexes
`(user_key, created_at DESC)` and `(user_key, project_id, created_at DESC)` ✓.
**Additive (new table only); not applied to production.** Migration 0046 is
**required before** the central-plane routes can function in production.

## Secret/token scan
Scanned all 29 changed files for common secret patterns
(`sk-`, `AKIA`, `ghp_`, `xox*`, PEM headers, `postgresql://`, `mongodb+srv://`,
`Bearer …`). **No sensitive literals found.** (Previously exposed Vercel token
was operator-revoked/rotated; token hygiene maintained — no token values output.)

## Production migration/deploy implications
PR #144 is **no longer dashboard-only** — it adds central-plane routes + D1
migration 0046. Dashboard save/load calls those routes, so the save/load feature
is non-functional until central-plane is deployed with the migration applied.
(The intake preview chain itself works without the backend; only save/load and the
saved-record-derived previews need it.)

### Rollout options
- **Option A — Merge only, no deploy/migration.** Pros: code on main, zero schema
  change, zero runtime risk. Cons: save/load + saved-record previews not live on
  app.trysimsa.com.
- **Option B — Merge + dashboard deploy only.** Not recommended: dashboard
  save/load would call central-plane routes that are not live (errors surfaced via
  the existing `{ok:false,error}` path, but a broken-looking Save button).
- **Option C — Merge + apply migration 0046 + deploy central-plane + deploy
  dashboard + smoke.** Full feature rollout (the real production path).
- **Option D — Split rollout: merge → deploy central-plane *with* migration →
  then deploy dashboard.** Safer ordering of C (backend live before the UI that
  calls it).

## Recommended rollout
**READY TO MERGE + CONTROLLED FULL ROLLOUT**, using **Option D ordering** when Bae
approves:
1. Apply D1 migration 0046 (additive new table).
2. Deploy central-plane (Actions → deploy-central-plane → `confirm=deploy`,
   apply-migrations as configured).
3. Deploy dashboard (repo root; project `conclave-dashboard`; alias
   app.trysimsa.com).
4. Smoke (below).

If there is any uncertainty about the D1 migration or the `userKey` scoping model,
fall back to **merge later after additional review**. **Do not execute merge,
deploy, or migration in this stage.**

## Smoke plan (after explicit approval)
`https://app.trysimsa.com/projects/new/intake` — page loads; 6 intake cards;
Create intake draft; Acceptance Map; Stage Plan; Agent Run Plan; Evidence Plan;
Save workflow plan → saved id/status/timestamp; Saved workflow plans list loads;
open record → JSON snapshot; Benchmark Handoff Preview; Decision / Outcome Link
Preview; Evolution Action Pack Preview.
**Tenant smoke:** records saved under the current browser `userKey` appear in the
list; a different userKey/localStorage context does not list them; a direct detail
fetch with a different `userKey` returns 404.
**Existing-flow smoke (must be unchanged):** `app.trysimsa.com/projects/new`,
`app.trysimsa.com`, `trysimsa.com`, `simsa.dev`, `conclave-dashboard.vercel.app`.

## Rollback plan
- **Dashboard deploy fails:** roll back the previous dashboard production
  deployment; central-plane can remain (routes unused).
- **Central-plane deploy fails:** roll back the previous Worker; roll back / hide
  dashboard save/load.
- **Migration issue:** 0046 is an additive new table — no existing table/data is
  touched; if needed, leave the unused table in place; **no destructive drop in
  production without separate approval.**
- **Tenant-scoping bug:** roll back the central-plane route + dashboard save/load
  UI; do not expose saved workflow records until fixed.

## Risks → mitigations
- First new D1 table of this train → **additive only**; cross-tenant tests added.
- `userKey` is tenant scoping, not full auth → matches existing workspace APIs;
  documented; server-derived identity is a separate future change.
- Save/load now depends on central-plane availability → preview chain still works
  offline; failures surface via `{ok:false,error}`; Option D deploys backend first.
- Intake page bundle grew (≈14.3 → 20.1 kB) → still small; static route.
- Snapshots stored as TEXT → snapshot ≤200 KB cap + excerpt ≤2000 chars enforced.
- Overclaiming execution → strict preview-only vocabulary; no agent execution, no
  benchmark/decision/scorecard/action-pack execution or persistence.

## Recommendation
**READY TO MERGE + CONTROLLED FULL ROLLOUT** (Option D ordering) pending Bae
review. **Merge, deploy, and migration are NOT executed in this stage.**
