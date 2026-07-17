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
- **D14 [OPEN → 다음 트레인] 배포·서비스 동향 워처** — 목적: "항상 Vercel·Supabase"가 아니라
  **그 시점의 가장 쉬운 길**을 안내. 구조: 기존 changelog-monitor/외부 인텔 마이너 크론 레일에
  배포 플랫폼 소스(cloudflare/workers-sdk, netlify, vercel, supabase 등 릴리스·changelog)를
  추가 → 주 1회 요약 → **갱신 대상은 D12 레지스트리 단일 파일**(가이던스 신선도가 이 파일에만
  산다). 자동 반영은 하지 않고 리뷰 큐(사람 승인) 경유 — 잘못된 안내가 팩에 바로 실리는 것
  방지. 재검토 트리거: 레지스트리 항목이 실측에서 낡은 안내로 판명될 때.

## 비목표

- fixBrief(수정 지시서) 타겟 확장 — 별도 흐름, 이번 범위 아님.
- 빌더별 개별 프롬프트(Lovable 전용 등) — 공용 1장으로 시작, 실사용 피드백 후 분화.
- LLM 질문의 깨진 토큰(모지바케) 후처리 — 검출 신뢰도 낮음, 재발 시 재검토.

## 검증

`builder-pack-portability.test.mjs`(D10 자기완결·CLI무가정·시크릿 no-store·훅, D11 경로
선택, D12 매칭/비매칭/결제) + `generate-nondev-language.test.mjs` D13 6건. 전체 스위트 green.
