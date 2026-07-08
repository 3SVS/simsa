> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 193 — Auth Architecture Decision Gate

**Date:** 2026-06-25
**Branch:** `docs/stage-192-better-auth-proofread` (auth train, continues 192) · **Base / main:** `d869560` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** decision record / docs only. **No auth implementation, no Better Auth install, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

> This is a **decision-gate** that freezes the architecture *direction*. It does **not** approve
> implementation, install, migration, env-vars, token handling, or deploy. No blocker was found
> while writing this record, so the recommended architecture below is **adopted for planning**.

## 1. Executive decision
- **Primary auth architecture: Better Auth** (selected for planning).
- **Fallback: WorkOS AuthKit** (managed; remains active).
- **Collaboration layer: Simsa-owned** (`workspace`/`workspace_member`/`invitation`/
  `project_access`/`integration_account`/`gate_decision`/`activity_event` are Simsa's source of
  truth).
- **Better Auth organization plugin: NOT the MVP source of workspace truth** (deferred; later
  optional reference only).
- **Auth runtime: planned for central-plane / Cloudflare Workers / D1** (not browser-local).
- **Implementation remains BLOCKED** until separate Bae approvals (auth install → migration →
  deploy), each with security review.

## 2. Decision basis (Stage 187~192 evidence)
- **Stage 187 (brief):** `userKey` is a client-supplied tenant surrogate, **not** authentication;
  MVP identity floor = User(verified email)+Workspace+WorkspaceMember+session.
- **Stage 188 (matrix):** current-doc-grounded — **Better Auth primary** (native D1+Hono+Workers,
  org plugin, native Kakao/Naver, flat self-host cost, low lock-in); **WorkOS fallback** (org-
  native, free to 1M MAU); Auth0/Supabase deferred; Clerk third; custom rejected.
- **Stage 189 (schema):** portable schema — identity provider-backed, **collaboration Simsa-owned**.
- **Stage 192 (proof-read):** primary-source-verified — 4-table identity schema; **D1 viable**;
  **DB-backed sessions** viable at the edge; org plugin real (owner/admin/member + custom roles
  via `createAccessControl`); **Kakao/Naver first-class** (later benefit); **#4203/#10021
  cookieCache+secondary-storage logout = caution, avoidable** (use DB-backed D1 sessions, no
  cookieCache+KV combo); **no blocker**. WorkOS fallback retains value (offloads security).

## 3. Explicit architecture choices
| Dimension | Decision |
|---|---|
| Provider | **Better Auth** |
| Fallback | **WorkOS AuthKit** |
| Identity runtime | **central-plane / Cloudflare Workers / D1** |
| Dashboard role | **consumes** session/auth state — **not** source of truth |
| Workspace source of truth | **Simsa-owned tables** |
| Membership source of truth | **Simsa-owned tables** |
| GateDecision source of truth | **Simsa-owned tables** |
| ActivityEvent source of truth | **Simsa-owned tables** |
| IntegrationAccount source of truth | **Simsa-owned tables** |
| Better Auth org plugin | **defer / not MVP** |
| Kakao / Naver | **later, not an MVP blocker** |
| Email-first MVP | **acceptable** |
| Payment provider | **TBD, no Stripe assumption** |

## 4. What is approved by this decision
- The **architecture planning direction** (Better Auth primary, Simsa-owned collaboration,
  central-plane/Workers/D1 runtime target).
- Future **implementation planning** may assume **Better Auth primary**.
- Future **schema planning** may assume **Simsa-owned collaboration tables**.
- Future **proof-of-concept planning** may target **D1 / Hono / Workers**.
**This decision does NOT approve** implementation, migration, deployment, env-var changes, or
token handling.

## 5. What is NOT approved
Installing Better Auth · adding auth routes · adding session middleware · adding OAuth providers ·
creating migrations · creating `User`/`Workspace` tables · changing project-access behavior ·
turning on workspace-aware reads · adding invitation flow · adding role enforcement · adding Plan
Map approval audit · connecting GitHub/Vercel ownership · changing production env vars · deploying
auth. **All remain separately Bae-approval-gated.**

## 6. Architecture diagram (text)
```
Browser / Dashboard (Vercel, app.trysimsa.com)
  → calls dashboard pages + central-plane auth/session endpoints (/api/auth/*)
      → central-plane (Hono on Cloudflare Workers + D1) verifies the session
          → Better Auth-owned identity:  user · session · account · verification   (D1)
          → Simsa-owned collaboration:   workspace · workspace_member · project(+workspaceId)
                                          · project_access · invitation · gate_decision
                                          · activity_event · (roadmap_event)         (D1)
          → integration tokens:          integration_account, server-side ENCRYPTED  (later)
Dashboard consumes session/auth state; it is NOT the source of truth.
userKey persists as legacy tenant-scoping fallback during transition (never authentication).
```

## 7. First future implementation slice (plan only — Stage 194+)
The smallest safe future slice (still **planning**, not execution):
- **Better Auth minimal identity setup plan** (`user`/`session`/`account`/`verification` + sign-in)
  **behind a feature flag**.
- **Simsa `User` mapping** only if needed (open question §16).
- **No** team invite · **no** workspace role enforcement · **no** Plan-Map gate approval · **no**
  integration-ownership migration.
- **Local-only proof plan** (wrangler D1 local), **exact table list**, **exact env-var plan
  without values**, **test plan**, **rollback plan**.
**First real implementation still requires explicit Bae auth approval + migration approval.**

## 8. Migration gate implications (approve later)
Better Auth identity tables (via its generator **[verify on D1]**) · Simsa `User` mapping (if
used) · `Workspace` table · `WorkspaceMember` table · `userKey` backfill plan → default workspace ·
**additive migration number (`0047+`)** · **local D1 verification** · **production migration
approval** · **rollback plan** (preserve `userKey` columns; no destructive merge).

## 9. Runtime gate implications (approve later)
Central-plane auth runtime location (Workers/D1) · dashboard→auth **domain/cookie strategy**
(`crossSubDomainCookies` if hosts differ) · **CORS/CSRF** (credentials both ends) · **session
verification strategy** (DB-backed D1) · **local dev auth flow** · **production deploy plan**.

## 10. Security gate implications (review later)
Cookie **httpOnly/secure/SameSite/domain** **[verify defaults]** · session expiration/`updateAge`/
`freshAge` · **OAuth callback allowlist** · provider-account **token encryption** · invite/share
**token hash/expiry** · **audit retention** · **account deletion/export** (secret-free) · **rate
limiting** · **abuse prevention**.

## 11. WorkOS fallback trigger
Switch to WorkOS if: Better Auth **D1/Hono integration proves unstable**; Better Auth
**session/cookie behavior creates unacceptable risk** (e.g. #4203-class issue cannot be configured
around); **organization/member requirements exceed manageable custom work**; **security
responsibility is too high** for the early team; or an **implementation spike reveals a blocker**.

## 12. Plan Map relationship
Current Plan Map stays **read-only**. `GateDecision` (attributable approvals) is **future**. **No
Plan-Map approval audit before real identity.** This decision **unblocks future planning only —
not approval features**. The blocker copy can later evolve **"Blocked by identity decision" →
"Auth architecture selected"** — but **not** "implemented" until implementation ships.

## 13. Collaboration feature relationship
Team/invite/share/roles remain **blocked until implementation**. Stage 193 **only decides
architecture**. Workspace-aware project access requires **migration + auth implementation + deploy
approval**. `userKey` **cannot enforce any collaboration rights.**

## 14. Integration ownership relationship
GitHub/Vercel connected accounts stay **separate from login identity**. `IntegrationAccount`
remains a **future Simsa-owned** table; tokens stay **server-side encrypted** later. **No
integration-ownership migration yet; no write actions without explicit gates.**

## 15. Decision questions CLOSED (for planning)
- Better Auth primary? **yes** · WorkOS fallback? **yes** · email-first MVP? **yes** ·
  Kakao/Naver MVP? **no, later** · Simsa-owned workspace/member? **yes** · Better Auth org plugin
  MVP? **no** · auth runtime? **central-plane / Workers / D1 target** · first slice? **identity-only
  behind a flag**.

## 16. Decision questions STILL OPEN
- Exact Better Auth **version** · exact **migration number** · whether **Simsa `User` is separate
  from Better Auth `user` or unified** · exact **cookie domain strategy** · **local dev auth
  callback URL** strategy · **production env-var names** · **audit retention** period · **first
  social login provider** · whether to run a **local-only spike before migration**.

## 17. Recommended next stage
**Stage 194 — Better Auth Minimal Implementation Plan (docs-only)** — plan: exact package/version
proposal · exact table/migration proposal · central-plane runtime plan · env-var plan **without
values** · local-only test plan · rollback plan · implementation-approval checklist. **No
implementation recommended yet.**

## 18. Now-safe vs gated
- **Now-safe:** architecture decision record · implementation plan · migration plan · security
  checklist · local-only proof plan.
- **Requires Bae auth approval:** installing Better Auth · auth route handlers · session
  middleware · OAuth/social providers · account linking.
- **Requires migration approval:** Better Auth tables · `User`/`Workspace`/`WorkspaceMember`
  tables · `userKey` backfill · `IntegrationAccount` ownership · `GateDecision`/`ActivityEvent`.
- **Requires deploy approval:** auth routes in production · session cookies in production ·
  workspace-aware project reads · env-var changes.
- **Requires security review:** cookies/sessions · OAuth callbacks · token encryption ·
  invite/share tokens · audit trail · account deletion/export.

## 19. Stage 193 decision — **Gate frozen: Better Auth primary, Simsa-owned collaboration,
central-plane runtime, identity-only first slice**
No blocker was found while writing this record. The architecture **direction is frozen** for
planning: **Better Auth** primary (WorkOS fallback), **Simsa-owned** collaboration layer, **org
plugin deferred**, **central-plane/Workers/D1** runtime target, **identity-only behind a flag** as
the first future slice, **`userKey` legacy fallback** (never authentication). **No code, no
install, no migration, no deploy.** Closed/open questions recorded (§15/§16); implementation stays
gated.

## 20. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no
migration · no MCP publish · no npm publish · no auth/OAuth · no Better Auth install · no
token/secret · no domain/DNS · no server write · no DB persistence · no live-dashboard change ·
dogfood PRs #121~130 untouched.
