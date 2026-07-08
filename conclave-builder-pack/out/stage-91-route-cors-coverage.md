> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 91 — Route-level CORS Coverage for app.trysimsa.com

**Date:** 2026-06-22
**Branch:** `fix/stage-91-cors-coverage`
**Scope:** Make every browser-facing central-plane route return exact-origin CORS. Code PR only — **no deploy / migration / domain / DNS / generated-link / rename** in this stage.

## Why
Stage 90B verified app.trysimsa.com CORS works for the **core** routes (workspace.ts, github, notifications), but found that several browser-facing modules shipped **no CORS at all** — so the dashboard's client-side calls to those features were blocked from **every** origin (including the existing `conclave-dashboard.vercel.app`), not just app.trysimsa.com. There is no global CORS middleware; CORS was per-route-file and the allowlist was duplicated.

## Audit (before)
| Route module | Browser-facing | CORS before |
|---|---|---|
| workspace.ts | yes (core) | ✅ |
| workspace-github.ts | yes | ✅ |
| workspace-notifications.ts | yes | ✅ |
| workspace-experiment.ts (experiments, benchmark-from-exp, evolution action-packs/impact/learning/timeline, decision) | yes | ❌ |
| workspace-benchmark.ts | yes | ❌ |
| workspace-credits.ts | yes | ❌ |
| workspace-admin-credits.ts | yes (admin dashboard) | ❌ |
| workspace-admin-stats.ts | yes (admin dashboard) | ❌ |

## Change
- **New `apps/central-plane/src/routes/cors.ts`** — single source of truth:
  - `ALLOWED_ORIGINS` (exact origins; `.conclave-ai.dev` suffix kept; **no wildcards**) incl. `https://app.trysimsa.com` + `https://trysimsa.com`.
  - `corsHeaders(origin)` — disallowed origins fall back to the first allowed origin (never echoed).
  - `corsMiddleware` — Hono middleware: answers preflight `OPTIONS` (204 + CORS) and attaches CORS headers to every response (incl. errors).
- **5 previously-uncovered modules** now `app.use("*", corsMiddleware)`: experiment, benchmark, credits, admin-credits, admin-stats.
- **3 existing modules** (workspace, github, notifications) now import `ALLOWED_ORIGINS` from `cors.ts` (removed their duplicated local copies — **single allowlist, no drift**). Their existing per-handler `corsHeaders` + OPTIONS handlers are unchanged (behavior preserved).

## CORS behavior — before / after
| | Before | After |
|---|---|---|
| `app.trysimsa.com` → experiment/benchmark/credits/admin routes | no ACAO (blocked) | **ACAO echoes app.trysimsa.com** |
| legacy `conclave-dashboard.vercel.app` | core only | all browser routes |
| disallowed origin (evil.com) | n/a | **not echoed** (fallback `localhost:3002`) |
| OPTIONS preflight on those routes | not handled | **204 + ACAO** |
| allowlist source | duplicated in 3 files | **1 file (`cors.ts`)** |

No wildcard CORS. Exact origin only.

## Tests (`apps/central-plane/test/workspace-cors.test.mjs`, 9 cases)
- ACAO echoes `app.trysimsa.com` on experiment / benchmark / credits / admin-credits / admin-stats.
- legacy origin still echoed.
- disallowed origin (`evil.com`) NOT echoed (fallback).
- OPTIONS preflight 204 + ACAO on a previously-missing route.
- admin route carries ACAO even on its guard (4xx) response.

## Local verification
- central-plane **1144/1144** pass (+9), typecheck clean. (central-plane has no lint task.)
- No deploy / migration performed.

## After merge (requires explicit Bae approval)
1. Manual `deploy-central-plane` (`confirm=deploy`, `apply-migrations=false`).
2. Smoke from app.trysimsa.com: experiment/benchmark/credits routes now return ACAO; OPTIONS preflight 204; legacy origin still allowed; evil origin not echoed.

## Out of scope / not done
domain/DNS/Vercel ✗ · GitHub App ✗ · generated-link footer ✗ · Telegram rename ✗ · package/env/DB/internal namespace ✗ · D1 migration ✗ · billing ✗.

## Remaining follow-ups
- (later) generated-link transition (PR comment footer etc.) to the live Simsa domain.
- (later, explicit) trysimsa.com apex (redirect vs landing) + simsa.dev docs.
