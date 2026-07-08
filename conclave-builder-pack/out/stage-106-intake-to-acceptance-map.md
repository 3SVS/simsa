> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 106 — Intake to Acceptance Map

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Add a **shared, deterministic Acceptance Map** that all 6 intake types converge into — the bridge between "what the user pasted" and "the staged acceptance workflow Simsa will run". Local, preview-only, **not saved**.

## Helper — `apps/dashboard/src/lib/intake-acceptance-map.mjs` (+ `.d.mts`)
`buildIntakeAcceptanceMap({ type, rawInput }): IntakeAcceptanceMap` — pure, deterministic; **reuses** the Stage 102–105 helpers + `buildIntakeDraft`. No backend / AI / fetch / DB.

`IntakeAcceptanceMap`: `{ intakeType, title, summary, areas[], items[], missingQuestions[], recommendedNextStep, confidence }`.
- `AcceptanceMapArea`: product_intent · primary_user_flow · onboarding · error_recovery · data_privacy · implementation_readiness · release_readiness · trust_and_proof · decision_history.
- `AcceptanceMapItem`: `{ area, title (acceptance-style sentence), status, rationale }`; status ∈ `candidate / missing_detail / needs_verification`.
- **Items clamped to 5–10**, deduped, topped up from generic product-quality baseline items when a type yields too few.
- `recommendedNextStep` ∈ `clarify_product_intent / draft_acceptance_items / create_stage_plan / review_core_flow / verify_release_readiness` (+ `NEXT_STEP_LABELS`).

## Mapping by intake type
- **prd** → PRD preview: productIntent→summary, acceptance items→items; next = `draft_acceptance_items` (or `clarify_product_intent` if ≥5 missing questions).
- **product_url** → URL preview: likelySurface→summary, focus areas→`trust_and_proof` (needs_verification); next = `verify_release_readiness` for demo/pricing/app else `review_core_flow`.
- **github_repo** → repo preview: focus→`implementation_readiness`; next = `review_core_flow` (app) else `create_stage_plan`.
- **ai_built_app** → recovery preview: currentStateSummary→summary, risks→rationale; recommendedNextAction mapped (create_acceptance_map→draft_acceptance_items, create_fix_stage→create_stage_plan, …).
- **idea** → generic draft + default areas (product_intent/primary_user_flow/onboarding/release_readiness); next = `clarify_product_intent`.
- **pull_request** → generic fallback (no full PR parsing yet) + areas incl. `implementation_readiness`/`decision_history`; adds "What acceptance item should this PR prove?"; next = `review_core_flow`.

## UI — `/projects/new/intake`
After "Create intake draft", a common **"Acceptance Map"** card renders for **all** types (after the intake draft + any type-specific preview): summary · areas (chips) · acceptance items (with status) · missing questions · recommended next step · confidence. Labeled "Preview only — acceptance map is deterministic and not yet saved." Order: intake draft → type-specific preview → Acceptance Map.

## Deterministic limitations (intentional)
Composed from the same heuristic helpers — no semantic model, no fetch, no persistence. Items are candidates/questions, not validated requirements.

## Verification
- `apps/dashboard`: **252/252** tests (+10 map), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 9.26 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
backend / central-plane / Anthropic / URL fetch / GitHub API / repo clone / live inspection / upload / DB / migration / deploy / domain — none.

## Next
Stage 107 — Intake to Stage Plan.
