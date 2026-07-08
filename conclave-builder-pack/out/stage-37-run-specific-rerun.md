> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 37 — Run-Specific Re-run

## 목표

특정 PR review history run을 기준으로 같은 선택 항목을 다시 확인할 수 있게 한다.
이전 run과 새 run의 비교 결과를 detail page에서 인라인으로 표시한다.

---

## 구현 범위 (하지 않는 것)

- billing/credit 로직 변경 금지
- production actual debit 활성화 금지
- private repo full support 금지
- autofix/patch/commit/branch 생성 금지
- PR lineage persistent 저장 (Stage 38 후보)

---

## 백엔드 변경

### `pr-review-compare.ts` — `compareSpecificReviewRuns` 추가

```ts
export type SpecificRunComparison = {
  comparable: boolean;
  sourceRunId: string;
  newRunId: string;
  improved: ImprovedItem[];
  stillOpen: StillOpenItem[];
  newlyProblematic: NewlyProblematicItem[];
  unchanged: UnchangedItem[];
  summaryText: string;
};

export function compareSpecificReviewRuns(
  source: { id: string; results: ReviewResultItem[] },
  newRun: { id: string; results: ReviewResultItem[] },
): SpecificRunComparison
```

- 두 result 배열 중 하나라도 비어 있으면 `comparable: false`
- 비어 있지 않으면 기존 `compareRunResults`를 그대로 재사용

### `routes/workspace-github.ts` — POST review 핸들러 확장

**Request shape 확장:**
```ts
type StartWorkspacePullRequestReviewRequest = {
  userKey: string;
  selectedItemIds?: string[];
  idempotencyKey?: string;
  rerunOfReviewRunId?: string;  // NEW
};
```

**Source run 검증 (token 복호화 전, fail-fast):**
1. `getReviewRunById(env, rerunOfReviewRunId)`
2. 없으면 → `404 rerun_source_not_found`
3. `projectId + repoFullName + prNumber` 3-way 불일치 → `404 rerun_source_mismatch`

**selectedItemIds 우선순위:**
```
body > source run > linked PR > error
```

**Response 확장:**
```ts
{
  ok: true;
  run: { ... };
  rerun?: {
    ofReviewRunId: string;
    reusedSelectedItemIds: string[];  // non-empty only when body IDs not provided
  };
  comparisonToSourceRun?: SpecificRunComparison;
}
```

---

## 에러 응답

| 에러 코드 | 상태 | 설명 |
|-----------|------|------|
| `rerun_source_not_found` | 404 | runId가 DB에 없음 |
| `rerun_source_mismatch` | 404 | project/repo/prNumber 불일치 |

---

## Persistent Lineage 저장 미구현 이유

현재 `workspace_pr_review_runs` 테이블에 `metadata_json` 컬럼이 없다.
Stage 37에서는 `rerunOfReviewRunId`를 response에만 포함하고, DB에는 저장하지 않는다.

Stage 38 후보: `metadata_json` 컬럼 추가 + lineage chain 저장 → 히스토리 페이지에서 "이전 run에서 파생됨" 표시.

---

## 대시보드 변경

### `workspace-github-api.ts`

```ts
// 신규 타입
export type SpecificRunComparison = { ... };
export type PRReviewRerunMeta = { ofReviewRunId: string; reusedSelectedItemIds: string[] };

// startPRReview input 확장
input: {
  ...
  rerunOfReviewRunId?: string;  // NEW
};

// StartReviewResponse 확장
| {
    ok: true;
    run: ReviewRun;
    rerun?: PRReviewRerunMeta;           // NEW
    comparisonToSourceRun?: SpecificRunComparison;  // NEW
    ...
  }
```

### `[runId]/page.tsx` — RerunPanel + ComparisonPanel 추가

**RerunPanel:**
- 버튼: "이 기준으로 다시 확인하기"
- `selectedItemIds`: detail에서 로드한 run의 `selectedItemIds`
- `idempotencyKey`: `crypto.randomUUID()` 매 클릭마다 새로 생성
- `rerunOfReviewRunId`: 현재 runId
- 성공 시: `ComparisonPanel` 표시 + "새 기록 보기 →" 링크

**ComparisonPanel:**
- `comparable: false` → "비교할 결과가 없어요."
- `comparable: true` → 4개 그룹 표시: 좋아진/새로 생긴 문제/아직 남은/변화 없음
- 하단 안내문: "이 비교는 선택한 이전 확인 기록과 방금 다시 확인한 결과를 비교한 것입니다."

**노출 조건:** `hasResults && userKey` (결과 없는 run에서는 re-run 버튼 숨김)

---

## idempotencyKey 처리

- 매 re-run 요청마다 `crypto.randomUUID()`로 새 key 생성
- 이전 run의 idempotencyKey 재사용하지 않음
- in-flight 중복 방지: RerunPanel 상태가 "running"이면 버튼 비활성

---

## 테스트

파일: `apps/central-plane/test/workspace-pr-review-rerun.test.mjs` (15개)

| # | 내용 |
|---|------|
| 1 | rerunOfReviewRunId 파싱 + 검증 통과 → token 단계까지 진행 |
| 2 | 다른 project source run → 404 mismatch |
| 3 | 다른 repo source run → 404 mismatch |
| 4 | 다른 prNumber source run → 404 mismatch |
| 5 | body selectedItemIds 없으면 source run IDs 사용 |
| 6 | body selectedItemIds 있으면 override |
| 7 | 없는 runId → 404 not_found |
| 8–15 | compareSpecificReviewRuns: improved/newlyProblematic/stillOpen/unchanged/comparable |

**결과:** 895/895 통과 (신규 15개 포함)

---

## 커밋

`feat(workspace): Stage 37 — run-specific re-run with comparison`

---

## Stage 38 전 결정 필요한 점

1. **Persistent lineage**: `workspace_pr_review_runs`에 `rerun_of_review_run_id` 컬럼 추가할지
   - 이력 페이지에서 "이 run은 `wprr_xxx`에서 파생됨" 표시 가능
   - 작은 migration 추가 필요

2. **Re-run 자동 선택 UX**: detail page에서 selectedItemIds 편집 후 re-run 지원 여부
   - 현재는 무조건 source run의 selectedItemIds 전달

3. **History list에서 직접 re-run**: 리스트에 "다시 확인" 버튼 추가 여부
