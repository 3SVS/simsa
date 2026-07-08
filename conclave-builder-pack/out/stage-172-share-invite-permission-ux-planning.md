> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 172 — Share / Invite / Permission UX Planning

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593`
**Type:** planning (docs-only). **No deploy, no central-plane, no migration, no auth/OAuth/session, no invite/share-link implementation, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output, no destructive revoke.**

## 1. Goal
Plan Simsa's share, invite, and permission UX across project/workspace surfaces:
what "share" means before auth, what "invite" means after auth, the project/workspace
permission UX, safe link models, what stays disabled/planned until auth, and what is
now-safe. Docs-only.

## 2. Current share/export/handoff inventory (verified)
- **Export (Type A): exists** — `projects/[id]/export` (Builder pack; downloadable zip +
  copy).
- **Handoff link (Type B): exists** — the MCP `buildWebAppHandoffLink`
  (`@conclave-ai/workspace-preview`) omits secrets/raw private content (Stage 139); the
  intake destination + `buildBenchmarkHandoffPreview` use it.
- **Copy-to-clipboard: exists & used** — benchmark detail (Copy summary/markdown),
  experiment (Copy all prompts), export, GitHub (PR-comment body copy).
- **"Share to GitHub PR comment": exists** — benchmark detail posts a benchmark artifact
  as a PR comment (preview-first + confirm; Stage 67) — a real, GitHub-backed artifact
  share (not team sharing).
- **No team/project "Share" button, no invite UI, no public/private share links, no
  permission/role/access model** in the dashboard.

## 3. Current gaps
No private project link, no public read-only share link, no teammate invite, no
project/workspace **access or role** UX. Everything is single-`userKey`; "sharing" today =
**export/download, safe handoff link, copy-to-clipboard, and (GitHub-backed) PR-comment
artifact**.

## 4. Current-state answers
1. **Share button:** no team "Share"; the closest is benchmark→GitHub PR comment.
2. **Invite teammate UI:** none (account page shows "Invite planned / Requires sign-in").
3. **Public/private links:** none.
4. **Export:** downloadable artifacts (builder pack zip) + copy — yes.
5. **Handoff builder:** omits secrets/raw private content (allowlisted query params).
6. **Permission/access concepts:** none (only `userKey` scoping).
7. **Delete/archive:** `userKey`-scoped (not membership-checked).
8. **Copy-to-clipboard:** present on several surfaces.

## 5. Share type model
- **Type A — Export share:** download/copy brief/acceptance map/stage plan/evidence
  plan/report. **Now-safe** (content is user/local-scoped).
- **Type B — Handoff link:** allowlisted, secret-free query params into
  `/projects/new/intake`. **Now-safe** (already exists; no private raw content).
- **Type C — Private project link:** authenticated link into a workspace project.
  **Requires auth + workspace membership + project access.**
- **Type D — Public read-only share link:** tokenized read-only link for selected
  artifacts. **Requires share-token table, revocation, expiry, access logging — not
  allowed before the auth/security model.**
- **Type E — Invite teammate:** email invite into workspace/project. **Requires auth,
  invitation tokens, membership table, email delivery, rate-limiting.**

## 6. Invite teammate model (future)
Builds on Stage 171's `Invitation` entity (tokenHash-only, expiry, revoke, rate-limit;
role ≤ inviter authority; Owner/Admin only). UX: enter email + role → pending invite list
→ accept (auth) / revoke / resend (rate-limited) → becomes `WorkspaceMember`. **Not
implemented; requires auth + email provider** (provider TBD; Telegram/email hooks exist
but identity-bound invites need auth).

## 7. Project access / permission UX (future)
`/projects/[id]/settings/access`: list members with effective role, per-project override
(ProjectAccess), and (Type C/D) share-link management. Controls gated by the viewer's
role. **Now:** project `settings` stays repo-config only.

## 8. Workspace access / permission UX (future)
`/workspace/members` (list + role + remove), `/workspace/invitations` (pending invites),
`/workspace/settings/access` (defaults). All Owner/Admin-gated. **Not implemented.**

## 9. Role / action matrix
(Roles from Stage 171.) "Requires auth?" / "Requires migration?" flag implementation gating.

| UX action | Owner | Admin | Editor | Reviewer | Viewer | Requires auth? | Requires migration? |
|-----------|:----:|:----:|:----:|:----:|:----:|:--------------:|:-------------------:|
| Copy handoff link | ✓ | ✓ | ✓ | ✓ | ✓ | **no (now-safe)** | no |
| Export report | ✓ | ✓ | ✓ | ✓ | ✓ | **no (now-safe)** | no |
| Create private project share | ✓ | ✓ | ✓ | | | yes | yes |
| Create public read-only share | ✓ | ✓ | | | | yes | yes (share tokens) |
| Invite teammate | ✓ | ✓ | | | | yes | yes |
| Remove teammate | ✓ | ✓ | | | | yes | yes |
| Change role | ✓ | ✓ | | | | yes | yes |
| Revoke share link | ✓ | ✓ | | | | yes | yes |
| Transfer ownership | ✓ | | | | | yes | yes |
| Connect GitHub/Vercel | ✓ | ✓ | | | | yes (Vercel) | maybe |
| Delete/archive project | ✓ | ✓ | | | | partial (auth for member-aware) | maybe |

## 10. Now-safe placeholder plan
- Keep **export** + **handoff copy link** + **copy-to-clipboard** as the available
  now-safe share mechanisms (already shipped).
- Any future **Share / Invite** affordances render **disabled/"Planned"** with
  *"Team sharing requires sign-in"* (consistent with Stage 170's `/account` badges).
- Private/public link sharing labeled **Requires sign-in** until the auth/security model.
- Stage 172 itself stays **docs-only** (no new UI this stage).

## 11. Auth / migration dependencies
- **No auth needed:** export, handoff link, copy-to-clipboard, PR-comment artifact share.
- **Requires auth:** invite/remove/role, private project link, ownership transfer,
  member-aware delete/archive.
- **Requires migration (0047+):** ShareLink (tokenHash), Invitation, WorkspaceMember,
  ProjectAccess, ActivityEvent (per Stage 171 phases).
- **Requires integration:** Vercel connect (GitHub exists); share/PR actions stay
  preview-first + confirm.

## 12. Safety requirements (when implemented)
Share links revocable; public links expiry or explicit "indefinite" warning; **tokens
stored hashed**; access logs for share-link views; **raw private content never embedded in
URLs** (handoff already enforces this); exports labeled for sensitivity; invite emails
rate-limited; role changes + ownership transfer **audited** and confirmation-gated.

## 13. Non-goals
No auth/OAuth/session, no invitation/share-token/project-access tables or migration, no
real invite/remove/role editing, no public/private link generation, no destructive revoke,
no billing (payment **TBD**, Korea-compatible first, no Stripe). No code this stage.

## 14. Suggested implementation phases (post-auth)
Auth/Identity decision → (Stage 171 Phase 1–3: User/Workspace/members+roles) →
**share/invite layer:** ShareLink + Invitation migrations → `/workspace/members` +
`/workspace/invitations` + `/projects/[id]/settings/access` UX → public read-only links
with revoke/expiry/access-log last (highest risk). Until then, export/handoff/copy remain
the supported sharing.

## 15. Stage 172 decision — **Option A: Share/invite/permission UX plan ready**
The share-type model (A–E), invite/permission UX, role/action matrix, now-safe plan, and
safety requirements are defined. Now-safe sharing (export, handoff link, copy) already
ships; private/public links + invites + roles are **auth/migration-gated**. Proceed to
Stage 173 (Export/Import surface planning).

## 16. Recommended next stage
**Stage 173 — Export / Import Surface Planning.** **Do not merge** the train PR until the
foundation checkpoint + Bae approval.
