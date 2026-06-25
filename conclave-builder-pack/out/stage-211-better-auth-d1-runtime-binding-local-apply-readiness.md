# Stage 211 — Better Auth D1 Runtime Binding + Local Apply Readiness (Planning)

**Date:** 2026-06-25
**Branch:** `docs/stage-211-d1-runtime-binding-local-apply-readiness` (from main `73d3e2e`)
**Type:** Planning / readiness ONLY. No package install, no migration apply, no code change, no deploy.

---

## 1. Executive summary
- `main` already carries the `/api/auth/*` route (gated by `AUTH_ENABLED`, default off → 503 `auth_disabled`) and the `0047` migration **draft**.
- The route is **disabled by default**; the migration is a **draft only**; neither local nor production apply has happened.
- This stage determines the safest next executable slice for the D1 runtime binding and local apply, and the exact approval gates required — **without executing anything.**
- **Key finding:** Better Auth 1.6.20 bundles Kysely but ships **no D1/Cloudflare dialect**. A D1 runtime binding therefore needs a D1 Kysely dialect — either the `kysely-d1` package (install, gated) or a small in-repo custom dialect (no install). Local migration apply is **independent** of that decision (plain `wrangler d1 execute --local`).

## 2. Current main baseline
- main HEAD: `73d3e2e` — Release: Stage 209 — Better Auth Local Route and D1 Migration Draft.
- Production deploy HEAD: `9b645af` — Release: Stage 182~183 (unchanged; no deploy since).
- Files now on main (Stage 209): `migrations/0047_better_auth_identity_tables.sql`, `src/routes/auth-spike.ts`, `src/router.ts` (mounts `createAuthSpikeRoutes`), `test/auth-spike-route.test.mjs`, `test/auth-migration-draft.test.mjs`, plus `src/better-auth-spike.ts` / `src/auth-spike-config.ts` (Stage 204).
- Tests baseline: central-plane build pass; auth tests 18/18 (7 spike + 6 route + 5 migration); monorepo typecheck 57/57.
- `better-auth@1.6.20` exact pin in `apps/central-plane/package.json`. `AUTH_ENABLED?` optional (default off) in `env.ts`. `wrangler.toml` unmodified by Stage 209/210 (D1 binding `DB` / `database_name = "conclave-ai"` predates this work).

## 3. Better Auth D1 runtime binding findings
Read-only inspection of the installed package (pnpm store, no install/upgrade):
- **Can Better Auth accept D1 directly?** No. The `better-auth@1.6.20` dist contains **zero** `d1` / `D1Database` / `cloudflare:` references — no native D1 detection.
- **Is Kysely required?** Yes. Better Auth bundles `kysely@0.29.2` and `@better-auth/kysely-adapter@1.6.20`; its SQL data layer is Kysely-based.
- **Is `kysely-d1` required?** Effectively yes, OR an equivalent. Neither Better Auth nor `@better-auth/kysely-adapter` ships a Cloudflare D1 dialect (no `D1`/`cloudflare` references in the adapter). A D1 dialect is the missing piece between Kysely and the Workers `env.DB` binding.
- **`kysely-d1` currently installed?** **No** (absent from `node_modules`). Bundled Kysely provides the `Dialect` interface but no D1 implementation.
- **Exact config shape (expected, to be confirmed at execution):** construct a Kysely instance with a D1 dialect and pass it to Better Auth's `database` option — conceptually:
  ```
  database: new Kysely({ dialect: <D1 dialect over env.DB> })
  ```
  The precise `database` option contract (raw `Dialect` vs full `Kysely` instance vs `{ dialect }`) for 1.6.20 must be confirmed by deeper type inspection / online docs in the execution stage before writing code.
- **Schema match:** `0047` defines `user` / `session` / `account` / `verification` — the documented Better Auth core (email/password) tables. Column set matches the documented schema; final field/type parity must be re-validated against the 1.6.20 generator output at execution time.
- **Can the route stay safe until DB is ready?** Yes. With no `database` wired, `createBetterAuthSpike` stays stateless and the route keeps returning `auth_disabled` / `auth_not_configured`; no DB-backed flow is reachable. The binding can land later without changing the disabled-default contract.

### Two viable binding routes (decide at execution)
- **Route α — install `kysely-d1`** (community D1 dialect). Smallest code, but adds a dependency → requires **"D1 runtime binding package/version approved."** plus an **online version + maintenance + security recheck** (cannot be confirmed offline here).
- **Route β — in-repo custom D1 dialect** (implement the small Kysely `Dialect`/driver over `env.DB`). **No package install**, fully in `apps/central-plane`, but more code to own/test. Viable only if Better Auth's `database` option accepts a raw Kysely `Dialect`/instance (to be confirmed).

## 4. Package/version boundary
- **No package installed or modified in this stage.** `package.json` / `pnpm-lock.yaml` untouched.
- If Route α is chosen, a future approval is required; the new dep should live in **`apps/central-plane` only** (not root), and a lockfile change is expected **only then**.
- Version/security of `kysely-d1` (latest version, maintenance status, D1 compatibility with Workers runtime) must be **rechecked online** at execution — treat the offline absence as "not yet evaluated", not "safe".
- Route β adds **no** dependency and no lockfile change.

## 5. Local migration apply readiness
- **Current 0047 status:** draft on disk; **not applied** locally or in production (no `.wrangler/state` present).
- **Local-only apply command candidate:**
  ```
  wrangler d1 execute conclave-ai --local --file=./migrations/0047_better_auth_identity_tables.sql
  ```
  (run from `apps/central-plane`). The repo applies migrations via explicit `--file` execute, mirroring the existing `migrate:local` script (which targets `0001`). `0047` is additive + `IF NOT EXISTS`, so it is idempotent and safe to re-run.
- **Production isolation:** `--local` writes only to the local `.wrangler/state/v3/d1` SQLite file — no network, no credentials, no production DB touched. The only production path is `--remote` (`migrate:apply` / `migrate:prod`), which stays **blocked** behind "Production auth migration approved.".
- **Dry-run / local state notes:** there is no separate dry-run flag, but `--local` IS the isolation mechanism; the local D1 file can be deleted to reset. Local apply does not require any new env secret.
- **Why production apply remains blocked:** no production-migration approval has been given; `--remote` requires the production D1 id + account and is explicitly out of scope.

## 6. Local runtime smoke readiness
Future smoke plan (NOT run in this stage):
- `AUTH_ENABLED` unset/false → 503 `auth_disabled` (already covered by route tests).
- `AUTH_ENABLED=true`, no secret → 503 `auth_not_configured`.
- `AUTH_ENABLED=true` + local secret + local D1 binding (after 0047 local apply + dialect wired) → Better Auth handler reachable, returns a safe response.
- No token / secret / user / session / DB internals exposed in any response.
- `0047` local schema must exist **before** any DB-backed handler smoke.
- **Required local env categories (names only, no values):** `AUTH_ENABLED`, `BETTER_AUTH_SECRET` (local dev secret), local D1 binding via `wrangler dev --local`. No production env. No Vercel rewrite / CORS / DNS.
- Smoke must run under `wrangler dev --local` (or `node --test` against the mounted route), never against production.

## 7. Approval gate summary (exact phrases)
- **"D1 runtime binding package/version approved."** — allows Route α package install (kysely-d1 or chosen dialect dep) after online recheck.
- **"Local auth migration apply approved."** — allows running the `--local` execute of `0047`.
- **"Better Auth local runtime smoke approved."** — allows the local `wrangler dev --local` / test smoke reaching the handler.
- **"Production auth migration approved."** — (unchanged) production `--remote` migration.
- **"Dashboard deploy approved."** — (unchanged) production deploy.

Non-transfer rules:
- Package approval ≠ local apply. Local apply ≠ production migration. Runtime smoke ≠ deploy. Deploy ≠ production migration (unless separately stated). Production migration and deploy remain **separate** gates.

## 8. Recommended next execution options
- **Option A** — D1 package/version check + install only (Route α), if "D1 runtime binding package/version approved." is given. (Or evaluate Route β = no install.)
- **Option B** — Local migration apply only (`--local` execute of 0047), if "Local auth migration apply approved." is given. **No package needed** — apply is independent of the binding decision.
- **Option C** — Package install + local apply + runtime smoke bundle, only if all three local approvals are given.
- **Option D** — Continue planning if binding-route (α vs β) or `database` config shape remains uncertain.

## 9. Safety checklist for next executable stage
No production env · no production migration · no deploy · no OAuth · no CORS/Vercel rewrite/DNS · no secrets in logs/docs · no dashboard UI · no workspace role enforcement · no Plan Map approval audit. Local-only, additive, disabled-by-default preserved.

## 10. Stop conditions
Stop and report if: package requirement unclear · D1 dialect/route uncertain · local apply might touch production (`--remote` ever appears) · migration fails locally · runtime smoke would require production env or a new production secret · CORS/Vercel rewrite becomes required · any secret would need to be printed/committed · tests fail.

## 11. Rollback plan
- Route stays disabled by `AUTH_ENABLED` regardless — no live exposure to roll back.
- Revert any future binding code (custom dialect or wiring) by reverting its commit/PR.
- Revert package changes (Route α) by reverting the lockfile + `package.json` in that PR.
- Local D1 can be reset by deleting `.wrangler/state` **only if** a local apply was later run.
- Production is untouched throughout.

## 12. Decision
**Option A — D1 runtime binding / local apply readiness ready for review.**
The readiness is fully documented and gives a clear, grounded path: local apply is independent and safe (`--local` execute of additive 0047); the runtime binding needs a D1 Kysely dialect via Route α (package, gated + online recheck) or Route β (in-repo custom dialect, no install), with the `database` config contract to be confirmed at execution. No blocking uncertainty prevents the next approved slice — only the α-vs-β choice and an online package recheck remain, both correctly deferred to gated execution.

---
**Next stage:** Stage 212 — Better Auth D1 Runtime Binding Package/Apply Execution Gate — only with the relevant approval phrase(s); apply only the approved scope.
