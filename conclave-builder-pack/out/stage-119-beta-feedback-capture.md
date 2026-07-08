> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 119 — Beta Feedback Capture

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR #146 (do not merge until Stage 124 checkpoint).

## Goal
Give beta users / internal testers an easy way to send feedback about the intake
workflow **without accidentally transmitting sensitive pasted content.** Stage 118
made saved records manageable; Stage 119 adds a low-risk feedback path.

## Feedback capture approach — `mailto` first
A deterministic helper builds a `mailto:` URL with **safe context only**. No
backend, no DB, no central-plane route, no email/analytics provider. The user's
own mail client opens pre-filled; they choose what to send.

### Why mailto first
- Zero backend/infra risk and zero new data at rest.
- Cannot auto-transmit raw input or snapshots — the helper only accepts a small
  allowlist of non-sensitive fields and uses a **fixed body template**.
- Fastest safe path to real beta feedback; a backend route can come later only
  with explicit approval.

## Helper — `apps/dashboard/src/lib/beta-feedback.mjs` (+ `.d.mts`)
`buildBetaFeedbackMailto({ route?, intakeType?, workflowRecordId?, section?,
subjectPrefix? }): string` — pure, deterministic, URL-encoded (spaces as `%20`).

- Recipient: **`seunghunbae@b2w.kr`** (existing public contact — no new mailbox
  invented).
- Subject: `[Simsa beta feedback] <section | "Intake workflow">`.
- Body: greeting + **Context** (only the safe fields that were provided) +
  **Feedback** prompts (what was confusing / useful / expected next / any bug) +
  a safety note: *"Please do not include sensitive product details unless you are
  comfortable sharing them."*

### Safe context fields (included)
`route`, `intakeType`, `workflowRecordId`, `section`, `subjectPrefix`.

### Excluded sensitive fields (never included)
Raw pasted input, full workflow snapshots (acceptance map / stage plan / agent run
plan / evidence plan), private repo details, `userKey`, any secret/token. The
function signature does not accept these, and the body is a fixed template — extra
keys passed by accident are ignored (covered by a test).

## UI behavior — `/projects/new/intake`
A small `FeedbackLink` component (renders an `<a href={mailto}>`) at three minimal
entry points:
1. **Page-level** — "Share beta feedback" under the subtitle, with the note
   *"opens an email with safe context only (no pasted content or workflow
   snapshots are included)."* Context: `section: "Intake workflow"`.
2. **Preview-section** — "Feedback on this preview" on the Evidence Plan card
   (the deterministic chain endpoint). Context: `intakeType`, `section: "Evidence
   Plan"`.
3. **Saved workflow detail** — "Send feedback on this saved workflow" in the
   opened record. Context: `intakeType`, `workflowRecordId`, `section: "Saved
   workflow detail"`.

Kept intentionally minimal to avoid clutter. `mailto` is an external link, so
`<a>` is correct (no Next `no-html-link-for-pages` concern).

## No backend / DB / provider
No D1 migration, no central-plane feedback route, no email provider, no analytics
provider, no automatic raw-content or snapshot submission. If a backend feedback
route is ever wanted, scope it separately with approval — not in Stage 119.

## Verification
- `apps/dashboard`: **315/315** tests (+9 beta-feedback: recipient, subject
  prefix, context fields, default topic, custom prefix, accidental-leak guard,
  URL-encoding, safety note, deterministic), typecheck clean, build green
  (`/projects/new/intake` 21.3 kB). Lint = pre-existing `export/page.tsx`
  exhaustive-deps warning only.
- `apps/central-plane`: **1174/1174** (unchanged), typecheck clean.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 120 — Preview-only Onboarding / Empty States.
