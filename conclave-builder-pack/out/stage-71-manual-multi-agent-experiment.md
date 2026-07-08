> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 71 — Manual Multi-Agent Experiment

Conclave 안에서 single-agent vs multi-agent **개발 실험을 계획**하고, 각 에이전트에게 줄 역할별 prompt를 복사한 뒤, 결과 PR들을 benchmark로 비교하는 productized **manual protocol**. 실제 agent 자동 실행 아님. **dashboard 전용**(백엔드/benchmark 저장 로직 무변경).

> 가설: 같은 product brief·acceptance items가 주어졌을 때, 구조화된 multi-agent 워크플로가 single-agent보다 더 잘 합격하는 구현을 만든다.

커밋: `0ecfd8b`. 라이브: `…/projects/:id/experiment`.

## 1. experiment route / 화면 구성
신규 `/projects/:id/experiment`(client). nav Review 그룹에 Experiment. 구성: 헤더+purpose note(실험 vs Fix instructions 구분) → 템플릿 선택(3 카드) → 후보별 prompt 카드(label·role·suggested agent·Copy prompt) + Copy all prompts → workflow guide(6단계) → Open Benchmark 링크(`/projects/:id/benchmark`).

## 2. experiment model / templates
`apps/dashboard/src/lib/agent-experiment.mjs`(+`.d.mts`) 순수. 타입: AgentExperimentMode/Role/Candidate/Plan(Stage 72 persistence 이전 가능하게 구조화). `EXPERIMENT_TEMPLATES` 3종:
- **single_agent_baseline**(single_agent): Single agent builder 1.
- **multi_agent_split**(multi_agent): Builder A(claude_code) + Builder B(codex) — 독립 구현 후 비교.
- **builder_reviewer**(hybrid): Builder(claude_code) + Reviewer(codex) + Fixer(cursor).

이번 단계 DB 저장 불필요(템플릿은 선택 즉시 prompt 생성; localStorage draft도 미사용 — Stage 72에서 persisted experiment로).

## 3. generated prompts (deterministic, LLM 없음)
`buildCandidatePrompt(parts)` 순수 assembler — UI가 지역화 조각 주입(EN/KO 토글 따름). prompt 구조: 역할 지시(roleInstruction with {label}) → `## Project context` → `## Product brief` → `## Acceptance items`(불릿) → `## Constraints`(scope 한정 + 후보별 PR 분리) → `## Expected output`(검수 준비된 PR) → `## Report back`(PR 번호 회신→benchmark 후보). brief/acceptance items는 로컬 프로젝트(productSpec.oneLine/problem·spec.goal, requirements titles)에서 도출. 역할 지시는 spec 톤 그대로(builder/reviewer/fixer/integrator), 재작성 없음.

## 4. copy actions
- 후보별 **Copy prompt**.
- **Copy all prompts** → `buildAllPromptsText` = `# {heading}` + 후보별 `## Candidate: {label}` + prompt. (spec 형식 일치.)

## 5. benchmark 연결
자동 연결은 안 함(이번 scope). UI에서 명확히 안내: "After the agent PRs are reviewed, open Benchmark to compare the candidates." + **Open Benchmark** 버튼 → `/projects/:id/benchmark`. benchmark 저장 로직 무변경.

## 6. i18n 추가
신규 `experiment.*` 네임스페이스(템플릿/후보/역할/agent/prompt 섹션·역할지시·constraints·output·report·workflow 6단계·copy·benchmark 링크) + `nav.experiment`. EN/KO·.d.mts, parity 10/10. agent 라벨은 benchmark.source* 재사용. prompt도 UI 언어 따름(KO 토글→KO prompt).

## 7. tests / build
`test/agent-experiment.test.mjs` 6: 템플릿 3종/mode/candidate 수·roles, getExperimentTemplate, prompt가 brief+모든 acceptance item+역할지시 포함, reviewer 지시 verbatim, copy-all이 모든 후보 포함, **no token/userKey leakage**. dashboard **128/128**, parity 10/10, typecheck clean, build green(19 routes), lint clean(기존 export 경고만).

## 8. live verification
- dashboard 재배포 READY. `/projects/:id/experiment` **200**.
- ★ 데이터 불필요(프로젝트에서 도출) → SSR 풀 렌더 확인: "Manual multi-agent experiment" / "Choose a template" / "Single agent baseline" / "How to run the experiment". 템플릿 선택·Copy·EN/KO 토글 인터랙션은 Bae 육안(클라이언트). 기존 프로젝트 저장 콘텐츠는 생성 시 언어 유지(UI는 토글).

## 9. 수정한 파일 / 커밋 (`0ecfd8b`)
- 신규: `lib/agent-experiment.mjs`·`.d.mts`, `app/projects/[id]/experiment/page.tsx`, `test/agent-experiment.test.mjs`.
- 수정: `components/AppSidebar.tsx`(nav), `i18n/dictionary.mjs`·`.d.mts`.

## 10. known limitations
- experiment plan 미영속(템플릿 선택 시 즉석 생성) — Stage 72에서 persist.
- experiment→PR→review run→benchmark 자동 연결 없음(사람이 수동).
- prompt의 brief/items는 로컬 프로젝트 도출(부분 데이터면 thin). acceptance item 없으면 amber 안내.
- 실제 Claude/Codex/Cursor 실행 없음(수동 복사).

## 11. Stage 72 전 결정 필요한 점
1. **persisted experiment**(central-plane): experiment plan 저장 + candidate PR 연결 추적 → benchmark candidate 자동 후보화.
2. **experiment→benchmark 연결**: 후보 PR의 review run을 benchmark candidate로 원클릭.
3. **prompt 커스터마이즈**: 사용자 편집/추가 constraint.
4. **결과 기록**: experiment outcome(어느 후보 채택) 저장.
5. (장기) 실 에이전트 실행 연결.
