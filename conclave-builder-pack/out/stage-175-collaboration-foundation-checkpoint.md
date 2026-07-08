> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 175 — Collaboration Foundation Checkpoint / PR #155 Merge-Readiness Review

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, **PR #155**) · **Base:** `main` @ `9c4e593` · **HEAD:** `087b7bf`
**Type:** checkpoint / review (no new feature code). **No deploy, no central-plane, no migration, no auth/OAuth/session, no payment/Stripe, no hosted execution, no MCP/npm publish, no token/secret output. This stage decides merge-readiness; it does NOT auto-merge.**

## 1. Goal
Review PR #155 (Stage 168~174) as a unit and decide merge-readiness. The train is mostly
planning docs plus one small now-safe code slice (Stage 170 local `/account` stub). The
strategic output is a single gating decision for Bae: **auth/identity must be chosen before
the collaboration layer can be implemented.**

## 2. PR #155 composition (verified)
14 files, **+1338 / −7**, base `main`, state **OPEN / MERGEABLE**.
- **Code / test / i18n (Stage 170 only — now-safe, local):**
  - `apps/dashboard/src/app/account/page.tsx` (+140) — `/account` stub, `"use client"`.
  - `apps/dashboard/src/components/AppSidebar.tsx` (±8) — bottom user badge → `/account`.
  - `apps/dashboard/src/i18n/dictionary.mjs` (+107) / `dictionary.d.mts` (+44) — `account.*`
    EN+KO, type updated.
  - `apps/dashboard/src/lib/account-preferences.mjs` (+39) / `.d.mts` (+15) — pure helpers
    (`normalizeDisplayName` / `displayInitial` / `read|writeDisplayName`), React-free.
  - `apps/dashboard/test/account-preferences.test.mjs` (+80) — pure tests.
- **Planning docs (7, docs-only):** Stage 168 gap inventory · 169 `/account` IA · 170 stub
  doc · 171 workspace/team model · 172 share/invite/permission UX · 173 export/import
  surface · 174 GitHub/Vercel integration UX + safety.

## 3. Verification (on HEAD `087b7bf`, this session)
- Dashboard tests **242/242** ✓ (Stage 170 added +10 over 232).
- `tsc --noEmit` typecheck **✓** (exit 0).
- `next build` **✓** (exit 0; `/account` route built, 1.87 kB per Stage 170).
- Worktree: only pre-existing untracked files (older builder-pack `out/*`, prior HANDOFFs,
  `.githooks/`, `AGENTS.md`) — none belong to this train; nothing accidental staged.

## 4. Safety audit of the code slice
- **No auth, no server write, no migration.** `/account` is local-only: display name +
  preferred locale persist to `localStorage`; no network call, no user table.
- **No token / secret output.** Connected-accounts section is read-only **status copy**
  (GitHub = managed in project settings / Read-only; Vercel = Planned). No connect/disconnect
  buttons, no API calls, no token rendering.
- **Honest, non-misleading copy.** Auth-dependent items (email, delete account, team
  workspace, invites) are shown **disabled** or **"Requires sign-in" / "Planned"** with
  badges — does not imply an authenticated multi-user account exists.
- **Pure helpers never throw** (malformed/null storage handled); React-free so they run
  under `node --test`. Display-name normalized (trim, cap 80, fallback) and React-escaped
  (no HTML injection).
- **Design tokens:** reuses existing `brand` (oxblood) + `gold`/`gray` tokens, no new color
  system, no violet/indigo, no emoji — consistent with the Linear/neutral house style.

## 5. Verified factual baseline (carried from the train)
- **Tenancy = client-supplied `user_key`** on every `workspace_*` table (migrations ≤0046).
  **No `User` table, no `workspace_members`, no `invitations`, no member roles.** `userKey`
  is tenant-scoping, **not** authentication.
- **GitHub backend exists** (OAuth + encrypted server-side tokens + PR access via
  `apps/central-plane/src/workspace/github-*.ts` + `crypto.ts`); **project-level** GitHub UI
  exists (repo connect, PR link/review/history, PR-comment post with preview+confirm).
- **Vercel** = CLI deploy adapter (`packages/platform-vercel`) + preview-URL-as-intake only.
  **No** Vercel OAuth / connect / deployment-evidence integration.
- **Export exists** (project-scoped: client zip + central-plane `/export`); **import is
  entirely missing** (no route, no parser).

## 6. ★ Gating decision for Bae — auth / identity
Every collaboration capability planned in Stages 171–174 (real workspace/team entity,
membership, roles/permission checks, invitations, share links, account-level connected
integrations, account/workspace-wide export) is **blocked by an auth/identity decision**.
`userKey` cannot carry identity, membership, or permission. **An Auth/Identity train must
come first.** Decisions not yet made: user-id source, email verification, session
middleware, workspace selection/switching, invitation-acceptance flow, OAuth account
linking. (GitHub OAuth exists for repo access — it is **not** a login identity.) No provider
chosen. **Payment remains TBD (Korea-compatible first, no Stripe assumption).**

## 7. What is shippable now vs gated
- **Now-safe (in this PR):** the `/account` local stub; planning docs.
- **Now-safe (next, no auth):** project-export sensitivity labels (Stage 173 P1); an import
  entry point that feeds `/projects/new/intake` for text/URL (Stage 173 P2); manual
  GitHub/Vercel-style URL intake normalization (Stage 174 P2).
- **Auth/identity-gated:** workspace/team/members/roles/invites/share links; account-level
  connected-integration management; account/workspace-wide export.
- **Approval-gated:** any provider write beyond today's confirm-gated PR comment;
  deploy/promote/rollback; migration; MCP/npm publish.

## 8. Merge-readiness assessment
- **Risk:** low. The only runtime code is a local, non-auth, read-only-status `/account`
  page + pure helpers behind passing tests; everything else is docs. No central-plane, no
  migration, no deploy is triggered by merging.
- **Reversibility:** high. `/account` is additive (new route + one sidebar link); no schema,
  no data, no API contract changed.
- **Self-consistency:** the train's "no auth, no payment, read-first, no client tokens"
  guardrails hold across all 7 docs and the code.
- **Recommendation: PR #155 is merge-ready.** Suggested squash/merge title:
  `Stage 168~174 — Workspace Collaboration / Profile / Integrations Foundation`. Merging
  ships **only** the `/account` stub + the planning record; it does **not** start the
  collaboration build (that stays gated on §6).

## 9. Stage 175 decision — **Option A: PR #155 is merge-ready (Bae approval required)**
Verified green (242/242 + typecheck + build), safety-audited (local-only, no tokens, honest
copy), and self-consistent. The decision is escalated to Bae: (1) **approve the merge of
PR #155**, and (2) the strategic **auth/identity architecture decision** that gates the
entire collaboration layer. This stage does **not** auto-merge.

## 10. Recommended next stage
- If Bae approves: **merge PR #155 → `main`** (merge-only, no deploy), then
  **Stage 176 — Auth / Identity Architecture Planning** (the gating decision from §6;
  provider/session/model selection, still planning until Bae picks a direction).
- Now-safe non-auth follow-ups available independently of the auth decision: export
  sensitivity labels + import→intake entry (Stage 173 P1/P2).
- Deferred (await Bae): dashboard deploy of the motion system + intake i18n already on
  `main`; intake i18n P1; locale propagation; app-wide spinner replacement; MCP publish.
