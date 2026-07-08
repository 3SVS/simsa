> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 43 — 공유 selectedItemIds (Shared item selection)

목표: run detail page에서 **한 번 선택한 항목을 다시 확인 · Fix Pack · PR comment가 공통으로 사용**. 자동 수정·patch·commit 없음.

기준 커밋: Stage 42 `bcd30c1` 이후.

---

## 흐름

```
run detail (/projects/:id/github/history/:runId)
→ "이번에 다룰 항목" 선택 패널 (공유 상태)
→ 선택한 항목 다시 확인 (N개)
→ 선택한 항목으로 Fix Pack 만들기 (N개)
→ 선택한 항목으로 PR comment 작성
```

---

## 1. shared selectedItemIds state 위치

`apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx` 의 **`RunDetailPage`** page-level state:

```ts
const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
```

- 초기값: detail 로드 후 `recommendedRerunItemIds(run.results)` (안 맞음/확인 부족/결정 필요). 통과는 미선택.
- dedup + items 순서 유지 (`toggleItemSelection` / preset helper).
- 항목 없으면 빈 배열.

이전에는 RerunPanel 내부에 picker state가 있었는데, Stage 43에서 page-level로 끌어올림.

---

## 2. ReviewItemSelectionPanel 구조

picker를 별도 컴포넌트로 분리:

```ts
function ReviewItemSelectionPanel({
  items: ReviewResultItem[];
  selectedItemIds: string[];
  onChange: (selectedItemIds: string[]) => void;
})
```

- 헤더 "이번에 다룰 항목" + 안내 ("여기서 고른 항목이 다시 확인 · Fix Pack · PR comment에 함께 쓰여요").
- preset 버튼: 추천 선택 / 전체 선택 / 통과 제외 / 모두 해제 → `onChange(...)`.
- 항목별 체크박스 행(`RerunItemRow` 재사용): status badge / evidence / nextAction 요약.
- 토글: `onChange(toggleItemSelection(items, selectedItemIds, itemId))` — 순수 헬퍼로 dedup+순서 유지.
- 하단 요약: 선택 N개 → "이번에 다룰 항목: N개 선택됨", 0개 → "항목을 하나 이상 선택하면 다시 확인, Fix Pack, PR comment를 만들 수 있어요.".

---

## 3. RerunPanel 연결 방식

- 자체 picker/선택 state 제거. props `selectedItemIds: string[]` 사용.
- `selectedItemIds.length === 0` → 버튼 disabled.
- re-run request에 `selectedItemIds` 전달 (body > source > linkedPR 우선순위 그대로).
- 문구: "선택한 항목 다시 확인하기 (N개)".

---

## 4. FixPackPanel 연결 방식

- props `selectedItemIds: string[]` (필수) 사용.
- `selectedItemIds.length === 0` → 생성 버튼 disabled.
- fix-brief request에 `selectedItemIds` 전달.
- 문구: "선택한 항목으로 Fix Pack 만들기 (N개)".
- **Stage 42 autoOpen 유지**: `?action=fix-pack` → scrollIntoView + 자동 생성 1회. autoOpen 효과는 `selectedItemIds.length > 0` 일 때만 발화(빈 선택이면 자동 생성 안 함). 자동 생성도 공유 selectedItemIds 사용.

---

## 5. CommentPanel 연결 방식

- props `selectedItemIds: string[]` 추가.
- comment preview/post request에 `selectedItemIds` 전달 (비어 있으면 `undefined` → 서버가 run 선택으로 fallback, 기존 동작).
- 문구: "선택한 항목으로 PR comment 작성하기".
- (comment는 빈 선택에서도 서버 fallback이 있어 disable하지 않음.)

---

## 6. action=fix-pack 동작 유지 방식

- Page가 `?action=fix-pack`을 `window.location.search`로 읽어 `fixPackRequested` 설정 (useSearchParams Suspense 회피, Stage 42 동일).
- 공유 `selectedItemIds` 기본값(recommended)이 먼저 세팅된 뒤 FixPackPanel이 `autoOpen`으로 자동 생성.
- 즉 history list "남은 문제 Fix Pack" → detail 진입 시, 공유 선택(추천=남은 문제) 그대로 자동 생성.

---

## 7. 아직 history list picker가 아닌 점

- history list는 그대로: Quick re-run(recommendedItemIds) + Quick Fix Pack(`?action=fix-pack` 이동). **list에 full picker 없음.**
- 항목 편집은 detail page의 공유 선택 패널에서만.
- 서버 변경 없음 (이미 selectedItemIds 수용 + 정규화). billing/credit, payment, private repo, autofix/patch/commit/branch 없음.

---

## 8. 테스트

dashboard `apps/dashboard/test/rerun-selection.test.mjs` (+5):
- toggleItemSelection 추가/제거/dedup/순서 유지.
- 공유 선택 clear → canRerun false (re-run/Fix Pack 동일 predicate).
- 공유 선택 기본 = recommended.

(preset 함수 / canRerun / recommendedRerunItemIds 는 기존 테스트로 이미 커버. RerunPanel/FixPackPanel/CommentPanel의 selectedItemIds 사용은 컴포넌트 wiring — 순수 헬퍼로 핵심 로직 검증.)

### 결과

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3401 / 3401 pass** (3396 + 5 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId(6.11kB) 컴파일 OK, 신규 경고 없음 |

(export/page.tsx exhaustive-deps 경고는 Stage 6 기존, 범위 밖.)

---

## 9. Stage 44에서 이어서 할 일

1. CommentPanel 내부 UI 선택 공유 강화 (현재는 request 전달까지; 비어 있으면 run fallback).
2. 사용자가 고른 selectedItemIds를 다음 re-run/Fix Pack 기본값으로 기억할지 (현재 매번 추천 선택 초기화).
3. (Stage 41 이월) 새 run detail에서 `?fromRunId` 활용해 source 대비 비교 자동 표시.
4. 라이브 Vercel에서 공유 선택 UX 확인 (Bae).
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
