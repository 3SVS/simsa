> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 72 — Persisted Multi-Agent Experiments

Stage 71의 일회성 prompt generator를 **저장·재방문·candidate PR/review run 추적**이 가능한 project-level workflow로 발전. central-plane D1 persist + 후보별 링크 추적. 실제 agent 실행 없음.

커밋: `c0f059d`. 라이브: `…/projects/:id/experiment`, backend `…/workspace/projects/:id/agent-experiments`.

## 1. D1 data model / migration
`migrations/0041_workspace_agent_experiments.sql` — 2 테이블:
- `workspace_agent_experiments`(id·project_id·user_key·title·template_id·status·plan_json·created/updated). status 기본 'draft'.
- `workspace_agent_experiment_candidates`(id·experiment_id·candidate_id·label·mode·role·suggested_agent·status·pull_request_number·review_run_id·benchmark_id·created/updated). status 기본 'planned'.
★별도 candidate 테이블 — 후보별 PR/reviewRun/benchmark 링크를 자주 PATCH하므로(spec 권장). 워크플로로 원격 자동 적용.

## 2. experiment API endpoints (`workspace-experiment.ts`)
- `POST /workspace/projects/:id/agent-experiments` — 생성+저장(201, draft).
- `GET  …/agent-experiments?userKey=` — lightweight list(+candidate_count).
- `GET  …/agent-experiments/:experimentId?userKey=` — experiment + candidates.
- `PATCH …/agent-experiments/:experimentId/candidates/:candidateId` — 후보 링크 업데이트.

## 3. candidate validation / ownership checks (server-enforced)
- POST: userKey 필수 · title 필수 · templateId allowlist(3종) · candidate 1~8 · id 유니크 · mode/role/suggestedAgent enum.
- GET detail/PATCH: experiment 소유(project_id 일치 AND user_key 일치; 아니면 404/403).
- PATCH: candidate가 experiment 소속 · pullRequestNumber 양의 정수 · **reviewRunId/benchmarkId는 같은 project AND userKey 소유**(getReviewRunById/getAgentBenchmarkById 검증; 아니면 review_run_mismatch/benchmark_mismatch 400). 후보 status는 링크에서 도출: planned→pr_linked→reviewed→benchmarked.

## 4. dashboard experiment workflow
`/projects/:id/experiment` 확장(Stage 71 prompt 생성 유지) + persistence:
- title input + **Save experiment**(canSaveExperiment: title+templateId 게이트) → 저장 후 saved list 갱신 + 방금 저장본 자동 open.
- **Saved experiments** 리스트(제목·템플릿·후보수·날짜·Open).
- open된 experiment의 **candidate linking 패널**: 후보별 status 배지 + PR number input + review run 드롭다운(review history) + Update(→PATCH).
- benchmark hint + Open Benchmark 링크.
- `workspace-experiment-api.ts` 클라이언트. 순수 `canSaveExperiment`·`experimentCandidateStatus`(서버 미러)는 `agent-experiment.mjs`에.

## 5. candidate PR/review linking
후보 카드에서 PR 번호 수동 입력(존재 lookup 안 함 — spec 허용) + review run은 history 드롭다운 선택. PATCH가 서버에서 reviewRun 소유 검증 후 status 갱신. benchmark 링크는 API에 있으나 이번 UI는 PR/reviewRun 중심(benchmark는 후속 자동연결 대상).

## 6. benchmark connection
자동 benchmark 생성 안 함(Stage 65 검증 로직 무변경). "Use linked review runs to create a benchmark." 안내 + **Open Benchmark** 버튼 → `/projects/:id/benchmark`. 연결된 reviewRun을 benchmark candidate로 쓰는 자동화는 Stage 73 후보.

## 7. i18n 추가
`experiment.*` 확장(savedExperiments/saveExperiment/createExperiment/titlePlaceholder/saveHint/benchmarkHint/noSavedExperiments/prNumber/linkReviewRun/selectReviewRun/update*/candidateStatus/stat* 등). EN/KO·.d.mts, parity 10/10.

## 8. tests / build
- central-plane `test/workspace-agent-experiment.test.mjs` 11: create 201/missing userKey/invalid template/dup ids/list+detail round-trip/detail 403/PATCH PR→pr_linked/PATCH reviewRun→reviewed/reviewRun 타user→mismatch/unknown candidate 404/list userKey. → 전체 **979/979**.
- dashboard `agent-experiment.test.mjs` +2(canSaveExperiment, experimentCandidateStatus) → **130/130**. parity 10/10.
- repo typecheck **54/54**, build green(19 routes), lint clean(기존 export 경고만).

## 9. live migration / deploy verification
- push → deploy-central-plane.yml(Build✓ · **Apply D1 migrations(0041)✓** · Deploy Worker✓ · smoke✓). dashboard Vercel 재배포 READY.
- ★ **populated 라운드트립 라이브 검증**(가짜 아님): POST create→201(draft)+candidates → GET list→experiment 표시(candidateCount 2) → PATCH candidate PR#9→status `pr_linked`. GET list no-userKey→400, POST invalid template→invalid_template, dashboard `/experiment` 200. UI 버튼(Save/Open/Update) 육안은 Bae.

## 10. 수정한 파일 / 커밋 (`c0f059d`)
- central: migration 0041 · `workspace/agent-experiment-db.ts` · `routes/workspace-experiment.ts` · `router.ts` · `test/workspace-agent-experiment.test.mjs`.
- dashboard: `lib/agent-experiment.mjs`·`.d.mts` · `lib/workspace-experiment-api.ts` · `app/projects/[id]/experiment/page.tsx` · `i18n/dictionary.mjs`·`.d.mts` · `test/agent-experiment.test.mjs`.

## 11. known limitations
- candidate PR 번호는 수동 입력(PR 존재/소유 lookup 안 함).
- experiment→benchmark candidate 자동연결 없음(Open Benchmark 수동).
- experiment status 자동 전이 최소(draft 고정; running/reviewing/benchmarked/completed/archived 미사용).
- prompt_copied/selected/rejected candidate status 미사용(planned/pr_linked/reviewed/benchmarked만).
- benchmark 링크 UI 미노출(API만).
- 실 에이전트 실행 없음.

## 12. Stage 73 전 결정 필요한 점
1. **experiment→benchmark 원클릭**: 연결된 reviewRun들로 benchmark candidate 자동 prefill/생성.
2. **experiment status 전이**: draft→running→reviewing→benchmarked→completed 자동/수동.
3. **prompt_copied 추적** + selected/rejected 후보 결정 기록(experiment outcome).
4. **benchmark 링크 UI** + benchmark↔experiment 양방향 네비게이션.
5. (장기) 실 에이전트 실행 연결.
