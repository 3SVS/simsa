# 벤치마크 #1 — PR #609(given 셋업) agent 엔진 repeat=3 측정 (2026-10-19)

## 0. 측정 기록 (사실)

- 실행 시각: 2026-10-19 01:31~02:02 KST (r1 01:31 시작, r3 마지막 앱 01:59 시작). **야간 — Bae 지시로 창 밖 실행. HANDOFF-10-18 §3-3 Q2의 "KST 10~17" 조건은 미충족.** 시간 의존 결함(v0·bolt의 A6·A7, 00~09 KST에만 드러남)이 노출되는 시간대이긴 했다.
- **수동 정리 없음** — 이번 세션에서 벤치 앱의 '심사테스트' 예약을 사람이 지우지 않았다(0건). 기준선 실행(2026-10-18 23:03 KST)이 남긴 예약도 그대로였을 수 있다(미확인).
- 코드: worktree `wt-pr4`, PR #609 브랜치 HEAD 73c1ff6. 로컬 실행 — Simsa 프로덕션 호출 없음(대상은 벤치 앱 6개의 공개 URL). AC = 사전 등록 A1~A10 주입(`--acs=prereg`).
- 모델: agent 판정 gpt-5.4 / gpt-5.4-mini (로그 `anthropic_disabled` → openai 폴백).
- 명령: `node tools\simsa-inspection-fixtures\agent-bench1-local.mjs --acs=prereg --repeat=3 --concurrency=2` (exit 0, 1회, 재실행 없음).
- 기준선: 같은 하네스·주입 AC의 PR4 이전 실행기 `agent-bench1-local-result-2026-10-18T14-03-39-871Z-r{1,2,3}.json`.
- 모든 숫자는 결과 파일에서 스크립트로 계산(손집계 없음).

## 1. 통과 기준 4개 판정 (Bae 2026-10-19)

| # | 기준 | 측정값 | 판정 |
|---|---|---|---|
| 1 | not_verified 3회 합산 ≤ 30% | **120/198 = 60.6%** (런별 42/66=63.6%, 37/66=56.1%, 41/66=62.1%) | **불합격** |
| 2 | 반대 판정 0 (모든 런) | oppositeErrors 0/0/0, `oppositeZeroAllRuns=true` | **통과** |
| 3 | 알려진 결함 AC가 하나라도 pass면 불합격 | 알려진 결함 AC 39셀(앱별 mustFailed × 3런) 중 pass **0** (시간 의존 A6·A7 포함해도 0) | **통과** |
| 4 | 기준선→PR4 전이표 | §3 | 보고(합격 임계 없음) |

기준 4개 중 통과 2 (기준 2·3), 불합격 1 (기준 1), 기준 4는 표 제시.

주의: 기준 3의 통과는 "결함을 짚었다"가 아니다. 알려진 결함 AC 39셀은 **전부 not_verified**(fail로 짚은 것도 0). must 짚음 **0/13** (세 런 모두 0; 기준선은 0·1·0).

## 2. 기준선 대비 비교

| 항목 | 기준선 r1/r2/r3 | PR4 r1/r2/r3 |
|---|---|---|
| pass | 19 / 19 / 20 | 19 / 23 / 17 |
| fail | 6 / 6 / 5 | 5 / 6 / 8 |
| not_verified | 41 / 41 / 41 (합 123/198 = 62.1%) | 42 / 37 / 41 (합 120/198 = 60.6%) |
| 반대 판정 | 0 / 0 / 0 | 0 / 0 / 0 |
| 앱 일치 (of 6) | 5 / 5 / 5 | 4 / 4 / 5 |
| must 짚음 (of 13) | 0 / 1 / 0 | 0 / 0 / 0 |
| 앱당 평균 agent 비용 | $0.2513 / $0.3027 / $0.2589 | $0.2955 / $0.2776 / $0.2712 |
| 런 agent 비용 합(6앱) | — | $1.7730 / $1.6654 / $1.6271 (3런 $5.0655) |
| LLM 호출 수 | — | 501 / 452 / 453 |
| 앱 소요 합(초, 동시 2) | — | 1117 / 1055 / 1025 |

not_verified 사유: 기준선은 사유 없음 37/33/38 + login_required 2/2/2 + evidence_missing·not_reached·judge_disagreed 소수. PR4는 사유 없음 24/28/28, **precondition_not_met 9/5/9 (3런 합 23, PR4 신규 사유)**, evidence_missing 4/0/0, judge_disagreed 4/3/3, not_reached 1/1/0, fail_not_reproduced 0/0/1.

해석: not_verified 비율은 사실상 변화 없음(62.1% → 60.6%). 사유가 붙은 셀이 늘었을 뿐 pass로 전환된 건 16셀(§3)이고 같은 수준의 pass→not_verified(11셀)가 반대로 움직였다. 앱 일치는 하락: lovable(정답=작동)이 3런 모두 Not Verified, chatgpt는 r1·r2 Not Verified(r3만 Needs Fix).

## 3. 전이표 (기준선 → PR4, 같은 k끼리 앱×AC 셀, 비교 불가 셀 0)

3회 합산 (행=기준선, 열=PR4):

| 기준선 \ PR4 | pass | fail | not_verified |
|---|---|---|---|
| pass | 42 | 5 | 11 |
| fail | 1 | 12 | 4 |
| not_verified | 16 | 2 | 105 |

런별:

| 런 | p>p | p>f | p>nv | f>p | f>f | f>nv | nv>p | nv>f | nv>nv |
|---|---|---|---|---|---|---|---|---|---|
| r1 | 14 | 1 | 4 | 1 | 3 | 2 | 4 | 1 | 36 |
| r2 | 15 | 1 | 3 | 0 | 4 | 2 | 8 | 1 | 32 |
| r3 | 13 | 3 | 4 | 0 | 5 | 0 | 4 | 0 | 37 |

- **not_verified → pass 16**: r1 v0|A4, bolt|CORE-1, bolt|A9, claude|A9 / r2 v0|A3, v0|A5, bolt|A2, bolt|A9, claude|A9, lovable|A4, lovable|A5, lovable|A10 / r3 bolt|A1, bolt|A2, lovable|A2, lovable|A4
- **not_verified → fail 2**: r1 claude|A2 / r2 chatgpt|A9
- 반대 방향: pass→not_verified 11, pass→fail 5, fail→not_verified 4. 이 이동 상당수는 런 간 변동과 구분되지 않는다(기준선 자체 변동 대비 유의성은 미측정).

## 4. 알려진 결함 AC (mustFailedExpected) 중 pass

**pass 0건** (비시간의존 0, 시간 의존 0). 39셀 상세:

```
r1 chatgpt A3 status=not_verified precondition_not_met 
r1 chatgpt A4 status=not_verified  
r1 chatgpt A5 status=not_verified precondition_not_met 
r1 chatgpt A6 status=not_verified precondition_not_met 
r1 chatgpt A7 status=not_verified precondition_not_met 
r1 gemini A3 status=not_verified  
r1 gemini A6 status=not_verified  
r1 v0 A6 status=not_verified precondition_not_met 
r1 v0 A7 status=not_verified precondition_not_met 
r1 bolt A6 status=not_verified precondition_not_met 
r1 bolt A7 status=not_verified  
r1 claude A3 status=not_verified  
r1 claude A6 status=not_verified  
r2 chatgpt A3 status=not_verified precondition_not_met 
r2 chatgpt A4 status=not_verified  
r2 chatgpt A5 status=not_verified precondition_not_met 
r2 chatgpt A6 status=not_verified precondition_not_met 
r2 chatgpt A7 status=not_verified precondition_not_met 
r2 gemini A3 status=not_verified  
r2 gemini A6 status=not_verified  
r2 v0 A6 status=not_verified judge_disagreed 
r2 v0 A7 status=not_verified  
r2 bolt A6 status=not_verified precondition_not_met 
r2 bolt A7 status=not_verified  
r2 claude A3 status=not_verified  
r2 claude A6 status=not_verified  
r3 chatgpt A3 status=not_verified precondition_not_met 
r3 chatgpt A4 status=not_verified  
r3 chatgpt A5 status=not_verified precondition_not_met 
r3 chatgpt A6 status=not_verified precondition_not_met 
r3 chatgpt A7 status=not_verified precondition_not_met 
r3 gemini A3 status=not_verified  
r3 gemini A6 status=not_verified fail_not_reproduced 
r3 v0 A6 status=not_verified precondition_not_met 
r3 v0 A7 status=not_verified precondition_not_met 
r3 bolt A6 status=not_verified precondition_not_met 
r3 bolt A7 status=not_verified  
r3 claude A3 status=not_verified  
r3 claude A6 status=not_verified  
```

정답지: chatgpt A3~A7, gemini A3·A6, v0 A6·A7, bolt A6·A7, claude A3·A6, lovable 없음(정답=작동). 시간 의존: v0·bolt의 A6·A7 (실행 시각 01:31~02:02 KST = 노출 시간대인데도 fail로 짚은 런 0).

## 5. 셋업 · 정리 · 취소 로그

### 5-1. 런별 testData 합

| 런 | created | cleaned | **leftover** | 비고 |
|---|---|---|---|---|
| r1 | 11 | 0 | 3 (bolt 1, lovable 2) | |
| r2 | 10 | 1 (v0) | 1 (lovable 1) | |
| r3 | 10 | 0 | 4 (bolt 2, lovable 2) | |
| 합 | 31 | 1 | **8** | 수동 정리 안 함 → 벤치 앱에 '심사테스트' 예약으로 남음 (runTag r1bo, r1lo, r2lo, r3bo, r3lo) |

created에는 `cleanupSkipped: browser_only`(gemini·claude, 브라우저 로컬 저장 예약)가 포함 — 서버 잔여 아님. `not_confirmed`(bolt·lovable)가 leftover 8건의 출처.

### 5-2. r1 cancel-click 로그 (bolt에서만 발생, 18건 전부 blocked, allowed 0)

| t | 대상 | target | ownRecord | markerMatch | 결과 |
|---|---|---|---|---|---|
| +175.2s | A7 | 취소 | false | false | blocked |
| +176.2s | A7 | 취소 | false | false | blocked |
| +177.6s | A7 | 취소 | false | false | blocked |
| +178.6s | A7 | 취소 | false | false | blocked |
| +179.7s | A7 | 취소 | false | false | blocked |
| +180.6s | A7 | 취소 | false | false | blocked |
| +181.7s | A7 | 취소 | false | false | blocked |
| +182.6s | A7 | 취소 | false | false | blocked |
| +183.7s | A7 | 취소 | false | false | blocked |
| +184.8s | A7 | 취소 | false | false | blocked |
| +185.9s | A7 | 취소 | false | false | blocked |
| +187.2s | A7 | 취소 | false | false | blocked |
| +220.3s | CLEANUP-1 | 취소 | false | false | blocked |
| +221.2s | CLEANUP-1 | 취소 | true | false | blocked |
| +222.4s | CLEANUP-1 | 취소 | true | false | blocked |
| +223.5s | CLEANUP-1 | 취소 | true | false | blocked |
| +224.8s | CLEANUP-1 | 취소 | true | false | blocked |
| +225.7s | CLEANUP-1 | 취소 | true | false | blocked |

해석: 남의 예약 취소 클릭은 전부 차단(ownRecord=false 13건, 안전). 내 예약(ownRecord=true 5건, CLEANUP-1)도 markerMatch=false여서 차단 → 정리 실패(bolt r1 leftover 1, cleanup → not_verified). 즉 안전 방향 오류이며 정리가 안 되는 것이 문제.
r2: bolt A7 2건 blocked(ownRecord=false). r3: bolt A7 8건 + CLEANUP-1 7건 blocked (ownRecord=true 1건), cleanup → not_verified(not_reached), leftover 2.

### 5-3. 앱별 setup / testData / phases (setup:·cleanup·cancel-click 줄 전부)

```
r1 chatgpt setup=null
r1 chatgpt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-2245-9715","memo":"심사 자동 확인용 예약입니다(테스트 r1ch)","runTag":"r1ch","created":0,"cleaned":0,"leftover":0}
  +98.3s setup:run → fail created=false
r1 gemini setup={"byAc":"CORE-1","date":null,"time":"10:00","serverWrites":0,"recipeSteps":3}
r1 gemini testData={"names":["심사테스트","심사테스트둘"],"phone":"010-5697-6879","memo":"심사 자동 확인용 예약입니다(테스트 r1ge)","runTag":"r1ge","created":4,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +71.5s setup:from CORE-1 date=? time=10:00 writes=0
r1 v0 setup=null
r1 v0 testData={"names":["심사테스트","심사테스트둘"],"phone":"010-3804-2628","memo":"심사 자동 확인용 예약입니다(테스트 r1v0)","runTag":"r1v0","created":0,"cleaned":0,"leftover":0}
  +101.4s setup:run → not_verified created=false
r1 bolt setup={"byAc":"CORE-1","date":"2026-10-18","time":"13:00","serverWrites":1,"recipeSteps":14}
r1 bolt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-7093-7651","memo":"심사 자동 확인용 예약입니다(테스트 r1bo)","runTag":"r1bo","created":1,"cleaned":0,"leftover":1,"cleanupSkipped":"not_confirmed"}
  +46.6s setup:from CORE-1 date=2026-10-18 time=13:00 writes=1
  +175.2s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +176.2s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +177.6s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +178.6s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +179.7s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +180.6s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +181.7s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +182.6s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +183.7s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +184.8s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +185.9s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +187.2s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +220.3s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +221.2s cancel-click CLEANUP-1 target="취소" ownRecord=true markerMatch=false → blocked
  +222.4s cancel-click CLEANUP-1 target="취소" ownRecord=true markerMatch=false → blocked
  +223.5s cancel-click CLEANUP-1 target="취소" ownRecord=true markerMatch=false → blocked
  +224.8s cancel-click CLEANUP-1 target="취소" ownRecord=true markerMatch=false → blocked
  +225.7s cancel-click CLEANUP-1 target="취소" ownRecord=true markerMatch=false → blocked
  +226.9s cleanup → not_verified leftover=1
r1 claude setup={"byAc":"CORE-1","date":"2026-10-19","time":"10:00","serverWrites":0,"recipeSteps":3}
r1 claude testData={"names":["심사테스트","심사테스트둘"],"phone":"010-4248-5736","memo":"심사 자동 확인용 예약입니다(테스트 r1cl)","runTag":"r1cl","created":4,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +33.3s setup:from CORE-1 date=2026-10-19 time=10:00 writes=0
r1 lovable setup={"byAc":"SETUP-1","date":"2026-10-19","time":"13:30","serverWrites":2,"recipeSteps":4}
r1 lovable testData={"names":["심사테스트","심사테스트둘"],"phone":"010-6527-3689","memo":"심사 자동 확인용 예약입니다(테스트 r1lo)","runTag":"r1lo","created":2,"cleaned":0,"leftover":2,"cleanupSkipped":"not_confirmed"}
  +110.7s setup:from SETUP-1 date=2026-10-19 time=13:30 writes=2
  +110.7s setup:run → pass created=true
  +202.9s cleanup → not_verified leftover=2
r2 chatgpt setup=null
r2 chatgpt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-8472-8304","memo":"심사 자동 확인용 예약입니다(테스트 r2ch)","runTag":"r2ch","created":0,"cleaned":0,"leftover":0}
  +85.1s setup:run → fail created=false
r2 gemini setup={"byAc":"CORE-1","date":null,"time":"10:00","serverWrites":0,"recipeSteps":3}
r2 gemini testData={"names":["심사테스트","심사테스트둘"],"phone":"010-3798-2586","memo":"심사 자동 확인용 예약입니다(테스트 r2ge)","runTag":"r2ge","created":3,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +60.9s setup:from CORE-1 date=? time=10:00 writes=0
r2 v0 setup={"byAc":"A4","date":"2026-10-19","time":"11:00","serverWrites":1,"recipeSteps":4}
r2 v0 testData={"names":["심사테스트","심사테스트둘"],"phone":"010-6651-4557","memo":"심사 자동 확인용 예약입니다(테스트 r2v0)","runTag":"r2v0","created":1,"cleaned":1,"leftover":0}
  +57.2s setup:from A4 date=2026-10-19 time=11:00 writes=1
  +161.2s cleanup → pass leftover=0
r2 bolt setup={"byAc":"A4","date":"2026-10-18","time":"14:00","serverWrites":0,"recipeSteps":11}
r2 bolt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-8062-5434","memo":"심사 자동 확인용 예약입니다(테스트 r2bo)","runTag":"r2bo","created":1,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +114.4s setup:from A4 date=2026-10-18 time=14:00 writes=0
  +156.8s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +159.4s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
r2 claude setup={"byAc":"CORE-1","date":null,"time":"10:00","serverWrites":0,"recipeSteps":3}
r2 claude testData={"names":["심사테스트","심사테스트둘"],"phone":"010-7527-1689","memo":"심사 자동 확인용 예약입니다(테스트 r2cl)","runTag":"r2cl","created":4,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +22.4s setup:from CORE-1 date=? time=10:00 writes=0
r2 lovable setup={"byAc":"A4","date":"2026-10-19","time":"15:00","serverWrites":2,"recipeSteps":4}
r2 lovable testData={"names":["심사테스트","심사테스트둘"],"phone":"010-2170-9190","memo":"심사 자동 확인용 예약입니다(테스트 r2lo)","runTag":"r2lo","created":1,"cleaned":0,"leftover":1,"cleanupSkipped":"not_confirmed"}
  +100.0s setup:from A4 date=2026-10-19 time=15:00 writes=2
  +215.6s cleanup → not_verified leftover=1
r3 chatgpt setup=null
r3 chatgpt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-9295-5065","memo":"심사 자동 확인용 예약입니다(테스트 r3ch)","runTag":"r3ch","created":0,"cleaned":0,"leftover":0}
  +118.5s setup:run → not_verified created=false
r3 gemini setup={"byAc":"CORE-1","date":null,"time":"10:00","serverWrites":0,"recipeSteps":3}
r3 gemini testData={"names":["심사테스트","심사테스트둘"],"phone":"010-9079-3553","memo":"심사 자동 확인용 예약입니다(테스트 r3ge)","runTag":"r3ge","created":3,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +52.3s setup:from CORE-1 date=? time=10:00 writes=0
r3 v0 setup=null
r3 v0 testData={"names":["심사테스트","심사테스트둘"],"phone":"010-9726-8082","memo":"심사 자동 확인용 예약입니다(테스트 r3v0)","runTag":"r3v0","created":0,"cleaned":0,"leftover":0}
  +81.4s setup:run → not_verified created=false
r3 bolt setup={"byAc":"CORE-1","date":"2026-10-18","time":"14:00","serverWrites":1,"recipeSteps":13}
r3 bolt testData={"names":["심사테스트","심사테스트둘"],"phone":"010-6771-5397","memo":"심사 자동 확인용 예약입니다(테스트 r3bo)","runTag":"r3bo","created":2,"cleaned":0,"leftover":2,"cleanupSkipped":"not_confirmed"}
  +46.9s setup:from CORE-1 date=2026-10-18 time=14:00 writes=1
  +199.8s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +200.8s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +202.0s cancel-click A7 target="취소" ownRecord=true markerMatch=false → blocked
  +203.2s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +204.2s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +205.3s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +206.1s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +207.3s cancel-click A7 target="취소" ownRecord=false markerMatch=false → blocked
  +238.0s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +238.9s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +240.0s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +241.0s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +242.0s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +243.0s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +244.1s cancel-click CLEANUP-1 target="취소" ownRecord=false markerMatch=false → blocked
  +244.2s cleanup → not_verified(not_reached) leftover=2
r3 claude setup={"byAc":"CORE-1","date":"2026-10-19","time":"10:00","serverWrites":0,"recipeSteps":4}
r3 claude testData={"names":["심사테스트","심사테스트둘"],"phone":"010-6426-2982","memo":"심사 자동 확인용 예약입니다(테스트 r3cl)","runTag":"r3cl","created":3,"cleaned":0,"leftover":0,"cleanupSkipped":"browser_only"}
  +32.7s setup:from CORE-1 date=2026-10-19 time=10:00 writes=0
r3 lovable setup={"byAc":"CORE-1","date":"2026-10-19","time":"16:00","serverWrites":2,"recipeSteps":4}
r3 lovable testData={"names":["심사테스트","심사테스트둘"],"phone":"010-7077-7539","memo":"심사 자동 확인용 예약입니다(테스트 r3lo)","runTag":"r3lo","created":2,"cleaned":0,"leftover":2,"cleanupSkipped":"not_confirmed"}
  +32.6s setup:from CORE-1 date=2026-10-19 time=16:00 writes=2
  +189.1s cleanup → not_verified leftover=2
```

관찰: gemini·claude는 setup 성공해도 `serverWrites=0`·`browser_only`(브라우저 로컬 저장 앱 — 서버 기록 없음). chatgpt는 3런 모두 `setup:run → fail/not_verified created=false` (사이트 연결 설정 필요 문구, 백엔드 미연결). v0는 r1·r3 setup 실패(null), r2만 A4 셋업 성공 후 cleanup pass.

## 6. 앱 판정 · 불일치 셀

### 6-1. 앱 판정

| 앱 | 기대 | r1 | r2 | r3 | 일치 |
|---|---|---|---|---|---|
| chatgpt | 안 돼요 | Not Verified (불일치) | Not Verified (불일치) | Needs Fix | 1/3 |
| gemini | 안 돼요/사람 확인 | Needs Fix | Needs Fix | Needs Fix | 3/3 |
| v0 | 안 돼요/사람 확인 | Needs Fix | Needs Fix | Needs Fix | 3/3 |
| bolt | 안 돼요/사람 확인 | Not Verified | Not Verified | Not Verified | 3/3 |
| claude | 안 돼요/사람 확인 | Needs Fix | Needs Fix | Needs Fix | 3/3 |
| lovable | 작동 | Not Verified (불일치) | Not Verified (불일치) | Not Verified (불일치) | 0/3 |

반대 판정 0. 앱 일치 4/4/5 of 6 (기준선 5/5/5).

### 6-2. 런 간 status가 달라진 셀 20개 (r1/r2/r3, reason은 r1 한 줄)

| 앱 | AC | r1/r2/r3 | 기준선 r1 | reasonCode | reason |
|---|---|---|---|---|---|
| chatgpt | CORE-1 | not_verified/not_verified/fail | fail |  | 예약을 제출해 결과를 확인해야 하지만, 화면에 사이트 연결 설정이 아직 필요하다고 나와 있어 끝까지 확인하지 못했다. |
| chatgpt | A9 | not_verified/fail/not_verified | not_verified |  | 휴대폰 폭 화면에서 예약 폼은 보이지만, 바로 아래에 사이트 연결 설정이 아직 필요하다는 문구가 있어 실제 예약 완료까지 되는지 확인하지 못했습니다. |
| chatgpt | A10 | not_verified/pass/pass | fail | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| gemini | A10 | not_verified/fail/fail | pass | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| v0 | A4 | pass/pass/not_verified | not_verified |  | 예약을 완료한 뒤 완료 화면에서 날짜, 시간, 이름을 직접 확인했다. |
| v0 | A3 | not_verified/pass/not_verified | not_verified | precondition_not_met | 이 기준의 전제(예: 예약 1건이 미리 있어야 함)를 이번 확인에서 만들지 못해 확인하지 않았어요 — 고장으로 치지 않아요 |
| v0 | A5 | not_verified/pass/not_verified | not_verified | precondition_not_met | 이 기준의 전제(예: 예약 1건이 미리 있어야 함)를 이번 확인에서 만들지 못해 확인하지 않았어요 — 고장으로 치지 않아요 |
| v0 | A9 | not_verified/not_verified/fail | pass |  | 휴대폰 폭 화면에서 예약 폼은 보이지만 실제로 예약 완료까지 확인하지 못했다. |
| bolt | CORE-1 | pass/not_verified/not_verified | not_verified |  | 예약을 끝까지 만들었고 새로고침 후 관리 화면에서 같은 전화번호의 예약이 보여 핵심 기능이 실제로 됩니다. |
| bolt | A1 | pass/not_verified/pass | fail |  | 날짜를 고른 뒤 시간 목록에서 오전 10시부터 오후 7시까지 30분 단위 시간이 보였습니다. |
| bolt | A2 | not_verified/pass/pass | not_verified |  | 아직 이름·휴대폰 번호를 비우고 예약 제출한 결과와 오류 메시지를 보지 못했습니다. |
| bolt | A9 | pass/pass/not_verified | not_verified |  | 휴대폰 폭 화면에서도 글자와 버튼이 잘리지 않고 예약 흐름을 끝까지 진행할 수 있습니다. |
| bolt | A10 | pass/pass/fail | pass |  | 화면에 영어 같은 다른 언어 문구가 보이지 않았습니다. |
| claude | CORE-1 | not_verified/fail/not_verified | not_verified | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| claude | A2 | fail/not_verified/not_verified | not_verified |  | 이름을 비운 채 예약을 시도했는데 예약되지 않는다는 안내나 무엇이 잘못됐는지에 대한 메시지를 보지 못했습니다. |
| claude | A9 | pass/pass/not_verified | not_verified |  | 휴대폰 폭 화면에서 글자와 버튼이 잘리지 않았고 예약 흐름을 끝까지 할 수 있게 보입니다. |
| lovable | A1 | not_verified/pass/pass | pass | evidence_missing | 판단의 근거를 실제 화면에서 찾지 못해 결과로 치지 않았어요. |
| lovable | A5 | not_verified/pass/not_verified | not_verified | judge_disagreed | 두 번 따져 본 판단이 서로 달라서 결과로 치지 않았어요 |
| lovable | A9 | pass/not_verified/pass | pass |  | 휴대폰 폭 화면에서 예약 흐름을 끝까지 진행했고 예약 완료가 보였습니다. |
| lovable | A10 | fail/pass/fail | pass |  | 화면에 영어 문구가 있어서 모든 글이 한국어가 아닙니다. |

## 7. 한계 (정직 표기)

- 라이브확인: 이번 3런 실행 결과(위 숫자 전부)와 기준 1·2·3 판정.
- 테스트만/한계: 시간 창 미충족(야간). 다만 노출 시간대였음에도 A6·A7은 fail이 아니라 not_verified여서 "야간이라 놓침"이 아니라 "못 짚음"으로 읽힌다. 기준 3 통과는 결함 미검증의 결과이지 정확성 증거가 아니다. 모델은 gpt-5.4 폴백(Anthropic 비활성)이라 프로덕션 모델과 다를 수 있다.
- 미측정: 기준선 자체의 런 간 변동 대비 전이 유의성, 기준선이 남긴 잔여 예약이 PR4 결과에 미친 영향, KST 10~17 창 재측정.

## 8. 파일

- 결과: `C:\Users\seung\.conclave\wt-pr4\tools\simsa-inspection-fixtures\agent-bench1-local-result-2026-10-18T16-31-58-813Z-r{1,2,3}.json`
- 집계: 같은 폴더 `agent-bench1-local-aggregate-2026-10-18T16-31-58-813Z.json`
- stdout: 같은 폴더 `agent-bench1-local-prereg-pr4-2026-10-19.stdout.txt`
- 기준선: `C:\Users\seung\.conclave\wt-bench-acs\tools\simsa-inspection-fixtures\agent-bench1-local-result-2026-10-18T14-03-39-871Z-r{1,2,3}.json`
