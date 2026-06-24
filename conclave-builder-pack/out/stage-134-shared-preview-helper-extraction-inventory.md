# Stage 134 — Shared Preview Helper Extraction Plan / Inventory

**Date:** 2026-06-24
**Train:** MCP Basic Implementation (Stage 134~140) · branch `feat/stage-134-mcp-basic-helper-inventory` · PR #150 (do not merge until Stage 140 checkpoint).
**Type:** inventory / extraction plan (docs-only). **No code moved, no MCP runtime, no publish, no migration, no payment, no deploy.**

Inventories the dashboard deterministic preview helpers and plans how to share them
with MCP Basic **without duplicating logic or pulling browser/Next dependencies
into MCP.**

## 1. Current state
The MCP Basic tools (Stage 133 MVP) map to deterministic helpers that today live
in `apps/dashboard/src/lib/*.mjs` (+ sibling `.d.mts`), each with `node --test`
tests in `apps/dashboard/test/`. They are pure ESM, imported into TSX via
`@/lib/X.mjs`. The MCP package `@conclave-ai/mcp-workspace@0.8.2` is unpublished
and PR-review-centric (does not yet use these acceptance-preview helpers).

## 2. Why helper extraction matters
MCP Basic and the dashboard must produce **identical** acceptance previews. Two
copies would drift. The helpers are already pure `.mjs`+`.d.mts` with **no React,
Next, browser, env, or network usage**, which makes a clean extraction into a
shared package **low-risk** — both surfaces import one source of truth.

## 3. Inventory table
Audit method: grep each helper for `react | next/ | window | document | localStorage
| process.env | fetch( | AbortSignal` and inspect imports. (All `document`/
`environment` hits below were **copy substrings** — "documentation surface",
"environment variables are documented" — not impurity.)

| Helper | Current path (`apps/dashboard/src/lib/`) | Class | MCP Basic tool served | Dependencies | Tests | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| intake | `intake.mjs` | **A** | (base types/meta for all) | none | ✓ | pure; `document` = copy only |
| intake-prd | `intake-prd.mjs` | **A** | (feeds acceptance-map) | none | ✓ | pure |
| intake-url | `intake-url.mjs` | **A** | (feeds acceptance-map) | none | ✓ | `docs`/`documentation` = copy |
| intake-github-repo | `intake-github-repo.mjs` | **A** | (feeds acceptance-map) | none | ✓ | `documented` = copy |
| intake-ai-built-app | `intake-ai-built-app.mjs` | **A** | (feeds acceptance-map) | none | ✓ | `environment` = copy |
| intake-acceptance-map | `intake-acceptance-map.mjs` | **A** | `preview_acceptance_map` | intake(+4 per-type) | ✓ | pure |
| intake-stage-plan | `intake-stage-plan.mjs` | **A** | `preview_stage_plan` | acceptance-map | ✓ | pure |
| intake-agent-run-plan | `intake-agent-run-plan.mjs` | **A** | `preview_agent_run_plan` | stage-plan | ✓ | pure |
| intake-evidence-plan | `intake-evidence-plan.mjs` | **A** | `preview_evidence_plan` | acceptance-map, stage-plan, agent-run-plan | ✓ | pure |
| acceptance-graph-derived | `acceptance-graph-derived.mjs` | **A** | `preview_acceptance_graph_summary` | none | ✓ | pure; `unknown` inputs defensive |
| recurring-blocker-detection | `recurring-blocker-detection.mjs` | **A** | `preview_recurring_blockers` | acceptance-graph-derived | ✓ | pure |
| agent-tool-recommendation-memory | `agent-tool-recommendation-memory.mjs` | **A** | `preview_agent_tool_memory` | none | ✓ | pure |
| template-effectiveness-signals | `template-effectiveness-signals.mjs` | **A** | `preview_template_signals` | none | ✓ | pure |
| intake-benchmark-handoff | `intake-benchmark-handoff.mjs` | **A** | (optional input to others; not MVP) | none | ✓ | pure; not an MVP MCP tool |
| intake-decision-outcome-link | `intake-decision-outcome-link.mjs` | **A** | (optional input; not MVP) | none | ✓ | pure |
| intake-evolution-action-preview | `intake-evolution-action-preview.mjs` | **A** | (optional input; not MVP) | none | ✓ | pure |
| beta-feedback | `beta-feedback.mjs` | **D** | — | none | ✓ | pure but mailto/Web-App copy; not a preview tool |
| beta-onboarding | `beta-onboarding.mjs` | **D** | — | none | ✓ | UI copy constants only |
| beta-usage-boundary | `beta-usage-boundary.mjs` | **D** | — | none | ✓ | UI copy constants only |
| workspace-agent-workflow-api / admin-agent-workflows-api / other `*-api.ts` | `*.ts` | **C** | — | fetch / `process.env` / "use client" | — | network + dashboard-only; **not pure** |
| workflow-store | `workflow-store.ts` | **C** | — | localStorage | — | `getUserKey` etc.; dashboard-only |

## 4. Classification results
- **Class A — safe to extract now (16):** all `intake*` helpers + `acceptance-
  graph-derived`, `recurring-blocker-detection`, `agent-tool-recommendation-
  memory`, `template-effectiveness-signals` + the three optional inputs
  (`intake-benchmark-handoff`, `intake-decision-outcome-link`,
  `intake-evolution-action-preview`). All pure `.mjs`+`.d.mts`, local-only
  imports, fully tested. **No B (adaptation) needed** — the audit found no UI/
  route/env coupling in any of them.
- **Class C — keep dashboard-only:** the `*-api.ts` clients (network, `process.env`,
  `"use client"`) and `workflow-store.ts` (localStorage). MCP supplies its own
  transport/userKey, so these stay out.
- **Class D — not relevant to MCP Basic preview tools:** `beta-feedback`,
  `beta-onboarding`, `beta-usage-boundary` (pure, but UI/mailto copy — not preview
  generators). They can be referenced for MCP copy later but need not be extracted.

## 5. Recommended shared package structure
`packages/workspace-preview` → published later as `@conclave-ai/workspace-preview`.
**Pure deterministic helpers only — used by both Dashboard and MCP Basic.**
```text
packages/workspace-preview/
  package.json            # type: module; node --test; no React/Next/dom deps
  src/
    intake.mjs · intake-prd.mjs · intake-url.mjs · intake-github-repo.mjs
    intake-ai-built-app.mjs · intake-acceptance-map.mjs · intake-stage-plan.mjs
    intake-agent-run-plan.mjs · intake-evidence-plan.mjs
    acceptance-graph-derived.mjs · recurring-blocker-detection.mjs
    agent-tool-recommendation-memory.mjs · template-effectiveness-signals.mjs
    intake-benchmark-handoff.mjs · intake-decision-outcome-link.mjs
    intake-evolution-action-preview.mjs
    index.mjs               # re-exports
    *.d.mts
  test/                     # moved pure helper tests
```
**Hard rule:** No React · No Next · No browser API · No network · No env · No
mutation · No hosted execution.

## 6. Extraction strategy (staged)
- **Stage 134** — inventory only (this doc). No code moved.
- **Stage 135** — create `packages/workspace-preview` skeleton (package.json,
  empty `src/index.mjs`, tsconfig/test config); wire into pnpm/turbo. No helper
  moved yet (or one trivial fixture to prove the build). Dashboard unchanged.
- **Stage 136** — move intake acceptance-map / stage-plan / agent-run-plan /
  evidence-plan (+ the 5 base intake helpers they depend on) into the package;
  re-point dashboard imports to `@conclave-ai/workspace-preview`; move their tests.
- **Stage 137** — move acceptance-graph-derived + recurring-blocker-detection.
- **Stage 138** — move agent-tool-recommendation-memory + template-effectiveness-
  signals (+ optionally the 3 input helpers).
- **Stage 139** — add the Web App handoff link builder (new pure helper) + MCP
  tool wrappers.
- **Stage 140** — checkpoint; `npm pack` dry-run only; **no publish** without
  explicit approval.

**Per-move safety:** move helper + its `.d.mts` + its test together; keep the
dashboard `@/lib/X.mjs` import working via a thin re-export **or** repoint imports
in the same commit; run dashboard + package tests each move so parity stays green.

**Alternative (if extraction risk spikes):** have MCP import the dashboard helpers
directly only if package boundaries allow — but this is discouraged (long-term
duplication / cross-app coupling). Prefer extraction.

## 7. Test strategy
Keep existing dashboard tests green throughout. As each helper moves, **move its
pure `node --test` test into the package** (the package owns helper correctness);
the dashboard keeps only integration/usage where relevant. MCP tool tests verify
**wrapper behavior only** (input parsing → helper call → output shape). Required
test classes: malformed-input (no throw) · no-secret-echo · no-mutation · no-
network · no-payment/provider. No publish-time tests beyond `npm pack` dry-run.

## 8. MCP tool mapping (confirmed)
`preview_acceptance_map`→intake-acceptance-map · `preview_stage_plan`→intake-stage-plan
· `preview_agent_run_plan`→intake-agent-run-plan · `preview_evidence_plan`→intake-
evidence-plan · `preview_acceptance_graph_summary`→acceptance-graph-derived ·
`preview_recurring_blockers`→recurring-blocker-detection · `preview_agent_tool_memory`
→agent-tool-recommendation-memory · `preview_template_signals`→template-
effectiveness-signals. `create_web_app_handoff_link`→new helper (Stage 139). All
read-only/preview; none mutate.

## 9. Risks and mitigations
- Drift between two copies → single shared package (this plan).
- Extraction breaks dashboard imports → move helper+types+test together; repoint
  imports in the same commit; run both test suites each move.
- Accidental Next/browser dep into the package → package has no React/Next/dom in
  deps; lint/test guards; helpers are already pure (audited here).
- Node20 CI `.ts` type-strip limitation → keep helpers `.mjs`+`.d.mts` (already
  the convention); no `.ts` runtime in the package.
- Scope creep into MCP runtime → Stage 134 is inventory-only; runtime starts at
  Stage 135 skeleton.

## 10. Stage 134 decision
**Inventory only — no code moved in Stage 134.** All 16 candidate helpers are
**Class A (pure, extractable now)**; no adaptation (Class B) needed. Proceed to
Stage 135 (package skeleton), then move helpers in Stages 136~138.

## 11. Recommended next stage
**Stage 135 — MCP Basic Tool Skeleton** (and `packages/workspace-preview`
skeleton): create the package + MCP server scaffolding without moving helpers or
exposing tools yet; no publish.

---

*Inventory/plan only. No code moved, no MCP runtime/publish, no package version
bump, no npm, no central-plane endpoint, no migration, no payment/Stripe, no
hosted execution, no deploy.*
