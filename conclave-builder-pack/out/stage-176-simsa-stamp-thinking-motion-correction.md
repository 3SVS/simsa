> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 176 — Simsa Stamp Thinking Motion Correction

**Date:** 2026-06-24
**Branch:** `fix/stage-176-simsa-stamp-thinking-motion` · **Base:** `main` @ `9c4e593`
**Renumber note:** originally authored as Stage 174 on the local (unpushed) branch
`fix/stage-174-…`; renumbered to **Stage 176** before pushing because PR #155 already uses
Stage 174 for "GitHub / Vercel Integration UX + Safety Model". The commit was amended (the
branch had not been pushed). Implementation/decisions are unchanged — numbering only.
**Type:** dashboard UI / motion / design correction. **No deploy, no merge, no MCP/npm publish, no migration, no auth/OAuth/payment/billing/hosted execution, no central-plane change, no token/secret output.**

## 1. Why the wax-seal metaphor was changed
Stages 160~166 shipped a **wax-seal** loading/thinking motion (`SimsaSealThinking` — a
burgundy wax "S" that *pulses*, with a rotating rim sweep and "evidence droplets"). The
product direction is **review / 심사 / judgment**, and "Simsa" means review·assessment. A
wax seal reads as **sealing / finalizing / certifying** — the wrong mental model for a tool
that *reviews evidence and leaves a review trace*. The wax motion was **never deployed**
(dashboard deploy is still pending), so this is the correct moment to fix the metaphor
**before live dogfood**.

## 2. New stamp metaphor — "Simsa review stamp / 심사 도장"
The motion now reads as **a reviewer pressing a review stamp after checking evidence**:
1. the stamp **prepares / hovers** (lifts at a slight angle),
2. **presses down** with a short, satisfying impact,
3. an **"S" review imprint** settles,
4. a **subtle ink spread** blooms then is absorbed,
5. **evidence checkpoints** align/pulse around the mark.
It is explicitly a **review trace**, **not** an *approved / certified / production-ready /
secure / bug-free / final-approval* stamp. Motion is calm and premium — no cartoon bounce,
no AI sparkle, no generic spinner.

## 3. Red / ink-red color rationale (global note)
- Shifts the visual language toward **review-stamp ink**, using the **existing `brand`
  (oxblood) Tailwind tokens** — *no new color system*. Ink tones: `brand-500` `#8e2c39`
  (controlled deep red), `brand-700` `#4b0e17` (imprint "S"), light face `brand-50`
  `#faf2f2`.
- The stamp is rendered as a **red-ink imprint on a light face** (rounded-square mark, ink
  border + ink "S") so it reads as **official review ink / editorial markup / evidence
  annotation / human review trace** — *not* an error/danger/destructive-action red.
- **Global recognition note:** red carries strong energy and means review-marks / stamps /
  authority in many markets, but danger/error in much Western UX. Mitigation: a **controlled
  ink-red / burgundy** tone (never bright alert red), **calm neutral surfaces** (light card,
  gray text), and **non-alarming copy**. No destructive-red primary tone is used.

## 4. Changed files
**New (replace the seal trio):**
- `apps/dashboard/src/lib/stamp-thinking.mjs` — pure, deterministic render config
  (`resolveStampThinking`, `getDefaultStampThinkingSteps`, `STAMP_THINKING_VARIANTS`,
  `DEFAULT_STAMP_LABEL`).
- `apps/dashboard/src/lib/stamp-thinking.d.mts` — types.
- `apps/dashboard/src/components/SimsaStampThinking.tsx` — the stamp component.
- `apps/dashboard/test/stamp-thinking.test.mjs` — pure tests (incl. a no-approval-language
  guard).

**Edited:**
- `apps/dashboard/src/app/globals.css` — replaced `simsa-seal-*` keyframes/classes with
  `simsa-stamp-press` / `simsa-stamp-ink` / `simsa-evidence-mark` (+ reduced-motion block).
- `apps/dashboard/src/i18n/dictionary.mjs` — `loading.*` EN+KO copy + keys updated to
  review-stamp language.
- `apps/dashboard/src/i18n/dictionary.d.mts` — `loading` type keys updated.
- `apps/dashboard/src/app/projects/new/intake/page.tsx` — import + 3 usages renamed; panel
  label now `loading.reviewingEvidence`.

**Deleted (wax-seal surfaces):** `components/SimsaSealThinking.tsx`,
`lib/seal-thinking.mjs`, `lib/seal-thinking.d.mts`, `test/seal-thinking.test.mjs`.

## 5. Previous wax-seal surfaces found (full inventory)
The only wax-seal surfaces in the repo were the 7 files above (component, lib `.mjs` +
`.d.mts`, test, `globals.css` motion block, `dictionary.mjs` EN+KO `loading.*`, and the
`intake/page.tsx` integration). No other importers or usages existed.

## 6. New stamp motion behavior
- **`simsa-stamp-press` (2.4s loop):** lift/prepare → press impact (`scale(0.95)`) →
  settle (`scale(1.015)`) → hold the imprint → lift for the next press. `transform-origin:
  center 70%` so it presses *down*. Held at a constant `-6deg` for a hand-stamped feel.
- **`simsa-stamp-ink` (panel only):** an ink halo that blooms (`opacity 0.3`) on impact and
  is absorbed (`opacity 0.1 → 0`), masked to a soft radial edge. Kept **out of the compact
  variant** so it can never overflow a button.
- **`simsa-evidence-mark`:** small **rounded-square checkpoint marks** (not round droplets)
  that pulse in sequence (200ms cadence) — reads as a reviewer ticking a checklist.
- Compact variant stays valid **inside `<button>`** (root is a `<span>`, phrasing content);
  panel variant stays valid in the intake `detailLoading` state.

## 7. Sound design note (future optional micro-interaction — NOT implemented)
**No sound is implemented or played in this stage.** Documented as future, opt-in only:
- **Hard rules for any future sound:** off by default; user-controlled; respects browser
  autoplay restrictions; respects `prefers-reduced-motion` / accessibility; **never the only
  feedback channel**; not required to understand state; no repeated sound during long
  loading; never an alarm-like/harsh tone.
- **Candidate concepts:** (1) **stamp impact** — a short, soft, low-volume "쾅/thump" when
  the review stamp lands (document stamp, not an explosion/error); (2) **checkmark writing**
  — a subtle "슥슥" felt-tip/sign-pen sound when evidence checkpoints/check traces appear
  (reviewer marking a checklist; more subtle than the stamp).
- **Recommended hierarchy:** loading/thinking = **no sound** by default; an *explicit
  user-triggered* completion / checklist marking *later* = optional soft "슥슥"; a rare
  branded moment *later* = optional low-volume stamp "thump". Never during long loading.

## 8. Component naming decision
**Clean rename** to `SimsaStampThinking` (+ `lib/stamp-thinking.*`, `test/stamp-thinking`).
**No compatibility export was kept** — the only consumer was `intake/page.tsx`, which is
updated in the same change, so a temporary alias would only add churn. The old seal files
are deleted so the wax-seal concept is fully removed.

## 9. i18n / copy changes (EN + KO)
`loading.*` keys renamed and recopied to review-stamp language (key order = review
progression):
| key | EN | KO |
|---|---|---|
| reviewingEvidence | Reviewing evidence… | 증거를 검토하는 중… |
| preparingAcceptance | Preparing acceptance context… | 심사 맥락을 정리하는 중… |
| checkingSignals | Checking acceptance signals… | 수락 기준 신호를 확인하는 중… |
| markingCheckpoints | Marking evidence checkpoints… | 증거 체크포인트를 표시하는 중… |
| stampingTrace | Stamping review trace… | 검토 흔적을 남기는 중… |
| finalizingReview | Finalizing review… | 리뷰를 마무리하는 중… |
| saving / refreshing | Saving… / Refreshing… | 저장하는 중… / 새로고침하는 중… |

**Banned language confirmed absent** (enforced by a test): *approved, certified,
production-ready, secure, bug-free, final approval*. EN/KO key parity holds (the i18n parity
test walks the structure symmetrically).

## 10. Accessibility / reduced-motion confirmation
- `role="status"`, `aria-live="polite"`, `aria-busy={true}` preserved (from the pure
  config); status label is **visible (panel)** or **screen-reader-only (compact)**.
- **No invalid button nesting:** the compact root is a `<span>` (phrasing content), safe
  inside `<button>`.
- **`prefers-reduced-motion: reduce`:** all three animations are disabled — the stamp rests
  **pressed** (`rotate(-6deg)`, full opacity, no lift), the ink halo is hidden, and the
  checkpoint marks read as **gently present** (`opacity 0.6`), not flashing. State remains
  fully understandable with **zero motion and zero sound**.
- **Sound accessibility:** no autoplaying sound; any future sound is opt-in only and visual
  state never depends on it.

## 11. Dashboard integration points checked
- **intake `detailLoading` panel** (real async fetch of a saved record) → `SimsaStampThinking
  variant="panel"` with localized `stepLabels` + `reviewingEvidence` label.
- **intake Save pending** (primary button) → `variant="compact"`.
- **intake Refresh pending** (secondary button) → `variant="compact"`.
- Compact's self-contained light-face imprint reads on **both** the dark primary button and
  the light secondary button. Responsive behavior unchanged.

## 12. No-final-approval confirmation
The stamp communicates **reviewing evidence / preparing acceptance context / checking
acceptance signals / leaving a review trace** only. It does **not** imply final approval,
certification, production readiness, a security guarantee, a bug-free guarantee, or
legal/compliance certification — in visuals (controlled ink-red, neutral surfaces) or copy
(banned-language test).

## 13. Verification results
- `pnpm --filter @conclave-ai/dashboard test` — **233/233 pass** (was 242 on the collab
  branch which adds Stage 170; on this `main`-based branch the seal→stamp swap keeps the
  same suite count, incl. the new no-approval-language guard).
- `pnpm --filter @conclave-ai/dashboard typecheck` — **ok** (exit 0).
- `pnpm --filter @conclave-ai/dashboard build` — **ok** (exit 0; intake route 31 kB; no
  `/account` route on this branch, as expected off `main`).
- `pnpm typecheck` (monorepo) — **57/57 successful**.
- Note: a one-time stale `.next/types` error (referencing the collab-branch-only
  `account/page.tsx`) was cleared by removing `apps/dashboard/.next` and rebuilding — not a
  code issue.

## 14. Stage 176 decision — **Option A: stamp metaphor correction ready**
The wax-seal metaphor is fully replaced by the review-stamp ("심사 도장") metaphor — motion,
ink-red color treatment (existing oxblood tokens), copy, component naming, and a documented
future opt-in sound direction — with accessibility/reduced-motion preserved and a test guard
against approval/certification language. **Not deployed, not merged.**

## 15. Confirmation — out of scope did NOT happen
No deploy · no payment/Stripe/billing · no hosted execution · no central-plane change · no
migration · no MCP publish · no npm publish · no auth/OAuth/session · no token/secret work.

## 16. Coordination with PR #155 (separate, unmerged)
This Stage 176 stamp PR and **PR #155** (`docs/stage-168-workspace-collaboration-integrations`,
Stage 168~174 + 175 checkpoint) are **independent** and both branch off `main` @ `9c4e593`.
Both touch `apps/dashboard/src/i18n/dictionary.mjs` + `dictionary.d.mts` (PR #155 adds the
`account.*` namespace; this PR rewrites the `loading.*` namespace) and `intake/page.tsx` is
**not** touched by PR #155. The edits are in **different namespaces/regions**, so a textual
conflict is unlikely but **possible** (adjacent dictionary regions). **Merge-order
implication:** whichever merges second may need a trivial dictionary re-base; recommend
merging one, then rebasing the other and re-running `pnpm --filter @conclave-ai/dashboard
test` (the i18n parity test will catch any key drift). Not resolved here.

## 17. Recommended next stage
**Stage 177 — Dual PR Merge Order Checkpoint** (PR #155 + this Stage 176 stamp PR): decide
merge order, rebase the second, re-verify. Then **dashboard deploy of the stamp motion**
(only on explicit Bae approval), optionally folded into the next deploy train alongside the
already-on-`main` intake i18n. A future **opt-in sound micro-interaction** stage remains
available but is deliberately deferred (off-by-default, user-controlled).
