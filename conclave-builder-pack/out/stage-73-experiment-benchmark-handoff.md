> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 73 — Experiment → Benchmark Handoff

Stage 72의 저장된 experiment를 Stage 65~70 benchmark workflow와 연결: experiment의 linked review run들로 **바로 benchmark 생성** + 결과를 experiment에 역링크. end-to-end evidence workflow 완성.

커밋: `9424f80`. 라이브: `…/projects/:id/experiment` Benchmark handoff.

## 1. experiment → benchmark mapping
linked candidate = `reviewRunId` 있는 후보. 매핑(순수 `mapExperimentCandidatesToBenchmark`): `{id:candidateId, label, mode, source:suggestedAgent(1:1), reviewRunId, pullRequestNumber}`. suggestedAgent↔benchmark source enum 동일(claude_code/codex/cursor/manual/other). role(reviewer/fixer)여도 label 유지.

## 2. backend/API decision
★**Option B(신규 엔드포인트) + source_experiment_id 컬럼** 채택. 이유: Stage 65 계산(`buildBenchmarkResult`+`computeAcceptanceSetAlignment`)을 **재사용(복제 아님)** → 원자적(benchmark 생성+candidate benchmarkId·status+experiment status) + 서버 ownership 강제 + source 링크 저장 가능. dashboard-only(Option A)는 다중 PATCH + source 저장 난점.
신규 엔드포인트: `POST /workspace/projects/:id/agent-experiments/:experimentId/benchmark`.

## 3. D1/schema changes
- migration `0042_benchmark_source_experiment.sql`: `ALTER TABLE workspace_agent_benchmarks ADD COLUMN source_experiment_id TEXT`(nullable). Stage 65 직접 생성은 NULL.
- `insertAgentBenchmark`가 optional sourceExperimentId 저장, `getAgentBenchmarkById`/benchmark detail이 반환.
- `updateExperimentStatus` helper 추가.

## 4. dashboard handoff UI
experiment detail(openExp)에 **Benchmark handoff** 섹션:
- linked < 2 → 비활성 + "Link review runs for at least two candidates…".
- linked ≥ 2 & 미연결 → **Create benchmark from experiment** 버튼 → POST handoff → 성공 시 experiment(candidates benchmarked) 갱신.
- 이미 연결됨(candidate.benchmarkId) → "Benchmark created/linked" + **Open benchmark result**(`/benchmark/:benchmarkId`).
순수 `canCreateBenchmarkFromExperiment`로 게이트.

## 5. experiment/benchmark linking behavior
handoff 성공 시 서버가: benchmark(sourceExperimentId 저장) 생성 → 각 linked candidate에 benchmarkId 세팅 + status `benchmarked` → experiment status `benchmarked`. 응답으로 benchmark + 갱신된 experiment 반환.

## 6. source experiment link
benchmark detail meta에 `sourceExperimentId` 있으면 **Source experiment → Open experiment** 링크 → `/projects/:id/experiment?experiment=<id>`. experiment 페이지가 `?experiment=` 쿼리로 해당 experiment 자동 open(역방향 네비 완성).

## 7. i18n 추가
`experiment.*`(benchmarkHandoff/benchmarkHandoffDesc/createBenchmarkFromExperiment/benchmarkNeedsTwo/benchmarkCreated/benchmarkLinked/openBenchmarkResult/benchmarkFromExpError/creatingBenchmark) + `benchmark.*`(sourceExperiment/openExperiment). EN/KO·.d.mts, parity 10/10.

## 8. tests / build
- central-plane `workspace-agent-experiment.test.mjs` +4: handoff success(sourceExperimentId·winner·candidate benchmarked·benchmarkId 역링크·experiment status), missing userKey, <2 linked→not_enough_linked_runs, other user→403. → 전체 **983/983**.
- dashboard `agent-experiment.test.mjs` +2: canCreateBenchmarkFromExperiment(2+ 게이트), mapExperimentCandidatesToBenchmark(linked만·benchmark shape). → **132/132**.
- repo typecheck **54/54**, build green(19 routes), lint clean(기존 export 경고만).

## 9. live verification
- push → deploy-central-plane(Build✓ · **migration 0042✓** · Worker✓ · smoke✓). dashboard 재배포 READY.
- ★ 라이브 계약 검증: experiment 생성 → POST handoff(0 linked)→`not_enough_linked_runs` · no userKey→`userKey_required` · unknown experiment→`not_found`. dashboard `/experiment` 200.
- populated handoff(실 review run 2개 linked → benchmark 생성 → source 링크) 육안은 Bae 수동(실 run 필요). 엔드포인트 로직/ownership/재사용은 4개 백엔드 테스트로 커버(가짜 성공 없음).

## 10. 수정한 파일 / 커밋 (`9424f80`)
- central: migration 0042 · `agent-benchmark-db.ts`(sourceExperimentId) · `agent-experiment-db.ts`(updateExperimentStatus) · `routes/workspace-experiment.ts`(handoff endpoint) · `routes/workspace-benchmark.ts`(detail sourceExperimentId) · test.
- dashboard: `lib/agent-experiment.mjs`·`.d.mts` · `lib/workspace-experiment-api.ts`(createBenchmarkFromExperiment) · `lib/workspace-benchmark-api.ts`(sourceExperimentId) · `experiment/page.tsx` · `benchmark/[benchmarkId]/page.tsx` · `i18n/*` · test.

## 11. known limitations
- handoff는 linked candidate의 reviewRun summary/results 기준(Stage 65~68 동일) — 같은 acceptance set 가드는 alignment 경고만.
- experiment status는 draft→benchmarked만 전이(running/reviewing/completed/archived 미사용).
- benchmark↔experiment 링크는 source_experiment_id 단방향 저장 + UI 양방향 네비(experiment candidate별 benchmarkId).
- candidate 일부만 linked면 linked만 benchmark 후보(나머지 제외).
- 실 에이전트 실행 없음.

## 12. Stage 74 전 결정 필요한 점
1. **experiment status 전이 전체**(draft→running→reviewing→benchmarked→completed/archived) + UI.
2. **outcome 기록**: benchmark 후 어느 후보 selected/rejected.
3. **handoff 재생성**: 이미 benchmark된 experiment에서 재실행 정책(중복/갱신).
4. **acceptance set strict**: handoff 시 set 불일치면 차단/경고 강화.
5. (장기) 실 에이전트 실행 연결.
