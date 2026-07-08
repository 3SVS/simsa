> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 69 — Benchmark Item Matrix

Stage 68에서 저장되기 시작한 `itemOutcomesByCandidate`로 benchmark detail에 **후보 × acceptance item matrix**를 추가: "어떤 후보가 어떤 검수 항목을 만족했는지" 한눈에 비교 + 후보 간 결과가 다른 항목 강조. **dashboard 전용**(백엔드 무변경).

> Conclave does not just score agents. It shows which acceptance items each implementation actually satisfied.

커밋: `442bc3c`. 라이브: detail `…/benchmark/:benchmarkId` Acceptance item matrix.

## 1. matrix helper/model
`apps/dashboard/src/lib/agent-benchmark-matrix.mjs`(+`.d.mts`) — 순수(LLM/network 없음).
```ts
buildBenchmarkMatrix({ candidates, itemOutcomesByCandidate? }) → {
  available: boolean;
  rows: { itemId; title; statusesByCandidate: Record<cid, passed|failed|inconclusive|needs_decision|missing>;
          evidenceByCandidate?; hasDisagreement; bestStatus?; worstStatus? }[];
  itemsCompared; disagreementCount;
}
```
규칙: candidate order = benchmark.candidates 순서 / item order = 첫 candidate 우선, 이후 candidate에만 있는 항목은 뒤에 append / 결과 없는 후보는 `missing` / `hasDisagreement` = 후보 status가 모두 같지 않으면 true(missing 포함). severity(passed best > inconclusive > needs_decision > failed worst, missing unknown)로 best/worst 계산(렌더링 보조용, 과한 주장 안 함). evidence 있으면 보존.

## 2. dashboard detail changes
detail에 **Acceptance item matrix** 섹션: insights(“{n} items compared” / 다르면 amber “{m} with different results”) + status-badge 표(rows=항목, columns=후보, 헤더=후보 label + mode/source). 각 셀 status 배지(passed 초록/failed 빨강/needs_decision slate/inconclusive 노랑/missing 회색). MVP는 status matrix만(근거는 blocker 섹션·셀 미표시로 noise 회피).

## 3. disagreement/highlight logic
후보 status가 모두 같지 않은 row → 행 배경 amber tint + 항목 제목 옆 **Different results**(KO 결과 다름) amber chip. 실제 failed가 아니면 빨강 대신 차분한 amber 사용(spec 준수).

## 4. backward compatibility
구버전 saved(`itemOutcomesByCandidate` 부재) → matrix=null → fallback 섹션("Acceptance item matrix is available for newer benchmarks. / Create a new benchmark to compare item-level outcomes."). 필드 누락에 crash 없음(helper available:false, UI null 가드).

## 5. copy summary / PR comment changes
**없음** — spec의 "leave as Stage 68 behavior" 옵션 채택. PR comment 비대화 방지를 위해 matrix는 detail UI에만. (필요 시 후속에서 compact insight만 추가 가능.)

## 6. i18n 추가
`benchmark.*`: matrixTitle/matrixDesc/differentResults/matrixItemsCompared(`{n}`)/matrixDisagreements(`{n}`)/matrixUnavailable/matrixUnavailableBody/missingResult. EN/KO·.d.mts, parity 10/10. 셀 status 라벨은 statusLabel 재사용 + missing은 missingResult.

## 7. tests / build
- `test/benchmark-matrix.test.mjs` 6개: rows/candidate·item order, missing→"missing"+disagreement, hasDisagreement true/false, best/worst severity, backward fallback(available:false), empty outcomes(available:true·0 rows).
- dashboard **114/114**(matrix 6 신규), i18n parity 10/10, typecheck clean, build green(18 routes), lint clean(기존 export 경고만).

## 8. live verification
- dashboard Vercel 재배포 READY, detail route 200, SSR "Loading the benchmark…".
- ★ populated matrix(후보 컬럼 + disagreement chip) + EN/KO 육안은 Bae 수동: Stage 68+ 로 생성한 saved benchmark 필요(itemOutcomesByCandidate 보유). 구버전/빈 데이터 → fallback 섹션 표시. 라이브 저장본 0 → route/fallback contract로 문서화(가짜 성공 없음).

## 9. 수정한 파일 / 커밋 (`442bc3c`)
- 신규: `lib/agent-benchmark-matrix.mjs`·`.d.mts`, `test/benchmark-matrix.test.mjs`.
- 수정: `app/projects/[id]/benchmark/[benchmarkId]/page.tsx`(matrix 섹션), `i18n/dictionary.mjs`·`.d.mts`.

## 10. known limitations
- 셀에 evidence 미표시(noise 회피) — 근거는 Remaining blocker items 섹션에.
- 후보 많으면 가로 스크롤(컬럼 폭) — 컬럼 수 상한 없음.
- best/worst는 계산만, UI에서 약하게만 사용.
- copy/PR comment에 matrix 미반영(의도적).
- 구버전 saved는 재생성해야 matrix 표시.
- 실 에이전트 실행 없음.

## 11. Stage 70 전 결정 필요한 점
1. **matrix evidence**: 셀/행 확장으로 후보별 근거 노출(현재 미표시).
2. **matrix 정렬/필터**: disagreement만 보기, status별 정렬.
3. **copy/PR comment compact insight**: "N items, M differ"만 최소 추가할지.
4. **benchmark 관리**: rename/delete · share URL · audit 이벤트(누적 후속).
5. (장기) 실 에이전트 실행 연결.
