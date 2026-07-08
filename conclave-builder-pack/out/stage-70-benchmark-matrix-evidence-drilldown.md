> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 70 — Benchmark Matrix Evidence Drilldown

Stage 69의 item matrix를 실용적 evidence view로 발전: 후보 간 결과가 다른 항목만 필터, row를 펼쳐 후보별 evidence 비교, copy summary·PR comment에 아주 작은 matrix insight 추가. **dashboard 전용**(백엔드 무변경).

커밋: `99ff763`. 라이브: detail `…/benchmark/:benchmarkId` Acceptance item matrix.

## 1. disagreement filter
matrix 섹션에 **Show different results only**(KO 결과가 다른 항목만 보기) 토글. off=전체 rows, on=`hasDisagreement===true` rows만. disagreement row 없으면 empty state("No different results found. / All candidates have the same status…"). `filterMatrixRows(rows, {differentOnly})` 순수 helper.

## 2. evidence drilldown
각 matrix row에 **View evidence / Hide evidence**(KO 근거 보기/닫기) 토글. 펼치면 colspan 행에 후보별 {label, status 배지, evidence}. evidence 없으면 "No evidence text was stored for this candidate." fallback. ★LLM 재작성 없음 — 저장된 `evidenceByCandidate`만 표시. raw token/userKey 없음(데이터에 없음).

## 3. matrix insight summary
`getMatrixInsights(matrix)` → `{itemsCompared, disagreementCount}`. UI에서 compact 라인 2개 생성:
- "{n} items compared"
- disagreement>0 → "{n} items had different results across candidates" / 0 → "No different results across candidates".

## 4. copy summary / PR comment changes
- `buildBenchmarkSummaryText`·`buildBenchmarkPrCommentMarkdown`에 optional `matrixHeading`/`matrixLines` 추가. 있으면 끝부분에 compact 섹션(copy: "검수 항목 매트릭스:\n- …", markdown: `### Acceptance item matrix\n\n- …`). ★**full matrix 표는 절대 PR comment에 넣지 않음**(counts만). matrixLines 없으면 섹션 생략(구버전 호환).

## 5. backward compatibility
구버전 saved(`itemOutcomesByCandidate` 부재) → matrix=null → matrix 섹션 fallback, toggle 미표시, matrixInsightLines=[] → copy/PR comment에 matrix insight 미포함. crash 없음.

## 6. i18n 추가
`benchmark.*`: showDifferentOnly/noDifferentResults/noDifferentResultsBody/viewEvidence/hideEvidence/noEvidenceStored/matrixInsightDiffered(`{n}`)/matrixInsightNoDiff. EN/KO·.d.mts, parity 10/10.

## 7. tests / build
- matrix: filterMatrixRows(differentOnly true→disagreement만, 모두 동일→empty), getMatrixInsights, evidenceByCandidate 존재 조건.
- summary: matrix insight 섹션 추가/생략(backward).
- comment: matrix insight 섹션(counts only·표 없음 검증)/생략, no-leak 유지.
- dashboard **122/122**(8 신규), parity 10/10, typecheck clean, build green(18 routes), lint clean(기존 export 경고만).

## 8. live verification
- dashboard 재배포 READY, detail route 200, SSR "Loading the benchmark…".
- ★ populated matrix(토글·evidence 펼침·EN/KO) 육안은 Bae 수동: Stage 68+ 로 생성한 saved benchmark(itemOutcomesByCandidate, evidence 포함) 필요. 구버전/빈 → fallback. 라이브 저장본 0 → route/fallback contract로 문서화(가짜 성공 없음).

## 9. 수정한 파일 / 커밋 (`99ff763`)
- `lib/agent-benchmark-matrix.mjs`·`.d.mts`(filter/insights), `lib/agent-benchmark.mjs`·`.d.mts`(summary matrix section), `lib/agent-benchmark-comment.mjs`·`.d.mts`(markdown matrix section), `app/projects/[id]/benchmark/[benchmarkId]/page.tsx`(MatrixSection 컴포넌트), `i18n/dictionary.mjs`·`.d.mts`, 3 test 파일.

## 10. known limitations
- 후보 많으면 가로 스크롤(컬럼 수 상한 없음).
- evidence는 저장된 첫 항목(요약/다중 아님).
- matrix insight는 counts만(copy/PR) — 의도적.
- 구버전 saved는 재생성해야 matrix·drilldown 표시.
- 실 에이전트 실행 없음.

## 11. Stage 71 전 결정 필요한 점
1. **matrix 정렬**: status별/disagreement 우선 정렬.
2. **evidence 출처**: 파일/라인 등 근거 출처 노출(현재 텍스트만).
3. **benchmark 관리**: rename/delete · read-only share URL · preview/post audit 이벤트(누적 후속).
4. **다중 evidence**: 후보별 evidence 여러 개 노출.
5. (장기) 실 에이전트 실행 연결.
