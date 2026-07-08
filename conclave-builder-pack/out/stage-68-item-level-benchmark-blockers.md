> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 68 — Item-level Benchmark Blockers

benchmark evidence를 status **count** 비교에서 acceptance **item 단위**로 강화: "어떤 검수 항목이 아직 막혀 있는지"를 항목 제목·상태·근거·후보 단위로 설명. central-plane canonical + dashboard mirror + 공유 golden fixture로 lock-step.

커밋: `957f4b6`. 라이브: detail `…/benchmark/:benchmarkId` Remaining blocker items.

## 1. item-level blocker model
central-plane `agent-benchmark.ts`(+dashboard `.mjs` mirror, `.d.mts` 동기):
```ts
type BenchmarkCandidateItemOutcome = { candidateId; itemId; title; status: passed|failed|inconclusive|needs_decision; evidence? };
type BenchmarkItemBlocker = { itemId; title; status: failed|needs_decision|inconclusive; severity: issue|decision|not_verified; evidence?; candidateId };
// AgentBenchmarkResult 확장(optional):
itemOutcomesByCandidate?: Record<candidateId, BenchmarkCandidateItemOutcome[]>;
remainingBlockers?: BenchmarkItemBlocker[];
blockerBasisCandidateId?: string;
```
- status→severity: failed→issue, needs_decision→decision, inconclusive→not_verified. passed는 blocker 아님.
- remainingBlockers = winner candidate(없으면 top-ranked) 의 non-passed 항목. `blockerBasisCandidateId`로 기준 후보 명시.
- LLM 재작성 없음 — 저장된 review 항목의 title/evidence를 그대로 사용, 없으면 안전 생략(title은 itemId fallback).

## 2. server calculation changes
`buildBenchmarkResult`가 optional `itemResultsByCandidate`(각 run의 저장된 results) 수신 → itemOutcomesByCandidate 생성 + winner 기준 remainingBlockers 산출. route(`workspace-benchmark.ts`)가 각 candidate run의 `resultJson.results`를 `parseResultItems`로 파싱해 전달. status normalization(canonical 4종)으로 raw backend 라벨 미사용.

## 3. backward compatibility
item results 미공급 시 item-level 필드는 **부재**(undefined) → 기존 count-based 동작 그대로. 기존 saved benchmark(0040 이전 생성)에는 필드가 없음:
- detail: `remainingBlockers === undefined` → count-based blocker 섹션 + "Detailed blocker items are available for newer benchmarks." note.
- itemOutcomes 없음 → matrix 미표시(MVP는 matrix 미노출, snapshot에만 보관).
golden 테스트가 "item 미공급 → 필드 부재"를 명시 검증.

## 4. dashboard detail changes
`/benchmark/:benchmarkId`에 **Remaining blocker items** 섹션: 각 blocker 카드 = 상태 배지(failed/needs_decision/inconclusive 색상) + 항목 제목 + (있으면) 근거 + 기준 후보 라벨. 비면 noBlockerItems. item-level 없으면 count-based + old-benchmark note로 fallback.

## 5. copy summary / PR comment changes
- copy summary(`buildBenchmarkSummaryText` 호출부): item-level 있으면 `"{status}: {title}"` 라인, 없으면 기존 count 라인.
- PR comment markdown(`buildBenchmarkPrCommentMarkdown`): blockerLines가 string(count) OR `{text, evidence?}`(item-level) 모두 수용 — item-level은 `- **{status}:** {title}` + 들여쓴 `  - {evidence}` 서브라인. 결정적·LLM 없음.

## 6. i18n 추가
`benchmark.*`: blockerItemsTitle/blockerItemsDesc/noBlockerItems/oldBenchmarkBlockers/evidence. EN/KO·.d.mts, parity 10/10. blocker 상태 라벨은 statusLabel 재사용(failed→Issue found 등).

## 7. tests / build
- ★ lock-step: 공유 golden fixture에 item-level 케이스 추가(itemResultsByCandidate + expectedItems) → central-plane `agent-benchmark.test.mjs`와 dashboard `agent-benchmark-parity.test.mjs` 양쪽이 동일 검증(remainingBlockers/outcomeCounts/basis). 미공급 케이스는 필드 부재 검증.
- central-plane: 라우트 item-level 테스트(winner 기준 blocker, severity, passed 제외, evidence 보존, outcome counts) → **968/968**.
- dashboard: markdown item-level(bold status + indented evidence) 테스트 → **108/108**. parity/copy/no-leak 유지.
- repo typecheck **54/54**, build green, lint clean(기존 export 경고만).

## 8. live verification
- push → deploy-central-plane.yml(Build✓·migrations(idempotent)✓·Worker✓·smoke✓). dashboard Vercel 재배포 READY.
- 라이브 계약: GET list→`{ok:true,benchmarks:[]}`, POST(없는 run)→`review_run_not_found`(run 파싱/검증 경로 동작), detail route 200.
- ★ populated item-level blockers 육안은 Bae 수동: non-passed 항목(status/title 보유)을 가진 실 review run 2개로 새 benchmark 생성 → detail Remaining blocker items 확인. 라이브 저장본 0 → contract/tests로 문서화(가짜 성공 없음).

## 9. 수정한 파일 / 커밋 (`957f4b6`)
- central: `workspace/agent-benchmark.ts`, `routes/workspace-benchmark.ts`, `test/agent-benchmark.test.mjs`, `test/workspace-agent-benchmark.test.mjs`, `test/fixtures/agent-benchmark-golden.json`.
- dashboard: `lib/agent-benchmark.mjs`·`.d.mts`, `lib/agent-benchmark-comment.mjs`·`.d.mts`, `app/projects/[id]/benchmark/[benchmarkId]/page.tsx`, `i18n/dictionary.mjs`·`.d.mts`, `test/agent-benchmark-parity.test.mjs`, `test/benchmark-comment.test.mjs`.

## 10. known limitations
- itemOutcomesByCandidate는 snapshot에 저장하지만 detail에 전체 matrix UI 미노출(후속).
- blocker는 단일 기준 후보(winner/top-ranked) — 후보별 blocker 동시 비교 UI 없음.
- evidence는 저장된 review evidence 첫 항목(요약 아님).
- 기존(0040 이전) saved benchmark는 item-level 없음(재생성해야 채워짐).
- 실 에이전트 실행 없음.

## 11. Stage 69 전 결정 필요한 점
1. **후보별 acceptance item matrix UI**: itemOutcomesByCandidate(이미 snapshot 보관)를 detail에서 후보×항목 표로 노출.
2. **benchmark 관리**: rename/delete(+UI).
3. **공유 강화**: read-only share URL / preview·post audit 이벤트.
4. **evidence 품질**: 다중 evidence·근거 출처(파일/라인) 노출.
5. (장기) 실 에이전트 실행 연결.
