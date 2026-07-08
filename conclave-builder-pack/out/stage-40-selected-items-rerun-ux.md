> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 40 — 다시 확인할 항목 선택 UX (Selected-items re-run)

목표: 특정 PR 확인 기록에서 **다시 확인할 항목을 사용자가 직접 골라** 그 항목만으로 re-run을 실행한다. 자동 수정·patch·commit 생성은 하지 않는다.

기준 커밋: Stage 39 `4d83710` 이후.

---

## 흐름

```
PR 확인 기록 상세 (/projects/:id/github/history/:runId)
→ 이전 run의 항목 목록 + 체크박스
→ 다시 확인할 항목 선택 (기본: 통과하지 않은 항목)
→ "선택한 항목 다시 확인하기"
→ 선택 항목만으로 re-run (Stage 37 endpoint 재사용)
→ source run vs 새 run 비교 + 선택 항목 수 표시
```

---

## 1. selectedItemIds 편집 UI 위치

`apps/dashboard/src/app/projects/[id]/github/history/[runId]/page.tsx` 의 **`RerunPanel`** 을 확장.
이전(Stage 37)에는 source run의 selectedItemIds를 그대로 넘기는 단일 버튼이었으나, 이제 항목별 체크박스 picker로 교체.

상단 안내 추가:
> 이 기록에서 문제가 남은 항목만 골라 다시 확인할 수 있어요.

각 항목 행(`RerunItemRow`)에 표시:
- 상태 배지 (통과 / 안 맞음 / 확인 부족 / 결정 필요)
- item title
- evidence 요약 (첫 근거 1줄)
- nextAction 요약 (통과가 아닐 때 "다음: …")
- 체크박스

---

## 2. 기본 선택 정책

기본 선택 = **추천 선택** = `failed` / `inconclusive` / `needs_decision`.
즉 **통과(passed) 항목은 기본 선택하지 않는다.**

순수 로직은 `apps/dashboard/src/lib/rerun-selection.mjs` (+ 타입 선언 `rerun-selection.d.mts`) 로 분리.
(plain ESM `.mjs`로 둔 이유: CI가 Node 20 floor에서 `node --test`를 돌리는데 Node 20은 `.ts` type-stripping 미지원. `.mjs`+`.d.mts`는 앱 타입안정성을 유지하면서 모든 지원 Node에서 테스트가 돈다.) 함수:
- `recommendedRerunItemIds(items)` — 안 맞음/확인 부족/결정 필요
- `allRerunItemIds(items)` — 전체
- `nonPassedRerunItemIds(items)` — 통과 제외
- `canRerun(count)` — count > 0
- `formatSelectedCountMessage(count)` — "선택한 N개 항목을 다시 확인했습니다."

(서버 응답에 `recommendedRerunItemIds` 필드는 추가하지 않음 — 프론트에서 계산. run detail response shape 불변.)

---

## 3. preset 버튼 동작

| 버튼 | 동작 |
|------|------|
| 추천 선택 | failed / inconclusive / needs_decision |
| 전체 선택 | 모든 result item |
| 통과 제외 | passed 제외 (현 status enum 상 추천 선택과 동일 집합) |
| 모두 해제 | 빈 배열 |

각 버튼은 선택 Set을 통째로 교체. 사용자는 개별 체크박스로 추가/제거도 가능.

---

## 4. re-run request selectedItemIds 전달 방식

Stage 37 endpoint(`POST .../github/pulls/:number/review`)를 그대로 재사용. body:

```ts
{
  userKey,
  rerunOfReviewRunId: <이 기록의 runId>,
  selectedItemIds: [...selected],   // UI에서 고른 항목
  idempotencyKey: crypto.randomUUID(),
}
```

정책:
- 선택 항목이 1개 이상일 때만 전송. 0개면 버튼 **disabled** + 안내("다시 확인할 항목을 하나 이상 선택해주세요.").
- **body selectedItemIds 가 source run selectedItemIds 보다 우선** (서버 우선순위: body > source run > linked PR). Stage 37/38 테스트로 이미 검증된 동작.
- 버튼 문구: "선택한 항목 다시 확인하기 (N개)".

### 서버 검증 보강 (구조 변경 없음)

`apps/central-plane/src/workspace/selected-items.ts` 의 `normalizeSelectedItemIds`:
- 배열이 아니면 `undefined` (→ source/linkedPR 선택으로 fallback, 기존 동작 보존)
- 비문자열 제거 · 공백 trim · 빈 문자열 제거 · 중복 제거(첫 등장 순서 유지)
- `MAX_SELECTED_ITEMS = 500` 상한

review POST 핸들러의 인라인 파싱을 이 헬퍼로 교체. endpoint 구조/우선순위는 그대로.

---

## 5. comparison 표시 개선

re-run 후 `ComparisonPanel` 헤더에 선택 항목 수 표시:
> 선택한 3개 항목을 다시 확인했습니다.

비교 그룹은 Stage 37의 4개 유지: **좋아진 항목 / 아직 남은 항목 / 새로 생긴 문제 / 변화 없음**.
(비교 불가 시 안내, 새 run만 생성됐고 비교가 없으면 선택 수 메시지 + "새 기록 보기" 링크.)

---

## 6. 아직 하지 않은 것

- **history list 직접 re-run 버튼은 추가하지 않음.** re-run은 기록 상세 페이지에서만.
- selectedItemIds를 source run/linked PR에 영구 저장하지 않음 (이 re-run 1회용 선택).
- billing/credit, payment, private repo, autofix/patch/commit/branch, GitHub status check — 일절 없음.

---

## 7. 테스트

`apps/dashboard/test/rerun-selection.test.mjs` (plain `.mjs` import, Node ≥ 20에서 동작, 9 tests):
- 추천 선택 = failed/inconclusive/needs_decision, passed 미선택
- 전체 선택 = 전부
- 통과 제외 = passed 제외
- 모두 해제 = 빈 배열 → canRerun false
- canRerun: 0개 false, 1+개 true
- 선택 수 메시지 포맷

`apps/central-plane/test/selected-items.test.mjs` (8 tests):
- 비배열 → undefined, 빈 배열 → []
- 비문자열/빈문자열 제거, trim, 중복 제거, 상한 cap

(dashboard에 `test` 스크립트 신규 추가 → `pnpm test` turbo에 통합.)

기존 Stage 37 re-run 서버 테스트 15개 그대로 통과 (body > source 우선순위 정규화 후에도 유지).

### 결과

| 검사 | 결과 |
|------|------|
| `pnpm test` (turbo) | 52/52 tasks 성공 |
| 전체 `node --test` | **3381 / 3381 pass** (3364 + 8 + 9 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId route 컴파일 OK (8.48 kB) |

---

## 8. Stage 41에서 이어서 할 일

- (결정 필요) history list에서 바로 "남은 문제 다시 확인" 진입점을 둘지 — 현재는 상세 페이지에서만.
- (결정 필요) 사용자가 고른 selectedItemIds를 다음 re-run의 기본값으로 기억할지 (현재는 매번 추천 선택으로 초기화).
- 라이브 Vercel에서 새 picker UX 확인 (Stage 39 §3 절차, Bae).
- 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
