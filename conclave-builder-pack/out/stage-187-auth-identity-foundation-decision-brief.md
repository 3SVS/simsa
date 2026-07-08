> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 187 — Auth / Identity Foundation Decision Brief

**Date:** 2026-06-25
**Branch:** `docs/stage-187-auth-identity-brief` · **Base / deployed main:** `9b645af` · live: https://app.trysimsa.com
**Type:** decision brief / docs only. **No auth implementation, no auth packages, no login/session middleware, no OAuth, no migration, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no token/secret request-print-store, no env-var change, no live-dashboard change.**

> **Core product principle: Simsa must not fake collaboration.** Until auth/workspace exists,
> `/account` stays local/browser-scoped, Plan Map gates stay read-only, team/invite/share stay
> planned/disabled, GitHub/Vercel connected-account management stays placeholder/read-first, and
> `userKey` is never treated as real identity.

## 0. Stack baseline (verified, shapes every option below)
- **Dashboard:** Next.js (App Router) on **Vercel** (`app.trysimsa.com`).
- **Backend:** `apps/central-plane` = **Hono on Cloudflare Workers + D1** (SQLite-at-edge);
  sequential SQL migrations.
- **Existing GitHub OAuth** (`workspace/github-oauth.ts` + encrypted tokens via `crypto.ts`)
  is **repo-access** auth, **not** login identity.
- **Implication:** any auth choice must issue an identity proof that **both** the Vercel
  Next.js app **and** the Cloudflare Workers API can verify (a signed JWT verifiable via JWKS,
  or a shared-secret/session the edge can check). This split is the central constraint.

## 1. Current state inventory
- `/account` = **local preference stub** (Stage 170): local **display name** (`localStorage
  conclave:account:displayName`), local **locale** preference, **avatar initial** derived
  locally; **GitHub** = read-only placeholder; **Vercel** = "Planned" placeholder.
- **`userKey`** = client-supplied tenant-scoping surrogate on every `workspace_*` table.
- **Absent:** real login · real session · verified email · workspace-member model · invite
  acceptance · role enforcement · approval audit trail · workspace-owned integrations.
- Plan Map (Stage 182~183) surfaces a permanent **"Blocked by identity decision"** blocker —
  this brief is what unblocks it.

## 2. Why `userKey` is insufficient
- It is **client-supplied** (generated in the browser) → anyone can present any key.
- It is **not authentication** — it proves nothing about who the user is.
- It cannot support **team membership** (a key is one anonymous tenant, not many identified
  users).
- It cannot support **role-aware approval** (no identity to attach a role to).
- It cannot support an **audit trail** (no verifiable actor for "who did X when").
- It cannot **safely own integrations** (a leaked key would expose connected accounts).
- It cannot **authorize account/workspace export** (no identity to scope "my data" to).

## 3. Product requirements for identity
Stable **user id** · **verified email** · **session** model · **workspace selection** ·
**default-workspace creation** on first auth · **workspace membership** · **invitation
acceptance** · **role assignment** · **integration-account ownership** · **approval-gate
attribution** · **audit-event attribution** · **data-export ownership** · **project-access
enforcement**.

## 4. Proposed domain model (conceptual — no migration)
Refines Stage 171:
| Entity | Purpose | Key fields | Notes |
|---|---|---|---|
| **User** | real identity | id, email(verified), name, avatar, locale | created on first auth |
| **Workspace** | team container | id, name, slug, ownerUserId, defaultLocale, archivedAt? | one owner |
| **WorkspaceMember** | membership+role | workspaceId, userId, role, status, joinedAt, invitedBy | composite key |
| **Invitation** | pending invite | id, workspaceId, email, role, tokenHash, expiresAt, accepted/revokedAt | **tokenHash only** |
| **Project** | existing + scope | + workspaceId | migrate from `userKey` |
| **ProjectAccess** | per-project override | projectId, userId/role | defaults to workspace role |
| **ShareLink** | external/link share | id, projectId, scope, tokenHash, expiresAt, revokedAt | **tokenHash only**, least scope |
| **IntegrationAccount** | GitHub/Vercel conn | id, workspaceId, provider, externalId, scopes, status | tokens **server-side encrypted** |
| **ActivityEvent** | audit log | id, workspaceId, actorUserId, type, target, at | append-only, no secrets |
| **GateDecision** | approval ledger | id, workspaceId, gateKey, targetRef, decidedByUserId, decision, at | attributes Plan-Map gates |
| **RoadmapEvent** *(optional)* | Plan-Map history | id, projectId, kind, actorUserId, at | persists the now-generated map |

## 5. Role model
**Owner · Admin · Editor · Reviewer · Viewer** (Stage 171). Eventual capabilities:
| Capability | Owner | Admin | Editor | Reviewer | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Manage workspace / transfer ownership | ✓ (transfer Owner-only) | | | | |
| Invite / remove members, change roles | ✓ | ✓ | | | |
| Connect / disconnect integrations | ✓ | ✓ | | | |
| Approve merge/deploy/publish/migration gates | ✓ | ✓ (scope TBD) | | | |
| Edit acceptance items | ✓ | ✓ | ✓ | | |
| View evidence / Plan Map | ✓ | ✓ | ✓ | ✓ | ✓ |
| Review / comment | ✓ | ✓ | ✓ | ✓ | |
| Export project | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export workspace data | ✓ | ✓ | | | |
Role **enforcement** is future implementation (auth + WorkspaceMember required first).

## 6. Auth architecture options (category-level; verify vendor specifics before implementing)
| Category | Examples | Complexity | Security responsibility | Workspace/team | OAuth linking | Email verify | Session | Migration impact | Cost / lock-in | Fit for early Simsa | Risk |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Managed auth (orgs-native)** | provider-with-organizations | Low–Med | **Mostly offloaded** | **Built-in orgs** | Built-in | Built-in | Built-in (JWT) | Map provider org→Workspace; store `workspace_id` | $ per MAU; medium lock-in | **Strong** — offloads the riskiest parts | Low–Med |
| **Managed auth (identity-only)** | provider-without-orgs | Low–Med | Mostly offloaded | **Build ourselves** | Built-in | Built-in | Built-in (JWT) | Build Workspace/Member tables ourselves | $ per MAU; medium lock-in | Good if we want to own the workspace model | Med |
| **Framework-native** | Next.js-native auth library | Med | **On us** (sessions, tokens) | Build ourselves | Library adapters | Build/extend | Self-managed (JWT or DB session) | Full User/Session/Account tables in D1 | **Free**, low lock-in | Good if cost-sensitive + team can own security | Med–High |
| **Enterprise SSO** | SAML/OIDC broker | Med–High | Offloaded | Orgs/SSO-centric | SSO + OAuth | Built-in | Built-in | Heavier | $$; B2B-oriented | **Later** (enterprise buyers) | Med |
| **Custom on D1** | hand-rolled | **High** | **Entirely on us** | Build all | Build all | Build all | Build all | Full | Free; no lock-in | **Not recommended** | **High** |
- **Do not** treat any vendor row as final — provider-specific claims (JWT/JWKS verification at
  the Workers edge, org primitives, pricing, Korea data-residency, social providers incl.
  Kakao/Naver) must be **verified against current provider docs before implementation** (a
  Stage 188 selection matrix). **Note:** avoid any auth library known to be in
  sunset/maintenance — confirm maintenance status at selection time.

## 7. GitHub / Vercel distinction
- The existing **GitHub OAuth is repo-evidence access, NOT login identity** — keep them
  **separate concerns**. A "Sign in with GitHub" login (if chosen) is a *different* OAuth
  purpose and should be modeled distinctly from repo-access tokens.
- **Vercel** should also be a **connected integration**, **not** the identity source by default.
- **Login identity** ⟂ **connected provider accounts**: model `User`/session separately from
  `IntegrationAccount`. Integration ownership should eventually belong to the **workspace (or
  user+workspace)** context, never browser-local state.

## 8. Plan Map relationship
- Today's Plan Map is a **read-only generated preview** (no attribution).
- Post-auth it should show **who approved which gate and when** (via `GateDecision`/
  `ActivityEvent`), with **role-aware** gate visibility.
- The Plan-Map blocker **"Blocked by identity decision"** should resolve **only after** an auth
  architecture is **selected and implemented** — not before.
- Audit trails and role-aware gates **require real identity + WorkspaceMember**.

## 9. Share / invite / permission relationship
- **Private project links** require **auth + ProjectAccess**.
- **Public share links** require a **ShareLink token model** (hash-at-rest, expiry, revoke,
  access log, least scope).
- **Teammate invitations** require **verified email + session + invite tokens** (hash-at-rest,
  rate-limited, expiring; invited role ≤ inviter authority).
- **Remove member / change role** requires the **Owner/Admin** model (Owner protected; transfer
  before removal).
- **Member-aware delete/archive** requires **project/workspace ownership**.

## 10. Export / import relationship
- **Project export** can stay **now-safe** if **secret-free**.
- **Account/workspace export** requires **identity + workspace scope**.
- Export must **never** include tokens/secrets/credentials.
- An **imported** Simsa artifact does **not** prove live access or identity (re-import ≠ auth).
- **Audit-linked export** (who exported what) requires auth/workspace later.

## 11. Integration ownership relationship
- Connected accounts need a **visible identity**.
- Tokens **server-side only and encrypted** (as GitHub does via `crypto.ts`) — **never** output.
- **Least-privilege scopes**; explicit **connect/disconnect**.
- **Workspace-owned** integration accounts (not browser-local) — later.
- **Write actions remain explicit approval-gated.**

## 12. Migration strategy (phases only — do not implement)
- **Phase 0** — current `userKey` / browser scope (today).
- **Phase 1** — **select auth architecture** (decision; no code).
- **Phase 2** — `User` + `Workspace` schema **behind a feature flag** *(migration approval +
  security review)*.
- **Phase 3** — **backfill** existing `userKey` projects → a default workspace per key
  *(migration approval; verify before switching read paths to avoid cross-tenant leak)*.
- **Phase 4** — **session middleware + workspace context** *(auth approval + deploy approval +
  env-var handling + security review)*.
- **Phase 5** — `WorkspaceMember` + roles *(migration + deploy approval)*.
- **Phase 6** — **invitations** *(migration + security review for invite tokens/email)*.
- **Phase 7** — **share links + project access** *(migration + security review for public
  tokens)*.
- **Phase 8** — **integration-ownership migration** *(migration + security review for token
  storage)*.
- **Phase 9** — **approval / audit ledger** (`GateDecision`/`ActivityEvent`) *(migration;
  unblocks Plan-Map approvals)*.
Each additive-first; read paths switch only after a verified backfill.

## 13. Safety gates (hard rules)
- **Auth/session/OAuth implementation → separate Bae approval.**
- **DB migration → separate Bae approval.**
- **Production deploy → separate Bae approval.**
- **Payment/billing remains TBD** — evaluate a **Korea-compatible** provider later; **no Stripe
  assumption**.
- **Tokens/secrets must never be printed or requested.**
- **Vercel token** revoke/rotate status should remain confirmed if relevant — **never print
  token values**.

## 14. Recommendation
- **Category:** lead with a **managed auth provider**, preferring one with **native
  organization/team primitives** and a **JWT verifiable at the Cloudflare Workers edge** — it
  **offloads the riskiest parts** (session, email verification, OAuth, token storage) that a
  small team should not hand-roll, and it fits the Vercel↔Workers split. Keep **framework-native
  auth** as the serious cost-sensitive alternative (free, low lock-in, but security
  responsibility and org modeling land on us). **Reject custom-on-D1** (high risk).
  *This is a category recommendation; the specific vendor must be verified in Stage 188.*
- **Minimum viable identity model for collaboration:** `User` (id + **verified email**) +
  `Workspace` (owner) + `WorkspaceMember` (role) + **session** + default-workspace-on-first-auth.
  Nothing team-facing should ship before this floor exists.
- **Before invite/share/roles:** the MVP floor above + `Invitation`/`ShareLink` token models
  (hash-at-rest, expiry, revoke).
- **Before GitHub/Vercel connected-account management:** `User`+`Workspace`+session +
  `IntegrationAccount` ownership (workspace-scoped, server-side encrypted tokens).
- **Before Plan-Map approval audit:** real identity + `WorkspaceMember` + `GateDecision`/
  `ActivityEvent` ledger.
- **Answers:** hosted vs native vs custom → **hosted (managed) recommended, native as fallback,
  custom rejected**. Until then, **everything multi-user stays blocked**; only the read-only
  generated Plan Map, the local `/account` stub, and secret-free export/handoff exist.

## 15. Now-safe vs gated
- **Now-safe:** this decision brief · auth-requirements doc · conceptual schema · migration
  plan · UI copy clarifying "requires sign-in" · Plan-Map blocker copy.
- **Requires separate auth approval:** login/session impl · OAuth provider impl · verified-email
  flow · session middleware · account linking.
- **Requires migration approval:** `User` · `Workspace` · `WorkspaceMember` · `Invitation` ·
  `ProjectAccess` · `IntegrationAccount` ownership changes · `ActivityEvent`/approval-ledger
  tables.
- **Requires deploy approval:** any production rollout · any auth/session route going live · any
  workspace-gated project-access change.
- **Requires security review:** token storage · OAuth scopes · session cookies · invite tokens ·
  public share links · audit-log retention · account deletion/export.

## 16. Suggested next stages
- **Option A — Stage 188: Auth Provider / Architecture Selection Matrix** *(recommended)*.
- **Option B — Stage 188: User + Workspace Schema Planning.**
- **Option C — Stage 188: Stale Dogfood PR Cleanup Review** (#121~130).
**Recommendation: Option A.** The architecture **category choice shapes the schema** (a managed
orgs-native provider owns User/Org and we store a `workspace_id` mapping; framework-native means
we own full `User`/`Session`/`Account` tables in D1). Picking the provider/architecture **first**
(with vendor specifics verified against current docs — JWKS-at-edge, org primitives, Korea
residency, social/Kakao/Naver, pricing, maintenance status) prevents reworking the schema later.
Option B should follow once the category is chosen; Option C is independent housekeeping.

## 17. Stage 187 decision — **Option A: Auth/Identity decision brief ready**
The current-state inventory, why-`userKey`-is-insufficient analysis, identity requirements,
conceptual domain + role model, category-level architecture comparison, GitHub/Vercel
distinction, Plan-Map / share-invite / export / integration relationships, phased migration,
safety gates, and a category recommendation (**managed auth, native fallback, custom rejected**)
are defined. **No implementation occurred.** Real collaboration stays blocked until Bae selects
an architecture; the next step is **Stage 188 — Auth Provider / Architecture Selection Matrix**.

## 18. Recommended next stage
**Stage 188 — Auth Provider / Architecture Selection Matrix** (verify vendor specifics against
current docs before any implementation), then **User + Workspace Schema Planning**. Auth/OAuth
implementation, migrations, and deploy each remain **separately Bae-approval-gated**.
