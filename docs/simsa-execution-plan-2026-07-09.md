# Simsa 실행 계획 — 2026-07-09 (충돌 없는 자율 배치 + 결정 필요 트랙)

> **최종모델 정본 = `docs/simsa-prd.md` (PRD).** 모든 작업은 그 PRD의 해당 절에 정확히 일치하게
> 짓는다. 이 문서는 "그 PRD의 무엇을 어떤 배치로, 충돌 없이 짓는가"의 실행 계획이다.

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

## 최종모델 문서 인벤토리 (존재함 — 흩어져 있을 뿐)
> 정정: 초판에서 "P1 설계 문서 없음"이라 성급히 단정했으나 **설계·스펙이 상당히 존재**한다.
> 단일 PRD로 통합돼 있지 않고 흩어져 있으며 일부는 Conclave 시대 프레이밍이다.

- **제품 정의/운영모델:** `simsa-autopilot-operating-model.md` (472줄) — "AI software acceptance
  and governance layer" 정의·거버넌스 정책. **제품이 무엇인지의 최종모델.**
- **핵심/해자:** `simsa-acceptance-graph.md` — "의도→PRD→빌드→수용증거" 체인, 데이터 계약·헬퍼.
- **★UIUX 최종모델 (Bae 지시서):** `uiux-redesign-instructions.md` — 5항목, 순서 **#5(CTA위계)
  최상위→2→1→3**, 디자인 위생 규칙(로고박스/blur/emoji/반복카드 금지), EN/KO 전수, 화면별
  primary 하나. **UIUX 자율 작업은 이 문서에 정확히 앵커.**
- **prep 레이어:** `design-prep-layer.md`. **시각 완료 체크:** `simsa-visual-completion-check.md`.
  **완료 루프 스파이크:** `simsa-external-vibe-app-completion-loop-spike.md`.
- **방향(target):** 감사 v2 §2c/3c/4c/5c. **로드맵:** `dev-roadmap.md`(Conclave 프레이밍).
- **메모리:** `SIMSA-overview.md`, `feedback-simsa-product-boundary.md`,
  `feedback-ux-basics-gate-before-ready.md`, `feedback-intake-sprint-a-d.md` 등.

**실제 격차(좁음):** 감사가 P1 근거로 인용한 `onboarding-feasibility-layer.md` 파일명만 부재.
P1 방향은 audit §5c + `design-prep-layer.md` + operating-model에 흩어져 있음 → **완전 블랭크
아님, "통합 미비".** P1 자율 구현 전엔 이 흩어진 것을 P1 스펙 하나로 모으는 게 선행(T-DESIGN).

## ⚠️ 검증 방법 제약 (돌지 않기의 핵심)
- **서버측/로직/카피(EN·KO)** = 유닛·엔드포인트·프로덕션 스모크로 **자율 확실 검증 가능.**
- **시각/레이아웃/위계(UIUX #5·#1·#2·#3)** = 화면을 봐야 판정. 대시보드 스크린샷을 자율로
  못 뽑으면 눈 없이 추정 → **churn(배님 #1 원칙 위반).** uiux 지시서 자체가 "휴먼 QA(Bae 유저
  시점)"를 오픈 게이트로 둠. → **시각 UIUX는 (a) 스크린샷 검증 루프 확보 후 자율, 또는
  (b) Bae 시각 패스** 중 택1. 그전엔 시각 항목 자율 착수 보류.

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
검증: A/B1/B2/B3 전부 서버측 또는 카피/i18n → 시각 판정 불필요, 자율 확실 검증 가능.

## T-VISUAL — UIUX 지시서 항목 (최종모델 = uiux-redesign-instructions.md; 검증법 결정 선행)
> 최종모델은 명확(배님 지시서). 다만 시각 검증법 확보 전엔 churn 위험 → (a) 스크린샷 루프 or
> (b) Bae 시각 패스 택1 후 착수. 순서는 지시서 그대로: **#5(CTA위계)→2→1→3** (#4 완료).
- **#5 화면별 primary CTA 위계 ★최상위** — 전 화면 전수, "대비로 위계 재정렬"(크기 아님).
- **#2 확인결과 요약 재배치**(3초 파악) · **#1 개요 컴팩트 진행 표시**(`computeProjectSteps`
  재사용) · **#3 "+N개 더" 인라인 펼침**(중요도 기준 노출).

## T-DESIGN — 스펙 통합/구조 결정 선행 (자율 X, churn 방지)
- **P1 온보딩·실현가능성** — 흩어진 방향(audit §5c + `design-prep-layer.md` + operating-model)을
  **P1 스펙 하나로 통합**하는 게 선행. 그 후 구현. 세 개의 문·다섯 슬롯·결정적 스택 감지·매트릭스.
- **P2 축 B find→fix→verify** — `simsa-acceptance-graph.md`/operating-model 기반 구조 결정 +
  "내 앱 검사" 단일 입구 + in-product fix. acceptance-graph 라이브 연결.
- **settings 분해 / FSM 스텝퍼** — 구조적, P1/P2와 얽힘 → 위 결정 후.
- **정체성 포크 재구현(Worker-native 협의체)** — Q1 별도 트랙(CEO 결정).

---

## 진행 로그 (완료 시 갱신 — "완료"는 머지 커밋 확인 후)
- (실행하며 채움)
