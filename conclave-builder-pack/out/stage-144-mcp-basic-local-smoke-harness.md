> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 144 — MCP Basic Local Smoke Harness

**Date:** 2026-06-24
**Branch:** `feat/stage-141-mcp-runtime-wiring-planning` (Stage 141~147 train, PR #151) · **Base:** `main` @ `e3d6fa4`
**Type:** local test/smoke harness. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Prove MCP Basic can run through the **built** server with **no credentials and no
network**: the 9 free Basic tools register, connected/network tools do not, and the
preview + handoff dispatch return safe, boundary-preserving results. Local-only.

## 2. Smoke script path
`packages/mcp-workspace/scripts/smoke-basic.mjs` — uses the exported helpers
`getMcpToolRegistrationPlan` + `runBasicPreviewTool` from the compiled
`dist/server.js`. (A full external stdio-host run is deferred — see Limitations.)

## 3. How to run
```bash
pnpm --filter @conclave-ai/mcp-workspace build      # smoke imports dist/
pnpm --filter @conclave-ai/mcp-workspace smoke:basic
```
Added package script: `"smoke:basic": "node scripts/smoke-basic.mjs"` (alongside the
existing `smoke`). Exit code `0` on pass, `1` on failure. Sample output:
```
MCP Basic smoke passed:
- mode: basic_only
- tools: 9
- preview_acceptance_map: ok
- create_web_app_handoff_link: ok
- network: not required
- credentials: not required
```
The output is intentionally short and **prints no user input, token, or secret**.

## 4. What it verifies
1. Basic-only registration plan `mode === "basic_only"` with **exactly 9** tools.
2. All 9 Basic tool names present (8 preview + `create_web_app_handoff_link`).
3. `list_projects` / `get_project` / `list_pull_requests` / `run_pr_review` /
   `post_pr_comment` are **absent**.
4. `preview_acceptance_map` dispatch → `ok:true`.
5. preview `requiresPayment:false` and 6. `mutatesState:false`.
7. `create_web_app_handoff_link` dispatch → `ok:true`.
8. handoff URL starts with `https://app.trysimsa.com/projects/new/intake`.
9. handoff `boundary.requiresPayment:false` and `boundary.assumesPaymentProvider:false`.
10. malformed input (null/undefined/number/string/array/bad-shape) does not crash.

## 5. Basic-only no-credential behavior
`runBasicSmoke()` clears `CONCLAVE_USER_KEY`, `CONCLAVE_API_BASE_URL`,
`CONCLAVE_CENTRAL_PLANE_URL`, `CONCLAVE_ENABLE_PR_COMMENT_POST`,
`CONCLAVE_MCP_ENABLE_POST_COMMENT` during the run and **restores them afterward**
(so importing it in tests is side-effect-free). It builds nothing networked and
calls no central-plane endpoint — the dispatch path is the pure local wrappers only.

## 6. Tests
`packages/mcp-workspace/test/smoke-basic.test.mjs` imports `runBasicSmoke` and
asserts: passes with no failures; reports `basic_only` + 9 tools; preview/handoff
dispatch ok with `networkRequired:false` / `credentialsRequired:false`; and that the
smoke runs as Basic-only even when `CONCLAVE_USER_KEY` is set, restoring it after.
No `child_process`, no timers — not flaky.

**Results:** mcp-workspace **68/68** (was 64; +4), workspace-preview **186/186**,
mcp-workspace typecheck ✓, monorepo typecheck **57/57** ✓. `smoke:basic` exits `0`.
Dashboard unaffected (no shared-export change).

## 7. Limitations
This is a **local registration + dispatch** smoke (it exercises the same dispatch
function the registered MCP handlers call, against the built server). It does not
spin up a real stdio client/transport. Full external MCP-host verification (Claude
Desktop / Cursor / Windsurf launching the binary, listing tools, calling one) is a
**manual** procedure documented in **Stage 145** (Docs / Installation Guide), to
avoid scope creep and a flaky in-process transport test here.

## 8. Not done (by design)
No `npm publish` / MCP publish / version bump (`@conclave-ai/mcp-workspace` stays
`0.8.2`, unpublished). No payment/Stripe/payment-provider assumption (provider
**TBD**, Korea-compatible first). No hosted execution, no central-plane, no
migration, no deploy, no auth/login/session, no token/secret output.

## 9. Next stage
**Stage 145 — MCP Basic Docs / Installation Guide** (README/config for running the
free Basic server with no credentials, plus the manual MCP-host smoke steps).
**Do not merge PR #151** until the Stage 147 checkpoint + Bae approval.
