# Stage 35 — PR Review History Detail

**Commit:** (커밋 후 채움)
**Tests:** 865/865 pass · typecheck clean
**Scope:** Run detail endpoint + dashboard detail page. billing/credit/autofix/patch 미포함.

---

## 추가한 endpoint

### 1. 프로젝트 레벨 run lookup (주 사용 엔드포인트)

```
GET /workspace/projects/:id/github/review/runs/:runId?userKey=...
```

- prNumber 없이 runId만으로 조회 가능
- 소유권 검증: `run.projectId === projectId` (다른 프로젝트 run → 404)
- dashboard `/projects/[id]/github/history/[runId]` 페이지에서 사용

### 2. PR 범위 run lookup (추가 검증 포함)

```
GET /workspace/projects/:id/github/pulls/:number/review/runs/:runId?userKey=...
```

- `project_id + repo_full_name + pr_number` 3중 소유권 검증
- PR 번호가 맞지 않으면 404 반환 (cross-PR 접근 차단)
- 필요 시 더 엄격한 검증이 필요한 맥락에서 사용

---

## run detail response 구조

```ts
type PRReviewRunDetailResponse = {
  ok: true;
  projectId: string;
  repoFullName: string;
  prNumber: number;
  run: {
    id: string;
    status: "queued" | "running" | "passed" | "failed" | "inconclusive" | "error";
    createdAt: string;
    updatedAt: string;
    selectedItemIds: string[];
    selectedItemCount: number;
    errorMessage?: string;
    summary: {
      passed: number;
      failed: number;
      inconclusive: number;
      needsDecision: number;
    };
    results: ReviewResultItem[];  // [] if resultJson is absent or malformed
  };
};
```

**안전한 fallback:**
- `resultJson`이 없거나 파싱 실패 → `summary` 전부 0, `results` 빈 배열
- 파싱 에러는 console.error 없이 조용히 처리 (사용자에게 빈 결과로 표시)

---

## DB helper 추가

```ts
// pr-review-db.ts
export async function getReviewRunById(env: Env, runId: string): Promise<DbReviewRun | null>
```

- `WHERE id = ?` 단일 조회
- 존재하지 않으면 null 반환

---

## dashboard detail route

```
/projects/[id]/github/history/[runId]
```

파일: `apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`

**라우트 설계 결정:**
- prNumber를 URL에 포함하지 않음 (history 목록에서 prNumber를 알지 못하는 상황 대비)
- 프로젝트 레벨 endpoint(`/review/runs/:runId`)를 사용하여 prNumber 없이도 detail 조회
- sessionStorage 없이 단순 fetch로 동작

---

## history list 연결 방식

Stage 34의 `/projects/[id]/github/history` 페이지:

```tsx
// 변경 전
<Link href={`/projects/${id}/github`}>상세 보기 →</Link>

// 변경 후
<Link href={`/projects/${id}/github/history/${run.id}`}>상세 보기 →</Link>
```

각 run card에 있는 "상세 보기 →" 링크가 detail 페이지로 이동.

---

## detail 페이지 구성

```
상단
  - "← 확인 기록으로 돌아가기" (historyUrl)
  - 제목 "확인 상세", repo / PR 번호
  - 전체 상태 badge

run 메타 카드
  - 확인 시간
  - 확인 항목 수
  - 오류 내용 (있을 경우)

요약 카드 (2×2 그리드)
  - 통과 / 안 맞음 / 확인 부족 / 결정 필요

비교 안내 배너
  - "같은 PR을 한 번 더 확인하면 이전 확인 결과와 비교할 수 있어요."
  - "최신 비교 결과 보기 →" → PR 페이지

액션 버튼
  - "이 PR 다시 확인하기" → /projects/:id/github
  - "이 결과로 Fix Pack 만들기" → /projects/:id/github  (actionNeeded > 0 시 표시)
  - "이 결과로 PR comment 작성하기" → /projects/:id/github

항목별 결과 리스트
  - 실패/확인 부족/결정 필요 항목 먼저 정렬
  - 각 항목: status badge, 제목, reason, evidence 목록, nextAction
```

---

## Fix Pack / Comment / Re-run 연결 방식

| 기능 | Stage 35 방식 | Stage 36 계획 |
|------|--------------|--------------|
| Fix Pack | PR 페이지로 이동 (최신 run 기준) | 이 run의 결과를 직접 사용하는 Fix Pack 생성 |
| PR Comment | PR 페이지로 이동 (최신 run 기준) | 이 run의 결과로 comment body 생성 |
| Re-run | PR 페이지로 이동 | detail 페이지에서 직접 startPRReview 호출 |

**사용자 안내 문구 (화면에 표시):**
> "Fix Pack과 PR comment는 현재 최신 확인 결과 기준으로 생성됩니다. 이 이전 확인 결과를 기준으로 생성하는 기능은 Stage 36에서 추가될 예정이에요."

---

## 사용자 표현 원칙 준수

| 사용한 표현 | 피한 표현 |
|------------|---------|
| 확인 기록, 확인 상세, 이전 확인 결과 | Acceptance Matrix, Council, Autofix |
| 안 맞음, 확인 부족, 결정 필요 | Requirement, Patch |
| 다시 확인하기, Fix Pack 만들기 | Debit, Ledger |

---

## typecheck / build / test 결과

```
pnpm build    → OK (tsc clean)
tests         → 865/865 pass (15개 신규 Stage 35 테스트)
dashboard tsc → typecheck clean
```

### 신규 테스트 (workspace-pr-run-detail.test.mjs)

| # | 내용 |
|---|------|
| 1 | userKey 없으면 400 |
| 2 | 없는 runId → 404 |
| 3 | 다른 프로젝트의 run → 404 |
| 4 | 정상 조회 — 전체 detail 반환 |
| 5 | resultJson에서 summary 파싱 |
| 6 | resultJson에서 results 배열 파싱 |
| 7 | 깨진 resultJson → 빈 결과 안전 fallback |
| 8 | selectedItemCount = selectedItemIds.length |
| 9 | PR-scoped endpoint — 매칭 PR run 반환 |
| 10 | PR-scoped endpoint — 다른 prNumber → 404 |
| 11 | PR-scoped endpoint — userKey 없으면 400 |
| 12 | PR-scoped endpoint — 잘못된 prNumber → 400 |
| 13 | PR-scoped endpoint — repo 없으면 404 |
| 14 | getReviewRunById — 없는 ID → null |
| 15 | getReviewRunById — 있는 ID → DbReviewRun 반환 |

---

## Stage 36에서 이어서 할 일

1. **Run-specific Fix Pack 생성**: detail 페이지에서 이 run의 results를 직접 사용하여 Fix Pack 생성
2. **Run-specific Comment body**: 이 run의 results를 comment body로 직접 생성
3. **Re-run from detail**: detail 페이지에서 `startPRReview`를 직접 호출 (selectedItemIds 재사용)
4. **비교 개선**: 특정 run과 최신 run을 직접 비교하는 view (현재는 비교 페이지로 링크만)
5. **페이지네이션**: history 목록 50개 초과 시 더 보기
