# Simsa — 최종 구현 모델 (PRD / Single Source of Truth)

> **이 문서의 성격:** 흩어져 있던 설계·스펙·메모리를 **하나의 최종 구현 모델**로 조립한 정본.
> 원칙: **발명 없음 · 조립만.** 각 절은 출처 문서를 밝히고(§16 추적표), 문서가 침묵·충돌하는
> 지점은 지어내지 않고 **[미결]**로 표시한다. 상세 구현은 출처 문서에 있고, 이 PRD는 "그것들이
> 어떻게 하나로 맞물리는가 + 불변식 + 미결"의 지도다.
>
> **사용법:** 모든 작업은 이 문서에 정확히 일치해야 한다(Bae 2026-07-09: "최종 구현 모델에
> 정확히 일치"). 새 작업/PR은 이 PRD의 해당 절을 근거로 시작한다. 이 문서와 개별 설계 문서가
> 충돌하면 **개별 설계 문서(더 상세)가 우선**이고, 이 PRD를 고친다.
>
> 작성 2026-07-09. 출처: `simsa-autopilot-operating-model.md`, `simsa-acceptance-graph.md`,
> `simsa-visual-completion-check.md`, `simsa-external-vibe-app-completion-loop-spike.md`,
> `design-prep-layer.md`, `uiux-redesign-instructions.md`, `simsa-research-audit-2026-07.md`,
> 메모리(`SIMSA-overview.md`, `feedback-simsa-product-boundary.md`,
> `feedback-ux-basics-gate-before-ready.md`, `feedback-design-style-linear-neutral.md`,
> `project-target-audience-non-developers.md`, `project-universality-direction.md`,
> `feedback-intake-sprint-a-d.md`), 실제 코드(`apps/central-plane`, `apps/dashboard`).

---

## 1. 제품 정의 (What Simsa is)

**한 줄:** Simsa(심사)는 **비개발자(vibe coder)가 AI로 만든 앱을 자기 눈으로 확인·검수받고,
작동할 때까지 고쳐주는** SaaS다. 동시에 그 판단을 **설명 가능·감사 가능·거버넌스 가능**하게
만드는 **AI 소프트웨어 수용(acceptance) & 거버넌스 레이어**다.

- 두 관점은 같은 제품의 두 얼굴이다:
  - **사용자 관점(제품 경계, product-boundary):** 한국/영어권 **비개발자**가 v0·Lovable·Bolt·
    Cursor로 만든 프로젝트를 **눈으로 보고**(스크린샷/영상) 검수받고, 안 되면 **무엇/왜/어떻게**를
    쉬운 말로 받아 **될 때까지 고친다.** (출처: product-boundary, SIMSA-overview)
  - **가치/해자 관점(operating-model §1):** git·diff·CI·프로덕션 read-only 관찰에서 **증거를
    결정론적으로 수집**하고, 변경의 **리스크를 분류**하고, **프로덕션 위험 액션은 항상 사람 게이트**로
    분리하고, **에이전트 핸드오프(lead 구현 + challenge 교차검토)**를 오케스트레이션하며, **모든
    자동 결정이 그것을 정당화한 evidence pack을 지닌다**(감사 가능성). "어떤 에이전트 변경이
    사람 없이 배포돼도 되는지, 왜인지"를 설명·감사 가능하게 만드는 것이 제품.

- **명시적으로 아닌 것(operating-model §1, product-boundary):** 단순 코드리뷰 래퍼 아님 ·
  단순 CI 아님 · 단순 PR 자동화 아님 · 제네릭 QA 아님 · 린터 아님.

- **해자(moat, operating-model §30, product-boundary):** 파운데이션 모델/GPU 소유가 아니라
  **거버넌스 레이어** — Acceptance Graph · Receipt Schema · Policy Engine · Evidence Pack
  Generator · Risk Classifier · Agent Handoff Protocol · Connector Layer · Audit Log ·
  Deployment Modes · Standards Radar · Privacy-Preserving Trend Layer. **"모델이 아니라
  거버넌스를 판다."**

## 2. 대상 사용자

- **한국/영어권 비개발자**(프로젝트 발주자·오너). UI는 **완전 이중언어**(EN 기본 + KO 토글),
  **개발자 전문용어 회피**("코드 변경", not "diff"). (출처: target-audience, SIMSA-overview)
- 카피 원칙: PR→"변경 요청/코드 변경", diff→"변경 내용", review run→"확인 실행/확인 결과",
  commit/merge 등은 짧은 풀이. 에러·빈 상태 메시지도 "다음에 뭘 하면 되는지"를 비개발자 언어로.
- **보편성(universality, 제품 요구):** 특정 스택/에이전트에 묶이지 않음 — 빌더/호스팅 무관
  (Lovable/Netlify/Replit…), 코어는 이미 **GitHub PR + 배포 URL**이라는 중립 인터페이스 위에.
  갭 우선순위: ① private-repo(GitHub App) ② Resend 이메일 ③ Sentry(배포 후 에러율=3번째 증거축)
  ④ Supabase 도메인 규칙 ⑤ GitLab. 새 어댑터는 `packages/platform-railway` 패턴 미러.

## 3. 두 축 (제품이 하는 일) — 출처: 감사 v2 §0.5

> [미결/출처 주의] "두 축" 프레이밍은 **감사 v2**에서 온 것이고 operating-model 문서에는 없다
> (operating-model은 §21 Intent-Based Evaluation만 있음). 축 정의는 감사 기준.

- **축 A — 의도 → 결과로 보여주기:** 유저 의도를 파악해 **스펙·확인항목·빌더팩/핸드오프**로.
  (온보딩·실현가능성·prep → §6)
- **축 B — 기존 것의 문제 찾기·고치기:** 이미 만든 것을 **눈으로 확인**하고 평이하게 알려주고
  **될 때까지 고친다.** (시각 검수·완료 루프 → §7)

## 4. 핵심 시스템 — Acceptance Graph (해자의 중심)

출처: acceptance-graph.md, operating-model §§24–25·30. 코드: `apps/central-plane/src/acceptance-graph.ts`,
`evidence-pack.ts`.

**체인(9노드):**
```
User Intent → Clarifying Answers → PRD → Acceptance Criteria
  → Build Plan → Implementation Evidence → Cross-Review Evidence
  → Visual/Interaction Evidence → Gate Decision → Receipt
```
- 코드리뷰 도구가 "이 diff 괜찮나?"를 답한다면, Simsa는 **"유저 의도가 silent gap 없이 PRD·
  빌드계획·구현·검증 가능한 수용 증거로 번역됐나?"**를 답한다. diff는 체인의 한 노드일 뿐.

**intake source(결정론적 추론, `deriveIntakeSource`):** idea-only(→ Needs Clarification/Evidence
경향) · PRD-first(구현 Not Verified) · repo-first(User Acceptance Required) · mixed.

**세 증거 카테고리:** Product(intent/PRD/criteria 있나) · Engineering(criteria에 링크된 test
pass/fail/skip, CI, 배포) · Visual(렌더된 제품이 실제로 동작했나 — 없으면 unit test 통과와 무관하게
**Not Verified**, `visualEvidenceMissing` 리스크 플래그).

**per-criterion 상태(결정론):** 링크된 test가 **fail → broken** / 없거나 fail 없고 **pass →
verified** / (링크 없음 또는 skip만 → **not verified**). PRD가 모호하게 둔 선택을 구현이 임의로
정하거나 repo-first가 PRD 없으면 → **User Acceptance Required**(사람 accept/reject, Simsa 판정 아님).

**Receipt(operating-model §25):** 6종 — Idea · PRD · Build · Release Gate · Progress ·
Technology Recommendation(Discover/Assess/Trial/Adopt/Hold/Reject). 각 항목은
**missing-and-blocking · missing-but-later · missing-because-not-applicable ·
unknown-because-evidence-insufficient · outside-qualification · requires-expert-review**를 구분.
숫자 점수 없음(§5 불변식).

**Evidence Pack(operating-model §11, `deriveEvidencePack`):** JSON+마크다운. 리스크 booleans는
**변경 파일 경로 + diff 텍스트에서 결정론적으로** 도출(에이전트 산문 아님, §12):
`migrationChanged · deployConfigChanged · envSecretTouched · authPolicyTouched · paymentTouched ·
oauthTouched · dnsCorsTouched · d1WriteDetected · destructiveActionDetected · workspaceClaimTouched ·
publicLaunchTouched · visualEvidenceMissing · acceptanceCriteriaMissing · userIntentAmbiguous`.
**앞 11개 중 하나라도 true면 하드 사람 게이트 + exact-phrase 승인 강제.**

## 5. 불변식 (Load-bearing contracts — 절대 위반 금지)

세 문서(acceptance-graph·visual-check·loop) + product-boundary가 일관되게 강제:
1. **숫자 점수 절대 금지**(operating-model §20). "82/100"·"PRD Score"·"Founder Score" 등 금지.
   대신 **readiness states**: `Ready · Conditionally Ready · Needs Clarification · Needs Evidence ·
   Needs Expert Review · Not Applicable · Not Judged · Do Not Build Yet · Not Verified · Needs Fix ·
   User Acceptance Required`. `assertNoNumericScores`가 receipt를 가드.
2. **Browser Evidence ≠ AI Opinion** — 섞지 않는다. 브라우저 증거=사실만(로드상태·클릭/입력·이동
   주소·콘솔에러·네트워크실패·스크린샷·타임스탬프). AI Opinion=해석(intent 불일치 추정 등, "측정된
   사실 아님" 라벨). Receipt에서 분리 섹션.
3. **근거 없으면 Not Verified, 절대 Pass 아님.** unit test 통과해도 UI를 안 돌렸으면 정직하게.
4. **visual oracle 없음 → auto-Ready 금지.** 플로우가 깨끗해도 "이 화면이 진짜 쓸만한가"를 판단할
   오라클이 없으므로 **User Acceptance Required(직접 눈으로 확인 필요)**에서 멈춘다.
5. **파괴/위험/인증우회 행동 금지** — 로그인·결제·삭제·publish·deploy 안 함, auth bypass 안 함.
   외부 타겟은 **read-only**(코드 수정/push/deploy 안 함), 민감값은 마스킹·미저장.
6. **자격 경계(operating-model §22):** clarity·completeness·buildability·testability·release
   readiness·risk·evidence gap·next safe action만 평가. **시장성·투자가치·창업자·법률·의료·재무·
   최종 독창성은 판정 안 함** — 모르면 Unknown/Needs Evidence/Needs Expert Review/Not Judged/
   Out of Scope로 말한다.
7. **과장 금지·anti-slop(operating-model §26):** 모든 버그를 다 찾는다/완벽한 제품이다 주장 금지.
   부분 성공·blocked를 정직하게. 근거로 되짚을 수 없는 요약 금지.

## 6. 축 A — 온보딩 → 스펙 → 준비 → 빌더팩

### 6.1 실현가능성/온보딩 (P1) — [부분 미결: Bae 확정 대기]
> [정정 2026-07-16] 이 절은 `onboarding-feasibility-layer.md`가 **부재**하다고 적고 있었으나,
> 사실이 아니었다 — 그 문서는 **머지되지 않은 PR #296에 갇혀 있었고**, 그래서 repo에 없는 것으로
> 취급됐다. #296을 머지해 이제 [`onboarding-feasibility-layer.md`](onboarding-feasibility-layer.md)에
> 있다(PISTA 사례 · 온보딩 인터뷰 5문항 · web_buildable/mobile_handoff/other_handoff 분류 ·
> 코딩레벨 3단계 · 데이터모델 · Phase 1~4).
>
> [미결 유지] **아직 T-DESIGN이 끝난 것은 아니다.** 그 문서는 2026-07-07~08 작성분이고 이 PRD가
> 더 나중(07-09)이다. 이 PRD가 단일 진실인 이상, 그 문서를 **THE P1 스펙으로 승격할지는 Bae
> 확정 사항**이다. P1 착수 전 두 서술을 대조해 확정할 것. 아래는 그때까지의 요약이다.
- 입구 = **세 개의 문 + 예시**(빈 입력창 금지), "모르겠어요"는 capability-menu. (감사 §2c)
- **다섯 슬롯을 한 화면 한 질문**, 객관식 우선, PRD에서 추론→확인. 되비추기 카드 + 승인 게이트
  (그 승인 체크리스트가 후에 검수 rubric이 됨).
- **실현가능성 first-class**: 저장소/파일 있으면 **결정적 스택 감지 먼저**(build.gradle+
  AndroidManifest→안드로이드 등), 플랫폼별 매트릭스(웹=오늘 배포/네이티브=핸드오프), 모바일/기타는
  Spec Kit+EARS 핸드오프. 카탈로그의 Next/Vercel/Supabase 무조건 가정 제거.

### 6.2 준비 계층 (prep layer) — 출처: design-prep-layer.md
목표: 가장 어려운 셋업을 유저 에디터가 아니라 **Simsa의 통제된 UX 안에서** 끝내고, 팩을 **배포
준비 완료 상태**로 내보내 개발 잡무 ≈ 0. **3계층(각각 독립 가치):**
- **A. In-Simsa 셋업 + .env 굽기** (P1, 저위험): 스펙의 included에서 필요한 서비스 감지 → 화면에서
  가입/키 안내(가입URL→키 위치→붙여넣기) → export 시 `.env.local`(실값)+`.env.example`(placeholder)
  +`SETUP.md` 팩에 포함. **★보안(Rule 3, 승인 필요):** 키는 **서버 저장 안 함** — 브라우저에만
  두고 **export 시 클라이언트에서 팩의 `.env.local`에 직접 기록**, 서버에 안 남김. service_role
  같은 관리자 키는 최소 수집 + 프론트 금지 경고.
- **B. 배포/DB 커넥터(OAuth)** (P2/P3, 고가치·고난도): Supabase OAuth로 DB 프로비저닝+마이그레이션
  적용+anon키, Vercel OAuth로 배포+env+URL. 유저는 키 복사 0. **암호화된 OAuth 토큰만 저장**(원시
  DB키 저장 안 함, `CONCLAVE_TOKEN_KEK` AES-GCM 재사용). 파트너 OAuth 승인 리드타임. 범위: 처음엔
  Supabase+Vercel만.
- **C. Simsa 스킬(+MCP)** (P2a): 에디터에 얹는 공식 `SKILL.md` — MCP(`packages/mcp-workspace`)로
  스펙·수용기준·env를 끌어와 "수용기준대로 빌드→자가점검→배포→Simsa로 복귀"를 **강제**. 팩 프롬프트보다
  강함(호스트 기본 스킬 override).

### 6.3 재설계된 프로젝트 플로우 (Bae 2026-07-06 지정) — prep-layer §2
```
1 준비            아이디어 → 제품설명서(spec) → 확인 항목(items)
2 검수·준비        저장소 연결(개발자 경로, 선택) · 알림 설정
                  · 서비스 가입 + API 키 확보·입력    ← 준비계층 A
                  · 빌더팩 다운로드                   ← ★ 이 단계로 올림
[에디터에서 제작]   유저 에이전트가 팩으로 빌드
결과 가져오기       배포 URL 또는 프로젝트 파일 재삽입 (/p/{id}/connect)
3 결과·수정        사전확인 / 검수 결과 (수정지시서 항목은 제거 — 중복)
```
- **"2 검수" 탭에서 빌더팩으로 바로 점프 금지** — 연결·알림·서비스/키 입력 먼저, 팩 다운로드를 이
  단계로 올림. 전체 루프를 "전부 연결 → 팩 다운로드 → 에디터 빌드 → 결과(URL/파일) 재삽입 →
  결과·수정"으로 리셋. 이 재배치는 `project-steps.mjs` 상태머신 + 사이드바 + export UI 위치를 만짐
  (P1 별도 작업). [알려진 버그 → §15]

## 7. 축 B — 검수 → 시각 완료 체크 → find→fix→verify

출처: visual-completion-check.md(260A), external-vibe-app-completion-loop-spike.md(258A),
acceptance-graph Visual 노드, product-boundary. 코드: `nondev-report.ts`, `visual-flow-plan.ts`,
`tools/simsa-completion-loop-spike/`.

- **왜 URL-only QA로 부족한가:** `200 OK`는 서버가 응답했다는 것이지 유저가 뭔가 할 수 있다는
  게 아니다(golf-now: 홈은 200인데 코스 데이터 백엔드가 죽어 검색 불가). "되나?"는 **실제 유저
  플로우의 성질**이지 HTTP 상태가 아니다.
- **intent anchor(의도 앵커) 필수:** 의도 선언 없이는 "다 됐나?"가 답 불가 — 무엇을 위해 됐나?
  앵커("골퍼가 지금 칠 수 있는 코스인지 확인하는 흐름")가 자(尺). 플래너가 앵커에 맞는 액션 선택
  (예: golf-now의 "비 보험 가입" 버튼 오클릭 방지 — `intentIsSearchOriented`+`ctaIsSearchLike`로
  '골프장 검색' 입력 사용).
- **깊은 실사용 플로우(260A):** 버튼 하나 아님 — 안전한 core CTA를 누르거나 **검색창에 실제로
  입력**하고 결과 화면 관찰(멀티스텝). **눈으로 보는 증거**: 스텝별 스크린샷 + 진행 영상(webm).
- **비개발자 한국어 리포트(`nondev-report.ts`):** `ERR_NAME_NOT_RESOLVED` 같은 걸 **무엇/왜/어떻게**
  3줄로, 원시 기술 문자열은 접힌 "개발자용" 칸에만. verdict=상태(점수 아님). `report.html`(자립형)
  더블클릭 → verdict 뱃지 → 한 줄 요약 → 카드 → 스크린샷 → 영상 → 다음 행동.
- **find→fix→verify 루프(258A):** 각 실행이 Claude/Codex용 `fix-brief.md` 생성(관찰된 실패·재현
  단계·기대 동작(앵커에서)·의심 영역(read-only repo 컨텍스트)·구체 수정 지시·재실행 명령·수용 조건).
  수리 에이전트가 이걸 소비 → 재실행으로 수용 조건 충족 확인. **재현성: 같은 타겟 2회 실행**, 코어
  발견(타겟·CTA·이동경로·에러클래스·최종결정)이 갈리면 nondeterministic으로 표시(성공 처리 안 함).
- **오라클 한계:** 단일 코어 플로우만, visual oracle 없음 → 깨끗해도 **User Acceptance Required**.

## 8. 거버넌스 / 게이트 (operating-model, SIMSA-overview §10)

- **5단 리스크 티어:** Tier0 정보/문서 · Tier1 저위험 코드(테스트·순수헬퍼) · Tier2 런타임 코드
  (배포 필요, 데이터 변경 없음 — **프로덕션 배포는 사람 게이트**) · Tier3 프로덕션 데이터/스키마/env/
  auth(하드 게이트) · Tier4 치명/비가역/외부(하드 게이트, 2단계 가능, 롤백 계획 필수).
- **하드 게이트(항상 exact-phrase 사람 승인):** 프로덕션 central-plane/dashboard 배포 · D1 스키마
  적용 · D1 데이터 변경 · env/secret · AUTH_ENABLED/SIGNUP_MODE · OAuth 프로덕션 · 결제 · DNS/도메인/
  CORS · 파괴적 정리 · 스모크 계정 삭제 · project claim · 초대/공유 · 공개 가입 · 공개 런치 · MCP/npm
  publish · 고객 데이터 export/delete · auth 끄는 롤백. **절대 번들 금지**(merge≠deploy≠D1≠launch,
  각자 exact-phrase). 예: `PR #<n> merge approved.` / `<feature> central-plane production deploy
  approved.`
- **자동 전진은 ALL 충족 시만(§5):** Tier0/1 · 마이그레이션/배포/wrangler/env/auth/결제/OAuth/DNS/
  CORS 무변경 · 프로덕션 동작 무변경 · D1 write 없음 · CI green · 브랜치 최신 · diff 임계 이하 ·
  evidence pack 생성 · self-review ≥1 · 미해결 blocker 없음. **초기 롤아웃은 shadow mode**(분류·
  evidence·PR 코멘트·추천만, auto-merge 안 함).
- **가드레일(SIMSA-overview §10):** Worker 수동 배포(main push≠배포, hotfix만 `pnpm verify` 후) ·
  시크릿은 `set-worker-secrets` 워크플로만(로컬 wrangler 금지) · Zod every boundary(`as any` 금지) ·
  EN/KO parity · 버그 고치기 전 회귀 전수검색 · 유저대면 PR은 base=main.

## 9. UIUX 최종모델

### 9.1 디자인 시스템 — 출처: design-style 메모리 + 실제 코드(확인됨)
> [정정] MEMORY.md 인덱스의 "딥그린 액센트"는 **stale**. 실제 코드·design-style 문서(2026-06-18
> `ec05620`)는 **classical conclave 팔레트**로 확정: `tailwind.config.ts`가 oxblood `brand`+`gold`,
> `globals.css` 배경 `#faf8f3`, Geist Sans+Pretendard.
- **팔레트:** primary=deep oxblood/maroon `#5C111C`(hover `#4B0E17`) · secondary=antique gold
  `#C7A554`/`#9B7A30` · warm parchment `#F4ECDC`/배경 `#faf8f3` · warm near-black `#1A1310`.
  Tailwind: `indigo→oxblood(brand)`, `gray→stone(warm)`, `gold` 토큰.
- **폰트:** Geist Sans(본문)+Geist Mono(식별자/숫자), 한글 Pretendard fallback.
- **스타일:** Linear급 미니멀·light 기본 · AI-플랫폼 셸(슬림 좌측 사이드바, 상단바 없음) ·
  neutral-first(zinc/stone) · 얇은 hairline border · 명확한 위계. **금지:** 밝은 보라/인디고 ·
  네온 그라데이션 · 고채도 "AI 데모" · 이모지 남발 · 카드-인-카드 · 로고박스/blur.
- **상태색(의미 있는 곳만):** needs_decision/info=slate/blue-gray(보라 아님) · warning=muted amber ·
  error=muted red · passed=green.

### 9.2 UX 기본 게이트 (ready 선언 전 필수) — 출처: ux-basics-gate 메모리
"완료/오픈 가능/배포 가능" 리포트 전, **모든 화면에 UX Basics 5를 코드 레벨 전수 점검.** 계약/테스트/
데이터저장 green ≠ 완료.
- **UX Basics 5:** ① 모든 상태에 출구(back/cancel, URL 기반 선호) ② 데이터 0일 때 빈 상태 + 다음
  행동 CTA ③ 비활성 버튼은 이유 표시 ④ API 실패 시 유저 언어 안내 + 재시도 ⑤ 다음 행동 없는
  데드엔드 금지.
- **Bae 4 Rules(새 화면 Phase 0):** 모든 화면 탈출구 · 모든 인터랙티브 요소 응답(무응답 same-route
  Link 금지, Enter 커밋, stuck-disabled 금지) · 모든 async 3-state(pending/success/error+retry) ·
  silent failure 금지(새 `.catch(()=>undefined)` 금지, 기존은 배너로).
- **글로벌 표준:** Nielsen 10 + WCAG 2.2 AA(대비 4.5:1·포커스·라벨·타깃크기) + 모바일 360px(반응형
  셸!) + 시각 위계(화면당 primary 1개, ≥2단계 타입스케일).
- **★self-feature QA 게이트(최상위):** 기능 만든 뒤 **머지 요청 전 실제 입력으로 최소 1회 직접
  돌린다**(실제 문서 업로드/실제 장문 생성/prod·local curl). unit test·정적감사·build green으로
  대체 불가. "확인 못 한 것: X" 명시, "should work" 금지. 배포 후 curl 라이브 QA 포함.

### 9.3 화면/컴포넌트 타깃 (uiux-redesign-instructions.md) — 순서 고정
공통: 디자인 위생 유지 · EN/KO 전수 · 각 PR 별도 + 그 SHA 원격 CI green 후 머지.
**순서: A2 → 5 → 2 → 1 → 3** (#4 완료). [미결: "A2"·prep "D"는 문서에 정의 없음 — §15]
- **#5 화면별 primary CTA 위계 ★최상위:** 화면마다 주인공 버튼 하나 — primary 하나만 크게·filled·
  중앙 흐름, 나머지 물러남(outline/ghost/link). **함정: 잘 보이게=크기 아니라 대비**(다 키우면 다시
  안 보임 → "위계 재정렬"). 전 화면 전수. nextProjectAction(개요 CTA)과 각 화면 primary가 같은
  행동. 문구는 행동+결과형("첫 검수 실행하기") 통일, 전문어 금지.
- **#2 확인결과 요약 재배치("3초 파악"):** 통과 N/확인 필요 M(숫자+상태색) 상단 크게, 산문 최소,
  상세·근거·diff는 하위 계층, "다음 행동"이 요약과 함께.
- **#1 개요 컴팩트 진행 표시:** 지휘센터에 3스텝+현재위치 컴팩트(기존 `computeProjectSteps` 재사용,
  새 로직 금지). 상단 가로 타임라인 지양, 우측 세로/CTA 위. (#266 생성 대기표시와 별개, 이미 라이브)
- **#3 "+N개 더" 인라인 펼침:** 그 자리 인라인 확장/접힘(별도 페이지 금지). 노출 기준=개수 아니라
  중요도(필수는 전부 노출, 부가만 접힘).
- **#4 피드백 채널:** ✅ 인앱 FeedbackModal(backend `sendFeedback`, migration 0058), mailto 제거.
  미니 FAQ(랜딩 5~6문답 EN/KO)는 미착수. 게시판/챗봇/Issues 연결은 오픈 후 백로그.

### 9.4 커뮤니티 — 지금 안 만듦 (방향 기록)
빈 포럼=죽은 제품 신호+모더레이션 비용. 오픈 후 **공유 가능한 "검수 통과 12/12" 배지/카드**(콜드
스타트 없음). 먼 미래=실패 사례 라이브러리(RAG). 지금 할 것: 데이터 골격에 `result_shared` 이벤트
슬롯 예약. ("Reviewed with Simsa" 뱃지는 "사용" 표시지 "통과" 검증 아님 — 섞지 말 것.)

## 10. 아키텍처

- **현재 topology(SIMSA-overview):** central-plane=Cloudflare Worker `conclave-ai` + D1 + R2
  (`simsa-evidence`), **수동 배포**(main 머지=CI만, 배포 아님). dashboard→Vercel→`app.trysimsa.com`.
  landing→Vercel. CLI→npm `@simsa/cli`. Worker base `conclave-ai.seunghunbae.workers.dev`.
- **모노레포:** pnpm+Turbo, TS strict ESM, Node≥20, 28 패키지+5 앱, `node --test`만(Jest/Vitest 금지),
  seam에서 mock. 대시보드 i18n dictionary-first(`src/i18n/dictionary.mjs`, EN+KO parity 테스트).
- **최종 방향(감사 v2 §0.5 CEO 결정):** Conclave EOL(유저 0). 광고된 7층 해자는 **Worker≠Node
  런타임 불일치**로 Simsa flow에서 미구동 → **Simsa 축 B만 Worker-네이티브 재구현**(Refute-or-Promote
  + D1 메모리), 축 A는 direct 유지 = **Q1 별도 트랙**. 자체 해자(Acceptance Graph/Evidence Pack)를
  라이브 라우트에 연결(현재 dormant).

## 11. 데이터 / 학습 substrate

- **이중 카탈로그(SIMSA-overview §5):** git-tracked `answer-keys/`(머지 성공, ∞TTL) +
  `failure-catalog/`(기각 실패, ∞TTL), 매 리뷰가 양쪽 top-K를 RAG로. `episodic/` 원시 90일 TTL.
  **한계:** 이건 프롬프트/RAG 진화(A)지 fine-tune(B) 아님. episodic은 `diffSha256`만.
- **training store(§6, opt-in, 기본 OFF, version-gated):** SaaS 경로만, `@simsa/secret-guard`로
  스크럽 후 R2, `sha256(userKey)` 키. `outcome:"pending"`.
- **feedback intake 루프(intake-sprint A–D):** [주의: conclave 시대 프레이밍] A `POST /feedback`→D1 ·
  B Haiku 분류→`failure_seeds` · C ≥N 신호 시 `design-seeds.json` 번들 · D `/admin/learning-stats`
  해결률. "다음 스프린트" 지시 시 Sprint A부터.

## 12. 비즈니스 / 정체성

- **네이밍(SIMSA-overview):** 유저대면=**Simsa**, 인프라 식별자=**conclave-ai**(의도적, 버그 아님).
  npm `@simsa/*`(구 `@conclave-ai/*` 계정 유실). CLI `simsa`+`conclave`(alias). repo `3SVS/conclave-ai`.
  `.conclaverc.json`, cosmiconfig key `conclave`. dashboard `app.trysimsa.com`.
- **빌링(§7):** BYO=**영구 무료**. 유료=**GitHub Marketplace만**(first-pr +5 $3, Solo +30 $19,
  Pro +100 $49, 일회성 없음). Lemon Squeezy dormant. **크레딧 차감 프로덕션 OFF**.
- **auth(§8):** Better Auth(D1) 라이브, identity=`userKey`, 소유권 per-userKey, claim flow, 가입 개방,
  private repo=GitHub App.

## 13. 비목표 (Non-goals)

- 초기 롤아웃 프로덕션 auto-deploy 없음 · 자동 D1 apply 없음 · 자동 env/secret 없음 · 자동 auth
  정책 변경 없음 · 자동 공개 런치 없음 · 자동 파괴 정리 없음 · 자동 고객데이터 액션 없음(operating §18).
- 커뮤니티/포럼 안 만듦(§9.4) · 숫자 점수 안 만듦(§5) · 시장성/창업자/법률/의료/재무 판정 안 함(§5.6).
- 정체성 포크 재구현(7층 Worker-native)·봇 rename·npm scope rename = Q1/frozen(감사 v2, SIMSA-overview).

## 14. 오픈 판정 기준 (uiux-redesign-instructions.md)

① 기계 QA 0 FAIL ② 생성 진짜(Bae 입력 고유 디테일이 초안 반영) ③ Bae UIUX P0 = 0 ④ 휴먼 QA
체크리스트 1회 완주. 시퀀스: [P1 UIUX] → [휴먼 QA Bae 유저 시점 재검] → [4개 충족] → 오픈.

## 15. 알려진 격차 / 미결 (open — 지어내지 않고 표시)

1. **P1 온보딩/실현가능성 스펙 — 문서는 존재, 승격은 미결** *(2026-07-16 정정)*
   이 항목은 원래 "`onboarding-feasibility-layer.md` 없음"이었으나 **틀린 기록**이었다. 문서는
   내내 존재했고 **머지되지 않은 PR #296에** 있었다 — 대화에만 살아 있는 지시서가 조용히
   빠지는 그 실패 모드. #296 머지로 이제 repo에 있다(§6.1).
   **남은 미결:** 그 문서(07-07~08)와 이 PRD(07-09) 중 어느 쪽이 P1의 단일 스펙인지 **Bae 확정
   필요**(T-DESIGN). 문서 존재 ≠ 스펙 확정.
   > [해소 2026-07-21] Bae 확정("4,5 제외 다 진행"): **`onboarding-feasibility-layer.md`를
   > THE P1 스펙으로 승격.** 구현은 이미 라이브(#296 Phase1~4, D17, #346). 미결 닫힘.
2. **스테이지 번호 문서 간 불일치** — 258A/260A가 문서마다 다른 것을 지칭(operating §19의 258A=
   Artifact Alignment Gate vs loop 문서=External Spike). **"번호 아닌 계약"으로 참조**, 재조정은
   별도.
3. **UIUX 순서의 "A2"·prep의 "D"** — 어느 문서에도 정의 없음. 착수 전 Bae 확인 필요.
   > [해소 2026-07-21] **A2 = "Prep layer A2"** — 서비스/MCP 셋업 패널을 export 화면에서
   > 준비·설정(settings) 화면으로 이동(§6.3 재배치의 일부). 코드 주석(`service-values-store.mjs`)
   > 으로 정체 확인, **이미 완료·라이브**. "D"는 여전히 미상 — 결번 취급.
4. **prep 계층 A 보안 방식** — "서버 무저장 + 브라우저 주입" **승인 대기**(design-prep-layer §7).
   > [해소 2026-07-21] Bae 승인("4,5 제외 다 진행") — 방식 확정. 구현은 라이브 상태였음.
5. **code-check 링크상태 유실 버그** — 코드변경 링크 후 "확인하기" 누르면 "2 코드변경"으로 되돌아가고
   링크 유실(design-prep-layer §9). 재현·원인규명·수정+회귀.
6. **자체 해자 dormant** — Acceptance Graph/Evidence Pack이 라이브 라우트에 미연결(감사 §P4).
7. **i18n 미완** — spec·items·checks·fixes·new·github·history·run detail·Telegram이 한국어 하드코딩
   (design-style i18n caveat). 리포트(`nondev-report.ts`)도 KO 하드코딩(감사 B6).
8. **MEMORY.md 인덱스 "딥그린" stale** — §9.1에서 정정, 메모리 파일도 정정 대상.

## 16. 출처 추적표 (traceability)

| PRD 절 | 주 출처 |
|---|---|
| §1 제품 정의 | operating-model §1·§30, product-boundary, SIMSA-overview |
| §2 대상 | target-audience, universality-direction, SIMSA-overview |
| §3 두 축 | 감사 v2 §0.5 (operating-model 아님) |
| §4 Acceptance Graph | acceptance-graph.md, operating-model §§24–25, 코드 acceptance-graph.ts/evidence-pack.ts |
| §5 불변식 | operating-model §20·§22·§26, acceptance-graph, visual-check, loop, product-boundary |
| §6 축 A/prep/flow | 감사 §2c/§5c, design-prep-layer.md |
| §7 축 B | visual-completion-check.md(260A), loop-spike.md(258A), nondev-report.ts |
| §8 게이트 | operating-model §§3–8·16–18, SIMSA-overview §10 |
| §9 UIUX | design-style 메모리 + 실제 코드, ux-basics-gate, uiux-redesign-instructions.md |
| §10 아키텍처 | SIMSA-overview, 감사 v2 §0.5 CEO 결정, ARCHITECTURE.md(Conclave) |
| §11 substrate | SIMSA-overview §5–6, intake-sprint-a-d |
| §12 비즈니스 | SIMSA-overview §7–8 |
| §13/§14 | operating-model §18, uiux-redesign-instructions.md |

---
**실행 계획은 `docs/simsa-execution-plan-2026-07-09.md` 참조 — 이 PRD의 어느 절을 어떤 배치로 짓는지.**
