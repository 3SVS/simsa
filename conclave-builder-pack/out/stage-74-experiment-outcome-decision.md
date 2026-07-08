> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 74 — Experiment Outcome Decision

Experiment → Benchmark 이후 사용자가 **어떤 candidate를 채택/거절/수정 대상으로 판단했는지** 기록·재방문하는 decision layer. Conclave는 결과만 비교하지 않고 **수락 결정을 내리고 기록**하도록 돕는다.

커밋: `31327c6`. 라이브: `…/projects/:id/experiment` Decision.

## 1. decision data model / migration
migration `0043_experiment_decision.sql`:
- candidate: `outcome`·`outcome_note`·`decided_at`(nullable).
- experiment: `decision_status`·`selected_candidate_id`·`decision_note`·`decided_at`(nullable).
구버전 행은 undecided. db 타입/매퍼/SELECT에 반영, `updateCandidateOutcome`·`updateExperimentDecision` helper 추가.

## 2. decision API endpoint
`POST /workspace/projects/:id/agent-experiments/:experimentId/decision`. body: `{userKey, selectedCandidateId?, candidateOutcomes:[{candidateId,outcome,note?}], decisionStatus, decisionNote?}`. GET detail 응답에 decision 필드 + candidate outcome 포함.

## 3. candidate outcome/status behavior (server-enforced)
검증: userKey · experiment 소유 · candidateOutcome.candidateId가 experiment 소속 · outcome enum(selected/rejected/needs_fix/undecided) · **selected 최대 1개** · selectedCandidateId 주어지면 selected outcome과 일치 · decisionStatus allowlist(undecided/selected/needs_fix/no_clear_winner) · note ≤ 1000자.
동작: candidate outcome+status 갱신(selected/rejected/needs_fix; undecided는 status 유지) + decided_at. experiment status: selected→`completed`, needs_fix/no_clear_winner→`decision_made`, undecided→유지. decision 요약 저장.

## 4. dashboard decision UI
experiment detail에 **Decision** 섹션: 후보별 3버튼(Select as winner/Needs fixes/Reject, 단일 winner는 다른 winner 자동 해제) + 후보 메모 + experiment Decision note + **Save decision**. benchmark 있으면 "Use benchmark evidence…", 없으면 amber "Create a benchmark before making a final decision."(hard-block 아님). 순수 `buildExperimentDecision`(single-winner·decisionStatus 도출·undecided drop)로 payload 생성.

## 5. benchmark detail integration
benchmark에 `sourceExperimentId` 있으면 상단 **"Ready to decide?"** callout + **Record decision** → `/projects/:id/experiment?experiment=<id>`(자동 open). 기존 Source experiment 링크와 함께 결정 흐름 강조.

## 6. i18n 추가
`experiment.*`(decision/decisionDesc/selectAsWinner/needsFixes/reject/decisionNoteLabel/candidateNotePlaceholder/saveDecision/decisionSaved/createBenchmarkFirst/useBenchmarkEvidence/statSelected/statRejected/statNeedsFix/statUndecided/statCompleted/statDecisionMade) + `benchmark.*`(readyToDecide/readyToDecideDesc/recordDecision). EN/KO·.d.mts, parity 10/10.

## 7. tests / build
- central-plane decision 9: select winner→completed+candidate status, needs_fix→decision_made, missing userKey, other user 403, unknown candidate, multiple selected, selected_mismatch, note_too_long, invalid_decision_status. → 전체 **992/992**.
- dashboard buildExperimentDecision 3(one selected→selected, needs_fix only, all undecided) → **135/135**. parity 10/10.
- repo typecheck **54/54**, build green(19 routes), lint clean(기존 export 경고만).

## 8. live verification
- push → deploy-central-plane(**migration 0043 적용✓**·Worker✓·smoke✓). dashboard 재배포 READY.
- ★ **populated 라운드트립**(가짜 아님): create → POST decision(b selected/a rejected)→experiment `completed`·decisionStatus `selected` → GET detail 영속(candidate a rejected·b selected) → multiple selected→`multiple_selected`. dashboard `/experiment` 라이브.
- 결정 UI 클릭/EN-KO 토글 육안은 Bae(클라이언트).

## 9. 수정한 파일 / 커밋 (`31327c6`)
- central: migration 0043 · `agent-experiment-db.ts`(decision 필드+helper) · `routes/workspace-experiment.ts`(decision endpoint+GET 확장) · test.
- dashboard: `lib/agent-experiment.mjs`·`.d.mts`(buildExperimentDecision) · `lib/workspace-experiment-api.ts`(saveExperimentDecision+타입) · `experiment/page.tsx`(DecisionSection) · `benchmark/[benchmarkId]/page.tsx`(Ready to decide callout) · `i18n/*` · test.

## 10. known limitations
- experiment status 전이는 draft/benchmarked/completed/decision_made만(running/reviewing/archived 미사용).
- decision은 benchmark 없이도 가능(경고만, hard-block 아님).
- candidate note는 별도 입력(300자); experiment note 1000자.
- decision을 copy summary/PR comment에 미포함(이번 scope 제외).
- merge/close PR 자동화 없음 · 실 에이전트 실행 없음.

## 11. Stage 75 전 결정 필요한 점
1. **decision → next action**: selected 후보의 남은 blocker로 Fix instructions/Experiment 재실행 연결.
2. **decision 이력**: 재결정 시 이전 결정 보존(현재 덮어쓰기).
3. **decision을 PR comment/copy에 반영**(옵트인).
4. **experiment status 전체 전이**(running/reviewing/archived) + 필터.
5. (장기) 실 에이전트 실행 연결.
