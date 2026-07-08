> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 121 — Admin Beta Console for Saved Workflows

**Date:** 2026-06-23
**Train:** Beta Readiness / Team Usage (Stage 118~124) · branch `feat/stage-118-saved-workflow-management` · PR #146 (do not merge until Stage 124 checkpoint).

## Goal
Give the operator a minimal **beta admin console** to understand beta usage and
safely manage saved workflow records across `userKey` scopes. This is for beta
operations — **not** full account administration.

## Admin protection model (existing convention reused)
Reuses the existing admin-key convention (`workspace-admin-stats.ts`):
`x-admin-key` header must equal `c.env.ADMIN_USAGE_STATS_KEY`. **503** when the
key is unset, **401** on mismatch. **No new secret, no new auth model, no RBAC.**
The dashboard enters the admin key at query time and never stores it (matches
`workspace-admin-api.ts`).

## Central-plane endpoints (added to the CORS-enabled workflow route)
| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/workspace/admin/agent-workflows` | List across userKeys + summary; **summaries only (no snapshot JSON)** |
| PATCH | `/workspace/admin/agent-workflows/:id` | Admin archive/restore (`{status}`, allowlist `planned|needs_evidence|archived`) |
| DELETE | `/workspace/admin/agent-workflows/:id` | Admin hard delete (smoke/test/problematic records) |

GET query options: `userKey?`, `status?` (validated against the status enum),
`includeArchived?` (default **excludes** archived), `limit?`. Response:
```ts
{ records: [{ id, userKey, projectId, intakeType, title, sourceSummary, status, createdAt, updatedAt }],
  summary: { total, byStatus, byIntakeType, uniqueUserKeys } }
```
PATCH returns the updated record summary (incl. `userKey`); DELETE returns
`{ok,deleted:true,id}` and a repeated delete → **404**. PATCH/DELETE require the
admin key (non-admin → 401) and update by id **regardless of userKey** (admin
scope), 404 when the id does not exist. No bulk delete.

DB: `adminListWorkflowRecords` (new) selects summary columns incl. `user_key`
(no snapshot JSON), applies the filters, bounds the scan at FETCH_CAP=1000, and
computes the summary in JS; PATCH/DELETE reuse Stage 118's
`updateWorkflowRecordStatus` / `deleteWorkflowRecordById`.

## Dashboard admin UI — `/admin/workflows`
`"use client"` page (operator-only), self-contained copy:
- Admin key input (password, not stored), userKey filter, status filter, include-
  archived toggle, Refresh.
- **Summary cards**: total · planned · needs evidence · archived · unique user keys.
- **Records list**: id, userKey, intake type, title, status, created/updated +
  per-record **Archive / Restore** and **Delete** (confirmed).
- Disclaimer: *"Beta admin console. Records are scoped by client-supplied userKey,
  not full account authentication. Avoid exposing or copying sensitive workflow
  content."*
- API client `lib/admin-agent-workflows-api.ts`:
  `listAdminAgentWorkflows`, `updateAdminAgentWorkflowStatus`,
  `deleteAdminAgentWorkflow` (all send `x-admin-key`).

## Summary-only / privacy principle
The admin list **never returns snapshot JSON** (acceptance map / stage plan /
agent run plan / evidence plan) — only summary metadata. This limits sensitive
exposure in the operator view. (No admin detail endpoint exposing full snapshots
was added; summaries are sufficient for Stage 121.)

## Tenant / userKey caveat (no overclaim)
Records are scoped by the existing **client-supplied `userKey`** convention —
this is **tenant scoping, not full account authentication or RBAC**. The admin
console is gated by the shared admin key only. A real auth/workspace boundary is
the Stage 123 decision.

## No production deploy / migration
No D1 migration (reuses the Stage 118 `status` column + 0046 table); no production
deploy; no remote migration apply. Merge/deploy is the Stage 124 checkpoint.

## Verification
- `apps/central-plane`: **1181/1181** tests (+7 admin: key required 503/401,
  list across userKeys + summary counts, no snapshot JSON, default-excludes-
  archived + includeArchived, userKey/status filters, PATCH archive/restore any
  record, PATCH invalid status 400 / missing 404 / non-admin 401, DELETE any /
  missing 404 / non-admin 401). typecheck clean.
- `apps/dashboard`: **324/324** (`.ts` admin client + page have no node --test,
  per convention; exercised via build/typecheck), typecheck clean, build green
  (`/admin/workflows` 2.15 kB). Lint = pre-existing `export/page.tsx` warning only.
- Monorepo `turbo run typecheck`: **56/56**.

## Next stage
Stage 122 — Usage Limits / Cost Boundary UI.
