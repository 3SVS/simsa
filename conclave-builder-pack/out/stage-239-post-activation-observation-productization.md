# Stage 239 — Post-Activation Observation / Productization Gate

Date: 2026-06-27 · Type: observation + productization planning only. **No deploy / D1 mutation / cleanup / launch.**

## 1. Approval phrase observed
`"Production auth post-activation observation approved."` — present (direct). Authorizes read-only
observation + a productization memo ONLY. Does NOT authorize new deploy, D1 migration, destructive cleanup,
deleting the smoke account, creating additional users, OAuth, DNS, CORS prod, payment, MCP/npm publish, or
broad user-facing/workspace launch. Only read-only HTTP + read-only D1 + value-free secret metadata + one
non-mutating invalid request were run.

## 2. Branch / HEAD
- main `e8d42cc`; HEAD == origin/main; worktree clean. No deploy since Stage 235; no D1 schema mutation
  since Stage 224; `AUTH_ENABLED=true` (Stage 238 was the latest activation event).

## 3. Current production auth state
- `AUTH_ENABLED=true` (ACTIVE). central-plane Worker `043331b` (`/health` 0.13.15 production). dashboard
  `dpl_6AGwib8…` live with the same-origin `/api/auth/*` rewrite. Topology: `BETTER_AUTH_BASE_URL` /
  `BETTER_AUTH_TRUSTED_ORIGINS` = `https://app.trysimsa.com`; `BETTER_AUTH_SECRET` present; OAuth unset.

## 4. HTTP observation results
- `app.trysimsa.com/` → 307 (loads/redirects). `app.trysimsa.com/api/auth/ok` → **200 `{"ok":true}`**.
  Worker `/api/auth/ok` → **200 `{"ok":true}`**. Worker `/health` → 200 (v0.13.15, production).
- Auth endpoint safety: an invalid `sign-up` (missing password/name) → **HTTP 400** validation error
  (`Invalid input: expected string, received undefined`), and created **no row** (input validation works).

## 5. D1 read-only verification
- auth objects = **7**. Row counts: **user=1, account=1 (providerId `credential`), session=1,
  verification=0** — unchanged from Stage 238; no new rows from re-checks or the invalid request.
- The single user is the marked smoke account `simsa-auth-smoke-20260626172247@example.com`. No tokens/secrets read.

## 6. Env / secret metadata (value-free)
- `AUTH_ENABLED`, `BETTER_AUTH_BASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_TRUSTED_ORIGINS` present (4
  auth-related). OAuth unset. No values revealed; nothing rotated/deleted.

## 7. Productization gap review (from repo)
- **Dashboard auth UI: NONE.** The dashboard does not depend on `better-auth` and has no
  `createAuthClient` / `signIn` / `signUp` / `useSession` / `/api/auth` client usage — the auth route is
  backend-only. So `app.trysimsa.com` exposes a working auth API with **no login/sign-up/logout UI**.
- **`/account`: local stub** (Stage 170) — localStorage display-name + locale only; "NO real
  auth/identity/session"; connected-accounts/delete are placeholders. Not wired to the live auth.
- **Workspace membership model:** still client `userKey` tenant-scoping only; no User/members/roles tables.
- **userKey → real-user transition:** unresolved (Stage 171 planning); no backfill from the new `user` table.
- **Invite / share permission model:** not built (Stage 172 planning).
- **Logout / session UX:** none (no auth UI to drive it).
- **Test-account cleanup policy:** the one smoke account remains; cleanup NOT approved (out of scope here).
- **Admin / support visibility:** workspace-record admin endpoints exist, but there is no auth-user admin
  / support surface for the new `user`/`session` tables.
- **Audit / approval log:** the gated-stage checkpoint reports (Stages 207–239) are the audit trail; no
  in-product auth-user audit log yet.
- **Terms / privacy / account deletion:** simsa-dev has `/privacy` + `/terms` placeholders; auth-user
  account deletion + data-handling not implemented.
- **Pricing / billing coupling:** none with auth (decoupled — safe).
- **MCP / public launch:** MCP unpublished; auth not exposed via MCP.

## 8. Launch blockers
- **Technical auth active:** YES (API layer, verified disabled→active, smoke passed).
- **Internal controlled use:** possible only via direct API calls today (no UI); allow only if Bae
  designates who/how. Not user-discoverable through the dashboard UI.
- **Public / broad launch: BLOCKED** until ALL of: account UX ready · workspace membership policy ·
  userKey → real-user mapping designed · invite/share permissions defined · logout/session UX verified ·
  test-account cleanup policy · support disable/rollback procedure documented · privacy/account-deletion handling.

## 9. Rollback / containment criteria
- Immediate rollback if: dashboard breaks · `/health` fails · `/api/auth/ok` repeated 5xx · unexpected new
  auth rows · unsafe session-cookie behavior · unauthorized origin accepted · auth becomes unsafely public ·
  ops cannot contain.
- Rollback: `pnpm --filter @conclave-ai/central-plane exec wrangler secret delete AUTH_ENABLED` (instant, no
  code deploy) → then verify `app.trysimsa.com/api/auth/ok` → `503 auth_disabled`, D1 row counts stop
  changing, dashboard normal. **Not triggered — all checks clean.**

## 10. M&A / enterprise readiness note
The activation is now evidenced as disciplined production operations: it was gated, the smoke was minimal
(one marked account, exact +1/+1/+1 delta), input validation rejects bad requests (400, no row), drift is
zero, rollback is one deploy-free command, and broad launch stays explicitly blocked behind a concrete
account/workspace/permissions checklist. Auth is technically live but not yet a launched product surface.

## 11. Explicit non-actions (NONE performed)
No new deploy, no dashboard/central-plane deploy, no D1 schema migration, no destructive D1 cleanup, no
smoke-account deletion, no additional user creation (the invalid request created no row), no OAuth, no
DNS/domain, no CORS prod change, no payment/billing, no MCP/npm publish, no broad user-facing/workspace
launch, no `AUTH_ENABLED` rollback, no secret rotation, no code change on main, no dogfood PR #121~130 change.

## 12. Recommended next stage
**Stage 240 — Account UX / Workspace Membership Readiness Gate** (planning/readiness — Path A). Broad
user-facing launch remains separate and must wait for account UX readiness, workspace membership policy,
the userKey → real-user transition plan, and the invite/share permission model. (Alternative Path B —
Smoke Account Cleanup Policy Gate — if Bae prefers to handle the smoke account first.)
