> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 41 — History List 빠른 다시 확인 (Quick re-run)

목표: PR 확인 기록 목록에서 각 run의 **남은 문제만 바로 다시 확인**. 세부 항목 편집이 필요하면 상세 페이지(Stage 40 picker)로 이동. 자동 수정·patch·commit 없음.

기준 커밋: Stage 40 `58c99fe` 이후.

---

## 흐름

```
PR 확인 기록 목록 (/projects/:id/github/history)
→ 각 run 카드에 "남은 문제 다시 확인" 버튼
→ 클릭 시 failed / inconclusive / needs_decision 항목만 자동 선택
→ Stage 37 re-run endpoint 실행
→ 새 run detail로 자동 이동 (?fromRunId=<oldRunId>)
```

---

## 1. history list quick re-run 구현 위치

`apps/dashboard/src/app/projects/[id]/github/history/page.tsx` 의 **`QuickRerun`** 컴포넌트 (각 run 행 footer).
- 버튼 "남은 문제 다시 확인 (N)" + 보조 링크 "상세에서 항목 선택 →".
- history list에는 **항목 편집 picker를 넣지 않음** — 편집은 상세 페이지로 유도.

---

## 2. recommendedItemIds 계산 방식

`failed` / `inconclusive` / `needs_decision` 항목의 itemId만. `passed` 제외.
서버 헬퍼 `apps/central-plane/src/workspace/selected-items.ts` 의 `recommendedRerunItemIds(results)` 가 계산 (Stage 40 dashboard 로직과 일치).

---

## 3. list response 확장 방식 — Option A

추천 방식(Option A)으로 구현. project-level history endpoint
`GET /workspace/projects/:id/github/review-history` 응답의 각 run에 **lightweight `rerunAction`** 추가:

```ts
rerunAction: {
  recommendedItemIds: string[];      // failed/inconclusive/needs_decision itemId만
  recommendedItemCount: number;
  disabledReason?: "no_remaining_issues" | "results_unavailable";
};
```

- 서버는 이미 파싱 중인 `resultJson`에서 itemId만 추출 → **full `results`는 응답에 싣지 않음** (목록 경량 유지).
- 결과 없음(running/queued/error/미저장) → `disabledReason: "results_unavailable"`.
- 결과는 있으나 남은 문제 0 → `disabledReason: "no_remaining_issues"`, count 0.

Option B(버튼 클릭 시 detail fetch)는 채택하지 않음 — 목록 응답이 커지지 않으면서 1-roundtrip으로 끝나는 A가 더 간단.

---

## 4. quick re-run request 구조

기존 Stage 37 re-run endpoint 재사용:

```ts
startPRReview(projectId, prNumber, {
  userKey,
  selectedItemIds: rerunAction.recommendedItemIds,
  rerunOfReviewRunId: run.id,
  idempotencyKey,   // 클릭마다 crypto.randomUUID() 1개
})
```

**idempotencyKey 정책**: 클릭 시 새 key 생성 → 해당 in-flight request 동안 유지 → 성공 시 새 페이지로 이동(폐기), 실패 시 재클릭하면 새 key.

조건:
- `recommendedItemCount > 0` → 버튼 enabled.
- `= 0` → disabled + tooltip ("다시 확인할 남은 문제가 없어요." / results_unavailable이면 "확인 결과가 없어 다시 확인할 수 없어요.").

---

## 5. re-run 후 UX

- **성공 → 새 run detail로 자동 이동** (`useRouter().push`):
  `/projects/:id/github/history/:newRunId?fromRunId=<oldRunId>` (`buildRunDetailHref`).
  `?fromRunId`로 source run을 전달 (상세 페이지가 향후 활용 가능; 현재는 무해한 패스스루).
- **진행 중**: "다시 확인 중..." (스피너).
- **에러**: "다시 확인하지 못했어요. 상세 화면에서 다시 시도해 주세요." + 상세 링크. credit 402/경고는 기존 `startPRReview` error 경로 재사용.

---

## 6. 아직 list inline picker가 아닌 점

- history list에는 항목 체크박스 picker를 넣지 않음. "남은 문제만" 빠른 액션 1개 + "상세에서 항목 선택 →" 링크만.
- 개별 항목 추가/제거가 필요하면 상세 페이지(Stage 40 RerunPanel picker)로 이동.
- billing/credit, payment, private repo, autofix/patch/commit/branch, GitHub status check — 일절 없음.

---

## 7. 테스트

서버 `apps/central-plane/test/selected-items.test.mjs` (+4):
- recommendedRerunItemIds: failed/inconclusive/needs_decision만, passed 제외, all-passed→[], empty→[].

서버 `apps/central-plane/test/workspace-pr-review-history.test.mjs` (+4):
- rerunAction이 recommendedItemIds 노출하되 full results 미포함
- recommendedItemIds가 passed 제외
- all-passed run → disabledReason "no_remaining_issues", count 0
- results 미저장 run → disabledReason "results_unavailable"

dashboard `apps/dashboard/test/rerun-selection.test.mjs` (+4):
- quickRerunDisabledMessage: no_remaining_issues / undefined / results_unavailable
- buildRunDetailHref: 새 run detail 경로, fromRunId 포함 경로

### 결과

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3393 / 3393 pass** (3381 + 12 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | history(2.91kB) + runId 컴파일 OK, 신규 경고 없음 |

(export/page.tsx의 exhaustive-deps 경고는 Stage 6 기존 항목, Stage 41 범위 밖.)

---

## 8. Stage 42에서 이어서 할 일

1. (결정) 새 run detail에서 `?fromRunId`를 실제로 활용해 source 대비 비교를 자동 표시할지 (현재는 패스스루만).
2. (결정) 고른 selectedItemIds를 다음 re-run 기본값으로 기억할지 (현재 매번 추천 선택).
3. 라이브 Vercel에서 history list quick re-run 확인 (Bae).
4. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
