> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 65 — Persisted Multi-Agent Build Benchmark

Stage 64의 dashboard-only 벤치마크를 **central-plane persisted, ownership-검증, cross-device** evidence artifact로 발전. 실 에이전트 실행 없이 기존 review run을 candidate로 저장·조회·재방문.

커밋: `850c344`. 라이브: dashboard `…/projects/:id/benchmark`, backend `…/workspace/projects/:id/agent-benchmarks`.

## 1. D1 data model / migration
`migrations/0040_workspace_agent_benchmarks.sql`:
```
workspace_agent_benchmarks(
  id PK, project_id, user_key, title, created_at, updated_at,
  candidate_count, winner_candidate_id, no_clear_winner, result_json )
+ idx(project_id, created_at DESC), idx(user_key, created_at DESC)
```
MVP 결정: candidates/result snapshot 전체를 `result_json`에 저장하고, list/query에 필요한 필드(candidate_count·winner_candidate_id·no_clear_winner)만 top-level 컬럼으로 승격. 별도 candidate 테이블은 두지 않음(복잡도↓). 워크플로가 forward-only·idempotent로 자동 적용.

## 2. Benchmark calculation source of truth
`apps/central-plane/src/workspace/agent-benchmark.ts` = **canonical**. Stage 64 dashboard 로직을 TS로 포팅(동일 metrics/score/rank/winner/no-clear-winner) + `computeAcceptanceSetAlignment` 추가. 저장되는 벤치마크는 항상 central-plane 계산 결과를 source of truth로 사용. dashboard `agent-benchmark.mjs`는 **저장 전 미리보기 전용**.

### ★ Anti-divergence (문서화 요구)
두 구현(.ts/.mjs)을 **공유 golden fixture** `apps/central-plane/test/fixtures/agent-benchmark-golden.json`로 lock-step. central-plane 테스트(`test/agent-benchmark.test.mjs`, dist .ts)와 dashboard 테스트(`test/agent-benchmark-parity.test.mjs`, .mjs)가 같은 fixture를 assert → 한쪽이 바뀌면 fixture 테스트가 깨짐. (한쪽 canonical + 공유 fixture, spec 옵션 채택.)

## 3. API endpoints (`workspace-benchmark.ts`, no MCP/OAuth/billing 변경)
- `POST /workspace/projects/:id/agent-benchmarks` — 생성+저장(201).
- `GET  /workspace/projects/:id/agent-benchmarks?userKey=` — lightweight list.
- `GET  /workspace/projects/:id/agent-benchmarks/:benchmarkId?userKey=` — saved detail(full result).

## 4. Ownership / run validation (server-enforced)
POST 시: userKey 필수 → candidate 2~5개 → candidate id 유니크 → 각 candidate reviewRunId 필수 → mode/source enum 검증 → 각 reviewRun **존재** AND **project_id === :id** AND **user_key === 요청 userKey**. 위반 시 각각 `userKey_required`/`candidate_count_invalid`/`duplicate_candidate_ids`/`review_run_required`/`invalid_candidate`/`review_run_not_found`/`review_run_project_mismatch`(400)/`forbidden`(403). 저장된 벤치마크는 detail/list에서 소유 userKey에게만 반환(타인 403/404).

## 5. Acceptance set alignment guard
각 candidate reviewRun의 `selectedItemIds`를 비교(순서 무관 set). 모두 동일 → `aligned:true`; 다르면 `aligned:false` + `warning:"acceptance_set_mismatch"` + `baselineItemIds`(첫 candidate 기준) + `differingCandidateIds`. POST 시 계산해 snapshot에 저장 → detail에서 재방문 가능. UI 문구: EN "These candidates were reviewed against different acceptance item sets. Compare results with caution." / KO "후보들이 서로 다른 검수 항목 기준으로 확인되었습니다. 결과를 해석할 때 주의하세요."

## 6. Dashboard changes
- 신규 client `workspace-benchmark-api.ts`(save/list/get) + `canSaveBenchmark`(2~5 gate)는 `agent-benchmark.mjs`로 이동(테스트 가능하게).
- `/projects/:id/benchmark` 확장: title input · **Save benchmark**(2~5 candidate 전까지 disabled) · saved-benchmark list(제목·저장일·승자/무승부, Open) · acceptance-set warning(미리보기는 selectedItemCount 휴리스틱, 저장본은 서버 authoritative). 저장본 = source of truth; .mjs는 미저장 preview 유지. 재방문 시 saved list가 central-plane에서 로드됨.

## 7. i18n 추가
`benchmark.*` 확장: createBenchmark/titlePlaceholder/save/saving/saved/saveError/savedBenchmarks/noSavedBenchmarks/savedAt/open/acceptanceSetWarning (EN/KO·.d.mts, parity 10/10).

## 8. tests / build
- central-plane: `agent-benchmark.test.mjs`(5 golden+1 alignment) + `workspace-agent-benchmark.test.mjs`(12: create 201/userKey/count/dup/not-found/project-mismatch/forbidden/alignment-mismatch/list+detail round-trip/list-userKey/detail-404/detail-403) → 전체 **967/967**.
- dashboard: golden parity 4 + save-gate 2 → **95/95**, i18n parity 10/10.
- repo typecheck **54/54**, build green.

## 9. live migration / deploy verification
- push → `deploy-central-plane.yml`: Build ✓ · **Apply D1 migrations(0040) ✓** · Deploy Worker ✓ · Smoke test ✓.
- dashboard Vercel 재배포 READY.
- 라이브 계약 검증: `GET list` no-userKey→400 · `GET list` userKey→`{"ok":true,"benchmarks":[]}`(0040 테이블 쿼리 정상) · `POST` no-userKey→400 · 1 candidate→`candidate_count_invalid` · 2 candidate(없는 run)→`review_run_not_found`(run 검증 라이브 실행). dashboard `/benchmark` 200, SSR "Compare build candidates".
- 실 run 2개로 POST→list→reload 전체 라운드트립은 Bae 수동(본인 userKey + 실 reviewRunId 2개 필요).

## 10. 수정한 파일 / 커밋 (`850c344`)
- central-plane: migration 0040 · `workspace/agent-benchmark.ts`·`agent-benchmark-db.ts` · `routes/workspace-benchmark.ts` · `router.ts` · `test/fixtures/agent-benchmark-golden.json` · 2 test files.
- dashboard: `lib/agent-benchmark.mjs`·`.d.mts`(alignment+canSaveBenchmark) · `lib/workspace-benchmark-api.ts` · `app/projects/[id]/benchmark/page.tsx` · `i18n/dictionary.mjs`·`.d.mts` · 2 test files.

## 11. known limitations
- 실 에이전트 실행 없음(사람이 기존 run을 candidate로 지정).
- saved "Open"은 승자 run 상세로 링크 — 저장된 전체 비교를 별도 화면으로 재구성하진 않음(list row가 제목·저장일·승자/무승부 evidence 제공). 풀 saved-detail 뷰는 후속.
- alignment 미리보기는 selectedItemCount 휴리스틱(history list가 itemIds 미노출) — 저장본은 서버 selectedItemIds 기반 authoritative.
- candidate 구성(편집 중)은 여전히 미영속(저장 전까지); 저장 후엔 D1 영속.
- 같은 PR vs 다른 PR run 비교 시 분모(acceptance set) 차이는 alignment guard로 경고만(차단 안 함).

## 12. Stage 66 전 결정 필요한 점
1. **Saved detail 전용 뷰**: 저장된 result(metrics/comparison/rationale/alignment) 재구성 화면 + deep-link. UI 가치 높음.
2. **acceptance set 정합성 정책**: 경고에서 더 나아가 같은 set만 비교 허용(strict)할지, 항목 교집합 기준으로 정규화 비교할지.
3. **benchmark 편집/삭제**: 저장본 rename/delete 엔드포인트 필요 여부.
4. (장기) 실 에이전트 실행 연결 — 이번 scope 게이트 밖, 별도 의사결정.
5. score 가중(3/3/2/1) 실데이터 캘리브레이션.
