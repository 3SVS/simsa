# Workspace membership bridge (Stage 254)

Status: **code-readiness, read-only.** Adds `GET /workspace/membership/me` on main — NOT yet a deployed
behaviour change of any existing route, and it creates/mutates nothing. Broad launch remains blocked.

## Purpose
The first runtime step of the governance bridge: REPORT the caller's auth-user + legacy-userKey + workspace
readiness against the (now-applied) 0048 schema, WITHOUT creating a personal workspace, a member, or claiming
any project. Read-only first; mutation lands in later, separately-gated stages.

## Endpoint contract — `GET /workspace/membership/me`
Reads (read-only): the Better Auth session (server-side, `createBetterAuthRuntime(env).api.getSession({ headers })`)
and the legacy `userKey`. Response:
```json
{
  "ok": true,
  "authenticated": false,
  "authUserId": null,
  "email": null,
  "userKey": "uk_...",            // or null
  "hasPersonalWorkspace": false,
  "workspaces": [],                // [{ id, name, role }] only when authenticated + rows exist
  "legacyProjectCount": 0,         // count of workspace_projects for the provided userKey
  "bridgeMode": "read_only",
  "canCreatePersonalWorkspace": false,
  "canClaimProjects": false
}
```
- `userKey` transport: prefer the **`x-simsa-user-key` header** (keeps the key out of URLs/logs); the
  `?userKey=` query param is accepted for parity with the existing workspace GET convention.
- Fail-safe: auth runtime unavailable / DB read failure / invalid userKey → unauthenticated, empty
  workspaces, `legacyProjectCount: 0`, never a 5xx-leak. No tokens/secrets/session material in the response.

## Read-only-first strategy (why no writes here)
- The endpoint only READS. It does NOT `INSERT` into `workspaces`/`workspace_members`, does NOT `UPDATE`
  `workspace_projects` (no `workspace_id` assignment), and does NOT migrate legacy `user_key` data. A test
  asserts the route source contains no write statements.
- `canCreatePersonalWorkspace` / `canClaimProjects` are hard-coded `false`. Those capabilities arrive in later
  gated stages so each production write has its own approval.

## Legacy userKey compatibility
- `userKey` is the LEGACY anonymous scope, **never** an authenticated identity. It is not trusted for auth and
  is not auto-linked to any auth user. Existing `user_key`-scoped workspace endpoints are unchanged.

## ★ Dashboard wiring + same-origin note (deferred)
The bridge's session read only sees a session when the request carries the first-party session cookie. Today
the same-origin Vercel rewrite covers `/api/auth/*` ONLY — the dashboard calls `/workspace/*` cross-origin
(`*.workers.dev`), which does NOT send the `app.trysimsa.com` cookie. So a dashboard call to
`/workspace/membership/me` would currently read as unauthenticated. Therefore the dashboard client + `/account`
display are **deferred to a later stage** that also extends the same-origin rewrite (e.g. `/workspace/membership/*`)
so the cookie is first-party. This PR ships the verified read-only endpoint + helper + tests only.

## Future stages (not in this PR)
- **Stage A — personal workspace creation:** an authenticated call creates a personal `workspace` + owner
  `workspace_members` row (no `workspace_projects` touch). Separately gated.
- **Stage B — explicit project claim:** authenticated, user-confirmed claim of legacy `user_key` projects into a
  personal workspace (`workspace_projects.workspace_id` set), audited. Separately gated.
- **Stage C — invite/share + roles enforcement; audit_events.**
- **Dashboard wiring + same-origin rewrite extension** for first-party membership reads.

## Production rollout gates
Deploy of this endpoint (central-plane Worker) is separate (`"…deploy approved."`). Broad user-facing launch
remains blocked until membership creation, claim, invite/share, audit, and the launch checklist land.
