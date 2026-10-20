# 벤치 #1 로컬 3회 — PR #609 1~3단계 + 회귀 수정(`bcfcca9`) 측정 (2026-10-20, **창 밖 참고 측정**)

> ⚠️ **측정 시간대 위반**: 실행 시각 **KST 2026-10-21 00:12~00:50**(UTC 2026-10-20 15:12~15:50). 회차 조건 KST 10~17시(index-design §2.1) **밖**이다. 원인 = Git Bash `TZ=Asia/Seoul date`가 UTC를 출력하는 것을 KST로 오인(memory `gotcha-gitbash-tz-ignored`). 앞서 중단한 r1(`…2026-10-20T14-40-11-936Z-r1.json`)도 KST 23:40 — 창 밖. 이 문서의 숫자는 **통과 판정에 쓰지 않는다**(참고·원인 분석용). 통과 판정은 창 안 재측정으로.

- 명령: `node tools/simsa-inspection-fixtures/agent-bench1-local.mjs --acs=prereg --repeat=3 --concurrency=2` (wt-pr4, HEAD `bcfcca9`)
- 모델: gpt-5.4 / gpt-5.4-mini (OpenAI 폴백, `anthropic_disabled`) — 기준선과 같음
- 원자료: `tools/simsa-inspection-fixtures/agent-bench1-local-result-2026-10-20T15-12-01-568Z-r{1,2,3}.json` · 집계 `agent-bench1-local-aggregate-2026-10-20T15-12-01-568Z.json` · stdout `agent-bench1-local-pr4s3b-2026-10-20.stdout.txt`
- 수동 정리: 0건(벤치 앱의 이전 런 기록은 그대로)

## 통과 기준 (참고 — 창 밖)

| 기준 | 값 | 10-19(PR4 첫 측정, 창 밖) | 기준선 10-18 | 판정 |
|---|---|---|---|---|
| (1) NV 3회 합산 ≤ 30% | **118/198 = 59.6%** | 120/198 = 60.6% | 123/198 = 62.1% | 불합격 |
| (2) 반대 판정 0 | 0 / 0 / 0 | 0/0/0 | 0 | 통과 |
| (3) 알려진 결함 AC pass 0 | 39셀 중 pass 0 · fail 0 · nv 39 | 같음 | — | 통과(정확성 증거 아님 — 짚음 0) |
| 앱 판정 일치 | **5 / 5 / 5** | 4 / 4 / 5 | 5 / 5 / 5 | 회귀 해소 |
| must 짚음(정답지 must id 기준) | 0/13 × 3 | 0/13 | 0.33/13 | 변화 없음 |
| 런 비용(앱당 평균) | $0.348 / $0.305 / $0.345 | — | $0.27 | H3 목표 $0.30 초과 |

## 고친 것이 작동했나 (원자료 확인)

| 수정(격차 §8) | 결과 |
|---|---|
| b-1 셋업 실패 승격 | **작동** — chatgpt 3/3에서 SETUP-1 fail → must 관문 재현 fail → CORE-1 fail 확정(`setupAttempt.promoted`), 의존 기준 `precondition_*`. chatgpt 판정 Not Verified 2/3(10-19) → **Needs Fix 3/3**(정답 broken) |
| c-3 거짓 정리 | **작동** — v0·bolt·lovable 정리 클릭 0 → `no_cancel_click`, 남음 1~4건 정직 기록(10-19는 v0 거짓 cleaned=1) |
| a-3 계측 | **작동** — 재확인 기각 사유·턴별 생각·탐침 판단이 전부 남아 아래 원인 분석이 원자료만으로 가능 |
| b-3 반복 탐침 · a-4 제출 판정 | 작동(탐침 로그) — 그리고 아래 새 사실을 드러냄 |

## 새 사실 — gemini·claude는 제출이 **아무것도 저장하지 않는다**

탐침 로그(`phases`의 `probe …`) 3런 전부: gemini "예약 완료하기"·claude "예약하기" 클릭 뒤 **`writes=0 local=false`**, 새로 나타난 글자 없음(`no_change`). 서버에도, 브라우저 저장소에도 아무것도 쓰이지 않았고 화면도 바뀌지 않았다.

- 따라서 10-20 r1에서 "2단계가 저장소 변화를 막아 셋업이 0이 됐다"는 내 진단은 **틀렸다** — 저장소 변화 자체가 없었다(`bcfcca9`의 저장소 인정 규칙은 무해하지만 이 앱엔 무관).
- 10-19에 gemini·claude 셋업이 3/3 "생성"으로 잡힌 것은 **옛 완료 판정 정규식이 화면 전체에서 '완료'를 찾던 오탐**이었을 가능성이 높다 [추정 — 10-19 원자료엔 탐침 판단 로그가 없다]. 그렇다면 10-19의 gemini·claude A3/A5 셀은 **존재하지 않는 기록을 전제로** 돌았다.
- 정답지는 두 앱 모두 사람이 하면 예약된다(A5 같은 브라우저 pass). → 에이전트의 제출이 **조용히 막히는 원인**(필수 선택 누락·비활성 버튼·입력 형식·야간 날짜)을 찾아야 한다 — 다음 조사 1순위. 스크린샷·DOM 상태(버튼 disabled, 필수 표시)를 탐침과 함께 남기는 계측이 필요.

## 남은 not_verified 118셀의 구성 (3런 합)

| 원인 | 셀(어림) | 다음 |
|---|---|---|
| gemini·claude 제출 실패 → 셋업 없음 → A3·A5·A6·A7 `precondition_not_met` | 24 | 위 "조용한 제출 실패" 조사 |
| chatgpt 의존 기준(CORE-1 결함으로 못 봄, 정당) | 12 | 정답상 확인 불가가 맞음 — 이 셀은 "결함 때문에 못 봄"으로 분모에서 따로 보고 [제안] |
| 재확인 기각(`judge_disagreed`) — lovable A3/A5, bolt A3/A6, chatgpt A2/A4 | ~14 | 기각 사유 원문(trace)으로 원인 3(a-3) 판정 — 다음 단계 |
| v0·bolt·lovable A6·A7 사유 없는 NV(야간 — 창 밖 영향 가능) | ~18 | 창 안 재측정에서 다시 본다 |
| 기타(evidence_missing·not_reached·사유 없는 자체 중단) | 나머지 | trace의 턴별 생각으로 분류 |

## 다음

1. **창 안(KST 10~17시) 재측정** — 시각은 `node … toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})`로 확인해 이 문서 양식 머리에 출력 첨부.
2. gemini·claude **조용한 제출 실패** 원인 조사(탐침에 버튼 상태·필수 표시·스크린샷 추가).
3. 재확인 기각 사유 분류 → a-3 수정.
4. #609는 draft 유지, 머지 금지.
