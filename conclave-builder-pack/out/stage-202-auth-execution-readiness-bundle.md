> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 202 — Auth Execution Readiness Bundle

**Date:** 2026-06-25
**Branch:** `docs/stage-201-better-auth-package-version-check` (auth train, continues 201) · **Base / main:** `b344e0f` · production deploy: `9b645af` (Plan Map) · live: https://app.trysimsa.com
**Type:** readiness consolidation / docs only. **No Better Auth install, no `pnpm add`, no package.json/lockfile change, no login routes, no session middleware, no OAuth, no migration, no local D1 migration run, no Vercel rewrite, no CORS code, no deploy, no MCP/npm publish, no payment/billing, no domain/DNS, no server write, no DB persistence, no token/secret request-print-store, no env-var change, no live-dashboard change. Stale dogfood PRs #121~130 not touched.**

## 1. Executive summary
The **Stage 201 package/version plan is ready**. This document **consolidates next-step readiness**
and records a **less-fragmented operating model**. **Nothing is approved here:** no package install,
no local spike, no migration/auth implementation/deploy. **Next work should move in larger bundled
stages**, not tiny docs-only fragments — while keeping the real risk gates (merge, package install,
migration, deploy, auth implementation, DNS/domain, payment, publish) **separate**.

## 2. Current main and branch state
- `main` = **`b344e0f`** (Release: Stage 197~198). **Production still at `9b645af`** (Plan Map).
- Branch = `docs/stage-201-better-auth-package-version-check`.
- Stage 201 doc: `conclave-builder-pack/out/stage-201-better-auth-package-version-final-check.md`.
- Stage 202 doc: `conclave-builder-pack/out/stage-202-auth-execution-readiness-bundle.md` (this).
- **Better Auth not installed · no auth route · no migration · `/account` still local stub · Plan
  Map still read-only.**

## 3. Stage granularity update (new working rule)
- **Docs/research items should be bundled when safe;** PR prep can be **in the same stage** as
  readiness consolidation.
- **Kept separate (gates):** merge · package install · migration · deploy · auth implementation ·
  publish/DNS/payment.
- **Practical threshold:**
  - **Bundle** if a task is **likely < ~10 minutes and docs-only**.
  - **Keep as a gate** if it changes **runtime, database, the package graph, secrets, deployment, or
    external services**.

## 4. Package / version final state (from Stage 201)
- **Package:** **`better-auth`** (single core package, MIT).
- **Line:** **`1.6.x`** (latest reported **`1.6.20`**) — **supersedes the earlier 1.5.x assumption**.
- **Pin strategy:** **exact version**, **re-checked immediately before install** (Better Auth ships
  ~weekly).
- **Install target:** **`apps/central-plane`** only; **root `pnpm-lock.yaml`** change expected.
- **Adapter:** **built-in Kysely + native D1** preferred (no Drizzle, **no separate adapter
  package**) — unless a later re-verification contradicts this **[verify]**.
- **Hono:** **no separate package** (handler mount).

## 5. Local spike readiness state
**Ready (decided/planned):**
- Architecture selected (Better Auth primary, WorkOS fallback, Simsa-owned collaboration,
  central-plane/Workers/D1 runtime — Stage 193).
- **Cookie/CORS topology selected** (Option A same-origin Vercel rewrite primary; Option B auth/API
  subdomain fallback — Stage 198).
- **Package/version plan ready** (Stage 201).
- **Approval phrases defined** (Stage 197); **rollback + stop conditions defined** (Stage 197/201).

**Not ready / not approved:**
- Package install · local auth route · D1 migration draft · session middleware · login/logout
  implementation · production env · deploy.

## 6. Approval gates before any local spike (exact phrases — separate, non-transferable)
| Action | Required phrase |
|---|---|
| Local spike | **"Better Auth local spike approved."** |
| Package/version install | **"Better Auth package/version approved."** |
| Local migration draft | **"Local auth migration draft approved."** |
| Production migration | **"Production auth migration approved."** |
| Auth implementation beyond local spike | **"Better Auth implementation approved."** |
| Production dashboard deploy | **"Dashboard deploy approved."** |
**Approvals are separate and non-transferable.** Package approval does **not** approve route
implementation; local-spike approval does **not** approve production deploy; **PR merge approval does
NOT imply any of these.**

## 7. Recommended next execution path
- **Stage 203 — Merge Gate** for the Stage 201~202 PR — only after **"PR #<n> merge approved."**
- **Stage 204 — Better Auth Local Spike Execution Bundle** — only if Bae provides **both**
  **"Better Auth local spike approved."** *and* **"Better Auth package/version approved."** Stage 204
  would bundle: exact then-latest package re-check · package install · local-only auth skeleton ·
  local-only route **behind a flag** · **no production env / no production deploy / no production
  migration** · tests + rollback report. **Do not start Stage 204 in this stage.**

## 8. Safety boundary
This PR must remain **docs-only**: no `package.json`, no `pnpm-lock`, no migration, no app code, no
CORS code, no Vercel rewrite, no env, no tokens, no live behavior change.

## 9. Decision — **Option A: execution readiness bundle ready for PR**
The Stage 201 package/version final check + this Stage 202 readiness bundle are complete, the
operating-model (granularity) update is recorded, and verification passes. Ready to open a docs-only
PR. (Not Option B/C — no correction needed, no blocking uncertainty.)
