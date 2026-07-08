> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 36 — Run-Specific Fix Pack & PR Comment

## 목표

Stage 35에서 확인 기록 상세 페이지를 구현했으나, Fix Pack 생성과 PR comment 작성이 항상 최신 확인 결과를 사용했다. Stage 36에서는 특정 확인 기록의 결과를 기준으로 Fix Pack과 PR comment를 생성할 수 있도록 엔드포인트를 확장한다.

---

## 구현 범위

### 하지 않는 것 (변경 없음)
- 크레딧/billing 로직 변경
- 실제 debit 활성화
- 결제 연동
- autofix/patch/commit/branch 생성
- 프라이빗 레포 지원 확장

---

## 백엔드 변경

### 신규: `workspace/pr-review-run-loader.ts`

action 엔드포인트(Fix Pack, comment 생성)에서 공유하는 run 로드 헬퍼.

**정책:** 상세 조회(Stage 35)는 malformed JSON일 때 빈 결과로 fallback. Action 엔드포인트는 empty results에서 Fix Pack / comment 생성 불가 → hard error.

```ts
export type LoadRunForActionResult =
  | { ok: true; run: LoadedReviewRun }
  | { ok: false; error: "review_run_not_found" | "review_run_mismatch" | "review_run_parse_failed" };

export async function loadPRReviewRunForAction(opts: {
  env: Env; projectId: string; repoFullName: string; prNumber: number; reviewRunId: string;
}): Promise<LoadRunForActionResult>
```

소유권 검증 3-way: `projectId + repoFullName + prNumber` 모두 일치해야 통과.

---

### `workspace/pr-comment.ts` 변경

`BuildCommentOptions`에 `runTimestamp?: string` 추가:

```ts
export type BuildCommentOptions = {
  // ... 기존 필드 ...
  /** ISO timestamp of the specific review run this comment is based on. */
  runTimestamp?: string;
};
```

`runTimestamp`가 있으면 comment body의 서문에 이탤릭 라인 삽입:

```
_이 코멘트는 2026. 06. 13. 13:30에 실행된 PR 확인 기록 기준입니다._
```

---

### `routes/workspace-github.ts` 변경

#### `POST .../fix-brief`

`reviewRunId?` 파라미터 추가. 있으면 `loadPRReviewRunForAction`으로 해당 run 로드.

**응답에 `sourceReviewRun` 필드 추가:**
```json
{
  "sourceReviewRun": {
    "id": "wprr_xxx",
    "createdAt": "2026-06-13T04:30:00.000Z",
    "status": "failed",
    "summary": { "passed": 1, "failed": 1, "inconclusive": 0, "needsDecision": 0 }
  }
}
```

#### `POST .../comment/preview`

`reviewRunId?` 파라미터 추가.
- `reviewRunId` 있으면: 해당 run 로드 → `runTimestamp` 설정
- `reviewRunId + includeComparison=true`: comparison 건너뜀 + `"comparison_not_available_for_specific_run"` warning 추가

#### `POST .../comment` (post)

`reviewRunId?` 파라미터 추가.

**실행 순서 변경 (mismatch fail-fast):**
1. linked repo 조회
2. **run 검증** (reviewRunId 있을 때) — token 복호화 전에 mismatch 거부
3. GitHub connection + 권한 확인
4. token 복호화
5. comment 생성 & GitHub API 호출

---

## 에러 응답

| 에러 코드 | 상태 | 설명 |
|-----------|------|------|
| `review_run_not_found` | 404 | runId가 DB에 없음 |
| `review_run_mismatch` | 404 | projectId/repoFullName/prNumber 불일치 |
| `review_run_parse_failed` | 400 | resultJson 파싱 실패 또는 빈 배열 |
| `comparison_not_available_for_specific_run` | warning | 특정 run에서 comparison 요청 시 |

---

## 대시보드 변경

### `apps/dashboard/src/lib/workspace-github-api.ts`

`previewPRComment`, `postPRComment`, `generatePRFixBrief` 입력에 `reviewRunId?: string` 추가.

`FixBriefResult`에 `sourceReviewRun?` 필드 추가.

### `apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`

Option A — detail page 내 inline 패널 구현:

**FixPackPanel:**
- "이 기록으로 Fix Pack 만들기" 버튼 클릭 → `generatePRFixBrief(... reviewRunId: runId)` 호출
- 파일 탭 전환 + 전체 복사 지원
- warnings 표시

**CommentPanel:**
- "이 기록으로 PR comment 작성하기" 버튼 클릭 → `previewPRComment(... reviewRunId: runId)` 호출
- 미리보기 후 "GitHub에 남기기" 버튼으로 `postPRComment(... reviewRunId: runId)` 호출
- `comparison_not_available_for_specific_run` warning을 한국어로 변환 표시
- 성공 시 GitHub comment URL 링크 표시

**노출 조건:**
- FixPackPanel: `actionNeeded > 0 && userKey`
- CommentPanel: `hasResults && userKey`

---

## 테스트

파일: `apps/central-plane/test/workspace-pr-run-specific.test.mjs` (15개)

| # | 내용 |
|---|------|
| 1 | fix-brief: reviewRunId로 해당 run 결과 사용 |
| 2 | fix-brief: 다른 PR의 reviewRunId 거부 (404) |
| 3 | fix-brief: 다른 project의 reviewRunId 거부 (404) |
| 4 | fix-brief: malformed resultJson → 400 parse_failed |
| 5 | fix-brief: sourceReviewRun 필드 응답 포함 확인 |
| 6 | comment/preview: reviewRunId로 해당 run 결과 사용 |
| 7 | comment/preview: 불일치 reviewRunId 거부 (404) |
| 8 | comment/preview: reviewRunId + includeComparison → comparison_not_available warning |
| 9 | comment/preview: run timestamp 라인 body 포함 확인 |
| 10 | comment/preview: malformed resultJson → 400 |
| 11 | comment post: 유효한 run → token 체크 단계까지 도달 (run 로드 성공 확인) |
| 12 | comment post: 불일치 reviewRunId → 404 mismatch (token 복호화 전 거부) |
| 13 | loadPRReviewRunForAction: 없는 runId → not_found |
| 14 | loadPRReviewRunForAction: 다른 prNumber → mismatch |
| 15 | loadPRReviewRunForAction: 빈 results 배열 → parse_failed |

**결과:** 880/880 통과 (Stage 36 신규 15개 포함)

---

## 커밋

`feat(workspace): Stage 36 — run-specific Fix Pack & PR comment`

변경 파일:
- `apps/central-plane/src/workspace/pr-review-run-loader.ts` (신규)
- `apps/central-plane/src/workspace/pr-comment.ts`
- `apps/central-plane/src/routes/workspace-github.ts`
- `apps/central-plane/test/workspace-pr-run-specific.test.mjs` (신규)
- `apps/dashboard/src/lib/workspace-github-api.ts`
- `apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`
- `conclave-builder-pack/out/stage-36-run-specific-fix-pack-comment.md` (이 파일)
