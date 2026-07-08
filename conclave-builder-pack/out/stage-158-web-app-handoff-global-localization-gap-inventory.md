> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 158 — Web App Handoff Global Localization / i18n Gap Inventory

**Date:** 2026-06-24
**Branch:** `docs/stage-154-claude-desktop-dogfood-evidence` (Stage 154~159 train, PR #153) · **Base:** `main` @ `de6f7e6`
**Type:** inventory / planning (docs-only). **No publish, no version bump, no payment/Stripe, no hosted execution, no central-plane, no migration, no deploy, no auth.**

## 1. Goal
Inventory the hardcoded English copy on the Simsa Web App handoff/intake destination
(the page the MCP handoff link opens) and plan a **global, dictionary-first** i18n fix
that reuses the dashboard's existing i18n system. Publish stays held.

## 2. Bae-reported gap
The MCP handoff link works, but the receiving Simsa Web App intake/handoff page displays
**hardcoded English** text.

## 3. Why this is global i18n, not Korean-only
Simsa targets global users. The fix is **not** to swap English for Korean — it is to
remove hardcoded copy from the user-facing surface and route it through the existing
dictionary system, with **English as the safe fallback**, **Korean as a required early
locale**, and future languages added by **dictionary entries only** (no component
rewrites). No machine translation / no translation API / no AI translation in this train.

## 4. Handoff destination route
- Handoff URL: `https://app.trysimsa.com/projects/new/intake` (built by
  `@conclave-ai/workspace-preview` `buildWebAppHandoffLink`; `source=mcp_basic`).
- Route file: **`apps/dashboard/src/app/projects/new/intake/page.tsx`** (`"use client"`,
  **1899 lines**), plus its imported label modules `@/lib/intake.mjs`
  (`INTAKE_META`, `INTAKE_OUTPUT_LABELS`) and the per-type/preview `lib/intake-*.mjs`
  helpers it renders.

## 5. Existing i18n/dictionary pattern (reusable — do NOT invent a second system)
- `apps/dashboard/src/i18n/dictionary.mjs` — `LOCALES = ["en","ko"]`,
  `DEFAULT_LOCALE = "en"`, `normalizeLocale`, `getDictionary(locale)` (falls back to en),
  `readStoredLocale`/`writeStoredLocale` (localStorage key `conclave:locale`). Large
  nested `EN`/`KO` dictionaries.
- `apps/dashboard/src/i18n/I18nProvider.tsx` — client provider; `useI18n()` →
  `{ locale, setLocale, t }`; SSR falls back to `DEFAULT_LOCALE`.
- This is the same dictionary-first system that localized the rest of the dashboard
  (Stage 59/60/63). **The architecture is sufficient.**

## 6. Locale detection and propagation inventory
- **Detection today:** `I18nProvider` reads locale from **localStorage only**. No
  browser-language detection, **no route locale segment, no `?locale`/`?lang` query**,
  no account locale setting. Fallback = en.
- **Handoff link builder:** allowlists `source/intent/type/preview/previewId/title/
  summary/utm_*` — **no `locale`/`lang` param**.
- **Implication:** an MCP user's host language can't yet propagate to the Web App.
  Recommend a **follow-up** (not this train): (1) intake page consumes `useI18n`;
  (2) `I18nProvider` reads a safe `?locale=` query (normalized via `normalizeLocale`,
  en fallback); (3) handoff builder allowlists a `locale` param (values `en`/`ko`…).
  Do **not** add `locale` to the handoff builder until the Web App consumes it.

## 7. Hardcoded copy inventory
**Root finding:** `projects/new/intake/page.tsx` **does not import `useI18n` at all** —
it is **100% hardcoded English**, and the dictionary has **no `intake:` namespace**.
This is the one major dashboard surface that bypasses the i18n system (it was added in
the Stage 101~108 Intake Train, after the Stage 63 full-i18n pass). Magnitude:
**hundreds** of strings across the page + sub-sections.

| File | UI surface | Hardcoded copy (examples) | Current behavior | i18n key proposal | en | ko | Priority | Fix stage |
|------|-----------|---------------------------|------------------|-------------------|----|----|----------|-----------|
| `intake/page.tsx` | page header / front door | "Intake workflow", start-point labels (`INTAKE_META`) | hardcoded | `intake.header.*`, `intake.startPoints.*` | keep | "인테이크 워크플로" | **P0** | Stage 159 |
| `intake/page.tsx` | preview output headings | "Candidate user flows", "Candidate acceptance items", "Missing questions", "Review focus areas" | hardcoded | `intake.preview.*` | keep | 번역 | **P0** | Stage 159 |
| `intake/page.tsx` | evidence plan section | "Candidate checks", "Evidence to collect", "Exit criteria" | hardcoded | `intake.evidence.*` | keep | 번역 | **P0** | Stage 159 |
| `intake/page.tsx` | ai-built-app section | "Likely keep", "Likely fix", "Likely rebuild", "Needs verification", "Likely risks" | hardcoded | `intake.aiApp.*` | keep | 번역 | P1 | Stage 159 |
| `intake/page.tsx` | graph/blocker/memory/template sections | "Inputs", "Acceptance items", section headers | hardcoded | `intake.graph.* / blockers.* / memory.* / template.*` | keep | 번역 | P1 | Stage 159 |
| `intake/page.tsx` | beta feedback | "Share beta feedback" | hardcoded (FeedbackLink may already be i18n) | `intake.feedback.*` | keep | 번역 | P1 | Stage 159 |
| `@/lib/intake.mjs` | `INTAKE_META`, `INTAKE_OUTPUT_LABELS` | type/output display labels | hardcoded constants (shared) | label-map via `t` (Stage 63 `(t,value)` helper pattern) | keep | 번역 | **P0** | Stage 159 |
| `lib/intake-*.mjs` | per-type preview field labels | derived field titles | hardcoded in helpers | render-time map through `t`, keep helper data deterministic | keep | 번역 | P1 | Stage 159 |

Priority key: **P0** = visible on the MCP handoff first screen; **P1** = visible after
interaction/expansion; P2 = dev-only (none material here).

## 8. Global copy policy recommendation — **Option G (global dictionary-first)**
- Do **not** replace English hardcoding with Korean hardcoding.
- Convert visible copy to dictionary keys (new `intake.*` namespace under `EN`/`KO`).
- Maintain the English baseline; add Korean early-locale coverage for this surface.
- Keep technical product terms consistent globally.
- **Product terms kept in English** (optionally with a Korean gloss): Simsa, MCP Basic,
  Acceptance map (수용 기준 지도), Stage plan (단계 계획), Evidence plan (검증 증거 계획),
  Handoff (웹앱으로 넘기기), Preview only (미리보기 전용), Not saved (저장되지 않음).
- Follow the established Stage 63 convention: keep `.mjs` helper **data** deterministic
  and map enums/labels to copy at render time via a `(t, value)` helper, so label
  modules stay testable under Node 20 CI.

## 9. Initial locale recommendation
- **Phase 1 (Stage 159):** `en` complete baseline + `ko` complete for the handoff/intake
  surface; fallback `en`. (Matches current `LOCALES = ["en","ko"]`.)
- **Phase 2 (future, dictionary-only):** add `ja, zh-CN, zh-TW, es, fr, de, pt, id, vi,
  th, ar, hi` by adding dictionary entries (and `LOCALES`) — no component rewrites. Do
  **not** add Phase 2 translations in this train; the Stage 158 output is the structure
  + inventory, not full translation coverage.

## 10. Fix plan (for Stage 159)
1. Add an `intake.*` namespace to `EN` and `KO` in `dictionary.mjs` (+ `.d.mts` types),
   covering P0 first, then P1.
2. Make `intake/page.tsx` consume `useI18n()` and replace hardcoded strings with `t.intake.*`.
3. Localize `INTAKE_META` / `INTAKE_OUTPUT_LABELS` / per-type labels via render-time `t`
   maps (keep helper data deterministic).
4. Add/extend i18n parity tests (en/ko key parity) and the dashboard i18n test.
5. Verify with `pnpm --filter @conclave-ai/dashboard test/typecheck/build`; **no deploy**.
6. (Deferred follow-up, not Stage 159 unless trivial) locale propagation: `?locale=`
   consumption in `I18nProvider` + `locale` param in the handoff builder.

## 11. Risk assessment
- **Large surface (1899 lines):** convert in P0→P1 order; keep each change copy-only (no
  route/data/API behavior change) to stay low-risk and reviewable.
- **Shared label modules:** `intake.mjs` is shared (also re-exported via
  `@conclave-ai/workspace-preview`); localize at the dashboard render layer, **not** by
  hardcoding Korean into the shared deterministic helpers (would break MCP determinism +
  Node-CI tests).
- **KO parity drift:** enforce with en/ko key-parity tests (existing pattern).
- **No new system:** reuse `useI18n`/dictionary — do not add a second i18n mechanism.

## 12. Publish readiness implication
**MCP publish remains held.** Claude Desktop core MCP flow passed; `Simsa-Basic` display
name fixed; the handoff link itself is valid and safe — **but** the receiving Web App
handoff/intake surface still has a global i18n readiness gap (100% hardcoded English).
No public publish recommended until this surface is dictionary-first (Stage 159) or the
gap is explicitly accepted for private dogfood only.

## 13. Stage 158 decision
**Option A — Inventory ready, global i18n fix deferred to Stage 159.** The existing
dictionary-first i18n system is sufficient and reusable; this is a **coverage** gap (the
intake page was never wired to `useI18n`), not an architecture gap. Stage 159 implements
the dictionary-first `intake.*` localization (en baseline + ko), P0 first. Docs-only this
stage; no dashboard code changed.

## 14. Recommended next stage
**Stage 159 — Web App Handoff Dictionary-first i18n Fix / Private Dogfood Checkpoint**
(implement the `intake.*` localization for the handoff/intake surface, add en/ko parity
tests, verify dashboard build; then the train checkpoint + merge/publish decision pending
Bae approval). **Do not merge** the train PR until then.
