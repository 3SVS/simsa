> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 188 — Auth Provider / Architecture Selection Matrix

**Date:** 2026-06-25
**Branch:** `docs/stage-187-188-auth-identity-selection` (renamed from `docs/stage-187-auth-identity-brief`) · **Base / deployed main:** `9b645af` · live: https://app.trysimsa.com
**Type:** research / decision matrix only. **No auth implementation, no SDK install, no login routes, no session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no token/secret request-print-store, no env-var change, no live-dashboard change.**

> Research was done against **current (June 2026) official/provider sources** (URLs in §4/§Sources). Where a fact could not be confirmed from a primary source, it is marked **[verify]** and must be re-checked against the provider's current docs **before** any implementation. No tokens/secrets were requested, printed, or stored.

## 1. Executive recommendation
**Two finalists; final pick is Bae's. Confidence: medium (stack-fit facts are strong; a few provider specifics need re-verification before coding).**
- **Primary (best fit for Simsa's specific stack): Better Auth (framework-native).** It natively
  targets **Cloudflare D1 + Hono + Workers** — *exactly* the central-plane stack — has an
  **organization plugin** (members/roles/invitations), and ships **native Kakao + Naver**
  providers, free/self-host, low lock-in, full data control.
- **Fallback (managed, offloads security responsibility): WorkOS AuthKit.** First-class
  **organizations** (workspaces/roles/invitations/domain verification), **free up to 1M MAU**,
  edge-verifiable JWT, B2B-oriented. Best if the team would rather not own session/email/token
  security.
- **Reject / defer now:** **Auth0** (Organizations is Professional-only → ~$150/mo+ at 500 MAU,
  "growth-penalty" for early B2B); **Supabase Auth** (would introduce Postgres/Supabase
  alongside the existing **D1** backend — a stack divergence — and has **no built-in orgs**);
  **Clerk** is strong but its **per-organization B2B pricing** ($1/MAO after 100 free orgs) can
  scale unfavorably for a workspace-heavy product — keep as a third option, not primary.
- **Reject: custom-on-D1** (Stage 187, high security risk).
- **Open questions for Bae (see §13):** managed-vs-native (offload security vs own the stack);
  is email-only acceptable for MVP; is Kakao/Naver MVP or later; Simsa-owned vs provider-org
  workspace model; acceptable lock-in/cost tradeoff.

## 2. Decision context (from Stage 187)
`userKey` is a client-supplied tenant surrogate, **not** identity. The **MVP identity floor**
before any collaboration is **User (verified email) + Workspace + WorkspaceMember + session**.
Real collaboration (team/invite/share/roles/approval-audit) stays **blocked** until an auth
architecture is selected **and** Bae-approved. **No implementation in this stage.**

## 3. Candidate shortlist (why included)
1. **WorkOS AuthKit** — managed, **org-native**, B2B-first, very generous free tier.
2. **Better Auth** — framework-native, **D1/Hono/Workers-native**, org plugin, Kakao/Naver.
3. **Clerk** — managed, excellent DX + edge verification, generous user free tier (per-org cost
   caution).
4. **Auth0 by Okta** — mature, but Organizations is paid-tier; included as the enterprise-grade
   baseline.
5. **Supabase Auth** — JWT + RLS; included because it's common, but diverges from the D1 stack.
6. **Custom** — negative baseline (rejected in Stage 187).

## 4. Provider / architecture matrix (current-doc grounded)
| Criterion | **Better Auth** (native) | **WorkOS AuthKit** (managed) | **Clerk** (managed) | **Auth0** (managed) | **Supabase Auth** | **Custom** |
|---|---|---|---|---|---|---|
| Category | Framework-native / self-host | Managed org-native | Managed org-native | Managed (B2C + B2B tier) | Managed (JWT+RLS) | Internal |
| Core identity (user id, email verify, session, social) | Yes, code-config | Yes (email/pw, social, MFA) | Yes (rich, social, MFA) | Yes (mature) | Yes (JWT) | Build all |
| **Orgs / workspace primitives** | **Organization plugin** (members, roles, invites) | **First-class orgs** (members, roles, invites, domain verify) | Orgs (B2B add-on) | **Organizations = Professional-only** | **None built-in** (model yourself) | Build all |
| GitHub login linking / connected-acct separation | Yes (account linking; keep IntegrationAccount separate) | Yes | Yes | Yes | Yes (OAuth providers) | Build |
| **Edge / Workers JWT verify** | Runs **on Workers/Hono natively** | JWT verifiable at edge **[verify JWKS/cookie model]** | **Networkless JWT verify** via `jwtKey` (edge-proven) | JWT/JWKS verifiable **[verify edge]** | JWT verifiable (JWKS) | Build |
| **D1 fit** | **Native D1** (first-class, no custom adapter) | Provider-hosted (we store mapping in D1) | Provider-hosted (mapping in D1) | Provider-hosted | **Postgres/Supabase** (diverges from D1) | D1 |
| Security responsibility | **On us** (self-host) | **Offloaded** | Offloaded | Offloaded | Mostly offloaded | **Entirely on us** |
| Data/model control & lock-in | **Full control, low lock-in** | Medium lock-in | Medium lock-in | Medium–high | Medium (ties to Supabase) | Full |
| **Korea social (Kakao/Naver)** | **Native providers** (docs exist) | **[verify]** (custom OAuth likely) | **[verify]** (custom OAuth likely) | **[verify]** | **[verify]** | Build |
| Cost (early stage) | **~$10–40/mo infra, user-count-independent** | **Free ≤ 1M MAU** | Free ≤ 50K MAU; **B2B $1/MAO after 100 orgs** | Free 25K MAU B2C; **B2B ~$150/mo+ at 500 MAU** | Free tier + usage | Infra only |
| Implementation complexity | Medium (we wire it) | Low–Med | Low–Med | Med | Med (new DB) | High |
| **Simsa fit (stack + Korea + collab)** | **Highest** (exact stack + Korea + control) | **High** (managed orgs, cheap) | High (per-org cost caution) | Medium (org pricing) | Low–Med (stack divergence) | Low |
| Notable risk | Open bug **#4203** (5-min session edge case, reopened Jan 2026) **[verify fixed]**; younger org plugin | Some lock-in; Kakao **[verify]** | Per-org cost scaling | "Growth penalty" cost | Adds Postgres dependency | High risk |

Pricing/feature cells reflect June-2026 sources (§Sources) and **must be re-verified at sign-up
time** — provider plans change.

## 5. Runtime compatibility notes
- **Vercel dashboard:** all managed options + Better Auth integrate with Next.js on Vercel.
- **Cloudflare Workers / edge (central-plane = Hono on Workers + D1):** **Better Auth runs
  directly on Workers/Hono with native D1** (best fit). Managed providers (Clerk/WorkOS/Auth0/
  Supabase) require the Worker to **verify the provider's JWT at the edge** — feasible with a
  JOSE library + **JWKS caching** (per-isolate LRU or KV; cold JWKS ~15–25 ms, cached
  sub-ms; cap refresh at 5–10 min). **Clerk** documents **networkless JWT verification**
  (supply the PEM `jwtKey`) which removes the per-request JWKS round-trip — strong edge story.
- **Session cookies:** managed providers set their own session cookies (domain/SameSite/secure
  to verify for `app.trysimsa.com`); Better Auth's cookie/session is self-managed (and is where
  bug #4203 lives — **verify resolved**).
- **Must re-verify before implementation:** exact edge JWT/JWKS verification path per provider,
  cookie domain behavior on the custom domain, and Worker-side authorization wiring.

## 6. Workspace / organization model fit
- **WorkOS / Clerk:** provide org primitives → map **Provider Org → Simsa Workspace**, provider
  membership/roles → `WorkspaceMember`; least custom code, but the workspace model partly lives
  in the vendor.
- **Better Auth:** organization **plugin** gives members/roles/invites while the data stays in
  **our D1** → **Simsa-owned Workspace model** with the most control.
- **Auth0:** Organizations only on Professional → costly early.
- **Supabase:** no orgs → we model `account` + membership + `has_role_on_account` ourselves
  (plus a Postgres dependency).
- The **Owner/Admin/Editor/Reviewer/Viewer** model (Stage 171/187) maps onto either a provider's
  role system (WorkOS/Clerk/Better-Auth org plugin) or our own `WorkspaceMember.role`.

## 7. GitHub / Vercel connected-account distinction
Whatever is chosen, **login identity must stay separate** from:
- **GitHub repo access** (the existing repo-evidence OAuth + encrypted tokens) — a "Sign in with
  GitHub" *login* is a distinct OAuth purpose;
- **Vercel deployment access** — a connected integration, never the identity source.
`IntegrationAccount` ownership ties to **user/workspace context**, with tokens **server-side
encrypted** (as `crypto.ts` does today) and **never** browser-local or printed.

## 8. Data model mapping
- **ProviderUser → Simsa `User`** (stable id + verified email + profile).
- **Provider Org (WorkOS/Clerk) or Simsa-created `Workspace` (Better Auth/Supabase) → `Workspace`.**
- **Provider membership or `WorkspaceMember` table → `WorkspaceMember`** (role, status).
- **Provider invitation or `Invitation` table → `Invitation`** (tokenHash, expiry, revoke).
- **`GateDecision` attribution → `User` + `WorkspaceMember`** (who approved which Plan-Map gate,
  when) — needed for the Plan-Map audit trail.

## 9. Migration implications
- Current **`userKey` projects** must be **backfilled to a default Workspace per key** (Phase 3,
  Stage 187) — additive, behind a **feature flag**, with **dual-read** until the backfill is
  verified, then switch read paths; **rollback** = keep `userKey` columns until cutover is
  proven.
- **Default workspace** created on first auth; project **ownership** assigned during backfill.
- Better Auth/Supabase add their tables **into D1/Postgres we control**; WorkOS/Clerk keep
  identity vendor-side and we store a **`workspace_id`/`external_id` mapping** in D1.
- All migrations are **separate-Bae-approval-gated** (Stage 187 §13).

## 10. Security & compliance review needs (before implementation)
Session cookie settings (domain/SameSite/secure on `app.trysimsa.com`) · CSRF/CORS for the
Vercel↔Workers split · **JWKS/edge JWT verification** · token **encryption at rest** · **invite
token** lifetime/hash · **public share-link** tokens · **account deletion/export** · **audit-log
retention** · **provider webhooks** (signature verification) · **environment variables** (auth
secrets handling). Each is a **security-review gate**.

## 11. Pricing / cost caution (verified June-2026, re-verify at sign-up)
- **WorkOS AuthKit:** free **up to 1M MAU**, then ~$2,500/1M; enterprise SSO/SCIM $125/conn/mo
  (only when needed).
- **Clerk:** free up to **50K MAU** (2026 raise); **B2B add-on** free for 100 MAO (5 members
  each), then **$1/MAO**; Pro $25/mo base + per-MAU over tier.
- **Auth0:** free **25K MAU** B2C; **Organizations = Professional**, ~$150/mo+ starting 500 MAU.
- **Better Auth:** open-source/self-host → roughly **$10–40/mo infra, user-count-independent**.
- **Do not** pick on price alone — but for a workspace-heavy early product, **per-organization**
  pricing (Clerk) and **org-gated tiers** (Auth0) are the cost risks; WorkOS (free-to-1M) and
  Better Auth (flat infra) are the most early-stage-friendly.

## 12. Korea / global login note
- **Email-first (+ generic social) is sufficient for MVP.** Do **not** block MVP on Kakao/Naver.
- **Kakao/Naver later:** **Better Auth ships native Kakao + Naver providers** (lowest effort);
  managed providers (WorkOS/Clerk/Auth0) would add them via **custom OAuth connections** **[verify
  each provider's custom-OAuth support]**.
- **Data residency / localization:** **[verify per provider]** if Korean data-residency becomes a
  requirement. Global product direction favors an **email/social-neutral MVP** first, adding
  Korea social when the market need is concrete.

## 13. Decision questions for Bae
1. **Managed vs framework-native** — offload security (WorkOS/Clerk) **or** own the stack
   (Better Auth)?
2. **Provider shortlist** — confirm finalists: **Better Auth** and **WorkOS** (drop Auth0/
   Supabase/Clerk, or keep Clerk as third)?
3. **Org-native from day one?** — provider-backed orgs (WorkOS/Clerk) vs Simsa-owned workspace
   tables (Better Auth)?
4. **Email-only MVP acceptable?** (recommended yes).
5. **Kakao/Naver — MVP or later?** (recommended later).
6. **Workspace model — Simsa-owned or provider-org-backed?**
7. **Acceptable lock-in / cost tradeoff** (flat self-host infra vs managed per-MAU/per-MAO)?

## 14. Recommended next stage
**Stage 189 — User + Workspace Schema Planning Based on the Selected Auth Category** — but
**only after Bae answers §13** (especially managed-vs-native, since that determines whether we
own full `User`/`Session`/`Workspace` tables in D1 or store a vendor-id mapping). If Bae wants
more provider depth first, a short **provider proof-read** (re-verify the **[verify]** cells —
Kakao on the managed providers, Better Auth #4203 status, current pricing) precedes schema
planning. **No implementation until Bae selects an architecture.**

## 15. Now-safe vs gated
- **Now-safe:** this provider matrix · architecture research · decision questions · schema
  planning · auth copy updates ("requires sign-in" / Plan-Map blocker).
- **Requires Bae auth approval:** installing a provider SDK · login/session routes · OAuth
  provider setup · account linking · verified-email flow.
- **Requires migration approval:** `User`/`Workspace`/`WorkspaceMember` tables · backfill
  `userKey` projects · `Invitation`/`ProjectAccess` tables · `GateDecision`/`ActivityEvent`
  tables.
- **Requires deploy approval:** auth rollout · session middleware in production · workspace-gated
  access · environment-variable changes.
- **Requires security review:** token/cookie/session handling · JWKS verification · webhook
  signature verification · provider metadata · invite/share tokens · audit logs.

## 16. Stage 188 decision — **Option A: selection matrix ready (two finalists)**
Current-doc-grounded comparison done. **Primary: Better Auth** (exact D1/Hono/Workers stack fit
+ native Kakao/Naver + low cost/lock-in). **Fallback: WorkOS AuthKit** (managed org-native, free
to 1M MAU). **Defer Auth0/Supabase; Clerk third (per-org cost caution); custom rejected.** A
handful of provider specifics are flagged **[verify]** for a pre-implementation check. **No code,
no provider account, no token work.** Decision now sits with Bae (§13).

## Sources (current, June 2026)
- WorkOS pricing / orgs: https://workos.com/pricing
- Clerk pricing: https://clerk.com/pricing · B2B/per-org: https://workos.com/blog/clerk-pricing · https://supertokens.com/blog/clerk-pricing-the-complete-guide
- Clerk edge / networkless JWT: https://clerk.com/docs/guides/sessions/manual-jwt-verification · https://clerk.com/articles/authentication-for-serverless-and-edge-deployments
- Auth0 pricing / B2B Organizations: https://auth0.com/pricing
- Supabase Auth + RLS multi-tenancy: https://supabase.com/docs/guides/auth · https://github.com/supabase/auth
- Better Auth: https://better-auth.com/ · Kakao: https://www.better-auth.com/docs/authentication/kakao · Naver: https://www.better-auth.com/docs/authentication/naver
- Better Auth on Cloudflare D1/Hono: https://hono.dev/examples/better-auth-on-cloudflare · https://github.com/zpg6/better-auth-cloudflare
- Edge JWT/JWKS verification practice: https://securityboulevard.com/2025/11/how-to-validate-jwts-efficiently-at-the-edge-with-cloudflare-workers-and-vercel/
