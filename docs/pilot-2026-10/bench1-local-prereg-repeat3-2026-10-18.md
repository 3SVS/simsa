# 벤치 #1 사전 등록 AC 주입 로컬 3회 — 질문 동일성·판정 동일성 (2026-10-18)

> **로컬 실행(PR #607 하네스, 코드 main #605 + 하네스(worktree 커밋 9443f9d), 실행기 2602b43과 동일) — 프로덕션 아님, LLM=OpenAI 폴백, AC=사전 등록 A1~A10 주입.**
> 명령: `node tools/simsa-inspection-fixtures/agent-bench1-local.mjs --acs=prereg --repeat=3 --concurrency=2` (worktree `C:\Users\seung\.conclave\wt-bench-acs`). 종료 코드 0, 런 에러 0. 시작 KST r1 23:03 · r2 23:14 · r3 23:26 (런당 약 12분, 총 약 37분).
> 비교 기준선: `docs/pilot-2026-10/bench1-local-repeat3-2026-10-18.md`(옛 하네스, 역추론 AC 매 런 생성, 동시 2, 같은 셸·같은 OpenAI 폴백).

결과 파일(worktree 경로 그대로)
- aggregate: `C:\Users\seung\.conclave\wt-bench-acs\tools\simsa-inspection-fixtures\agent-bench1-local-aggregate-2026-10-18T14-03-39-871Z.json`
- 런별: 같은 폴더 `agent-bench1-local-result-2026-10-18T14-03-39-871Z-r1.json` / `-r2.json` / `-r3.json`
- stdout: 같은 폴더 `agent-bench1-local-prereg-2026-10-18.stdout.txt`

## 1. 런별 요약

| 지표 | r1 | r2 | r3 | 평균/최소/최대 |
|---|---|---|---|---|
| 반대 판정 | 0 | 0 | 0 | 0 / 0 / 0 |
| 앱 일치(/6) | 5 | 5 | 5 | 5 / 5 / 5 |
| must 짚음(/13, id 기준) | 0 | 1 (chatgpt A4) | 0 | 0.33 / 0 / 1 |
| 런 비용 USD(6앱 합) | 1.5080 | 1.8159 | 1.5533 | 1.63 / 1.51 / 1.82 |
| 　generation | 0 | 0 | 0 | 0 (주입이라 생성 호출 없음, 확인됨) |
| 　agent | 1.5080 | 1.8159 | 1.5533 | 1.63 |
| LLM 호출(llmCalls 합) | 465 | 532 | 484 | 493.7 |
| 앱별 소요 합(초, 병렬 2라 벽시계보다 큼) | 1126 | 1333 | 1206 | 1221.7 |
| 에러 | 0 | 0 | 0 | 0 |

주의: aggregate의 `costPerRunMean`(0.271)은 "런 안 앱 평균"이지 런 합계가 아니다. 위 런 합계는 result 파일의 앱별 `costUsd`를 직접 합산한 값이다(aggregate 평균 × 6 = 1.63과 일치).

## 2. 두 층 동일성 (compare.totals)

| 층 | 결과 |
|---|---|
| **질문 동일성** (3회 AC 목록·제목 동일) | **6/6 앱** (통과 기준 3/3 충족) |
| AC 셀 불일치 | **11 / 비교 가능 66** (비교 불가 0) |
| 앱 판정 동일 | 5/6 → **앱 판정 불일치 1/6 (bolt)** |

## 3. 앱 단위 판정 (r1 / r2 / r3)

| 앱 | 기대 | r1 | r2 | r3 | 불일치? |
|---|---|---|---|---|---|
| chatgpt | broken | Needs Fix | Needs Fix | Needs Fix | 아니오 |
| gemini | broken_or_hold | Needs Fix | Needs Fix | Needs Fix | 아니오 |
| v0 | broken_or_hold | Not Verified | Not Verified | Not Verified | 아니오 |
| bolt | broken_or_hold | Needs Fix | Not Verified | Not Verified | **예** |
| claude | broken_or_hold | Needs Fix | Needs Fix | Needs Fix | 아니오 |
| lovable | works | Not Verified | Not Verified | Not Verified | 아니오(기대 works와는 불일치, 3회 동일) |

앱 일치 5/6 = lovable(기대 works인데 3회 모두 Not Verified)만 불일치.
bolt 한 줄 사유: r1 Needs Fix "핵심 기준 1개가 실제로 해 보니 되지 않았어요"(A1 fail) / r2·r3 Not Verified "핵심 기준 중 6개를 확인하지 못해 아직 '작동한다'고 말할 수 없어요". 즉 A1이 r1에서만 fail(기기 시계 0:30 시나리오), r2 pass, r3 not_verified로 갈린 것이 원인.

## 4. 불일치 셀 11개 (status / reasonCode / reason)

| 앱·AC | 런 | status | reasonCode | reason |
|---|---|---|---|---|
| chatgpt A4 | r1 | not_verified | - | 예약 버튼을 눌렀지만 완료 화면이 나오지 않았습니다. |
| | r2 | fail | - | 예약을 완료 화면까지 진행할 수 없어서 예약 내용 표시를 확인하지 못했습니다. |
| | r3 | not_verified | judge_disagreed | 두 번 따져 본 판단이 서로 달라서 결과로 치지 않았어요 |
| chatgpt A10 | r1 | fail | - | 화면에 영어 문구가 보여서 모든 글이 한국어라는 조건을 만족하지 않습니다. |
| | r2 | pass | - | 화면에 영어 문구가 보이지 않고 모두 한국어입니다. |
| | r3 | pass | - | 화면에 영어 등 다른 언어 문구가 없고 모두 한국어로 보입니다. |
| gemini A9 | r1 | not_verified | - | 예약 입력과 시간 선택은 보였지만, 실제로 예약 완료 후 성공 화면이나 저장 결과를 아직 확인하지 못했습니다. |
| | r2 | not_verified | - | 휴대폰 폭에서 예약 화면은 열리지만, 글자·버튼이 잘리지 않고 예약까지 되는지 최종 확인은 아직 못 했습니다. |
| | r3 | pass | - | 휴대폰 폭에서도 글자와 버튼이 잘리지 않고 예약 정보 입력과 예약 완료까지 할 수 있었다. |
| v0 A4 | r1 | not_verified | - | 예약 시간이 선택되지 않아 완료 화면까지 확인하지 못했습니다. |
| | r2 | pass | - | 예약을 완료한 뒤 완료 화면에서 날짜, 시간, 이름을 직접 확인했습니다. |
| | r3 | pass | - | (r2와 동일) |
| v0 A9 | r1 | pass | - | 휴대폰 폭 화면에서 글자와 버튼이 잘리지 않고 예약 완료까지 됐습니다. |
| | r2 | not_verified | - | 휴대폰 폭에서 예약 입력과 버튼은 보이지만, 실제 예약 완료 화면까지 아직 확인하지 못했다. |
| | r3 | pass | - | 휴대폰 폭 화면에서도 예약 흐름이 끝까지 되고 예약 완료 내용이 잘 보입니다. |
| bolt A1 | r1 | fail | - | 기기 시계를 한국 시간 새벽 0시 30분으로 옮겨 다시 해 보니 10:00~19:00 30분 단위 시간을 모두 고를 수 없었습니다. |
| | r2 | pass | - | 날짜를 고른 뒤 시간 목록에서 10시~19시 30분 간격이 실제로 보입니다. |
| | r3 | not_verified | - | 시간 목록을 아직 보지 못해서 확인할 수 없습니다. |
| bolt A4 | r1 | not_verified | - | 휴대폰 번호를 아직 올바르게 넣지 못해서 완료 화면을 확인할 수 없었습니다. |
| | r2 | not_verified | not_reached | 정해진 단계 안에 이 기준을 확인할 화면까지 가지 못했어요 |
| | r3 | pass | - | 예약을 완료했고 완료 화면에 날짜, 시간, 이름이 모두 보였습니다. |
| claude CORE-1 | r1 | not_verified | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| | r2 | fail | - | 필수 정보를 다 넣고 예약하기를 눌렀는데 예약이 만들어졌다는 결과나 변화가 보이지 않았습니다. |
| | r3 | not_verified | - | 예약 버튼을 눌렀지만 결과 화면이나 저장 여부를 아직 확인하지 못했어요. |
| lovable A2 | r1 | pass | - | 이름 없이 예약을 시도했을 때 예약되지 않았고 안내가 보였습니다. |
| | r2 | pass | - | (r1과 동일 취지) |
| | r3 | not_verified | - | 날짜와 시간을 고른 상태를 만들 수 없어 끝까지 확인하지 못했습니다. |
| lovable A4 | r1 | pass | - | 예약을 완료했고 완료 화면에 날짜, 시간, 이름이 모두 보였습니다. |
| | r2 | not_verified | - | 예약 시간을 고를 수 없어서 확인하지 못했습니다. |
| | r3 | not_verified | - | 예약 완료 화면이 아직 안 나와서 확인 못 했습니다. |
| lovable A10 | r1 | pass | - | 화면에 보이는 문구가 모두 한국어입니다. |
| | r2 | not_verified | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| | r3 | fail | - | 화면에 영어 문구가 있어 모든 글이 한국어라는 조건을 만족하지 않습니다. |

패턴(관찰, 인과 입증 아님): 11셀 중 다수가 pass/fail ↔ not_verified 사이의 흔들림(행동 에이전트가 예약 완료까지 도달했는지가 런마다 다름)이고, pass ↔ fail 정면 충돌은 chatgpt A10(fail→pass)과 lovable A10(pass→fail), chatgpt A4(not_verified/fail/not_verified) 정도다. reasonCode가 붙은 셀은 4개(judge_disagreed 1, evidence_missing 2, not_reached 1).

## 5. 옛 하네스 vs 주입 하네스

| 지표 | 옛 하네스(기준선, 역추론 AC) | 주입 하네스(prereg) |
|---|---|---|
| 질문 동일성 | 0/6 (CORE-1 외 AC 제목 매 런 상이) | **6/6** |
| AC 셀 불일치 | 1 / 비교 가능 7 (비교 불가 64) | **11 / 비교 가능 66** (비교 불가 0) |
| 앱 판정 불일치 | 3/6 | **1/6** |
| 반대 판정 | 0 | 0 |
| 앱 일치(/6) 평균(최소~최대) | 4.33 (4~5) | **5.00 (5~5)** |
| must 짚음(/13) 평균(최소~최대) | 1.00 (0~2) | 0.33 (0~1) |
| 런 비용 합 | 3.23 (3.18~3.33) | **1.63 (1.51~1.82)** |
| 　generation | 1.25 | **0** |
| 　agent | 1.98 | 1.63 |
| LLM 호출/런 | 595.7 | 493.7 |
| 앱별 소요 합(초) | 2182 | 1222 |

해석(수치 근거 범위 내): 질문이 고정되어 "같은 기준을 3회 잰" 비교가 처음 가능해졌고(비교 가능 셀 7→66), 앱 판정 흔들림은 3/6→1/6으로 줄고 앱 일치는 5/6로 안정. 그러나 고정된 질문에서도 셀 단위로는 11/66(약 17%)이 흔들려, 남은 불일치는 AC 생성이 아니라 행동 에이전트의 도달·판정 변동이다. must 짚음은 개선되지 않았다(평균 1.00→0.33; 기준선 r1~r3과 같은 모수 13, 표본 3회라 감소 자체를 결론짓지 않음). 기대 works인 lovable은 3회 모두 Not Verified(앱 일치 5/6의 유일한 실패).

## 6. 라이브확인 / 테스트만 / 미측정

- 라이브확인: 로컬 하네스가 실제 6개 공개 URL(Netlify/bolt.host/lovable.app 등)을 Playwright로 3회 구동한 실행 결과(프로덕션 central-plane 아님).
- 테스트만: 없음(이번 실행에서 단위 테스트는 돌리지 않음).
- 미측정: 프로덕션 경로(Cloudflare Worker·컨테이너) 동일성, Anthropic 모델 경로(로컬·프로덕션 모두 OpenAI 폴백만), 모델별 비용(결과 파일에 costByModel 없음), 3회 초과 표본.
