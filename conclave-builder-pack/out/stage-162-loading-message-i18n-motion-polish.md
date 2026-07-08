> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 162 — Loading Message i18n + Motion Polish

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train, PR #154) · **Base:** `main` @ `dfb15eb`
**Type:** dashboard i18n + component polish. **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no token/secret output.**

## 1. Goal
Add dictionary-first loading/thinking status messages (EN + KO), give
`SimsaSealThinking` clean label precedence, and confirm reduced-motion — so the
component is ready for intake/async integration. No broad spinner replacement here.

## 2. Dictionary keys added
`loading.*` namespace added to **EN and KO** in `dictionary.mjs`, plus the `loading`
shape in the `Dictionary` type (`dictionary.d.mts`): `mappingAcceptance`,
`buildingStagePlan`, `planningEvidence`, `checkingHandoffSafety`, `preparingPreview`,
`finalizingReview`. The existing **en/ko key-parity test** now enforces parity for these
keys automatically.

## 3. English baseline copy
Mapping acceptance criteria… · Building stage plan… · Planning evidence… · Checking
handoff safety… · Preparing preview… · Finalizing review…

## 4. Korean early-locale copy
수용 기준을 매핑하는 중… · 단계 계획을 구성하는 중… · 검증 증거를 준비하는 중… ·
핸드오프 안전성을 확인하는 중… · 미리보기를 준비하는 중… · 리뷰를 마무리하는 중…

## 5. Step label helper
`getDefaultSealThinkingSteps(loadingDictionary)` added to `lib/seal-thinking.mjs`
(+ `.d.mts`): returns the ordered acceptance-workflow step labels
(mapping → stage plan → evidence → handoff safety → preview → review), dropping any
missing/blank entries, never throwing. **Pure and decoupled** — it takes the `loading`
dictionary object as input (no React, no direct import of the i18n module), so callers
pass `t.loading` and stay locale-correct.

## 6. Component fallback behavior
`resolveSealThinking` precedence is now **explicit `label` → first `stepLabels` entry →
`"Preparing preview…"`** (Stage 161 had stepLabels override label; corrected here per the
Stage 162 spec). `compact` keeps the label `sr-only`; `panel` shows it visibly. No
timer-based copy cycling yet (deferred) — the component just accepts globalized step
labels safely. The component API from Stage 161 is unchanged.

## 7. Reduced-motion polish
`globals.css` retains `@media (prefers-reduced-motion: reduce)` disabling
`.simsa-seal-motion`, `.simsa-seal-rim`, and `.simsa-evidence-dot` animations, with dots
left at a gentle static opacity (0.6) and the status text always visible — no flashing,
no aggressive loop. (No CSS change needed this stage; confirmed intact.)

## 8. Tests
Extended `test/seal-thinking.test.mjs`: explicit-label-overrides-stepLabels;
`getDefaultSealThinkingSteps` returns ordered EN labels, ordered KO labels, filters
blank/missing + no-throw on malformed input, and feeds cleanly into `resolveSealThinking`
(first label shown). The i18n parity test covers `loading.*` en/ko parity.
**Dashboard tests 232/232** (was 227; +5).

## 9. Non-goals (explicit)
No broad spinner replacement; no intake-page integration yet; no timer-based message
cycling; no new i18n system; no Phase 2 locale translations; no deploy.

## 10. Verification results
- dashboard tests **232/232** ✓ (incl. en/ko `loading.*` parity) · typecheck ✓ · build ✓.
- monorepo typecheck **57/57** ✓.
- No deploy, no publish.

## 11. Stage 162 decision
**Option A — Loading i18n and motion polish ready.** The `loading.*` EN+KO keys, the
`getDefaultSealThinkingSteps` helper, and the corrected label precedence are ready for
intake integration; reduced-motion confirmed.

## 12. Recommended next stage
**Stage 163 — Intake Preview Generation Integration** (use `SimsaSealThinking` panel +
`getDefaultSealThinkingSteps(t.loading)` on the intake/async surfaces, with a brief
success-settle for the deterministic local previews). **Do not merge** the train PR
until the Stage 166 checkpoint + Bae approval.
