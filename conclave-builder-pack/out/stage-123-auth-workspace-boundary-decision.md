> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 123 — Auth / Workspace Boundary Decision

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR #146 (do not merge until Stage 124 checkpoint).
**Type:** decision documentation (docs-only). **No real auth, no code change.**

## 1. Decision
**For the Stage 117~124 private beta, Simsa will NOT add real authentication or a
team/workspace model.** The product keeps **private / invite-only** beta using the
existing **client-supplied `userKey` tenant scoping** for saved workflow records.
Real auth / workspace / RBAC is **deferred to a later dedicated train** after beta
validation. This is recorded as the explicit auth boundary decision for this train.

## 2. Current auth / tenant model (honest)
- Dashboard `getUserKey()` creates/uses an anonymous client-side `userKey`
  (localStorage), sent in the POST body / GET query — the same model as the
  existing workspace benchmark/experiment/credit APIs.
- Central-plane saved-workflow routes scope every read/write by `userKey`:
  cross-`userKey` list / detail / PATCH / DELETE is blocked (detail of another
  tenant returns **404**; verified live in the Stage 116 rollout smoke and by
  central-plane tests).
- The admin beta console (`/admin/workflows`, `GET/PATCH/DELETE
  /workspace/admin/agent-workflows`) is protected by the existing `x-admin-key` /
  `ADMIN_USAGE_STATS_KEY` convention.
- **This is tenant scoping, not full account authentication.** Clearing
  localStorage loses access; there is no cross-device identity, no recovery, and
  it is not a security boundary against a determined actor — only against
  accidental cross-tenant access.

## 3. Why not real auth yet
- The product loop still needs **beta validation** (understanding, feedback,
  workflow management) — not scaled multi-user collaboration.
- Real auth + team workspace is a **large scope increase** (provider choice,
  sessions, account tables, invites, ownership migration, RBAC).
- Saved records are **already tenant-scoped by `userKey`** for current beta ops.
- The **admin console** gives operator-level oversight + cleanup.
- A **private / invite-only** beta can run safely today with clear limitations.
- Adding auth now would delay the actual learning goal of the beta.

## 4. Private beta operating policy
- **Private / invite-only** beta; **no open signup** yet.
- **No marketing claim** of secure team workspace / authenticated accounts.
- Ask beta users to **avoid pasting confidential secrets/tokens/sensitive customer
  data** (already surfaced in the UI before input).
- Use **archive / delete** (Stage 118) for data control; **admin console**
  (Stage 121) for operator cleanup (incl. the Stage 116 smoke record).
- Collect feedback via the **safe mailto flow** (Stage 119).
- **Revisit real auth after** private-beta learning.

## 5. What is safe to claim
tenant-scoped beta records · private beta · invite-only beta · saved workflow
plans · admin beta console · archive/delete controls.

## 6. What NOT to claim
secure team workspace · authenticated organization · enterprise-grade permissions
· production auth · user accounts — unless explicitly marked as future work.

## 7. UI copy status (already in place — no new copy needed)
Option A (docs-only) applies because the required honesty copy already exists from
Stages 120~122:
- *"Saved workflow plans are scoped to this browser/user key. This is beta tenant
  scoping, not full team authentication."* (`beta-onboarding.mjs` → intake)
- *"Avoid pasting confidential secrets, tokens, or sensitive customer data."*
  (intake, before input)
- *"Beta admin console. Records are scoped by client-supplied userKey, not full
  account authentication. Avoid exposing or copying sensitive workflow content."*
  (`/admin/workflows`)
- Stage 122 usage-boundary panel reinforces no execution / no billing.

No UI copy change is made in Stage 123 — adding "invite-only" wording is an
**operating policy** (above), not a UI claim required now; it can be added at beta
launch if desired without reopening this decision.

## 8. Future auth / workspace train (after beta learning — not now)
A later dedicated train, roughly:
- Auth 1 — Auth provider decision (e.g. Supabase/OAuth)
- Auth 2 — User account / session model
- Auth 3 — Workspace / team model
- Auth 4 — Invite flow
- Auth 5 — Record ownership migration (migrate `userKey`-scoped records → real
  account/workspace ownership)
- Auth 6 — Admin / RBAC model
- Auth 7 — Auth beta checkpoint

This will **require D1 migrations and careful data migration** from the current
`userKey`-scoped `workspace_agent_workflow_records` to real ownership. Out of
scope for the Beta Readiness train.

## 9. Impact on Stage 124 checkpoint
Stage 124 should evaluate, with this decision as input:
- whether private beta can proceed **without** real auth (this decision: yes),
- whether UI copy sufficiently warns users (Stages 120~122: yes),
- whether archive/delete (118) + admin console (121) controls are enough for beta
  data hygiene,
- whether saved workflow records should be opened broadly or **kept limited /
  invite-only** (this decision: invite-only).

## 10. Recommended next stage
Stage 124 — Private Beta Checkpoint.
