> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 192 — Better Auth Proof-read / Implementation Readiness Check

**Date:** 2026-06-25
**Branch:** `docs/stage-192-better-auth-proofread` · **Base / main:** `d869560` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** research / proof-read / docs only. **No auth implementation, no Better Auth install, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change.**

> Re-verified against **current Better Auth official docs + GitHub issues** (URLs in §Sources).
> Facts not confirmable from a primary source are marked **[verify]** / **[unknown]**. No memory
> reliance; no tokens/secrets.

## 1. Executive summary
**Better Auth remains viable as the primary candidate (Option A).** Primary docs confirm: a
4-table identity schema, **Cloudflare D1 support** (Kysely built-in / Drizzle / community
`better-auth-cloudflare`), a Hono mount pattern, DB-backed sessions, and a documented
**organization plugin** (members/roles/invitations). **No hard blocker found.** Cautions: the
**#4203 / #10021 cookieCache-with-secondary-storage logout bug** (avoid the `cookieCache` +
KV-`secondaryStorage` combo — use DB-backed D1 sessions), the **exact Workers/D1 binding wiring**
is in the Cloudflare integration/community guide rather than the Hono page **[verify]**, and
Simsa's 5-role model needs **custom access control** (the org plugin defaults to
owner/admin/member). **WorkOS fallback stays active.** **Confidence: medium-high. No
implementation in this stage.**

## 2. Current Simsa baseline
`main` `d869560` carries **auth planning docs only**. Production (`9b645af`) has **Plan Map live,
no auth**. `/account` = local stub · `userKey` insufficient · real collaboration **blocked**.

## 3. Better Auth runtime fit
- **Hono:** official mount — `app.on(["POST","GET"], "/api/auth/*", (c) => auth.handler(c.req.raw))`
  (verified). CORS via `hono/cors` with `credentials: true`; middleware injects `user`/`session`.
- **Cloudflare Workers / D1:** **D1 is a supported database** (Kysely built-in adapter covers
  SQLite/D1; Drizzle also; community `better-auth-cloudflare` + a `hono.dev` example exist). The
  **Hono docs page itself does not detail Workers/D1 binding wiring** — that lives in the
  Cloudflare integration guide / community package **[verify exact D1-binding + edge wiring before
  implementation]**.
- **Vercel ⇄ Workers split:** Better Auth can run **either** in the **central-plane (Hono on
  Workers + D1)** — recommended, co-located with the data it authorizes — **or** as a Next.js
  route on Vercel. **Recommendation: host the auth handler in central-plane (Workers/D1)**, with
  the dashboard calling it; this keeps identity next to `workspace_*`/D1 and the existing
  encrypted-token store. **[verify cookie domain works across `app.trysimsa.com` ⇄ the
  central-plane host]** (§5).
- **Edge caveats:** DB-backed sessions on D1 = a D1 read per request (acceptable at the edge);
  `cookieCache` would reduce reads **but** triggers the #4203 caution (§8). Stateless/encrypted
  sessions are an option but reduce revocation control.

## 4. Better Auth schema expectations (verified)
**Better Auth-owned core tables** *(do not hand-edit without understanding Better Auth)*:
| Table | Key fields (verified) |
|---|---|
| `user` | id(PK), name, email, emailVerified(bool), image, createdAt, updatedAt |
| `session` | id(PK), userId(FK), token, expiresAt, ipAddress?, userAgent?, createdAt, updatedAt |
| `account` | id(PK), userId(FK), accountId, providerId, accessToken?, refreshToken?, accessTokenExpiresAt?, scope, idToken?, password?(credential), timestamps |
| `verification` | id(PK), identifier, value, expiresAt, timestamps |
**Adapters:** Kysely (built-in: SQLite/**D1**, Postgres, MySQL, MSSQL), Drizzle, Prisma, MongoDB;
can run **without a DB** (stateless). → **`user`/`session`/`account`/`verification` are Better
Auth-owned** (created/migrated via Better Auth's CLI/schema generator **[verify generator on
D1]**). **Simsa-owned** tables (§9) reference `user.id`.

## 5. Session & cookie model (verified)
- **Default = DB-backed sessions** (queried each request); also **stateless/encrypted-cookie** and
  **secondary storage** (Redis/KV) modes.
- **`cookieCache`** = short-lived signed cookie (`compact` default / `jwt` / `jwe`), `maxAge` —
  reduces DB hits but see §8.
- **Expiration:** `expiresIn` default **7 days**; auto-refresh at `updateAge` (default 1 day);
  `freshAge` (default 1 day).
- **Cookie attributes:** `crossSubDomainCookies`, `defaultCookieAttributes`, per-cookie
  `sameSite`/`secure` are configurable (Hono integration). **Exact httpOnly/secure/SameSite
  defaults [verify]**; must set **secure + appropriate SameSite + domain** for
  `app.trysimsa.com` and confirm CORS (`credentials: true` / client `credentials: "include"`).
- **Cross-subdomain:** if dashboard and auth host differ, use `crossSubDomainCookies` **[verify
  domain layout]**.
- **Logout/invalidation:** `revokeSession()` / `revokeOtherSessions()` / `revokeSessions()`;
  stateless invalidation via a `version` bump.

## 6. Organization plugin proof-read (verified)
- **Exists, documented, no stated maturity/stability warning.** Tables: `organization`
  (id,name,slug,logo,metadata,createdAt), `member` (id,userId,organizationId,role,createdAt),
  `invitation` (id,email,inviterId,organizationId,role,status,createdAt,expiresAt); `session`
  extended with `activeOrganizationId`/`activeTeamId`. Optional: `organizationRole`, `team`,
  `teamMember`.
- **Roles:** defaults **owner/admin/member**; **custom roles via `createAccessControl()`** and
  **`dynamicAccessControl`** (runtime, DB-stored). → **Simsa's Owner/Admin/Editor/Reviewer/Viewer
  is achievable but requires custom access-control config** (not out-of-the-box).
- **Invitations:** `sendInvitationEmail` callback → `inviteMember` → `acceptInvitation`/
  `rejectInvitation`/`cancelInvitation`; default expiry **48h**, member limit **100** (configurable).
- **Fit / risk:** functionally covers members/roles/invites. **Decision point:** use the plugin's
  `organization`/`member`/`invitation` **or** keep **Simsa-owned `workspace`/`workspace_member`/
  `invitation`** (Stage 189). The plugin is faster; Simsa-owned is more portable (WorkOS) + gives
  direct audit control. **No maturity blocker**, but custom-roles + plugin-shaped tables are an
  implementation consideration (caution, not blocker).

## 7. Kakao / Naver / social provider note (verified)
- **Kakao and Naver are documented first-class social providers** (dedicated docs pages;
  `socialProviders` with clientId/clientSecret) — lowest-effort path for Korea social later.
- **Recommendation unchanged: email-first MVP**; Kakao/Naver **post-MVP** (low effort to add via
  Better Auth when the market need is concrete).

## 8. Known issue / risk review
| Risk | Source | Status | Classification | Mitigation |
|---|---|---|---|---|
| **#4203** `secondaryStorage` TTL forces re-login (cookieCache + KV after cache expiry → logout instead of falling back to storage) | github #4203 | **OPEN, reopened Jan 2026** | **Caution** (combo-specific) | **Avoid `cookieCache` + KV-`secondaryStorage` combo; use DB-backed D1 sessions** |
| **#10021** expired `session_data` cookie cache logs out instead of DB fallback | github #10021 | open (same family) | **Caution** | same — don't rely on cookieCache for fallback |
| Exact Workers/D1 binding + edge wiring | Hono docs page silent | **[verify]** | **Watch** | confirm via Cloudflare integration guide / community pkg before impl |
| 5-role model needs `createAccessControl` | org-plugin docs | n/a | **Caution** | plan custom access control |
| Maintenance/release status | docs/changelog | active (Better Auth 1.5 referenced) | **Watch** | pin a reviewed version at impl |
**Net:** no **blocker**; cautions are configuration-avoidable. Do not over-index on #4203 — it
only bites the cookieCache+secondary-storage combination Simsa need not use.

## 9. Simsa-owned collaboration layer check
The Stage 189 portability principle **still holds**:
- **Better Auth owns:** `user` · `session` · `account` · `verification`.
- **Simsa owns:** `Workspace` · `WorkspaceMember` · `Invitation` (unless the org plugin is
  adopted — open question §14) · `ProjectAccess` · `IntegrationAccount` · `GateDecision` ·
  `ActivityEvent` · `PlanMap/Roadmap` events.
**Why portability matters:** keeping the collaboration layer Simsa-owned means a later swap
(Better Auth ⇄ WorkOS) touches mainly the identity layer + a mapping column, and keeps the
Plan-Map approval **audit** fully queryable/controlled by Simsa rather than a vendor.

## 10. Migration-readiness impact (for Stage 193+)
A future migration stage must plan: **exact tables** (Better Auth `user`/`session`/`account`/
`verification` via its generator **[verify on D1]** + Simsa collaboration tables) · **additive
migrations** (`0047+`) · **feature flag** · **`userKey` backfill** → default workspace · **dual-
read** fallback · **rollback** (keep `userKey` columns) · **local/dev verification** (wrangler D1
local) · **production migration approval** · **no destructive migration** (never auto-merge
`userKey` tenants).

## 11. Security review checklist (refined)
Cookie attributes (**httpOnly + secure + SameSite + domain** on `app.trysimsa.com`) **[verify
defaults]** · CSRF/CORS for the Vercel↔Workers split (`credentials` both ends) · session
expiration/refresh (`expiresIn`/`updateAge`/`freshAge`) · **encrypted token storage** for
`account`/`integration_account` · provider account linking · **OAuth callback handling** (redirect
allowlist) · webhook signatures **[if any used]** · invite-token design (hash-at-rest, 48h default
**[confirm]**) · audit-log attribution · account deletion/export (secret-free) · rate limiting /
abuse prevention. Each = a **security-review gate**.

## 12. Implementation-readiness checklist (future stage — do NOT implement now)
- [ ] **Architecture choice confirmed by Bae** (Better Auth vs WorkOS; org-plugin vs Simsa-owned).
- [ ] **Better Auth exact version selected** (pin + review changelog; confirm #4203/#10021 status
      at that version).
- [ ] **Auth runtime location decided** (recommended central-plane Workers/D1).
- [ ] **Migration plan approved** (additive `0047+`, feature flag, `userKey` backfill, rollback).
- [ ] **Env-var handling plan approved** (auth secrets server-side only, never printed).
- [ ] **Local dev auth flow plan** (wrangler D1 local; `/api/auth/*` mount).
- [ ] **Test plan** (session E2E, cookie/CORS, role checks, dual-read parity).
- [ ] **Rollback plan** (flag back to `userKey` read path).
- [ ] **Deploy plan** (separate Bae approval; auth routes + cookies in production).
- [ ] **Security review completed** (§11).

## 13. Decision update — **Option A: Better Auth remains the primary candidate**
Current primary-source proof-read **supports** the Stage 188/189 recommendation: D1/Hono fit
confirmed, schema known, org plugin real, Kakao/Naver first-class. **No blocker**; the risks are
**cautions** that are configuration-avoidable (DB-backed sessions; avoid cookieCache+KV; plan
custom roles; verify edge/D1 wiring). **WorkOS fallback stays active.** (Not Option B/C/D — no
uncertainty rising to a spike-blocker or downgrade.)

## 14. Bae decision questions (updated)
1. Confirm **Better Auth primary**? (proof-read says yes)
2. Keep **WorkOS fallback**? (recommended yes)
3. **Email-first MVP**? (recommended yes)
4. **Kakao/Naver later**? (recommended yes — first-class when needed)
5. **Simsa-owned `workspace`/`workspace_member`** — or **adopt Better Auth org plugin**? (lean
   Simsa-owned for portability/audit; plugin is the faster alternative)
6. **Where does auth runtime live** — central-plane (Workers/D1, recommended) or dashboard?
7. **First approved implementation slice** — e.g. identity-only (`user`/`session`/`account`/
   `verification` + sign-in) behind a flag, before any workspace migration?
8. **Acceptable migration gate** — additive + flag + dual-read + rollback (recommended)?
9. **Audit-log retention** period?

## 15. Recommended next stage
**Stage 193 — Auth Architecture Decision Gate** (Bae answers §14 → freeze: provider, org-plugin
vs Simsa-owned, runtime location, first slice). Then **Stage 194 — Better Auth Minimal
Implementation Plan** (identity-only slice, still planning until Bae approves install + migration
+ deploy). A **WorkOS Fallback Deep Review** is only needed if Bae leans managed.

## 16. Now-safe vs gated
- **Now-safe:** this proof-read · source verification · decision questions · implementation-
  readiness checklist · migration-planning notes.
- **Requires Bae auth approval:** installing Better Auth · auth routes · session middleware ·
  OAuth/social providers · account linking.
- **Requires migration approval:** Better Auth tables · Simsa `User`/`Workspace`/`WorkspaceMember`
  tables · `userKey` backfill · `IntegrationAccount` ownership · `GateDecision`/`ActivityEvent`.
- **Requires deploy approval:** auth routes in production · session cookies in production ·
  workspace-aware project reads · env-var changes.
- **Requires security review:** cookies/sessions · OAuth callbacks · token storage · invite/share
  tokens · audit trail · account deletion/export.

## 17. Stage 192 decision — **Option A (Better Auth primary, no blocker; cautions documented)**
Proof-read against current primary sources confirms Better Auth fits Simsa's D1/Hono/Workers
direction; identity schema + org plugin + Kakao/Naver verified; the #4203/#10021 logout risk is a
configuration-avoidable **caution**, not a blocker; edge/D1 binding wiring + cookie defaults are
flagged **[verify]** for the implementation stage. The portable Simsa-owned collaboration layer
(Stage 189) holds. **No code, no install, no migration.** Decisions return to Bae (§14).

## Sources (current)
- Better Auth database/schema: https://www.better-auth.com/docs/concepts/database
- Session management / cookies: https://www.better-auth.com/docs/concepts/session-management
- Hono integration: https://www.better-auth.com/docs/integrations/hono
- Organization plugin: https://www.better-auth.com/docs/plugins/organization
- Kakao provider: https://www.better-auth.com/docs/authentication/kakao · Naver: https://www.better-auth.com/docs/authentication/naver
- Issue #4203 (secondaryStorage TTL re-login): https://github.com/better-auth/better-auth/issues/4203
- Issue #10021 (expired cookie cache logout vs DB fallback): https://github.com/better-auth/better-auth/issues/10021
- Cloudflare D1/Workers integration (community): https://hono.dev/examples/better-auth-on-cloudflare · https://github.com/zpg6/better-auth-cloudflare
