> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 137 — MCP Preview Tool: Acceptance Graph / Blockers

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).

## Goal
Move the Acceptance Graph and Recurring Blocker helper logic into
`@conclave-ai/workspace-preview` and expose MCP Basic preview wrappers for
`preview_acceptance_graph_summary` / `preview_recurring_blockers` — extending the
Stage 136 shared-package pattern to the derived-signal helpers.

## Helpers moved (dashboard → package)
Via `git mv` into `packages/workspace-preview/src/` (+ their tests, paths fixed
`../src/lib/` → `../src/`):
- `acceptance-graph-derived` · `recurring-blocker-detection` (the Stage 137
  targets).
- **+ 3 optional-input helpers** `intake-benchmark-handoff` ·
  `intake-decision-outcome-link` · `intake-evolution-action-preview`. These were
  slated for Stage 138 in the Stage 134 plan, but the moved
  `acceptance-graph-derived` test builds its fixtures from
  `buildDecisionOutcomeLinkPreview` / `buildEvolutionActionPackPreview` (and the
  decision-outcome test uses `buildBenchmarkHandoffPreview`), so moving them now
  keeps **the moved tests unchanged and green**. All three are pure Class A and
  their dependencies (`intake-agent-run-plan` / `intake-evidence-plan`) are
  already in the package.

(Stage 138 now moves only `agent-tool-recommendation-memory` +
`template-effectiveness-signals`.)

## Dashboard compatibility wrappers
Each moved helper's old dashboard file is a **thin re-export wrapper**:
```js
export * from "@conclave-ai/workspace-preview/acceptance-graph-derived";
```
So all dashboard call sites (`@/lib/acceptance-graph-derived.mjs`,
`@/lib/recurring-blocker-detection.mjs`, `@/lib/intake-benchmark-handoff.mjs`, …)
and the intake page keep working with zero churn.

## Package exports
`packages/workspace-preview/package.json` adds subpath exports for the 5 moved
helpers; `src/index.mjs` + `index.d.mts` re-export them. Package stays `private`
(no publish). No new workspace dependency needed (linked in Stage 136).

## MCP Basic wrapper behavior — `packages/mcp-workspace/src/mcp-basic-preview-tools.mjs`
Two snapshot-based wrappers added:
- `previewAcceptanceGraphSummary(input)` → `buildAcceptanceGraphDerivedView`;
  returns `{ ok:true, kind:"acceptance_graph_summary", preview (nodes/edges/
  signalSummary), …boundary }`. Defaults `title:"Untitled workflow"`,
  `sourceSummary:"MCP Basic preview"`.
- `previewRecurringBlockers(input)` → `buildRecurringBlockerDetectionView`; uses a
  provided `acceptanceGraphView` if present, otherwise the helper derives one
  internally from the snapshots; returns `{ ok:true, kind:"recurring_blockers",
  preview (blockers/blockerCountByType), …boundary }`.
- **Boundary** on every response: `mutatesState:false`, `usesHostedExecution:false`,
  `requiresPayment:false`, `derivedPreviewOnly:true`. Malformed/weak input yields a
  conservative preview (helpers are defensive) — **never throws**.

## Safety boundaries (enforced by tests)
Wrappers do not: call network / central-plane · read `process.env` · mutate saved
records · write files · call an LLM · use a payment provider · execute an agent ·
post PR comments. No Stripe/payment-provider strings in the derived preview. **No
server runtime wiring** — wrapper-level only.

## Verification
- `@conclave-ai/workspace-preview`: **145/145** tests (5 more helper suites moved
  in), typecheck clean.
- `@conclave-ai/mcp-workspace`: **36/36** tests (registry 8 + preview wrappers 7 +
  new graph/blocker wrappers 7 + existing 14), typecheck clean.
- `apps/dashboard`: **248/248** tests (300 → 248: 5 helper suites moved to the
  package), typecheck clean, build green (`/projects/new/intake` 30 kB), lint =
  pre-existing `export/page.tsx` warning only.
- Monorepo `turbo run typecheck`: **57/57**. One source of truth — no logic
  duplication.

## What remains not implemented
MCP server runtime registration of these tools · the remaining preview tools
(agent-tool memory / template signals — Stage 138) · the Web App handoff link
(Stage 139) · publish/version bump (Stage 140 checkpoint, dry-run only).

## Next stage
Stage 138 — MCP Preview Tool: Agent Tool Memory / Template Signals (move
`agent-tool-recommendation-memory` + `template-effectiveness-signals`; add their
wrappers).
