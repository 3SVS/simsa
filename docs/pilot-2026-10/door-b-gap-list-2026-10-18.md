# 문 (b) 격차 목록 — 재현성 수리 2단계 (2026-10-18)

> HANDOFF `docs/HANDOFF-2026-10-18.md` §3 2단계 산출물. 조사: simsa-diagnose(Fable·high, 코드 수정 0, 벤치 미실행, LLM 호출 0) · 코드 기준 main `2602b43`(#602) = 프로덕션 배포본(deploy-central-plane 2026-10-06 05:28 UTC 성공, Actions 이력).
> 정렬은 Bae 지시(2026-10-18): **① 질문 동일성 결함 → ② maxTokens 결함 → ③ 판정 결함** 순. 근거 없는 추정은 [추정].
> 1단계 로컬 3회 재측정 숫자는 `bench1-local-repeat3-2026-10-18.md`(측정 에이전트 산출)에 있고, 이 문서 §4에 요약을 옮긴다.

## 0. 문 (b) 완료 증거 ①~④ — 지금 무엇이 막는가

| 증거 | 막는 것 | 위치 |
|---|---|---|
| ① 파일럿 (b) ≥2/3 `as_intended`, 그중 1건 운영자 개입 0 | 외부: 실유저 0(door-done). 코드: `user_verdict` 쓰기 경로는 있음 → 막는 코드 없음. 단 **"운영자 개입 0"을 기록할 컬럼이 없어 측정 불가** [추정: 개입 플래그 필요]. 고침 경로는 GitHub 연결 필수이고, 단일파일 고침(B5)은 **프로덕션에서 항상 실패**(§2) | `routes/workspace-visual-check-runs.ts:409` · `workspace/visual-check-db.ts:459` · `migrations/0050_workspace_visual_checks.sql:8` · `workspace-repair-jobs.ts:388-390` |
| ② 첫 판정 vs 정답지 일치 | §1(질문이 런마다 다르고 정답지 조건을 애초에 안 덮음) · §3(판정 결함) · §4 장비(불일치를 못 잼) | 아래 |
| ③ 못 본 곳 표기, 거짓 통과 0 | 표기 코드는 있음(loginNote/notVerifiedNote/scope public). 결함: `finalizeJudge`가 **fail만** 로그인 벽에서 걸러내고 pass는 LLM이 `scope:"public"`을 자진 표기할 때만 제한 → 로그인 벽 앞 pass가 전체 통과로 남을 수 있음(§3-9). "거짓 통과 0" 측정 장비 없음 | `workspace/inspection-agent.ts:787,928,930,455,681` · `:420-457` |
| ④ journey-audit J1 P0=P1=0 | 10-04 미추적 결과 J1 ko/en P0=0·P1=0(P2 1). 그러나 #596~#602 이후 **재실행 없음·커밋 안 됨** → 현 코드 기준 미측정 | `tools/simsa-completion-loop-spike/journey-audit-result.json`(미추적 수정본) |

## 1. ① 질문 동일성 결함 — 같은 앱에 세 번 다른 질문을 한다

HANDOFF §3-3 추가 항목: "①이 깨진 상태에서 ②(판정 동일성)를 측정하면 숫자가 의미 없다. 수정 순서 ① 먼저."

### 1-1. AC 추출 3단 LLM에 temperature/seed 고정이 없고, AC id·제목·순서가 런마다 다르다
- 근거: `workspace/anthropic-fetch.ts:626-634`(body 그대로 전송) · `:393-397`(OpenAI 폴백 body도 model/max_completion_tokens/messages뿐) · `routes/inspect-llm-proxy.ts:94-102` · 로컬 하네스 `tools/simsa-inspection-fixtures/agent-bench1-local.mjs:101-109`. 경로: infer-intent(`source-evidence` → `generate.ts`) → "맞나요?" 흉내(하네스 LLM) → `generate-dev-spec.ts` → `acceptance-plan.ts agentAcsFromDevSpec`. 전수검색 `rg "temperature|top_p|seed:" apps/central-plane/src apps/central-plane/inspector-container tools/simsa-inspection-fixtures` → 제품 경로 0곳(빌드 프록시 스키마 `build-llm-proxy.ts:162,202`만).
- 데이터: 같은 앱 AC 제목이 로컬 run2/run3/run4/프로덕션 3차 모두 다름(예: gemini AC-001~010 전부 재배열). AC-xxx id는 LLM이 매기므로 `compareAgentRuns`(`inspection-agent.ts:1366`)식 id 비교는 재검수(`source_run`) 외엔 무의미.
- 영향: ② — "판정 불일치"의 비교 자체가 성립하지 않음.
- 수정안(HANDOFF 확정): **벤치·지수** = 정답지 must 목록을 AC로 **주입**(LLM 추출 우회) / **제품** = 프로젝트 버전당 AC 1회 추출 후 **고정(캐시)**, 재검수는 같은 AC, 재추출은 사용자가 "기획을 바꿨다"고 명시한 때만(차이 기록·이전 판정 이력 보존). 재검수 경로의 `sourceCheckId`(`workspace-visual-check-runs.ts:207-208` → `acsFromAgentReport`)가 이미 같은 AC를 재사용하므로 "고정"의 토대는 있음. 하네스엔 `sourceCheckId` 사용 0곳.
- 옛 코드에서 실패할 테스트: 같은 프로젝트 버전에 run 2회 → AC id·제목·순서 동일(옛 코드: LLM 호출 2회, 결정론 없음).

### 1-2. AC 10개 상한 절단이 사용자가 직접 적은 항목을 체계적으로 잘라낸다 → 정답지 must 커버리지 상한 5/13
- 근거: `acceptance-plan.ts:93-112`(spec.acceptance 순서대로 push → `orderAcs(out,10)` 안정 정렬 후 slice) · `generate-dev-spec.ts:200-212 planInferredConfirmation`(체크한 추론 항목 FR-001~이 먼저, 사용자가 적은 `user_N`은 뒤 FR) · 하네스 `agent-bench1-local.mjs:204-205` · `agent-run.mjs:178`(CORE-1 추가 후 min(11, caps)).
- 데이터(정답지 키워드로 AC 목록 자체 대조): 프로덕션 3차 — chatgpt 기대 A3~A7 중 목록이 덮는 것 A4,A5 / gemini A3만 / v0 없음 / bolt A6 / claude A3만 → **상한 5/13**(실제 짚음 4/13). 로컬 run2~4는 A3~A6 덮음(상한 10/13), **A7(취소)은 4개 런 전부 0**. prod `run.acCount:10`인데 acTable에 AC-011/012 → 절단 확정. prod는 기능당 AC 2개 중복(날짜 선택×2, 시간 선택×2)으로 슬롯 소모.
- 영향: ② — 짚음 31%의 **첫째 원인은 판정이 아니라 질문 누락**.
- 수정안(HANDOFF 확정): 사용자 작성 항목 우선(`user_text` > `user_checked` > `inferred`) + 기능당 첫 AC 라운드로빈 + **상한 상향**. 전수검색 `rg "orderAcs\(|AGENT_MAX_ACS|maxAcs"` → 7곳(`inspection-agent.ts:148,1357,1491` · `acceptance-plan.ts:12,112` · `agent-run.mjs:95,169,178` · `entitlements.ts:55-107` · `workspace-visual-check-runs.ts:325`) — 상한 상향 시 티어 상한(`entitlements.ts`)과 함께 본다.
- 옛 코드에서 실패할 테스트: inferred devSpec, FR-001~006(user_checked, AC 2개씩)+FR-007~010(user_text, AC 1개씩) → 옛 코드 반환 10개 중 user_text AC 0개; 기대 user_text 4개 전부 포함.

### 1-3. 프로덕션 infer-intent는 정적 HTML만 읽어(SPA 껍데기 10~87자) 로컬/프로덕션 AC 분포가 다르다
- 근거: `workspace-sources.ts:207-209` → `source-evidence.ts:391-423`; 로컬 하네스 `agent-bench1-local.mjs:182-190`은 렌더 본문으로 보충. 데이터 staticEvidenceChars: chatgpt 48 · gemini 10 · v0 87 · bolt 11 · claude 58 · lovable 59(전 앱 rendered=true). prod 추론 항목 9개가 "날짜/시간/정보 입력" 일반문.
- 영향: ② — 로컬 결과가 프로덕션에서 재현 안 됨. 수정안: M 프로덕션 infer-intent에 렌더 텍스트 보충(컨테이너 경유) / S 단기: 두 하네스 입력 동일화. AC 주입(1-1)이 들어가면 벤치에서는 이 차이가 사라진다.

### 1-4. 벤치 장비가 "3회 불일치"를 못 잰다
- 근거: 로컬 하네스 `--repeat` 없음(`rg repeat agent-bench1-local.mjs` 0곳)·결과 파일 덮어씀(`:307`); `agent-bench1.mjs:128-137 aggregate`는 평균·최소·최대만 — 앱×기준 판정 벡터·불일치 수·AC 목록 동일성 없음; `CONDITION_KEYWORDS:62-70` A4 `/완료/`가 관대(짚음 % 과대).
- 영향: ② — HANDOFF 3단계 통과 기준 자체를 측정할 수 없음.
- 수정안: 로컬 `--repeat` + 시각 파일, aggregate에 **AC 목록 동일성(질문 동일성)** + 앱×조건(A1~A7) 판정 벡터 + 런 간 불일치 수. 옛 코드에서 실패할 테스트: `aggregate`에 `disagreements`·`acListIdentical` 필드(옛 코드 undefined).

## 2. ② maxTokens 결함 — 프로덕션 단일파일 고침(B5)은 항상 400

- 근거: `inspector-container/agent-run.mjs:291`(`callLlm(…, 4000)`) vs `routes/inspect-llm-proxy.ts:35,43`(`INSPECT_LLM_MAX_OUTPUT_TOKENS = 2048`, Zod `.max()` → `:81` 400 invalid_request) · `agent-llm.mjs:25-26`(4xx 즉시 throw) → `agent-run.mjs:233` `{attempted, error}`. 로컬 하네스는 프록시를 거치지 않아 성공 → 로컬/프로덕션 결과가 갈린 또 하나의 이유.
- 영향: ① 고침 경로(비개발자 (b)가 받을 수 있는 유일한 자동 고침이 단일파일 앱). 측정과 무관한 확정 결함이라 **첫 PR**.
- 전수검색 `rg "callLlm\("` agent-run.mjs → 168(강, 1500) · **291(강, 4000)** · 388 · 401 · 459(강, 300); `agent-llm.mjs:7` 기본 700. 상한을 넘는 곳은 291 한 곳.
- 옛 코드에서 실패할 테스트: (a) 프록시 라우트에 `maxTokens: 4000` → 옛 코드 400; (b) 실행기 B5 호출의 maxTokens ≤ `INSPECT_LLM_MAX_OUTPUT_TOKENS`(두 숫자를 한 테스트로 묶어 어느 쪽을 바꿔도 다시 어긋나지 못하게).

## 3. ③ 판정 동일성 결함 (같은 AC에 같은 판정이 안 나오는 원인)

| # | 결함 | 분류 | 근거 | 수정안 | 옛 코드에서 실패할 테스트 |
|---|---|---|---|---|---|
| 3-1 | H1 사후검사 `failReasonIsOutcome`가 "결과가 틀림" 류를 strongOutcome에 안 넣어, 구조 단어(순서·먼저 보·배치)가 섞인 진짜 실패를 `ui_interpretation`으로 버림 — 정답지 A6(관리 목록 시간순·UTC)·A7(취소)이 정확히 이 모양 | H1류 | `inspection-agent.ts:337-344`; 프로브: "오늘 예약 목록이 시간 순서대로 정렬되지 않고 틀린 순서로"→false, "어제 날짜의 예약이 먼저 보입니다(UTC)"→false, "취소 버튼을 눌러도 … 삭제되지 않습니다"→false. 프롬프트 2a(`:1105`)는 "shows a wrong result"를 fail로 허용 → 프롬프트와 사후검사 불일치. 호출 경로는 `agent-run.mjs:448` 1곳, 모든 fail 경로가 `runOneAc` 경유 | S: strongOutcome에 `틀리|잘못|다른 (날짜|시간|값)|정렬되지|삭제되지|어제|UTC|wrong|incorrect|not (sorted|deleted|removed)` 추가, 또는 구조 패턴을 "결과 동사가 전혀 없을 때만"으로 좁힘 | 위 4문장 → true(옛 false), run3 거짓 실패 3문장 → 여전히 false |
| 3-2 | 판정 LLM 호출에 temperature/seed 없음 + 재확인(judge review)은 strong 1회 호출로 전송·파싱 실패("no answer")까지 disagree로 셈 → `judge_disagreed`가 런마다 흔들림 | 기타(LLM 비결정성)+재확인 설계 | `agent-run.mjs:455-474`(review null → disagree, `:465-467` catch→null); 데이터: CORE-1이 claude fail→NV→fail, chatgpt fail→NV→fail(run2→3→4); prod3 CORE-1 judge_disagreed 4/6앱 | S: 프록시·로컬 둘 다 서버 고정 `temperature:0`(OpenAI 폴백 `seed`까지), 요청에서 못 바꾸게 / S: review 전송·파싱 실패는 1회 재시도 후 원 판정 유지+note / M: must 재확인 2표 다수결 | 가짜 llm이 review 호출만 throw → 옛 `judge_disagreed`; 기대 원 판정 유지(또는 `review_unavailable`) |
| 3-3 | 시험 데이터·앱 상태가 런마다 다르고 누적(이름 '심사테스트' 고정, 번호 `Date.now`, 이전 런 예약이 앱에 남음; `ownsRecordNear`는 이름 표지만 봐 이전 런 기록도 '내 것'); 동시 2 + 컨테이너 basic 자원 경합 → `fill` 8초 타임아웃 오판 | 기타(앱 상태·자원) | `agent-run.mjs:188`, `inspection-agent.ts:1069-1081`, `agent-driver.mjs:466-478`, `:17,266`; 로컬 결과 §4.5 "Lovable은 run-2 뒤 시간대가 대부분 마감" | S: 벤치가 seed와 런 표지(심사테스트-r1)를 인자로 넘김 / S: 재측정은 동시 1 / M: 런 끝에 자기 기록 취소 또는 앱 재배포 스냅샷 | 하네스가 seed를 넘기면 testData.phone이 3회 동일(옛 하네스는 넘길 길 없음) |
| 3-4 | H3·G1·시계변형이 모두 '남은 시간' 게이트 → 앞 기준이 오래 걸리면 뒤 must의 재현·변형·should 실행이 바뀜. 특히 재현 못 받은 must fail은 그대로 fail | H3류 | `agent-run.mjs:192-201`(40%·20s) · `:206`(`timeLeft()>60_000` 아니면 재현 없이 fail 유지) · `:216`(90s) · `:232`(120s) · `:182` sweep 30%; `server.mjs:343` 13분; 전수 `rg "timeLeft\(\)"` → 6곳 | S: 재현 못 돌린 fail은 `not_verified`(사유 `repro_skipped_budget`) / M: 시간 게이트 대신 행동 상한만, must 수를 예산에 맞게 먼저 자름(≤6) | budgetMs 작게 + must fail 대본 → 옛 fail, 기대 not_verified |
| 3-5 | H2 자동 탐침·verified는 `fill→click`에서만 발화 — Enter 제출·select만 쓰는 앱이면 stateChange=false → CORE-1 `core_goal_not_exercised`/Not Verified | H2류 | `agent-run.mjs:525-543`(`a.type==="click" && filled`), press 경로 없음; `inspection-agent.ts:675-679`; `rg stateChange` → click 이외 경로 0 | S: press Enter·폼 제출(서버 write 발생 또는 URL 변화)도 상태 변화로 인정 | fill→press Enter→new_session 대본 → 옛 exercised.stateChange=false |
| 3-6 | 시계 변형이 거의 모든 must에 발화(given에 '시간'만 있어도), 변형 실패는 G1 재현을 거치지 않고 fail로 승격 | H1류/H3류 | `inspection-agent.ts:1293-1297`(프로브: "예약자 정보 입력"=true), `:1309-1320`; 순서 `agent-run.mjs:206`(재현) → `:216`(변형) | S: 변형 대상을 CORE-1 + then에 날짜·오늘·목록이 있는 must로 좁히고 변형 fail도 재현 요구 | 변형 1회 fail·재현 pass → 옛 fail, 기대 not_verified |
| 3-7 | `looksLikeInputValidation`이 진짜 결함을 `input_rejected`로 버림 | H1류(과교정) | `inspection-agent.ts:351-353`, `agent-run.mjs:434-441`; 프로브 "이름을 입력했는데도 '이름을 입력하세요'가 계속 떠서 예약이 안 됩니다"→true(→NV) | S: 2회 고친 뒤 같은 메시지면 재현 런으로 넘겨 fail 후보 유지 | 위 문장+재현 fail → 옛 input_rejected |
| 3-8 | H3 범위 밖 강한 모델 호출: F5 승격이 **should 기준에도** 적용(priority 검사 없음, 기준당 최대 3+1회) · 시계 변형 런 전체 · B5 · AC 추정 | H3류 | `agent-run.mjs:556-575` · `:216` · `:291` · `:168`; 재현 런 턴 전부 strong(`:387`)은 설계대로 | S: F5 승격을 must로 제한 | should 기준에서 strong 턴 0 |
| 3-9 | 로그인 벽 앞 pass에 scope 강제 없음 → 완료 증거 ③ 거짓 통과 통로 | 기타 | `inspection-agent.ts:420-457`(fail만 gate 처리) | S: `loginGate && !hasCredentials && pass → scope:"public"` | gate=password에서 pass 판정 → 옛 scope 없음 |

## 4. 1단계 로컬 3회 재측정 요약 (측정 에이전트 결과를 옮긴다)

기준선(옛 하네스 = 추론 경로, 코드 2602b43, LLM = OpenAI 폴백 gpt-5.4/gpt-5.4-mini, 동시 2, 로컬 Playwright). 정본 `bench1-local-repeat3-2026-10-18.md`, 원자료 `tools/simsa-inspection-fixtures/agent-bench1-local-result-2026-10-18-r{1,2,3}.json`.

| 지표 | r1 | r2 | r3 | 평균 |
|---|---|---|---|---|
| 반대 판정 | 0 | 0 | 0 | 0 |
| 앱 일치 | 5/6 | 4/6 | 4/6 | 4.33/6 |
| must 짚음 | 1/13 | 0/13 | 2/13 | **1.0/13 (8%)** |
| 런 비용(generation+agent) | $3.19 | $3.33 | $3.18 | $3.23 |
| LLM 호출 | 579 | 600 | 608 | — |

**두 층:** ① 질문 동일성 — **0/6 앱**(CORE-1만 제목이 3회 같고, `AC-nnn`은 같은 id여도 제목·내용이 다름; id 목록 자체가 다른 앱 5/6). 71셀(앱×id) 중 비교 가능 7셀(CORE-1 6 + chatgpt AC-002 1). ② 판정 동일성 — 비교 가능 7셀 중 불일치 1(claude CORE-1: not_verified·not_verified·fail), 앱 최종 판정 불일치 **3/6**(chatgpt·v0·claude, 전부 Needs Fix ↔ Not Verified).

해석: 이 숫자는 "판정이 흔들린다"보다 "**질문이 매번 다르다**"를 먼저 말한다(§1-1 실측 확인). must 짚음 8%는 프로덕션 3차 31%보다 낮은데, 로컬 하네스는 프로덕션과 다른 점이 둘 있다 — 렌더 본문으로 추론을 보충(§1-3)하고 티어 caps 없이 돈다(maxActions 기본 1000, 호출 ~600/런·$3.2/런 vs 프로덕션 ~150~180회·$0.54~0.70) — 그래서 비용·짚음은 프로덕션 숫자와 직접 비교하지 않는다. 다음 측정은 PR2 하네스(`--acs=prereg --repeat=3`)로 질문을 고정하고 잰다.

## 5. 3단계 PR 순서 (Bae 2026-10-18)

| 순서 | PR | 격차 | 통과 기준 |
|---|---|---|---|
| 1 | B5 maxTokens 4000 > 프록시 2048 | §2 | 옛 코드 실패 테스트 (a)(b) green · 전수검색 결과 커밋 메시지에 |
| 2 | 벤치 AC 주입(정답지 must → AC) + 로컬 `--repeat` + aggregate에 AC 목록 동일성·앱×조건 판정 벡터·불일치 수 | §1-1(벤치 측), §1-4 | 로컬 `--repeat=3`에서 **질문 동일성 3/3** |
| 3 | 제품 AC 고정(캐시) + 10개 상한 사용자 작성 우선·상향 + 재추출은 "기획을 바꿨다" 명시 시에만(차이 기록·이력 보존) | §1-1(제품 측), §1-2 | 같은 프로젝트 버전 run 2회 AC 동일 · user_text AC 전부 포함 |
| 4~ | 판정 결함 §3 — 한 PR = 한 격차, 영향 큰 순(3-1 → 3-2 → 3-4 → 3-5 → 3-6 → 3-3 → 3-7 → 3-8 → 3-9) | §3 | 로컬 `--repeat=3`에서 판정 동일성 + must 짚음 > 31% + 런당 ≤ $0.30 |

HANDOFF §3-3 통과 기준은 그대로: 셋 중 하나라도 빠지면 "완료"라 쓰지 않는다.

## 6. PR3(제품 AC 고정) 설계 조사 요약 (simsa-diagnose, 2026-10-18 — 코드 변경 0)

**핵심:** "캐시"는 이미 있다 — `workspace_projects.dev_spec_json`. 제품 런의 AC는 LLM이 아니라 `agentAcsFromDevSpec`(순수·결정론, `src/acceptance-plan.ts:93-112`)이 저장된 지시서에서 뽑고(`routes/workspace-visual-check-runs.ts:792 → :202-212`), 지시서는 `POST /dev-spec/generate`(`routes/workspace-dev-spec.ts:182-302`, `:295-299` UPDATE)가 불릴 때만 바뀐다. 프로젝트 재저장(`routes/workspace.ts:374-487 → db.ts:115-135 upsert`)은 `dev_spec_json`을 건드리지 않는다. **마이그레이션 불필요.**

제품에서 AC가 달라지는 경로(전수 5): ① 첫 런은 지시서 이전(제출 즉시 런, `app/projects/new/page.tsx:489`·`components/AppAddressStart.tsx:117` → 컨테이너 LLM 추정 `inferred_at_run`) — 설계상 첫 런≠둘째 런 ② 재생성 트리거 3곳: 카드 확정 `intent-ruler.ts:21-31` · 인터뷰 답 반영 `InterviewPackCard.tsx:137` · 지시서 화면 "다시 만들기" `dev-spec/page.tsx:97-131` ③ **[결함] 재검수가 11번째 AC를 잃음** — 컨테이너는 CORE-1 포함 11개(`agent-run.mjs:178`, pro/staff `entitlements.ts:95·107 maxAcs:11`)를 돌리는데 `acsFromAgentReport`가 `slice(0, 10)`(`agent-inspection.ts:1491`) ④ 티어 절단(free 5 / basic 8, `entitlements.ts:71·83`) — 응답 `acCount`(`:855`)는 실행 수가 아님 ⑤ [추정] CORE-1 문구는 `intent`를 품어 검수 화면에서 intent를 바꾸면 문구만 달라짐(id 고정).

| 후보 | 마이그레이션 | HANDOFF §4 저촉 | 되돌리기 |
|---|---|---|---|
| **A. 컬럼 0 — 재생성 게이트 + 결정론 결함 수리 + 사용자 우선 정렬 (추천)** | 없음 | 없음 | 게이트 1함수 제거 |
| B. `agent_acs_json` 컬럼 | 필요 | 소지(AC 2번째 정본) | 어려움 |
| C. `workspace_dev_spec_versions` 표(전문 이력) | 필요 | 없음 | 표만 남음 — PR4+ 후보 |

**A 설계:** S1 generate 라우트에 `reason?: "plan_changed"` — 지시서가 있고 reason 없으면 **409 `dev_spec_exists`**(LLM 0회·일일 몫 0); `plan_changed`면 `diffAcs(prev,next)`(id가 아니라 정규화한 제목+then으로 대응)를 응답에 + usage event `workspace_dev_spec_regenerated`(개수·시각만) · S2 `acsFromAgentReport` slice `+1`, `agent-run.mjs:95` 같은 상한 · S3 `agentAcsFromDevSpec` 정렬 키 = priority → origin(`user_text > user_checked > spec > inferred`, `acceptance-plan.ts:108`에 이미 있음) → 기능별 n번째 라운드로빈 → 저장 순서; 풀 `AGENT_MAX_ACS` 10→16, 티어 실행 수는 유지(비용 ≤ $0.30 지키기 — AC당 한계비용 [추정] ≈ $0.03) · S4 재검수 source_run 우선 그대로(`verify-sweep.ts:186` 자동 일치) · S5 대시보드 "다시 만들기" → "기획을 바꿨어요 — 기준 다시 뽑기"(확인 단계 + 이전 기준 N개·지난 결과 보존 카피), 409 → "이미 있어요". 이력: 런마다 `agent.acs`+`acTable`이 `report_json`에 남고 30일 스윕은 근거만 걷는다(`evidence-retention.ts:17-40`) — 재생성이 지난 런을 건드리는 경로 없음.

옛 코드에서 실패할 테스트: ① 정렬(user_text 4개 전부 포함, 확인 기능 10개 모두 AC ≥1 — 옛 0개) ② `acsFromAgentReport` 11 → 옛 10 ③ generate 지시서 있음+reason 없음 → 옛 200·LLM 3회, 새 409·LLM 0 ④ `plan_changed` → `diff`+usage event ⑤ `diffAcs` 제목+then 대응 ⑥ (회귀 잠금) 같은 spec run 2회 payload AC 동일.

**열린 질문(Bae):** Q1 인터뷰 답 반영을 "기획 변경" 명시로 보고 자동 `plan_changed` 동봉할지(권고: 예) · Q2 티어 실행 수(pro/staff 11) 상향 여부(권고: 풀만 16, 실행 수 유지) · Q3 기획 변경 뒤 옛 런의 "다시 확인"은 옛 AC 유지+안내(권고, 현 코드 규칙 그대로) vs 새 AC 전환 · Q4 전문 버전 이력(C)은 PR4+로 미룸(권고).
