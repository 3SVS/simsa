> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 201 — Better Auth Package / Version Final Check

**Date:** 2026-06-25
**Branch:** `docs/stage-201-better-auth-package-version-check` · **Base / main:** `b344e0f` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** package/version research / docs only. **No Better Auth install, no `pnpm add`, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no local D1 migration run, no Vercel rewrite, no CORS code, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

> Verified against **current npm + Better Auth docs/GitHub** (URLs in §Sources). Package/version
> facts not confirmable from a primary source are marked **[verify]**. No tokens/secrets. **Nothing
> installed; no package file touched.**

## 1. Executive summary
**Package install is NOT approved.** This stage only selects the **proposed package/version plan**.
- **Recommended package: `better-auth`** (single core package; MIT).
- **Version: current stable line is `1.6.x`** (latest **`1.6.20`** as of 2026-06-24 — **supersedes
  the "1.5.x" assumption in Stage 188/194**). **Pin an EXACT, freshly re-verified `1.6.x` version
  immediately before install** (Better Auth ships ~weekly — re-check at install time).
- **Adapter: native D1 / built-in Kysely** — **no Drizzle, no separate adapter package** for the
  MVP path. Optional community `better-auth-cloudflare` only as a scaffolding convenience (not
  required).
- **Hono integration: no separate package** (`auth.handler(c.req.raw)` mount).
- **Scope: add `better-auth` to `apps/central-plane` only.** A future **local spike may proceed
  only after the separate phrases** (package/version → spike → migration → implementation →
  deploy).

## 2. Current repo dependency baseline (inspected)
- **Package manager:** **pnpm + Turbo** monorepo; **ESM-only** (`"type": "module"`); Node ≥ 20.
- **Central-plane package:** `apps/central-plane/package.json` (`@conclave-ai/central-plane`,
  v0.13.0, MIT, Cloudflare Worker + D1).
  - **dependencies:** `@cloudflare/containers ^0.0.30`, `@conclave-ai/core workspace:*`,
    **`hono ^4.6.14`**.
  - **devDependencies:** `@cloudflare/workers-types ^4.x`, `typescript ^5.7.0`, **`wrangler ^4.83.0`**.
  - **scripts:** `wrangler dev`, `wrangler deploy`, `wrangler d1 migrations apply/execute …`,
    `node --test test/*.test.mjs`.
- **Lockfile:** root `pnpm-lock.yaml` (single workspace lockfile).
- **Constraints affecting a future install:** ESM-only · TypeScript strict · runs on the
  **Cloudflare Workers** runtime (no Node-only APIs at runtime) · lockstep release policy (avoid
  unrelated version churn). → Better Auth + adapter must be **Workers/edge-safe** and ESM.

## 3. Better Auth package identity (verified)
- **npm package name:** **`better-auth`** (the install target). (`@better-auth/core` exists as an
  internal core module — not the package you install directly.)
- **Current latest:** **`1.6.20`** (last published ~4 days before 2026-06-24). **Latest stable line
  = `1.6.x`.** v1.5 line landed 2026-02-28; **1.6.x is now current** → target **1.6.x**, not 1.5.x.
- **License:** **MIT.**
- **Hono integration:** **core package only** (no separate Hono package).
- **D1/Kysely/Drizzle/Cloudflare:** **built-in Kysely adapter covers SQLite/D1**; Drizzle optional;
  community `better-auth-cloudflare` optional. **No separate adapter package required** for the
  built-in D1/Kysely path **[verify the exact built-in-D1 wiring at install]**.

## 4. Adapter / database path
| Path | Extra package | Maintenance risk | Dependency churn | Docs clarity | Migration generation | Workers/D1 fit | Spike simplicity |
|---|---|---|---|---|---|---|---|
| **Built-in Kysely + D1** *(recommended)* | **none** | low (first-party) | **minimal** | good | Better Auth CLI/generator **[verify on D1]** | native | **simplest** |
| Drizzle adapter | `drizzle-orm` (+ kit) | medium | higher | good | Drizzle migrations | works | more deps |
| Community `better-auth-cloudflare` | `better-auth-cloudflare` (~v0.3.0) | **community** (smaller maintainer) | medium | example-driven | CLI scaffolding | tailored | convenient but adds a dep |
| No adapter (stateless) | none | n/a | none | n/a | n/a | loses DB sessions | rejects DB-backed sessions |
**Recommendation: built-in Kysely + native D1** — fewest dependencies, first-party, fits the
DB-backed-session decision (avoids the cookieCache+KV #4203 class). Re-verify the exact built-in-D1
binding before install **[verify]**.

## 5. Hono / Workers integration package needs (verified)
- **No separate Hono package** — mount `app.on(["POST","GET"], "/api/auth/*", c => auth.handler(c.req.raw))`.
- **Edge runtime:** Better Auth runs on Workers (community D1/Hono examples exist); the **built-in
  path must avoid Node-only deps** — **[verify Better Auth 1.6.x has no Node-only runtime dep on the
  Workers path]**.
- **Cloudflare caveats:** D1 binding + `wrangler dev` local; **[verify]** the exact env/binding
  wiring (Stage 198/192 flagged this).

## 6. Proposed package change boundary for the future spike (if approved)
- **Only** `apps/central-plane/package.json` `dependencies`: add **`better-auth`** (exact 1.6.x).
- **Expected lockfile change:** `pnpm-lock.yaml` gains `better-auth` + its transitive deps **only**.
- **No** unrelated dependency upgrades · **no** dashboard package changes (auth runs in
  central-plane) · **no** monorepo-wide version churn · **no** new package scripts unless separately
  approved.

## 7. Version pin proposal
- **Pin an EXACT version** (e.g. `"better-auth": "1.6.20"` — **re-verify the then-latest 1.6.x at
  install**), **not a caret range**, for the spike → reproducible + auditable.
- **Avoid `^`/`~` ranges** for the auth dependency during the spike (Better Auth releases ~weekly;
  ranges would drift).
- **Later security/bugfix updates:** bump deliberately, re-checking #4203/#10021 + the changelog,
  under a separate review (not auto-float).

## 8. Known issue / version risk check
| Item | Source | Status | Class | Note |
|---|---|---|---|---|
| **#4203** secondaryStorage TTL re-login (cookieCache+KV) | github #4203 | OPEN (reopened Jan 2026); **re-verify vs 1.6.x [verify]** | **Caution** | avoid cookieCache+KV; DB-backed D1 sessions |
| **#10021** expired cookie cache logs out vs DB fallback | github #10021 | open (same family); **re-verify vs 1.6.x [verify]** | **Caution** | don't rely on cookieCache fallback |
| D1/Hono/Workers edge wiring | docs/community | **[verify]** | **Watch** | confirm built-in-D1 path at install |
| Cookie/session defaults (SameSite etc.) | docs | **[verify]** | **Watch** | set explicitly (Stage 198) |
| Organization plugin | docs | deferred (not MVP) | **Mitigated** | not used in identity-only slice |
| Release cadence / version drift | npm (1.6.20, ~weekly) | active | **Watch** | pin exact; re-verify at install |
**Net: no blocker.** All caution/watch; **re-verify #4203/#10021 against the exact 1.6.x at install**.

## 9. Future install approval boundary
Exact phrase required before any package change: **"Better Auth package/version approved."** This
approves **only** the package/version install (adding `better-auth` to central-plane + the resulting
lockfile change). It does **NOT** approve: auth routes · session middleware · OAuth · migration ·
local spike · deploy · env vars. (Each is its **own** phrase — Stage 197.)

## 10. Future local-spike dependency preflight (checklist, do NOT run now)
- [ ] Re-check the **then-latest `better-auth` 1.6.x** version + changelog.
- [ ] Re-check Better Auth docs (built-in D1/Kysely + Hono mount).
- [ ] Confirm the package target = **`apps/central-plane`** only.
- [ ] Confirm the **pnpm** command (e.g. `pnpm --filter @conclave-ai/central-plane add better-auth@<exact>`) **[verify]**.
- [ ] Confirm expected files to change = central-plane `package.json` + root `pnpm-lock.yaml`.
- [ ] Confirm **no broad/unrelated upgrade** in the lockfile diff.
- [ ] Review the **lockfile diff before commit**.
- [ ] **STOP** if dependency churn is larger than expected (unexpected major transitive changes).

## 11. Rollback plan for a package-only change
Revert `apps/central-plane/package.json` + `pnpm-lock.yaml` (git checkout) · remove the installed
dependency · **no database changes** · **no live changes** · **no env changes** · **no dashboard
changes**. A package-only install is fully reversible with a git revert + `pnpm install`.

## 12. Security / supply-chain checklist
- **Source:** npm `better-auth` (official); **License: MIT.**
- **Maintainer/cadence:** active, frequent releases (1.6.20 ~4 days old) — **pin exact**; review the
  changelog per bump.
- **Lockfile review:** inspect the `pnpm-lock.yaml` diff (direct + transitive) before commit.
- **Transitive deps:** verify edge/Workers-safe, ESM, no Node-only runtime deps **[verify]**.
- **No postinstall surprises:** check for postinstall scripts **[verify]**; pnpm can restrict.
- **No token/log output; no secret files.** Auth secrets stay in central-plane env later (not in
  this stage).

## 13. Decision update — **Option A: Package/version plan ready**
The package (`better-auth`), version line (**1.6.x**, pin exact, **re-verify at install**), adapter
path (**built-in Kysely + native D1, no extra package**), Hono (no separate package), change
boundary (central-plane `package.json` + lockfile only), risk check (no blocker; #4203/#10021 =
caution, re-verify vs 1.6.x), preflight, rollback, and supply-chain checklist are defined. **No
install, no package change.** (Not Option B/C — no uncertainty rising to a re-verification block or a
fallback to WorkOS.)

## 14. Recommended next stage
**Stage 202 — Package/Version PR Prep / Push / Review Gate** *(default, this doc is ready)* — bundle
Stage 201 into a docs PR against `main`. Alternatives: **Stage 202 — Better Auth Local Spike
Approval Gate Execution** *(only on "Better Auth local spike approved.")*, **D1 Migration Draft
Planning**, or **WorkOS Fallback Recheck** (not needed — no blocker). **Recommendation: PR prep
first.**

## 15. Now-safe vs gated
- **Now-safe:** package/version research · dependency boundary · install-approval checklist ·
  rollback plan · PR prep.
- **Requires Bae package/version approval:** `package.json` change · lockfile change · `pnpm add`/install.
- **Requires Bae local-spike approval:** local auth route · local login/logout proof · local session
  verification.
- **Requires Bae migration approval:** SQL migration draft · local D1 migration · production D1
  migration.
- **Requires Bae auth-implementation approval:** auth route handlers · session middleware ·
  login/logout logic.
- **Requires Bae deploy approval:** production auth route · production cookies · env vars · Vercel
  rewrite/subdomain.

## 16. Stage 201 decision — **Option A: package/version plan ready (`better-auth` 1.6.x, built-in D1/Kysely)**
`better-auth` (MIT) on the **1.6.x** line (latest 1.6.20 — **supersedes the earlier 1.5.x
assumption**), **pin exact + re-verify at install**, **built-in Kysely + native D1 (no extra
package)**, no separate Hono package, change limited to `apps/central-plane/package.json` + the root
lockfile, fully reversible, no standing blocker (#4203/#10021 re-verify vs 1.6.x). **Nothing
installed; no package file touched.** Install proceeds only on **"Better Auth package/version
approved."**

## 17. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no migration
· no MCP publish · no npm publish · no auth/OAuth · no Better Auth install · no package change · no
token/secret · no domain/DNS · no server write · no DB persistence · no Vercel rewrite · no CORS code
· no live-dashboard change · dogfood PRs #121~130 untouched.

## Sources (current)
- better-auth npm (name/version/license): https://www.npmjs.com/package/better-auth
- Better Auth changelog: https://better-auth.com/changelog
- Better Auth 1.5 release: https://better-auth.com/blog/1-5
- @better-auth/core (internal core): https://www.npmjs.com/package/@better-auth/core
- Better Auth DB/adapters: https://www.better-auth.com/docs/concepts/database
- Better Auth Hono integration: https://www.better-auth.com/docs/integrations/hono
- Cloudflare D1 community pkg: https://www.npmjs.com/package/better-auth-cloudflare · https://hono.dev/examples/better-auth-on-cloudflare
- Issue #4203 / #10021: https://github.com/better-auth/better-auth/issues/4203 · https://github.com/better-auth/better-auth/issues/10021
