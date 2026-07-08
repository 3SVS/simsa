> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 42 — 남은 문제 Fix Pack (Remaining-issues Fix Pack)

목표: PR 확인 기록에서 **남은 문제만 기준으로 Fix Pack(수정 지시서) 생성 흐름에 바로 진입**. 자동 수정·patch·commit 없음 — Claude/Codex에게 줄 지시서를 만들 뿐.

기준 커밋: Stage 41 `90026f5` 이후.

---

## 흐름

```
PR 확인 기록 목록 (/projects/:id/github/history)
→ "남은 문제 Fix Pack" 버튼
→ detail page로 이동 (?action=fix-pack)
→ FixPackPanel 자동 열림 + 남은 문제(안 맞음/확인 부족/결정 필요)로 생성
→ preview / 전체 복사
```

---

## 1. history list quick Fix Pack 구현 위치

`apps/dashboard/src/app/projects/[id]/github/history/page.tsx` 의 **`QuickFixPackLink`** (각 run 행 footer, `QuickRerun` 옆).
- `recommendedItemCount > 0` → enabled, `buildFixPackHref(projectId, runId)` 로 detail 이동.
- `= 0` → disabled span + tooltip "Fix Pack으로 만들 남은 문제가 없어요.".
- **history list에 full item picker 없음** — 항목 편집은 detail page로 유도.

Option B(detail 이동) 채택. 이유: 목록이 무거워지지 않고, Stage 36 detail FixPackPanel 재사용, 항목 선택이 필요하면 detail에서 자연스럽게 처리.

---

## 2. recommendedItemIds 재사용 방식

Stage 41의 `rerunAction.recommendedItemCount` 를 그대로 사용해 버튼 enable 판단.
detail page는 `recommendedRerunItemIds(run.results)` (failed/inconclusive/needs_decision)를 계산해 FixPackPanel에 전달.
서버 fix-brief 핸들러도 기본값이 fixable(=남은 문제)이라, 명시 전달과 동일하게 동작.

---

## 3. detail page action=fix-pack 처리 방식

`apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx`:
- `window.location.search` 를 `useEffect`로 읽어 `fixPackRequested` state 설정 (`useSearchParams` Suspense 요건 회피).
- `fixPackRequested` 를 `FixPackPanel autoOpen` 으로 전달.
- `FixPackPanel`: `autoOpen` 이면 마운트 시 1회(ref guard) `scrollIntoView` + 자동 생성.
- `selectedItemIds={recommendedRerunItemIds(run.results)}` 로 남은 문제만 명시 전달.

(`actionNeeded > 0` 일 때만 FixPackPanel 렌더 — 남은 문제 없으면 애초에 안 보임, history 버튼도 disabled라 정합.)

---

## 4. run-specific Fix Pack request 구조

기존 Stage 36 endpoint 재사용:

```ts
POST /workspace/projects/:id/github/pulls/:number/fix-brief
{
  userKey,
  reviewRunId: run.id,                 // 반드시 전달 (run-specific 검증 재사용)
  selectedItemIds: recommendedItemIds, // failed/inconclusive/needs_decision만
  productSpec
}
```

서버는 reviewRunId 소유권(project+repo+pr) 검증 후, 전달된 selectedItemIds를 그대로 사용하고 응답에 `sourceReviewRun` 포함.

---

## 5. Fix Pack UI 표시 개선

`FixPackPanel` (detail):
- 헤더 "남은 문제 Fix Pack" + "남은 문제 N개로 Fix Pack을 만들었어요." (`result.selectedItemIds.length`).
- 출처 안내 배너: "이 Fix Pack은 특정 확인 기록 기준입니다. 최신 PR 상태와 다를 수 있습니다." (`sourceReviewRun` 응답 활용).
- 버튼 문구 "선택한 항목으로 수정 지시서 만들기" / 로딩 "수정 지시서 만드는 중...".
- 파일 탭 / preview / 전체 복사 (기존 유지).

---

## 6. 아직 자동 수정/patch가 아닌 점

- Fix Pack = **Claude/Codex에게 줄 수정 지시서** preview/copy 만. patch 적용·commit·branch·PR push 없음.
- shared selection(RerunPanel ↔ FixPackPanel 선택 상태 공유)은 **Stage 43 후보**로 보류. FixPackPanel은 남은 문제 기본 선택만.
- billing/credit, payment, private repo, GitHub status check — 일절 없음.

---

## 7. 테스트

서버 `apps/central-plane/test/workspace-pr-run-specific.test.mjs` (+1):
- fix-brief가 명시적 selectedItemIds(recommended subset) 존중 + sourceReviewRun 반환.
- (기존 Stage 36: reviewRunId 사용/mismatch 거부/sourceReviewRun 존재 이미 커버.)

dashboard `apps/dashboard/test/rerun-selection.test.mjs` (+2):
- buildFixPackHref → `...?action=fix-pack`.
- quick Fix Pack이 re-run과 동일한 recommended(non-passed) 집합 사용.

### 결과

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3396 / 3396 pass** (3393 + 3 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | history(3.08kB)+runId(6.08kB) 컴파일 OK, 신규 경고 없음 |

(export/page.tsx의 exhaustive-deps 경고는 Stage 6 기존 항목, Stage 42 범위 밖.)

---

## 8. Stage 43에서 이어서 할 일

1. **shared selection** — detail page에서 RerunPanel ↔ FixPackPanel 선택 상태 공유 (현재 각자 남은 문제 기본 선택).
2. (Stage 41 이월) 새 run detail에서 `?fromRunId` 활용해 source 대비 비교 자동 표시.
3. 라이브 Vercel에서 history list "남은 문제 Fix Pack" → detail 자동 생성 확인 (Bae).
4. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
