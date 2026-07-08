# Simsa 실행 계획 — 2026-07-09 (충돌 없는 자율 배치 + 결정 필요 트랙)

> 지시(Bae 2026-07-09): "묶어서 한번에 돌릴 일을 묶고, 충돌 없이 구현 가능한 일을
> 계획으로 만들어 내 개입을 최소화. **핵심은 돌지 않고(재작업 방지) 확실하게 두들겨가며
> 검증하며, 최종 구현 모델에 정확히 일치하게 짓는 것.**"

## 원칙 (이 배치의 판정 기준)
1. **최종모델 일치** — 지금 지어도 최종 구현 모델에서 **버려지지 않는** 것만 자율로 짓는다.
   구조가 갈아엎힐 표면 패치는 하지 않는다.
2. **돌지 않기** — 최종모델이 **명세돼 있는** 항목만 자율. 명세 없으면 설계 선행(자율 X).
3. **두들겨가며 검증** — 각 PR: 구현 → typecheck/build/test → 원격 CI green → 머지 →
   프로덕션 스모크(라이브 확인). 서버측은 유닛/엔드포인트로, 대시보드는 배포 후 실 페이지로.
4. **개입 최소** — 결정 불필요 항목만 자율 실행. 결정 필요는 T-DESIGN으로 분리해 배님께.

## ⚠️ 최종모델 명세 격차 (자율 불가의 근거)
- 감사 v2가 P1 설계 근거로 인용한 **`docs/onboarding-feasibility-layer.md`가 repo에 부재**.
  → **P1(온보딩·실현가능성)의 최종모델이 문서로 존재하지 않음.** 이 상태로 P1을 자율 구현하면
  최종모델과 어긋나 반드시 churn. **P1은 설계 문서 작성이 선행**(배님과 방향 합의).
- 존재하는 설계 문서: `simsa-acceptance-graph.md`, `simsa-autopilot-operating-model.md`,
  `simsa-visual-completion-check.md`, `simsa-external-vibe-app-completion-loop-spike.md`.
  P2(축 B find→fix→verify)는 이들과 얽혀 구조 결정 필요 → T-DESIGN.

## 충돌 맵 (파일 소유권)
- **`apps/dashboard/src/i18n/dictionary.mjs` (4,682줄) = 공유 핫스팟.** 대시보드 카피/i18n
  항목 다수가 여길 만짐 → **직렬 처리(한 번에 한 PR)**. 병렬 금지.
- **central-plane vs dashboard = disjoint.** 서버측(리포트 등)과 대시보드는 충돌 없음 →
  이론상 병렬 가능하나, "돌지 않고 확실히"를 위해 **직렬 실행**한다.

---

## T-AUTO — 지금 자율 실행 (최종모델 명확·충돌 없음·결정 불필요)

각 항목은 감사 v2가 이미 정답(정직 불변식)을 준 것. 최종모델이 어떤 플로우 구조든 살아남는다.

| # | 항목 | 감사 | 파일 스코프 | 검증 |
|---|---|---|---|---|
| **A** | **비개발자 리포트 EN/KO i18n** — `nondev-report.ts`가 `<html lang="ko">` + 한국어 하드코딩. 영어 유저엔 설명 레이어 자체가 없음. | B6 | `apps/central-plane/src/nondev-report.ts`, `workspace/repair-brief.ts` (**dashboard 무접촉 = disjoint**) | 유닛: locale=en → 영어 문자열, locale=ko → 한국어. 렌더 HTML `lang` 속성 확인 |
| **B1** | **verdict "라이브 아님" 격상** — "통과" 녹색이 "내 앱 됨"으로 오해됨. "라이브 확인 아님"을 회색 작은 글씨가 아니라 verdict급 비중으로. | 5.4 | `checks/page.tsx`, `visual-checks/*`, `dictionary.mjs` | 배포 후 실 페이지 카피 확인 + i18n EN/KO parity 테스트 |
| **B2** | **베타 크레딧/결제 노이즈 숨김** — "0/5 무료" 혼동. 베타엔 크레딧 UI 숨김. | 5.3 | `projects/[id]/credits`, `experiment`, `dictionary.mjs` | 배포 후 크레딧 배너 부재 확인 |
| **B3** | **dev-term 스윕(해당 화면)** — PR#·branch·OAuth·P0/P1 등 개발자 용어를 비개발자 카피로. | 6.5 | connect/review 관련 화면 + `dictionary.mjs` | i18n parity + 화면 카피 확인 |

**실행 순서:** A → B1 → B2 → B3 (B*는 dictionary.mjs 직렬). 각 PR 독립·머지·프로덕션 스모크.

## T-DESIGN — 배님 결정/설계 선행 (자율 X, churn 방지)
- **P1 온보딩·실현가능성 레이어** — 최종모델 문서(`onboarding-feasibility-layer.md`) **부재 →
  먼저 작성**. 세 개의 문·다섯 슬롯·되비추기·승인 게이트, 결정적 스택 감지, 실현가능성 매트릭스.
- **P2 축 B find→fix→verify** — 협의체 Refute-or-Promote·in-product fix·"내 앱 검사" 단일 입구.
  구조 결정 + acceptance-graph 연결 필요.
- **settings 분해 / FSM 스텝퍼** — 구조적이고 P1/P2 플로우와 얽힘 → 위 결정 후.
- **정체성 포크 재구현(Worker-native 협의체)** — Q1 별도 트랙(CEO 결정).

---

## 진행 로그 (완료 시 갱신 — "완료"는 머지 커밋 확인 후)
- (실행하며 채움)
