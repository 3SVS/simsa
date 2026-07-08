> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 216 — D1 Runtime Binding Package/Version Check + Install

**Date:** 2026-06-25
**Branch:** `feat/stage-216-d1-runtime-binding-package-version` (from main `a2499ff`)
**Scope:** Package/version check + minimum install + compile-level prep. No runtime smoke, no migration apply, no deploy.

---

## 1. Approval phrase observed
> "D1 runtime binding package/version approved."

Recorded: D1 runtime binding package/version = **approved**. local runtime smoke = not approved. local migration apply = not approved. production migration = not approved. deploy = not approved.

## 2. Branch / HEAD
- `feat/stage-216-d1-runtime-binding-package-version` off main `a2499ff` (Release: Stage 214). Working tree clean at branch creation.

## 3. Package requirement findings (read-only + online recheck)
- Better Auth 1.6.20's `database` option **accepts a Kysely `Dialect`** (typed in `adapters/kysely-adapter`; docs example `database: new PostgresDialect({...})`). It does **not** natively detect D1.
- Better Auth bundles `kysely@0.29.2` + `@better-auth/kysely-adapter`, but **no D1/Cloudflare dialect**. A D1 Kysely dialect is the missing piece.
- **Online recheck (npm + Cloudflare community projects):** `kysely-d1` latest = **0.4.0** (published 2025-04-19), **MIT**, peerDependency `kysely: *` (no conflict with bundled 0.29.2). It is the canonical D1 dialect for Kysely (aidenwallis/kysely-d1), listed in Cloudflare's D1 community projects. Surface is tiny/stable (`D1Dialect implements Dialect`, constructor `{ database: D1Database }`). Low churn, low risk. Single clear candidate (no ambiguity).
- Documented better-auth+D1 pattern: pass `{ dialect: new D1Dialect({ database }), type: "sqlite" }` and **construct per request** (the `env.DB` binding only exists inside a request) — which matches our Stage 209 per-request `createBetterAuthSpike(c.env)`.

## 4. Package/version decision
- **Route α — install `kysely-d1@0.4.0`** (exact pin), central-plane only. Chosen because it is the single, canonical, peer-compatible (MIT) D1 dialect; bundled `kysely@0.29.2` satisfies its `*` peer exactly. (Route β = in-repo custom dialect was viable but adds owned code beyond a package gate; α is the smallest approved action.)

## 5. Install result
- `pnpm --filter @conclave-ai/central-plane add kysely-d1@0.4.0` → `+1` package, done.
- `apps/central-plane/package.json` dependency: `"kysely-d1": "0.4.0"` (exact pin).
- pnpm store: `kysely-d1@0.4.0_kysely@0.29.2` — bound to the already-present bundled `kysely@0.29.2` (no second kysely copy, peer satisfied).
- **No root `package.json` change.** No dashboard package change. No better-auth upgrade. No unrelated package churn.

## 6. Files changed (Stage 216)
- `apps/central-plane/package.json` (+1 dep, exact pin)
- `pnpm-lock.yaml` (kysely-d1 + its kysely peer link only)
- `apps/central-plane/src/better-auth-d1.ts` (NEW — compile-level helper)
- `apps/central-plane/test/better-auth-d1.test.mjs` (NEW — 3 tests)
- `conclave-builder-pack/out/stage-216-d1-runtime-binding-package-version.md` (this report)
- **Unchanged:** `router.ts`, `routes/auth-spike.ts`, `better-auth-spike.ts`, `wrangler.toml`, `env.ts`, `migrations/0047*`.

## 7. Compile-level helper result
- `src/better-auth-d1.ts` exports:
  - `d1DialectAvailable()` — import/availability proof (`typeof D1Dialect === "function"`).
  - `buildBetterAuthD1Database(db)` — returns `{ dialect: new D1Dialect({ database: db }), type: "sqlite" as const }`, the Better Auth kysely-adapter shape.
- **Deliberately NOT wired** into `router.ts` / `createBetterAuthSpike`. Nothing runs at import time; the dialect is constructed only when called; no DB access at construction; no secret/production env required. The `/api/auth/*` route stays stateless + disabled-by-default (Stage 209 contract unchanged). This is compile-level proof only — runtime wiring is a later gated stage.

## 8. Tests added/updated
- `better-auth-d1.test.mjs` (3): dialect package resolves under the build; helper returns `{ dialect, type:"sqlite" }` (Dialect contract surface present, lazy); helper needs no live DB and exposes only `dialect` + `type` (no secret field).
- Existing `better-auth-spike` (7) + `auth-spike-route` (6) + `auth-migration-draft` (5) unchanged and passing.

## 9. Verification results
- central-plane build: **pass**
- `better-auth-d1.test.mjs`: **3/3 pass**
- existing auth tests: **18/18 pass**
- monorepo typecheck: **57/57** (kysely-d1 resolves cleanly under NodeNext ESM)

## 10. Safety scan
- Changed files scanned for secrets / tokens / private keys / client_secret / access-refresh token literals / CORS (`Access-Control-Allow*`) / `vercel.json` / `rewrites` / `.env` → **no hits**. No local D1 state files. Package churn bounded to `kysely-d1` (+ its kysely peer link).

## 11. Production impact analysis
- **Zero.** A new dev/runtime dependency + an unused compile-level helper. The route is unchanged and dormant (AUTH_ENABLED off → 503 auth_disabled). No deploy. Production remains `9b645af`.

## 12. Rollback plan
- Single branch. Rollback = don't merge / revert the squash commit: `pnpm remove kysely-d1` (reverts package.json + lockfile) and delete `better-auth-d1.ts` + its test. No runtime/behavior change to undo (helper is unwired).

## 13. Known issues / follow-ups
- `kysely-d1@0.4.0` last published 2025-04-19 — low maintenance cadence, but peer `*` + tiny stable surface keep risk low. Re-evaluate (or switch to an in-repo dialect, Route β) only if a future kysely/Workers change breaks it.
- Runtime wiring (`createBetterAuthSpike` → `database: buildBetterAuthD1Database(env.DB)`), per-request construction, and local runtime smoke remain a **separate** gated stage.

## 14. Stage 216 decision
- **Option A — D1 runtime binding package PR ready for review.** Required package clearly identified + exact-pinned install succeeded (central-plane only), compile-level helper + tests prove integration, all green, no production impact.

## 15. Out-of-scope confirmation
No local runtime smoke, no local migration apply, no production migration, no deploy, no OAuth, no production env, no `.env`, no Vercel rewrite, no CORS, no DNS, no dashboard UI, no token/secret, no route activation. Stale dogfood PRs #121~130 untouched.

## 16. Recommended next stage
- **Stage 217 — D1 Runtime Binding Package PR Merge Gate** — only after "PR #<n> merge approved."
- Then **Stage 218 — Better Auth Local Runtime Smoke Gate** — only after "Better Auth local runtime smoke approved." (the smoke stage wires `buildBetterAuthD1Database` into the route + uses the locally-applied 0047 schema).
- Production migration ("Production auth migration approved.") and deploy ("Dashboard deploy approved.") remain separate gates.
