# 벤치 #1 로컬 하네스 3회 반복 — 판정 불일치 집계 (2026-10-18)

> **로컬 실행(브랜치 코드 2602b43) — 프로덕션 아님, LLM 경로=OpenAI 폴백** (ANTHROPIC 키 없음 → preferFallback; 결과 모델 gpt-5.4 / gpt-5.4-mini). 하네스 `tools/simsa-inspection-fixtures/agent-bench1-local.mjs --concurrency=2`를 순차 3회 수동 실행(로컬 하네스엔 `--repeat`가 없음). 원본: `tools/simsa-inspection-fixtures/agent-bench1-local-result-2026-10-18-r{1,2,3}.json`(+`.stdout.txt`). 실행 시각(KST) r1 22:00~22:20 · r2 22:20~22:40 · r3 22:40~22:59. 기존 결과 파일은 `agent-bench1-local-result-prev-20261007-0129.json`으로 보존.

## 1. 런별 요약

| 지표 | r1 | r2 | r3 | 평균/최소/최대 |
|---|---|---|---|---|
| 반대 판정 | 0 | 0 | 0 | 0.00 / 0.00 / 0.00 |
| 앱 일치(/6) | 5/6 | 4/6 | 4/6 | 4.33 / 4.00 / 5.00 |
| must 짚음(/13) | 1/13 | 0/13 | 2/13 | 1.00 / 0.00 / 2.00 |
| 런 비용 USD(summary.totalCostUsd) | 3.1918 | 3.3253 | 3.1764 | 3.23 / 3.18 / 3.33 |
| 런 비용 USD(앱별 generation+agent 합, 검산) | 3.1918 | 3.3253 | 3.1764 | 3.23 / 3.18 / 3.33 |
| 　generation 합 | 1.2364 | 1.2800 | 1.2348 | 1.25 / 1.23 / 1.28 |
| 　agent 합 | 1.9554 | 2.0453 | 1.9416 | 1.98 / 1.94 / 2.05 |
| 앱별 소요 합(초, 병렬 2라 벽시계보다 큼) | 2133 | 2272 | 2142 | 2182.33 / 2133.00 / 2272.00 |
| LLM 호출 합 | 579 | 600 | 608 | 595.67 / 579.00 / 608.00 |

모델별 비용(costByModel/llmCallsByModel)은 이 결과 파일에 **없다**(앱별 `models` 배열에 gpt-5.4, gpt-5.4-mini 이름만; 비용은 generation/agent 구분만) → 모델별 비용 **미측정**.

## 2. 앱 단위 최종 판정 (decision)

| 앱 | 기대 | r1 | r2 | r3 | 불일치? | 앱별 AC 수 |
|---|---|---|---|---|---|---|
| chatgpt | broken | Needs Fix | Not Verified | Not Verified | **예** | 11/11/11 |
| gemini | broken_or_hold | Not Verified | Not Verified | Not Verified | 아니오 | 11/11/11 |
| v0 | broken_or_hold | Needs Fix | Not Verified | Not Verified | **예** | 11/11/11 |
| bolt | broken_or_hold | Not Verified | Not Verified | Not Verified | 아니오 | 11/11/11 |
| claude | broken_or_hold | Not Verified | Not Verified | Needs Fix | **예** | 11/11/11 |
| lovable | works | Not Verified | Not Verified | Not Verified | 아니오 | 11/11/11 |

앱 단위 판정 불일치: **3/6**.

## 3. 기준(AC)별 3회 판정 표

AC 매칭 키=id. 목록·제목이 3회 같지 않으면 "비교 불가"(id가 같아도 제목이 다르면 비교 불가로 표시하고 실제 내용을 적음). 각 AC는 LLM이 역추론 지시서에서 새로 생성하므로 런마다 id/제목이 바뀔 수 있다.

### chatgpt

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-007,AC-008,AC-009,AC-010,AC-011] r2=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-007,AC-008,AC-009,AC-010,AC-011] r3=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] → id목록 **다름**, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | not_verified | 일치 |
| AC-001 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-002 예약 날짜 선택 | not_verified | not_verified | not_verified | 일치 |
| AC-003 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-004 (제목 상이) | pass | pass | not_verified | 비교 불가 |
| AC-005 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-007 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-008 (제목 상이) | fail | not_verified | not_verified | 비교 불가 |
| AC-009 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-010 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-011 (제목 상이) | not_verified | not_verified | (없음) | 비교 불가 |
| AC-006 (제목 상이) | (없음) | (없음) | not_verified | 비교 불가 |

### gemini

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r2=[CORE-1,AC-001,AC-002,AC-003,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010,AC-012] r3=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] → id목록 **다름**, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | not_verified | 일치 |
| AC-001 (제목 상이) | not_verified | pass | pass | 비교 불가 |
| AC-002 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-003 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-004 (제목 상이) | pass | (없음) | pass | 비교 불가 |
| AC-005 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-006 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-007 (제목 상이) | pass | not_verified | pass | 비교 불가 |
| AC-008 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-009 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-010 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-012 (제목 상이) | (없음) | pass | (없음) | 비교 불가 |

### v0

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r2=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r3=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] → id목록 동일, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | not_verified | 일치 |
| AC-001 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-002 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-003 (제목 상이) | not_verified | pass | pass | 비교 불가 |
| AC-004 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-005 (제목 상이) | pass | pass | not_verified | 비교 불가 |
| AC-006 (제목 상이) | pass | not_verified | pass | 비교 불가 |
| AC-007 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-008 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-009 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-010 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |

### bolt

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r2=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-007,AC-008,AC-009,AC-010,AC-011] r3=[CORE-1,AC-001,AC-002,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010,AC-011] → id목록 **다름**, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | not_verified | 일치 |
| AC-001 (제목 상이) | pass | pass | not_verified | 비교 불가 |
| AC-002 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-003 (제목 상이) | not_verified | not_verified | (없음) | 비교 불가 |
| AC-004 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-005 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-006 (제목 상이) | not_verified | (없음) | not_verified | 비교 불가 |
| AC-007 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-008 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-009 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-010 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-011 (제목 상이) | (없음) | not_verified | pass | 비교 불가 |

### claude

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r2=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-010,AC-011] r3=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] → id목록 **다름**, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | fail | **불일치** |
| AC-001 (제목 상이) | pass | pass | not_verified | 비교 불가 |
| AC-002 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-003 (제목 상이) | not_verified | pass | pass | 비교 불가 |
| AC-004 (제목 상이) | not_verified | pass | pass | 비교 불가 |
| AC-005 (제목 상이) | not_verified | not_verified | pass | 비교 불가 |
| AC-006 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-007 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-008 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-009 (제목 상이) | not_verified | (없음) | not_verified | 비교 불가 |
| AC-010 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-011 (제목 상이) | (없음) | not_verified | (없음) | 비교 불가 |

### lovable

AC id 목록: r1=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-011] r2=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] r3=[CORE-1,AC-001,AC-002,AC-003,AC-004,AC-005,AC-006,AC-007,AC-008,AC-009,AC-010] → id목록 **다름**, 제목 **다름**

| AC | r1 | r2 | r3 | 결과 |
|---|---|---|---|---|
| CORE-1 앱의 핵심 일이 처음부터 끝까지 실제로 된다 | not_verified | not_verified | not_verified | 일치 |
| AC-001 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-002 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-003 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-004 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-005 (제목 상이) | pass | not_verified | pass | 비교 불가 |
| AC-006 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-007 (제목 상이) | not_verified | not_verified | not_verified | 비교 불가 |
| AC-008 (제목 상이) | not_verified | pass | not_verified | 비교 불가 |
| AC-009 (제목 상이) | pass | not_verified | not_verified | 비교 불가 |
| AC-011 (제목 상이) | pass | (없음) | (없음) | 비교 불가 |
| AC-010 (제목 상이) | (없음) | not_verified | not_verified | 비교 불가 |

## 4. 집계

- AC 셀(앱×id 합집합): 71개 · 비교 가능+3회 일치: 6 · **판정 불일치(비교 가능 셀 중 status가 3회 전부 같지 않음): 1** · 비교 불가(id 없음 또는 제목 상이): 64
- 앱 단위 최종 판정 불일치: 3/6
- 참고: 런별 pass AC 수(앱 순서 chatgpt,gemini,v0,bolt,claude,lovable): r1=1,4,3,2,1,5 r2=1,3,4,2,6,2 r3=0,5,5,1,3,1
- 참고: 런별 fail AC 수: r1=1,0,0,0,0,0 r2=0,0,0,0,0,0 r3=0,0,0,0,1,0

## 5. 불일치 셀의 판정 사유(reason) — 2단계 원인 분류 재료

### claude / CORE-1 — 앱의 핵심 일이 처음부터 끝까지 실제로 된다

- r1 **not_verified** (priority must, exercised={"stateChange":true,"verified":false}): 예약을 만들지 못했고, 지금은 체험 모드라 다른 기기에서도 보이는지 확인이 안 됐어요.
- r2 **not_verified** (priority must, exercised={"stateChange":true,"verified":false}): 예약 정보는 입력됐지만 제출 후 예약 생성이나 오류 메시지가 보이지 않아 실제 완료 여부를 확인할 수 없어요.
- r3 **fail** (priority must, exercised={"stateChange":true,"verified":true}): 필수 정보를 다 고르고 입력했는데 예약하기를 눌러도 예약 결과가 만들어지지 않았어요.

## 6. 앱 단위 불일치의 한 줄 판정 문구

### chatgpt
- r1 Needs Fix: 핵심 기준 1개가 실제로 해 보니 되지 않았어요.
- r2 Not Verified: 핵심 기준 중 10개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.
- r3 Not Verified: 핵심 기준 중 11개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.

### v0
- r1 Needs Fix: 기준은 통과했거나 확인 전이지만, 열리지 않는 화면이나 오류가 나는 버튼이 있어요.
- r2 Not Verified: 핵심 기준 중 7개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.
- r3 Not Verified: 핵심 기준 중 6개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.

### claude
- r1 Not Verified: 핵심 기준 중 10개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.
- r2 Not Verified: 핵심 기준 중 5개를 확인하지 못해 아직 "작동한다"고 말할 수 없어요.
- r3 Needs Fix: 핵심 기준 1개가 실제로 해 보니 되지 않았어요.

## 7. must 짚음 런별

- chatgpt: 정답지 must 실패 기대 ["A3","A4","A5","A6","A7"] → r1 ["A4"] · r2 [] · r3 []
- gemini: 정답지 must 실패 기대 ["A3","A6"] → r1 [] · r2 [] · r3 []
- v0: 정답지 must 실패 기대 ["A6","A7"] → r1 [] · r2 [] · r3 []
- bolt: 정답지 must 실패 기대 ["A6","A7"] → r1 [] · r2 [] · r3 []
- claude: 정답지 must 실패 기대 ["A3","A6"] → r1 [] · r2 [] · r3 ["A3","A6"]
- lovable: 정답지 must 실패 기대 [] → r1 [] · r2 [] · r3 []

## 8. 해석상 주의 (측정자 메모)

- **AC 목록은 런마다 새로 생성된다**: 역추론 지시서(generateDevSpec)를 매 런 LLM이 새로 만들어, `CORE-1`(고정 기준)만 제목이 3회 동일하고 `AC-nnn`은 같은 id여도 제목·내용이 다르다(위 표의 "비교 불가" 64셀). 따라서 AC 셀 단위 불일치 수는 **"비교 가능 셀 7(CORE-1 6 + chatgpt AC-002 1) 중 1"**이 전부이고, 나머지 64셀은 같은 기준을 3회 잰 것이 아니라 서로 다른 기준을 잰 것이다 → 판정 흔들림의 한 원인이 측정 단위 자체의 불안정(지시서 비결정성)이라는 가설이 서고, 이것이 2단계 분류의 첫 후보다(가설 — 이번 측정으로 인과 입증 아님).
- 비교 가능 셀(CORE-1) 기준 불일치: claude 1건(not_verified, not_verified, fail). 나머지 5앱 CORE-1은 3회 모두 not_verified.
- 앱 단위 불일치 3건은 모두 Needs Fix ↔ Not Verified (반대 판정=works↔broken은 0). Needs Fix가 나온 런은 chatgpt r1(AC-008 fail), v0 r1(깨진 화면/버튼 신호), claude r3(CORE-1 fail, must A3·A6 짚음).
- lovable(기대 works)은 3회 모두 Not Verified → 앱 일치 실패 원인(기대=작동 편 vs 확인 못 함). r1 5/6 → r2·r3 4/6의 하락은 chatgpt r2·r3 Needs Fix→Not Verified 때문.
- AC 제목 예시(v0 AC-002): r1="고객이 예약 가능한 시간을 확인하고 선택할 수 있어야 한다" · r2="선택한 날짜 기준 시간 선택" · r3="선택한 날짜의 예약 시간 선택".

## 9. 테스트 (벤치 뒤)

- `pnpm --filter @simsa/central-plane typecheck`: 통과(tsc --noEmit 종료 0).
- `node --test apps/central-plane/test/{agent-run,agent-inspection,agent-bench-aggregate,agent-benchmark,workspace-agent-benchmark}.test.mjs`: 86 tests / 19 suites, pass 86, fail 0.
