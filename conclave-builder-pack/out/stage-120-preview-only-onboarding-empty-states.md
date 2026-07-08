> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 120 — Preview-only Onboarding / Empty States

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR #146 (do not merge until Stage 124 checkpoint).

## Goal
Make the long intake preview chain understandable and safe for beta users — so a
**preview is never confused with an executed result.** Reinforces that the flow is
deterministic, preview-only, and does **not** execute agents, run benchmarks,
collect evidence, or make final decisions.

## Onboarding copy added (`apps/dashboard/src/lib/beta-onboarding.mjs` + `.d.mts`)
Centralized, testable copy constants (pure data, no component):
- `ONBOARDING_HEADING` / `ONBOARDING_INTRO`
- `ONBOARDING_STEPS` (4: Understand the artifact → Map acceptance items → Plan
  role-based review work → Save the workflow plan for later review)
- `ONBOARDING_SAFETY_LINE` ("…does not execute agents, collect evidence, run
  benchmarks, or make final decisions.")
- `PREVIEW_LANGUAGE_ITEMS` (5-term legend)
- `BETA_SAFETY_NOTES` (`beforeInput`, `savedScope`, `savedRetention`, `feedback`)
- `EMPTY_STATES` (`beforeInput`, `noSavedRecords`, `noOpenedRecord`)

## Preview-only language (legend)
A "Preview language" legend on the onboarding panel defines the repeated terms:
- **Candidate** — a suggested item that still needs review
- **Expected evidence** — proof that should be collected later
- **Not verified** — no evidence has been collected yet
- **Recommended tool** — a suggested tool, not an executed action
- **Action preview** — a suggested next action, not a created action pack

## UI placement (`/projects/new/intake`)
1. **Top onboarding panel** — heading + intro + numbered 4 steps + safety line +
   the preview-language legend (compact card under the page subtitle).
2. **Before-input empty state** — when no starting point is picked, shows
   `EMPTY_STATES.beforeInput`.
3. **Before-input safety note** — under the textarea hint, an amber note:
   *"Avoid pasting confidential secrets, tokens, or sensitive customer data."*
4. **Saved workflow plans** — tenant-scope honesty note
   (`savedScope`: "beta tenant scoping, not full team authentication") +
   retention note (`savedRetention`: "Archive or delete records you no longer
   need", linking Stage 118 controls to data safety).
5. **No saved records empty state** — `EMPTY_STATES.noSavedRecords`.
6. **Records exist but none opened** — `EMPTY_STATES.noOpenedRecord`
   ("Open a saved workflow plan to see benchmark handoff, decision/outcome, and
   evolution action previews.").
7. **Feedback CTA** (Stage 119) reuses `BETA_SAFETY_NOTES.feedback` copy; no extra
   feedback buttons added.

## Data safety notes
- Discourages pasting secrets/tokens/sensitive customer data before input.
- Honest about scoping: client-supplied `userKey`, **not** full team auth.
- Connects archive/delete (Stage 118) to retention hygiene.

## No backend / DB / auth changes
No D1 migration, central-plane route, auth change, billing, email/analytics
provider, deploy, or domain change. Pure dashboard copy + a constants module.

## Verification
- `apps/dashboard`: **324/324** tests (+9 beta-onboarding: heading/steps,
  safety-line claims, 5-term legend with no completion claims, secrets-discourage
  note, tenant-scoping honesty, retention archive/delete, feedback safe-context,
  empty states, no secret-encouragement), typecheck clean, build green
  (`/projects/new/intake` 22.1 kB). Lint = pre-existing `export/page.tsx`
  exhaustive-deps warning only.
- `apps/central-plane`: **1174/1174** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 121 — Admin Beta Console for Saved Workflows.
