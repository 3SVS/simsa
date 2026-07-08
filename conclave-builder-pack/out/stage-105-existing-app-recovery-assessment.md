> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 105 — Existing App Recovery Assessment

**Date:** 2026-06-23
**Train:** Core Intake Train (Stage 101~108) · branch `feat/stage-101-unified-intake` · PR #142 (do not merge until Stage 108).

## Goal
Make the `ai_built_app` intake type meaningfully useful for the key scenario: *"I built something with an AI coding agent, but I don't know if it's ready to share, fix, rebuild, or release."* Deterministic, preview-only — **no live app inspection, URL fetch, repo scan, or backend.**

## Product principle
Not "vibe-coding shaming." Framing: AI creates the first draft fast; Simsa helps decide what to accept, fix, rebuild, or verify next. Helpful, not judgmental — language stays "draft / unclear / not yet verified / recovery plan / next action".

## Helper — `apps/dashboard/src/lib/intake-ai-built-app.mjs` (+ `.d.mts`)
`buildAiBuiltAppRecoveryPreview(rawInput): AiBuiltAppRecoveryPreview` — pure, deterministic, throw-free:
- **likelyProductSurface**: `landing / web_app / dashboard / mobile / api / prototype / unknown` from the user's words.
- **currentStateSummary**: deterministic summary of the pasted text (fallback when empty).
- **recoveryFocusAreas**: base readiness areas + context-specific (auth→session, payment→billing, sharing→permissions, AI→fallback, repo/deploy→build/env).
- **candidateAcceptanceItems**: base + context-specific checks.
- **likelyRisks**: base + context-specific.
- **fixVsRebuildSignals**: `{ likelyKeep, likelyFix, likelyRebuild, needsVerification }` — rebuild wording softens unless the text signals "broken/messy/cannot build".
- **recommendedNextAction**: `create_acceptance_map` (short) · `create_fix_stage` (broken/bugs) · `verify_release_readiness` (launch/share/users) · `review_core_flow` (core-flow mention).
- **missingQuestions**: 3–6. **confidence** from recognized-signal count.
- `SAMPLE_AI_BUILT_APP` for "Use example app".

## UI — `/projects/new/intake` (ai_built_app type only)
After "Create intake draft" with `AI-built app` selected, an **"Existing app recovery preview"** card: current state summary · likely product surface · recommended next action · recovery focus areas · candidate acceptance items · likely risks · fix-vs-rebuild signals (4 buckets) · missing questions · confidence. "Use example app" button. Labeled **"Preview only — no live inspection, repo scan, or external fetch."** Other types unchanged; existing `/projects/new` untouched.

## Deterministic limitations (intentional)
Heuristics over the user's own description only — never claims to know actual app behavior. Surfaces a *recovery plan + questions + signals*, not findings.

## Verification
- `apps/dashboard`: **242/242** tests (+13 recovery), typecheck clean, lint = pre-existing `export/page.tsx` warning only, build green (`/projects/new/intake` 8 kB).
- Monorepo `turbo run typecheck`: **56/56**.

## Not changed
live app inspection / URL fetch / screenshot / browser automation / GitHub API / repo clone / upload / central-plane / Anthropic / DB / migration / deploy / domain — none.

## Next
Stage 106 — Intake to Acceptance Map (all 6 intake types now have deterministic previews; 106 begins converging them into a shared acceptance map).
