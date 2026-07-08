> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 174 — GitHub / Vercel Integration UX + Safety Model

**Date:** 2026-06-24
**Branch:** `docs/stage-168-workspace-collaboration-integrations` (Stage 168~174 train, PR #155) · **Base:** `main` @ `9c4e593` · **HEAD before this stage:** `91c246f`
**Type:** planning (docs-only). **No deploy, no central-plane, no migration, no auth/OAuth/token implementation, no payment/Stripe, no hosted execution, no MCP/npm publish, no provider write action, no token/secret output.**

## 1. Current inventory (verified)
### GitHub — backend capabilities that already exist
- `apps/central-plane/src/workspace/github-oauth.ts` (OAuth), `github-db.ts`, `github-pr.ts`;
  `apps/central-plane/src/crypto.ts` (`encrypt`/`decrypt`) → **encrypted token storage,
  server-side only**. GitHub OAuth + PR access is real and shipped.
### GitHub — UI capabilities that already exist
- `projects/[id]/settings` (repo connect), `projects/[id]/github` (PR list / link / review),
  `projects/[id]/github/history` (+`[runId]`), and benchmark detail → **post PR comment**
  (existing **write** action, preview-first + `confirm`, GitHub-backed).
### GitHub — UI capabilities that are missing
- Account/workspace-level **connected-account management** (connect/disconnect/refresh,
  real provider identity display) beyond the Stage 170 placeholder; a unified
  **integrations panel**; explicit connection-status/permission states.
### Vercel — capabilities that already exist
- `packages/platform-vercel/src/index.ts` is a **CLI/platform deploy adapter** (not a
  dashboard integration). Vercel **preview URLs** are only consumed as generic URL intake
  (`product_url` / `ai_built_app`; `intake-ai-built-app.mjs` references "deployment"). **No
  Vercel OAuth / connect / deployment-evidence integration.**
### Vercel — UI capabilities that are missing
- Everything: connect, project link, deployment metadata read, status, disconnect.
### Existing artifact-sharing surfaces (already shipped)
- Project **export** (builder-pack zip + central-plane `/export`), MCP **handoff link**
  (secret-free), **copy-to-clipboard** (summaries/prompts/PR-comment bodies),
  **benchmark→GitHub PR-comment** artifact share. (Stage 172/173.)

## 2. Product UX model (proposed, not implemented)
- **/account → Connected accounts:** GitHub (real identity + status once auth), Vercel
  (Planned) — extends the Stage 170 placeholder.
- **Project-level integrations panel:** per-project connected repo / deployment + evidence
  status (read-first), with connect/refresh/disconnect states.
- **Import/intake source picker:** GitHub repo / GitHub PR / Vercel preview URL → feed
  `/projects/new/intake` (Stage 173 import→intake bridge).
- **Evidence collection status:** "reading…", "read N items", "unavailable", with source
  attribution; results without source verification remain **not_verified**.
- **Disconnect / reconnect / refresh** states; **read-only connected identity** display;
  **permission + workspace-ownership labels** (who owns the connection).

## 3. GitHub integration UX
**States:** not connected · connected (read-only) · connected + repo selected ·
insufficient permissions · token expired / reconnect required · repo unavailable ·
write-action-requires-approval · disconnected.
**Actions:**
- **connect GitHub** — *planned / auth-gated* (OAuth backend exists, but account-level
  connect needs the auth/workspace decision).
- **select repo** — *planned / auth + workspace-gated* (repo connect exists per-project
  via settings today).
- **read repo metadata / PR / issue context** — **read-first** (backend supports PR read).
- **create PR comment** — **already exists**, stays **approval-gated** (preview-first +
  `confirm`; the MCP gated write tool stays off-by-default).
- **write file / open PR / merge** — **out of scope**, explicit approval-gated.

## 4. Vercel integration UX
**States:** not connected · preview URL provided manually · deployment metadata available ·
deployment unavailable · project not linked · account/team mismatch · token expired /
reconnect required.
**Actions:**
- **paste Vercel preview URL into intake** — **now-safe** (treated as plain URL input via
  the existing `product_url`/`ai_built_app` intake; no fetch/auth).
- **fetch/read deployment metadata** — *future read-first integration* (auth + integration).
- **link Vercel project** — *auth / workspace / integration-gated*.
- **trigger deploy / promote / rollback** — **out of scope**, explicit approval-gated.

## 5. Safety model (hard rules)
- **Never print or store tokens client-side**; token **encryption/server-side only**
  (as GitHub does via `crypto.ts`).
- **Least-privilege scopes**; explicit **connect/disconnect**; **visible account identity**.
- **Read-first evidence collection**; **no destructive/write actions by default**.
- **Any write action requires explicit Bae approval**; production **deploy/promotion/
  rollback is approval-gated**; OAuth/session/auth implementation needs **separate
  approval**.
- **Integration ownership should eventually belong to the workspace, not local browser
  state** (Stage 171 Phase 5).
- **Evidence without source verification remains `not_verified`.**

## 6. Role / permission implications (from Stage 171/172)
- **Owner/Admin** manage connected integrations (later).
- **Editor/Reviewer/Viewer** may *consume* integration-derived evidence per project
  permission.
- The current **`userKey` model is not sufficient** for real team integration ownership —
  real integration management is **blocked by the auth/workspace model**.

## 7. Relationship with Stage 173 import/export
- **GitHub repo/PR import** feeds `/projects/new/intake` (`github_repo` / `pull_request`
  types) — not a separate product island.
- **Vercel preview URL** feeds the `product_url` (/`ai_built_app`) intake flow.
- **Exported artifacts** may include integration **metadata** but **never tokens/secrets**.
- **Simsa-artifact re-import** preserves **source labels** but does **not** imply a live
  connection (re-import ≠ reconnect).

## 8. Now-safe vs gated implementation plan
- **Now-safe:** docs/planning; UI copy/placeholders (Stage 170 cards); **manual
  GitHub/Vercel-style URL intake** (no new fetch/auth/write); export labels mentioning
  source metadata **without secrets**.
- **Auth/integration-gated:** OAuth connect/disconnect; server-side token storage (GitHub
  backend exists but account-level connect is gated); repo/project selection; provider
  account-identity display; workspace-owned integrations.
- **Approval-gated:** PR comments / any provider write; deploy/promote/rollback;
  production deploy/domain/DNS; migration; MCP/npm publish.

## 9. Suggested implementation phases
- **P1** connected-account placeholder polish + safety copy (now-safe).
- **P2** manual GitHub/Vercel URL intake normalization (now-safe).
- **P3** read-first **GitHub** evidence collection — after the auth decision.
- **P4** read-first **Vercel** deployment evidence — after the auth decision.
- **P5** workspace-owned integration management (Stage 171 Phase 5).
- **P6** approval-gated write actions (PR comment beyond today's confirm; deploy/promote).

## 10. Stage 174 decision — **Option A: Integration UX + safety model plan ready**
GitHub backend (OAuth + encrypted tokens + PR) and project-level GitHub UI (repo connect,
PR link/review/history, PR-comment post with confirm) **exist**; Vercel has **only** a CLI
deploy adapter + URL-as-intake (no dashboard integration). The UX states, action set,
safety model (read-first, no client tokens, write/deploy approval-gated), role/ownership
implications, and import/export relationship are defined. No implementation occurred.
**Account/workspace-level integration management is blocked by the auth/workspace
decision.** Payment remains **TBD** (Korea-compatible first, no Stripe).

**Stage 175 should be a PR #155 checkpoint / merge-readiness review — not an automatic
merge.** Do not merge until then + Bae approval.

## 11. Recommended next stage
**Stage 175 — Collaboration Foundation Checkpoint / PR #155 Merge-Readiness Review.**
