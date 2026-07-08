> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 101 — Unified Intake Model

**Date:** 2026-06-23
**Branch:** `feat/stage-101-unified-intake` · base `main` `78f766f`
**Train:** Stage 101~108 — Intake to Staged Acceptance Core (this is the foundation stage).

## Goal
Make the public promise real inside the product: *start from an idea, PRD, product URL, GitHub repo, pull request, or AI-built app — Simsa turns it into a staged acceptance workflow.* Stage 101 introduces the **shared intake model + a safe first UI path + deterministic local preview** — not the per-type analyzers (those are Stages 102+).

## Product principle
One intake system with multiple starting points — not six products. Every intake type maps to the **same** downstream outputs.

## Intake types
`idea` · `prd` · `product_url` · `github_repo` · `pull_request` · `ai_built_app`

## Shared model — `apps/dashboard/src/lib/intake.mjs` (+ `.d.mts`)
- `WORKSPACE_INTAKE_TYPES` (6) · `INTAKE_OUTPUTS` (6) · `INTAKE_OUTPUT_LABELS`
- `INTAKE_META[type]` → `{ type, label, description, placeholder, inputHint }`
- `isWorkspaceIntakeType(value)`
- `buildIntakeDraft(type, rawInput)` → `WorkspaceIntakeDraft { type, title, sourceSummary, rawInput, expectedOutputs }`
  - **deterministic**, pure; every type yields the full `INTAKE_OUTPUTS` set (the unified acceptance promise).
- `WorkspaceIntakeDraft.expectedOutputs`: `product_understanding · acceptance_items · stage_plan · review_evidence · decision · release_readiness`.

`.mjs` + `.d.mts` so it is both testable under `node --test` and importable from TSX (matches the dashboard convention; Node20 CI can't type-strip `.ts`).

## UI path — `apps/dashboard/src/app/projects/new/intake/page.tsx` (route `/projects/new/intake`)
- "What do you want Simsa to review?" → 6 selectable cards (label + one-line description).
- On select → "Paste what you have." textarea with a per-type placeholder + input hint.
- "Create intake draft" → deterministic local preview: draft title + source summary + "Simsa will turn this into:" list of the 6 expected outputs.
- New route only — the **existing `/projects/new` idea→spec flow is untouched** (no rewrite, no risk to the working backend path).

## What is intentionally mock / local
- No backend ingestion, no Anthropic/central-plane call, no external fetch (URL/repo/PR not actually fetched), no file upload, no DB.
- The preview is computed in-browser from the static model. Labeled "Preview only — staged analysis arrives in later stages."

## Copy
Uses the public positioning ("Start from anything. … staged acceptance workflow."). Avoids "AI will build this for you / instant production app / fully automated / guaranteed release readiness".
- i18n: this foundation page uses English copy from the shared model; it does not yet route through the EN/KO dictionary (parity tests unaffected). Localizing the intake surface is a follow-up.

## Verification
- `apps/dashboard`: **200/200** tests pass (+9 new intake tests), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` = 1.92 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed (Stage 101 out of scope)
DB / D1 migration · central-plane · production backend ingestion · URL crawler · GitHub deep scanner · file upload · billing · deploy · domains · existing `/projects/new` flow.

## Next stages
- **Stage 102 — PRD / Spec Intake** (first real per-type analyzer)
- then product_url / github_repo / pull_request / ai_built_app intakes, converging on the shared acceptance pipeline.
