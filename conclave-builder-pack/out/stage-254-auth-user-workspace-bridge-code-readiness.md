# Stage 254 — Auth User Workspace Bridge Code-Readiness PR

Date: 2026-06-28 · Branch `feat/stage-254-auth-user-workspace-bridge` · PR #174 (OPEN, not merged).
**Code-readiness only — read-only bridge. No deploy / migration / production mutation. Legacy userKey preserved.**

## 1. Approval phrase observed
`"Auth user workspace bridge code readiness approved."` — present (direct). Authorizes a read-only bridge
code-readiness PR ONLY. No production deploy, D1 schema/data mutation, workspace/member row creation, project
claim, `workspace_projects` update, userKey migration, new users, sign-up/sign-in, auth rollback, env/secret
change, `AUTH_SIGNUP_MODE` change, OAuth, DNS/CORS, payment, MCP/npm publish, broad/invite/workspace launch,
or Autopilot implementation.

## 2. Branch / HEAD
- Base main `8203210`. Feature branch pushed; PR #174 opened. Report on checkpoint branch only.

## 3. Production baseline (read-only)
- `app/api/auth/ok` → 200 `{"ok":true}`; sign-up → 403 `signup_disabled`. D1: workspaces 0, workspace_members
  0, workspace_projects 3. Unchanged.

## 4. Endpoint implemented
- `GET /workspace/membership/me` (read-only). Mounted in `router.ts` via `createWorkspaceMembershipRoutes()`,
  with the shared `corsMiddleware`. First endpoint to read the Better Auth session server-side.

## 5. Response contract
- `{ ok, authenticated, authUserId, email, userKey, hasPersonalWorkspace, workspaces:[{id,name,role}],
  legacyProjectCount, bridgeMode:"read_only", canCreatePersonalWorkspace:false, canClaimProjects:false }`.
  Only safe fields; no tokens/secrets/session material. `email`/`workspaces` surfaced only when authenticated.

## 6. Auth session handling
- `createBetterAuthRuntime(c.env)` then `auth.api.getSession({ headers: c.req.raw.headers })` (verified
  `auth.api.getSession` is a function). Wrapped in try/catch → any failure (no runtime / disabled / error) →
  unauthenticated. No write side-effects.

## 7. userKey handling
- `parseUserKey(header "x-simsa-user-key", query "?userKey=")` — header preferred (keeps the key out of
  URLs/logs), query fallback for parity with the existing workspace GET convention. Plausibility guard only
  (non-empty, no whitespace, ≤200 chars). userKey is the LEGACY anonymous scope, NEVER an authenticated identity.

## 8. Workspace read behavior
- When authenticated: `SELECT id,name,role FROM workspace_members JOIN workspaces WHERE auth_user_id=? AND
  status='active'` (currently 0 rows → `[]`). When userKey present: `SELECT COUNT(*) FROM workspace_projects
  WHERE user_key=?` (legacy count). Both reads are try/catch → safe defaults. **No INSERT/UPDATE/DELETE; no
  `workspace_projects` change; no claim; no personal-workspace creation** (asserted by a static route-source guard).

## 9. Dashboard changes
- **None (deferred, documented).** The session read needs the first-party cookie; the same-origin rewrite
  covers `/api/auth/*` only, so a cross-origin `/workspace/*` call wouldn't carry the cookie. The dashboard
  client + `/account` display are deferred to a later stage that also extends the rewrite (e.g.
  `/workspace/membership/*`). This PR ships the verified central-plane endpoint only.

## 10. Docs added/updated
- `docs/workspace-membership-bridge.md`: contract, read-only-first rationale, legacy userKey compatibility,
  the dashboard/same-origin deferral, future creation/claim/invite stages, rollout gates.

## 11. Tests / build / typecheck / verify
- central-plane suite **65/65** (auth + workspace-membership + new bridge helper + route tests) · helper smoke
  **7/7** · route smoke **8/8** · dashboard build + tests **10/10** · `pnpm typecheck` **57/57** · `pnpm verify`
  green · pre-push hook verify passed.
- (Note: the route no-write guard initially matched the read-only PROSE in comments; fixed by stripping
  comments before scanning — final all green.)

## 12. Safety scan
- 6 changes (router.ts modified + 5 new), all `apps/central-plane`. No new migration, no `wrangler.toml`,
  no `.env`, no secrets, no `INSERT/UPDATE` of workspace tables in the diff. No dashboard change.

## 13. Production impact
- Zero. PR not merged/deployed. The endpoint exists only on main + the branch; the live worker (`8f0edcc`)
  does not serve it yet. Production runtime + D1 unchanged (auth 200, sign-up 403, workspace_projects 3,
  workspaces/members 0).

## 14. Rollout risks
- Same-origin cookie limitation → authenticated reads need the rewrite extension (documented; dashboard
  deferred). Future creation/claim stages carry the write risk (gated). Cross-origin call returns
  unauthenticated (safe). userKey is not trusted as identity. No claim/takeover possible (read-only).

## 15. M&A / enterprise readiness note
The runtime governance bridge starts read-only: it makes auth-user + legacy-userKey + workspace readiness
observable without any production write, keeping personal-workspace creation, project claim, invite/share, and
audit as their own gated, reversible steps. Broad launch stays blocked.

## 16. Recommended next stage
**Stage 255 — PR Merge Gate for Stage 254**, only after `"PR #174 merge approved."` Production deploy (the
bridge endpoint goes live on a central-plane Worker deploy) remains a separate, later gate — not bundled with
merge. (Flagged future option, separate approval: a "Simsa Autopilot operating model readiness" planning stage,
`"Simsa autopilot operating model readiness approved."`, to define risk tiers / auto-merge vs human-gate rules /
evidence-pack format — not started here.)
