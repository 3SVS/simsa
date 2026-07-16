# Simsa 정확도 P0 2건 (설계 노트)

> 상태: 설계 확정, 구현 착수. Bae 지시(2026-07-17, 실측 평가 리포트 후 "착수해").
> 근거: `simsa-assessment.html` 실측 — 아이디어→스펙 앞단은 견고하나 두 곳에 확인된 갭.
> 진실의 소스: `docs/simsa-prd.md`.

## 근본 문제 (2026-07-16 실측으로 확인)

**P0-A 실현가능성 경고 부재** — "아이폰 3D 실시간 멀티플레이 게임"을 웹 빌더로 불가능한데도
경고 없이 웹앱 스펙("Google/Apple 로그인·클라우드 서버·인앱결제")으로 생성. 비개발자가
v0/Lovable로 못 만든다는 신호 전무. PRD §6.1이 P1 미결로 인정한 갭이 프로덕션에 살아있음.

**P0-B 시각 검수 false-negative** — 완벽히 작동하는 vercel.com을 "작동 안 해요 — 고쳐야
해요"로 오판. 원인은 실제 결함이 아니라 검수 도구 한계: (1) 봇차단/서드파티 403·네트워크
실패를 결함으로 셈, (2) 복잡한 SPA의 CTA 클릭 8초 타임아웃을 "기능 고장"으로. 판정 사다리
`decideFromEvidence`의 `networkFailures.length || consoleErrors.length → Needs Fix`가
first-party(대상 앱)와 third-party(애널리틱스·봇차단·광고·CDN)를 구분하지 않음.

## 결정

- **D1 [LOCKED]** 실현가능성은 **결정론적으로 감지**(LLM 판단 아님). `detectNonWebBuildable()`가
  아이디어+컨텍스트에서 네이티브 신호(아이폰/안드로이드 앱·게임엔진·3D 게임·앱스토어 출시·
  데스크톱 exe·하드웨어/IoT·브라우저 확장)를 매칭. 감지 시 (a) 프롬프트에 "웹으로 완전 구현
  불가임을 정직히 알리고, included에 무리한 네이티브 기능을 넣지 말고, 웹으로 되는 프로토타입
  범위 + 네이티브는 전문 개발 필요를 excluded/openQuestions에 명시" 규칙 주입, (b) 응답
  `warnings`에 결정론적 정직 경고 1줄 추가(서버에서, LLM 무관). **원칙 잠금, 마커·문구는
  파라미터.** 완전한 플랫폼 매트릭스 UI(web_buildable/mobile_handoff/other_handoff)는 P1(#296).

- **D2 [LOCKED]** 검수 증거를 **first-party vs third-party로 분류**. 대상 앱 URL의
  등록가능도메인(eTLD+1 근사: 마지막 2개 라벨)과 같으면 first-party(서브도메인 API 포함 →
  Potemkin 감지 유지). 네트워크 실패·콘솔 에러·HTTP 4xx/5xx 각각에 URL을 붙여 판정.

- **D3 [LOCKED]** 판정 사다리 재작성:
  - **first-party** 네트워크 실패/4xx-5xx/콘솔 에러 → `Needs Fix` (백엔드 미연결 = Potemkin
    핵심 신호, 유지·강화).
  - **third-party만** 실패 → 그것만으로는 `Needs Fix` 아님. 다음 신호로 진행.
  - 유일한 문제가 **CTA 클릭 실패(step fail)**뿐이고 first-party 결함이 없으면 →
    `User Acceptance Required`(사람이 눈으로 확인). "버튼을 못 찾음"을 "앱이 고장"으로 단정 않음.
  - 로드 자체 실패(5xx/DNS)는 **빈 리포트 금지** — 명확한 verdict + finding.

- **D4 [LOCKED]** finding 생성도 동일 분리: third-party 실패는 finding에서 제외하거나 info로
  격하, first-party만 high. **정확도 방향은 관대함이 아니라 "결함 신호와 도구 잡음의 분리"** —
  진짜 Potemkin(first-party API 404/500)은 여전히 강하게 잡아야 한다.

## 스테이지

- **S1 (central-plane, P0-A)** — `detectNonWebBuildable()` + 프롬프트 정직성 규칙(KO/EN) +
  warnings 주입 + 테스트. 가벼움(generate.ts). 대시보드는 기존 warnings 표시 재사용.
- **S2 (central-plane + 컨테이너, P0-B)** — 에러 URL 구조화 수집(`m.location()`, response
  4xx 포함) + first-party 분류 헬퍼(src 공유) + `decideFromEvidence` 재작성 + `classifyFindings`
  분리 + 테스트. **컨테이너 이미지 재빌드 필요.**

배포: S1 → central 1회. S2 → central 1회(컨테이너 포함). 라이브 재검증: 모바일 게임 → 정직
경고 확인 / vercel.com → 더 이상 오탐 아님 확인.

## 게이트 레지스트리

| 게이트 | 문구 | 발효 |
|---|---|---|
| 설계 잠금 | (Bae "착수해"로 착수 승인) | D1~D4 LOCKED, 구현 착수 |
| 배포 | `deploy <target> approved.` 건별 | 미발효 — S1/S2 완료 후 |

## 비목표

- 완전한 온보딩 플랫폼 매트릭스 UI (P1, #296 설계 문서)
- 검수 정확도의 실제-타겟(신생 vibe 앱) 수치 실증 — 별도 데이터셋 필요, 이번 범위는 오탐 원인 제거
- LLM 기반 실현가능성 판정 — 결정론 우선(예측·테스트 가능)
