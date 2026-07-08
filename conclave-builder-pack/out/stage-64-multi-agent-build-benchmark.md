> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 64 — Multi-Agent Build Benchmark

Conclave가 여러 AI 개발 에이전트의 결과물을 **acceptance 기준**으로 비교할 수 있는 최소 결정적 구조. 실제 에이전트 실행 없이, 기존 PR review run을 candidate로 선택해 single-agent vs multi-agent 결과를 비교한다.

커밋: `917d1e0`. 라이브: https://conclave-dashboard.vercel.app/projects/:id/benchmark

## Product hypothesis
> Given the same raw product idea and acceptance items, a Conclave-guided multi-agent workflow produces a better accepted implementation than a single-agent workflow.

"better"는 감상이 아니라 acceptance 결과(passed/failed/inconclusive/needs_decision)로 측정한다. Conclave는 어떤 에이전트가 더 똑똑한지 추측하지 않고, 각 구현이 **실제로 무엇을 충족했는지** 비교한다.

## 1. Benchmark model (구현)
`apps/dashboard/src/lib/agent-benchmark.mjs` (+`.d.mts`). 순수·locale-agnostic·네트워크 없음·LLM 감상 없음. dashboard/React import 0 → 후속 단계에서 central-plane으로 그대로 이전 가능.

- 타입: `AgentCandidate`{id,label,mode,source,pullRequestNumber?,reviewRunId?,notes?}, `AgentCandidateMetrics`, `AgentBenchmarkResult`(spec와 동일, 단 recommendation.rationale/blockers는 i18n 위해 **structured item**으로 — 아래 deviation 참고).
- `CANDIDATE_MODES` = single_agent/multi_agent/reviewer_agent/hybrid, `CANDIDATE_SOURCES` = claude_code/codex/cursor/manual/other.

### ★ 아키텍처 결정: dashboard-side 계산 (문서화 요구사항)
central-plane이 장기적으로 맞지만 Stage 64는 dashboard 결정적 계산으로 한다. 이유:
1. 필요한 입력(run별 summary counts)이 이미 기존 `review-history` 엔드포인트로 클라이언트에서 접근 가능 — 신규 데이터 불필요.
2. 순수 함수 → `node --test`로 네트워크 없이 단위 검증.
3. candidate 선택은 본질적으로 UI 작업.
4. central-plane 변경·신규 엔드포인트·MCP tool·마이그레이션 회피(이번 단계 scope 게이트 준수).
5. 순수 함수라 persisted cross-device benchmark history가 필요해지는 시점(Stage 65+)에 verbatim 이전 가능.

## 2. Metrics / score
```
acceptancePassRate = passed / totalItems        (total 0이면 0, NaN 방지)
criticalIssueCount = failed + needs_decision
notVerifiedCount   = inconclusive
score = passed*3 - failed*3 - needs_decision*2 - inconclusive*1
```
점수는 보조 지표 — UI는 항상 원본 counts(passed/total, critical, not-verified)를 함께 보여준다. (rework burden = failed+inconclusive+needs_decision는 winner 로직 내부 개념으로만 사용; 타입에는 spec대로 미노출.)

## 3. Comparison / recommendation logic
랭킹(best-first, deterministic): score↓ → passRate↓ → criticalIssue↑(적을수록) → notVerified↑(적을수록) → candidate id(안정 tiebreak).

No clear winner 조건: top1·top2가 `|score차| ≤ 1` AND `같은 passRate` AND `같은 criticalIssueCount`. recommendation은 candidate ≥ 2일 때만 생성.

rationale(structured → UI에서 t로 렌더):
- `pass_comparison`: "{winner} passed N of M …, compared with {runner}'s …"
- `fewer_critical`: winner의 critical < runner일 때
- `runner_not_verified`: runner의 not-verified > 0일 때
- `no_clear_winner`

blockers(structured): failed+needs_decision+inconclusive > 0인 candidate별 항목.

### Deviation (문서화)
spec의 `recommendation.rationale: string[] / blockers: string[]`를 **structured item[]**로 바꿨다. 순수 로직 레이어에 영어 문장을 박으면 EN/KO 토글이 깨지므로, 코드+파라미터만 반환하고 UI가 사전으로 지역화한다. 테스트도 locale-독립적으로 검증 가능(장점).

## 4. Dashboard 변경 (API 변경 없음)
- 신규 라우트 `/projects/:id/benchmark` (`app/projects/[id]/benchmark/page.tsx`, client).
- 구성: intro → candidate selector(available review runs / selected candidates: label·mode·source 편집·remove) → metrics cards(승자 강조) → comparison table → recommendation(winner rationale or no-clear-winner) → remaining blockers → next action(승자 run 열기).
- 빈/부족 상태: 0 runs → emptyTitle/Body, <2 candidates → needMore. (가짜 성공 금지 — 실 run 2개 이상 없으면 empty.)
- nav: Review 그룹에 Benchmark 추가(`AppSidebar`, `nav.benchmark`).
- backend/central-plane/MCP **무변경**.

## 5. i18n
신규 `benchmark.*` 네임스페이스(EN+KO, `.d.mts` 동기) + `nav.benchmark`. mode/source/rationale/blocker는 헬퍼·템플릿 보간(`{n}` `.replace`)로 지역화. key-parity 10/10.

## 6. Tests
`apps/dashboard/test/agent-benchmark.test.mjs` 12개: metrics 계산, score 가중, empty/garbage→0(NaN 방지), winner 선택, fewer_critical/runner_not_verified rationale, blockers, tie→no-clear-winner, passRate 차이→clear winner, <2 candidate→no recommendation, missing candidate counts→zeros, rank tiebreaker, mode/source enums. + 기존 i18n parity 테스트가 benchmark 네임스페이스 EN/KO 일치 검증.
- 합계 dashboard **89/89** pass.

## 7. Live / demo verification
- 배포: repo root에서 `vercel --prod`(★Root Dir=apps/dashboard라 root에서 실행). READY + `conclave-dashboard.vercel.app` alias.
- `/projects/:id/benchmark` 200. mock 프로젝트로 SSR 영어 본문 확인: "Compare build candidates" / "Use acceptance results" / "does not guess which agent".
- candidate selector/metrics는 실 review run(≥2)이 있을 때 채워짐 — 없으면 empty state(정상). 브라우저 EN/KO 토글·실데이터 비교는 Bae 수동 육안(에이전트 브라우저 조작 불가).

## 8. 수정한 파일 / 커밋 (`917d1e0`)
- 신규: `lib/agent-benchmark.mjs`·`.d.mts`, `test/agent-benchmark.test.mjs`, `app/projects/[id]/benchmark/page.tsx`.
- 수정: `components/AppSidebar.tsx`(nav), `i18n/dictionary.mjs`·`.d.mts`(benchmark + nav.benchmark).

## 9. Known limitations
- 실제 Claude/Codex/Cursor 실행 없음 — candidate는 사람이 기존 run을 골라 label/mode/source 지정(가설 검증용 최소 구조).
- candidate 선택/구성은 메모리 상태(미영속) — 새로고침 시 초기화. 영속·공유는 후속.
- 메트릭은 review run summary 기준 — 같은 acceptance item set을 비교한다는 전제(서로 다른 PR의 run을 비교하면 분모가 다를 수 있음, 사용자 책임).
- backend 미연동 → cross-device benchmark history 없음.
- summary 누락 run은 0으로 계산(비교에서 사실상 최하위).

## 10. Stage 65 전 결정 필요한 점
1. **central-plane 이전 여부**: persisted benchmark(프로젝트별 candidate 구성 저장, 공유, 재현)이 필요하면 `agent-benchmark.ts`로 순수 함수 이전 + `POST/GET /workspace/projects/:id/benchmark` + ownership/run-project 일치 검증(테스트: ownership/invalid reviewRunId/mismatched project-run).
2. **동일 acceptance set 보증**: 같은 PR의 여러 run vs 서로 다른 구현(다른 PR)을 비교할 때 item set 정합성 가드.
3. **실 에이전트 실행 연결**(장기): Claude/Codex/Cursor 결과를 자동 candidate로 — 단 이번 scope 게이트(실행 금지) 밖, 별도 의사결정 필요.
4. **가중치 검증**: score 가중(3/3/2/1)을 실데이터로 캘리브레이션할지.
