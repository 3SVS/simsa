> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 207 — Better Auth Local Route + D1 Migration Draft Planning

**Date:** 2026-06-25
**Branch:** `docs/stage-207-auth-route-d1-migration-planning` · **Base / main:** `c20a99f` · production deploy: `9b645af` (Plan Map, untouched) · live: https://app.trysimsa.com
**Type:** planning / docs only. **No route implementation, no migration file, no local/production D1 migration run, no auth handler wiring, no login/logout UI, no session middleware beyond the Stage 204 skeleton, no OAuth, no Vercel rewrite, no CORS code, no production env, no `.env`, no DNS/domain, no deploy, no live-dashboard change, no role enforcement, no team invite/share, no Plan-Map audit, no IntegrationAccount migration, no MCP/npm publish, no payment/billing, no token/secret request-print-store. Stale dogfood PRs #121~130 not touched.**

## 1. Executive summary
The Better Auth **package + flag-gated skeleton is on main** (Stage 204/206). This stage **only
plans** the next implementation slice. **No route implementation is approved · no migration draft is
approved · no local D1 migration is approved · no production rollout is approved.** The next
*executable* stage (208) requires explicit Bae approval phrases (§4).

## 2. Current implementation baseline (verified)
- `main` = **`c20a99f`**; **`better-auth@1.6.20`** installed in `apps/central-plane`.
- `AUTH_ENABLED` defaults **OFF**; `createBetterAuthSpike` returns **null** unless flag + a local
  secret are both present.
- **No route registered** (`router.ts`/`index.ts` unchanged); **no D1 auth tables**; **no migration
  files** (latest = `0046_workspace_agent_workflow_records.sql`).
- `/account` = local stub · Plan Map = read-only · **production remains `9b645af`**.
- **D1 binding** already exists: `wrangler.toml` `[[d1_databases]]` `binding = "DB"`
  (`database_name = "conclave-ai"`) → exposed as `env.DB: D1Database`.
- **Router pattern:** `router.ts` composes Hono modules via `app.route("/", createXxxRoutes(...))`
  (e.g. `createOAuthRoutes(fetchImpl)`, `createTelegramRoutes(...)`, `createSaasAuthRoutes()`).

## 3. Proposed next local-only slice (only if approved)
- Local-only **`/api/auth/*` route registration** in central-plane, **gated by `AUTH_ENABLED`**.
- Better Auth handler wiring behind the flag (mount `auth.handler(c.req.raw)`).
- **Local D1 migration draft** for the Better Auth identity tables (`user`/`session`/`account`/
  `verification`).
- **Local-only D1 binding verification** (reuse `env.DB`).
- **No** production env · **no** production deploy · **no** dashboard auth UI · **no** OAuth · **no**
  workspace-aware access · **no** Plan-Map approval audit.

## 4. Approval phrases required before execution (exact, separate, non-transferable)
| To… | Required phrase |
|---|---|
| Create the local migration draft (SQL file) | **"Local auth migration draft approved."** |
| Implement the local auth route / handler wiring | **"Better Auth implementation approved."** |
| Run a production migration | **"Production auth migration approved."** |
| Deploy | **"Dashboard deploy approved."** |
| Add a Vercel rewrite / auth subdomain / DNS | a separate explicit approval |
- **PR merge approval does NOT imply any of the above.**
- **Local migration approval does NOT imply production migration approval.**
- **Implementation approval does NOT imply deploy approval.**

## 5. Local route plan (plan only — not implemented)
- **Shape:** `/api/auth/*` (the Better Auth convention; Stage 198).
- **Owner file:** a new `apps/central-plane/src/routes/auth-spike.ts` exporting
  `createAuthSpikeRoutes()`, mounted in `router.ts` via `app.route("/", createAuthSpikeRoutes())`
  (matches the existing `createXxxRoutes` composition).
- **Disabled by default:** the handler reads `getAuthSpikeConfig(c.env)`; when `enabled` is false it
  **does not mount/serve** Better Auth — it returns a **503** `auth_disabled` (chosen over 404 so a
  disabled-but-present route is observable in local dev; **open question** below).
- **No production activation:** `AUTH_ENABLED` unset in production → 503; `createBetterAuthSpike`
  stays null without a secret.
- **Disabled-mode response:** small JSON `{ ok: false, error: "auth_disabled" }`, no tokens, no
  secret echo.
- **Later mount:** when enabled + secret, the route delegates to `auth.handler(c.req.raw)`.
- **No-token-output enforcement:** a test asserts the disabled response (and any error path) never
  contains secret/token substrings.
- **Open questions:** exact routing file name · prefix (`/api/auth` vs `/auth`) — note `/auth/github/
  callback` already exists (GitHub App), so **`/api/auth/*` avoids collision** · disabled →
  **503 vs 404** (lean 503) · one flag `AUTH_ENABLED` vs a distinct `AUTH_SPIKE_ENABLED` (lean reuse
  `AUTH_ENABLED`).

## 6. D1 migration draft plan (plan only — no file created)
- **Number:** next is **`0047`** (verified latest = `0046`); **re-verify against `main`
  immediately before writing**.
- **Better Auth-owned tables:** `user`, `session`, `account`, `verification` (Stage 189/192 shapes).
- **Generation:** prefer the **Better Auth schema generator / `@better-auth/cli`** to emit the SQL,
  then **human-review** the output before committing as `0047_auth_identity.sql` — do **not** hand-
  author blind **[verify generator output on D1/SQLite]**.
- **Naming/indexes (Kysely/SQLite):** `user(id PK, email unique, emailVerified, name, image,
  createdAt, updatedAt)`; `session(id PK, userId FK, token unique, expiresAt, …, index(userId))`;
  `account(id PK, userId FK, providerId, accountId, …, unique(providerId,accountId), index(userId))`;
  `verification(id PK, identifier, value, expiresAt, …, index(identifier))` — exact DDL from the
  generator **[verify]**.
- **Rules:** **additive only · no destructive changes · no project/workspace access behavior change ·
  `userKey` columns preserved.**
- **Gating:** the local migration draft is allowed **only after "Local auth migration draft
  approved."**; **production migration is forbidden** until **"Production auth migration approved."**

## 7. Better Auth D1 binding plan
- **Binding exists:** `wrangler.toml` `[[d1_databases]] binding = "DB"` → `env.DB`. **Reuse it** (no
  new binding, no wrangler change in the next step).
- **Wiring:** Better Auth would receive the D1 handle via its **built-in Kysely/D1 path** — pass
  `env.DB` (or a thin Kysely-over-D1 dialect) into the `database` option **[verify exact 1.6.20 D1
  config shape before compile]**.
- **Pre-compile verification:** confirm the 1.6.20 `database` option accepts the D1 binding (or the
  documented dialect wrapper) so the route file type-checks.
- **Local dev:** `wrangler dev` + `wrangler d1 migrations apply conclave-ai --local` (only after
  migration-draft approval) for a local proof. **No production binding change.**

## 8. Environment variable plan (categories only — no values, no `.env`)
- **`AUTH_ENABLED`** (already added; default off).
- **`BETTER_AUTH_SECRET`** category (already added; local dev only, never committed).
- **`BETTER_AUTH_URL` / base URL** category (if the handler needs a base URL).
- **`AUTH_TRUSTED_ORIGINS`** category (dashboard origin allowlist; Stage 198).
- **Cookie/domain** settings — **later** (Stage 198, production-gated).
- **Local-only test flags** if needed.
**No `.env` creation this stage · no production env change · no secrets in chat/logs/docs.**

## 9. Cookie / CORS relationship (Stage 198)
- Production-preferred topology = **same-origin Vercel rewrite** (Option A) — **later, gated**.
- **Local route planning must NOT add Vercel rewrites yet** · **no CORS code** unless a later
  separate approval requires it for the local route.
- The local-only route may stay **central-plane local** for the initial proof (localhost same-site;
  Stage 198 §8).
- **Production cookie strategy remains gated.**

## 10. Test plan (for the future executable stage)
- Existing **spike tests keep passing** (7/7).
- `AUTH_ENABLED=false` → **route disabled behavior** (503/`auth_disabled`, no token).
- Config **refuses to instantiate without a secret** (`createBetterAuthSpike` null).
- **Better Auth import still compiles** (`betterAuthAvailable()` true).
- **Local route never exposes tokens/secrets** (response-scan test).
- **Local D1 migration smoke** (wrangler local) **only if migration approved**.
- `central-plane build` + `central-plane typecheck` + `monorepo typecheck`.
- **No dashboard regression** if the dashboard is untouched.

## 11. Safety-scan requirements (future executable stage must scan)
Changed files for secrets/tokens · route registration for production enablement (must stay flag-off)
· migrations for destructive SQL · the package graph for unrelated churn · env docs for values ·
dashboard for unintended auth UI · Vercel/CORS/DNS config for accidental live changes.

## 12. Rollback plan (for the future executable slice)
Disable `AUTH_ENABLED` · revert the route file(s) · revert the migration draft if local-only · **keep
production untouched** · revert the package **only if the package itself becomes a blocker** · **no
data deletion · no production DB mutation.**

## 13. Stop conditions (future stage must STOP if)
Real secrets are needed · production env is needed · production migration is needed · the route
**cannot stay disabled by default** · the **D1 adapter wiring is unclear** · the Better Auth
generator produces **unexpected destructive SQL** · dependency churn appears · tests fail · any
dashboard **live behavior** would change · CORS / Vercel rewrite becomes required.

## 14. Recommended next execution bundle
**Stage 208 — Better Auth Local Route + Local Migration Draft Execution Bundle** — **only** if Bae
explicitly provides at least one of **"Local auth migration draft approved."** / **"Better Auth
implementation approved."**
- **Both** → Stage 208 may bundle the **local migration draft + route/handler wiring**.
- **Only migration approval** → create the **local migration draft only** (no route).
- **Only implementation approval** → **route/config only** (no migration file).
- **Neither** → continue **planning only**.

## 15. Now-safe vs gated
- **Now-safe:** this planning doc · route plan · migration draft plan · D1 binding plan · test plan ·
  rollback plan · PR prep.
- **Requires local migration approval:** SQL migration file creation · local D1 migration smoke.
- **Requires auth implementation approval:** route registration · Better Auth handler wiring · local
  login/logout proof.
- **Requires production migration approval:** any production D1 migration.
- **Requires deploy approval:** production route · production cookies · production env vars · Vercel
  rewrite/subdomain · live-dashboard changes.
- **Requires security review:** cookies · CORS · CSRF · trusted origins · token handling · session
  behavior.

## 16. Stage 207 decision — **Option A: local route + D1 migration planning ready for review**
Grounded in the verified baseline (D1 `DB` binding reusable; `router.ts` composition pattern; next
migration `0047`; `/api/auth/*` avoids the existing `/auth/github/callback`). The route plan, D1
migration draft plan, binding plan, env/cookie/CORS relationship, test/safety/rollback plans, stop
conditions, and approval gates are defined. **No route, no migration, no implementation.** Execution
(Stage 208) requires the explicit phrases in §4/§14.
