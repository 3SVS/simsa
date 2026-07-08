> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 194 — Better Auth Minimal Implementation Plan

**Date:** 2026-06-25
**Branch:** `docs/stage-192-better-auth-proofread` (auth train, continues 192/193) · **Base / main:** `d869560` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** implementation **planning** / docs only. **No auth implementation, no Better Auth install, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

> **Better Auth implementation is NOT approved.** This is a blueprint for the **first identity-only
> slice**. Workspaces-as-truth, roles, invitations, Plan-Map approvals, integration ownership, and
> the audit ledger remain **future phases**. **Migration, auth implementation, and deploy each
> require separate Bae approval.** Package versions / D1 wiring are flagged **[verify]** —
> re-confirm at implementation time; nothing is installed here.

## 1. Executive summary
Plans only the **minimal future first slice**: **identity-only behind a feature flag**, oriented
to **central-plane / Hono / Workers / D1**. No workspace role enforcement, no team invite, no
Plan-Map approval audit, no IntegrationAccount migration, no production rollout, no production
migration execution. Architecture frozen in Stage 193 (Better Auth primary, WorkOS fallback,
Simsa-owned collaboration).

## 2. Implementation scope
**Included in this plan (not execution):** Better Auth package/version proposal · central-plane
auth runtime plan · D1-backed identity tables · local-only auth route plan · session-verification
plan · feature-flag plan · local test plan · rollback plan · env-var plan (no values).
**Explicitly excluded:** production deploy · workspace role enforcement · invitations · share links
· Plan-Map gate approval · `ActivityEvent` audit ledger · `IntegrationAccount` ownership migration
· GitHub/Vercel connected-account ownership · payment/billing · Kakao/Naver social in MVP · Better
Auth **organization plugin as workspace source of truth**.

## 3. Package / version proposal
- **Core:** **`better-auth`** (current major line **1.5.x**; **[verify exact version + changelog +
  #4203/#10021 status at install time]**, pin exactly).
- **DB adapter:** **native Cloudflare D1** (first-class) or the **built-in Kysely adapter** (SQLite/
  D1) — **no Drizzle required** for MVP. The community **`better-auth-cloudflare`** (npm, ~v0.3.0)
  + `@better-auth-cloudflare/cli` are **optional** provisioning/scaffolding helpers — **evaluate,
  not required**; prefer minimal first-party deps. **[verify which D1 path is least-dep at impl]**.
- **Hono integration:** **no separate package** — mount `auth.handler(c.req.raw)` on a Hono route
  (Stage 192 verified).
- **Package-manager constraints:** repo is **pnpm + Turbo, ESM-only, Node ≥20**; add `better-auth`
  to **`apps/central-plane`** only (not the dashboard) for the first slice. **Do not install now.**

## 4. Runtime location plan
- **Primary:** auth runs in **central-plane (Hono on Workers + D1)** — co-located with `workspace_*`
  data + the existing encrypted-token store (`crypto.ts`).
- **Dashboard** consumes auth/session state; **not** the identity source of truth. **`userKey`**
  remains the **legacy fallback** during transition.
- **Route shape (planning only):** central-plane `**/api/auth/***` (Better Auth handler). Local dev:
  central-plane local URL; dashboard local URL calls it with **`credentials: "include"`**.
- **CORS/CSRF:** dashboard↔central-plane is **cross-origin** → needs `hono/cors` with
  `credentials: true` + an **explicit trusted-origin allowlist**; CSRF per Better Auth defaults.
- **Cross-domain/cookie strategy** (e.g. `crossSubDomainCookies`, cookie domain for
  `app.trysimsa.com` ⇄ the central-plane host) **needs approval + [verify]** — gated.

## 5. D1 / schema plan (conceptual — no migration files)
**Better Auth-owned identity (first slice):**
| Table | Key columns | Indexes | Owner | First slice? |
|---|---|---|---|---|
| `user` | id, name, email, emailVerified, image, createdAt, updatedAt | unique(email) | Better Auth | **Yes** |
| `session` | id, userId, token, expiresAt, ipAddress?, userAgent?, timestamps | index(userId), unique(token) | Better Auth | **Yes** |
| `account` | id, userId, accountId, providerId, accessToken?(enc), refreshToken?(enc), scope, idToken?, password?, timestamps | index(userId), unique(providerId,accountId) | Better Auth | **Yes** (email/password first) |
| `verification` | id, identifier, value, expiresAt, timestamps | index(identifier) | Better Auth | **Yes** |

**Simsa-owned minimal:**
| Table | Key columns | Indexes | Owner | First slice? |
|---|---|---|---|---|
| `workspace` | id, name, slug, ownerUserId, defaultLocale, timestamps, archivedAt? | unique(slug) | Simsa | **Optional in slice / next** |
| `workspace_member` | workspaceId, userId, role, status, joinedAt, invitedByUserId | PK(workspaceId,userId), index(userId) | Simsa | **Optional in slice / next** |
| `simsa_user` *(only if separate)* | id, betterAuthUserId, … | unique(betterAuthUserId) | Simsa | only if **not unified** (§16 open) |
| `project.workspace_id` backfill | — | index(workspace_id) | Simsa | **Later** (not first identity-only route unless explicitly approved) |

**Later tables:** `invitation` · `project_access` · `share_link` · `integration_account` ·
`gate_decision` · `activity_event` · `roadmap_event`. **No migration files created here.** Each
group: purpose/columns/indexes/owner/phase/rollback per Stage 189.

## 6. Migration plan draft (additive — do NOT create files now)
- **Next available number = `0047`** (verified: latest on main is `0046_workspace_agent_workflow_records.sql`).
- **`0047_auth_identity_tables.sql`** *(or as emitted by Better Auth's schema generator —
  **[verify D1 output]**)*: `user` / `session` / `account` / `verification`.
- **`0048_workspace_min.sql`** *(optional/next)*: `workspace` / `workspace_member`.
- **No destructive changes** · **keep `userKey` columns** · **no project-access behavior change** in
  the first migration · **feature flag disabled by default** · **local D1 migration test (wrangler
  local) before any production migration** · **production migration requires explicit Bae approval**.
- **Rollback:** no destructive change; keep the old `userKey` read path; disable the auth flag;
  **never auto-delete identity rows**.

## 7. Feature flag plan
- Flags (names TBD, **no values set**): e.g. **`AUTH_ENABLED`** (master), **`AUTH_PROVIDER`**
  (`better-auth`), optionally **`AUTH_MODE`**.
- **Local-only default** (enabled in dev for testing); **production disabled until deploy approval**.
- The dashboard UI **must not imply auth** until the flag is on; **`/account` stays the local stub**
  until the auth UI is explicitly rolled out.

## 8. Environment variable plan (categories only — NO values, NO .env change)
- **Better Auth secret** category (server-side signing/encryption secret).
- **Base URL / trusted origin** category (central-plane base URL; dashboard origin allowlist).
- **OAuth provider client id/secret** category — **later** (GitHub-login / Kakao / Naver).
- **Cookie domain / SameSite** related settings.
- **Integration-token encryption key** — **later** (reuse/extend `crypto.ts` approach).
- **Feature-flag** variables (§7).
**Do not print/request actual values; do not modify any `.env` or production env.**

## 9. Local development plan
- **Local D1** via wrangler (central-plane already uses D1). Commands (**[verify exact]**):
  `wrangler d1 migrations apply <db> --local`, `wrangler dev` for central-plane.
- **Dashboard local URL** (Next dev) calls **central-plane local URL** `/api/auth/*` with
  `credentials: "include"`.
- **Flow to test locally:** account creation (email/password first) → login → session persistence →
  logout. **Email verification:** MVP can use **email/password**; email-link/passwordless is
  **[verify which Better Auth flow]** and may defer real email sending (log link in dev).
- **No production credentials**; dev secrets are local-only and never printed.

## 10. Test plan (for the future implementation)
Unit tests for auth **config helpers** (pure) · session-verification tests · **D1 schema migration
smoke test (local)** · login/logout local-flow test · **disabled-flag behavior** test (auth off →
no auth surface) · **`userKey` fallback** test (legacy path still works) · `/account` copy test ·
**no-token-output** test · **no production auth when disabled** · `pnpm typecheck` + `pnpm build`.
Mock at the seam (inject D1/fetch) per repo convention; `node --test`, no Jest/Vitest.

## 11. Security plan
Cookie **httpOnly + secure + SameSite + domain** **[verify defaults]** · session
**expiration/`updateAge`/`freshAge`** · **CSRF/CORS** (trusted-origin allowlist, credentials both
ends) · **callback URL allowlist** · provider-account **token storage encrypted** (extend
`crypto.ts`) · **no token output** · **rate limiting** · **abuse prevention** · account
deletion/export **later** · audit log **later**. Avoid the **#4203/#10021** logout class: **DB-
backed D1 sessions, no `cookieCache` + KV combo**.

## 12. Dashboard UX plan (future — do NOT implement)
- `/account` can show a **"sign-in required"** state **when the auth flag is enabled**; the **local
  preference stub remains the fallback** until then.
- Plan Map may later show **"Auth architecture selected"** — **not** "approval audit enabled" until
  `gate_decision` ships.
- **No team/invite/share UI** until workspace/member implementation; **no connected-account
  management UI** until `integration_account` ownership exists. **Honest copy only.**

## 13. First implementation approval checklist (Bae must approve before Stage 195+ impl)
- [ ] Better Auth **package/version** approved (pinned).
- [ ] **Migration file plan** approved (`0047+`, additive, flag-off).
- [ ] **Env-var names** approved (no values in chat).
- [ ] **Feature-flag plan** approved.
- [ ] **Runtime location** approved (central-plane/Workers/D1).
- [ ] **Local dev plan** approved.
- [ ] **Rollback plan** approved.
- [ ] **Security checklist** accepted.
- [ ] **No production deploy** until a separate deploy approval.

## 14. Risk register
| Risk | Classification | Mitigation |
|---|---|---|
| D1/Hono integration mismatch | **Caution** | verify native-D1 vs Kysely vs community pkg in a local spike |
| Cookie domain / cross-host issues (Vercel ⇄ Workers) | **Caution** | `crossSubDomainCookies`/domain plan + [verify]; approval-gated |
| CORS/CSRF issues | **Caution** | trusted-origin allowlist, credentials both ends |
| Better Auth version drift (#4203/#10021) | **Watch** | pin version; DB-backed sessions; recheck issue status |
| Migration numbering conflict | **Mitigated** | next number verified = `0047` |
| `userKey` backfill ambiguity | **Caution** | dual-read, audit unmatched, no destructive merge |
| Local vs production origin mismatch | **Watch** | explicit origin allowlists per env |
| Accidental auth-UI claims before enabled | **Caution** | flag-gated UI; honest copy; tests |
| Token leakage | **Caution** (no blocker) | server-side encrypted, never printed; no-token-output test |
| Premature workspace role enforcement | **Mitigated** | excluded from first slice |
No **blocker** in the register; all caution/watch/mitigated.

## 15. WorkOS fallback preservation
- **Keep the Simsa-owned collaboration layer** (don't make a provider the workspace source of truth).
- **Avoid provider-specific workspace truth in MVP** (org plugin deferred).
- Later switch path: **map provider user IDs → Simsa `user`/`workspace`**.
- **Keep `gate_decision`/`activity_event` Simsa-owned.**
- **Do not hardwire** the Better Auth org plugin into core project ownership.

## 16. Recommended next stage
**Default: Stage 195 — Auth Proof-read PR Prep / Push / Review Gate** (bundle Stage 192+193+194
docs into one PR against `main`; no implementation). Alternatively, **Stage 195 — Better Auth Local
Spike Approval Gate** only if Bae wants to move toward a **local-only** implementation spike. **No
implementation recommended yet.**

## 17. Now-safe vs gated
- **Now-safe:** implementation plan doc · migration plan draft · env-var categories (no values) ·
  test plan · rollback plan · PR prep.
- **Requires Bae auth-implementation approval:** installing Better Auth · route handlers · session
  middleware · auth config · login/logout logic.
- **Requires Bae migration approval:** adding SQL migration files · running local D1 migrations ·
  running production D1 migrations · backfilling `userKey` projects.
- **Requires Bae deploy approval:** production auth routes · production session cookies · production
  env vars · workspace-aware reads.
- **Requires security review:** cookies · sessions · OAuth callbacks · env-var handling · token
  storage · CORS/CSRF · rate limits.

## 18. Stage 194 decision — **Implementation blueprint ready (not approved for execution)**
The minimal identity-only first slice is fully planned: package/version proposal (`better-auth`
1.5.x **[verify]**, native-D1/Kysely, no Drizzle), central-plane/Workers/D1 runtime, D1 identity
schema, additive `0047+` migration draft, feature-flag + env-var (no values) + local-dev + test +
security + rollback plans, an approval checklist, a risk register (no blocker), and WorkOS-fallback
preservation. **No code, no install, no migration, no deploy.** Execution stays gated on Bae's
auth → migration → deploy approvals.

## 19. Out-of-scope confirmation
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane deploy · no migration
· no MCP publish · no npm publish · no auth/OAuth · no Better Auth install · no token/secret · no
domain/DNS · no server write · no DB persistence · no live-dashboard change · dogfood PRs #121~130
untouched.

## Sources (current)
- Better Auth (core, 1.5): https://better-auth.com/ · https://better-auth.com/blog/1-5
- Better Auth DB/schema: https://www.better-auth.com/docs/concepts/database
- Hono integration: https://www.better-auth.com/docs/integrations/hono
- Cloudflare D1 (community pkg + example): https://www.npmjs.com/package/better-auth-cloudflare · https://hono.dev/examples/better-auth-on-cloudflare
- Issue #4203 / #10021: https://github.com/better-auth/better-auth/issues/4203 · https://github.com/better-auth/better-auth/issues/10021
