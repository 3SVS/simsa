> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 163 — Intake Preview Generation Integration

**Date:** 2026-06-24
**Branch:** `feat/stage-160-wax-seal-thinking-motion` (Stage 160~166 train, PR #154) · **Base:** `main` @ `dfb15eb`
**Type:** dashboard UI integration. **No deploy, no central-plane, no migration, no payment/Stripe, no hosted execution, no MCP/npm publish, no auth, no API/data change, no token/secret output.**

## 1. Goal
Integrate `SimsaSealThinking` into the intake surface **truthfully** — motion only where
there is a genuine async wait, no fake delay for the deterministic local previews.

## 2. Intake loading-state audit (`projects/new/intake/page.tsx`)
- **Deterministic / instant** (no spinner — would be dishonest): acceptance map, stage
  plan, agent run plan, evidence plan, graph/blocker/memory/template previews, and the
  handoff link — all computed locally and synchronously.
- **Genuinely async** (real wait on central-plane): `detailLoading` (fetching a saved
  workflow record on reopen, previously rendered as plain "Loading workflow…");
  `listLoading` (saved-list refresh, an inline button label "Loading…"); `saving`
  (save POST, inline button "Saving…").

## 3. Integration summary
Replaced the **`detailLoading`** plain-text state — a real async fetch — with a
`SimsaSealThinking` **panel**:
```tsx
const loadingSteps = getDefaultSealThinkingSteps(tr.loading);
…
{detailLoading && (
  <SimsaSealThinking variant="panel" stepLabels={loadingSteps} label={tr.loading.preparingPreview} className="mt-3" />
)}
```
When the fetch resolves, `detailLoading` flips false and the loaded record renders — the
panel simply unmounts, which is the natural "ready" transition (no fabricated
success-settle). No behavior/data/API change; only the loading visual changed.

## 4. Truthful motion rule handling
- **No artificial delay, no `setTimeout` for effect.** The seal panel is bound to the
  real `detailLoading` boolean only.
- The **instant deterministic previews keep no spinner** — Simsa does not pretend to
  think when it isn't.
- The inline button waits (`listLoading` "Loading…", `saving` "Saving…") are **left as
  text** — those are the **compact-in-button** target for **Stage 164**, not panel
  motion.

## 5. i18n usage
Uses the existing `tr.loading` namespace (Stage 162): `getDefaultSealThinkingSteps(tr.loading)`
for `stepLabels` and `tr.loading.preparingPreview` for the visible label. **No new
dictionary keys needed** (`loading.previewReady` / `readyToReview` were not required —
no separate ready-state element was added). en/ko parity unchanged.

## 6. Accessibility behavior
The panel carries `role="status"`, `aria-live="polite"`, `aria-busy="true"` (from the
Stage 161 component); the status label is visible in the panel variant; under
`prefers-reduced-motion` the seal/dots are static and the text remains. No essential
state is conveyed by motion alone.

## 7. Tests
No new tests: the integration adds no new component API or pure logic — `resolveSealThinking`
/ `getDefaultSealThinkingSteps` are already covered (Stage 161/162), and the dashboard
has no React-render test setup (pure-`.mjs` convention). The change is verified by
typecheck + Next build (the intake route compiles with the component imported). Existing
en/ko `loading.*` parity test still passes.

## 8. Deferred items
- No `state?: "thinking" | "ready"` API extension (not needed — unmount is the ready
  transition); a dedicated **success-settle** variant remains a Stage 164/165 follow-up.
- Inline **compact** seal in the `listLoading` / `saving` buttons → **Stage 164**.
- No broad/app-wide spinner replacement; no artificial delay; no app-wide loading motion.

## 9. Verification results
- dashboard tests **232/232** ✓ · typecheck ✓ · **build ✓** (`/projects/new/intake`
  compiled, 31 kB; the component is now bundled into the route).
- monorepo typecheck **57/57** ✓. No deploy, no publish.

## 10. Stage 163 decision
**Option A — Intake integration ready.** `SimsaSealThinking` is integrated into the
intake surface for the genuinely-async saved-record fetch, with no fake delay and no
behavior/data/API changes; instant deterministic previews remain spinner-free.

## 11. Recommended next stage
**Stage 164 — Compact Spinner Replacement in Selected Surfaces** (compact seal in the
intake `Refresh`/`Save` buttons and a small set of generic `animate-spin` sites). **Do
not merge** the train PR until the Stage 166 checkpoint + Bae approval.
