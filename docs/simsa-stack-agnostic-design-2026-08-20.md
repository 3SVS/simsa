# Simsa 스택 불가지(stack-agnostic) 설계 — 2026-08-20

> **지시 (Bae, 2026-08-20):** "모든 게 Claude·ChatGPT·Supabase·Vercel로만 정해져 있는 것
> 같다. 어떤 조합을 사용해도 우리가 **물어보고**, 그에 맞춰 제공할 수 있어야 한다.
> 그런 하드코딩이 없어야 한다."
>
> 상태: **잠금 발효 — `design lock approved` (Bae, 2026-08-20).** D-1~D-4 [LOCKED].
> 재론은 결정 번호 인용으로만. Phase 0은 버그 수정으로 선행 집행됨(#474).

## 0. 전수 인벤토리 요약 (2026-08-20 실측)

물어보는 질문은 **builtWith(어떤 도구로 만들었나) 단 하나**이고, 그 답조차 **빌더팩
생성기에 전달되지 않는다**(버튼 순서만 바꿈). 호스팅·데이터베이스·부가 서비스를 묻는
질문은 어디에도 없으며, 그 자리를 하드코딩이 채우고 있다:

| # | 위반 | 위치 |
|---|---|---|
| B1 | builtWith가 팩 생성기에 미전달 (root cause) | `export.ts` 요청 타입에 builtWith 없음 |
| B2 | Supabase 가입 안내가 모든 팩에 무조건 포함 | `service-examples.ts:26-28` |
| B3 | 서비스 카탈로그 4종 고정(app-url/supabase/resend/sentry), "기타" 없음. env 키가 Next.js/Supabase 전용 | `service-catalog.mjs` |
| B4 | MCP 연결 패널 = GitHub+Vercel 고정, 스펙 무관 | `mcp-catalog.mjs:114-117` |
| B5 | 팩 프롬프트 안에 "Vercel 등" 배포 지시 상수 | `export.ts:500,513-527,194` |
| B6 | UI 카피 11곳에 닫힌 도구 목록("Claude Code or Codex" 등) | `dictionary.mjs` (설계서 부록 A) |
| B7 | 수리팩(fix-brief) 타깃 = claude_code/codex뿐 — web_builder 유저는 수리팩 없음 | `pr-fix-brief.ts:19` |
| B8 | **버그**: outcome 기록이 web_builder/handoff를 400 거부 → 비-Claude 유저의 성과 데이터 소실 | `outcomes.ts:16,19` |
| B9 | CLI 팩이 프레임워크 무관하게 `.env.local`/`NEXT_PUBLIC_*` 가정 | `export.ts:1048-1110` |
| B10 | 계정 페이지 연동 예정 목록 = Vercel만 | `dictionary.mjs:86-89` |

잘 된 곳(재사용할 패턴): built-with.ts의 **정규화+other 흡수**(모르는 도구를 버리지
않고 시장 레이더로 수집), agent-registry의 **command/settings 스타일 분기**("Codex
유저에게 claude 명령을 보여주지 않는다"), generate.ts의 **벤더명 감지→쉬운말 치환**
(유저가 직접 언급한 벤더는 예외), platform-* 어댑터 5종(이미 벤더 복수형).

## 1. 원칙 (제안)

- **D-1 [LOCKED 2026-08-20] 물음-프로파일-소비 원칙.** 조합(빌더·호스팅·데이터·부가
  서비스)은 항상 유저에게 **묻고**, 답을 **StackProfile**로 저장하며, 모든 산출물
  (빌더팩·서비스 안내·수리팩·MCP 연결·UI 카피)은 프로파일을 **소비해서** 렌더링한다.
  하드코딩된 벤더 전제 금지.
- **D-2 [LOCKED 2026-08-20] 중립 기본값.** 미응답/모름("모르겠어요" 항상 허용)일 때 특정 벤더를
  조용히 가정하지 않는다 — 중립 산출물(예: "지금 쓰는 호스팅의 환경변수 화면에
  넣으세요") 또는 명시적 질문으로 되돌린다. 현행 "unknown → 조용히 Claude Code 팩"
  같은 silent default 금지.
- **D-3 [LOCKED 2026-08-20] other는 버리지 않는다.** 모든 축에 자유텍스트 "기타"를 두고 수집한다
  (built-with 패턴). 수집된 other 빈도가 다음 카탈로그 확장의 우선순위 근거다.
- **D-4 [LOCKED 2026-08-20] 닫힌 목록 카피 금지.** UI 카피의 도구 나열은 항상 "예: A, B 등 쓰시는
  도구"의 열린 형태. (K-축: 비개발자 언어 규칙과 동일한 성격의 카피 레일.)

## 2. 데이터 모델 (제안)

**StackProfile** — 프로젝트 단위, `workspace_project_ext`(0064) JSON에 저장
(무마이그레이션; 별도 컬럼 불요):

```
stackProfile: {
  agent:   { id: <built-with canonical | "other">, other?: string }   // 기존 builtWith 재사용
  hosting: { id: "vercel"|"netlify"|"cloudflare"|"railway"|"render"|"firebase"|"none_yet"|"unknown"|"other", other?: string }
  data:    { id: "supabase"|"firebase"|"neon"|"planetscale"|"mongodb"|"none"|"unknown"|"other", other?: string }
  extras:  [{ kind: "email"|"errors"|"payments"|"maps"|"analytics"|..., id: string|"other", other?: string }]
}
```

- 질문 UX: 온보딩 인터뷰 chip rows(현행 platformQ/githubQ/aiToolQ 자리)에 **2문항 추가**
  — "앱이 올라가 있는 곳"(호스팅), "데이터가 저장되는 곳"(데이터). 비개발자 언어,
  전부 선택 사항, "모르겠어요" 칩 포함. extras는 스펙 키워드 감지(현행 need-matched)
  결과를 **확정 질문**으로 바꿔 확인받는다("이메일 발송이 필요해 보여요 — 쓰시는
  서비스가 있나요?").
- 전달 경로: intake → project ext → `ExportUserProfile` 확장(hosting/data/extras 추가)
  → 모든 프롬프트 생성기. (이미 배선된 userProfile 경로 재사용 — 신규 배관 불요.)

## 3. 소비자 어댑터화 (제안 — 규모 큰 순)

1. **export.ts / service-examples.ts** — `BASE_SERVICE_EXAMPLE_BLOCKS`(무조건 Supabase)
   를 data 축 룩업으로: supabase→현행 블록, firebase/neon/…→각 워크스루, none/unknown→
   중립("데이터 저장이 필요해지면 이 항목으로 돌아오세요"). 배포 안내(D-PATH·MCP 상수
   3곳)는 hosting 축 룩업으로. `.env` 파일 생성은 hosting/data가 명시된 경우에만 해당
   벤더 키명, 아니면 범용 키명+"쓰는 서비스의 키 이름으로 바꾸세요" 안내.
2. **service-catalog.mjs** — 카탈로그를 data/email/errors 축별 복수 항목으로 확장 +
   자유텍스트 "다른 서비스 추가"(other 수집). 키워드→벤더 강제 매핑(데이터→Supabase)을
   키워드→**축** 감지 + 프로파일/질문으로 치환.
3. **mcp-catalog.mjs** — `detectMcpTools`가 프로파일 소비(주석에 이미 예약된 spec 파라미터
   자리): hosting=netlify→Netlify MCP, github는 repo 연결 시에만. 카탈로그에 Netlify/
   Cloudflare/Railway/Render 추가(platform-* 어댑터 5종이 이미 있음 — 자산 재사용).
4. **agent-registry.mjs** — DEV_AGENTS에 Cursor/Windsurf/Gemini CLI 추가 + "기타 에이전트"
   settings-스타일 폴백(이미 안전 강등 경로 있음). 연결 명령은 에이전트별 분기 유지.
5. **pr-fix-brief.ts** — `web_builder` 수리팩 타깃 추가(빌더 채팅창에 붙여넣는 단일
   프롬프트 형태, export.ts web_builder 프롬프트와 같은 규약).
6. **recommendedTargetFor** — unknown/other일 때 null→조용한 claude_code 기본 대신
   "어떤 도구로 만드세요?" 재질문 배지.
7. **dictionary.mjs 카피 11곳** — 닫힌 목록 전수 교체(D-4 레일). 부록 A 목록 기준.

## 4. 단계 (제안)

- **Phase 0 (버그, 설계 무관 — 즉시):** B8 outcome 400 수정(web_builder/handoff 수용).
  ✅ 2026-08-20 집행 — 데이터 소실 중단이 최우선.
- **Phase 1:** StackProfile 질문 2축+저장+전달 (모든 어댑터의 전제).
- **Phase 2:** export/service-examples/env 어댑터화 (§3-1·2) + 카피 레일 (§3-7).
- **Phase 3:** MCP/에이전트/수리팩 확장 (§3-3·4·5·6).
- **측정:** 각 축 other 자유텍스트 분포 + outcome per (agent×hosting×data) — 이것이
  per-agent 해자 데이터의 확장판(per-combo 해자)이 된다.

## 5. 게이트 레지스트리

| 게이트 | 문구 | 상태 |
|---|---|---|
| 설계 잠금 | `design lock approved` | ✅ 발효 2026-08-20 (Bae) |
| Phase 1 착수 | `train stack-p1 start approved` | ✅ 발효 2026-08-20 — 별도 문구 없이, "design lock approved 주시면 Phase 1(질문+저장) 착수하겠습니다"라는 제안에 대한 승인 문맥으로 P1에 한해 착수 포함 해석 (기록: 이 행) |
| Phase 2 착수 | `train stack-p2 start approved` | ⏳ 대기 |
| Phase 3 착수 | `train stack-p3 start approved` | ⏳ 대기 |
| migration 0065 적용 | `migration 0065 apply approved.` | ✅ 발효·집행 2026-08-20 (0065 remote 적용 → central-plane 배포) |

## 부록 A — B6 카피 위치 (dictionary.mjs EN/KO 줄)

237/2775, 344/2879, 468/3003, 698/3233, 737-738/3272-3273, 1237/3772, 1255/3790,
1611/4146(부분 escape hatch 있음), 2271/4799(부분), 2434/4957(vercel.app placeholder),
86-89/2624-2627(계정 페이지), 1454-1456/3989-3991(벤치마크, 부분). fixBrief 블록
1303-1316/3839-3850은 참조 0의 죽은 카피 — Phase 3에서 web_builder 수리팩과 함께 정리.
