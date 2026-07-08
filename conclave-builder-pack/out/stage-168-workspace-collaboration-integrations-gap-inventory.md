> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 168 — Workspace Collaboration / Profile / Integrations Gap Inventory

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train) · **Base:** `main` @ `9c4e593`
**Type:** planning / inventory (docs-only). **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth/OAuth, no token/secret output, no destructive delete.**

## 1. Goal
Inventory the missing product-foundation surfaces for Simsa to become a global
team/workspace product (profile, workspace/team, share, invite, export/import,
GitHub/Vercel integrations, delete/archive, activity), define the surface map, data-model
and permission implications, integration safety principles, and a phased Stage 169~174
plan. **Not** an implementation stage.

## 2. Bae product concern
Simsa today is largely a single-user preview tool. Missing: user profile, GitHub/Vercel
integration UX, share, add teammate, export, import, connect/disconnect integrations,
add/remove/delete/archive flows, and team collaboration.

## 3. Current surface inventory (verified from the codebase)
**Dashboard routes (`apps/dashboard/src/app`):** `/` (projects home), `projects`,
`projects/new`, `projects/new/intake`, `projects/[id]` (+ `idea`, `spec`, `items`,
`checks`, `fixes`, `export`, `settings`, `github` (+ `history`, `history/[runId]`),
`benchmark` (+ `[benchmarkId]`), `experiment`, `credits`), and `admin/{usage,credits,workflows}`.
**Central-plane:** GitHub OAuth + app (`db/oauth.ts`, `gh-app.ts`,
`workspace/github-oauth.ts`, `crypto.ts` encrypted tokens); workspace records/benchmarks/
experiments routes; admin endpoints. **Identity:** client-supplied **`userKey`
tenant-scoping**, **not** real auth/sessions/RBAC (confirmed across prior stages, esp.
Stage 112B/123). Avatar = `MockUserBadge` (initial), no profile.

## 4. Missing capability matrix
| # | Category | Surface / Route | Current state | Missing capability | User value | Risk | Suggested stage |
|---|----------|-----------------|---------------|--------------------|------------|------|-----------------|
| 1 | User profile | — | **none** (MockUserBadge initial only) | profile page: name/email/avatar/locale/notif | identity, trust | low (UI) | 169 |
| 2 | Account settings | — | **none** (locale via LanguageToggle/localStorage) | account-level prefs | retention | low | 169 |
| 3 | Workspace/team | — | **none** (userKey = tenant, not a team) | workspace + members | collaboration core | **high (needs auth)** | 170 |
| 4 | Add teammate / invite | — | **none** | invite/remove member | team growth | **high (needs auth)** | 170/171 |
| 5 | Share project | — | **none** | share/copy-link/email | distribution | med-high (needs auth/links) | 171 |
| 6 | Project permissions | — | **none** (no roles) | role-scoped access | safety | **high (needs auth)** | 171 |
| 7 | Export | `projects/[id]/export` (builder pack) | **exists** (zip/builder pack) | broaden formats (md/json/report) | hand-off | low | 172 |
| 8 | Import | — | **none** | PRD/md/json/repo/url import | onboarding | med | 172 |
| 9 | GitHub integration | `projects/[id]/github` + `settings`; central-plane OAuth/app, encrypted tokens | **exists** (read PRs, link, review) | connected-repos mgmt UI, disconnect, status | evidence | med (token safety) | 173 |
| 10 | Vercel integration | — | **none** in the workspace product (`platform-vercel` is a CLI adapter, not dashboard) | connect/deployments/preview URLs (read) | evidence | med (token safety) | 173 |
| 11 | Connected apps mgmt | `settings` (repo only) | **partial** | unified connected-apps view + disconnect | control | med | 173 |
| 12 | Delete/archive/remove | saved **workflow records** archive/restore/delete (Stage 118) | **partial** | project-level delete/archive UX | data control | med (destructive) | 170/172 |
| 13 | Activity/audit/history | review/run history exists; no cross-surface audit | **partial** | workspace activity log | trust/compliance | med | 174-follow |
| 14 | Notifications/email | Telegram notify exists; mailto beta feedback | **partial** | invite/share email hooks | collaboration | med (needs provider) | follow |
| 15 | Public/private link sharing | — | **none** | tokenized share links | distribution | **high (needs auth)** | 171 |

## 5. User profile gap
No profile/account page. Locale lives in `localStorage` (`conclave:locale`); the sidebar
shows a mock initial badge. **Missing:** display name, email, avatar, preferred locale
(persisted to identity, not just localStorage), notification preference, connected-accounts
summary. Lowest-risk starting point (Stage 169), but a *real* profile needs identity.

## 6. Workspace/team gap
No workspace/team concept. `userKey` scopes data to one key (a tenant boundary), **not** a
shared team with members. **Missing:** workspace entity, membership, owner/admin/editor/
reviewer/viewer roles, invite/remove. **Hard dependency: real auth/identity.**

## 7. Share/invite/permission gap
No share links, no invitations, no roles (grep confirmed: no `share link`/`invite`/role
surfaces). Everything is single-`userKey`. This entire layer depends on auth + a
membership/permission model.

## 8. Export/import gap
**Export exists** (`projects/[id]/export`, builder pack zip). **Import does not exist**
(no PRD/markdown/json/repo/url import surface). Note: intake already *derives* from
idea/PRD/URL/repo/PR/AI-app inputs, so "import" can build on intake. (No PDF export this
train.)

## 9. GitHub / Vercel integration gap
**GitHub: exists** — OAuth + GitHub App, encrypted token storage (`crypto.ts`), PR
listing/linking, review history. **Missing:** a connected-repositories management UI,
explicit disconnect, and clear connection status. **Vercel: none** in the workspace
product (the `platform-vercel` package is a CLI deploy adapter, not a dashboard
integration) — connect/deployments/preview-URL/build-status read integration is missing.

## 10. Delete/archive/remove gap
Saved **workflow records** support archive/restore/delete (Stage 118, tenant-scoped).
**Missing/unverified:** project-level delete/archive UX, and member/integration/share
removal flows. Destructive deletes must be confirmed + scoped (no destructive
implementation this train).

## 11. Activity/audit/history gap
Per-PR/run **review history exists**; there is **no** workspace-wide activity/audit log
(project created, share created, teammate invited, export generated, integration
connected, acceptance map / evidence plan changed). Needed for team trust/compliance.

## 12. Recommended product architecture (staged)
- **L1 Identity/Profile:** user profile — name, email, avatar, locale, notification pref,
  connected-accounts summary.
- **L2 Workspace/Team:** workspace, members, roles, invite/remove (owner/admin/editor/
  reviewer/viewer).
- **L3 Project sharing:** share/copy-link/invite-by-email, view/comment/edit perms, revoke
  link, transfer ownership (later).
- **L4 Export/Import:** export brief/acceptance map/stage plan/evidence plan (md/json now,
  PDF later); import PRD/markdown/json/repo/url (build on intake).
- **L5 Integrations:** GitHub + Vercel connect, connected repos/deployments, disconnect,
  status, scoped/read-first tokens (OAuth not in this train).
- **L6 Activity/Audit:** project/share/invite/export/integration/acceptance/evidence events.

## 13. Draft role / permission model
Roles: **Owner · Admin · Editor · Reviewer · Viewer.** Draft matrix (✓ = allowed):

| Action | Owner | Admin | Editor | Reviewer | Viewer |
|--------|:----:|:----:|:----:|:----:|:----:|
| Create project | ✓ | ✓ | ✓ | | |
| Edit project | ✓ | ✓ | ✓ | | |
| Generate acceptance map | ✓ | ✓ | ✓ | | |
| Add teammate | ✓ | ✓ | | | |
| Share project | ✓ | ✓ | ✓ | | |
| Export | ✓ | ✓ | ✓ | ✓ | ✓ |
| Import | ✓ | ✓ | ✓ | | |
| Connect GitHub | ✓ | ✓ | | | |
| Connect Vercel | ✓ | ✓ | | | |
| Delete/archive | ✓ | ✓ | | | |
| Comment/review | ✓ | ✓ | ✓ | ✓ | |
| View | ✓ | ✓ | ✓ | ✓ | ✓ |

Draft only — roles are not implemented this train (depends on auth).

## 14. Integration safety principles
- Never expose OAuth tokens in UI/logs; least-privilege scopes; explicit connect/disconnect
  UI; visible connection status; **read-first** evidence collection; write actions require
  explicit user approval; clear connected-account identity; no destructive repo/deploy
  actions by default.
- **GitHub (read-first):** repo metadata, branches, PRs, issues, commits, checks,
  deployments (if available). (GitHub already follows this — tokens encrypted in
  central-plane, never in the UI.)
- **Vercel (read-first):** projects, deployments, preview URLs, build status, env target.
- No API calls / OAuth app creation this train.

## 15. Suggested Stage 169~174 train
- **169** User Profile / Account Settings IA
- **170** Workspace / Team Member Model Planning
- **171** Share / Invite / Permission UX Planning
- **172** Export / Import Surface Planning
- **173** GitHub / Vercel Integration UX + Safety Model
- **174** Collaboration Foundation Checkpoint

## 16. Risks and dependencies
- **★ Auth is the gating dependency.** Workspace/team, invites, roles, and share links all
  require **real authentication/identity** — Simsa currently has only `userKey`
  tenant-scoping (Stage 123 deferred real auth). A dedicated **Auth/Identity train**
  likely must precede or accompany L2/L3 implementation.
- **Payment:** team/workspace tiers often imply billing — but **payment provider remains
  TBD, Korea-compatible first, Stripe not assumed**; billing is out of scope here.
- **Token safety / migrations:** integrations + memberships need new persisted models +
  D1 migrations (separate, approval-gated). Destructive deletes need confirmation + scope.
- **Honest positioning:** until auth/roles exist, do not market "secure team workspace" —
  current scoping is tenant-by-userKey, not authenticated multi-user.

## 17. Stage 168 decision — **Option A: Foundation gap inventory ready**
The gap inventory is complete and verified. Most collaboration surfaces (profile,
workspace/team, invite, share, import, Vercel, roles, audit) are **missing**; GitHub
integration and project export **exist**; workflow-record archive/delete **exists**.
**Real auth/identity is the gating prerequisite** for the collaboration layer. Proceed to
Stage 169 (lowest-risk: profile/account IA), keeping auth-dependent layers as planning
until an auth decision.

## 18. Recommended next stage
**Stage 169 — User Profile / Account Settings IA.** **Do not merge** the train PR until
the Stage 174 checkpoint + Bae approval.
