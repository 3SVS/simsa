> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 38 — Rerun Comparison in PR Comment Body

## Goal
When a user triggers a re-run of a PR review, they can now include a comparison between the old and new results directly in the GitHub PR comment body. This makes the improvement (or regression) visible to all PR reviewers without them needing to open the Conclave dashboard.

## What changed

### D1 migration
`migrations/0039_workspace_pr_review_runs_lineage.sql`
- `ALTER TABLE workspace_pr_review_runs ADD COLUMN rerun_of_review_run_id TEXT`
- Index on the new column for ancestry queries

### central-plane

**`workspace/pr-review-db.ts`** — full rewrite
- `DbReviewRun` type: `rerunOfReviewRunId?: string`
- Shared `COLS` constant + `RawRow` type + `mapRow` function (eliminates column drift)
- `insertReviewRun`: accepts `rerunOfReviewRunId?`, persists to DB
- All SELECT queries return `rerun_of_review_run_id`

**`workspace/pr-review-run-loader.ts`**
- `LoadedReviewRun`: `rerunOfReviewRunId?: string`
- `loadPRReviewRunForAction`: populates field from DB row

**`workspace/pr-comment.ts`**
- `BuildCommentOptions`: `includeRerunComparison?: boolean`, `rerunComparisonData?: SpecificRunComparison`
- `buildRerunComparisonPart(data)`: generates "## 다시 확인 결과 비교" section with 4 groups (좋아진 항목 / 새로 생긴 문제 / 아직 남은 항목 / 변화 없음)
- `buildCommentBody` return: `rerunComparisonIncluded: boolean`
- Priority: rerun comparison > latest-two comparison > fix brief > footer

**`routes/workspace-github.ts`**
- POST review `insertReviewRun`: passes `rerunOfReviewRunId`
- Run detail endpoints (project-scoped + PR-scoped): `run.rerunOfReviewRunId` in response
- `comment/preview`: `includeRerunComparison` parsing + lineage load + comparison build
- `comment/post`: same logic for the actual GitHub comment body
- Warnings: `rerun_comparison_requires_review_run_id`, `rerun_source_not_available`, `rerun_comparison_not_available`, `latest_comparison_skipped_because_rerun_comparison_requested`, `rerun_comparison_section_omitted_due_to_length`

### dashboard

**`lib/workspace-github-api.ts`**
- `PRReviewRunDetail`: `rerunOfReviewRunId?: string`
- `previewPRComment` input: `includeRerunComparison?: boolean`
- `postPRComment` input: `includeRerunComparison?: boolean`

**`app/projects/[id]/github/history/[runId]/page.tsx`**
- Lineage badge: "다시 확인한 기록" chip + "이전 확인 기록 보기 →" link (when `run.rerunOfReviewRunId` is set)
- `CommentPanel`: new `rerunOfReviewRunId?` prop; checkbox "이전 확인 기록과의 비교 포함" (checked by default when run has lineage); passes `includeRerunComparison` to both preview and post calls

## API

### comment/preview + comment/post
New optional body field:
```json
{ "includeRerunComparison": true }
```
Requires `reviewRunId` to be set (warns otherwise).

### Warnings
| Warning | Meaning |
|---------|---------|
| `rerun_comparison_requires_review_run_id` | `includeRerunComparison=true` but no `reviewRunId` |
| `rerun_source_not_available` | run has no `rerunOfReviewRunId` in DB |
| `rerun_comparison_not_available` | source run found but `comparable=false` |
| `latest_comparison_skipped_because_rerun_comparison_requested` | both `includeComparison` and `includeRerunComparison` were true; rerun takes priority |
| `rerun_comparison_section_omitted_due_to_length` | section would exceed GitHub 65536 char limit |

## Tests
`test/workspace-pr-rerun-comment.test.mjs` — 15 tests
- A (1-3): run detail endpoints expose `rerunOfReviewRunId`
- B (4-12): comment/preview warning paths and body content
- C (13-15): comment/post body content and customBody override

## What was NOT changed
- Billing / credit logic
- Actual debit activation
- Payment provider integration
- Private repo support
- `selectedItemIds` editing UX
- History list direct re-run button
- Autofix / patch / commit / branch operations
