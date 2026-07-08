> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 136 — MCP Preview Tool: Acceptance Map / Stage Plan / Agent Run Plan (+ Evidence Plan)

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).

## Goal
Move the first core deterministic preview helpers into
`@conclave-ai/workspace-preview` and expose MCP Basic preview wrappers for
`preview_acceptance_map` / `preview_stage_plan` / `preview_agent_run_plan` /
`preview_evidence_plan` — proving the shared package powers **both** the dashboard
and MCP Basic **without duplicating logic.**

## Helpers moved (dashboard → package)
Dependency closure of the 4 target helpers required moving **9** pure helpers
(`.mjs` + `.d.mts`) via `git mv` into `packages/workspace-preview/src/`:
`intake`, `intake-prd`, `intake-url`, `intake-github-repo`, `intake-ai-built-app`
(base), `intake-acceptance-map`, `intake-stage-plan`, `intake-agent-run-plan`,
`intake-evidence-plan`. Their **9 test files** moved to
`packages/workspace-preview/test/` (import paths fixed `../src/lib/` → `../src/`).

## Compatibility wrapper approach (dashboard imports unchanged)
Each old dashboard helper file (`apps/dashboard/src/lib/<name>.mjs` + `.d.mts`) is
now a **thin re-export wrapper**:
```js
export * from "@conclave-ai/workspace-preview/<name>";
```
So every existing dashboard import (`@/lib/intake-acceptance-map.mjs`, etc.) and
every other dashboard helper that imports these (benchmark-handoff,
decision-outcome-link, evolution-action-preview, the Stage 126~129 signal helpers)
keeps working with **zero churn** to call sites.

## Package exports
`packages/workspace-preview/package.json` adds subpath exports for each helper
(`./intake`, `./intake-acceptance-map`, …). `src/index.mjs` + `index.d.mts`
re-export all 9 helpers (+ safety). Package stays `private` (no publish). Workspace
dependency `@conclave-ai/workspace-preview: workspace:*` added to **apps/dashboard**
and **packages/mcp-workspace**; `pnpm install` linked it.

## MCP Basic wrapper behavior — `packages/mcp-workspace/src/mcp-basic-preview-tools.mjs`
Pure local wrappers over the shared helpers:
`previewAcceptanceMap` / `previewStagePlan` / `previewAgentRunPlan` /
`previewEvidencePlan`, each `({ type, rawInput }) → { ok:true, kind, preview, …boundary }`.
- **Boundary object** on every response: `mutatesState:false`,
  `usesHostedExecution:false`, `requiresPayment:false`, `derivedPreviewOnly:true`.
- **Validation:** unknown intake type → `{ ok:false, error:"invalid_type" }`;
  empty `rawInput` → `{ ok:false, error:"missing_input" }` (safe object, **never
  throws**). Malformed input handled defensively.
- **No server runtime wiring yet** — wrapper-level only (full MCP protocol
  integration is a later stage).

## Safety boundaries (enforced by tests)
Wrappers do not: call network / central-plane · read `process.env` · mutate saved
records · write files · call an LLM · use a payment provider · execute an agent ·
post PR comments. No Stripe/payment-provider strings in output. The shared package
`safety` metadata remains true (no network/mutation/hosted-execution; payment
provider TBD).

## Verification
- `@conclave-ai/workspace-preview`: **93/93** tests (9 moved helper suites + safety
  7), typecheck clean.
- `@conclave-ai/mcp-workspace`: **29/29** tests (registry 8 + new preview wrappers 7
  + existing 14), typecheck clean (build unaffected).
- `apps/dashboard`: **300/300** tests (386 → 300: 86 helper tests moved to the
  package), typecheck clean, build green (`/projects/new/intake` 30 kB), lint =
  pre-existing `export/page.tsx` warning only.
- Monorepo `turbo run typecheck`: **57/57**. No logic duplication — one source of
  truth, dashboard + MCP both consume it.

## What remains not implemented
MCP server runtime registration of these tools · the remaining preview tools
(graph/blockers/agent-tool memory/template — Stages 137~138) · the Web App handoff
link (Stage 139) · publish/version bump (Stage 140 checkpoint, dry-run only).

## Next stage
Stage 137 — MCP Preview Tool: Evidence Plan / Acceptance Graph / Blockers (move
`acceptance-graph-derived` + `recurring-blocker-detection`; add their wrappers).
