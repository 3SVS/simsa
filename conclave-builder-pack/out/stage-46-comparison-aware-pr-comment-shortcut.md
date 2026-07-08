> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 46 — 비교 결과 PR comment shortcut (Comparison-aware comment)

목표: run detail에서 source vs current 비교가 표시된 상태일 때, 그 비교 결과를 **바로 GitHub PR comment로 남기는 shortcut** 제공. 기존 backend `includeRerunComparison`(Stage 38) 재사용, 신규 endpoint·서버 DB 변경 없음.

기준 커밋: Stage 45 `9960472` 이후.

---

## 흐름

```
run detail → AutoComparisonPanel(비교 자동 표시)
→ "이 비교 결과를 PR comment로 남기기"
→ CommentPanel로 scroll + 비교 포함 체크 + preview 자동 생성
→ GitHub에 남기기
```

---

## 1. AutoComparisonPanel shortcut 구현 방식 (Option A)

Stage 45 `AutoComparisonPanel` done 상태 footer에 버튼 추가:
- **enabled 조건**: comparison comparable(=done) AND **current run에 rerun lineage(`rerunOfReviewRunId`) 존재**.
- 버튼 "이 비교 결과를 PR comment로 남기기" → Page 콜백:
  1. `commentSectionRef.scrollIntoView` (CommentPanel로 이동)
  2. `commentTriggerKey++` (nonce 증가)
- lineage 없으면 버튼 대신 안내: "PR comment에 포함하려면 다시 확인으로 생성된 기록이 필요해요."

CommentPanel은 `triggerComparisonComment` nonce 변경 시: `includeRerunComparison=true` 설정 + **preview 자동 생성**(Option A — post 전에 미리보기). 스크롤은 Page가 담당(관심사 분리).

---

## 2. CommentPanel props/UI 변경

추가 props:
```ts
comparisonAvailable?: boolean;     // lineage 존재 → 비교 포함 가능
comparisonDisplayOnly?: boolean;   // 화면엔 비교 있으나 fromRunId-only(lineage 없음)
triggerComparisonComment?: number; // shortcut nonce
```
- `includeRerunComparison` 초기값 = `Boolean(comparisonAvailable)`.
- `comparisonAvailable`면 checkbox "다시 확인 결과 비교 포함" + 도움말 "좋아진 항목, 아직 남은 항목, 새로 생긴 문제를 PR comment에 함께 넣습니다.".
- `!comparisonAvailable && comparisonDisplayOnly`면 안내 "이 기록은 다시 확인으로 만들어진 결과가 아니어서 비교를 comment에 포함할 수 없어요.".
- preview/post request는 `buildComparisonCommentInput` 헬퍼로 생성.

---

## 3. lineage 있는 run만 지원하는 정책 (Policy A)

backend `includeRerunComparison`은 run의 `rerun_of_review_run_id`로 비교를 계산. 따라서:
- **current run에 `rerunOfReviewRunId`가 있을 때만** shortcut/checkbox 활성화.
- helper `canPostComparisonToComment({ comparable, hasLineage })` = comparable && hasLineage.
- `buildComparisonCommentInput`은 `comparisonAvailable=false`면 `includeRerunComparison`을 **강제 false**.

신규 backend 확장(comparisonSourceRunId 등)은 하지 않음 (Policy B 미채택).

---

## 4. fromRunId-only comparison 처리 방식

`?fromRunId`만 있고 lineage가 없으면:
- AutoComparisonPanel은 비교를 **화면에 표시**하되, shortcut 버튼 대신 "다시 확인으로 생성된 기록이 필요해요" 안내.
- CommentPanel은 `comparisonDisplayOnly=true`로 "comment에 포함할 수 없어요" 안내, checkbox 미표시.
- backend는 fromRunId를 모르므로 comment 비교 불가 — 의도된 한계.

---

## 5. comment preview/post request 구조

`buildComparisonCommentInput`:
```ts
{
  userKey,
  reviewRunId: currentRun.id,                       // 항상 current run
  includeRerunComparison: 요청 && comparisonAvailable, // lineage 없으면 false
  selectedItemIds?: shared selection (비어있으면 생략)
}
```
post는 `{ ...input, mode: "new" }`. **`includeComparison`은 절대 포함하지 않음.**

---

## 6. includeComparison과 includeRerunComparison 관계

- 비교 comment는 항상 `includeRerunComparison` 경로 사용 (Stage 38 rerun 비교).
- `includeComparison`(latest-two 비교)은 **함께 보내지 않음** — `buildComparisonCommentInput`이 아예 키를 넣지 않음. backend도 둘 다 오면 rerun 우선이지만, dashboard는 처음부터 includeComparison을 생략.

---

## 7. 아직 신규 backend endpoint가 아닌 점

- 기존 `POST .../comment/preview` · `POST .../comment` 재사용 (Stage 38 `includeRerunComparison`). 신규 endpoint/서버 DB/comparisonSourceRunId 파라미터 없음.
- billing/credit, payment, private repo, history list, autofix/patch/commit/branch 변경 없음.

---

## 8. 테스트 결과

dashboard `apps/dashboard/test/review-run-comparison.test.mjs` (+8):
- canPostComparisonToComment: comparable+lineage→true, !comparable→false, fromRunId-only(no lineage)→false
- buildComparisonCommentInput: reviewRunId + includeRerunComparison=true, includeComparison 미포함, selectedItemIds 전달/empty 생략, lineage 없으면 includeRerunComparison 강제 false

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3439 / 3439 pass** (3431 + 8 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId(8.12kB) 컴파일 OK, 신규 경고 없음 |

(export/page.tsx exhaustive-deps 경고는 Stage 6 기존, 범위 밖.)

---

## 9. Stage 47에서 이어서 할 일

1. fromRunId-only 비교도 comment에 포함하려면 backend에 comparisonSourceRunId 지원 추가 (Policy B, 신규 backend scope — 별도 결정).
2. AutoComparisonPanel from→to 상태 전환 표시 강화 (Stage 45 이월).
3. (이월) 서버 저장/cross-device 복원(Stage 44), CommentPanel 내부 선택 공유(Stage 43).
4. 라이브 Vercel에서 비교 comment shortcut 확인 (Bae).
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
