# RC-6 실측 — 검수 합의 레이어 정확도 (2026-07-18)

RC-6(도입 전 실측 게이트) 이행 기록. 도구: `tools/simsa-review-consensus-eval/run.mjs`
(프로덕션 실호출 — panel은 익명 기본, council은 probe userKey에 일시 grant→revoke).

## 방법

check-draft의 판단 기준(check.ts 프롬프트에 명시된 4개 상태 규칙)으로 **정답이 결정
가능한** 케이스 6종을 구성했다. 핵심 지표는 정답 일치율과 **유해 오탐**(정답이 failed가
아닌데 failed로 선고 — RC-2/RC-3의 존재 이유가 이것의 감소다). 오탐 유도 케이스 2종 포함:

| 케이스 | 정답 | 설계 의도 |
|---|---|---|
| excluded-conflict | failed | 제외 범위 정면 충돌 — 진짜 결함 신호 유지 확인 |
| clear-included | passed | 포함+구체 기준 3개 |
| no-criteria | inconclusive | 기준 없음·추상 |
| open-question-linked | needs_decision | 미결정 항목 직결 |
| false-positive-bait | passed | 결정 사항과 일치하는 정상 항목 — failed면 유해 오탐 |
| excluded-partial-words | passed·inconclusive 허용 | 제외 문구와 단어만 겹침(실제 무관) — failed면 유해 오탐 |

## 결과 (2026-07-18, 프로덕션)

| 모드 | 정답 일치 | 유해 오탐 | 비고 |
|---|---|---|---|
| **panel (A, 전원 기본)** | **6/6** | **0** | excluded-conflict가 `dual_confirmed` — 교차 확인이 진짜 결함을 확정 |
| **council (B, 유료)** | **6/6** | **0** | 6건 전부 `council_agreed`(3벤더 1라운드 만장일치) |

- 진짜 결함(excluded-conflict)은 두 모드 모두 failed 유지 — 관대화가 아니라 신호/잡음
  분리라는 설계 의도대로 (미탐 0).
- 오탐 유도 2종(bait·partial-words)은 두 모드 모두 통과 — 유해 오탐 0.
- **RC-6 게이트 판정: 통과** — 두 모드 모두 베이스라인(≤단일 판정) 이상, 배포 유지.

## 한계·다음

- 픽스처가 6종·명확 케이스 중심이라 천장 효과 — 두 모드 간 차이는 이 세트로는 변별
  불가. 변별은 **실유저 코퍼스**(모호한 스펙·긴 항목 목록)에서 재실측한다. 그때
  council_split 발생률과 다운그레이드 빈도가 관건 지표.
- 비용 실측은 이제 쌓이는 `llm_usage` 로그(#375)로 — RC-7 단가 산정의 입력.
