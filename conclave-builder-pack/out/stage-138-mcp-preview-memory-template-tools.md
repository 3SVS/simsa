> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 138 — MCP Preview Tool: Agent Tool Memory / Template Signals

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).

## Goal
Move the Agent/Tool Recommendation Memory and Template Effectiveness Signal helper
logic into `@conclave-ai/workspace-preview` and expose MCP Basic preview wrappers
for `preview_agent_tool_memory` / `preview_template_signals`. **After Stage 138, all
Stage 126~129 derived moat-signal helpers live in the shared package.**

## Helpers moved (dashboard → package)
Via `git mv` into `packages/workspace-preview/src/` (+ their tests, paths fixed
`../src/lib/` → `../src/`): `agent-tool-recommendation-memory` ·
`template-effectiveness-signals`. Both are standalone (no relative imports); every
helper their tests reference was already moved in Stages 136~137, so no extra
helpers were needed.

## Dashboard compatibility wrappers
Each moved helper's old dashboard file is a **thin re-export wrapper** (2 lines):
```js
export * from "@conclave-ai/workspace-preview/agent-tool-recommendation-memory";
```
All dashboard call sites (`@/lib/agent-tool-recommendation-memory.mjs`,
`@/lib/template-effectiveness-signals.mjs`) and the intake page keep working with
zero churn. The four Stage 126~129 dashboard helper files are now all 2-line
wrappers.

## Package exports
`packages/workspace-preview/package.json` adds the two subpath exports;
`src/index.mjs` + `index.d.mts` re-export them. Package stays `private` (no
publish). No new workspace dependency needed.

## MCP Basic wrapper behavior — `packages/mcp-workspace/src/mcp-basic-preview-tools.mjs`
Two snapshot-based wrappers added:
- `previewAgentToolMemory(input)` → `buildAgentToolRecommendationMemoryView`;
  returns `{ ok:true, kind:"agent_tool_memory", preview (items / topTool / topRole
  / evidenceFitSummary), …boundary }`.
- `previewTemplateSignals(input)` → `buildTemplateEffectivenessSignalsView`;
  returns `{ ok:true, kind:"template_signals", preview (signals / qualityCounts /
  topNeedsRefinement), …boundary }`.
- **Boundary** on every response: `mutatesState:false`, `usesHostedExecution:false`,
  `requiresPayment:false`, `derivedPreviewOnly:true`. Defaults
  `title:"Untitled workflow"`, `sourceSummary:"MCP Basic preview"`. Malformed/weak
  input yields a conservative preview (helpers are defensive) — **never throws**.

The MCP Basic preview wrapper module now covers **all 8** preview tools:
acceptance map · stage plan · agent run plan · evidence plan · acceptance graph
summary · recurring blockers · agent/tool memory · template signals. (Handoff link
is Stage 139.)

## Safety boundaries (enforced by tests)
Wrappers do not: call network / central-plane · read `process.env` · mutate saved
records · write files · call an LLM · use a payment provider · execute an agent ·
post PR comments. No Stripe/payment-provider strings in the derived preview (the
`requiresPayment:false` boundary field is the only "payment" token). **No server
runtime wiring** — wrapper-level only.

## Verification
- `@conclave-ai/workspace-preview`: **175/175** tests (2 more helper suites moved
  in), typecheck clean.
- `@conclave-ai/mcp-workspace`: **41/41** tests (registry 8 + preview wrappers 14 +
  memory/template wrappers 5 + existing 14), typecheck clean.
- `apps/dashboard`: **218/218** tests (248 → 218: 2 helper suites moved to the
  package), typecheck clean, build green (`/projects/new/intake` 30 kB), lint =
  pre-existing `export/page.tsx` warning only.
- Monorepo `turbo run typecheck`: **57/57**. One source of truth — no logic
  duplication; all Stage 126~129 helpers now in the shared package.

## What remains not implemented
MCP server runtime registration of these tools · the Web App handoff link builder
(Stage 139) · publish/version bump (Stage 140 checkpoint, dry-run only).

## Next stage
Stage 139 — MCP Web App Handoff Link (add the safe-context handoff URL builder +
the `create_web_app_handoff_link` wrapper).
