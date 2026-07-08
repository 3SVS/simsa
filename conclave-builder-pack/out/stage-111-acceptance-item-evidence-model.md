> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 111 — Acceptance Item Evidence Model

**Date:** 2026-06-23
**Train:** Agent Workflow Train (Stage 110~116) · branch `feat/stage-110-agent-run-plan` · PR #144 (do not merge until Stage 116).

## Goal
Connect **Acceptance Map items ↔ Stage Plan stages ↔ Agent Run Plan tasks ↔ expected evidence** into a deterministic **Evidence Plan**. Shows what evidence each acceptance item would need before Simsa can decide accept / fix / rerun / defer / not_verified. **Evidence planning, not collection.** Dashboard-local, preview-only.

## Product principle
Do not claim verification happened. Vocabulary: expected evidence / evidence needed / not verified / candidate / planned / needs evidence. Never `verified / passed / complete / production ready` as current status. Message: *Simsa does not just assign work — it shows what evidence is needed to accept, fix, rerun, or defer it.*

## Helper — `apps/dashboard/src/lib/intake-evidence-plan.mjs` (+ `.d.mts`)
`buildIntakeEvidencePlan({ type, rawInput }): IntakeEvidencePlan` — pure, deterministic; **reuses** `buildIntakeAcceptanceMap` + `buildIntakeStagePlan` + `buildAgentRunPlan`.

`IntakeEvidencePlan`: `{ intakeType, title, summary, expectations[], missingEvidenceQuestions[], overallEvidenceStatus, confidence }`.
`EvidenceExpectation`: `{ id (ev-N), acceptanceItemTitle, relatedArea, relatedStageNumbers[], relatedTaskIds[], evidenceTypes[], status, whyNeeded, decisionImpact }`.
- One expectation per acceptance map item, clamped **4–8** (topped up from generic areas if too few).
- Each links the item → stages whose `acceptanceAreas` include the item's area → those stages' Agent Run tasks → evidence types.

## Evidence type mapping
- **By area**: product_intent→clarification_note/acceptance_checklist · primary_user_flow→walkthrough/review_note/screenshot · onboarding→screenshot/walkthrough/review_note · error_recovery→walkthrough/test_result/review_note · data_privacy→review_note/acceptance_checklist · implementation_readiness→build_result/test_result/commit_link · release_readiness→release_decision_note/acceptance_checklist · trust_and_proof→screenshot/review_note · decision_history→release_decision_note/review_note.
- **By task tool**: github_pr_review→pr_link/review_note · claude_code/codex→commit_link/fix_summary · browser_check→screenshot/walkthrough · test_run→test_result/build_result · human_review→clarification_note/review_note.
- Tool-derived evidence is listed first (specific to the work), then area defaults, capped at 5.

## Status / decision-impact rules
- Status ∈ `planned / needed / not_verified / needs_decision`. missing_detail items → `needed`; release/decision areas → `needs_decision`; else `not_verified`. **`overallEvidenceStatus` defaults to `not_verified`.** No `accepted/passed/verified`.
- `decisionImpact`: error_recovery/data_privacy → fix; release_readiness/decision_history → defer; else mirrors the related task's next decision or `not_verified`. `accept` only appears as "what evidence would support", never a current decision.
- `missingEvidenceQuestions`: 3–6, with per-type additions (github_repo→build/test, product_url→screenshot/walkthrough, ai_built_app→safe-to-share, pull_request→PR/commit link).

## UI — `/projects/new/intake`
After "Create intake draft", a common **"Evidence Plan"** card for all types (order: … Stage Plan → Agent Run Plan → **Evidence Plan**): overall status · summary · expectation cards (acceptance item, status, area, related stages/tasks, decision impact, evidence-type chips, why needed) · missing evidence questions · confidence. Labeled "Preview only — evidence is expected, not collected or verified." Not persisted.

## Deterministic limitations (intentional)
Composed from the prior helpers — no evidence upload, screenshot capture, test execution, GitHub call, model, or persistence.

## Verification
- `apps/dashboard`: **277/277** tests (+8 evidence), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 13.1 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
evidence upload / screenshot / test execution / GitHub API / central-plane / Anthropic / DB / migration / deploy / domain — none.

## Next
Stage 112 — Persisted Agent Run Records. **Requires explicit Bae approval before any DB/migration/central-plane work** (first persistence stage of this train).
