# Simsa 검수 verdict 정확도 실측 설계 (2026-07-17)

> HANDOFF-2026-07-17 § 남은 것의 P1 — "실제-타겟 검수 정확도 실증". P0-B(#347)가 오탐
> **원인**을 제거했지만, 타겟다운 앱에서의 verdict 정확도 **수치**는 아직 없다 = 이번의 증명 대상.

## 원칙 (잠금)

- **E1** ground truth가 알려진 데이터셋만 정확도를 주장할 수 있다. 실제 신생 vibe 앱은
  작동 여부의 정답을 모르므로, **vibe 앱 실패 아키타입을 재현한 합성 픽스처**(작동/고장을
  우리가 설계)로 측정하고, 문서에 "합성 아키타입"임을 명시한다. 실유저 앱 수치가 아니다.
- **E2** 측정은 **프로덕션 경로 전체**(worker → DO → 컨테이너 → verdict)를 통과해야 한다.
  로컬 하네스 재현은 참고일 뿐 수치의 근거가 될 수 없다 (라이브 실측 > 사전 스캔).
- **E3** 채점은 방향 구분: 작동 앱을 "고장"이라 하면 **false-negative**(P0-B가 잡은 축),
  고장 앱을 "작동"이라 하면 **false-positive**(Potemkin 놓침 축). `works=null`("확인 필요")은
  오답이 아닌 **부분점**으로 별도 집계 — 정직한 불확실 표명은 오판과 다르다.
- **E4** 측정 기록은 지우지 않는다. 결과는 이 문서에 날짜와 함께 덧붙인다.

## 데이터셋 (파라미터 — 아키타입 추가는 자유)

픽스처 워커: `tools/simsa-inspection-fixtures/` → `simsa-inspection-fixtures.seunghunbae.workers.dev`.
v0/Lovable 산출물풍(그라디언트 히어로·이모지·단일 페이지)으로 스타일링해 타겟 유사성 확보.

| # | 경로 | 아키타입 | ground truth | 기대 verdict |
|---|---|---|---|---|
| F1 | `/working-todo` | 완전 작동 할 일 앱 (localStorage, 추가·표시 실동작) | 작동 | `works=true` |
| F2 | `/noisy-working` | **작동하는데 시끄러운** 앱 — 애널리틱스/광고 로드 실패 + 콘솔 에러, 핵심 기능(단위 변환)은 실동작 | 작동 | `works=true` (#347 allowlist의 라이브 증명) |
| F3 | `/potemkin-crm` | **Potemkin** — 예쁜 UI, 저장 버튼이 존재하지 않는 Supabase 도메인으로 fetch → 조용히 무동작 | 고장 | `works=false` (#347이 유지해야 한다고 주장한 축) |
| F4 | `/js-crash` | 로드 시 JS 크래시로 버튼이 죽은 계산기 — 클릭돼도 아무 일 없음 | 고장 | `works=false` |
| F5 | `/blank` | 200이지만 본문이 사실상 빈 페이지 | 고장 | `works=false` |
| R1 | `app.trysimsa.com` | 실제 프로덕션 앱 (참조군) | 작동 | `works=false`만 아니면 통과 (복잡 SPA라 null 허용) |

## 방법

`tools/simsa-inspection-fixtures/eval-run.mjs` — 타겟마다 익명 userKey로
프로젝트 생성 → website 소스 등록 → `visual-checks/run` → 폴링(≤6분) → verdict 기록 →
프로젝트 삭제. 순차 실행(프로젝트당 1 active run 가드 + 컨테이너 부하 배려).

## 채점

- **정답**: 기대 verdict와 일치. **부분**: `works=null`. **오답**: 방향이 반대.
- 보고 수치: 정답률, false-negative 수(작동→고장 오판), false-positive 수(고장→작동 오판),
  null 수. 축별로 따로 — 단일 정확도 %로 뭉개지 않는다 (신호/잡음 분리 교훈의 채점판 버전).

## 채점 정정 (측정 1차 후)

`decideFromEvidence`에는 "Ready" 반환 경로가 없다 — **자동 검수의 상한은 "User Acceptance
Required"**(사람 수용 대기)이고 `works=true`는 사용자의 수용으로만 발생한다(제품 설계상 맞음:
Simsa는 acceptance 레이어). 따라서 채점은 works가 아니라 decision 레벨로:
- 작동 앱 정답 = **실패 스텝 0개인 User Acceptance Required** (깨끗한 수용 대기)
- 고장 앱 정답 = **Needs Fix** (works=false)

## 결과 — 1차 측정 (2026-07-17, main=02f00ca, 수정 전 베이스라인)

| # | 기대 | decision | works | 실패 스텝 | 채점 |
|---|---|---|---|---|---|
| F1 작동 todo | 깨끗한 UAR | User Acceptance Required | null | "'서울' 입력 단계 미완" | ❌ 더러운 UAR |
| F2 작동+노이즈 | 깨끗한 UAR | Needs Clarification | null | fill 예외(number 입력창) | ❌ |
| F3 Potemkin | Needs Fix | User Acceptance Required | null | "'서울' 입력 단계 미완" | ❌ **F1과 구별 불가** |
| F4 JS 크래시 | Needs Fix | Needs Clarification | null | fill 예외(number 입력창) | ❌ |
| F5 빈 페이지 | Needs Fix(또는 noPrimary null) | (2차 측정) | | | |
| R1 실제 앱 | false 아님 | (2차 측정) | | | |

**집계(1차)**: false-negative 0 ✅ (P0-B 유지 — 작동 앱을 "고장"이라 하진 않음) ·
false-positive 0 · **그러나 변별력 0** — 작동 앱과 Potemkin이 동일한 리포트를 받음.
Potemkin의 백엔드 호출은 저장 버튼이 클릭되지 않아 발화조차 안 됨.

## 근본 원인 4건 (전부 결정론 코드)

1. `pickSafeCta`가 우선순위 어휘(시작/검색/가입…) 매치를 요구 — 단일 목적 vibe 앱의 흔한
   동사 버튼(추가/저장/계산/변환…)은 score 0 → 영원히 클릭 안 됨.
2. type 경로에 **submit 클릭 스텝이 없음**(Enter만 가정) — 버튼 제출형 앱에서 액션 미발화.
3. type 성공 판정이 `bodyLen > 200` **절대 크기** — 콘텐츠 사이트 기준이라 작은 앱 카드는
   실제 동작과 무관하게 항상 "단계 미완".
4. `pickPrimaryInput`이 input type 무시 — number 입력창에 "서울" fill → Playwright 예외 →
   interacted=false로 오염.

## 수정 설계 (2차 측정 전)

- **D5 [LOCKED 원칙/파라미터 어휘]** CTA 선택 3단: ① intent 문장에 텍스트가 그대로 등장하는
  CTA 최우선(사용자 의도의 결정론 반영) ② 액션 동사 어휘 확장(추가·저장·기록·계산·변환·
  만들기·생성·조회 등 — 파라미터) ③ 감지 CTA가 소수(≤4)면 첫 안전 CTA 폴백(단일 목적 앱 형상).
  forbidden 필터는 모든 단계에 그대로.
- **D6 [LOCKED]** type 경로는 **type → (안전 CTA 있으면) submit 클릭 → observe** 합성으로.
  이것이 Potemkin의 백엔드 fetch를 실제로 발화시키는 단계다.
- **D7 [LOCKED]** type/관찰 성공 판정은 절대 크기가 아니라 **변화**(액션 전후 body 텍스트
  변화 또는 라우트 변화) + 신규 네트워크 실패 없음.
- **D8 [LOCKED]** 입력값은 input type을 존중 — number형엔 숫자 샘플("5"), 그 외 sampleQuery.

측정 2차(수정 배포 후 동일 데이터셋 재실행) 결과를 아래에 덧붙인다.

## 결과 — 2차 측정 (2026-07-17, D5~D9 배포 후 main=95faf42, 컨테이너 재빌드 확인)

| # | 기대 | 1차 (수정 전) | 2차 (수정 후) | 채점 |
|---|---|---|---|---|
| F1 작동 todo | 깨끗한 UAR | 더러운 UAR ("'서울' 입력 미완") | **깨끗한 UAR** (실패 스텝 0) | ✅ |
| F2 작동+노이즈 | 깨끗한 UAR | Needs Clarification (fill 예외) | **UAR** (변환 실동작; 심은 console.error는 low finding으로만 표기) | ✅ |
| F3 Potemkin | Needs Fix | UAR — **F1과 구별 불가** | **works=false Needs Fix** — "데이터를 가져오는 서버 주소를 찾지 못했어요" (D6 저장 클릭이 죽은 Supabase 호출을 발화) | ✅ |
| F4 JS 크래시 | Needs Fix | Needs Clarification | UAR + "버튼 누른 뒤 화면 확인 미완" — **D9 미발화** | ⚠ 갭 발견 |
| F5 빈 페이지 | 정직한 안내 | NC + "무엇을 눌러야 할지 못 찾음" | 동일 (기대대로) | ✅ |
| R1 실제 앱 | false 아님 | NC (false 아님) | (컨테이너 슬롯 대기 후 재측정) | — |

**핵심 개선: 변별력 0 → 작동앱과 Potemkin이 정확히 구별됨.** false-negative 0 유지.

**F4 갭의 원인(잔여 1건)**: 로드시 uncaught 예외는 Playwright에서 `console`이 아니라
`pageerror` 이벤트로 온다 — 실행기가 console만 수집해 `consoleErrorCount=0`, D9 conjunction
발화 불가. 수정 = `page.on("pageerror")` 수집 1줄 + 인베리언트 테스트 (**PR #353**). 머지·
배포·컨테이너 재빌드 후 F4 3차 측정으로 확인한다.

## 결과 — 3차 측정 (2026-07-17, #353 배포·컨테이너 재빌드 후 main=2b44a21)

| # | 기대 | 3차 결과 | 채점 |
|---|---|---|---|
| F4 JS 크래시 | Needs Fix | **works=false Needs Fix** — "화면에서 코드 오류가 났어요" (pageerror 수집 → D9 발화) | ✅ |
| R1 실제 앱 (app.trysimsa.com) | false 아님 | UAR (수용 대기) | ✅ |

**최종 집계: 6/6 정답** (F1 깨끗한 UAR · F2 UAR · F3 Needs Fix · F4 Needs Fix · F5 정직한
NC · R1 UAR). false-positive 0 · false-negative 0. 베이스라인의 변별력 0 → 작동/Potemkin/
크래시/빈페이지가 전부 구별됨. 원자료: `tools/simsa-inspection-fixtures/eval-results-*.json`
(베이스라인은 `baseline-*.json`).

## 결과 — 실제 앱 확장 (2026-07-17, 배 "실유저 vibe 앱 재확인")

| # | 대상 | 결과 | 채점 |
|---|---|---|---|
| R2 | golf-now.vercel.app (실작동 앱) | UAR/null — "'현재 위치 날씨 확인' 클릭 미완"(헤드리스 위치권한) | ✅ false 아님 |
| R3 | trysimsa.com (실작동 랜딩) | **works=false "필요한 데이터를 불러오지 못했어요"** | ❌ **false-negative 발견** |

**R3 원인(증거 확보, `evidence-probe.mjs`)**: Next.js **RSC 프리페치**(`GET /demo?_rsc=…`)가
trysimsa.com→simsa.dev 교차 도메인 리다이렉트에서 CORS(`rsc` 헤더)로 실패 → 앱 도메인 실패로
집계 → Needs Fix. 실제 사용자의 클릭은 전체 탐색이라 정상 동작 — 프리페치 실패는 사용자
플로우를 깨지 않는 **프레임워크 노이즈 클래스**다.
**수정**: `isNoiseResource`에 `[?&]_rsc=` 경로 마커 추가(좁은 클래스만 — Potemkin 백엔드
호출엔 `_rsc`가 없어 계속 잡힘). 양방향 테스트 추가. **부수 발견**: 랜딩 /demo가 구 도메인
simsa.dev로 리다이렉트되는 것 자체는 사이트 정리 대상(별건).
**재검수(#361 배포·컨테이너 롤아웃 후)**: R3 → **works=null "확인 필요"로 교정 ✅** (CORS
콘솔 메시지는 low finding으로만 표기, verdict 비영향). 실제 앱 확장 최종: R1·R2·R3 전부
false 아님.

