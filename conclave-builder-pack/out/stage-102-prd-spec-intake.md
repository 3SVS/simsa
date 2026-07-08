> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 102 — PRD / Spec Intake

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Make the `prd` intake type useful: paste a PRD/spec and get a **deterministic** preview of product intent, likely users, candidate flows, candidate acceptance items, and missing questions. Still local/mock — no backend, no AI.

## Product principle
A PRD is an artifact Simsa converts into acceptance work, not the final source of truth. Everything is "candidate / likely / preview" — no overclaiming.

## Helper — `apps/dashboard/src/lib/intake-prd.mjs` (+ `.d.mts`)
`buildPrdIntakePreview(rawInput): PrdIntakePreview` — pure, deterministic, heuristic:
- **productIntent**: first line containing `goal/problem/overview/summary/purpose/objective/we need/we want` (label prefix stripped); else a neutral fallback.
- **likelyUsers**: unique matches of `user/admin/owner/team/customer/mentor/founder/operator/manager/member/guest`; fallback `[User, Operator]`.
- **candidateUserFlows**: detected action verbs (`create/submit/invite/login/sign up/upload/connect/review/approve/reject/pay/share/export/download/comment`) → `"<actor> can <flow>."`; fallback to a single main-action flow.
- **candidateAcceptanceItems**: flow-derived items (if actions found) + generic product-quality items (clear first use, recoverable error states, no unintended data exposure, release readiness).
- **missingQuestions**: 3–6 useful questions, adapted to missing signals; adds a payment question if `pay/payment/checkout/billing/subscription` present, and a repo question if `github/repo/pull request/pr` present.
- **confidence**: `low/medium/high` from how many signal groups matched.
- `SAMPLE_PRD` constant for the "Use example PRD" button.

## UI — `/projects/new/intake` (prd type only)
After "Create intake draft" with `PRD / spec` selected, an extra **"PRD / spec preview"** card shows product intent · likely users (chips) · candidate user flows · candidate acceptance items · missing questions · confidence. A "Use example PRD" button fills the sample. Labeled "Preview only — deterministic PRD parsing." **Non-PRD types keep Stage 101 behavior; existing `/projects/new` flow untouched.**

## Deterministic limitations (intentional)
Heuristic keyword matching, not semantic understanding. No AI, no backend, no fetch, no DB. It surfaces *candidates and questions*, not validated requirements.

## Verification
- `apps/dashboard`: **209/209** tests (+9 PRD), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 3.52 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
central-plane / Anthropic / URL fetch / GitHub fetch / file upload / DB / migration / deploy / domain — none.

## Next
Stage 103 — Product URL Intake.
