> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 122 — Usage Limits / Cost Boundary UI

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR #146 (do not merge until Stage 124 checkpoint).

## Goal
Make the beta **usage/cost boundary** clear and honest — **not** implement billing
or enforcement. Beta users and operators should understand that the intake preview
chain is deterministic and low-cost, saved records are lightweight snapshots, and
**no agent/benchmark/LLM execution (and no billing) happens**; future AI/agent
execution will need explicit usage limits.

## Beta usage boundary copy (`apps/dashboard/src/lib/beta-usage-boundary.mjs` + `.d.mts`)
Testable copy constants (pure data, no enforcement/billing/backend):
- `BETA_USAGE_BOUNDARY_HEADING` ("Beta usage boundary")
- `BETA_USAGE_BOUNDARY_ITEMS` (4 bullets: deterministic previews · saving stores a
  lightweight snapshot · does not execute agents / run benchmarks / upload
  evidence / make final decisions · future AI/agent execution will need explicit
  usage limits before beta expansion)
- `BETA_USAGE_NOT_ACTIVE_COPY` ("No billing or paid usage is active for this beta
  preview.")
- `SAVED_WORKFLOW_USAGE_NOTE` ("…stored snapshots for reopening the preview chain.
  They are not completed agent runs or benchmark results.")
- `ADMIN_USAGE_BOUNDARY_NOTE` + `ADMIN_COUNTS_SIGNAL_NOTE` (admin view shows
  summaries only, no charges/billing/execution; counts are activity signals, not
  billing metrics)

## What is active now
- Deterministic, in-app preview chain (Intake → … → Evolution Action Pack Preview).
- Lightweight saved workflow snapshots (tenant-scoped by `userKey`).

## What is NOT active
- No agent execution, no benchmark execution, no evidence upload, no final
  decision, no LLM call from the beta workflow chain.
- **No billing / paid usage / credit deduction / enforcement.** Copy deliberately
  avoids active-billing language (charged / invoice / paid plan / metered usage /
  subscription / payment required) — verified by tests.

## UI placement
1. **Intake page** (`/projects/new/intake`) — "Beta usage boundary" panel right
   after the onboarding/preview-only panel: 4 boundary bullets + the "no billing
   active" note.
2. **Saved workflow plans section** — `SAVED_WORKFLOW_USAGE_NOTE` added alongside
   the existing Stage 120 tenant-scope + retention notes (no conflicting copy).
3. **Admin console** (`/admin/workflows`) — `ADMIN_USAGE_BOUNDARY_NOTE` +
   `ADMIN_COUNTS_SIGNAL_NOTE` under the existing disclaimer. No billing metrics
   added.

## Data / privacy copy
Reuses Stage 120 copy ("Saved workflow plans may include excerpts and generated
snapshots. Archive or delete records you no longer need.") — no duplicate/
conflicting copy introduced.

## No billing / enforcement / backend changes
No billing/payment implementation, credit deduction, usage enforcement, new D1
migration, new central-plane route, AI/LLM call, agent/benchmark execution,
analytics provider, deploy, or domain change. Pure dashboard copy + a constants
module.

## Verification
- `apps/dashboard`: **333/333** tests (+9 beta-usage-boundary: deterministic
  preview, no agent execution, no benchmark execution, no billing active, avoids
  active-billing language, saved-snapshot framing, admin summaries-only, counts-
  as-activity-signals, future-limits-framed-as-future), typecheck clean, build
  green (`/projects/new/intake` 22.5 kB, `/admin/workflows` 2.59 kB). Lint =
  pre-existing `export/page.tsx` warning only.
- `apps/central-plane`: **1181/1181** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 123 — Auth / Workspace Boundary Decision.
