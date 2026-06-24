# Stage 171 — Workspace / Team Member Model Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593`
**Type:** planning (docs-only). **No deploy, no central-plane, no migration, no auth/OAuth/session, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output, no invite/member/workspace-switch implementation.**

## 1. Goal
Define the future workspace/team/member model for Simsa collaboration and identify what
can only be built after an auth/identity decision. Planning only — no schema/migration.

## 2. Current tenancy inventory (verified)
- **Tenancy = a `user_key` column** on every workspace table (e.g.
  `apps/central-plane/src/workspace/agent-benchmark-db.ts`,
  `agent-experiment-db.ts` — `user_key` bound on insert, filtered on read).
  `userKey` is **client-supplied** (`getUserKey()` in the dashboard).
- **Migrations** are sequential SQL in `apps/central-plane/migrations/` (latest **0046**);
  `workspace_*` tables (0027~0046) are all `user_key`-scoped.
- **No `User` table, no `workspace_members`, no `invitations`, no roles.** (`role`
  matches in the codebase are agent-roles / unrelated, not member roles.)

## 3. Current gaps
- No real workspace/team **entity** — `userKey` is a browser-scoped tenant surrogate.
- No **membership** (a workspace is one key, not many users).
- No **roles / permission checks** (any holder of a `userKey` has full access to its rows).
- No **invite / remove teammate**, no **share**, no **ownership transfer**.
- Delete/archive (workflow records, Stage 118) is `userKey`-scoped, not member-aware.

## 4. Current-state answers
1. `userKey` is the tenant boundary on all `workspace_*` tables + dashboard `getUserKey()`.
2. No ownership model beyond `user_key` equality.
3. Yes — projects/workflow records/benchmarks/experiments are **userKey-only** scoped.
4. No role/permission check exists.
5. No invite/membership concept.
6. Delete/archive flows are `userKey`-scoped (not membership-checked).
7. **Impacted central-plane routes by real workspace identity:** all
   `workspace/*` routes (agent-workflows, benchmarks, experiments, evolution packs,
   pr-reviews/comments, credits, notifications, usage) — each currently keys on
   `user_key` and would need a `workspace_id` + membership/role check.

## 5. Future entity model
| Entity | Purpose | Key fields | Ownership boundary | Lifecycle | Privacy/security |
|--------|---------|-----------|--------------------|-----------|------------------|
| **User** | real identity | id, email(verified), name, avatar, locale | self | created on first auth | email verified; no tokens in client |
| **Workspace** | team container | id, name, slug, ownerUserId, defaultLocale, timestamps, archivedAt? | owner | create/rename/archive | slug uniqueness; owner-gated destructive |
| **WorkspaceMember** | membership+role | workspaceId, userId, role, status, joinedAt, invitedBy | workspace | invite→active→removed | role change owner/admin only |
| **Invitation** | pending invite | id, workspaceId, email, role, tokenHash, expiresAt, acceptedAt, revokedAt, invitedBy | workspace | create→accept/revoke/expire | **store tokenHash only**; rate-limit |
| **Project** | existing | + workspaceId (new) | workspace | create/archive/delete | migrate from userKey scope |
| **ProjectAccess** | per-project override | projectId, userId/role | workspace+project | optional | defaults to workspace role |
| **ShareLink** | external/link share | id, projectId, scope, tokenHash, expiresAt, revokedAt | project | create/revoke/expire | **tokenHash only**; least scope |
| **IntegrationAccount** | GitHub/Vercel conn | id, workspaceId, provider, externalId, scopes, status | workspace | connect/disconnect | tokens **server-side only**, encrypted |
| **ActivityEvent** | audit log | id, workspaceId, actorUserId, type, target, at | workspace | append-only | no secrets in payload |

## 6. Workspace model
```
Workspace { id, name, slug, ownerUserId, defaultLocale, createdAt, updatedAt, archivedAt? }
```
One owner; archive (soft) before hard delete; `defaultLocale` seeds member UI language.

## 7. Membership model
```
WorkspaceMember { workspaceId, userId, role, status, joinedAt, invitedBy }
```
`status` ∈ invited|active|suspended|removed. Composite key (workspaceId,userId). Role
changes restricted to Owner/Admin; an Owner cannot be removed without ownership transfer.

## 8. Invitation model
```
Invitation { id, workspaceId, email, role, tokenHash, expiresAt, acceptedAt, revokedAt, invitedBy }
```
**Security:** never store the raw token after creation (hash only); invite email needs
anti-abuse/rate-limit; expiry required; role on invite cannot exceed inviter's authority;
role escalation Owner/Admin only.

## 9. Role and permission model
Roles: **Owner · Admin · Editor · Reviewer · Viewer.**
- **Owner:** full control, ownership transfer, delete/archive workspace, (later) billing.
- **Admin:** manage members/integrations/projects (no ownership transfer).
- **Editor:** create/edit projects + acceptance artifacts.
- **Reviewer:** comment/review/export; no source/settings changes.
- **Viewer:** read-only.

| Action | Owner | Admin | Editor | Reviewer | Viewer |
|--------|:----:|:----:|:----:|:----:|:----:|
| Create project | ✓ | ✓ | ✓ | | |
| Edit project | ✓ | ✓ | ✓ | | |
| Generate previews | ✓ | ✓ | ✓ | | |
| Review/comment | ✓ | ✓ | ✓ | ✓ | |
| Export | ✓ | ✓ | ✓ | ✓ | ✓ |
| Import | ✓ | ✓ | ✓ | | |
| Invite teammate | ✓ | ✓ | | | |
| Remove teammate | ✓ | ✓ | | | |
| Change roles | ✓ | ✓ | | | |
| Connect GitHub | ✓ | ✓ | | | |
| Connect Vercel | ✓ | ✓ | | | |
| Delete/archive project | ✓ | ✓ | | | |
| Delete/archive workspace | ✓ | | | | |
| Transfer ownership | ✓ | | | | |

## 10. Route / UX planning (future — not implemented)
`/workspace`, `/workspace/members`, `/workspace/invitations`, `/workspace/integrations`,
`/workspace/settings`, `/projects/[id]/share`, `/projects/[id]/settings/access`. **Now:**
`/account` continues to show "Team workspace planned / Invite teammates planned /
Requires sign-in" (Stage 170).

## 11. Migration strategy (concept — do not run)
- **Phase 0** current `userKey`/browser-scoped (today).
- **Phase 1** introduce `User` + `Workspace` behind a feature flag.
- **Phase 2** map existing `user_key` records to a default workspace per key.
- **Phase 3** add `WorkspaceMember` + role checks on `workspace/*` routes.
- **Phase 4** add Invitations + ShareLinks.
- **Phase 5** move IntegrationAccount ownership to workspace.
Each phase = its own approval-gated migration (0047+), additive first, with a backfill that
maps `user_key` → default workspace before any read path switches to `workspace_id`.

## 12. Auth / identity dependencies
**Workspace/team implementation must not proceed until an auth/identity architecture is
selected.** Decisions needed (not made here): user-id source, email verification, session
middleware, workspace selection/switching, invitation acceptance flow, OAuth account
linking. (GitHub OAuth already exists for repo access but is not a *login* identity.) No
provider chosen here.

## 13. Security and abuse risks
- Invitation/share tokens: **hash-at-rest**, expiry, revoke, rate-limit, least scope.
- Role escalation: Owner/Admin only; Owner protected (transfer before removal).
- Backfill correctness: a wrong `user_key`→workspace map could cross-tenant leak — backfill
  must be verified before switching read paths.
- Integration tokens stay **server-side/encrypted** (as GitHub does today); never client.
- Honest positioning: do not market "secure team workspace" until membership + auth exist.

## 14. Non-goals
No auth/OAuth/session, no user/member/invitation tables or migration, no invite/remove,
no workspace switching, no role enforcement, no share links, no billing (payment **TBD**,
Korea-compatible first, no Stripe). No code in this stage.

## 15. Suggested implementation phases (post-auth)
Auth/Identity decision → Phase 1 (User+Workspace flag) → Phase 2 (backfill) →
Phase 3 (members+roles) → Phase 4 (invites/share) → Phase 5 (integration ownership).
Within this train, the remaining stages stay **planning**: 172 Share/Invite/Permission UX,
173 Export/Import, 174 GitHub/Vercel Integration UX + safety, then checkpoint.

## 16. Stage 171 decision — **Option A: Workspace/team model plan ready**
The entity/role/migration/auth-dependency model is defined. **An auth/identity decision is
required before any implementation.** Verified: today is `userKey` tenant-scoping with no
User/members/roles. Proceed to Stage 172 (Share/Invite/Permission UX planning), keeping
implementation gated on the auth decision.

## 17. Recommended next stage
**Stage 172 — Share / Invite / Permission UX Planning.** **Do not merge** the train PR
until the foundation checkpoint + Bae approval.
