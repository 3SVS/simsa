> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 161 — SimsaSealThinking Component Foundation

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train, PR #154) · **Base:** `main` @ `dfb15eb`
**Type:** dashboard component foundation. **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no token/secret output.**

## 1. Goal
Implement the first reusable Simsa thinking/loading component foundation (burgundy
wax-seal pulse + evidence dots + calm status text), with `compact` + `panel` variants,
reduced-motion fallback, and accessible status semantics — using existing brand tokens.
**Not** integrated into dashboard surfaces yet (Stage 163+).

## 2. Component API
`apps/dashboard/src/components/SimsaSealThinking.tsx`:
```ts
export type SimsaSealThinkingVariant = "compact" | "panel";
export interface SimsaSealThinkingProps {
  variant?: SimsaSealThinkingVariant; // default "compact"
  label?: string;                     // default "Preparing preview…"
  stepLabels?: string[];              // first label shown now; cycling deferred
  className?: string;
}
```
Render config is derived by the **pure, tested** `apps/dashboard/src/lib/seal-thinking.mjs`
(`resolveSealThinking`) so the logic is testable under the dashboard's `node --test`
runner (no React test setup exists). `compact` → 3 dots, screen-reader-only label;
`panel` → 5 dots, visible label.

## 3. Visual implementation
CSS/HTML only — **no image asset, no animation library**. Structure: container → seal
(`bg-brand-700` burgundy fill, inset emboss shadow + `ring-brand-500/40`, centered "S",
a rim-highlight sweep span) → evidence dots (`bg-brand-400`, sequential delays) → label.
Sizes scale by variant (panel `h-10 w-10`, compact `h-6 w-6`). **Brand burgundy uses the
existing Tailwind `brand` (oxblood) tokens** (`brand-700 = #4b0e17`, etc.) — no new color
system; rim uses `theme("colors.brand.300")`.

## 4. Keyframes and reduced-motion
Added to `apps/dashboard/src/app/globals.css`:
- `@keyframes simsa-seal-pulse` (gentle press/release), `simsa-seal-rim-sweep` (conic rim
  highlight, masked to a ring), `simsa-evidence-dot` (opacity/scale).
- Utility classes `.simsa-seal-motion` (pulse 2s), `.simsa-seal-rim` (sweep 3s),
  `.simsa-evidence-dot` (1.4s) — all easing `cubic-bezier(0.22, 1, 0.36, 1)`; dot
  staggering via inline `animation-delay` (0/200/400…ms).
- `@media (prefers-reduced-motion: reduce)` sets `animation: none` on all three and
  leaves dots at a gentle static opacity (0.6) — **no pulse/sweep/flashing**.

## 5. Accessibility behavior
Root carries `role="status"`, `aria-live="polite"`, `aria-busy="true"`. The status
label is **always present** — visible in `panel`, `sr-only` in `compact` — so state is
never conveyed by motion alone. The seal + dots are `aria-hidden`. Under reduced motion
the static seal, dots, and status text remain understandable.

## 6. Tests
`apps/dashboard/test/seal-thinking.test.mjs` (pure, `node --test`): default
compact/3-dots/default-label, panel/5-dots/visible-label, custom label, first-stepLabel
as current label, empty/whitespace fallback, unknown-variant → compact, a11y semantics,
sequential dot delays `[0,200,400,600,800]`, and no-throw on malformed input.
**Dashboard tests 227/227** (was 218; +9).

## 7. Non-goals (deferred)
No integration into existing loading states; no change to the intake page generation
states; no label cycling/animation-of-copy; no story/demo route (the repo has no
component-sandbox convention). Those land in Stage 162 (i18n `loading.*` + polish),
Stage 163 (intake/async integration), Stage 164 (compact replaces generic `animate-spin`).

## 8. Verification results
- dashboard tests **227/227** ✓ · typecheck ✓ · **build ✓** (compiled successfully).
- monorepo typecheck **57/57** ✓.
- No deploy, no publish. Component is foundation-only (not yet imported by any route).

## 9. Stage 161 decision
**Option A — Component foundation ready.** The `SimsaSealThinking` compact/panel
foundation is implemented (brand-token-driven, reduced-motion + `role="status"`, pure
tested config) and ready for i18n message integration.

## 10. Recommended next stage
**Stage 162 — Loading Message i18n + Motion Polish** (add the `loading.*` EN+KO
dictionary keys, wire them as `stepLabels`/`label`, and refine reduced-motion + timing).
**Do not merge** the train PR until the Stage 166 checkpoint + Bae approval.
