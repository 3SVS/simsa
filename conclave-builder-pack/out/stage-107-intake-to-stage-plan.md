> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 107 — Intake to Stage Plan

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Turn the Acceptance Map into an ordered, deterministic **Stage Plan** (Acceptance Map → ordered workflow). Compact (4–7 stages), local, preview-only, **not saved, not executed**.

## Helper — `apps/dashboard/src/lib/intake-stage-plan.mjs` (+ `.d.mts`)
`buildIntakeStagePlan({ type, rawInput }): IntakeStagePlan` — pure, deterministic; **reuses** `buildIntakeAcceptanceMap`. No backend / AI / fetch / DB.

`IntakeStagePlan`: `{ intakeType, title, summary, stages[], recommendedStartStage, releaseGate{title,checks[]}, confidence }`.
`IntakeStagePlanStage`: `{ number, title, kind, status, goal, acceptanceAreas[], candidateChecks[2–4], evidenceToCollect[1–3], exitCriteria[1–3] }`.
- `kind` ∈ clarify / acceptance / review / fix / evidence / release. `status` ∈ planned / needs_clarification / needs_evidence / deferred.
- Spine (always present): **Clarify → Acceptance → Review → Release**, plus a context stage by type, clamped to **4–7** stages, numbered sequentially, always ending in a `release` stage; plus a `releaseGate` with checks.
- Tone: "planned / candidate / needs evidence / not yet saved" — never "completed/verified/passed".

## Stage generation by type
- **prd**: + "Resolve missing product questions" (clarify).
- **product_url**: + "Check CTA and user-journey evidence" (evidence).
- **github_repo**: + "Review build/test evidence" (evidence).
- **ai_built_app**: + "Fix or rebuild decision" (fix).
- **pull_request**: + "Map the PR change to an acceptance item" (evidence).
- **idea**: spine only (Clarify product intent → …).

`recommendedStartStage` from the map's `confidence`/`recommendedNextStep` (low confidence → stage 1; verify_release_readiness still routed to the preceding evidence/review stage). `STAGE_STATUS_LABELS` / `STAGE_KIND_LABELS` for UI.

## UI — `/projects/new/intake`
After "Create intake draft", a common **"Stage Plan"** card renders for all types (order: intake draft → type-specific preview → Acceptance Map → **Stage Plan**): summary · recommended start · ordered stage cards (number/title/kind/status/goal/checks/evidence/exit) · release gate · confidence. Recommended-start stage highlighted. Labeled "Preview only — not yet saved." Not persisted.

## Deterministic limitations (intentional)
Composed from the Acceptance Map heuristics — no semantic model, no fetch, no execution. Stages, checks, evidence are *planned/suggested*, not done.

## Verification
- `apps/dashboard`: **261/261** tests (+9 stage plan), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 11 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
backend / central-plane / Anthropic / URL fetch / GitHub API / repo clone / live inspection / upload / DB / migration / deploy / domain — none.

## Next
Stage 108 — Core Intake Train Checkpoint.
