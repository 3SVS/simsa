# 빌더팩 이식성 + 질문 품질 설계 (2026-07-17, P1~P3)

> 근거: `docs/simsa-target-fit-eval-2026-07-17.md` (10분야 실측 — 빌더팩 10/10 CLI 전제·
> Vercel/Supabase 단일 예시, LLM 질문 품질 흠 3건). Bae "p1,2,3 모두 착수 승인" +
> "GitHub 연동 강요 금지, 유동적 안내" + "배포 서비스 최신 동향 체크 기능 필요".

## 결정

- **D10 [LOCKED] web_builder export 타겟** — `ExportTarget`에 `web_builder` 추가.
  Lovable/Replit/v0/Bolt 공용 `WEB_BUILDER_PROMPT.md` 1장: **완전 자기완결형**(웹빌더는 팩의
  다른 파일을 못 읽으므로 스펙·항목·완성기준 인라인), 키는 **빌더의 Secrets UI**(채팅·코드에
  값 금지), 배포는 **빌더 내장 Publish 버튼**. `.env.local`/터미널/git/MCP 언급 없음.
  `both`의 의미(claude_code+codex)는 불변.
- **D11 [LOCKED] 배포 경로는 선택지, GitHub은 강요 금지** — CLI 프롬프트의 배포 안내를
  "사용자 상황부터 묻기"로 재작성: ①GitHub 있는 사용자=기존 Vercel 경로 ②처음인 사용자=
  (a) GitHub 없이 드래그앤드롭(Netlify Drop·Cloudflare Pages 직접 업로드 — 정적 앱 한정
  명시) vs (b) GitHub부터(가입→New repository→푸시→Vercel 연결, 한 단계씩) 중 택1
  ③서버 기능 있는 앱은 (a) 불가를 정직하게.
- **D12 [LOCKED 원칙/매처·블록은 파라미터] 필요 기반 서비스 예시** —
  `workspace/service-examples.ts` 레지스트리: base(Supabase)+D11 배포 선택지에 더해, 스펙
  텍스트의 결정론 매처가 잡은 필요(이메일→Resend, 결제→토스/Stripe **테스트 키 한정**,
  지도→카카오맵, 문자→발신번호 심사 정직 안내, 업로드→Supabase Storage)만 워크스루 추가.
- **D13 [LOCKED] 질문 배열 비개발자 보증** — 프롬프트 규칙("네이티브 앱 선택지 제시 금지",
  "어디에 저장할지 같은 기술 결정 묻지 않기") + 결정론 후처리 `filterQuestionsForNonDev`
  (네이티브 선택지/저장 위치/도구 이름 질문 드롭, 사용자 본인 언급은 면제, 바닥 3개 보장).
- **D14 [LOCKED 원칙 — v1 구현됨 (같은 날 후속 PR)] 배포·서비스 동향 워처** — 목적: "항상
  Vercel·Supabase"가 아니라 **그 시점의 가장 쉬운 길**을 안내. 구현: `deploy-trend-watcher.ts`
  — 주 1회(월 07:00, changelog-monitor와 같은 크론 패스) 플랫폼 CLI/SDK 릴리스(vercel/
  netlify/cloudflare/supabase/resend, 소스는 파라미터)를 훑고 "비개발자의 배포·온보딩 경로가
  바뀌었는가"만 Haiku로 걸러 D1 리뷰 큐 `deploy_trend_suggestions`(migration 0059)에 적재.
  하이워터마크는 spec_monitor_state를 `deploytrend-` prefix로 재사용. 관리자:
  `GET /admin/deploy-trends`(pending 목록) · `POST /admin/deploy-trends/:id/status` ·
  `POST /admin/run-deploy-trend-watcher`(수동). **자동 반영 없음** — 갱신 대상은 D12 레지스트리
  단일 파일이고 사람이 큐를 보고 고친다. 재검토 트리거: 레지스트리 항목이 실측에서 낡은
  안내로 판명될 때.
- **D15 [LOCKED 원칙/매처는 파라미터] solo 스펙 본문 auth-free** — 7/16 평가의 "solo 앱 스펙에
  회원가입/로그인" 잔여. soloGuard 프롬프트를 스펙 본문까지 확장 + 결정론 `applySoloSpecGuard`
  (included/userFlow/items에서 인증 아티팩트 제거, 항목 바닥 3개). veto = 사용자가 로그인·잠금을
  **원한** 경우만("로그인 필요 없어요" 같은 부정 언급은 veto 아님 — lookahead).
- **D16 에이전트 선택 단계 (Bae 지시)** — export 페이지가 조용히 Claude Code로 자동 생성하던
  것을 제거하고, 첫 화면에서 "빌더팩을 어떤 개발 AI용으로 받으시겠어요?" 명시 선택(4옵션) 후
  생성. built_with 기반 추천 프리셀렉트는 후속(로컬 프로젝트 셰이프에 built_with 부재).

## 비목표

- fixBrief(수정 지시서) 타겟 확장 — 별도 흐름, 이번 범위 아님.
- 빌더별 개별 프롬프트(Lovable 전용 등) — 공용 1장으로 시작, 실사용 피드백 후 분화.
- LLM 질문의 깨진 토큰(모지바케) 후처리 — 검출 신뢰도 낮음, 재발 시 재검토.

## 검증

`builder-pack-portability.test.mjs`(D10 자기완결·CLI무가정·시크릿 no-store·훅, D11 경로
선택, D12 매칭/비매칭/결제) + `generate-nondev-language.test.mjs` D13 6건. 전체 스위트 green.
