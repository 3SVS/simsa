> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 159 — Web App Handoff Dictionary-first i18n Fix / Private Dogfood Checkpoint

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (PR #153) · **Base:** `main` @ `de6f7e6`
**Type:** dashboard i18n fix + train checkpoint. **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Implement a **dictionary-first** global i18n fix for the Simsa Web App handoff/intake
destination (the page the MCP handoff link opens), then produce the private dogfood
checkpoint for PR #153. Publish stays held.

## 2. Stage 158 findings addressed
Stage 158 found `apps/dashboard/src/app/projects/new/intake/page.tsx` (the handoff
destination) did **not** use `useI18n` and the dictionary had **no `intake.*`
namespace** → 100% hardcoded English (a coverage gap). Stage 159 wires the page to the
existing dictionary-first system and adds `intake.*` (en + ko), reusing
`src/i18n/dictionary.mjs` + `I18nProvider` (`LOCALES = ["en","ko"]`, en fallback). No
second i18n system introduced.

## 3. Implementation summary
- `apps/dashboard/src/app/projects/new/intake/page.tsx`: import + `const { t: tr } =
  useI18n();` (named `tr` to avoid shadowing the `WORKSPACE_INTAKE_TYPES.map((t) => …)`
  callback param). Replaced the **P0 first-screen** copy with dictionary lookups:
  page title (`tr.intake.handoff.title`), subtitle, the "Paste what you have." label,
  the "Preview language" label, the beta-feedback CTA label, and the **start-point
  buttons** (`tr.intake.startPoints[t]?.label ?? m.label`, `?? m.description`).
- `apps/dashboard/src/i18n/dictionary.mjs`: added the `intake` namespace to **both** EN
  and KO.
- `apps/dashboard/src/i18n/dictionary.d.mts`: added the `intake` shape to the
  `Dictionary` type.

### Start-point labels — safe render-layer override
`INTAKE_META` lives in the shared, deterministic `@conclave-ai/workspace-preview`
package (re-exported as `@/lib/intake.mjs`) and is also consumed by MCP. To avoid
breaking MCP determinism / Node-CI, **no Korean was hardcoded into the shared helper**.
The page localizes at the **render layer** via the dictionary, falling back to the
existing English constant (`?? m.label`) when a key is absent.

## 4. Dictionary keys added (`intake.*`)
- `intake.handoff.*` — `eyebrow, title, subtitle, pasteLabel, previewLanguageLabel,
  feedbackLabel, previewOnly, notSaved, safetyNote`
- `intake.startPoints.{idea|prd|product_url|github_repo|pull_request|ai_built_app}` —
  `{ label, description }`
- `intake.previewKinds.{acceptance_map|stage_plan|evidence_plan|agent_run_plan|
  acceptance_graph_summary|recurring_blockers|agent_tool_memory|template_signals}`
- `intake.boundaries.{requiresPaymentFalse|mutatesStateFalse|usesHostedExecutionFalse|
  createsPersistenceFalse|containsSecretsFalse}`

## 5. English baseline copy
Unchanged wording from the current page (e.g. "What do you want Simsa to review?",
"Start from anything…", the start-point labels/descriptions), now sourced from `EN`.
English remains the fallback locale.

## 6. Korean early-locale copy
Korean added for the whole `intake.*` namespace. **Product terms kept in English with a
Korean gloss** per the Stage 158 policy: Acceptance map (수용 기준 지도), Stage plan
(단계 계획), Evidence plan (검증 증거 계획), Handoff, Preview only (미리보기 전용),
Not saved (저장되지 않음); start points e.g. "AI-built app (AI로 만든 앱)".

## 7. Deferred localization items (P1 / follow-up — recorded, not done here to keep the diff isolated)
Still rendered from shared **constant** modules (would need a render-layer label map or
threading `t`, a larger change): the onboarding panel (`ONBOARDING_*`), the beta usage
boundary panel (`BETA_USAGE_*`), the preview-language legend items
(`PREVIEW_LANGUAGE_ITEMS`), empty states (`EMPTY_STATES`), beta safety notes
(`BETA_SAFETY_NOTES`), and the deep per-section preview copy (acceptance map / stage
plan / agent run plan / evidence plan / graph / blocker / memory / template section
headings + field labels), plus per-type preview field labels in `lib/intake-*.mjs`.
Also deferred: **locale propagation** (`I18nProvider` reading `?locale=`, and a `locale`
param in the handoff link builder) — only add once the Web App consumes it.

## 8. Test / build / typecheck results
- `@conclave-ai/dashboard` tests **218/218** ✓ — including the existing **en/ko key
  parity** test, which confirms the new `intake.*` keys match exactly across locales.
- `@conclave-ai/dashboard` typecheck ✓ · build ✓ (`/projects/new/intake` compiled,
  30.1 kB).
- `@conclave-ai/mcp-workspace` **74/74** ✓ (incl. `smoke-basic-stdio` real-spawn);
  `smoke:basic` + `qa:basic-tools` exit 0.
- monorepo typecheck **57/57** ✓.

## 9. MCP private dogfood status
- Claude Desktop core MCP flow: **PASS** (Stage 157, Bae evidence).
- `Simsa-Basic` display name: **applied** (Stage 157).
- Handoff link safety: **PASS**.
- Handoff/intake **i18n**: **improved** — first-screen (P0) copy is now dictionary-first
  with en + ko; deeper P1 copy deferred (§7).

## 10. Publish readiness implication
**MCP publish remains held.** Core app-side flow passed and the handoff/intake
first-screen localization is in place, but public publish still requires a separate
publish-readiness/release decision (and the P1 i18n + locale-propagation follow-ups are
open). No publish in this stage.

## 11. Merge readiness
PR #153 contains the Stage 154~159 evidence/docs plus this **isolated, copy/dictionary
+ useI18n** dashboard change (no route/data/API/persistence change). All checks pass; CI
green expected. Ready to merge after Bae approval. **No dashboard deploy** is performed
here (a separate Bae-approved dashboard deploy would publish the localized page).

## 12. Stage 159 decision — **Option A: Ready to merge PR #153 after Bae approval**
- No deploy required (unless Bae separately approves a dashboard deploy to ship the
  localized intake page).
- No MCP publish · no npm publish · no central-plane deploy · no migration.

## 13. Recommended next stage
**Stage 160 — Simsa Wax Seal Thinking Animation / Motion System** (per the train plan),
or a focused **Intake i18n P1 follow-up** to localize the deferred §7 surfaces. **Do not
merge** PR #153 until Bae approves after this report.
