> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 100 — Public Trust Train Checkpoint

**Date:** 2026-06-23
**Train branch:** `feat/stage-94-simsa-dev` · **PR #141** (OPEN) · HEAD `8575e49`
**Base:** `origin/main` `cbd4ea2` (Stage 93 landing).

## Summary
A public-surface-only train (Stages 94–100): a developer placeholder for `simsa.dev`, and a fuller trust / positioning / early-access / legal-lite / demo surface for the `trysimsa.com` landing. **No backend, DB, central-plane, dashboard, auth, billing, migration, or npm-publish changes.** Public product name **Simsa**; internal `@conclave-ai/*` namespace frozen.

## Included stages
- **94 — simsa.dev Developer Surface**: new standalone `apps/simsa-dev` placeholder ("Simsa for Developers / docs coming soon", Open Simsa, View on GitHub (public repo), "MCP package — coming soon").
- **95 — Public Trust & Contact Surface**: trust + how-it-works + contact sections (`mailto:seunghunbae@b2w.kr`).
- **96 — Staged Acceptance Positioning**: start-from-anything → what Simsa creates → how the workflow runs.
- **97 — Early Access Request Path**: mailto-based early access (hero CTA + dedicated section, prefilled mailto + guidance).
- **98 — Legal-lite Pages**: `/privacy` + `/terms` early-access notes (not final legal docs), footer links.
- **99 — Public Demo Project**: static, login-free, fully-fictional `/demo` ("AI-built Task App") showing input → understanding → acceptance items → stage plan → evidence & decision → output.
- **100 — Checkpoint** (this document).

## Surfaces changed
- `apps/simsa-landing/` — routes `/`, `/demo`, `/privacy`, `/terms`; `globals.css`.
- `apps/simsa-dev/` — new app (placeholder + contact/demo/legal footer links).
- `pnpm-lock.yaml` (new `@conclave-ai/simsa-dev` package).
- `conclave-builder-pack/out/stage-94-simsa-dev.md` + this checkpoint doc.
  (Stages 95–99 are documented in the PR description + memory rather than per-stage repo files.)

## Surfaces intentionally unchanged
`apps/dashboard`, `apps/central-plane`, `packages/*`, `database/migrations`, `.github/workflows` — **no diff** (audited via `git diff --name-only origin/main...HEAD`). Internal namespace (`@conclave-ai/*`, `CONCLAVE_*`, `workspace_*` tables, `/workspace/*` routes, `.conclave/*`, `ConclaveSandbox`) untouched. `app.trysimsa.com` (dashboard project) and `conclave-dashboard.vercel.app` untouched.

## Verification
- `apps/simsa-landing` + `apps/simsa-dev`: build (all routes static-prerendered: `/`, `/demo`, `/privacy`, `/terms` on landing; `/` on dev), typecheck, lint — **all green**.
- Monorepo-wide `turbo run typecheck`: **56/56 packages pass**.
- Secret/token literal scan of `origin/main...HEAD` diff: **none found**.
- Changed-surface audit: only the two simsa apps + lockfile + docs. **No unexpected files.**

## No-go / out of scope (not in this train)
production deploy · Vercel project/domain attach · DNS · D1 migration · billing/payment · auth · central-plane/dashboard changes · internal namespace rename · npm publish · analytics/cookie banner/third-party scripts · backend form/DB/email-provider.

## Deploy plan (post-merge, each under explicit approval)
1. **trysimsa.com landing** — the `simsa-landing` Vercel project + `trysimsa.com` already exist (Stage 93B). Redeploy `apps/simsa-landing` to production → ships the new `/demo`, `/privacy`, `/terms`, and updated home copy. Low risk.
2. **simsa.dev developer surface (Stage 94B, still PENDING)** — no Vercel project/domain exists yet. Create a new `simsa-dev` Vercel project (root `apps/simsa-dev`), assign `simsa.dev`, deploy. This is the only step that creates new infra.

No central-plane deploy, dashboard deploy, or D1 migration required.

## Smoke plan (after deploy)
| URL | Expected |
|-----|----------|
| `https://trysimsa.com` | landing (hero + trust + positioning + early access) |
| `https://trysimsa.com/demo` | fictional demo |
| `https://trysimsa.com/privacy` | Privacy Note |
| `https://trysimsa.com/terms` | Terms Note |
| `https://simsa.dev` | developer placeholder (after Stage 94B) |
| `https://app.trysimsa.com` | dashboard (unchanged) |
| `https://conclave-dashboard.vercel.app` | legacy dashboard fallback (unchanged) |

Also confirm no "Conclave" public copy on the new surfaces and that internal links (Privacy/Terms/Demo) resolve.

## Rollback
- Landing breaks → redeploy the previous `simsa-landing` production deployment (instant rollback in Vercel), or revert the landing files. `app.trysimsa.com` unaffected.
- simsa.dev breaks → unassign `simsa.dev` from the `simsa-dev` project (or leave it unassigned). Landing + dashboard unaffected.
- No DB / migration → no server-side rollback.

## Recommendation
**Ready to merge.** No blockers: scope is public-surface-only, all checks green, no unintended changes, no secrets.

Suggested sequence:
1. **Merge PR #141** (squash). No auto-deploy fires (these apps aren't wired to the central-plane deploy workflow).
2. **Deploy landing first** (project + domain already exist) — lowest risk, immediately ships /demo + legal + new copy to trysimsa.com.
3. **Then Stage 94B** (create simsa-dev Vercel project + assign simsa.dev + deploy) as a separate approved step, since it creates new infra.

Merge and deploy await Bae's approval.

## Status
Merge: NOT executed. Deploy: NOT executed. Domain/DNS: NOT changed. Awaiting approval.
