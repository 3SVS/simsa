> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 118 — Saved Workflow Management Hardening

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR (do not merge until Stage 124 checkpoint).

## Goal
Give users and operators safe, tenant-scoped controls to **archive, restore, and
delete** saved agent workflow records. Stage 112 added save; Stage 116 left a safe
smoke record in production precisely because there was no removal path. This is the
first data-control prerequisite before inviting any beta user to save records.

## Migration decision
**No new migration.** The existing `workspace_agent_workflow_records` table already
has `status TEXT NOT NULL DEFAULT 'planned'` and `updated_at`. Archive = set
`status='archived'`; restore = set it back to `planned`; explicit removal = hard
`DELETE`. No `archived_at`/`deleted_at` column was needed.

## Central-plane behavior
Existing routes unchanged; two added (browser-facing, CORS, tenant-scoped):

| Method | Path | Behavior |
| --- | --- | --- |
| PATCH | `/workspace/agent-workflows/:id` | `{ userKey, status }` → set status; **404** if missing/cross-tenant; updates `updated_at`; `user_key` not exposed |
| DELETE | `/workspace/agent-workflows/:id` | `?userKey=` → hard delete; **404** if missing/cross-tenant; returns `{ok:true,deleted:true,id}`; repeated delete → 404 |

Rules:
- `userKey` required (existing repo convention) → 400 if absent.
- **PATCH status allowlist** = `planned | needs_evidence | archived` (`draft` is
  creation-only; unknown/invalid → 400 `invalid_status`).
- Ownership is verified via `getOwnedWorkflowRecordById` before any write; a
  record owned by another `userKey` returns **404** (not 403) — does not reveal
  existence.
- DB helpers added: `updateWorkflowRecordStatus(id, status)` and
  `deleteWorkflowRecordById(id)` (callers verify ownership first).

## List / includeArchived behavior
`GET /workspace/agent-workflows?userKey=…`:
- **Default excludes archived** (`status != 'archived'`).
- `&includeArchived=true` includes all statuses.
- `projectId` filter still applies within the caller's scope.
Implemented by building the `WHERE` clause dynamically (`status != 'archived'` is a
SQL literal; binds remain user_key, [project_id], limit). `GET detail` still
returns an own **archived** record (archive hides it from the default list, not
from direct access).

## Dashboard behavior (`/projects/new/intake` → Saved workflow plans)
- **Show archived** checkbox (re-lists with `includeArchived`).
- Each record shows title, intake type, **status**, created + updated time, id.
- Per-record actions: **Open**; **Archive** (when not archived) / **Restore**
  (when archived); **Delete** (with `window.confirm`).
- After archive/restore/delete: the list refreshes; if the opened record was
  archived it updates the open detail, if deleted it closes; a small
  success/error message is shown.
- API client (`workspace-agent-workflow-api.ts`): `listWorkflowRecords(userKey,
  {includeArchived})`, `patchWorkflowRecordStatus(id, userKey, status)`,
  `deleteWorkflowRecord(id, userKey)`.

## No auth overhaul
Tenant scoping is unchanged — still the existing client-supplied `userKey`
convention (dashboard `getUserKey()`), the same as the rest of the workspace API.
Archive/restore/delete are all `userKey`-scoped; they cannot touch another
tenant's record. This is **tenant scoping, not full session/auth security** — the
auth/workspace boundary decision is deferred to Stage 123.

## No production deploy / migration in this stage
No D1 migration added; no production deploy; no remote migration apply. (Routes
work against the already-applied 0046 table — the new columns were never needed.)
Merge/deploy is the Stage 124 checkpoint decision.

## Smoke record cleanup (after rollout)
Production has a known safe smoke record from Stage 116:
`userKey: uk_stage116_smoke_a`, `id: wawr_qbxvly98wa`. **Not touched during Stage
118 development.** After this train's production rollout, it can be removed with
the new endpoint: `DELETE /workspace/agent-workflows/wawr_qbxvly98wa?userKey=uk_stage116_smoke_a`.

## Verification
- `apps/central-plane`: **1174/1174** tests (+10: PATCH archive/restore, invalid
  status 400, missing userKey 400, cross-tenant 404; DELETE own/repeated/cross-
  tenant/missing-userKey; list default-excludes-archived + includeArchived;
  detail returns own archived). typecheck clean.
- `apps/dashboard`: **306/306** (unchanged — `.ts` API client has no node --test,
  per convention; exercised via build/typecheck), typecheck clean, build green
  (`/projects/new/intake` 20.6 kB). Lint = pre-existing `export/page.tsx`
  exhaustive-deps warning only.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 119 — Beta Feedback Capture.
