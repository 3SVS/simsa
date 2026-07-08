> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 164 — Compact Spinner Replacement in Selected Surfaces

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train, PR #154) · **Base:** `main` @ `dfb15eb`
**Type:** dashboard UI (visual-only). **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no API/data change, no token/secret output.**

## 1. Goal
Replace selected small inline pending indicators with the **compact** `SimsaSealThinking`
seal — narrow, safe, visual-only, no behavior change. **Intake-only** (Option B).

## 2. Spinner inventory
- **Intake inline pending (this stage):** the **Save** button (`saving` → "Saving…") and
  the **Refresh** button (`listLoading` → "Loading…") — genuine async waits.
- **Already integrated (Stage 163):** `detailLoading` panel.
- **Deterministic/instant previews:** no spinner (unchanged — honest).
- **Other generic `animate-spin` sites (8 page files: benchmark / benchmark detail /
  checks / export / github history ×2 …):** **left untouched** this stage — broad
  replacement is out of scope to avoid churn/risk (revisit in a later, deliberate pass).

## 3. Selected replacement surfaces
Intake only:
- Save workflow plan button.
- Refresh (saved workflow plans) button.

## 4. Intake inline pending integration
Both buttons now render the compact seal **plus visible text** (meaning is never
icon-only), reverting to plain text when idle:
```tsx
{saving ? (
  <><SimsaSealThinking variant="compact" label={tr.loading.saving} /><span>{tr.loading.saving}</span></>
) : (<span>Save workflow plan</span>)}
```
```tsx
{listLoading ? (
  <><SimsaSealThinking variant="compact" label={tr.loading.refreshing} /><span>{tr.loading.refreshing}</span></>
) : (<span>Refresh</span>)}
```
Buttons got `inline-flex items-center gap-*` for alignment; `onClick`/`disabled`/logic
unchanged.

## 5. Other replacements
None. The 8 generic `animate-spin` page sites are intentionally not changed in this
narrow stage.

## 6. i18n keys added
`loading.saving` / `loading.refreshing` (EN + KO), added to `dictionary.mjs` + the
`Dictionary` type (`dictionary.d.mts`). EN "Saving…" / "Refreshing…"; KO "저장하는 중…" /
"새로고침하는 중…". en/ko parity enforced by the existing parity test. (Only keys
actually used were added — `loadingWorkflow` was not needed since Stage 163 uses
`preparingPreview`.)

## 7. Accessibility behavior
The compact seal carries `role="status"` / `aria-live="polite"` / `aria-busy="true"`
(Stage 161). The **visible button text** conveys the state for sighted users (not
icon-only); under `prefers-reduced-motion` the seal is static and the text remains. The
disabled state continues to communicate the pending action.

## 8. Non-goals
No app-wide spinner replacement; no admin/risky surface refactor; no artificial delay;
no behavior/API/data changes; no deploy. A `size` prop / success-settle variant were
**not** added (existing compact sufficed).

## 9. Verification results
- dashboard tests **232/232** ✓ (incl. en/ko `loading.*` parity) · typecheck ✓ · build ✓
  (`/projects/new/intake` 31 kB).
- monorepo typecheck **57/57** ✓. No deploy, no publish.

## 10. Stage 164 decision
**Option B — Intake-only replacement ready.** The intake Save/Refresh pending states use
the compact seal (visual-only, with visible text and accessible status); broader
generic-spinner replacement remains deferred.

## 11. Recommended next stage
**Stage 165 — Motion QA / Visual Polish** (timing, reduced-motion, contrast, alignment,
cross-variant consistency across the now-integrated intake surfaces). **Do not merge**
the train PR until the Stage 166 checkpoint + Bae approval.
