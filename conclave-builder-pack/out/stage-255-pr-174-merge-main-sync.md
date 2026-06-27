# Stage 255 — PR #174 Merge Gate / Main Sync / Post-Merge Verification

**Date:** 2026-06-27
**Decision:** **Option A — PR #174 merged; read-only auth workspace bridge on main with no live impact.**

---

## 1. Approval phrase observed

> "PR #174 merge approved."

Scope confirmed: this approval authorizes **merging PR #174 into main only**. It does NOT authorize
central-plane/Vercel deploy, production D1 schema/data mutation, migration apply, workspace/member
row creation, project claim, legacy userKey migration, workspace_projects update, destructive
cleanup, smoke account deletion, additional production users, production sign-up/sign-in, auth
rollback, env/secret changes, AUTH_SIGNUP_MODE changes, OAuth, DNS/domain/CORS, payment/billing,
MCP/npm publish, broad/invite/share launch, workspace membership product launch, or Simsa Autopilot
implementation. None of these were performed.

## 2. PR #174 status before merge

- number: 174 — "Stage 254 — Auth user workspace bridge (read-only) code readiness"
- state: OPEN · isDraft: false
- base: `main` · head branch: `feat/stage-254-auth-user-workspace-bridge`
- head OID: `36f420ce960090317b59d66efa1283eb2fc7e6dd` (== Stage 254 report)
- mergeable: **MERGEABLE** · mergeStateStatus: **CLEAN**
- CI checks: `typecheck-build (20)` **pass** · `typecheck-build (22)` **pass** — no pending/failed/cancelled required checks

## 3. Final diff summary (PR head vs main `8203210`)

6 files, **additive only — 370 insertions, 0 deletions**:

| file | lines | nature |
| --- | --- | --- |
| `apps/central-plane/docs/workspace-membership-bridge.md` | +63 | docs (bridge strategy) |
| `apps/central-plane/src/router.ts` | +3 | route mount |
| `apps/central-plane/src/routes/workspace-membership.ts` | +95 | read-only route |
| `apps/central-plane/src/workspace-membership-bridge.ts` | +75 | pure response builder |
| `apps/central-plane/test/workspace-membership-bridge.test.mjs` | +59 | helper tests |
| `apps/central-plane/test/workspace-membership-route.test.mjs` | +75 | route no-write tests |

No dashboard changes · no new migration · no `wrangler.toml` change · no deployment-workflow change ·
no `.env` change · no auth-activation/sign-up-policy change · no AUTH_SIGNUP_MODE behavior change ·
no changes to dogfood PR #121–130. Diff matches the Stage 254 report exactly → not Option B.

## 4. Endpoint / response contract review

`GET /workspace/membership/me` (mounted in `router.ts` after the agent-workflow routes, shared
`corsMiddleware`). Response contract (`buildMembershipResponse`):

```
{ ok:true, authenticated, authUserId, email, userKey,
  hasPersonalWorkspace, workspaces:[{id,name,role}], legacyProjectCount,
  bridgeMode:"read_only", canCreatePersonalWorkspace:false, canClaimProjects:false }
```

- `authenticated:false` when no valid session; `authenticated:true` only with a valid Better Auth session.
- `workspaces` surfaced **only** when authenticated; empty array when no rows.
- `email`/`workspaces` omitted (null/[]) for unauthenticated callers.
- `legacyProjectCount` is a read-only COUNT for the provided userKey.
- `canCreatePersonalWorkspace` / `canClaimProjects` hard-coded `false`.

## 5. Read-only guarantee review

Route source contains **only** `SELECT` statements:
- `SELECT … FROM workspace_members JOIN workspaces … WHERE auth_user_id=? AND status='active'`
- `SELECT COUNT(*) FROM workspace_projects WHERE user_key=?`

No INSERT / UPDATE / DELETE / DROP / ALTER / `.run(` anywhere. A static test
(`workspace-membership-route.test.mjs`) strips comments and asserts the absence of write statements
in the route source. Never creates a workspace, member, or claim; never updates workspace_projects;
never migrates legacy userKey; never returns session/provider tokens; no email-based auto-link; no
cross-device auto-merge. Both DB lookups are wrapped in try/catch → safe defaults (`[]`, `0`).

## 6. userKey / auth session handling review

- **Session:** `createBetterAuthRuntime(c.env).api.getSession({ headers: c.req.raw.headers })`,
  wrapped in try/catch → failure yields unauthenticated (`authUserId=null`), no side effects.
- **userKey:** `parseUserKey(header "x-simsa-user-key" preferred, ?userKey= fallback)` with a
  plausibility guard (non-empty, single token, ≤200 chars, no whitespace). **userKey is the legacy
  anonymous scope, never an authenticated identity** — documented in code and docs.

## 7. Pre-merge verification results (PR head `36f420c`)

- central-plane build: **OK** (tsc clean)
- membership + bridge tests: **19/19**
- auth suite (better-auth-d1, better-auth-spike, auth-spike-route, auth-migration-draft, auth-route-gated-wiring, auth-topology): **42/42**
- helper smoke `smoke:better-auth-d1`: **7/7**
- route smoke `smoke:auth-route-d1`: **8/8**
- dashboard build: **OK** · dashboard auth tests (auth-client, auth-rewrite): **10/10**
- `pnpm typecheck`: **57/57** · `pnpm verify`: **green**

## 8. Merge result

Squash-merged via `gh pr merge 174 --squash`.
- squash title: "Stage 254 — Auth user workspace bridge code readiness"
- state: **MERGED** · mergedAt: 2026-06-27T15:44:28Z
- merge commit on main: **`7dad790`** (`7dad7904d24efdaab9bf774cd245ee76e232a4ac`)

## 9. Main HEAD after merge

- `git checkout main` + `git pull --ff-only` → HEAD `7dad790`
- HEAD == origin/main (`7dad7904…`) · worktree clean

## 10. Changed files confirmed on main

Merge commit `7dad790` contains exactly the 6 additive files from §3 (370 insertions). Verified
`git diff 8203210 7dad790 -- migrations/` is **empty** (no migration) and `-- apps/dashboard/` is
**empty** (no dashboard change). Route mount present at `router.ts:156`; endpoint code, bridge helper,
and `docs/workspace-membership-bridge.md` all present on main.

## 11. Post-merge verification results (main `7dad790`)

- central-plane build: **OK**
- membership + bridge tests: **19/19**
- auth suite: **42/42**
- helper smoke: **7/7** · route smoke: **8/8**
- dashboard build: **OK** · dashboard auth tests: **10/10**
- `pnpm typecheck`: **57/57** · `pnpm verify`: **green**

Confirmed on main: `GET /workspace/membership/me` code exists, route mounted, response contract
documented, no migration added, no dashboard change added, no write behavior added, docs exist,
tests exist, no deploy/migration-apply occurred.

## 12. Live production impact confirmation

Production is **unchanged** by the merge (merge ≠ deploy):

- `app.trysimsa.com/account` → **200**
- `app.trysimsa.com/api/auth/ok` → **200** `{"ok":true}`
- `app.trysimsa.com/api/auth/sign-up/email` (POST) → **403** `{"error":"signup_disabled"}`
- Worker `/health` → **200**, version **0.13.15** (unchanged before and after merge)
- `conclave-ai.seunghunbae.workers.dev/workspace/membership/me` → **404 not found** — the new
  endpoint is NOT live (not deployed), exactly as expected.

D1 read-only baseline (rows_written 0, changed_db false), identical before and after merge:
workspaces **0** · workspace_members **0** · workspace_projects **3** · workspace_id NULL **3/3** ·
user_key present **3/3** · user **1** · account **1** · session **1** · verification **0**.

## 13. Production deploy status

**No deploy occurred.** central-plane Worker remains version 0.13.15 (no `wrangler deploy`); dashboard
unchanged (no `vercel deploy`). The merge to main did not trigger a deploy — `deploy-central-plane.yml`
is `workflow_dispatch`-gated, not push-triggered. The bridge endpoint requires a separate,
separately-approved deploy stage to go live.

## 14. M&A / enterprise readiness note

The read-only bridge is now the first runtime layer on main that joins **Better Auth session +
legacy userKey visibility → read-only workspace readiness**. It establishes the seam for the future,
explicitly-gated progression: controlled personal-workspace creation → explicit project claim →
invite/share → audit. By landing it strictly read-only (no writes, no migration, no claim, no deploy),
the merge carries zero data/identity risk while making the membership contract reviewable and
diligence-ready on main.

## 15. Rollback note

Pure additive merge with **no live effect** — nothing to roll back operationally. If reversal is
ever required: `git revert 7dad790` removes the 6 files (the endpoint is not deployed, so no runtime
state depends on it). No production state, D1 schema, or D1 data was touched; auth activation and
sign-up policy are unchanged.

## 16. Explicit non-actions

Did **not**: deploy (wrangler/vercel) · apply migrations · `wrangler d1 execute --remote` with any
schema/data mutation · INSERT/UPDATE/DELETE/DROP/ALTER on production · create workspace/member rows ·
claim projects · migrate legacy userKey · update workspace_projects · destructive cleanup · delete
the smoke account · create production users · perform production sign-up/sign-in · roll back auth ·
change env/secrets · change AUTH_SIGNUP_MODE · change AUTH_ENABLED · OAuth setup · DNS/domain/CORS
changes · payment/billing · MCP/npm publish · broad/invite/share/membership-product launch · Simsa
Autopilot implementation. Dogfood PRs #121–130 untouched. All D1 access was read-only SELECT/COUNT.

## 17. Recommended next stage

**Stage 256 — Auth Workspace Bridge Deploy Readiness Gate.**
Suggested approval phrase: "Auth workspace bridge deploy readiness approved."
Production deploy stays a separate gate: "Auth workspace bridge production deploy approved."

Planning-only follow-up (after Stage 256 or before Stage 257):
**Stage 256A — Simsa Autopilot Operating Model Readiness.**
Suggested approval phrase: "Simsa autopilot operating model readiness approved."
(risk tiers · auto-merge policy · always-approval changes · Claude/Codex handoff · evidence-pack
format · Telegram/Slack decision-prompt format · GitHub labels/status checks · production gate
separation.)
