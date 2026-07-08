> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 45 — fromRunId 기반 비교 자동 표시 (Auto comparison)

목표: quick re-run 후 새 run detail에서 `?fromRunId=<sourceRunId>`를 활용해 **source run vs current run 비교를 자동 표시**. 서버 DB·endpoint 추가·자동 수정 없음.

기준 커밋: Stage 44 `15f78ad` 이후.

---

## 흐름

```
history list → 남은 문제 다시 확인 → 새 run 생성
→ /projects/:id/github/history/:newRunId?fromRunId=:oldRunId
→ detail page가 fromRunId 읽음
→ source run detail 로드 → 비교 → AutoComparisonPanel 자동 표시
```

---

## 1. fromRunId 처리 위치

`apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`.
`?action=fix-pack`과 동일하게 **`window.location.search`를 useEffect로 읽어** `fromRunId` state 설정 (useSearchParams Suspense 회피). `fromRunId === 현재 runId`면 무시.

---

## 2. rerunOfReviewRunId fallback 정책

비교 source 우선순위 (helper `pickComparisonSourceRunId`):
1. query `fromRunId`
2. current `run.rerunOfReviewRunId` (Stage 38 lineage)
3. 없음 → 비교 표시 안 함

즉 query가 있으면 query 우선, 없으면 lineage. 덕분에 history quick re-run 진입뿐 아니라 **나중에 lineage 있는 run을 다시 열어도** 자동 비교가 뜸. self는 무시.

---

## 3. source run 로드 방식

기존 project-scoped 엔드포인트 재사용 (신규 endpoint 없음):
```
GET /workspace/projects/:id/github/review/runs/:sourceRunId?userKey=...
```
`getReviewRunDetail(id, sourceId, userKey)`로 fetch. **non-blocking**:
- fetch 실패 → 에러 안내만 (page 전체 실패 아님)
- source PR ≠ current PR → 안내
- source/current results 비어 있음 → 비교 불가 안내
Fix Pack/Comment/Re-run은 계속 사용 가능.

---

## 4. dashboard comparison helper

`apps/dashboard/src/lib/review-run-comparison.mjs` (+`.d.mts`, Node20 CI용 plain ESM):

```ts
pickComparisonSourceRunId({ fromRunId, runId, rerunOfReviewRunId }): string | null
compareReviewRunResults<T>({ sourceResults: T[], currentResults: T[] }): {
  comparable, improved: T[], stillOpen: T[], newlyProblematic: T[], unchanged: T[],
  summary: { improved, stillOpen, newlyProblematic, unchanged },
  reason?: "missing_source_results" | "missing_current_results"
}
```

**central-plane `pr-review-compare.ts`와 동일한 분류** (서버와 dashboard 일치):
- STATUS_SCORE: passed=4 / needs_decision=2 / inconclusive=1 / failed=0
- current score > source → improved, < source → newlyProblematic, = (passed→unchanged / else→stillOpen)
- current-only item: passed→unchanged, else→stillOpen
- itemId 기준, 그룹은 current 항목을 담음. 어느 쪽이든 results 없으면 comparable=false.

---

## 5. AutoComparisonPanel UI

위치: **run summary 아래, selection panel 위**. 표시 조건: `autoCompare` state 존재.
- 제목 "이전 확인 기록과 비교" + 설명 "이 비교는 선택한 이전 확인 기록과 현재 확인 기록을 비교한 것입니다."
- source/current timestamp, summary counts(좋아진/새로 생긴 문제/아직 남은/변화 없음)
- 4개 그룹(좋아진 항목 / 새로 생긴 문제 / 아직 남은 항목 / 변화 없음) — 빈 그룹은 생략.
- 비교가 표시되면 기존 "한 번 더 확인하면 비교" 힌트는 숨김.

---

## 6. 비교 불가/오류 처리 (non-blocking)

헤더 "이전 확인 기록과 비교할 수 없어요." + 사유:
- source_not_found → "이전 확인 기록을 찾지 못했어요."
- pr_mismatch → "서로 다른 PR의 확인 기록이라 비교하지 않았어요."
- source_empty → "이전 확인 기록의 결과가 비어 있어요."
- current_empty → "현재 확인 기록의 결과가 비어 있어요."
작은 회색 박스로 표시, 다른 기능 영향 없음.

---

## 7. action=fix-pack과의 공존

- `?action=fix-pack`과 `?fromRunId`는 독립 — 같은 URL에 둘 다 있어도 각자 동작.
- fix-pack autoOpen(Stage 42/43/44)은 그대로, 추가로 fromRunId 있으면 AutoComparisonPanel도 뜸.
- 두 query 모두 `window.location.search`에서 한 번에 읽음.

---

## 8. 아직 서버 endpoint 추가가 아닌 점

- 비교는 **dashboard client-side**에서 계산 (기존 run detail endpoint 2회 fetch). 서버 comparison endpoint 신규 추가 없음.
- 서버 DB/billing/credit/history list 변경 없음. autofix/patch/commit/branch 없음.
- URL의 `fromRunId`는 비교 후에도 제거하지 않음 (새로고침/링크 공유 시 비교 문맥 유지).

---

## 9. 테스트 결과

dashboard `apps/dashboard/test/review-run-comparison.test.mjs` (신규 12):
- pickComparisonSourceRunId: query 우선, lineage fallback, self 무시(×2), 둘 다 없음→null
- classify improved/stillOpen/newlyProblematic/unchanged + summary counts
- partial-credit(failed→inconclusive)=improved
- current-only item: stillOpen/unchanged
- missing source/current → comparable false + reason, non-array 처리

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3431 / 3431 pass** (3419 + 12 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId(7.64kB) 컴파일 OK, 신규 경고 없음 |

> 참고: `progress-emit.test.mjs`의 "emits in parallel" 테스트가 full-parallel 부하에서 1회 flaky 실패(타이밍 측정 기반) → isolation/재실행 시 일관 통과. Stage 45 무관, CI는 turbo per-package 격리라 영향 적음.

(export/page.tsx exhaustive-deps 경고는 Stage 6 기존, 범위 밖.)

---

## 10. Stage 46에서 이어서 할 일

1. AutoComparisonPanel에 from→to 상태 전환 표시 강화 (현재는 current 상태 + 그룹 라벨로 방향 전달).
2. (Stage 45 결정) 서버 저장/cross-device 복원은 여전히 보류 (Stage 44 이월).
3. CommentPanel 내부 UI 선택 공유 강화 (Stage 43 이월).
4. 라이브 Vercel에서 quick re-run → 자동 비교 확인 (Bae).
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
