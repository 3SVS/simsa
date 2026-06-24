# Stage 160 — Simsa Wax Seal Thinking Animation / Motion System Planning

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train) · **Base:** `main` @ `dfb15eb`
**Type:** planning (docs-only). **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no token/secret output.**

## 1. Goal
Plan the Simsa motion system for thinking/loading states: where they appear, the
animation variants, how the burgundy wax-seal "S" + evidence dots behave, the i18n
loading copy, accessibility rules, and the Stage 161+ implementation scope. Docs-only.

## 2. Approved motion direction
**Simsa Thinking Animation = burgundy wax-seal pulse + evidence dots + calm acceptance
workflow messages.** Premium, trust-oriented, restrained. **Not** a generic spinner as
the primary brand motion. Avoid: generic spinner (as the brand mark), AI-magic sparkle,
glitter, fast gaming-style motion, random particles. Use: subtle wax-seal pulse, gentle
rim highlight sweep, evidence dots lighting one-by-one, calm status copy.

## 3. Current loading-state inventory (dashboard)
- **Generic `animate-spin` spinners in 8 page files** — `projects/[id]/benchmark`,
  `benchmark/[benchmarkId]`, `checks`, `export`, `github/history`,
  `github/history/[runId]`, etc. These are the primary replacement targets for the brand
  motion.
- **Visible loading text:** `admin/workflows` "Loading…"; `projects/new/intake`
  "Saving…" / "Loading…".
- **Intake preview generation is synchronous & deterministic** (local, no async/network)
  — so per-preview "thinking" is effectively instant; the wax-seal **panel** variant is
  most meaningful for genuinely async waits (save, list load, GitHub/review fetches,
  benchmark/export). For deterministic local previews, prefer a brief **success settle**
  over a long spinner.
- Loading booleans are widespread (e.g. `admin/credits` ~20 toggles, intake `saving` /
  `listLoading` / `manageBusyId`) — integration should be incremental, not a global swap.

## 4. Animation variants
1. **compact** — small inline seal pulse for buttons/cards (replaces inline `animate-spin`).
2. **panel** — seal + evidence dots + status message, for preview/async generation.
3. **skeleton** — acceptance-item rows appear one-by-one, for long generation panels.
4. **success settle** — seal briefly stamps and dots complete, when a preview is ready.

(Stage 160 documents all four; Stage 161 builds the foundation component + compact/panel
first.)

## 5. Wax seal pulse behavior
1. The burgundy "S" wax seal gently presses down and releases.
2. The outer rim gets a subtle moving highlight sweep.
3. The seal settles calmly — no flashy finish.
- **Timing:** pulse 1.6s–2.2s; rim/highlight sweep 2.4s–3.2s; easing
  `cubic-bezier(0.22, 1, 0.36, 1)`. Loop gently (not aggressively); stop on completion.

## 6. Evidence dots behavior
- 3–5 dots light up **sequentially**, dot delay **180ms–240ms**, mapping to the
  acceptance/evidence metaphor (criteria being checked one by one).
- On **success settle**, all dots complete; under reduced motion, dots render as static
  completed (or gentle opacity only), never flashing.

## 7. Status message i18n plan (dictionary keys — plan only, implement in Stage 162)
Add a `loading` namespace to `dictionary.mjs` (EN + KO), reusing the existing
dictionary-first system (`LOCALES = ["en","ko"]`, en fallback). Proposed keys + copy:

| key | en | ko |
|-----|----|----|
| `loading.mappingAcceptance` | Mapping acceptance criteria… | 수용 기준을 매핑하는 중… |
| `loading.buildingStagePlan` | Building stage plan… | 단계 계획을 구성하는 중… |
| `loading.planningEvidence` | Planning evidence… | 검증 증거를 준비하는 중… |
| `loading.checkingHandoffSafety` | Checking handoff safety… | 핸드오프 안전성을 확인하는 중… |
| `loading.preparingPreview` | Preparing preview… | 미리보기를 준비하는 중… |
| `loading.finalizingReview` | Finalizing review… | 리뷰를 마무리하는 중… |

Future locales = dictionary-only (no component rewrites). Product terms stay consistent
(Acceptance/Stage plan/Evidence/Handoff/Preview/Review).

## 8. Visual token recommendation
**Reuse the existing Tailwind `brand` tokens — do not hardcode arbitrary hexes.** The
dashboard `brand` palette **already is oxblood/burgundy** (`tailwind.config.ts`:
`brand: oxblood`, e.g. `brand-700 = #4b0e17` deep burgundy, full 50–900 scale), on a
warm parchment workspace surface (`globals.css`). Mapping:
- **Seal body / press:** `brand-600` / `brand-700` (deep burgundy + shadow).
- **Rim highlight sweep:** `brand-300` / `brand-400` (soft highlight) — close to the
  suggested `#B85A66`.
- **Background:** existing parchment surface tokens (warm `#FAF7F2`-family already in
  `globals.css`).
- **Status / muted text:** existing dashboard text + muted tokens.
- **Optional accent:** the existing antique-gold scale for the completed-dot state.
The Stage 157 burgundy direction therefore needs **no new color system** — only motion.
New `@keyframes` (none exist yet in `globals.css`) for pulse/sweep/dot-fill, gated by
reduced-motion.

## 9. Accessibility and reduced-motion requirements
- Respect `prefers-reduced-motion`: **no** pulse / rim sweep; evidence dots render as
  static completed or gentle opacity; **status text stays visible**.
- No essential information conveyed by motion alone; the loading state must be
  understandable without animation (visible status copy + `aria-live="polite"` /
  `role="status"`, `aria-busy`).
- Avoid excessive flashing; do not loop aggressively; stop on completion.

## 10. Implementation plan (Stage 161~166)
- **161 — SimsaSealThinking component foundation** (compact + panel variants, `@keyframes`
  in globals.css, brand-token-driven, no copy yet / English placeholder).
- **162 — i18n `loading.*` messages (EN+KO) + reduced-motion support** (parity test).
- **163 — Integrate into intake preview/async surfaces** (panel/skeleton + success settle).
- **164 — Integrate compact variant into buttons/cards** (replace generic `animate-spin`).
- **165 — QA / visual polish** (timing, reduced-motion, a11y, cross-page consistency).
- **166 — Motion System Checkpoint** (merge/deploy decision pending Bae approval).

## 11. Risk assessment
- **Scope creep:** 8+ spinner sites; integrate incrementally (panel/compact first), not a
  global swap — keep each PR-stage reviewable.
- **Determinism vs. motion:** intake previews are instant; avoid artificial delays — use
  success settle, not a fake long spinner, so the UI stays honest.
- **A11y regressions:** every variant ships with a reduced-motion + `role="status"` path
  from Stage 161; enforce in Stage 165 QA.
- **Token drift:** reuse `brand-*`/parchment tokens only; no new arbitrary palette.
- **Bundle/perf:** CSS keyframes + a small component (no animation library); keep it
  dependency-free.

## 12. Stage 160 decision
**Motion system plan is ready. Proceed to Stage 161 to implement the first
SimsaSealThinking component.** The burgundy direction maps onto existing `brand` (oxblood)
tokens — motion-only, no new color system; i18n reuses the dictionary-first system;
reduced-motion + status copy are required from the first component. Docs-only this stage.

## 13. Recommended next stage
**Stage 161 — SimsaSealThinking Component Foundation** (compact + panel variants, brand
tokens, `@keyframes` + reduced-motion fallback). **Do not merge** the train PR until the
Stage 166 checkpoint + Bae approval.
