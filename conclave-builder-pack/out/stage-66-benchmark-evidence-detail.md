> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 66 — Benchmark Evidence Detail

Stage 65에서 저장 가능해진 Multi-Agent Build Benchmark를 **다시 열어보고·이해하고·공유**할 수 있는 evidence artifact로 완성. dashboard 전용(Stage 65 엔드포인트 재사용, 백엔드·MCP·billing 무변경, 실 에이전트 실행 없음).

커밋: `3238b5f`. 라이브: `…/projects/:id/benchmark/:benchmarkId`.

## 1. detail route / 화면 구성
신규 `app/projects/[id]/benchmark/[benchmarkId]/page.tsx` (client). saved list의 **Open**이 이제 winner run이 아니라 이 detail로 이동(`/projects/:id/benchmark/:benchmarkId`). 구성:
- Header(Benchmark result / subtitle) + **Copy summary** 버튼
- Meta(title · Created · Candidates 수)
- Acceptance-set alignment(misaligned면 amber 경고, aligned면 작은 회색 note)
- Recommendation(winner label + "왜 추천하는지" + **Open review run**, 또는 no-clear-winner)
- Why(rationale 목록)
- Candidate comparison table(Label·Mode·Source·Passed/total·Critical·Not verified·Score·Run(PR 링크))
- per-candidate Metrics 카드(passRate·score·passed/total·critical·needs decision·not verified — 원본 count 병기)
- Remaining blockers(winner 기준, Issue found/Needs decision/Not verified 그룹; 없으면 noRemainingBlockers)
- Source review runs(각 candidate → 확인 기록 링크)

기존 winner run 링크는 detail 내부 보조 action(Open review run)으로 유지.

## 2. evidence narrative 구성
- 핵심 프레이밍 상단 고정: "Conclave does not guess which agent is smarter. It compares what each implementation actually satisfies." / KO 동일.
- winner: recommendedCandidate + recommendedBody("더 많은 검수 항목을 충족하면서 미해결 이슈가 더 적어 추천"). no-clear-winner: noClearWinner + body.
- Why = Stage 64/65의 structured rationale(pass_comparison/fewer_critical/runner_not_verified)를 UI에서 t로 렌더(LLM 재작성 없음).
- score는 항상 원본 count와 함께(scoreNote "보조 지표 — 원본 개수와 함께 보세요"), score만 크게 강조하지 않음.

## 3. copy summary 기능
`buildBenchmarkSummaryText(parts)` — **순수 결정적 assembler**(LLM 금지)를 `agent-benchmark.mjs`에 추가. UI가 이미 지역화된 라인/라벨을 넘기면 구조·간격·bullet만 고정하고 빈 섹션을 생략 → 복사 텍스트가 UI 언어(EN/KO 토글)를 따름. 형식:
```
Conclave benchmark result

Project: <id>
Benchmark: <title|—>
Recommendation: <winner label | No clear winner>

Candidates:
- <label>: <passed>/<total> passed, <critical> critical issues, <notVerified> not verified, score <score>
...
Why:
- <rationale>
Remaining blockers:
- <winner blockers | noRemainingBlockers>
```
테스트 3개(winner / no-clear-winner=Why 섹션 생략 / 동일입력→동일출력).

## 4. API client / data loading
Stage 65의 `getSavedBenchmark(projectId, benchmarkId, userKey)` 재사용(같은 파일 `lib/workspace-benchmark-api.ts`). detail 로딩 상태: loading / done / not_found(404) / error. candidate가 `pullRequestNumber`·`reviewRunId`를 snapshot에 이미 보유(Stage 65 저장 시 주입) → 추가 fetch 없이 run 링크·PR 번호 표시.

## 5. acceptance set warning 표시
저장된 `result.acceptanceSetAlignment`(Stage 65 서버 계산, snapshot 보관)를 detail에 표시. `aligned:false` → 강조 amber 경고("서로 다른 검수 항목 기준… 주의"). `aligned:true` → 작은 회색 note("같은 검수 항목 기준으로 비교했습니다").

## 6. i18n 추가
`benchmark.*` 확장: detailTitle/detailSubtitle/detailBack/createdLabel/detailCandidates/detailLoading/notFoundDetail/loadErrorDetail/recommendedCandidate/recommendedBody/why/noRemainingBlockers/candidateComparison/colMode/colSource/colRun/openReviewRun/copySummary/copied/sameAcceptanceSet/sourceRuns/scoreNote/summaryHeading/summaryProject/summaryBenchmark/summaryRecommendation/summaryCandidates/summaryCandidateLine. EN/KO·.d.mts, parity 10/10. blocker 그룹·needs-decision 라벨은 `statusLabel(t,…)` 재사용.

## 7. tests / build
- dashboard **98/98**(benchmark-summary 3 신규 + 기존), i18n parity 10/10, typecheck clean, build green(18 routes), lint clean(기존 export 경고만).
- ★ detail render/route-link 레벨 테스트는 이 repo의 node --test 전용(jsdom/RTL 미설치) 환경상 비현실적 → 테스트 가능한 로직(copy-summary assembler + parity)으로 커버하고, 렌더 검증은 라이브로(아래).

## 8. live verification
- dashboard Vercel 재배포 READY.
- `/projects/:id/benchmark/:benchmarkId` **200**, detail 페이지 SSR("Loading the benchmark…", EN 기본) — 404 shell 아님.
- backend `GET detail` 미존재 id → `{"ok":false,"error":"not_found"}` → 페이지 not-found 경로 동작.
- ★ populated detail(실 saved benchmark) + copy summary + EN/KO 토글 육안은 Bae 수동: 실 review run 2개로 `/benchmark`에서 Save → saved list Open → detail. (라이브에 저장된 벤치마크가 아직 없어 empty/contract 검증으로 문서화 — 가짜 성공 없음.)

## 9. 수정한 파일 / 커밋 (`3238b5f`)
- 신규: `app/projects/[id]/benchmark/[benchmarkId]/page.tsx`, `test/benchmark-summary.test.mjs`.
- 수정: `app/projects/[id]/benchmark/page.tsx`(Open 링크 → detail), `lib/agent-benchmark.mjs`·`.d.mts`(buildBenchmarkSummaryText), `i18n/dictionary.mjs`·`.d.mts`(benchmark.* 확장).

## 10. known limitations
- 렌더 레벨 자동 테스트 없음(jsdom/RTL 미도입) — 로직 테스트 + 라이브 육안으로 대체.
- detail의 blocker는 winner 기준 count 그룹(항목 제목 단위 아님 — review run summary가 count만 제공).
- copy summary는 UI 언어 기준 1형식(항목 제목 미포함, count 기반). 
- benchmark rename/delete 없음(이번 단계 제외).
- alignment는 경고만(strict 차단 정책 없음).
- 실 에이전트 실행 없음.

## 11. Stage 67 전 결정 필요한 점
1. **benchmark 관리**: rename/delete 엔드포인트(+UI). 저장본이 쌓이면 필요.
2. **공유 강화**: copy 텍스트 외 공유 링크(읽기 전용 share token)나 PR comment로 붙이기.
3. **acceptance set strict 정책**: 경고→비교 차단 또는 교집합 정규화 비교.
4. **item-level blocker**: run 결과의 항목 제목까지 detail에 노출(현재 count 그룹).
5. (장기) 실 에이전트 실행 연결 — 별도 의사결정.
