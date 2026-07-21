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
