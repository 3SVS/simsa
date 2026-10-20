# v2 S0 — 최강 모델 도달성 실측 + "직접 적은 항목" 확인 (2026-10-21)

> 게이트: `train v2-S0 start approved.` (Bae, 2026-10-21 KST 01:1x). 설계: `docs/simsa-inspector-v2-design-2026-10-07.md` V-5 · §5 S0.
> 보고 세 칸(EVIDENCE-RULE R2): 라이브확인 / 테스트만 / 미측정.

## 1. 최강 모델 도달성 (V-5 "프로덕션에서 실제로 닿는 가장 강한 모델")

### 1.1 프로덕션 Worker egress — 기존 프로브(`ops-probe` llm-probe, n=1)
실행: GitHub Actions run 39456412358, **KST 2026-10-21 01:19**. 기본 모델만(Haiku 4.5 · gpt-5.4 · gemini-2.5-flash).

| 벤더:경로 | 상태 | usable | 지연 |
|---|---|---|---|
| anthropic:gateway | **200** | **true** | 850ms |
| anthropic:direct | **200** | **true** | 715ms |
| openai:gateway | 200 | true | 2778ms |
| gemini:gateway | **402** "prepayment credits are depleted" | false | 721ms |

- **Anthropic이 Worker에서 다시 열렸다** — 2026-08-21~25 실측은 403 "Request not allowed"(시간대별 차단 포함)라 `ANTHROPIC_ENABLED="off"`(wrangler.toml)로 꺼 두었고, **지금 프로덕션 검수는 전부 OpenAI 폴백**(strong = gpt-5.4, cheap = gpt-5.4-mini)으로 돈다. 단, 8월에도 시간대에 따라 열리고 닫혔으므로 **n=1·1회는 결론이 아니다** → §3 반복 측정.
- **Gemini는 결제 문제**(선불 크레딧 소진) — 지역 제한이 아니라 계정 잔액. Bae 액션(AI Studio 결제) 전엔 후보에서 뺀다.

### 1.2 후보 모델 — 로컬(노트북 egress) 실측, KST 01:2x
우리 OpenAI·Gemini 키로 열린 모델(`/v1/models`·`/v1beta/models`)에서 최상위 후보를 골라, **에이전트 한 턴과 같은 모양**의 과제 1개로 쟀다: 예약 폼(버튼 "10:30" · "여성 커트" · "예약 완료하기") + 앱 팝업 "시술 메뉴를 최소 하나 이상 선택해주세요." → 다음 행동 JSON. 정답 = "여성 커트" 클릭(10-21 gemini 재연과 같은 상황).

| 모델 | 상태 | 정답 행동 | 지연 | 출력 토큰 |
|---|---|---|---|---|
| gpt-5.4 (**현 strong**) | 200 | **✗** — "확인" 버튼으로 팝업 닫기 | 1.9s | 34 |
| gpt-5.5 | 200 | ✓ 여성 커트 | 2.9s | 108 |
| gpt-5.6-luna | 200 | ✓ | 2.2s | 57 |
| gpt-5.6-sol | 200 | ✓ | 2.2s | 63 |
| gpt-5.6-terra | 200 | ✓ | 1.5s | 36 |
| gpt-5.5-pro | 404 (chat 엔드포인트 아님 — Responses API 전용) | — | — | — |
| gemini-3.1-pro-preview · 3.8-flash · 2.5-pro | 402 크레딧 소진 | — | — | — |
| Anthropic 최상위(opus-5-5 · fable-5-1) | 로컬 키 없음 — **미측정** | | | |

- **n=1 과제 1개**라 능력 순위의 근거가 아니다. 그래도 방향은 분명하다: 현 strong(gpt-5.4)이 이번 장비 결함과 똑같은 상황에서 틀린 행동을 골랐고, 더 새 모델 4개는 모두 맞혔다.
- 값(가격)은 `priceTokens` 표에 없는 모델이 있다 [미확인] — 후보 확정 전 가격 표 갱신 필요(V-6 비용 기록).

## 2. "직접 적은 항목" 의심 버그 (설계 §2.3·S0)

- **현재 코드에서 재현되지 않는다.** 직접 적은 항목(id `user_…`)은 모든 입구에서 확인 목록에 들어간다: `IntentConfirmCard.confirm`(`kept` = 남긴 항목 + 적은 항목 → `intentConfirmedItemIds`) · 항목/소스 초안/GitHub 화면은 `withUserAuthoredItems`(대시보드 테스트 `train-c-a7-*` 3개). 서버는 확인 계획(`planInferredConfirmation`) → must 승격(`applyInferredConfirmation`) → `userTextAcIdsOf` → 검사 AC must·`user_text`(agent-inspection G2 테스트).
- 끊겨 있던 것은 **서버 가운데 고리의 직접 테스트**였다 → `test/v2-s0-user-text-must.test.mjs` 추가(체크 + 직접 적은 항목 → must · 확인 목록에 없으면 must 아님을 함께 잠금).
- 10-07 의심의 원인(파일럿 Claude 앱)은 10-05 이전 카드가 직접 적은 항목을 확인 목록에 넣지 않던 시기 [추정 — 당시 원자료 미확인].

## 3. 이 PR이 바꾸는 것 · 다음 측정

- `POST /internal/llm-probe?models=vendor:model,…` — **닫힌 허용 목록**(`PROBE_MODEL_ALLOWLIST`: Anthropic Haiku 4.5·Sonnet 5.5·Opus 5.5·Fable 5.1 / OpenAI gpt-5.4·5.4-mini·5.5·5.6-luna·sol·terra / Gemini 2.5-flash·2.5-pro·3.1-pro-preview·3.8-flash) 밖이면 400, 한 번에 ≤8. 결과·요약에 모델 이름.
- `ops-probe.yml`에 `models`·`n` 입력(env로 받아 글자 집합 검사 — 워크플로 주입 방지).
- **다음(배포 뒤, `deploy central-plane approved.` 필요)**: KST 10시·15시·22시·02시 네 시각 × `n=4` × 후보(Anthropic opus-5-5·fable-5-1·sonnet-5-5 + OpenAI 5.6-sol·5.6-terra·5.5)로 도달·usable·지연을 재고, V-5 모델을 확정한다. 확정 뒤 `ANTHROPIC_ENABLED` 되돌림·`INSPECT_AGENT_MODEL` 변경은 각각 별도 승인.

## 세 칸 보고
- 라이브확인: 프로덕션 Worker에서 Anthropic Haiku 200·usable(1회) · Gemini 402(크레딧 소진) · OpenAI gpt-5.4 200.
- 테스트만: 프로브 모델 지정·허용 목록·상한(18/18) · 직접 적은 항목 must 연결(2/2).
- 미측정: Anthropic 최상위 모델의 Worker 도달성 · 시간대별 반복 · 후보 모델의 실제 검사 품질(벤치 기준).
