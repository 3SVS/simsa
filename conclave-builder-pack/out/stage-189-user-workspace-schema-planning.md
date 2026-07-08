> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 189 — User + Workspace Schema Planning (Better Auth primary)

**Date:** 2026-06-25
**Branch:** `docs/stage-187-188-auth-identity-selection` (auth train, continues 187/188) · **Base / deployed main:** `9b645af` · live: https://app.trysimsa.com
**Type:** schema planning / docs only. **No auth implementation, no Better Auth/SDK install, no login routes, no session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no token/secret request-print-store, no env-var change, no live-dashboard change.**

> Backend = **Hono on Cloudflare Workers + D1 (SQLite-at-edge)**; migrations are sequential SQL
> (latest ~0046). All new tables below are **conceptual** and **additive** (`0047+`). Better
> Auth-specific column/table shapes are marked **[verify before implementation]** against current
> Better Auth docs.

## 1. Executive summary
**Better Auth is the primary planning assumption** (native D1 + Hono + Workers, organization
plugin, native Kakao/Naver — Stage 188). **WorkOS AuthKit stays a fallback** comparison. **No
implementation, no install, no migration in this stage.** Real collaboration stays **blocked**
until auth + migration + deploy approvals (separate Bae gates). The schema is designed
**portable**: Simsa **owns** Workspace / WorkspaceMember / Invitation / GateDecision /
ActivityEvent so a later swap (Better Auth ⇄ WorkOS) touches mostly the identity layer.

## 2. Current state
`userKey` = client-supplied tenant surrogate on every `workspace_*` table · `/account` =
local/browser stub · Plan Map gates = read-only · **no** real user identity / workspace
ownership / member roles / approval audit · GitHub/Vercel = integrations, **not** login identity.

## 3. Schema design goals
Stable identity mapping · workspace ownership · member roles · project ownership · project-access
enforcement · invite lifecycle · integration ownership · approval-gate attribution · activity/
audit trail · export scoping · **Better Auth compatibility** · **WorkOS-fallback portability**
where feasible.

## 4. Proposed tables / entities (conceptual — SQLite/D1, additive)
> Convention: `id` = text UUID; timestamps = ISO text or epoch int; FKs reference the identity
> `user.id`. "Owner" = who controls the row.

### Identity layer — **Better Auth-owned in our D1** *(exact shapes [verify])*
| Table | Purpose | Key fields | Owner | Indexes | Lifecycle | Security | MVP? |
|---|---|---|---|---|---|---|---|
| `user` | real identity | id, email, emailVerified, name, image, locale?, createdAt | self | unique(email) | created on first auth | email verified; no secrets | **MVP** |
| `session` | login session | id, userId, token, expiresAt, ipAddress, userAgent | user | index(userId), unique(token) | create→expire/revoke | httpOnly/secure cookie; rotate | **MVP** |
| `account` | provider/credential acct | id, userId, providerId, accountId, accessToken**(enc)**, refreshToken**(enc)**, scope, idToken | user | index(userId), unique(providerId,accountId) | link/unlink | **tokens encrypted server-side**, never exported | **MVP** |
| `verification` | email/OTP tokens | id, identifier, value(hash), expiresAt | system | index(identifier) | create→consume/expire | hash-at-rest, short TTL | **MVP** |

### Collaboration layer — **Simsa-owned** (portable across providers)
| Table | Purpose | Key fields | Owner | Indexes | Lifecycle | Security | MVP? |
|---|---|---|---|---|---|---|---|
| `workspace` | team container | id, name, slug, ownerUserId, defaultLocale, createdAt, updatedAt, archivedAt? | owner | unique(slug) | create/rename/archive | owner-gated destructive | **MVP** |
| `workspace_member` | membership+role | workspaceId, userId, role, status, joinedAt, invitedByUserId | workspace | **PK(workspaceId,userId)**, index(userId) | invite→active→removed | role change Owner/Admin only; Owner protected | **MVP** |
| `invitation` | pending invite | id, workspaceId, email, role, tokenHash, status, expiresAt, acceptedAt, revokedAt, invitedByUserId | workspace | index(workspaceId), index(email) | create→accept/revoke/expire | **tokenHash only**, rate-limit, role ≤ inviter | Later |
| `project` | existing + scope | …existing… **+ workspaceId**, ownerUserId? | workspace | index(workspaceId) | backfill from userKey | dual-read during cutover | **MVP (backfill)** |
| `project_access` | per-project override | projectId, userId, role | workspace+project | **PK(projectId,userId)** | optional | defaults to workspace role | Later |
| `share_link` | external link share | id, projectId, scope, tokenHash, expiresAt, revokedAt, createdByUserId, lastAccessedAt | project | index(projectId) | create→revoke/expire | **tokenHash only**, least scope, access log | Later |
| `integration_account` | GitHub/Vercel conn | id, workspaceId, provider, externalId, scopes, status, **encryptedToken**, connectedByUserId, createdAt | workspace | index(workspaceId,provider) | connect/disconnect | **server-side encrypted**, never exported/printed | Later (migrate existing GitHub tokens) |
| `gate_decision` | approval ledger | id, workspaceId, projectId?, gateType, targetRef, state, decidedByUserId, reason, createdAt, expiresAt? | workspace | index(workspaceId), index(projectId) | pending→approved/rejected/expired/superseded | attributes Plan-Map gates | Later |
| `activity_event` | audit log | id, workspaceId, actorUserId, type, target, metadata(**no secrets**), createdAt | workspace | index(workspaceId,createdAt) | append-only | retention policy; no secrets in payload | Later |
| `roadmap_event` *(opt)* | Plan-Map history | id, projectId, kind, actorUserId, createdAt | project | index(projectId,createdAt) | append-only | persists the now-generated map | Later |

## 5. Better Auth mapping
- **Better Auth `user` → Simsa `User`** (Better Auth owns the table in our D1; Simsa may add a
  `locale` column). **[verify Better Auth user columns]**
- **Better Auth `session` → Simsa session context** (request → userId; workspace context resolved
  by Simsa from `workspace_member`). **[verify session/cookie model on `app.trysimsa.com`]**
- **Better Auth `account` → provider/credential accounts** (GitHub-login, Kakao/Naver later,
  email/password) — **distinct from** `integration_account` (repo/deploy access). **[verify]**
- **Better Auth organization plugin** *(optional)* → could supply `organization`/`member`/
  `invitation`. **Recommendation: do NOT outsource these — keep Simsa-owned `workspace`/
  `workspace_member`/`invitation`** for (a) WorkOS portability and (b) full audit/control. Using
  the org plugin is an **open question (§14)**; if adopted, treat its tables as Simsa-controlled
  (they live in our D1). **[verify org-plugin schema + access-control model]**
- **Kakao/Naver** = future social option via Better Auth providers — **not MVP** (email-first).
- **Simsa must own** (never outsource): `gate_decision`, `activity_event`, `workspace`/roles —
  these back the Plan-Map approval audit and must be queryable/portable.

## 6. WorkOS fallback mapping
If WorkOS is chosen instead: **WorkOS user → `User`** (vendor-side; store an `external_id`
mapping in our `user`), **WorkOS organization → `workspace`** (or mirror into our `workspace`),
**WorkOS membership → `workspace_member`**, **WorkOS invitation → `invitation`** (or an external
invitation reference). **`gate_decision`, `activity_event`, `integration_account` stay
Simsa-owned.** Because the collaboration layer is Simsa-owned in both cases, the swap touches
mainly the **identity layer + a mapping column** — the portability goal.

## 7. Role & permission model
Roles: **Owner · Admin · Editor · Reviewer · Viewer.**
| Action | Owner | Admin | Editor | Reviewer | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| View project / Plan Map | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit brief / acceptance items | ✓ | ✓ | ✓ | | |
| Create stage plan | ✓ | ✓ | ✓ | | |
| Run evidence collection | ✓ | ✓ | ✓ | | |
| Approve **merge** gate | ✓ | ✓ | | | |
| Approve **deploy** gate | ✓ | ✓ (scope TBD §14) | | | |
| Approve **migration/publish** gate | ✓ | | | | |
| Manage integrations | ✓ | ✓ | | | |
| Invite members | ✓ | ✓ | | | |
| Remove members | ✓ | ✓ | | | |
| Change roles | ✓ | ✓ | | | |
| Export project data | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export workspace data | ✓ | ✓ | | | |
| Delete/archive project | ✓ | ✓ | | | |
**Role enforcement is future implementation;** today's `userKey` cannot enforce any of this.

## 8. Migration / rollout phases (additive only — do not implement)
| Phase | What | Approval gate | Rollback | Verification | Prod risk |
|---|---|---|---|---|---|
| **0** | current `userKey`/browser | — | — | — | none |
| **1** | freeze schema assumptions (this doc + Bae §14) | decision | n/a | review | none |
| **2** | add `user`+`workspace`+`workspace_member` behind **feature flag** | **migration** + security review | drop new tables (unused) | tables created, no read-path change | low |
| **3** | **backfill** `userKey` projects → default workspace | **migration** | keep `userKey`; revert mapping | row counts match; no cross-tenant | med |
| **4** | session middleware + workspace context | **auth + deploy** + env + security review | disable middleware (flag) | auth E2E; cookie/CORS | med |
| **5** | switch project reads to workspace-aware | **deploy** | flag back to `userKey` read | dual-read parity | **high** |
| **6** | invitations + project access | **migration** + security review (tokens) | drop tables | invite E2E; token hash/expiry | med |
| **7** | integration-ownership migration (existing GitHub tokens → `integration_account`) | **migration** + security review | keep old storage | tokens decrypt; no leak | med |
| **8** | `gate_decision`/`activity_event`/Plan-Map approval audit | **migration** | drop tables | attribution correct | med |
| **9** | account/workspace export + deletion flows | **deploy** + security review | disable flows | export secret-free; deletion complete | med |

## 9. userKey transition strategy
- **Preserve the `userKey` column** through cutover (no drop until proven).
- Create a **default workspace per authenticated user** (map `userKey`→ owner's first workspace
  on first sign-in; or per-`userKey` default workspace during backfill).
- **Never delete old records**; **no automatic destructive merge** of `userKey` tenants
  (a wrong merge = cross-tenant leak).
- **Dual-read period:** read by `workspace_id` with `userKey` fallback until parity verified.
- **Audit unmatched records** (userKey with no mapped user/workspace) before switching read paths.
- **Rollback** = flip the read path back to `userKey`.

## 10. GateDecision / Plan Map approval model
- **Gate types:** `merge · deploy · migration · publish · auth · payment · dns · production_write`.
- **States:** `pending · approved · rejected · expired · superseded`.
- **Fields:** id, **userId** (decider), **workspaceId**, projectId?, stageId/trainId/targetRef?,
  decision, reason, createdAt, expiresAt?.
- **Why:** the Plan Map's read-only gate cards become **attributable approvals** — who approved
  which gate, when, why — the audit the live read-only preview cannot provide today.
- **Evolution:** read-only Plan Map (Stage 182~186) → + `gate_decision` attribution + role-aware
  visibility → an **approval map** with history (`roadmap_event`). Requires real identity +
  `workspace_member`.

## 11. IntegrationAccount ownership
- **Providers:** GitHub, Vercel, future. **Owner context = user + workspace.**
- **Token storage: encrypted server-side only** (as `crypto.ts` does) — **never exported, never
  printed, never browser-local.**
- **Visible connected identity** (which provider account is linked) + **least-privilege scopes**.
- **connect/disconnect → `activity_event`** audit entries.
- **Write actions** (PR comment beyond confirm, deploy/promote) stay **explicit approval-gated**.

## 12. Share / invite / export implications
- **Private links → `project_access`** (auth required).
- **Public links → `share_link`** (tokenHash, expiry, revoke, access log, least scope).
- **Invitations → verified email + session + invite token** (hash-at-rest, rate-limited,
  expiring; role ≤ inviter).
- **Project export** uses project/workspace authorization; **secret-free**.
- **Workspace export** requires **Owner/Admin**; **tokens/secrets excluded** always.
- **Imported artifact ≠ live access/identity** (re-import is not auth).

## 13. Security review checklist (before implementation)
Session cookies (domain/SameSite/secure on `app.trysimsa.com`) · CSRF/CORS (Vercel↔Workers
split) · JWKS/auth verification at the edge · webhook signatures · invite-token hash/expiry ·
share-link token hash/expiry · **encrypted provider-token storage** · account deletion · data
export (secret-free) · audit-log retention · rate limiting · abuse prevention. Each = a
**security-review gate**.

## 14. Open questions for Bae
1. Confirm **Better Auth as primary**? (this doc assumes yes)
2. Keep **WorkOS** as fallback? (recommended yes)
3. **Email-only MVP** or social day-one? (recommended email-only)
4. **Kakao/Naver** MVP or later? (recommended later)
5. **Better Auth organization plugin** vs **Simsa-owned workspace tables**? (recommended
   Simsa-owned for portability + audit)
6. **Unify** provider `user` and Simsa `User`, or **map** via `external_id`? (recommended unify
   on Better Auth `user`; map for WorkOS)
7. **Who approves deploy gates in MVP** — Owner only, or Owner+Admin?
8. Is a **Reviewer-only role** needed in MVP, or defer?
9. **Audit-log retention** period?

## 15. Recommendation
- **Adopt a portable schema:** Simsa **owns** `workspace` / `workspace_member` / `invitation` /
  `gate_decision` / `activity_event` / `integration_account` even though Better Auth (or WorkOS)
  supplies identity/orgs — so a provider swap is mostly an identity-layer change.
- **Better Auth primary planning can continue;** use Better Auth for `user`/`session`/`account`/
  `verification`, **Simsa-owned** for the collaboration layer.
- **Do not implement auth until Bae approves provider + migration plan** (and the §13 security
  review is scheduled).
- **MVP table set:** `user`, `session`, `account`, `verification` (Better Auth) + `workspace`,
  `workspace_member`, `project(+workspaceId backfill)`. Everything else (invitations, share,
  integration ownership, gate/audit) is **Phase 6+**.

## 16. Now-safe vs gated
- **Now-safe:** schema planning · permission matrix · migration phases · security checklist ·
  auth-related UI copy planning.
- **Requires Bae auth approval:** installing Better Auth · login/session routes · social provider
  setup · organization-plugin setup · OAuth account linking.
- **Requires migration approval:** `user`/`workspace`/`workspace_member` tables · backfill
  `userKey` projects · `project_access`/`invitation`/`share_link` · `gate_decision`/
  `activity_event` · token-storage schema.
- **Requires deploy approval:** session-middleware rollout · workspace-aware project reads ·
  production auth UI · environment-variable changes.
- **Requires security review:** cookie/JWKS/session · invite/share tokens · encrypted provider
  tokens · webhooks · account deletion/export · audit retention.

## 17. Stage 189 decision — **Option A: schema plan ready (Better Auth primary, portable)**
A conceptual, migration-ready, **portable** schema is defined: Better Auth-owned identity
(`user`/`session`/`account`/`verification`) + **Simsa-owned** collaboration (`workspace`/
`workspace_member`/`invitation`/`project+workspaceId`/`project_access`/`share_link`/
`integration_account`/`gate_decision`/`activity_event`/`roadmap_event`), with a role/permission
matrix, 0→9 additive rollout (per-phase approval + rollback + verification), a safe `userKey`
transition, the Plan-Map approval model, and a security checklist. **No code, no install, no
migration.** Open questions (§14) return to Bae.

## 18. Recommended next stage
**Stage 190 — Auth Train PR Prep / Push / Review Gate** (bundle the Stage 187 brief + Stage 188
matrix + Stage 189 schema plan into one docs PR against `main`; no implementation) — **or**, if
Bae prefers, a short **Better Auth proof-read** (re-verify the §4/§5 **[verify]** items — exact
Better Auth `user`/`session`/`account`/org-plugin schema on D1, session/cookie model, #4203
status) before opening the PR. Auth install / migration / deploy each remain **separately
Bae-approval-gated**.
