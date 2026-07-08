> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 198 — Session Cookie / CORS Strategy Deep Dive

**Date:** 2026-06-25
**Branch:** `docs/stage-197-better-auth-local-spike-gate` (auth train, continues 197) · **Base / main:** `6ac260b` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** research / architecture strategy / docs only. **No auth implementation, no Better Auth install, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no local D1 migration run, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

> Verified against **current Better Auth + Hono docs + MDN cookie/CORS semantics** (URLs in
> §Sources). Items not confirmable from a primary source are marked **[verify]**. No
> tokens/secrets/private URLs. **No cookies set, no CORS code changed.**

## 1. Executive summary
**No implementation in this stage.** Recommended direction: run auth on **central-plane / Workers
/ D1** (Stage 193) but expose it at a **first-party path** so the **session cookie is first-party
and CORS is avoided** — **Option A: same-origin via a Vercel rewrite** (`app.trysimsa.com/api/auth/*`
→ central-plane). **Fallback: Option B — an auth subdomain** (`api.trysimsa.com`, *same-site*) with
`crossSubDomainCookies` + `SameSite=Lax` + a strict CORS allowlist. **Reject Option C** (cross-site
`*.workers.dev` → `SameSite=None` → third-party-cookie blocking) and **Option D** (auth on the
Vercel dashboard runtime → contradicts Stage 193 + breaks D1 locality). **Safest local spike:**
localhost cross-origin (same-site) with `SameSite=Lax` + credentials + a localhost CORS allowlist,
email/password (no OAuth secrets), flag off in production. **Production rollout stays gated**
(rewrite/subdomain + cookies + env each need separate Bae approval + security review).

## 2. Current architecture baseline
Dashboard on **Vercel** (`app.trysimsa.com`). Auth target = **central-plane / Hono / Workers / D1**
(Stage 193). **No auth deployed.** `/account` = local stub. **Plan Map live, read-only.** `userKey`
= legacy fallback.

## 3. Candidate session topology options
> Key fact: a browser **"site"** = the **registrable domain (eTLD+1) = `trysimsa.com`**, **port- and
> subdomain-agnostic** for `SameSite`. So `app.trysimsa.com` ↔ `api.trysimsa.com` are **same-site,
> cross-origin**; `*.workers.dev` is a **different site** (cross-site).

| Option | Shape | Cookie | CORS | Security | Deploy complexity | Local-dev | D1 locality | Fit w/ Stage 193 |
|---|---|---|---|---|---|---|---|---|
| **A — Same-origin proxy** | dashboard `app.trysimsa.com/api/auth/*` **Vercel rewrite →** central-plane Workers | **first-party**, `SameSite=Lax`/`Strict`, no third-party blocking | **none** (same origin) | **Best** (no cross-origin cookie) | Vercel rewrite (gated) | simple | **auth stays on Workers/D1** | **Best** |
| **B — Auth subdomain** | `api.trysimsa.com` (same parent) | `Domain=.trysimsa.com`, `SameSite=Lax` (same-site → sent on fetch); `crossSubDomainCookies` | **required** (cross-origin, credentials + specific origin) | Good (no third-party blocking; same-site) | DNS subdomain (gated) | moderate | on Workers/D1 | Good |
| **C — Cross-origin Workers domain** | dashboard → `*.workers.dev` directly | **cross-site** → `SameSite=None`+`Secure` → **third-party-cookie blocking** (Safari ITP; Chrome) | required | **Weak/fragile** | low | low | on Workers/D1 | poor (fragile cookies) |
| **D — Dashboard-hosted auth** | auth runs in Vercel dashboard runtime | first-party (trivial) | none | ok cookies, but… | low | simple | **auth away from D1** | **contradicts Stage 193** |

## 4. Recommended topology
- **Primary: Option A — same-origin via a Vercel rewrite.** Auth runs on **Workers/D1** (Stage 193
  honored) but is reached at `app.trysimsa.com/api/auth/*`, so the cookie is **first-party** (no
  cross-origin cookie, **no CORS**, **no third-party-cookie blocking**). Cleanest, most robust.
  *(Verify Vercel rewrite forwards method/body/cookies correctly to the Workers origin — [verify].)*
- **Fallback: Option B — auth subdomain (`api.trysimsa.com`).** Same-site → `SameSite=Lax` cookies
  are sent on fetch; set `Domain=.trysimsa.com` via `crossSubDomainCookies`; add a **strict CORS
  allowlist** (credentials + the exact dashboard origin). Use if the rewrite proves limiting.
- **Reject C and D** (fragile cross-site cookies / contradicts the Workers-D1 runtime decision).
- Principles honored: central-plane/Workers/D1 runtime · **avoid browser-local truth** · **never
  expose token values** · production rollout gated · **avoid cross-site cookies**.

## 5. Cookie strategy (planning only — NO cookies set)
- **Names (Better Auth defaults):** `${cookiePrefix}.session_token`, `.session_data` (only if
  cookieCache — **avoid**, §13/#4203), `.dont_remember` (prefix default `better-auth`).
- **HttpOnly: yes** (Better Auth default). **Secure: yes** in production (Better Auth default;
  `useSecureCookies` to force in all envs).
- **SameSite:** **`Lax`** recommended (works for Option A first-party and Option B same-site fetch;
  also gives baseline CSRF protection). **Avoid `None`** (only needed for cross-site Option C, and
  triggers third-party blocking). **Better Auth's SameSite default is [verify]** — set explicitly.
- **Domain:** Option A → **host-only** (no Domain attr, first-party). Option B → **`.trysimsa.com`**
  via `crossSubDomainCookies: { enabled: true, domain: "trysimsa.com" }` — **"most specific scope
  needed"** (Better Auth guidance); never broader than required.
- **Path:** `/` (or scope to `/api/auth` if feasible). **Max-Age/Expires:** session `expiresIn`
  (Better Auth default 7d) + `updateAge` (1d) — value category only.
- **Local dev:** `SameSite=Lax`; `Secure` relies on the **localhost secure-context exemption**
  **[verify per browser]** (or omit Secure for `http://localhost`).
- **`crossSubDomainCookies`:** **only for Option B** (not needed for Option A).
- **Third-party-cookie-blocking risk:** applies to **cross-site** cookies (Option C). Options A/B
  are **first-party/same-site → not blocked**.

## 6. CORS strategy (planning only — NO CORS code change)
- **Option A:** **no CORS** (same origin).
- **Option B / local spike:** Hono `cors()` middleware with:
  - **`origin`:** an **explicit allowlist** (exact dashboard origin(s)) — **string/array/callback**,
    **never `*`**.
  - **`credentials: true`** (required for cookies). **Wildcard origin + credentials is forbidden by
    the CORS spec** — echo the specific origin + `Access-Control-Allow-Credentials: true`.
  - **`allowMethods`:** `GET, POST` (+ `OPTIONS` auto) — minimal.
  - **`allowHeaders`:** `Content-Type` (+ any Better Auth needs) — minimal.
  - **Preflight:** Hono auto-handles `OPTIONS`; place `cors()` **before** routes.
  - **`Vary: Origin`** so caches don't serve the wrong ACAO.
  - **Local dev origin list** (e.g. localhost dashboard) vs **production origin list** kept
    **separate** and explicit.

## 7. CSRF strategy
- **`SameSite=Lax` gives baseline CSRF protection** (cross-site requests don't carry the cookie),
  but is **not sufficient alone** for all cases.
- **State-changing routes** (sign-in/out, account mutations, later workspace writes) need
  protection: **Better Auth's built-in CSRF/Origin checks + `trustedOrigins`** — **[verify Better
  Auth's CSRF mechanism]**.
- **Origin/Referer checks** on POST; consider **double-submit token** only if a gap remains.
- **GET must be side-effect-free**; mutations are **POST**.
- **OAuth callback `state`** parameter must be validated (later, when OAuth is added) — out of scope
  for the email/password first slice.

## 8. Local-only spike strategy (future, gated)
- **Origins:** dashboard `http://localhost:<dash>` ↔ central-plane `http://localhost:<wrangler>`
  (e.g. `wrangler dev`) — **same-site (`localhost`), cross-origin**.
- **Cookie:** `SameSite=Lax` (sent on same-site fetch); `Secure` via localhost exemption **[verify]**.
- **Credentials:** dashboard fetch with **`credentials: "include"`**; Hono CORS with the **localhost
  allowlist + `credentials: true`**.
- **Flag OFF in production**; **no production env**; **no real OAuth secrets**; **email/password (or
  a dev-only provider) [verify]**.
- **Reversible:** flag off + delete local D1 + drop the local route; no production change.

## 9. Production rollout strategy (future, gated)
- **Preferred: Option A** — add a **Vercel rewrite** `app.trysimsa.com/api/auth/*` → the central-
  plane Workers endpoint (first-party cookies, no CORS). **Reverse proxy = the Vercel rewrite.**
- **Else: Option B** — provision **`api.trysimsa.com`** (DNS, gated) + `crossSubDomainCookies` +
  CORS allowlist.
- **Approvals needed (separate):** the rewrite **or** subdomain/DNS · production cookies · production
  env vars · any live-dashboard change — each is its **own** Bae approval + security review.
- **Env-var categories** (no values): auth secret · base URL/trusted origins · cookie domain.
- **Monitoring/logging:** session error rates, 401/403, CORS-rejection counts — **no token values in
  logs**.
- **Rollback:** flag off → dashboard falls back to `userKey`; remove the rewrite/subdomain route.

## 10. Better Auth-specific implications (verified)
- **Cookies are `httpOnly` + `secure` in production by default**; `useSecureCookies` forces in all
  envs. Default cookies: `session_token`, `session_data`(cookieCache), `dont_remember`; prefix
  `better-auth` (`cookiePrefix`/`cookies` to customize).
- **`crossSubDomainCookies` = `{ enabled, domain }`** for subdomain sharing (Option B); guidance =
  "most specific scope needed".
- **`trustedOrigins`** array gates cross-domain requests (set the dashboard origin).
- **`baseURL`** must point at the auth's reachable origin (**[verify behind a rewrite/proxy]**).
- **DB-backed sessions avoid #4203/#10021** (those need `cookieCache` + secondary storage) → **use
  DB-backed D1 sessions, no `cookieCache`+KV**.
- **`SameSite` default + exact Hono/Workers `Set-Cookie` behavior = [verify before implementation]**.

## 11. Hono / Workers-specific implications (verified)
- **Hono `cors()`:** `origin` (string/array/callback; default `*`), `credentials: true` (adds
  `Access-Control-Allow-Credentials`), `allowMethods` (default GET/HEAD/PUT/POST/DELETE/PATCH),
  `allowHeaders` (default `[]`), `exposeHeaders`, `maxAge`; **auto OPTIONS preflight**; **call before
  routes**. **Wildcard origin cannot be combined with credentials** (standard CORS).
- **Workers headers:** `Set-Cookie` must be emitted by the Workers response; ensure the runtime
  preserves it through any proxy/rewrite **[verify]**.
- **`wrangler dev`** for local; D1 local binding for the spike.

## 12. Dashboard / Vercel implications
- Dashboard fetches to auth use **`credentials: "include"`** (Option B/local) or are **same-origin**
  (Option A → no special handling).
- **Vercel rewrites/proxy** (Option A) **reduce CORS to zero** by making auth same-origin — the key
  reason A is preferred.
- The **dashboard should know only**: signed-in boolean + minimal profile (from a session endpoint);
  it must **not** hold tokens or be the source of truth.
- **SSR vs client fetch:** session reads can be server-side (central-plane) or client; cookies must
  be forwarded appropriately **[verify SSR cookie forwarding]**.
- **Production env boundaries:** auth secrets live in **central-plane** env (Workers), not the
  dashboard bundle.

## 13. Security risk register
| Risk | Class | Mitigation |
|---|---|---|
| Cross-site cookie rejection (Option C / `SameSite=None`) | **Caution→avoided** | choose Option A/B (first-party/same-site) |
| `SameSite` misconfiguration | **Caution** | explicit `Lax`; test; [verify Better Auth default] |
| Wildcard CORS + credentials | **Blocker (if done)** | forbidden; explicit origin allowlist only |
| CSRF on state-changing routes | **Caution** | `SameSite=Lax` + Better Auth CSRF/`trustedOrigins` + Origin checks |
| OAuth callback misconfig | **Watch** (later) | validate `state`; redirect allowlist (when OAuth added) |
| Cookie domain too broad | **Caution** | host-only (A) or most-specific `.trysimsa.com` (B) |
| localhost vs production mismatch | **Watch** | separate origin/env allowlists per env |
| Session fixation | **Watch** | rotate session on login; Better Auth defaults [verify] |
| Accidental production auth enablement | **Caution** | flag off by default; deploy-gated |
| Token leakage in logs | **Caution** | never log tokens; no-token-output test |
| Overbroad `trustedOrigins` | **Caution** | exact origins only |
No standing **blocker** if Option A/B + explicit allowlists are used; wildcard-CORS-with-credentials
is the one "blocker if done" to forbid.

## 14. Decision questions for Bae
1. **Same-origin proxy (Vercel rewrite, Option A)** or **auth subdomain (Option B)** as primary?
   (recommended A)
2. Can we **add an `api`/`auth` subdomain later** if A proves limiting?
3. May the **local-only spike use localhost cross-origin cookies** (same-site, `Lax`)? (recommended
   yes)
4. Should the **first spike avoid OAuth** and use **email/password** (or a dev provider)?
   (recommended yes)
5. Should **production auth stay disabled** until the rewrite/subdomain + cookie strategy is
   approved? (recommended yes)
6. Is the **cookie/domain strategy a separate approval gate** (rewrite/DNS + cookies + env)?
   (recommended yes)

## 15. Recommended next stage
- **Stage 199 — Auth Cookie/CORS PR Prep / Push / Review Gate** *(recommended, safest)*: put Stage
  197+198 docs into a PR against `main` (docs-only), keeping the merge queue lean. Alternatively
  **Stage 199 — Better Auth Package/Version Final Check** (one more version verify), or **Stage 199 —
  Better Auth Local Spike Approval Gate Execution** *(only on the explicit phrase "Better Auth local
  spike approved.")*. **Recommendation: PR prep first** — it banks the strategy on `main` before any
  spike.

## 16. Now-safe vs gated
- **Now-safe:** this strategy doc · topology comparison · cookie/CORS/CSRF plan · risk register · PR
  prep.
- **Requires Bae auth approval:** auth routes · session logic · login/logout flow.
- **Requires package/version approval:** installing Better Auth · `package.json` · lockfile.
- **Requires migration approval:** creating/running local D1 migration · production D1 migration.
- **Requires deploy approval:** production auth route · production cookies · production env vars ·
  **Vercel rewrites/proxy** · **auth/API subdomain**.
- **Requires security review:** cookies · CORS · CSRF · trusted origins · OAuth callback · token
  logging.

## 17. Stage 198 decision — **Strategy de-risked: Option A (same-origin rewrite) primary, Option B (auth subdomain) fallback**
The cookie/CORS/CSRF design is resolved on paper: keep auth on **Workers/D1** but make it
**first-party** via a **Vercel rewrite** (Option A) so the **session cookie is first-party and CORS
is eliminated**; fallback to a **same-site auth subdomain** (Option B) with `crossSubDomainCookies` +
`SameSite=Lax` + a strict CORS allowlist. **Cross-site cookies (Option C) and dashboard-runtime auth
(Option D) are rejected.** `SameSite` default, `baseURL`-behind-proxy, and SSR cookie forwarding are
flagged **[verify]** for implementation. **No code, no install, no migration, no deploy.**

## 18. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no migration
· no MCP publish · no npm publish · no auth/OAuth · no Better Auth install · no package change · no
token/secret · no domain/DNS · no server write · no DB persistence · no live-dashboard change ·
dogfood PRs #121~130 untouched.

## Sources (current)
- Better Auth cookies: https://www.better-auth.com/docs/concepts/cookies
- Better Auth options (trustedOrigins/baseURL): https://www.better-auth.com/docs/reference/options
- Hono CORS middleware: https://hono.dev/docs/middleware/builtin/cors
- MDN SameSite: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value
- MDN Set-Cookie (Secure/HttpOnly): https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- MDN CORS (credentials): https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- Vercel rewrites: https://vercel.com/docs/projects/project-configuration#rewrites
