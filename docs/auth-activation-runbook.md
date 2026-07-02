# Auth activation runbook (Better Auth → production)

Everything below is already coded and tested; production stays dormant until the
flags/secrets flip. Follow in order — each step is independently reversible.

## Current state (after this branch)

| Piece | Status |
| --- | --- |
| Better Auth runtime (`better-auth-spike.ts`) | done, gated (`AUTH_ENABLED` + secret + D1) |
| Identity schema (migration `0047`) | applied by deploy workflow (additive) |
| Membership foundation (`0048`: workspaces / members / project workspace_id) | applied (additive, legacy rows untouched) |
| Same-origin proxy (`/api/auth/*`, `/api/membership/*` → worker) | coded in dashboard `next.config` (live on next Vercel deploy) |
| Read-only bridge `GET /workspace/membership/me` | live (reports session + claimable count) |
| **Claim flow `POST /workspace/membership/claim`** | coded + tested (this branch) — creates the personal workspace, owner membership, assigns legacy projects |
| Account-page claim UI (EN/KO) | coded (this branch), renders only when signed in |
| Ownership enforcement on workspace routes | this branch (userKey must match on every project-scoped route) |

## Activation steps (production)

1. **Secret** — set the Better Auth secret on the worker (32+ random bytes).
   Use the Actions secret workflow (never local wrangler — see the CF secret
   trap memo): `BETTER_AUTH_SECRET`.
2. **Vars** — in `apps/central-plane/wrangler.toml` `[vars]`:
   - `AUTH_ENABLED = "true"`
   - `AUTH_SIGNUP_MODE = "open"` (already set by Stage 271) or `"invite"` to keep signup closed.
   - Optional topology: `BETTER_AUTH_BASE_URL` / trusted origins if the dashboard domain differs.
3. **Deploy worker** — push to main → `deploy-central-plane.yml` applies migrations + deploys.
4. **Deploy dashboard** — Vercel manual redeploy (Git not connected) so the
   `/api/auth/*` + `/api/membership/*` rewrites go live on the dashboard origin.
5. **Smoke** (5 min):
   - `GET {worker}/api/auth/get-session` → 200 `null` (was 503 before).
   - Dashboard `/account` → sign in → status shows the e-mail.
   - Claim card appears → click → `{ ok: true, claimedProjects: N }`.
   - `GET /workspace/membership/me` with the session cookie → `hasPersonalWorkspace: true`.
6. **Rollback** — set `AUTH_ENABLED` back to unset/false and redeploy the worker;
   claim data is additive (workspace_id column + rows) and harmless when dormant.

## What activation does NOT change

- The anonymous userKey flow keeps working exactly as before — signed-out users
  lose nothing. Ownership enforcement relies on the userKey capability either way.
- No route forces sign-in. The claim is opt-in from `/account`.

## Next stages after activation (not in this branch)

- Session-derived authorization on workspace routes (accept the session as an
  alternative to the raw userKey once a claim exists).
- Cross-device project list by workspace (`workspace_id`-scoped list endpoint).
- Team invites (`workspace_members` roles are already in the schema).
