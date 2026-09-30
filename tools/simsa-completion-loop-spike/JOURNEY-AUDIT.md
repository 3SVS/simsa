# journey-audit — 실브라우저 여정 감사 (오픈 게이트 표준 장비)

> 신설 2026-07-20(P0 2건 즉발: CORS PUT 전멸·locale 분열), v2 승격 2026-07-21
> (실행계획 Train J). **근거 교훈: node/curl 프로브는 CORS·locale·발견성을
> 구조적으로 못 본다 — 여정은 실브라우저로만 측정된다.**

## 무엇을 재나

- **여정**: J0 아이디어 입구 · J1 code 갈래 완주 · J2 spec 갈래 · J3 연결 여정
  (아이디어 갈래의 깊은 생성 플로우는 `flow-audit.mjs` 소관 — 중복 금지)
- **축**: KO 전체 + EN(입구 전수 + code 완주) — EN은 한글 누수(koLeak)도 측정
- **스텝별 결정론 신호**: primary CTA 수(#5 위계) · 출구 존재(UX Basics ①) ·
  데드엔드(⑤) · 비활성 버튼(③) · 오류/안내 카피(④) · 스크린샷
- **자동 분류**: P0(여정 실패·happy path 오류) / P1(CTA 0 또는 ≥3·EN 한글 누수)
  / P2(비활성 이유·막힘 안내 부재). **후보 누락 방지용 기계 패스** — 최종 판정은
  사람이 result JSON + 스크린샷을 읽고 내린다(스크립트는 측정만).

## 실행

```bash
cd tools/simsa-completion-loop-spike
node journey-audit.mjs            # KO+EN 전체 (기준선·게이트용)
node journey-audit.mjs --ko-only  # KO만 (수정 후 빠른 재감사)
```

산출물: `journey-audit-result.json`(steps+findings) · `journey-audit-shots/*.png`

### J6 만들기 여정 — 로컬 가짜 서버 모드 (B-8, 2026-09-30)

**J6 = 아이디어 → 지시서 → [만들기] → 진행 화면(→ 멈춤 또는 내 앱 카드).** [만들기]는 실제 빌드
잡을 시작한다(호스팅 D1 생성·컨테이너·LLM 비용) — **라이브에서는 절대 돌리지 않는다.** 로컬
`next build`+`start` 위에서 central-plane 응답을 Playwright route로 가짜 주입해서만 돈다
(`lib/fake-central.mjs` — 라이브 central 주소와 가짜 주소 둘 다 가로채, 브라우저 밖으로 나가는 API 요청 0).

```bash
cd apps/dashboard
NEXT_PUBLIC_CENTRAL_PLANE_URL=https://central.fake.invalid CENTRAL_PLANE_AUTH_ORIGIN=http://127.0.0.1:9 npx next build
npx next start --port 3187 &          # 다른 세션이 3002를 쓰고 있을 수 있다
cd ../../tools/simsa-completion-loop-spike
node journey-audit.mjs --local http://localhost:3187            # KO(멈춤·끝) + EN(멈춤)
node journey-audit.mjs --local http://localhost:3187 --ko-only
```

- `.invalid`로 구우면 가로채기를 놓친 요청도 라이브에 닿지 못한다(DNS 실패). `--local`은 localhost만 받는다.
- 시나리오: `not_implemented`(지금 실제 서버의 정직한 실패 — `builder_stage_not_implemented:build`) ·
  `done`(서버 상태 순서대로 끝까지 → 내 앱 카드). 가짜 옵션(#578 검증 결함 반영): `open:false`(서버가 만들기를 열지
  않음 — 지금 프로덕션: `BUILD_ENABLED = "off"`, POST /build와 같은 스위치 하나 → `reason: "build_disabled"`) ·
  `retryConflict:true`(central 수정 **전** 서버 — 같은 프로젝트의 두 번째
  POST /build가 D1 이름 충돌로 `502 hosting_d1_failed`).
- 여정 5개: KO 멈춤(수정 전 서버의 다시 시도) · KO 끝 · KO 닫힘 · EN 멈춤(수정 뒤 서버 — 다시 시도 = 새 잡) · EN 닫힘.
- J6 기대값(어긋나면 P0): **개요 '지금 할 일'**이 만들기 전 [앱 만들기] · 만드는 중 [진행 상황 보기] · 만든 뒤
  [내 앱 보기] · 멈춘 뒤 [멈춘 이유 보기](어느 때도 "만들기 안내 받기"가 아님) · 지시서 화면 주 버튼 = [만들기] 하나 ·
  시작 전 안내(비용 없음·Simsa 주소) · A 경로 문장 없음 · 진행 화면 제목 '내 앱' · 지금 단계 정확히 하나 · 진행률 % 없음 ·
  **탭 숨김 11초 동안 잡 조회 0, 돌아오면 3초 안에 1**(가짜 호출 계측) · 멈춤 문구 + "비용은 받지 않았어요" + 주 버튼
  [지시서 받아가기] + [다시 시도] · **[지시서 받아가기]를 눌러** 같은 화면에서 지시서 `.md` 한 파일이 받아짐(개발 도구
  프롬프트·비밀 파일 없음) · 새로고침 복원 · **[다시 시도]를 눌러** 수정 전 서버면 "잠시 뒤 다시"를 약속하지 않는 안내 +
  지시서 받기가 한 번, 수정 뒤 서버면 새 잡 → 같은 자리에서 정직하게 멈춤 · 내 앱 카드("Simsa 주소에서 운영 중 · 프로덕션
  아님"·신고 링크 1·주소 링크) · **닫힘**이면 개요는 [만들기 안내 받기], 지시서 화면은 [팩으로 받기]가 주 버튼이고 만들기
  안내·버튼·빌드 요청 0, 사이드바에 '내 앱' 없음, 내 앱 주소로 직접 와도 정직한 안내 + [지시서 받아가기].
  기대 문구는 대시보드 사전에서 읽는다.
- J6는 기본 흐름이다 — 개발 용어·외부 계정 CTA는 P0(`isDefaultFlowJourney`).
- 산출물: `journey-audit-local-result.json`(라이브 기준선 파일을 덮지 않는다) · `journey-audit-shots/local/*.png` ·
  `fakeUnhandled`(가짜가 답하지 못한 경로 — 조용히 삼키지 않는다).

## 배포 게이트 절차 (표준)

유저 여정에 닿는 변경(dashboard 전반, central-plane의 유저 대면 라우트)을 배포한 뒤:
1. `node journey-audit.mjs --ko-only` (EN 카피를 만졌으면 풀런)
2. `findings`의 **P0 = 0** 확인 — P0가 있으면 배포 완료 선언 금지, 즉시 수정
3. 수정한 항목은 재감사 스크린샷으로 소멸 확인 (배너/카피가 실제로 사라졌는가)
4. P1/P2는 이슈화(실행계획 Train U 백로그로) — 조용히 버리지 않는다

## 판독 규칙

- `errorish > 0` (happy path) = 유저가 오류 문구를 봤다는 뜻 — 프로브 green과 무관하게 P0
- `primaryCtaCount`는 **main 본문 한정**(사이드바 제외) — 화면의 주인공이 1개인가(#5)
- `koLeakChars`(EN 주행)는 셸 잔재(~수십 자)와 본문 누수(수백 자)를 구분해 읽는다
- 비활성 버튼(③)의 "이유 표시"는 기계가 못 읽는다 — 해당 스텝 스크린샷을 연다

## 한계 (정직)

- ~~로그인/GitHub OAuth 이후 여정은 익명 컨텍스트로 못 들어간다~~
  → [보완 2026-07-22] **J5 시드 세션 축**: userKey+프로젝트 스텁 주입으로 런
  상세·"왜 이 판정"·증거 로드를 채점(기본 시드=QA 픽스처, `SIMSA_SEED_*` 환경
  변수로 교체). GitHub OAuth 실연동 여정은 여전히 수동 QA 영역.
- 시각 품질("이 화면이 예쁜가")은 오라클 없음 — 스크린샷을 사람이 본다(§5 불변식 4)
- LLM 생성 대기(spec 변환)는 최대 60s 폴링 — 그 이상 걸리면 스텝이 미완으로 기록됨

## 초보자 기준 검사 (Train N6, 2026-09-24 — 설계 D-17 · §8)

`lib/beginner-terms.mjs`(순수·테스트 있음)가 규칙을 갖고, `journey-audit.mjs`는 스텝마다 세 가지를 더 잰다.

| 검사 | 무엇을 | 심각도 |
|---|---|---|
| 개발 용어 | GitHub·repo·PR·diff·Vercel·Netlify·Supabase·Firebase·Cursor·Codex·Windsurf·Lovable·Bolt·v0·클라우드·증거 파일·워크스페이스·owner/repo — **본문/셸 구분**, 문구 앞뒤 40자 동반 | 기본 흐름(J0·J2·J7) **P0** / 그 외 P2 |
| 외부 계정 CTA | 버튼·링크 라벨의 GitHub·Google·Vercel·Netlify·Supabase·Firebase (URL 라벨=유저 앱 주소는 제외) | 위와 같음 |
| 첫 방문 locale (J7) | 저장 선호 없이 브라우저 locale만으로 진입 — ko-KR은 한글 h1, en-US는 한글 없는 h1 | P0 |

기준선(2026-09-24, N1~N5 배포 전): P0=16(전부 이 검사) · P2=32. 배포 후 J0·J2·J7의 P0는 0이어야 한다.

