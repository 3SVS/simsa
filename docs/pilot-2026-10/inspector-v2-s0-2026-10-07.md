# 검사 엔진 v2 · S0 실측 기록 (2026-10-07)

설계 정본: `docs/simsa-inspector-v2-design-2026-10-07.md`(PR #603) §5 S0 — "최상급 모델 도달성 실측(V-5) + '직접 적은 항목' 버그 확인".

## 1. 최상급 모델 도달성

### 1-a. 로컬 실측(라이브 확인 — 이 PC, OpenAI 키 1개, 키는 출력하지 않음)

`GET /v1/models`(200)에 gpt-5.6-sol·terra·luna, gpt-5.5(-pro), gpt-5.4가 있다. 함수 도구 호출 1회씩:

| 모델 | Chat Completions + tools | Responses + tools | 단가(입력/캐시/출력 $/1M, 2026-10-07 공식 페이지) |
|---|---|---|---|
| gpt-5.6-sol | ✗ 400 "Function tools with reasoning_effort are not supported … in /v1/chat/completions" | ✓ 200, 2.3s, `click({"name":"예약하기"})` | 4.00 / 0.40 / 20.00 |
| gpt-5.6-terra | ✗ 400 (같은 이유) | ✓ 200, 1.3s | 2.00 / 0.20 / 12.00 |
| gpt-5.6-luna | ✗ 400 | ✓ 200, 1.2s | 0.20 / 0.02 / 1.20 |
| gpt-5.5 | ✓ 200, 1.6s | ✓ 200, 1.7s | 5.00 / 0.50 / 30.00 |
| gpt-5.5-pro | ✗ 404(채팅 모델 아님) | ✓ 200, 13.3s | 30 / — / 180 |
| gpt-5.4 | ✓ 200, 1.7s | — | 2.50 / 0.25 / 15.00 |

등급: OpenAI 발표("Previewing GPT-5.6 Sol") 기준 Sol이 5.6 계열 최상위. → **v2 기본 = `gpt-5.6-sol`, Responses API 전용**(기존 프록시의 Chat Completions 경로로는 도구 호출이 안 된다 — 새 경로가 필요한 이유).

Anthropic: 이 PC에 키가 없다(`ANTHROPIC_API_KEY` 미설정) → **미측정.** 프로덕션은 2026-08 실측 이후 `ANTHROPIC_ENABLED="off"`.

### 1-b. 프로덕션 경로(미측정 — Bae 승인 필요)

워크플로·배포를 돌리지 않았다. 코드 경로상 v2 호출은 Worker → `CF_AI_GATEWAY_OPENAI_URL` + `/responses`(게이트웨이 OpenAI 통과 경로) → 실패 시 OpenAI 직행. 프로덕션 키가 로컬 키와 같은 계정·같은 모델 권한인지는 모른다.

이번 PR은 `/internal/llm-probe`에 **`openai_v2:gateway` · `openai_v2:direct`** 항목을 더했다(v2 모델 + Responses + 함수 도구, usable = 함수 호출을 실제로 돌려받음, 최대 출력 512토큰 — 1회 약 $0.01 이하). 측정 순서(각각 Bae 승인 문구로만):

1. 지금 바로(배포 없이) Anthropic 도달성 재확인 — 기존 승인 경로: `gh workflow run ops-probe.yml -f target=llm-probe` → 결과의 `anthropic:gateway`·`anthropic:direct` usable.
2. 이 PR 머지·배포 뒤 v2 모델 도달성: 같은 명령 → `openai_v2:gateway`·`openai_v2:direct`의 usable·`detail: model=…`.

1에서 Anthropic이 usable이면 Anthropic 최상위 모델과의 비교를 S7 평가에 추가한다(어댑터 필요). 아니면 gpt-5.6-sol 확정.

## 2. "직접 적은 항목" 버그(파일럿 Claude 앱) — 실재 확인

- 프로덕션 결과 파일(`agent-pilot1-prod-result-2026-10-06T15-18-54-177Z-r1.json`, claude): 사용자 흉내가 "빠진 것" 6개(user_1~6)를 적었고 지시서 생성은 200인데, 실행기 기준은 **CORE-1 + AC-007~010(전부 추론 항목, should/could)** 4개뿐 → "꼭 되어야 하는 것으로 체크하신 항목이 없어서…". 사용자 항목에서 나온 **AC-001~006이 실행기 기준에서 통째로 빠졌다.**
- 로컬 재현(같은 생성 함수, 같은 카드 입력): 사용자 항목 6개 → must 기능 6개 · AC 11개 중 2개가 `verifiedBy:"human"`("정확한 진단", "전달 가능한 형식" 같은 판단형 문장). `agentAcsFromDevSpec`이 **human AC를 무조건 버리는** 줄 때문에 사용자 must가 빠진다. 프로덕션은 6개 전부가 human으로 나온 경우와 일치(번호 001~006 결번).
- 수정: 사용자가 확인한(직접 체크·직접 적은) must 기준은 human 표시여도 실행기 기준에 넣는다(에이전트가 사람처럼 해 본다). 확인 안 된 human 기준은 종전대로 뺀다. 회귀 테스트는 옛 코드에서 실패(무조건 `continue`).
