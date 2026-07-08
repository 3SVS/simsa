> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 209 — Better Auth Local Route + Local Migration Draft Execution

**Date:** 2026-06-25
**Branch:** `feat/stage-209-better-auth-local-route-d1-draft` (from main `9bbdf99`)
**Scope:** LOCAL-ONLY. Route wiring + migration draft. No deploy, no migration run, no OAuth, no production env, no CORS/Vercel.

---

## 1. Approval scope observed
Two direct Bae approval phrases present at the top of the Stage 209 message:
- **"Local auth migration draft approved."** → migration draft approved: **yes**
- **"Better Auth implementation approved."** → route/config wiring approved: **yes**
- production migration approved: **no** · deploy approved: **no** · OAuth: **no** · Vercel rewrite/CORS/DNS: **no**

Both scopes present → Option A path (route + migration draft), both implemented.

## 2. Branch / HEAD
- Branch: `feat/stage-209-better-auth-local-route-d1-draft`
- Base: main `9bbdf99` (clean working tree at branch creation)

## 3. Files changed (Stage 209 only)
- `apps/central-plane/migrations/0047_better_auth_identity_tables.sql` (NEW — migration DRAFT)
- `apps/central-plane/src/routes/auth-spike.ts` (NEW — `/api/auth/*` route)
- `apps/central-plane/src/router.ts` (MODIFIED — import + mount, +1 import line, +4 lines mount/comment)
- `apps/central-plane/test/auth-spike-route.test.mjs` (NEW — 6 tests)
- `apps/central-plane/test/auth-migration-draft.test.mjs` (NEW — 5 tests)
- `conclave-builder-pack/out/stage-209-better-auth-local-route-d1-draft-execution.md` (this report)

(Pre-existing untracked files — `.githooks/`, `AGENTS.md`, stale stage docs, HANDOFF-*.md, `.lnk` — were left untouched and NOT staged.)

## 4. Routing baseline
- `src/router.ts` composes Hono sub-apps via `app.route("/", createXxxRoutes(...))`.
- Existing GitHub auth callback lives at `/auth/github/callback` (saas-auth.ts), NO `/api` prefix.
- New route uses the distinct `/api/auth/*` namespace → no collision (covered by a regression test).
- Mounted last among workspace routes, before `onError`.

## 5. Migration baseline
- Latest existing migration: `0046_workspace_agent_workflow_records.sql`.
- Next number = **0047** (rechecked immediately before writing; nothing newer present).
- DB binding confirmed: `env.DB` (D1), used by `/healthz` ping and all workspace routes.

## 6. Migration draft result
- `0047_better_auth_identity_tables.sql` created — DRAFT, **not applied** (local or production).
- Tables: `"user"`, `"session"`, `"account"`, `"verification"` (Better Auth 1.6.20 core email/password schema).
- D1/SQLite-compatible types (integer for booleans, date for timestamps). camelCase quoted identifiers to match Better Auth's own data layer (documented in the file header).
- Additive only: every statement is `CREATE TABLE/INDEX IF NOT EXISTS`. No DROP, no destructive ALTER, no DELETE/TRUNCATE/UPDATE, no backfill.
- Does not reference/alter `workspace_*`, `user_key`, `project_id`, or `projects` (asserted by test).
- Hand-written from the documented schema (generator NOT run blindly).

## 7. Route wiring result
- `createAuthSpikeRoutes()` mounts `app.all("/api/auth/*")`, gated by `getAuthSpikeConfig`:
  - `AUTH_ENABLED` unset / != "true" → **503 `{ "error": "auth_disabled" }`** (production default).
  - `AUTH_ENABLED === "true"` but runtime not ready (no local secret) → **503 `{ "error": "auth_not_configured" }`**.
  - `AUTH_ENABLED === "true"` AND local secret present → delegates to `createBetterAuthSpike(env)!.handler(c.req.raw)`.
- Never echoes/logs secret/token/user/session/DB. No OAuth provider, no CORS, no dashboard UI, no Vercel rewrite.

## 8. Better Auth D1 binding result
- **Deferred (Step 6 safe path).** The spike instance stays stateless (no `database` option). Reason: the precise D1/Kysely 1.6.20 wiring would require a `kysely-d1` dialect dependency that is not installed and not in this stage's approved scope (no package install approved here).
- The 0047 draft prepares the identity tables so a separately-approved D1-wiring stage can connect `env.DB` without re-deriving schema.
- Until then the enabled path delegates to a stateless handler; DB-backed flows are simply not provisioned. Route remains production-safe (disabled by default).
- No `wrangler.toml` change. No new binding. `env.DB` reused conceptually only; no runtime DB handle exposed.

## 9. Tests added/updated
- `auth-spike-route.test.mjs` (6): default 503 auth_disabled (multiple env shapes); any method/subpath disabled; auth_not_configured when flag on + no secret; secret never echoed in disabled/not-configured bodies; flag+secret gate passes without leaking secret; `/auth/github/callback` not swallowed by the spike gate.
- `auth-migration-draft.test.mjs` (5): draft exists; four expected tables; additive-only (all CREATE … IF NOT EXISTS); no DROP/destructive SQL; does not touch workspace/project/user_key.
- Existing `better-auth-spike.test.mjs` (7) unchanged and still passing.

## 10. Verification results
- `pnpm --filter @conclave-ai/central-plane build` — **pass**
- `node --test test/auth-spike-route.test.mjs` — **6/6 pass**
- `node --test test/auth-migration-draft.test.mjs` — **5/5 pass**
- `node --test test/better-auth-spike.test.mjs` — **7/7 pass**
- `pnpm typecheck` — **57/57** (FULL TURBO)

## 11. Safety scan
- Scanned all changed files for: `sk-`, `AKIA`, `ghp_`/`gho_`, `postgresql://`, `mongodb+srv://`, private keys, `client_secret`, access/refresh token literals, `Access-Control-Allow*`, `vercel.json`, `rewrites`.
- Result: **NO hits.** No `.env` files staged. No tokens/secrets in any file (the migration `account` table has nullable `accessToken`/`refreshToken` *columns* only — schema, no values).

## 12. Disabled / default-off behavior
- `AUTH_ENABLED` remains default OFF in `env.ts` (optional, no `="true"` default). With the route mounted, production behavior is unchanged: every `/api/auth/*` request returns 503 `auth_disabled` until the flag is explicitly set with a local secret.

## 13. Production impact analysis
- **Zero.** No deploy. The route is dormant under production env (flag off). Migration is a draft on disk, never applied. No write path to production D1. Production remains `9b645af`.

## 14. Rollback plan
- Pure additive, single branch. Rollback = do not merge the PR, or revert the squash commit. The migration is never applied, so there is nothing to undo in D1. Removing the route mount line + files fully reverts behavior to main.

## 15. Known issues / follow-ups
- **D1 runtime binding deferred** — a future stage must wire `env.DB` into Better Auth (likely a `kysely-d1` dialect; needs a package-install approval) and then apply 0047 locally first.
- Local migration apply, cookie/CORS strategy, OAuth providers, and dashboard auth UI all remain separate gated stages.
- Better Auth `baseURL`/trustedOrigins config is not set yet (not needed while disabled/stateless).

## 16. Stage 209 decision
- **Option A — Local route + migration draft PR ready for review.** Both approved scopes implemented safely; D1 runtime binding deferred per Step 6 (documented), which does not block either deliverable.

## 17. Out-of-scope confirmation
No production migration, no local migration apply, no deploy, no OAuth, no production env vars, no `.env`, no Vercel rewrite, no CORS code, no DNS/domain, no dashboard UI, no workspace role enforcement, no team invite/share, no Plan Map audit, no IntegrationAccount migration, no token/secret storage or printing. Stale dogfood PRs #121~130 untouched.

## 18. Recommended next stage
**Stage 210 — Better Auth Local Route / Migration Draft PR Merge Gate**, only after an explicit "PR #<n> merge approved." Production migration ("Production auth migration approved.") and deploy ("Dashboard deploy approved.") remain separate future gates. D1 runtime binding likely needs its own package-install + implementation approval before 0047 is applied anywhere.
