> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 44 — 선택 항목 client-side 영속화 (Selected-range persistence)

목표: run detail에서 고른 `selectedItemIds`를 **같은 run에 대해 client-side로 복원**. 새로고침/재진입해도 직전 선택이 살아 있고, 복원된 선택을 다시 확인·Fix Pack·PR comment가 사용. 서버 DB 저장·자동 수정 없음.

기준 커밋: Stage 43 `a9ad424` 이후.

---

## 흐름

```
run detail 진입
→ 저장된 선택 있으면 복원, 없으면 추천 선택
→ 사용자가 선택 변경 → localStorage에 저장
→ 같은 run 재진입 → 저장된 선택 복원
→ 다시 확인 / Fix Pack / PR comment에 복원된 선택 사용
```

---

## 1. storage helper 위치

`apps/dashboard/src/lib/review-selection-storage.mjs` (+ `.d.mts`).
Stage 40/43과 동일하게 **plain ESM `.mjs` + `.d.mts`** (Node 20 CI에서 `node --test` 호환). storage 주입형으로 순수·테스트 용이.

```ts
buildReviewSelectionStorageKey({ projectId, runId }): string
normalizeStoredSelectedItemIds({ stored, validItemIds }): string[]
readStoredReviewSelection({ storage, key, validItemIds }): string[] | null
writeStoredReviewSelection({ storage, key, selectedItemIds }): boolean
clearStoredReviewSelection({ storage, key }): boolean
```

`StorageLike = { getItem, setItem, removeItem }` 최소 인터페이스. dashboard는 `getReviewSelectionStorage()`로 `window.localStorage`를 SSR/private-mode/차단 대비 try-guard.

---

## 2. storage key 정책

버전 포함:

```
conclave:review-selection:v1:${projectId}:${runId}
```

나중에 shape가 바뀌면 `v2`로 쉽게 이관/무시.

---

## 3. restore 정책

run detail 로드 후:
1. `validItemIds = run.results.map(r => r.itemId)`
2. `recommended = recommendedRerunItemIds(run.results)` (안 맞음/확인 부족/결정 필요)
3. `stored = readStoredReviewSelection(...)`
4. `stored === null` → recommended 사용
5. `stored === []` → 사용자가 "모두 해제"한 의도 → 그대로 복원
6. stored에 stale itemId 있으면 valid만 남김 (+ dedup)

---

## 4. stored []와 null의 차이 (핵심)

- **`null`** = 저장된 값 없음 / 읽기 불가(invalid JSON, non-array, storage 에러) → **추천 선택 fallback**.
- **`[]`** = 사용자가 모두 해제한 **의도적 빈 선택** → 그대로 복원, 추천으로 덮지 않음.

`readStoredReviewSelection`이 이 구분을 책임짐 (없음/에러 → null, 유효 배열 → 정규화된 배열(빈 배열 포함)).

---

## 5. write 정책

- hydration(복원) 완료 후 변경분만 저장. `hydratedRef` + `skipNextWriteRef`로 **복원 직후 1회 write를 스킵**해 추천/복원값을 즉시 덮어쓰지 않음.
- `selectedItemIds` 변경마다 `writeStoredReviewSelection` (JSON.stringify). 에러는 무시(false 반환).
- run 간 이동 시 load effect 시작에서 `hydratedRef=false`로 리셋해 새 run을 깨끗이 재-hydrate.
- "추천 선택" / "모두 해제" preset도 onChange → 저장됨 (별도 clear storage 버튼 없음 — 모두 해제가 곧 의도적 [] 저장).

---

## 6. action=fix-pack과 persistence 관계

`?action=fix-pack` 진입 시 FixPackPanel autoOpen은 **공유 selectedItemIds**(이미 복원됨)를 사용:
- stored 있음(비어있지 않음) → 복원된 stored로 자동 생성.
- stored 없음 → 추천 선택으로 자동 생성.
- **stored []** → selectedItemIds=[] → autoOpen guard(`length > 0`)가 자동 생성 차단, 버튼 disabled + "항목을 하나 이상 선택해주세요" 안내.

(Stage 43 FixPackPanel autoOpen guard 재사용 — 추가 변경 없음.)

---

## 7. UI 표시

`ReviewItemSelectionPanel` 하단 secondary text:
- 복원됨 → "이전에 고른 항목을 불러왔어요."
- 변경 후 저장됨 → "선택 항목을 기억했어요."
- 그 외 → 표시 없음.

작게(secondary) 표시, 선택 수 요약 옆.

---

## 8. storage error fallback

- `getItem` 에러 → `readStoredReviewSelection` null → 추천 선택.
- `setItem` 에러 → `writeStoredReviewSelection` false → 무시(상태 변화 없음, UX 정상).
- `localStorage` 자체 부재(SSR/차단) → `getReviewSelectionStorage()` null → persistence 비활성, 추천 선택으로 정상 동작.

---

## 9. 아직 서버 저장이 아닌 점

- selectedItemIds는 **dashboard client-side(localStorage)에만** 저장. 서버 DB 저장 없음.
- 다른 기기/브라우저에서는 복원 안 됨 (의도된 범위).
- history list 변경 없음(inline picker 없음). billing/credit, payment, private repo, autofix/patch/commit/branch 없음.

---

## 10. 테스트 결과

dashboard `apps/dashboard/test/review-selection-storage.test.mjs` (신규 18):
- key 버전/projectId/runId 포함
- normalize: stale 제거 / dedup / non-array → []
- read: 없음→null, []→[] 보존, stale 필터, dedup, invalid JSON→null, non-array→null, getItem 에러→null
- write: 직렬화, 에러→false
- clear: 키 제거, 에러→false
- restore 우선순위: stored가 recommended보다 우선, 없으면 recommended
- action=fix-pack: stored 있으면 stored 사용
- stored []: 자동 생성 차단(canRerun false)

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3419 / 3419 pass** (3401 + 18 신규) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | runId(6.59kB) 컴파일 OK, 신규 경고 없음 |

(export/page.tsx exhaustive-deps 경고는 Stage 6 기존, 범위 밖.)

---

## 11. Stage 45에서 이어서 할 일

1. (결정) 서버 저장으로 cross-device 복원까지 갈지 — 현재 client-side만.
2. CommentPanel 내부 UI 선택 공유 강화 (Stage 43 이월).
3. (Stage 41 이월) 새 run detail에서 `?fromRunId` 활용해 source 대비 비교 자동 표시.
4. 라이브 Vercel에서 persistence UX 확인 (Bae).
5. 보류 유지: actual debit 활성화, payment provider, private repo, autofix.
