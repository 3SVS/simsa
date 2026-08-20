# Simsa 화면 설계서 — 2026-08-20 (실코드 실측 기준)

> 목적: 24개 유저 대면 화면의 **목적·진입·구성·주 CTA·상태·전이·갈래 분기**를 단일
> 문서로 성문화한다. 추측이 아니라 `apps/dashboard/src/app` 실코드 실측이며,
> 각 화면이 어떤 QA로 덮이는지(→ `docs/simsa-test-cases-2026-08-20.md`)를 함께 적는다.
> 설계 원칙의 정본은 `docs/simsa-prd.md` §6·§7·§9 — 이 문서는 "지금 실제로 이렇게
> 생겼다"의 스냅샷이다. 충돌 시 코드가 진실이고 이 문서를 고친다.

## 0. 글로벌 셸 (전 화면 공통)

- **레이아웃**: 좌측 sticky 사이드바(md+, 모바일은 상단바+드로어) + main. 언어 토글은
  main 우상단 absolute(+ `/account` 환경설정에 중복 1개).
- **사이드바**: 브랜드 → `＋ 새 프로젝트` → (프로젝트 밖) 검색+전체 목록 / (프로젝트 안)
  3단계 진행 맵 **1 준비(idea·spec·items) → 2 만들기·리뷰(github*·export) → 3 결과·수정
  (checks·visual-checks)** + Advanced(experiment·benchmark, 접힘) + Anytime(settings·
  sources). `github`은 **code 갈래 또는 repo 연결 시에만** 노출. `fixes`는 사이드바에서
  의도적 제거(라우트만 유지). 잠금 힌트 3종(need items/code/build).
- **전역 장치**: GlobalDropZone(파일 드롭→새 프로젝트), 피드백 모달(전역 이벤트),
  토스트, 클라이언트 에러 리포터, StepNextButton(화면 하단 "다음: X →", **secondary
  고정** — 화면 primary와 경쟁 금지).
- **CTA 위계 원칙**: 화면당 filled primary 정확히 1개(갈래 선택 화면만 0개가 정상 —
  동등한 문 3개). journey-audit이 이 규칙을 기계 측정한다.

## 1. 화면 목록 (경로 → 한 줄 목적)

| # | 경로 | 목적 | QA 근거 |
|---|---|---|---|
| 1 | `/projects` | 내 프로젝트 목록·복원·삭제 | [M]·[U] 삭제 캐스케이드 |
| 2 | `/projects/new` | 갈래 선택 + 3갈래 생성 위저드 | [J] J0·J1·J2 |
| 3 | `/projects/[id]` | 개요 — "지금 할 일" 단일 CTA | [J] J1 |
| 4 | `/projects/[id]/idea` | 아이디어 원문·해석 확인 | [M] |
| 5 | `/projects/[id]/spec` | 제품 브리프 검토·수정 | [M] |
| 6 | `/projects/[id]/items` | 확인 항목 확정(판정 근거) | [U]·[M] |
| 7 | `/projects/[id]/checks` | 문서·PR 검수 결과 + 다음 행동 | [J] J1·[U] checks-cta |
| 8 | `/projects/[id]/visual-checks` | 실화면 심사 실행·목록 | [S]·[M] |
| 9 | `…/visual-checks/[runId]` | 심사 리포트 + "왜 이 판정" | [J] J5·[F] |
| 10 | `/projects/[id]/export` | 빌더팩 생성(비-code 갈래 활성화 지점) | [U] 다수 · **[J] 미커버** |
| 11 | `/projects/[id]/fixes` | 수정 지시서 생성 | [U]·[M] |
| 12 | `/projects/[id]/map` | Plan Map(읽기 전용 여정 지도) | [M] |
| 13 | `/projects/[id]/settings` | repo 연결·알림·학습 동의 | [J] J3 |
| 14 | `/projects/[id]/github` | PR 골라 코드 리뷰 실행 | [U]·[M] |
| 15 | `…/github/history` | 리뷰 런 이력 | [M] |
| 16 | `…/github/history/[runId]` | 런 상세·비교·PR 코멘트·수리팩 | [U]·[M] |
| 17 | `/projects/[id]/sources` | 검수 대상 연결(사이트·repo·문서) | [M] |
| 18 | `…/sources/[sourceId]/draft` | 문서→브리프 변환 | [U] document-intake |
| 19 | `/projects/[id]/credits` | 크레딧 잔액·충전 요청(dry-run 고지) | [M] |
| 20 | `/p/[id]/connect` | **복귀 딥링크** — URL 붙여넣고 검수로 | [S] 유사 경로 · **[J] 미커버** |
| 21 | `/s/[id]` | 공유 리포트 스냅샷(읽기 전용, CTA 0) | [M] |
| 22 | `/account` | 로그인·claim·이름·언어 | [M] |
| 23 | `/login` | 로그인/가입(Google·GitHub·이메일) | [M] |
| 24 | `/pricing` | 플랜 비교 | [M] |

한 줄 처리: `/` = `/projects` 리다이렉트 · `/github/connected` = OAuth 팝업 착지 ·
`/legal/*` 정적 · `/admin/*` 운영자 전용 · experiment/benchmark = Advanced 파워유저
계기판(비개발자 여정 밖) · `not-found` = 브랜드 404(i18n 프로바이더 밖 안전).

## 2. 핵심 화면 상세

표기: **CTA**=화면의 filled primary. 상태는 코드가 실제로 처리하는 variant만 적는다.

### 2-2. `/projects/new` — 갈래 선택 + 위저드 (여정의 원점)
- **갈래 선택**(entryPath null): 동등 카드 3개(아이디어만/이미 만든 앱/기획서). CTA 0개
  가 정상 설계. `?path=`가 URL에 미러 → 뒤로가기·재진입 전부 동작, 입력 보존.
- **code step1**: 앱 이름(필수) → builtWith 칩 9종+기타 → **호스팅·데이터 칩(8/20, 선택)**
  → 설명·"꼭 작동해야 하는 것"(선택). CTA "프로젝트 만들고 코드 연결 →" → **D1 저장
  await 후** `/settings` 착지(#258 레이스 가드).
- **spec step1**: 파일 로드(hwpx·PDF·Word·txt·md)+대형 붙여넣기 → CTA "체크리스트로
  바꾸기 →" → 성공 시 step4 미리보기 직행. 로딩은 로테이팅 대기문구, 파일 오류는
  종류별 정직 안내(스캔 PDF·빈 파일·미지원 등).
- **idea 4-step**(유일한 라벨 스테퍼): ①아이디어+인터뷰(플랫폼/GitHub/AI툴/호스팅/
  데이터 — 전부 선택, 재클릭=해제) ②이해 확인(+실현가능성 경고 callout, fallback 표기)
  ③질문 4~12(항목별 "안 맞아요"→사유→재생성, 일괄 추천 수락) ④미리보기 → CTA
  "저장하고 시작 →" → 개요 착지.
- 상태: 레이트리밋 amber callout · LLM 실패 시 정직 에러(날조 초안 금지).

### 2-3. `/projects/[id]` — 개요 (커맨드 센터)
- 구성: sync 실패 배너 → 제목 → (샘플 배너) → **CommandCenterCard**: 3-스텝 미니 진행
  + **CTA 정확히 1개** — `nextProjectAction()` 상태 기계가 선택:
  `create_items→/items · connect_code→/settings · get_pack→/export ·
  run_review→/github|/visual-checks · view_results→/checks`.
  사실 미확정(null)이면 **CTA 숨김**(오도 CTA보다 무CTA — transient-null-hard-false 계보).
- get_pack일 때만 "이미 만들었어요? URL 연결 →"(`/sources`) 보조 문.
- 이하: Plan Map 카드 · 최근 심사 카드(빈 상태 문은 갈래·연결 상태별
  `inspectionEmptyStateDoor`) · StuckHelper(막힘 도우미 유일 입구) · 브리프/리뷰 요약.
- **갈래 분기(강)**: code→connect_code 우선, idea/spec→get_pack 기본에 GitHub 강등.
  설명 3줄 카피도 갈래별 상이.

### 2-7. `/projects/[id]/checks` — 확인 결과
- 섹션 1 문서 검수: 공유 버튼 → 리뷰 모드 2카드(기본/협의체 — 협의체는 무료에서 잠금
  힌트, **집행은 서버 402**) → 판정 요약 → 다음 행동 배너 → 항목 카드(펼침: 이유·증거·
  다음 단계·verification 뱃지 4종).
- 섹션 2 PR 검수: **idea 갈래에선 섹션 자체 숨김**(#328).
- **CTA 상태 기계** `checksPrimaryCta()`: connect_pr → pr_fix → draft_fix → run_precheck
  → none 우선순위로 정확히 1개 (J-audit이 primary 2개 적발했던 화면 — 회귀 가드 [U]).
- 상태: 빈(검수 유도) · 로딩(펄싱 ● + "n개째 확인 중" 카운터) · 오류(재시도 인라인) ·
  플랜 게이트(/pricing) · 통과(green→export) / 잔여(brand→fixes).

### 2-9. `…/visual-checks/[runId]` — 심사 리포트
- 위→아래: 판정 헤딩(works 칩: 작동/미작동/직접 확인 필요) → 메타(대상·의도·실행 방식)
  → 발견(쉬운 말 What/Why/How + 개발자 원문 접힘) → 스크린샷·흐름 녹화 →
  **"왜 이 판정인가요?"** `<details>`(lazy load — 3열 증거 체인, "Simsa의 해석 ≠ 측정된
  사실" 구분) → 이전 런 비교 → 재실행 → 고치기 프롬프트 복사 / 수리 PR 제안.
- 상태: loading·notfound·error·done + 활성 런(생각 중 패널)·failed(정직 실패 카드).
- 불변식 표면: 숫자 점수 0 · works=true는 사람 수용만(자동 Ready 금지).

### 2-10. `/projects/[id]/export` — 빌더팩
- fix-first 소프트 게이트(수정 브리프 없이 팩 뽑기 전 amber 안내, 하드락 아님) →
  step0 에이전트 선택 5종(+추천 배지 — builtWith·플랫폼·AI툴 답 기반, 미지=추천 없음)
  → 항목 선택 → 생성 → 결과(파일 목록·ZIP·5단계 가이드·**복귀 안내**·시크릿 zip-only
  경고).
- **갈래 분기**: idea 갈래 복귀 door는 `/p/{id}/connect` 단독(GitHub 문 숨김).
- 8/20: 팩 내용이 스택 답변을 소비(미응답=중립 물음-먼저).

### 2-13. `/projects/[id]/settings` — 준비·연결
- code 갈래 생성 직후 착지점. GitHub 연결(미연결 CTA·첫 이용자 가이드·즉시 바인딩
  고지) → 이메일 알림(테스트 발송) → 텔레그램 → 학습 동의(기본 OFF).
- 상태: loading/status_error(재시도 primary)/disconnected/connected·selecting/예시
  프로젝트 읽기 전용.

### 2-20. `/p/[id]/connect` — 복귀 딥링크
- 빌더팩이 "다 만들면 여기로"라고 지시하는 주소. 로그인·기기 무관 동작이 요구사항
  (기기 범위 안내 + /login 링크). URL 1칸 + CTA "연결하고 검수받기" → 성공 시
  `/visual-checks` 이동. 보조: "AI가 올린 코드 연결" → `/github`.

(4·5·6·8·11·12·14~19·21~24는 §1 표 + 부록 A로 충분 — 상세 필요 시 인벤토리 원본
기준으로 확장한다.)

## 3. 갈래(entryPath) 분기 매트릭스

| 화면·요소 | idea | spec | code |
|---|---|---|---|
| 사이드바 2단계 | export만 | export만 | github+export |
| 개요 PRIMARY | get_pack | get_pack | connect_code |
| checks PR 섹션 | **숨김** | 표시 | 표시 |
| export 복귀 door | connect만 | github+connect | github+connect |
| github 브리지 카드 | 표시 | 표시 | **숨김** |
| 다음 화면 순서 | idea→spec→items→export, 루프 checks→fixes→export | 동일 | settings→github→items→checks→fixes |
| /idea·/spec 빈 상태 | 데이터 있음 | 데이터 있음 | "코드에서 시작해 없어요" 안내 |

## 4. QA 커버리지 지도 (journey-audit 기준)

- **커버**: J0(갈래·idea 입구) · J1(code 완주+막힘 안내) · J2/J2e(spec) · J3(연결) ·
  J5(리포트+증거 체인). 측정 신호: primary 수·출구·데드엔드·오류·한글 누수(EN).
- **미커버 핵심 표면 2곳** — 백로그 상신:
  1. `/export` 빌더팩 — 비-code 갈래 **활성화 지점**인데 여정 기계 측정 없음(유닛만).
  2. `/p/{id}/connect` 복귀 딥링크 — 루프의 **닫힘 지점**인데 미커버.
  → journey-audit J6(팩 생성→복귀 연결) 신설 제안.
- 그 외 미커버 화면은 §1 표의 [M] — 휴먼 QA·건별 수동.

## 5. 실측 중 발견 (조치 대상)

1. **고아 라우트** `/projects/new/intake` (2,050줄) — 어디서도 링크 0건, 신규 유저
   도달 불가. 실험실 코드로 판단 → 제거 또는 "내부 실험" 명시 결정 필요.
2. `/account/notifications`는 **존재하지 않음** — 알림은 프로젝트 단위
   `/projects/[id]/settings`. 문서·안내에서 계정 단위 알림을 언급하지 않도록 주의.
3. 언어 토글이 2곳(전역 우상단 + /account) — 의도된 중복이나 상태 동기화 확인 대상.
