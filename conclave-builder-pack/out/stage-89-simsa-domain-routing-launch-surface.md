> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 89 — Simsa Domain Routing & Launch Surface

**Date:** 2026-06-22
**Branch:** `chore/stage-89-simsa-domain-routing`
**Scope:** Domain/routing readiness + minimal additive allowlist code. **No DNS, no deploy, no migration, no GitHub App change in this Stage.**

## Goal
Prepare the launch surface (trysimsa.com / app.trysimsa.com / simsa.dev) so domain
activation can be done later under explicit approval — without breaking the existing
`conclave-dashboard.vercel.app` dashboard or the central-plane worker.

---

## 1. Domain architecture (decision)

| Domain | Role | Stage 89 state |
|--------|------|----------------|
| `trysimsa.com` | Marketing / landing (redirect to app initially, landing later) | reserved; allowed as exact origin |
| `app.trysimsa.com` | Dashboard app — Vercel custom-domain alias of current dashboard | code allowlisted; DNS pending |
| `simsa.dev` | Developer/docs surface (reserve / redirect) | reserved only; not pointed at prod |
| `conclave-dashboard.vercel.app` | **Legacy fallback — keep** | unchanged |
| `conclave-ai.seunghunbae.workers.dev` / `conclave-ai.dev` | central-plane worker + legacy domain | **unchanged / frozen** until an explicit central-plane migration plan |

Invariants honored: existing dashboard URL and worker URL are **not** broken; internal
namespace (`conclave`) frozen; no wildcard origins.

---

## 2. Audit results (domain/origin references)

108 files matched; the runtime-critical surfaces (A–F):

- **A. Dashboard → central-plane base URL** — `apps/dashboard/src/lib/workspace-api.ts`:
  `CENTRAL_PLANE_URL = process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ?? "https://conclave-ai.seunghunbae.workers.dev"`.
  → **env-driven; moving the dashboard to app.trysimsa.com needs NO code change** (API target is the worker, independent of dashboard origin).
- **B. central-plane CORS allowlists** — 3 identical `ALLOWED_ORIGINS` arrays:
  `routes/workspace.ts`, `routes/workspace-github.ts`, `routes/workspace-notifications.ts`.
  `corsHeaders()` allows exact list ∪ `*.conclave-ai.dev` suffix (legacy, kept).
- **C. OAuth** — `workspace/github-oauth.ts`:
  - `redirect_uri = WORKSPACE_GH_REDIRECT_URI ?? ${PUBLIC_BASE_URL or worker}/workspace/github/oauth/callback`
    → **the GitHub OAuth callback points at the WORKER, not the dashboard origin**.
    → **Moving the dashboard to app.trysimsa.com does NOT require changing the GitHub App callback URL.**
  - `ALLOWED_RETURN_ORIGINS` + `isAllowedReturnTo()` (exact origin match) gate where the user is
    returned after connect — this **does** need app.trysimsa.com.
- **D. Generated links** — `workspace/pr-comment.ts` footer URL = `https://conclave-ai.dev` (text `[Simsa]`),
  Telegram `integration-telegram`/`workspace-notifications`, builder-pack export. **Left unchanged this Stage** (see §6).
- **E. docs / marketing / historical** — not changed.
- **F. internal/frozen** — `wrangler.toml`, `env.ts`, npm scopes, localStorage keys — not touched.

---

## 3. Code changes (minimal, additive, exact-origin)

All additive; existing origins kept; **no wildcards**.

- `apps/central-plane/src/routes/workspace.ts` — `ALLOWED_ORIGINS` += `https://app.trysimsa.com`, `https://trysimsa.com`
- `apps/central-plane/src/routes/workspace-github.ts` — same
- `apps/central-plane/src/routes/workspace-notifications.ts` — same
- `apps/central-plane/src/workspace/github-oauth.ts` — `ALLOWED_RETURN_ORIGINS` += same two
- `apps/dashboard/src/lib/brand.mjs` (+`.d.mts`) — `appDomain: "app.trysimsa.com"`, `legacyDashboardDomain: "conclave-dashboard.vercel.app"` (config constants; not yet used in visible copy)
- Tests:
  - `apps/central-plane/test/workspace-github.test.mjs` — `isAllowedReturnTo` accepts app.trysimsa.com/trysimsa.com (exact) and **rejects** `evil.trysimsa.com` / `app.trysimsa.com.evil.com`
  - `apps/dashboard/test/brand.test.mjs` — pins new `appDomain` / `legacyDashboardDomain`

**Effect requires a deploy to go live** — code is staged in this PR only; activation is gated (§7).

---

## 4. CORS / OAuth impact summary
- CORS: app.trysimsa.com + trysimsa.com will be accepted once central-plane is deployed. Legacy origins retained. Exact-match only.
- OAuth callback URL (GitHub App setting): **no change needed** (callback is worker-based).
- OAuth returnTo: app.trysimsa.com now permitted (exact). Look-alike subdomains rejected (tested).
- `NEXT_PUBLIC_CENTRAL_PLANE_URL`: no change (dashboard keeps calling the worker).

---

## 5. Generated-link policy (Stage 89)
- **Do NOT switch generated links (PR comment footer / Telegram / export) to trysimsa.com until DNS + custom domain are confirmed live.**
- PR comment footer currently uses legacy `https://conclave-ai.dev` (text `[Simsa]`). **TODO (post-domain stage):** switch footer URL to the live Simsa domain once activated.

---

## 6. Vercel / DNS operator checklist (do under explicit approval)

```
Vercel (dashboard project: conclave-dashboard):
[ ] Add app.trysimsa.com as a custom domain to the dashboard project
[ ] Configure DNS CNAME for app.trysimsa.com → cname.vercel-dns.com (per Vercel UI)
[ ] Wait for Vercel domain verification (SSL issued)
[ ] Confirm https://app.trysimsa.com loads the dashboard (200, title "Simsa …")

trysimsa.com (apex):
[ ] Decide landing vs redirect (Stage 89 default: redirect apex → app, landing later)
[ ] If redirect: configure A/redirect per registrar/Vercel
[ ] If landing: separate marketing surface = a later stage

simsa.dev:
[ ] Reserve / decide docs redirect; DO NOT point at production app unless intended

Central-plane (deploy gated — separate approval):
[ ] Deploy central-plane so the new exact CORS origins (app.trysimsa.com, trysimsa.com) take effect
[ ] Verify OPTIONS/preflight from https://app.trysimsa.com returns the echoed exact origin
[ ] Keep legacy origin https://conclave-dashboard.vercel.app working

GitHub OAuth:
[ ] No GitHub App callback change needed (callback is the worker URL)
[ ] Verify GitHub connect flow end-to-end from https://app.trysimsa.com (returnTo now allowlisted)

Post-domain (later stage):
[ ] Switch PR comment footer / Telegram / export links to the live Simsa domain
```

---

## 7. Rollback plan
- Remove `app.trysimsa.com` custom domain from the Vercel dashboard project → traffic falls back to `conclave-dashboard.vercel.app` (unchanged).
- The added allowlist origins are inert until deployed and harmless if a domain is removed (no one will send those origins). To fully revert, drop the added lines (pure additive) and redeploy.
- No DB, no migration, no destructive DNS in this Stage → nothing to roll back DB-side.

## 8. Tests / local verification
- central-plane: **1135/1135** pass (+1 Stage 89 origin test), typecheck clean.
- dashboard: **191/191** pass (brand drift-guard extended), typecheck clean.
- lint: only the pre-existing `export/page.tsx` exhaustive-deps warning (no new issues).
- No deploy performed.

## 9. Remaining follow-ups
- Operator: run §6 checklist (Vercel custom domain + DNS) under approval.
- Deploy central-plane (gated) so CORS origins activate.
- Post-domain stage: flip generated-link URLs (PR comment footer etc.).
- Decide trysimsa.com apex behavior (redirect vs landing) and simsa.dev docs.

## 10. Recommendation — actual domain activation
Proceed in this order, each under explicit Bae approval:
1. Merge this PR (code only; no live effect yet).
2. Vercel: add `app.trysimsa.com` custom domain + DNS CNAME; verify it loads.
3. Deploy central-plane (gated) to activate CORS for the new origins.
4. Verify GitHub connect + workspace API from `https://app.trysimsa.com`.
5. Later stage: switch generated links + decide apex/landing + simsa.dev.

## Success criteria — met
Launch surface for trysimsa.com / app.trysimsa.com / simsa.dev is safely designed;
required code/config/tests are staged and green; activation can proceed under separate
approval without breaking existing production URLs. ✓
