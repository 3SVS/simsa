# Simsa 종합 연구 · 전수조사 보고서 (2026-07-08)

> 지시: Bae — "비개발자 유저에게 최대한 안전하고 혼돈 없이 ①만들고자 하는 바를
> 파악·결과로 보여주고 ②기존에 만든 것의 문제를 찾아 알려주고 고쳐주기. 필요한
> 기술·질문·방향·운영·플로우·UIUX를 실제로 연구하고, 우리 설계·상황도 전수조사해
> 문제·미비점을 정리하라."
>
> 방법: 외부 웹리서치 4갈래(온보딩 UX · 실현가능성/플랫폼 · 기존앱 리뷰/수정 ·
> 플로우/신뢰/아키텍처) + 내부 코드 전수조사 2갈래(현재상태 문제 카탈로그 · 두 축
> 대비 설계-현실 격차). 총 6갈래 병렬. 근거는 경쟁 제품 실측 + HCI 문헌 + 코드
> file:line.

---

## 0. 한눈에 (Executive summary)

**가장 아픈 진실 3가지 (전수조사):**
1. **제품 정체성 포크.** 레포에 두 제품이 공존 — Conclave(개발자용 PR리뷰 협의체)와
   Simsa(비개발자용 수용레이어). 그런데 `ARCHITECTURE.md`·`CLAUDE.md`·`dev-roadmap.md`가
   "source of truth"를 자처하며 **구 제품(Conclave)을 서술**하고, 자동 dev-loop이
   그 문서를 읽어 **엉뚱한 제품 쪽으로 방향**을 잡는다.
2. **광고된 "해자"가 Simsa를 구동하지 않는다.** 7층 아키텍처(협의체·효율게이트·
   메모리·federated)는 `packages/*`·legacy routes에만 있고, Simsa 유저 플로우는
   Anthropic **직접호출(단일 Haiku)**. Simsa 자신이 선언한 해자(Acceptance Graph·
   Evidence Pack)조차 **dormant**(라우트 import 0).
3. **정직/플랫폼 레이어가 아직 코드 0.** 그래서 PISTA류 실패(모바일→웹 껍데기)가
   여전히 live이고, 축 B의 "고쳐준다"는 실제 자동수정이 아니라 **프롬프트 핸드오프**다.

**가장 큰 기회 3가지 (연구):**
1. **Simsa = 모든 빌더가 붙여 파는 "Plan/Approve/Enhance 모드"를 독립·이중언어·
   리뷰연결로.** 경쟁사 중 **캡처(A)↔검수(B)를 잇는 곳이 없다 = 우리 해자.**
2. **저장소 있으면 결정적(LLM 없는) 스택 감지 먼저** — `build.gradle`+`AndroidManifest`→
   안드로이드. 이 한 줄이 PISTA를 즉시 막는다.
3. **축 B는 Refute-or-Promote(반박-제안) + 결과부터 평이하게 + verify-or-revert**로 —
   groupthink·오탐·거짓확신을 구조적으로 차단.

**즉시 고쳐야 할 안전·정직 BLOCKER (재설계와 무관, 지금):** ①"요약/linear" 날조
②시크릿이 ZIP·클립보드에 ③"한 번에 알아서 끝납니다" 과장 ④고립된 intake 데드엔드.

---

## 변경 이력 (v1 → v2)

> fresh 세션이 v1 기준으로 판단하지 않도록 델타를 명시(메타평가 권고). **최신은 v2.**

- **v1 (초판, 2026-07-08 오전):** 6갈래 병렬 조사(외부 4 + 내부 2) 종합, 3대 진실
  (제품 포크 · 미구동 해자 · 미구현 정직레이어), 두 축별 방향, P0~P4 로드맵.
- **v2 (메타평가 반영, 같은 날 오후 — 아래 §0.5):**
  1. **교차검증 추가** — 도전받은 4개 주장 실측: 날조는 **키 없을 때만**(prod 사실상
     미도달) · Langfuse **0건**(측정 불가) · 모델 **현행 Haiku 4.5** · caching **0건**.
  2. **두 축 정의 명문화** (A=의도→결과, B=기존문제 찾기·고치기).
  3. **P0 3티어 재분류** (P0-security / P0-honesty / P0-clarity) — pager급은 시크릿뿐.
  4. **로그인 자격증명 검수 → P1** (정직화만 P0로 유지, #299).
  5. **7층 해자 → CEO 전략 트랙** (P4 아님). 규명 결과: direct Haiku는 비용판단 아닌
     **Worker(Simsa) ≠ Node(7층) 런타임 불일치**. 결정: Conclave 7층 EOL, Simsa 축 B만
     **Worker-네이티브 재구현**(Refute-or-Promote + D1 메모리), 축 A는 direct 유지.
  6. **놓친 P1 추가** (prompt caching · Langfuse 배선 · 세션당 비용 · verify-게이트 ·
     Simsa 플로우 테스트 커버리지 감사).
  7. **CEO 3결정 종결** — ①Conclave EOL(유저 0) ②7층 위 방향 ③네이밍 지금 불급(파일명만).
  8. **P0.0 승계 배너** — `ARCHITECTURE.md`·`CLAUDE.md` 상단에 Conclave→Simsa 안내.
- **이 세션 P0 진행:** #298(날조) · #299(로그인 벽) · #300(**시크릿 번들 누출 — pager급,
  fast-lane 머지·배포**) 완료. 남은 P0: README 과장 · C2 파이프라인 · verify 게이트 ·
  `conclave-build-pack` 파일명 · stage docs 배너 → **다음 세션**.
- **[정정 2026-07-08 밤]** 윗줄의 "완료"는 부정확 — 그 시점 실제로 머지·배포된 것은
  **#300뿐**이고 #298·#299는 PR 오픈 상태였다(오픈=완료로 집계한 보고 오류).
  이후 실상태: **#299는 머지 없이 CLOSED**(사유 미기록 — 로그인 벽 정직화 미반영,
  P1 재등재 판단 필요) · **#298은 OPEN**(#303 verify 게이트와 상보적 — mock 트리거
  자체를 좁히는 유니크 fix 있음, generate.ts 충돌로 rebase 후 머지 여부 결정 대기).
  남은 P0 5건은 #302~#304로 2026-07-08 머지·배포 완료
  (`docs/simsa-p0-p1-shipped-2026-07-08.md`). 재발 방지 규칙: **추적표에 "완료"는
  머지 커밋 확인 후에만 표기.**

---

## 0.5 메타평가 반영 · 교차검증 (v2, 2026-07-08)

이 감사에 대한 독립 메타평가(등급 A−)를 받아, 지적된 약점을 검증·반영했다.

**도전받은 주장의 실제 검증 (원 감사엔 교차검증이 없었음 — 메타평가 정당):**
| 주장 | 검증 | 정정 |
|---|---|---|
| `generate.ts:271` 날조가 유저 도달 | mock은 **키 없을 때만** 반환(LLM throw는 정직 503). prod은 키 세팅 → 날조 사실상 **prod 미도달** | #298은 라이브 사고 아닌 **방어·정확성**으로 격하. 진짜 해법=아래 verify 게이트 |
| Langfuse가 Simsa 구동 | 워크스페이스 플로우에 langfuse **0건** | 확인 — **P0 fix 효과 측정 불가**. Langfuse 배선이 선행 필요 |
| 모델 ID | `claude-haiku-4-5-20251001` (현행 최신) | **조치 불필요** |
| prompt caching | `cache_control` **0건** | 즉효 절감 기회(아키텍처 결정 무관) |

**두 축 정의(원 감사 누락):** **축 A** = 유저 의도를 파악해 결과(스펙·항목·빌더팩/핸드오프)로
보여주기. **축 B** = 이미 만든 것의 문제를 찾아 평이하게 알려주고 고쳐주기.

**심각도 재분류(P0를 3티어로 — pager 울릴 건 시크릿뿐):**
- **P0-security (오늘, 회귀 테스트 동봉 필수):** `.env.local` 시크릿이 ZIP·"전체복사"·
  마크다운 번들에 섞이는 것 제외 + `assert(!bundle.includes("SECRET_"))` 회귀.
- **P0-honesty (오늘):** README "한 번에 끝납니다" 정직화 · C2 답을 productSpec 병합 ·
  generate **verify-against-user-words 게이트**(mock/LLM 무관하게 원문 단어 최소 N% 등장 —
  #298의 mock 트리거 좁히기보다 근본).
- **P0-clarity (오늘, 30분):** **P0.0** ARCHITECTURE.md·CLAUDE.md 상단 승계 배너(✅ v2에서
  반영) + stage-1~85 docs redirect 배너. 이거 없으면 다음 컨트리뷰터가 옛 아키텍처 따라감.
- **P0에서 뺄 것:** `conclave-build-pack` 파일명은 **rename 실수(Stage 84/85)**, 데드엔드는
  **아키텍처 결함** — 같은 티어 금지. 파일명은 P0-clarity(브랜드), 데드엔드는 P1-nav.

**로그인 벽 재배치(메타평가 지적):** "실패 → 확인 못 함" **리포트측 정직화만 P0**(저비용,
#299로 완료). **테스트 계정 입력·요청 트래킹·관리자 UX = 자격증명 검수는 P1**(하루 이상).

**"7층 해자 미구동"은 P4가 아니라 CEO급 전략 결정:** 코드로 못 푼다. 세 옵션 —
(a) Conclave 유산으로 인정·문서 강등, (b) Simsa를 7층 위로 재배선(분기 프로젝트),
(c) Simsa-first 해자 3개 재선정·나머지 optional. **왜 direct Haiku로 갔는지(비용/지연/속도)**를
Langfuse 비용 트래킹으로 먼저 규명해야 답이 나옴.

**메타평가가 추가한 P1(아키텍처 결정 무관·즉효):** prompt caching(스키마 프리픽스 캐시) ·
Langfuse 배선(측정 가능성) · 세션당 비용 트래킹 · verify-against-user-words 게이트 ·
Simsa 유저 플로우를 end-to-end 커버하는 테스트가 몇 개인지 감사(현재 1134+191 중 불명).

**CEO급 결정(코드 아님, 오늘 하는 게 유리):** ① Conclave EOL·유저 이관 여부 ② 7층 해자
유지/강등/재배선 ③ `simsa` CLI alias·`@Simsa_AI` 봇 이관·Simsa 상표/도메인/핸들 확보.

**감사 시점 caveat:** 이 감사는 Stage 85(브랜드 rename) 전후 경계에서 수행 — 브랜드 findings에
낡은 항목 섞일 수 있어 Stage 84/85 인벤토리와 cross-check 필요(ZIP 파일명·봇 username·GitHub App
display name 포함).

---

## 1. 뿌리 문제 — 두 제품 포크 (먼저 정리)

| 문서(intent) | 서술 대상 | 실제 코드 |
|---|---|---|
| ARCHITECTURE.md, CLAUDE.md, dev-roadmap.md, decision-status.md | **Conclave**(개발자 PR리뷰 협의체) | `packages/*`, `routes/{review,memory,episodic,federated-baselines}.ts` |
| README.md, docs/onboarding-feasibility-layer.md, docs/simsa-* | **Simsa**(비개발자 수용레이어) | `apps/central-plane/src/workspace/*`, `apps/dashboard` |

- ARCHITECTURE.md는 2026-04-19자로 "source of truth" 선언, Simsa·비개발자·실현가능성·
  빌더팩·Acceptance Graph를 **한 번도 언급 안 함**.
- `dev-roadmap.md`는 `dev-loop.yml`이 "매 실행마다 읽어 다음 작업을 정한다"고 명시 —
  즉 **자동 개발 루프가 Conclave 쪽으로 방향**을 잡고 있음.
- **조치(P0):** intent 문서를 Simsa로 재조준하거나 명확히 강등. 안 하면 이후 모든
  작업이 어긋난다. 이 보고서 + `onboarding-feasibility-layer.md`가 현재 살아있는 intent.

---

## 2. 축 A — 의도 파악 → 결과로 보여주기

### 2-a. 외부 베스트프랙티스 (트랙 1·2)
- **빈 입력창은 적.** Lovable/Bolt/Softr는 "세 개의 문(아이디어/예시/모르겠어요) +
  메뉴에서 고르기 + 한 화면 한 질문"으로 blank-box freeze를 없앤다. v0의 맨 프롬프트창=
  안티패턴. (Softr 3-door, Databutton capability-menu)
- **다섯 슬롯 브리프**: 무엇을 → 누가 쓰나 → 주요 행동 → 남는 정보 → 로그인/화면/제약.
  Bolt "Enhance prompt"가 러프 아이디어를 PRD로 만드는 것과 동일 — **이게 Simsa의 일**.
- **either/or 객관식 > 자유입력** (recognition > recall). 자유입력은 첫 한 줄만.
- **되비추기(reflect-back) + 가정 라벨 + 확인 게이트** = 신뢰 3종. 이 승인 게이트가
  나중에 **검수 기준(rubric)**이 됨 — 캡처↔검수 연결의 핵심.
- **실현가능성은 "앱스토어 게이트" 기준**(코드생성 아님): 웹=오늘 배포까지 /
  네이티브=생성은 되나 스토어엔 Apple 계정·EAS·QA 필요 → **모바일은 실행 가능한
  스펙을 준다**(HAX "domain mismatch" 핸드오프, PAIR onboarding-in-stages 문장).
- **핸드오프 = Spec Kit/Kiro식 Markdown + EARS 수용기준**(KO/EN 비원어민 검증). 범위밖
  (non-goals) 블록이 스코프 드리프트를 막음.

### 2-b. 우리 현재 격차 (전수조사)
- **[BLOCKER] 2.1** `generate.ts:271` mock이 "요약/linear"만 보면 "회의록→Linear 앱"
  통째 날조 → `ok:true`. 흔한 단어 하나로 무관한 제품이 나옴.
- **[CRITICAL] A1** 실현가능성/온보딩 레이어 **코드 0** (grep이 문서에만 매치). 플랫폼·
  origin(신규/기존)·코딩레벨을 **아무것도 안 물음**(`projects/new/page.tsx:410`).
- **[CRITICAL] A2** 빌더팩에 platform 파라미터 자체가 없음 → 비웹도 "Next/Vercel" 껍데기.
- **[HIGH] A3** 모바일/기타 **핸드오프 산출물 없음** — 정직한 fallback 부재.
- **[MAJOR] 2.2** 폴백 스펙이 항상 "멀티유저 데이터 웹앱" 가정.
- **[MAJOR] 2.3** C2로 만든 openQuestions 답(`resolvedOpenDecisions`)이 **productSpec에
  안 먹임** — 답해도 빌더가 못 받음.
- **[MAJOR] 4.2** 팩 타깃이 Claude Code/Codex뿐인데 입구는 v0/Lovable/Bolt/Cursor…를
  제시. `builtWith` 캡처하고도 안 씀.
- **[BLOCKER] 1.1** MCP 핸드오프 링크가 가리키는 `/projects/new/intake`가 미리보기 전용
  데드엔드(전문용어 벽 1.2).

### 2-c. 방향
1. **입구 = 세 개의 문 + 예시** (빈칸 금지). "모르겠어요"는 capability-menu로.
2. **다섯 슬롯을 한 화면 한 질문**으로, 객관식 우선, PRD에서 추론→확인.
3. **되비추기 카드 + 승인 게이트** → 그 승인 체크리스트가 검수 rubric이 됨.
4. **실현가능성 판정을 first-class**(§5). 모바일/기타는 핸드오프(Spec Kit+EARS).
5. 즉시: 2.1 날조 제거(폴백은 정직 실패 or 진짜 추론), 2.3 답을 spec에 병합, intake 정리.

---

## 3. 축 B — 기존 앱 문제 찾기 · 알려주기 · 고치기

### 3-a. 외부 베스트프랙티스 (트랙 3)
- **Refute-or-Promote(반박-제안):** 제안 에이전트가 문제 올리면 **별개의 반박 에이전트가
  반증 시도** → 살아남은 것만 유저에게. "80개 에이전트가 없는 버그에 만장일치" groupthink를
  구조적 차단. 역할 고정·격리·비대칭 보상. (우리가 3라운드토론→tier-2로 옮긴 걸 연구가 지지)
- **근거 못 대는 finding은 유저 도달 전 drop**(judge 게이트, CodeRabbit). 비개발자에겐
  오탐 하나가 신뢰 즉사.
- **결과부터 평이하게 3층**: (a) "다른 고객 주문이 누구나 보임" → (b) 왜 중요(돈·데이터·
  신뢰) → (c) 기술 상세는 접힘. "42번 줄 null" 금지. P1 대신 사람 말(치명/주의).
- **verify-or-revert 루프**: 작은·되돌릴 수·스코프 있는 변경 → 테스트/타입/스캐너 →
  실패 시 revert, 최대 3회(우리 maxReworkCycles=3와 일치). **통과한 fix만** 노출.
- **원클릭 되돌리기 + 위험도별 자율**(로그인·결제·삭제는 승인 필수, 하드 가드레일 —
  Replit 사고: "말하는 것 ≠ 막는 것"). **거짓 확신 역행**(유저는 AI 코드를 과신).
- **결정적 스캐너 + AI 협의체 결합**(Semgrep류) = 비개발자 신뢰의 바닥.
- **스펙을 1급 아티팩트로, 검수는 그 기준으로**(Augment Intent: diff 역공학 아님).

### 3-b. 우리 현재 격차 (전수조사)
- **[HIGH] B1** 모든 fix가 "프롬프트 만들어 붙여넣으세요" 핸드오프. **in-product
  autofix 없음.** 자율 worker→autofix 루프는 **Conclave 소유, Simsa 미연결.** →
  비개발자는 여전히 외부 에이전트를 직접 몰아야 함(마지막 마일 미충족).
- **[HIGH] B2** 고친 뒤 **before/after 검증·회귀 없음.** "재검수 수동으로 돌리세요"만.
- **[MEDIUM] B3** 시각 finding이 7개 하드코딩 regex, 단일 플로우, "visual oracle 없음" —
  거친 파손만 잡고 미묘한 오류 놓침.
- **[MEDIUM] B4** 코드리뷰가 단일 Haiku·diff 스코프·spec항목 형태 — 협의체/전체레포/
  보안·성능 렌즈 없음. "이미 만든 것의 버그 찾기"엔 약함.
- **[MEDIUM] B5** "내 앱 검사"의 **깔끔한 단일 입구 없음.** 임의 URL 못 넣음(등록된
  source origin-match 필요). intake의 직관적 입구는 미리보기 전용.
- **[MEDIUM] B6** 비개발자 리포트(`nondev-report.ts`)가 **한국어 하드코딩** — 영어 유저엔
  설명 레이어 자체가 없음. (강점: 이 리포트 자체는 비개발자용으로 잘 만들어짐)

### 3-c. 방향
1. **협의체를 Refute-or-Promote로 재구성** + judge 게이트(근거 없으면 drop). 이종 모델로
   promote vs refute(우리 이미 Claude/OpenAI/Gemini/Grok 보유).
2. **finding을 결과부터 3층**으로, P1→사람 말.
3. **축 B 마지막 마일**: in-product(또는 타이트하게 구동되는) **fix + 사후 검증** 루프 —
   통과한 것만, 원클릭 undo, 위험도별 승인·하드 가드레일.
4. **"내 앱 검사" 단일 입구** — URL 한 칸(소유 증명) 또는 기존 앱→스펙 역생성.
5. 리포트 EN/KO.

---

## 4. 온보딩 · 플로우 · 신뢰 · 안전 (교차)

### 4-a. 외부 (트랙 1·4)
- **5단계 선형 스텝퍼**(아이디어→spec승인→팩→연결→검수), ≤6단계, 화면마다 primary 1개
  + **forward edge 필수**. FSM(종료=검수완료)으로 모델링 → 루프 소멸.
- **에러 = "사과 말고 출구"**: 실패 지점에 평이한 원인 + 구체적 복구 1개 + 진행 보존
  (Restart 아닌 **Resume**). 의미 있는 retry만.
- **빈 상태 = 길잡이**: 빈 사이드바/목록은 "다음 행동 가르치기".
- **GitHub App 세분권한**(PAT 대신) + "할 수 있는 것/없는 것" 권한 카드.
- **위험한 행동엔 dry-run 미리보기**(연결·배포). **되돌리기 > 자신감 주장.**
- **탐색은 무료·안전** 명시("아직 아무것도 안 만들어져요").

### 4-b. 우리 격차 (전수조사)
- **[BLOCKER] 4.1** 팩 README "프롬프트 하나면 배포·전달까지 한 번에 알아서 끝납니다"
  (`export.ts:167`) — 팩은 Markdown뿐, 에이전트에 배포 MCP 없으면 그 지점에서 멈춤.
  **보장·검증 못 하는 결과를 단언.**
- **[MAJOR] 6.4** `.env.local` 실제 시크릿이 ZIP에 + "전체 복사"가 클립보드/마크다운에
  **시크릿까지 이어붙임.** (경고는 파일 안에만.)
- **[MAJOR] 5.1** settings가 OAuth+repo+서비스키+이메일+텔레그램+동의를 한 화면에 몰아넣은
  잡동사니. **5.2** 텔레그램 "Chat ID" 요구 + 미설정 시 비활성 폼 데드엔드.
- **[MAJOR] 5.3** 베타에 크레딧/결제 배너 노이즈("0/5 무료" 혼동, 코드 주석에 Bae 지적).
- **[MAJOR] 5.4** "통과" 녹색 verdict가 "내 앱 됨"으로 읽힘 — "라이브 확인 아님" 회색 작은 글씨.
- **[MAJOR] 6.5** connect/review 전반 개발자 용어(PR#·branch·OAuth·P0/P1).
- (강점 5.6: read-after-write 재시도·no_repo vs load_error 분리·poll 후 실패선언 — 잘 됨)

### 4-c. 방향
1. **5단계 FSM 스텝퍼 + 모든 화면 forward edge**(§이미 #295로 no_repo 출구 일부 착수).
2. **에러 전면 "출구" 템플릿** + 진행 보존.
3. **settings 분해**: "코드 연결"은 저장소만, 나머지(알림·동의)는 별도.
4. **베타엔 크레딧 숨김**, verdict에 "라이브 아님"을 verdict급 비중으로.
5. **6.4 즉시**: `.env.local`을 전체복사/마크다운 번들에서 제외, ZIP에도 경고 최상단·
   또는 값 분리 다운로드.

---

## 5. 실현가능성 · 플랫폼 (정직의 핵심)

### 5-a. 외부 (트랙 2)
- **저장소 있으면 결정적 스택 감지 먼저**(Linguist/framework-info식): `build.gradle`+
  `AndroidManifest.xml`→안드로이드, `Podfile`/`Info.plist`→iOS, `pubspec.yaml`→Flutter,
  `google-services.json`/`firebase.json`→Firebase. **PISTA를 즉시 막음.**
- **플랫폼별 매트릭스**(반응형웹/PWA/iOS/Android/백엔드 각각 지금가능/핸드오프/범위밖).
  "모바일 앱"이 4가지 뜻인 걸 구분.
- **경계를 미리 고백**(Bolt 시스템프롬프트: "pip 없음 → 명시하라"), **"Bolt 함정"**
  경고(미리보기 ≠ 출시).
- **HAX/PAIR**: qualified language + confidence signal, 애매하면 clarifying question.

### 5-b. 우리 격차
- **[CRITICAL] A2 / 3.1~3.7**: `service-catalog`가 `NEXT_PUBLIC_*` 강제, `app-url` 기본
  `localhost:3000`+`vercel.app`, Supabase 데이터워드로 강제. `mcp-catalog`가 **Vercel+
  GitHub 무조건**(spec 무시, 주석도 인정). export 배포안내가 Supabase/Vercel 클릭패스 하드코딩.
- **기존-스택 인지 없음**: `existingStack` 데이터모델엔 있으나 팩이 무시.

### 5-c. 방향
1. **저장소/파일 있으면 결정적 감지 first & always**(LLM 전에).
2. **feasibility 분류 + 플랫폼별 매트릭스** → 카테고리별 산출물 분기.
3. **카탈로그를 platform=web일 때만** Vercel/`NEXT_PUBLIC_*`; 그 외 강요 제거. 스택 추천은
   **제안(사용자가 바꿈)**.
4. 상세 설계는 `onboarding-feasibility-layer.md` §1-b/§2/§5 참조.

---

## 6. 우선순위 실행 로드맵

### P0 — 지금(안전·정직 BLOCKER, 재설계 무관, 대체로 저비용)
- **B0-1** `generate.ts:271` "요약/linear" 날조 제거 → 정직 실패 또는 진짜 추론. **[BLOCKER]**
- **B0-2** `.env.local` 시크릿을 "전체 복사"/마크다운 번들에서 **제외**, ZIP 경고 최상단. **[MAJOR/보안]**
- **B0-3** 팩 README "한 번에 알아서 끝납니다" → 정직 카피("에이전트에 배포 도구가 연결돼
  있어야 배포까지 됩니다"). **[BLOCKER]**
- **B0-4** 고립된 `/projects/new/intake` — MCP 핸드오프 링크를 실제 플로우로 재연결 or intake 정리. **[BLOCKER]**
- **B0-5** C2 `resolvedOpenDecisions`를 productSpec에 병합(답이 빌더에 도달). **[MAJOR]**
- **B0-6** 팩 브랜드 `conclave-build-pack/`→Simsa. **[MINOR/신뢰]**

### P1 — 실현가능성·온보딩 레이어 (정직의 핵심, 전략)
- Phase 1 인터뷰(세 개의 문 + 다섯 슬롯 + 되비추기·승인 게이트, 플랫폼·origin·레벨·수령자).
- Phase 2 결정적 스택 감지 + LLM feasibility 분류(게이트웨이·정직) + 매트릭스·추천스택.
- Phase 3 카탈로그·빌더팩·플로우가 platform/category/level 반영, Next/Vercel/Supabase 무조건 제거.
- Phase 4 모바일/기타 핸드오프(Spec Kit+EARS PRD·점검 리포트·수용 체크리스트·수령자 맞춤).

### P2 — 축 B 마지막 마일 (find → fix → verify)
- 협의체 Refute-or-Promote + judge 게이트, finding 결과부터 3층.
- in-product(또는 타이트 구동) fix + verify-or-revert(통과한 것만·원클릭 undo·위험도 승인).
- "내 앱 검사" 단일 입구(URL 한 칸/소유 증명·기존앱→스펙 역생성), 리포트 EN/KO.

### P3 — 플로우·신뢰·안전 (교차)
- 5단계 FSM 스텝퍼·forward edge·에러 "출구" 템플릿·settings 분해·베타 크레딧 숨김·
  GitHub App 세분권한·dry-run·i18n 전면(팩·카탈로그·리포트 EN/KO).

### P4 — 문서·아키텍처 정합
- intent 문서(ARCHITECTURE/CLAUDE/roadmap)를 Simsa로 재조준 or 강등, dev-loop 재조준.
- Simsa 해자(Acceptance Graph/Evidence Pack)를 라이브 라우트에 연결 — 축 A↔B를 잇는
  하나의 진화하는 수용 기록으로.

---

## 7. 근거 (요약)
- 온보딩/캡처: Lovable, v0, Bolt, Replit, Softr, Databutton, Glide, Bubble, Create,
  a0.dev; 진행적 공개·요구공학·underspecification(arXiv 2505.13360).
- 실현가능성/플랫폼: Bolt 시스템프롬프트, Lovable/v0 FAQ, Create/Replit 모바일 docs,
  Expo 한계, GitHub Linguist, Netlify framework-info, MS HAX, Google PAIR, NN/g,
  GitHub Spec Kit, Amazon Kiro, EARS.
- 리뷰/수정: CodeRabbit, Greptile, Cursor Bugbot, Graphite Diamond, Korbit, GitHub
  Copilot Autofix, Replit Security Agent; Refute-or-Promote(arXiv 2604.19049),
  multi-agent groupthink(MDPI 15/7/3676), verify-before-fix(arXiv 2604.10800).
- 플로우/신뢰/아키텍처: Lovable vs Bolt vs Replit, 스텝퍼/체크리스트 UX, GitHub
  fine-grained perms, reversibility, dry-run, AI 에러복구 패턴, Augment Intent,
  PYTHALAB-MERA, Redis agent architecture.
- 내부: 이 레포 `apps/dashboard`, `apps/central-plane/src/workspace/*`, `docs/*`
  (file:line은 본문 참조).
