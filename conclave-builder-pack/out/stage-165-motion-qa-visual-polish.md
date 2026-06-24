# Stage 165 — Motion QA / Visual Polish

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train, PR #154) · **Base:** `main` @ `dfb15eb`
**Type:** QA + small visual polish. **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no API/data change, no app-wide spinner replacement, no token/secret output.**

## 1. Goal
QA the `SimsaSealThinking` motion system (compact + panel) and apply small, safe polish
before the Stage 166 checkpoint. No scope broadening.

## 2. QA surfaces inspected
- `components/SimsaSealThinking.tsx`, `app/globals.css` (keyframes + reduced-motion),
  `projects/new/intake/page.tsx` (panel on `detailLoading`; compact in Save/Refresh
  buttons), `i18n/dictionary.mjs`, `test/seal-thinking.test.mjs`, `tailwind.config.ts`.

## 3. Compact variant QA
- **Found (fixed):** the component root was a `<div role="status">`; the compact variant
  is rendered **inside `<button>`** (Stage 164), and `<div>` is not valid phrasing
  content inside a button (risk of invalid DOM / hydration warning). **Polish:** root
  element changed `<div>` → **`<span>`** (Tailwind `flex`/`inline-flex` utilities still
  apply on a span; all children were already `<span>`), plus `align-middle` on the
  compact root for clean baseline alignment in buttons.
- **Sizing:** compact seal reduced `h-6` → **`h-5`** (`text-[10px]`) so it sits inside
  `btn-sm` (Refresh) / `btn-md` (Save) without inflating button height; dots `h-1`.
- Status label stays `sr-only` for compact; the **visible button `<span>` text** carries
  meaning (not icon-only). Does not read as a generic spinner (seal + dots, not a
  rotating ring).

## 4. Panel variant QA
- Calm/premium: bordered card, `bg-white/60` on parchment, `gap-3`, `px-6 py-5` — not
  oversized. Visible status text (`text-sm text-gray-600`); evidence dots are small and
  subtle. Copy is preview/loading-only (`Preparing preview…`) — **no
  secure/compliant/production-ready guarantee language**.

## 5. Motion timing QA
- Pulse ~**2s**, rim sweep ~**3s**, dot cadence ~**200ms** (delays 0/200/400/600/800),
  easing `cubic-bezier(0.22, 1, 0.36, 1)`. Subtle, no jitter, no fast/gaming loop. No
  change needed.

## 6. Reduced-motion QA
- `@media (prefers-reduced-motion: reduce)` disables `.simsa-seal-motion`,
  `.simsa-seal-rim`, `.simsa-evidence-dot`; dots remain at a gentle static opacity
  (0.6); status text remains visible. **No flashing.** Confirmed intact.

## 7. Accessibility QA
- Root `role="status"` + `aria-live="polite"` + `aria-busy="true"` while thinking; seal
  and dots `aria-hidden="true"` (decorative). Visible text exists where required —
  notably the visible `<span>` inside the Save/Refresh buttons. The `<span>` root fix
  also removes the invalid `<div>`-in-`<button>` nesting.

## 8. Contrast / token QA
- Seal `bg-brand-700` (#4b0e17) with `text-brand-100` (#f3dfe1) "S" → strong contrast.
  Dots `bg-brand-400` (#b85f6a) read on white cards and parchment (`#faf8f3`). Rim uses
  `theme("colors.brand.300")`. **No new raw colors introduced** — existing `brand`
  (oxblood) tokens only.

## 9. Polish changes made
1. `SimsaSealThinking.tsx` root `<div>` → `<span>` (+ `align-middle` on compact) — valid
   inside buttons.
2. Compact seal `h-6 text-[11px]` → `h-5 text-[10px]`.
(No CSS keyframe/timing changes were needed; no logic changes → tests unchanged and
still green.)

## 10. Deferred items
- The 8 generic `animate-spin` page sites remain unconverted (deliberate; not app-wide).
- No `size` prop, no dedicated success-settle variant, no label cycling.

## 11. Verification results
- dashboard tests **232/232** ✓ · typecheck ✓ · build ✓ (`/projects/new/intake` 31 kB).
- monorepo typecheck **57/57** ✓. No deploy, no publish.

## 12. Stage 165 decision
**Option B — Motion QA passed with minor limitations.** One real correctness polish
landed (valid `<span>` root for in-button use) plus a small compact-size tweak; the
deferred items (broad spinner replacement, success-settle, size prop) are recorded.
Ready for the Stage 166 checkpoint.

## 13. Recommended next stage
**Stage 166 — Motion System Checkpoint / Merge Readiness** (train summary + merge
decision for PR #154, pending Bae approval; dashboard deploy is a separate Bae-approved
step). **Do not merge** until then.
