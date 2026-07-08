> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 48 — 비교 상태 전환 표시 (Comparison transition display)

목표: AutoComparisonPanel에서 각 항목의 **이전 상태 → 현재 상태** 전환을 직관적으로 표시. backend/comment body/자동 수정 변경 없음 — dashboard display 개선만.

기준 커밋: Stage 47 `daeab16` 이후.

---

## 1. comparison helper 확장 내용

`apps/dashboard/src/lib/review-run-comparison.mjs` (+`.d.mts`):
- `compareReviewRunResults`가 그룹별로 **transition-aware `ReviewRunComparisonItem`** 반환 (기존 raw current item → 확장):
  ```ts
  {
    itemId, title,
    sourceStatus?, currentStatus?,
    sourceEvidence?, currentEvidence?,
    sourceNextAction?, currentNextAction?,
    transitionLabel,
    direction: "improved" | "worsened" | "unchanged" | "still_open",
  }
  ```
- 분류 로직(STATUS_SCORE)·summary counts·comparable=false reason은 Stage 45와 동일 — **그룹 배치는 불변**, 항목 payload만 풍부해짐.

---

## 2. 상태 라벨/transition label 정책

- `getReviewStatusLabel(status)` — passed/failed/inconclusive/needs_decision → 통과/안 맞음/확인 부족/결정 필요.
- `buildStatusTransitionLabel(sourceStatus, currentStatus)` — `이전 → 현재`. source 없으면(current-only) `새 항목 → 현재`.
- 예: `안 맞음 → 통과`, `통과 → 안 맞음`, `결정 필요 → 결정 필요`, `새 항목 → 결정 필요`.

`direction`:
- improved = score 상승, worsened = score 하락, unchanged = 동일&통과, still_open = 동일&비통과(또는 current-only 비통과).

---

## 3. AutoComparisonPanel UI 변경

`apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`:
- `TransitionPill` 신규: `이전 상태 → 현재 상태` 알약(상태별 색상, current 강조).
- `AutoCompareGroup` 각 항목: title + TransitionPill + `현재 근거: …`(truncate) + `다음 조치: …`(truncate).
- 그룹 제목 아래 짧은 설명 추가:
  - 좋아진 항목: "이전보다 상태가 좋아진 항목입니다."
  - 새로 생긴 문제: "이전보다 나빠졌거나 새로 문제가 생긴 항목입니다."
  - 아직 남은 항목: "문제가 계속 남아 있는 항목입니다."
  - 변화 없음: "상태가 그대로인 항목입니다."
- summary counts(좋아진/새로 생긴 문제/아직 남은/변화 없음)는 Stage 45 그대로 유지.

evidence/nextAction은 길면 truncate. (source 근거는 데이터로는 보유하되 기본 표시는 현재 근거 위주로 간결화.)

---

## 4. current-only / source-only 처리 방식

- **current-only(새 항목)**: sourceStatus undefined → label `새 항목 → 현재`. passed → unchanged 그룹, 그 외 → stillOpen 그룹 (Stage 45 분류와 동일).
- **source-only(이전 run에만, 현재 run에 없음)**: 표시할 current 항목이 없으므로 **drop**. helper 내부 정책으로 문서화 (별도 그룹 만들지 않음).

---

## 5. PR comment shortcut 영향 여부

- **영향 없음**. Stage 46 shortcut(`canPostComparisonToComment`, `buildComparisonCommentInput`, AutoComparisonPanel 버튼)은 그대로.
- backend `includeRerunComparison` output·comment body builder **미변경**. Stage 48은 dashboard display 전용.

---

## 6. 아직 backend/comment body 변경이 아닌 점

- 서버 endpoint/DB/comment body builder 변경 없음. comparison 계산은 client-side(기존 run-detail endpoint 2회 fetch).
- billing/credit, payment, private repo, history list, autofix/patch/commit/branch 변경 없음.

---

## 7. 테스트 결과

dashboard `apps/dashboard/test/review-run-comparison.test.mjs` (+9):
- getReviewStatusLabel 4종, buildStatusTransitionLabel(안 맞음→통과 / 새 항목→…)
- compareReviewRunResults가 sourceStatus/currentStatus/evidence/nextAction 반환
- improved(failed→passed), newlyProblematic(passed→failed), unchanged(passed→passed), still_open(failed→failed) transitionLabel + direction
- current-only: sourceStatus undefined, "새 항목 → …"
- (기존 Stage 45/46 테스트는 .itemId/summary 기반이라 유지)

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3448 / 3448 pass** (3439 + 9 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId(8.66kB) 컴파일 OK, 신규 경고 없음 |

(export/page.tsx exhaustive-deps 경고는 Stage 6 기존, 범위 밖.)

---

## 8. Stage 49에서 이어서 할 일

1. source evidence/nextAction도 토글로 보여줄지 (현재 데이터는 보유, 표시는 현재 위주).
2. (이월) fromRunId-only 비교 comment Policy B(Stage 46), 서버 저장(Stage 44), CommentPanel 내부 선택 공유(Stage 43).
3. 다른 타이머/race 의존 테스트 audit (Stage 47 이월, 선택).
4. 라이브 Vercel에서 transition 표시 확인 (Bae).
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
