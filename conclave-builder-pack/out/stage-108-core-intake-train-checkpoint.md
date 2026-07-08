> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 108 — Core Intake Train Checkpoint

**Date:** 2026-06-23
**Train branch:** `feat/stage-101-unified-intake` · **PR #142** (OPEN) · HEAD `119ce1a`
**Base:** `origin/main` `78f766f`.

## Summary
A dashboard-only, **deterministic, preview-only** implementation of the unified intake → staged-acceptance flow. Six starting points (idea / PRD / product URL / GitHub repo / pull request / AI-built app) each produce a per-type preview and converge into a shared **Acceptance Map** and **Stage Plan**. Nothing is fetched, AI-generated, persisted, or sent to central-plane.

## Included stages
- **101 — Unified Intake Model** (`lib/intake.mjs`): 6 types → same 6 outputs; `buildIntakeDraft`; route `/projects/new/intake`. 9 tests.
- **102 — PRD / Spec Intake** (`lib/intake-prd.mjs`): `buildPrdIntakePreview`. 9 tests.
- **103 — Product URL Intake** (`lib/intake-url.mjs`): `buildProductUrlIntakePreview` (no crawl). 9 tests.
- **104 — GitHub Repo Intake v1** (`lib/intake-github-repo.mjs`): `buildGitHubRepoIntakePreview` (no GitHub API/clone). 11 tests.
- **105 — Existing App Recovery Assessment** (`lib/intake-ai-built-app.mjs`): `buildAiBuiltAppRecoveryPreview` (no live inspection). 13 tests.
- **106 — Intake → Acceptance Map** (`lib/intake-acceptance-map.mjs`): shared map (areas, 5–10 acceptance items w/ status, next step). 10 tests.
- **107 — Intake → Stage Plan** (`lib/intake-stage-plan.mjs`): Acceptance Map → ordered 4–7 stage plan + release gate + recommended start. 9 tests.
- **108 — Checkpoint** (this doc).

## User-facing flow (`/projects/new/intake`)
Pick a starting point → "Paste what you have" → **Intake draft** → **type-specific preview** (PRD / URL / repo / app-recovery, where applicable; each with a "Use example …" button) → **Acceptance Map** → **Stage Plan**. First internal implementation of the public promise: *start from anything → staged acceptance workflow.*

## Surfaces changed
`apps/dashboard/src/lib/intake*.mjs` + `.d.mts` (7 helpers), `apps/dashboard/test/intake*.test.mjs` (7 suites), `apps/dashboard/src/app/projects/new/intake/page.tsx` (new route), `conclave-builder-pack/out/stage-101..108`. No `pnpm-lock.yaml` change (no new dependencies).

## Surfaces intentionally unchanged
`apps/central-plane`, `database/migrations`, `apps/simsa-landing`, `apps/simsa-dev`, `.github/workflows`, `packages/*` — **no diff** (audited). Existing `/projects/new` idea→spec flow untouched. Internal `@conclave-ai/*` / `CONCLAVE_*` namespace frozen.

## Verification
- `apps/dashboard`: **261/261** tests, typecheck clean, build green (`/projects/new/intake` ≈ 11 kB, static).
- Monorepo `turbo run typecheck`: **56/56**.
- Secret/token scan of `origin/main...HEAD`: none.

## Known warnings
- Dashboard lint: only the **pre-existing** `apps/dashboard/src/app/projects/[id]/export/page.tsx` (236:107) `react-hooks/exhaustive-deps` warning. **Not from this train; non-blocking.** No new warnings introduced.

## No-go / out of scope (not yet implemented — later trains)
live URL crawl · GitHub API fetch · repo clone · file upload · PR diff review from the intake route · DB persistence · project creation from intake · saved acceptance maps · saved stage plans · AI generation · central-plane connection.

## Deploy plan (post-merge, gated)
Dashboard UI only → deploy `apps/dashboard` to **app.trysimsa.com** (Vercel `conclave-dashboard` project, repo-root `vercel deploy --prod`). **No** central-plane deploy, **no** D1 migration, **no** landing/simsa.dev deploy, **no** domain change.

## Smoke plan (after deploy)
`app.trysimsa.com/projects/new/intake` → 6 intake cards; select each → input; "Create intake draft" → Intake draft + type-specific preview (PRD only for PRD, URL only for product_url, etc.) + Acceptance Map (all) + Stage Plan (all). `app.trysimsa.com/projects/new` idea→spec still works. `app.trysimsa.com` dashboard loads. `trysimsa.com` / `simsa.dev` / `conclave-dashboard.vercel.app` unchanged.

## Rollback
Dashboard breaks → redeploy previous `conclave-dashboard` production deployment (instant) or revert PR #142. `/projects/new/intake` is an isolated new route (preview-only, no persistence) — low blast radius. Landing/simsa.dev/central-plane unaffected. No DB rollback.

## Recommendation
**Ready to merge.** No blockers: dashboard-only, deterministic/preview-only, all checks green, no unintended changes, no secrets, no new deps, existing flows untouched.
Suggested: **merge PR #142 (squash) → deploy dashboard to app.trysimsa.com** (one gated step), then smoke. Or merge now / deploy later if preferred.

## Status
Merge: NOT executed. Deploy: NOT executed. Awaiting Bae approval.
