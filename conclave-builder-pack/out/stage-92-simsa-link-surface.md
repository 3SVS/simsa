> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 92 — Simsa Link Surface Cleanup

**Date:** 2026-06-22
**Branch:** `chore/stage-92-simsa-link-surface`
**Scope:** Point user-facing **generated links** at the live Simsa app domain. Link surface only — no product logic, no DNS/Vercel/deploy/migration.

## Audit summary
`rg` across central-plane for `conclave-ai.dev` / `conclave-dashboard.vercel.app`. Classified:
- **A. user-facing generated link** — PR comment footer (`pr-comment.ts`): `[Simsa](https://conclave-ai.dev)` → **switch**.
- **B/D. dashboard-link fallback** — `workspace-github.ts` `DEFAULT_DASHBOARD_URL = https://dashboard.conclave-ai.dev` (never had DNS) → **switch** (used for OAuth post-connect redirect, Telegram message links, status link when env unset).
- **C. CORS / OAuth allowlist** (`cors.ts`, `workspace*.ts`, `github-oauth.ts`) — **frozen, kept** (these *allow* legacy origins for fallback; not generated links).
- **F. contact email** — `billing.ts` `hi@conclave-ai.dev` — **frozen** (no Simsa mailbox; it's an email, not an app link).
- **G. internal/frozen** — `@conclave-ai/*`, `CONCLAVE_*`, worker URL, DB, routes, Telegram bot username — **unchanged**.

## Link destination policy applied
- `app.trysimsa.com` → authenticated app / dashboard links **(used here)**
- `trysimsa.com` apex → marketing only — **not used** (no apex routing yet)
- `simsa.dev` → docs — **not used** (no routing yet)
- `conclave-dashboard.vercel.app` → legacy fallback — not used in new copy
- `conclave-ai.dev` → legacy/frozen — replaced where destination is the app

## Files changed (central-plane only; dashboard untouched)
- `src/workspace/brand.ts` — add `appUrl: "https://app.trysimsa.com"` (single source).
- `src/workspace/pr-comment.ts` — footer now `[${BRAND.productName}](${BRAND.appUrl})` (import BRAND).
- `src/routes/workspace-github.ts` — `DEFAULT_DASHBOARD_URL = BRAND.appUrl`.
- `src/env.ts` — doc comments updated to the new default.
- `test/brand.test.mjs` — pin `BRAND.appUrl`.
- `test/workspace-pr-comment-comparison.test.mjs` — footer asserts `app.trysimsa.com` + `[Simsa]` + NOT `conclave-ai.dev`.

## Generated surfaces updated
- **PR comment footer**: now `이 코멘트는 [Simsa](https://app.trysimsa.com)에서 …`.
- **OAuth post-connect redirect / Telegram dashboard links / GitHub status link**: default base now `https://app.trysimsa.com` (when `WORKSPACE_GH_DASHBOARD_URL` / `DASHBOARD_BASE_URL` unset; prod env, if set, still wins).

## Surfaces intentionally left legacy/frozen
- CORS + OAuth returnTo allowlists keep `dashboard.conclave-ai.dev` / `.conclave-ai.dev` suffix / `conclave-dashboard.vercel.app` (fallback).
- `billing.ts` contact email `hi@conclave-ai.dev` (no Simsa mailbox).
- All internal namespace (`@conclave-ai/*`, `CONCLAVE_*`, worker host, DB, routes, `Conclave_AI` bot username, `.conclave/` data).
- Pre-Stage-85 saved artifacts keep their Conclave-era headings (immutable-artifact policy).

## Tests / verification
- central-plane **1144/1144** pass, typecheck clean. (no lint task on central-plane.)
- dashboard untouched → no dashboard test/deploy.
- No deploy / migration performed.

## Deploy not executed
No production deploy, no D1 migration, no DNS/Vercel change in this PR.

## Post-merge deploy recommendation
Generated-link changes are in central-plane code → **require a central-plane deploy to take effect** (gated, manual, Bae-approved): `deploy-central-plane` workflow_dispatch with `confirm=deploy`, `apply-migrations=false`. No dashboard deploy needed. After deploy, a new PR review comment footer will link to `app.trysimsa.com`.

## Remaining follow-ups
- trysimsa.com apex routing (redirect vs landing) — separate stage.
- simsa.dev docs routing — separate stage.
- (optional) align prod `WORKSPACE_GH_DASHBOARD_URL` / `DASHBOARD_BASE_URL` env to `https://app.trysimsa.com` (operator) so links are consistent even where env is set.
- (optional) Simsa contact email to replace `hi@conclave-ai.dev` once a mailbox exists.
