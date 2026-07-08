> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 204 — Better Auth Local Spike Execution

**Date:** 2026-06-25
**Branch:** `feat/stage-204-better-auth-local-spike` · **Base / main:** `94943e8` · production deploy: `9b645af` (Plan Map, untouched) · live: https://app.trysimsa.com
**Type:** local-only spike execution. **No production deploy, no production migration, no production env-var change, no real OAuth secrets, no production Vercel rewrite, no DNS/domain, no production auth UI, no workspace role enforcement, no team invites/share, no Plan-Map gate approval, no IntegrationAccount migration, no token/secret stored or printed. Stale dogfood PRs #121~130 untouched.**

## 1. Approval phrases observed
> **"Better Auth local spike approved."** ✓ · **"Better Auth package/version approved."** ✓
Both present → Stage 204 authorized.

## 2. Branch / HEAD
`feat/stage-204-better-auth-local-spike` off `main` `94943e8`. (Local commit; see §12 — not pushed.)

## 3. Package/version recheck result
- **`pnpm view better-auth version` = `1.6.20`** (confirmed latest at install time; matches Stage 201).
- **License MIT · `type: module` (ESM).**
- **peerDependencies are all optional** framework/DB peers (react, next, drizzle, prisma, pg,
  mysql2, mongodb, better-sqlite3, svelte, vue, vitest, …) — **none required** for a Workers
  backend (pnpm prints unmet-optional-peer warnings only).
- **Direct deps** are the expected auth/crypto/db set: `@better-auth/core`, `@better-auth/utils`,
  `@better-fetch/fetch`, `@noble/ciphers`, `@noble/hashes`, `better-call`, `defu`, `jose`,
  **`kysely`**, `nanostores`, `zod@4`, and the `@better-auth/{kysely,drizzle,memory,mongo,prisma}-
  adapter` set. → **the Kysely adapter is bundled; no separate adapter package needed** (matches the
  Stage 201 "built-in Kysely + native D1" plan).
- **#4203 / #10021** (cookieCache + secondary-storage logout): avoided by design — the spike uses
  **no `cookieCache`, no KV secondary storage** (DB-backed only, and not even instantiated). Their
  exact status vs 1.6.20 remains **[verify]** before any real session use.

## 4. Package install result
**`pnpm --filter @conclave-ai/central-plane add better-auth@1.6.20`** — exit 0, **+21 packages
added** (better-auth + transitive auth/crypto/db deps; no unrelated package upgrades). **Exact pin,
no caret/tilde.** No adapter package installed.

## 5. Files changed
- `apps/central-plane/package.json` — `+ "better-auth": "1.6.20"` (exact pin, only line added).
- `pnpm-lock.yaml` — better-auth + transitive deps (root lockfile, expected).
- `apps/central-plane/src/env.ts` — added 3 optional flag fields (`AUTH_ENABLED`, `AUTH_PROVIDER`,
  `BETTER_AUTH_SECRET`), all default OFF/unset.
- `apps/central-plane/src/auth-spike-config.ts` *(new)* — pure flag helper.
- `apps/central-plane/src/better-auth-spike.ts` *(new)* — gated Better Auth skeleton + import proof.
- `apps/central-plane/test/better-auth-spike.test.mjs` *(new)* — tests.
**No other `package.json`, no migration, no `.sql`, no `.env`, no CORS code, no Vercel/DNS config,
no route registration in `index.ts`/`router.ts`.** (`dist/` is gitignored — not committed.)

## 6. Feature flag behavior
`getAuthSpikeConfig(env)` is a **pure** read (mirrors the existing `getCreditExecutionConfig`
pattern): `enabled` is true **only** when `AUTH_ENABLED === "true"` (default false → production-safe);
`runtimeReady` additionally requires a present `BETTER_AUTH_SECRET` (local dev only). It returns
**booleans only** and **never reads back or returns the secret value** (no secret field in the
result). Never throws on missing/odd env.

## 7. Better Auth skeleton summary
`better-auth-spike.ts`: imports `betterAuth` from `better-auth` (compile-time **import proof**).
`betterAuthAvailable()` returns whether the factory resolved. `createBetterAuthSpike(env)`
constructs an instance **only** when `runtimeReady` (flag on + local secret) — otherwise returns
**null** (the default / production / test path), so **no secret and no D1 are needed to compile or
test**. Config is **stateless** (no `database`), **no OAuth provider, no email provider, no D1
schema, no route activation**. (Initial over-broad return-type annotation was removed so the
narrowed `betterAuth(...)` generic infers cleanly — the factory call itself type-checks.)

## 8. Local route summary (skipped — rationale)
**No route was added.** Registering a `/api/auth/*` route in `index.ts`/`router.ts` would be more
invasive than a compile-level proof requires, and the cookie/CORS wiring (Stage 198) belongs to a
later, separately-gated stage. The skeleton already proves package install + import + gating at
compile + test level; a live route is deferred. (Documented per the Stage 204 "skip route and
document why" rule.)

## 9. Tests added/updated
`test/better-auth-spike.test.mjs` (built-from-`dist` convention, `node --test`): flag default OFF +
never-throws · enabled only on exact `"true"` · `runtimeReady` requires flag **and** secret ·
provider default/trim · **config never exposes the secret value or a secret field** · **better-auth
resolves + imports under the central-plane build** · `createBetterAuthSpike` stays **null** in the
production/test path. **7/7 pass.**

## 10. Verification results
- `pnpm --filter @conclave-ai/central-plane build` (tsc → dist) — **ok** (better-auth compiles).
- `pnpm --filter @conclave-ai/central-plane typecheck` — **ok** (exit 0).
- `pnpm --filter @conclave-ai/central-plane` better-auth-spike test — **7/7 pass**.
- `pnpm typecheck` (monorepo) — **57/57 successful** (central-plane rebuilt with better-auth; no
  breakage across the workspace).
- Changed tracked files: only `apps/central-plane/package.json`, `apps/central-plane/src/env.ts`,
  `pnpm-lock.yaml` (+ 2 new src files, 1 new test, this doc). Secret-literal scan = 0.

## 11. Safety scan
Diff confirmed to contain **no** production env values · `.env` files · OAuth secrets · migrations ·
`.sql` · dashboard sign-in UI · workspace role enforcement · Plan-Map approval audit · Vercel
rewrites · CORS code changes · DNS/domain config · payment/billing · MCP/npm publish · production
deploy config · token/secret output. Secret-literal scan of the new files = **0**. Only the 6 files
in §5 changed.

## 12. What remains disabled
- `AUTH_ENABLED` defaults **OFF**; production never sets it → the spike never activates.
- No auth route is mounted; `/account` stays the local stub; Plan Map stays read-only.
- `createBetterAuthSpike` returns **null** unless a local flag + secret are both present.

## 13. What remains gated (separate, non-transferable)
Local D1 migration draft (**"Local auth migration draft approved."**) · production migration
(**"Production auth migration approved."**) · auth implementation beyond the spike (**"Better Auth
implementation approved."**) · production deploy (**"Dashboard deploy approved."**) · Vercel
rewrite / auth subdomain / DNS · real OAuth providers · cookie/CORS production wiring. **PR merge
approval does not imply any of these.**

## 14. Rollback plan
Fully reversible: `git checkout main -- apps/central-plane/package.json pnpm-lock.yaml` (or revert
the commit) + `pnpm install` to drop `better-auth`; delete the 2 new src files + the test; revert
the `env.ts` additions. **No database, no live, no env, no dashboard change to undo.**

## 15. Known issues / follow-ups
- `[verify]` before any real session use: exact built-in-D1 binding wiring; `SameSite`/cookie
  defaults (Stage 198); #4203/#10021 status vs 1.6.20.
- `zod@4` arrives via better-auth — confirm no conflict with the repo's existing zod usage (pnpm
  isolates versions; no error observed) **[watch]**.
- A live `/api/auth/*` route + D1 schema + cookie/CORS are the next (separately-gated) steps.

## 16. Stage 204 decision — **Option A: local spike skeleton ready for review**
`better-auth@1.6.20` installed within the exact boundary (central-plane `package.json` + root
lockfile only), the minimal flag-gated skeleton **compiles and imports cleanly**, **no production
behavior changed**, **tests pass (7/7)**, and **rollback is a clean git revert + `pnpm install`**.

## 17. Out-of-scope confirmation
No production deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no
production migration · no MCP publish · no npm publish · no OAuth provider setup · no token/secret
output · no domain/DNS · no server write to production · no persistence to production · no Vercel
rewrite · no CORS code · no live-dashboard change.

## 18. Recommended next stage
**Stage 205 — Better Auth Local Spike PR Prep / Review Gate** (bundle: diff review · docs · open PR ·
**stop before merge**). PR merge, local/production migration, production deploy, Vercel rewrite,
production env, and real auth rollout each remain **separate future gates**.
