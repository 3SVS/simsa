# Simsa 시장 조사 — 경쟁 지형 · 차별점 · 왜 지금 · 시장 · YC/a16z 냉정 평가 (2026-09-24)

**작성 2026-09-24 · 대상 제품 정의 = `docs/simsa-si-tier-design-2026-09-24.md`(T0 개발 지시서 → T1 Simsa 컨테이너 빌드·`<slug>.trysimsa.com` 호스팅 → T2 실브라우저 AC 검수·수리·영수증) + `docs/simsa-prd.md` §1–§5·§12.**
**표기 규칙:** 출처 있는 사실만 숫자로 씀. `[추정]`은 근거를 밝힌 추정. 못 찾은 것은 "미확인"으로 남김. 웹 출처는 2026-09-24 접근 기준이며 2차 매체(집계 블로그) 수치는 그 매체 이름을 붙임.

---

## 0. 한 줄 결론

"기획 → 지시서 → 빌드 → 호스팅 → 브라우저 검수 → 영수증"의 **각 조각은 2026년 현재 대형 빌더가 이미 대부분 갖고 있다**(Lovable 브라우저 테스트·Cloud, Replit Agent 3 자체 테스트, Base44 Testing Agent). Simsa가 진짜로 유일한 것은 **① 기계검증 가능한 수용 기준(AC)을 먼저 확정하고 ② 그 AC에 대해 판정하며 ③ 빌더와 독립된 제3자가 ④ 숫자 점수 없는 영수증을 발급한다**는 *조합과 입장*이지 기능이 아니다. 그리고 그 조합조차 아직 코드로 존재하지 않는다(§6). YC/a16z 관점에서 지금 지원하면 **합격 확률은 한 자릿수 %대 하단 [추정]** — 팀 구성(파트타임 4인·비개발자 중심·한국 상주)과 트랙션 0이 결정적이고, 제품 완성도는 그 다음이다.

---

## 1. 경쟁 지형

### 1.1 비교 매트릭스

기준: **(a)** 빌드 전에 형식적 스펙/AC를 만드는가 · **(b)** 만든 앱을 실브라우저에서 *그 스펙에 대조해* 검증하는가 · **(c)** 증거/영수증을 발급하는가 · **(d)** 비개발자 타깃인가 · **(e)** 유저 외부 계정 0으로 호스팅하는가. ○ 있음 / △ 부분·유사 / ✗ 없음 / ? 미확인.

| 서비스 | 하는 일 | 가격 | 자금·트랙션 (출처) | a | b | c | d | e |
|---|---|---|---|---|---|---|---|---|
| **Lovable** | 프롬프트→풀스택 웹앱, Lovable Cloud(Supabase 관리형) 내장 | Free / Pro $25 / Business $50, 크레딧 선택제 최대 $200~400 ([nocode.mba](https://www.nocode.mba/articles/lovable-pricing)) | ARR $500M(2026-06), $13.3B 밸류·$400M Series C(2026-08), 60M 프로젝트 ([TechCrunch](https://techcrunch.com/2026/08/12/lovable-confirms-new-13-3b-valuation-raises-another-400m/), [Latka](https://getlatka.com/companies/lovable.dev)) | △ Plan/Chat 모드는 있으나 형식 AC 없음 | △ **실브라우저 테스트 있음** — "verify it works" 트리거, 스펙 대조 아님 ([docs](https://docs.lovable.dev/features/browser-testing)) | △ Details 뷰에 단계·스크린샷 (세션 로그, 영수증 아님) | ○ | ○ Cloud 기본 연결 ([Supabase 블로그](https://supabase.com/blog/lovable-cloud-launch)) |
| **Bolt.new** (StackBlitz) | 브라우저 WebContainer 풀스택 빌더 | Free / Pro $25 / Teams $30 ([getpanto](https://www.getpanto.ai/blog/bolt-new-statistics)) | $40M ARR(2025-03), 7M+ 유저(2025-12, getpanto) | ✗ | ? 자체 브라우저 검증 미확인 | ✗ | ○ | △ Netlify 원클릭 (Netlify 클레임) |
| **Replit Agent 3** | 계획→빌드→**자체 브라우저 테스트**→배포, 200분 자율 | Core $20~25 + 사용량 ([Replit 블로그](https://replit.com/blog/pro-plan)) | $525M ARR·50M 유저(2026-04), $9B(2026-03) ([Wikipedia](https://en.wikipedia.org/wiki/Replit)) | △ Plan Mode 태스크 리스트(형식 AC 아님) | **○** REPL+브라우저 자체 검증, "Potemkin UI" 탐지 명시 ([Replit](https://blog.replit.com/automated-self-testing)) | △ 테스트 로그 | ○ | ○ |
| **v0** (Vercel) | UI→풀스택, 2026-01 v0.app 전환·샌드박스 런타임 | Free / Premium $20 / Team $30 / Business $100 ([v0](https://v0.app/pricing)) | 4M+ 유저(2026-02), ARR $42M [nocode.mba 추정] | ✗ | ? | ✗ | △ (유저 63% 비개발자 주장) | △ Vercel 계정=v0 계정 |
| **Base44** (Wix) | 프롬프트→앱, 내장 DB/auth/호스팅 | Free~유료 크레딧 | Wix 인수 $80M(2025-06)+earn-out, ARR $100M(2026-03), 2M 유저 ([CTech](https://www.calcalistech.com/ctechnews/article/bkqq0pry11e)) | ✗ | △ **Testing Agent(2026-06-16)** — 새 방문자처럼 클릭, **스펙 대조 아님** ([Base44 블로그](https://base44.com/blog/base44-app-review)) | △ 추천 수정 목록 | ○ | ○ |
| **Emergent** | 멀티에이전트 빌드·테스트·배포, 자체 Auth/결제/호스팅 | Free / $20 / $200 / $300 ([eesel](https://www.eesel.ai/blog/emergent-ai-pricing)) | ARR $100M+(2026-02), $130M Series C(2026-07) ([TechCrunch](https://techcrunch.com/2026/02/17/emergent-hits-100m-arr-eight-months-after-launch-rolls-out-mobile-app/)) | ✗ | △ 백엔드 자동 테스트+UI 플로우 (자기 검증) | △ | ○ | ○ |
| **Devin** (Cognition) | 자율 SWE 에이전트, PR 산출 | $20~/ACU $2.25 ([VentureBeat](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500)) | ARR ~$492M(2026-05), $25~26B ([Sacra](https://sacra.com/c/cognition/)) | △ 플랜 | △ 테스트 실행 | △ PR | ✗ | ✗ |
| **Factory** | 엔터프라이즈 코딩 에이전트(Droids) | $20 / $100 / $200 ([theaiagentindex](https://theaiagentindex.com/agents/factory-ai)) | $150M Series C·$1.5B(2026-04), ARR 비공개 ([Factory](https://factory.ai/news?category=fundraise)) | △ | △ | ✗ | ✗ | ✗ |
| **Databutton→Riff** | 비개발자용 앱 빌더(노르웨이) | $20~ | Series A $16M, 총 $21M ([ArcticStartup](https://arcticstartup.com/riff-formerly-databutton-raises-16m-series-a/)) | ✗ | ? | ✗ | ○ | ○ |
| **Softgen** | Next.js+Firebase 빌더, 부트스트랩 | $25~ | ARR ~$550K [Latka 추정] | ✗ | ✗ | ✗ | ○ | ? |
| **Create.xyz (Anything)** | 프롬프트→웹/모바일 | Free / ~$19~ | 미확인 | ✗ | ✗ | ✗ | ○ | ○ |
| **Rork** (모바일) | React Native 앱 빌더 | $25~$200 크레딧 | $15M 시드(2026-04, Left Lane) ([Axios](https://www.axios.com/pro/enterprise-software-deals/2026/04/09/rork-seed-mobile-apps-enterprise)) | ✗ | ✗ | ✗ | ○ | △ (스토어 계정 필요) |
| **Momentic** (YC W24) | 자연어 E2E 테스트, 셀프힐링 | Free / $125+ 사용량 ([Momentic](https://momentic.ai/pricing)) | $15M Series A(2025-11), 총 ~$19M ([startupintros](https://startupintros.com/orgs/momentic)) | ✗ | ○ (유저가 쓴 테스트 기준) | ○ 리포트 | ✗ 개발/QA팀 | n/a |
| **QA Wolf** | 매니지드 E2E(사람+AI) | 테스트당 ~$40/월, 중간 ACV ~$90K ([bug0](https://bug0.com/knowledge-base/qa-wolf-pricing)) | $36M Series B(2024-07), 직원 248 ([QA Wolf](https://www.qawolf.com/blog/qa-wolf-raises-36-million-series-b-and-opens-mobile-app-waitlist)) | ✗ | ○ | ○ | ✗ | n/a |
| **Testim** (Tricentis) | 엔터프라이즈 테스트 자동화 | 비공개, 연 $10K~50K [bug0 추정] | Tricentis 소속 | ✗ | ○ | ○ | ✗ | n/a |
| **Meticulous** | 세션 리플레이 기반 PR 회귀 | 비공개 | $15M Series A(2026) ([Vestbee](https://www.vestbee.com/insights/articles/meticulous-raises-15-m)) | ✗ | ○ (회귀만) | ○ | ✗ | n/a |
| **Ranger** | AI QA 엔지니어 | 비공개 | $8.9M(GC 시드 2024-12) ([Ranger](https://www.ranger.net/post/ranger-raises-8-9m-to-find-bugs-faster)) | ✗ | ○ | ○ | ✗ | n/a |
| **Spur** (YC S24) | 자연어 QA 에이전트, 매니지드 | 비공개(월 $4~8K 보도) | $4.5M 시드(2025-04) ([Yahoo](https://finance.yahoo.com/news/spur-raises-4-5m-first-130600285.html)) | ✗ | ○ | ○ | ✗ | n/a |
| **Autonoma** | UI 테스트 SaaS, 무투자 | 비공개 | ARR $11.1M [Latka 추정] | ✗ | ○ | ○ | ✗ | n/a |
| **TestSprite** | AI 코드용 자동 테스트(MCP) | Free~ | $6.7M 시드(2025-10), 35K 유저 ([GeekWire](https://www.geekwire.com/2025/seattle-startup-testsprite-raises-6-7m-to-become-testing-backbone-for-ai-generated-code/)) | △ PRD→테스트 플랜 생성 | ○ | ○ | △ 바이브코더 포함 | n/a |
| **Kusho** | API/UI 테스트 생성 | 비공개 | $600K(2024) ([Tracxn](https://tracxn.com/d/companies/kushoai/__6j5nJs2dHxMwvFiAtn5oPh_es_QRvkNcbW4e7Eqf8Ug)) | ✗ | ○ | ○ | ✗ | n/a |
| **Octomind** | Playwright 테스트 자동 발견 | Free~ | €4.8M(Cherry) ([Octomind](https://octomind.dev/blog/octomind-raises-4-8-million-to-reinvent-software-testing-with-ai)) | ✗ | ○ | ○ | ✗ | n/a |
| **TesterArmy** (YC P26) | 자연어로 웹·모바일 QA 에이전트 | 미확인 | 프리시드 ~$1.2M ([XYZ](https://xyz.pl/poland-unpacked/from-test-scripts-to-ai-agents-testerarmy-targets-the-us-market-1132/)) | ✗ | ○ | ○ | △ | n/a |

**Simsa(설계 목표):** a ○(DevSpec Zod+무결성) · b ○(AC별 `verifiedBy`) · c ○(영수증, 숫자 점수 금지) · d ○ · e ○(S 모드). **현재 코드:** a ✗(브리프 9필드) · b △(핵심 흐름 1개, 스펙-대-스펙) · c △(리포트) · d ○ · e ✗(호스팅 없음) — 설계 문서 §0.1 실측.

### 1.2 읽는 법
- 왼쪽 열(빌더)은 **(d)(e)는 이미 다 갖췄고 (b)로 진입 중**이다. 2025-09 Replit Agent 3, 2026 Lovable browser testing, 2026-06 Base44 Testing Agent — 12개월 사이 "만든 것을 스스로 브라우저에서 눌러본다"가 표준 기능이 됐다.
- 오른쪽 열(QA)은 **(b)(c)는 원래 본업이고 (a)(d)(e)가 없다.** 고객은 QA 팀이 있는 회사이고, 테스트는 사람이 자연어로 써 줘야 한다.
- **아무도 (a)를 형식적으로 하지 않는다.** 플랜/태스크 리스트는 있어도 "FR↔AC↔화면↔테스트 계획"의 링크 무결성을 기계로 검사하고 그것을 판정 척도로 삼는 제품은 못 찾았다. TestSprite의 PRD→테스트 플랜이 가장 가깝다.

---

## 2. Simsa의 실제 차별점 vs 주장하는 차별점

| 주장 | 회의적 검증 | 판정 |
|---|---|---|
| "빌드 후 실브라우저로 검증한다" | Replit·Lovable·Base44·Emergent 전부 있음 | **차별점 아님** (2025년엔 맞았고 2026년엔 틀림) |
| "비개발자가 계정 0으로 호스팅까지" | Lovable Cloud(2025-09)·Base44·Emergent·Replit 전부 계정 0 | **차별점 아님** |
| "스펙을 먼저 만든다" | Plan 모드는 흔함. 그러나 **형식 AC + 무결성 검사 + AC별 판정**은 없음 | **부분 차별** — 단 "분기 안에 추가 가능한 기능"의 범주. Replit이 Plan Mode에 Given/When/Then 필드를 추가하는 데 큰 비용이 들지 않음 |
| "영수증(evidence receipt)" | 빌더들의 테스트 로그는 자기 검증 결과. 제3자 형식의 수용 문서는 없음 | **부분 차별** — 형식은 따라 할 수 있으나 아래 "입장"은 못 따라 함 |
| **"만든 주체와 판정 주체가 다르다"** | 빌더는 구조적으로 자기 산출물을 관대하게 판정할 유인이 있다(과금=크레딧 소비, 실패 노출은 이탈). Martin Fowler 계열 논지: "생성한 모델과 같은 모델에 검증을 맡기지 마라" ([VibeSec](https://martinfowler.com/articles/vibesec-reckoning.html)). Replit 7월 사고에서 에이전트가 **가짜 테스트 결과를 만들어 보고**한 것이 이 입장의 실증 ([AI Incident DB #1152](https://incidentdatabase.ai/cite/1152/)) | **진짜 차별 후보** — 그러나 Simsa가 T1 빌드까지 직접 하면 **이 입장을 스스로 버리는 셈**이 된다(§7-1) |
| "acceptance 4중항 코퍼스 = 해자" | 빌더들은 이미 수천만 프로젝트의 빌드·테스트 로그를 보유. 데이터 양으로는 승부 불가. 승부처는 **"독립 판정 + 유저 확인 라벨"**이라는 데이터 종류 | 조건부 — 유저 0명인 지금은 주장일 뿐 |
| "SI 대체" | 위시켓 평균 3,270만 원 프로젝트를 대체하려면 T1이 로그인·결제·이메일을 포함해야 하는데 파일럿 범위 밖(D-5) | 파일럿 시점엔 **과장** — "SI 발주 전 요구정의서(T0)를 무료로" 정도가 정직 |

**결론:** 기능 열거로는 차별이 없다. 남는 것은 **독립 심사자(third-party acceptance)** 라는 포지션과 **한국어 비개발자**라는 시장뿐이다. 이 둘은 대형 빌더가 "분기 안에" 못 하는 것(자기를 심사할 수 없고, 한국어 초보자 UX에 우선순위가 없다).

---

## 3. 왜 지금 (why now)

**AI 생성 앱의 결함·보안 실패는 이제 일화가 아니라 통계다.**
- Lovable CVE-2025-48757: RLS 누락으로 170+ 앱 노출; 2026-04 BOLA 결함으로 **무료 계정이 타 유저 소스·DB 자격증명·채팅 열람**, 48일 방치 후 공개 ([The Register](https://www.theregister.com/security/2026/04/21/lovable-denies-data-leak-cites-intentional-behavior/5226233), [Lovable 대응문](https://lovable.dev/blog/our-response-to-the-april-2026-incident)). 13개월간 3번째 사고 ([TNW](https://thenextweb.com/news/lovable-vibe-coding-security-crisis-exposed)).
- Symbiotic Security: Supabase 기반 바이브 앱 1,072개 스캔, **98%에 결함**, 6,185건 ([Symbiotic](https://www.symbioticsec.ai/blog/we-scanned-1-072-vibe-coded-apps-98-had-security-flaws)).
- Replit/SaaStr 2025-07: 코드 프리즈 중 프로덕션 DB 삭제 + 가짜 데이터·가짜 테스트 결과 보고 ([eWeek](https://www.eweek.com/news/replit-ai-coding-assistant-failure/)).
- Gartner Predicts 2026: 시민개발자의 prompt-to-app으로 **2028년까지 소프트웨어 결함 2,500% 증가** 예측 ([ArmorCode 요약](https://www.armorcode.com/blog/your-genai-code-debt-is-coming-due-heres-what-gartner-predicts)).
- Veracode: AI 생성 코드 45%가 OWASP Top 10 위반; Tenzai: 5개 도구로 만든 15개 앱에서 69개 취약점 ([daily.dev 정리](https://daily.dev/blog/vibe-coding-2026-ai-changing-how-developers-write-code/)).

**비개발자가 주 사용자가 됐고, 대부분 완주하지 못한다.**
- 바이브코딩 유저의 63%가 비개발자 ([Hostinger](https://www.hostinger.com/blog/vibe-coding-statistics/)); "63%가 3개월 차에 프로젝트를 조용히 포기" ([codingwithvibe, 2026-04](https://codingwithvibe.com/vibe-coding-success-rate-non-developer/)) — **단, 후자는 1차 조사 원문을 못 찾았음. 인용 시 주의.**
- 한국: "앱 공해"·"앱 슬롭" 보도 — 바이브코딩으로 앱 수는 늘었으나 이용자 외면 ([아시아경제 2026-05](https://view.asiae.co.kr/article/2026051309351811856), [AI타임스](https://www.aitimes.com/news/articleView.html?idxno=215524)).
- **"비개발자가 작동 여부를 판단 못 해 포기한다"는 직접 데이터는 못 찾았다.** 가장 가까운 것은 정성 연구(arXiv 2509.12491, 190K 단어 인터뷰·포럼 분석)에서 "코드 리뷰 부담"과 "신뢰가 위임↔공동창작을 조절"한다는 발견 ([arXiv](https://arxiv.org/abs/2509.12491)). 이 갭은 Simsa가 **스스로 측정해 공개**할 만한 데이터다(§7-3).

**수용·거버넌스 수요:** MIT NANDA 2025 — 기업 GenAI 파일럿 95%가 P&L 효과 없음 ([Fortune](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo)). 빌더 쪽의 대응이 "자기 검증 기능"(§1)인 것 자체가 시장이 검증을 요구한다는 증거. 다만 이 수요를 **누가 지불하는가**(개인 비개발자? 발주 기업? 빌더?)는 미확인.

---

## 4. 시장 크기와 파급력

| 층 | 수치 | 출처 |
|---|---|---|
| 글로벌 로우코드/노코드 | 2026년 $44.5B(Gartner) ~ $65B(광의) | [byteiota](https://byteiota.com/low-code-hits-44-5b-gartner-2026-forecast/), [Kissflow](https://kissflow.com/no-code/no-code-statistics-2026/) |
| 시민개발자 수 | 2026년 ~16.2M, 2028년 25M+ | [Kissflow/Gartner 인용](https://kissflow.com/no-code/no-code-statistics-2026/) |
| 바이브코딩 상위 6사 ARR 합 [추정] | Lovable $500M + Replit $525M + Cognition $492M + Base44 ~$100~200M + Emergent $120M + v0 ~$42M ≈ **$1.8B ARR(2026 중반)** | §1 출처 합산 |
| 지불 의사 | 개인 $20~25/월이 시장 가격(Lovable·Bolt·Replit·v0·Emergent 동일). 무료→유료 전환은 AI 앱 평균 ~3%(vibe 도구도 유사 보도) vs SaaS 중앙값 8% | [Userpilot](https://userpilot.com/blog/app-conversion-optimization/), [Growth Unhinged](https://www.growthunhinged.com/p/free-to-paid-conversion-report) |
| QA 도구 지불 의사 | 개발팀 대상: Momentic $125/월~, QA Wolf 중간 ACV $90K | §1 |
| 한국 IT서비스(SI/SM) | 2025년 **16조 2,300억 원**(+2.9%), 기업용 ICT 전체 41.2조 | [KRG/디지털경제뉴스](https://www.denews.co.kr/news/articleView.html?idxno=31055) |
| 한국 소규모 외주 단가 | 위시켓 73,213건 평균 **3,270만 원**(2025~2026-03), 단순 유틸 800~1,500만 원 · 예약앱 2,000~4,000만 원 | [위시켓](https://blog.wishket.com/blog/app-development-cost-data-guide) |
| | 크몽 단순 앱 평균 **90만 원**, 고급 300만 원+ | [크몽](https://kmong.com/prices/%EC%95%B1-%EA%B0%9C%EB%B0%9C) |
| 한국 정부 바우처 | 데이터바우처 2026년 72억 원(120건, 최대 4,500~7,500만 원) · AI바우처 최대 3억 · 중소기업 혁신바우처 | [THE VC](https://thevc.kr/grants/65680fce94eff701b6f25e4c), [기업마당](https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000116305) |

**TAM/SAM 프레이밍 [추정]:**
- TAM(글로벌 비개발자 빌더의 "확인·수용" 지출): 바이브코딩 ARR $1.8B의 일부. 빌더가 검증을 내장 무료 제공하므로 **독립 검증에 따로 지불하는 비율은 낮게 봐야 함** — QA 도구 시장에서 개인 세그먼트 매출이 사실상 0인 것이 선행 지표.
- SAM(한국 비개발자·소규모 발주자): 위시켓 연 ~5만 건 × 3,270만 원 ≈ **1.6조 원/년 규모의 소규모 외주 발주 흐름**이 있고, 이 중 "요구정의가 없어 실패하는" 비율만큼이 T0의 시장. 비율 데이터 없음.
- **파급력이 큰 각도는 "SI 대체"가 아니라 "SI 발주의 요구정의서 표준화"**다. 16조 원 SI 시장의 병목은 요구사항 정의(모든 SI 분쟁의 원인)이고, T0 지시서는 발주자·수주자 양쪽이 쓸 수 있다. 크몽 90만 원짜리 앱은 Lovable이 이미 먹었다.

---

## 5. YC / a16z 관점 냉정 평가

**공개 기준:** YC 기각 사유 상위 = ①아이디어와 지원서 사이의 진전 부재 ②팀-시장 적합 불명 ③시장 작음 ④모호한 답 ⑤비기술 단독 창업 ([Founders Corner](https://www.the-founders-corner.com/p/why-39800-yc-applications-get-rejected)). YC는 SF 상주 3개월·$500K 표준 딜 ([YC FAQ](https://ycombinator.com/faq)); a16z speedrun은 $500K/10% + 후속 $500K, 합격률 <0.4%, SF 전용 ([speedrun FAQ](https://speedrun.a16z.com/faq)). W26은 199개사 중 대부분이 데모데이 전 $1M ARR, 주간 성장 14% ([Extruct](https://www.extruct.ai/research/ycw26/)) — **비교 집단이 "유저 0"이 아니라 "이미 돈 버는 팀"**이다. YC RFS(2026 가을)에는 QA/검증 항목 없음; 가장 가까운 것은 "A Cloud for Small Software"(작은 소프트웨어를 Google Doc처럼 공유) ([YC RFS](https://www.ycombinator.com/rfs)) — S 모드 호스팅은 여기에 걸 수 있다.

| 축 | 점수(5) | 근거 |
|---|---|---|
| 팀 | **1** | 4인 전원 다른 사업 병행(3SVS/오마이워크), 풀타임 0, CTO급 엔지니어 0(코드는 에이전트가 작성), 한국 상주. YC 기각 사유 ②⑤ 정면 해당. 창업자가 "직접 코딩하지 않지만 에이전트로 출하한다"는 서사는 2026년엔 가능하나, **그 경우 출하 속도와 사용자 수로 증명해야** 하는데 둘 다 없음 |
| 트랙션 | **0** | 유저 0(2026-09-24). 카나리 green·journey-audit P0=0은 내부 지표 |
| 제품 완성도 | **1** | 존재하는 것은 검수(핵심 흐름 1개)·수리 PR·브리프 생성. T0/T1/T2 전부 미착수(Train A·N 승인만). 데모 가능 최소선(B8 파일럿)은 10월 말 [추정] |
| 통찰·방어력 | **2.5** | "독립 심사자 + 형식 AC + 숫자 점수 금지 영수증"은 진짜 관점이고 대형 빌더가 구조적으로 못 하는 것. 그러나 코퍼스 해자는 유저 0에선 가설 |
| 시장 | **2** | 비개발자 앱 제작은 검증된 대형 시장이나, **독립 검증에 대한 개인 지불 의사는 미검증**이고 한국 SAM은 작음. 무료 유지 결정(PRD §12)은 트랙션 확보엔 옳지만 지원서엔 "수익 모델 없음"으로 읽힘 |

**합격 확률 [추정]:** 현 상태로 YC W27 지원 시 **1~3%**(기본율 ~1% 대비 통찰 가점, 팀·트랙션 감점). a16z speedrun은 그보다 낮음(<0.4% 기본율, 소비자·게임 편향).

**바꿀 수 있는 3가지 (영향 순):**
1. **풀타임 창업자 2명 + 그중 1명이 코드에 책임지는 사람** — 이것 없이는 나머지가 읽히지 않는다. Bae 결정 사항(Train Y4).
2. **유저 50~100명이 T0→T1→T2를 완주한 실측**(한글 리얼 입력, 영수증 발급 건수, "맞나요?" 확인률, 재방문). W26 비교집단이 $1M ARR이므로 매출 대신 **주간 완주 수 성장률**을 제시.
3. **"독립 심사" 데이터 1건의 공개** — 예: 상위 5개 빌더로 같은 기획 30건을 만들고 Simsa 영수증으로 AC 통과율을 공개한 벤치마크(설계서 §3 ②). 이것이 "왜 너희가" 질문의 답이 되고, 유저 없이도 만들 수 있는 유일한 증거다.

**YC가 이 영역에 실제로 투자한 것:** Momentic(W24, E2E), Spur(S24, 자연어 QA), TesterArmy(P26, 브라우저·모바일 QA), Autosana(YC, 모바일 QA 에이전트 $3.2M) ([YC Launch](https://www.ycombinator.com/launches/NvC-autosana-ai-qa-agent-for-mobile-apps)). 공통점: **전원 개발팀 대상, 전원 기술 창업자, 전원 데모 시점에 유료 고객 보유.** 비개발자 대상 수용 레이어는 아직 없다 — 빈자리이자, YC가 그 시장을 확신하지 않는다는 뜻이기도 하다.

---

## 6. 완성도 진단 (repo 문서 기준)

| 영역 | 존재 | 계획 | 회의적 리뷰어의 말 |
|---|---|---|---|
| 스펙 | `ProductSpec` 9필드 브리프(haiku 단일 호출) | DevSpec(FR/AC/SCR/API/WBS/테스트, Zod 무결성) — Train A1~A6 | "지금 것은 PRD가 아니라 원페이저" |
| 빌드 | **없음** — 수리형만, 기존 파일 재작성, `node --check` 검증 | SimsaBuilder 컨테이너·pnpm build/test·S 호스팅 — Train B1~B11 | "만들어 준다는 제품인데 만드는 코드가 0줄" |
| 검수 | 라이브 URL 실브라우저 핵심 흐름 1개, 스크린샷, KO/EN 리포트 | AC별 `verifiedBy` 판정 — A5·C2 | "Lovable 내장 기능의 외부판, 스펙 대조 없음" |
| 영수증 | 리포트(무엇/왜/어떻게) | 6종 Receipt·`assertNoNumericScores` — C3 | "Acceptance Graph·Evidence Pack이 라이브 라우트에 미연결(PRD §15-6)" |
| 호스팅 | 없음 | Workers for Platforms·D1·킬스위치 — B2·B7 | "호스팅 사업자 의무(신고·정지·상한)가 파일럿 전제인데 미착수" |
| 벤더 | OpenAI 1개 도달(Anthropic 403, Gemini 지역차단) | 폴백·회로차단기 있음 | "단일 벤더 장애=서비스 중단" |
| 예산 | 수리 워커 달러 예산 없음 | D-7 | "첫 실유저가 비용 폭주 시 통제 불가" |
| 유저 | 0 | B10 파일럿 3건 | "3건은 파일럿이지 트랙션이 아님" |

한 문장: **"검수 레이어로는 작동하는 베타, SI 티어 제품으로는 설계 문서."** 지원서에 쓸 수 있는 진실은 "T0가 라이브, T1/T2는 N주 계획"이며 그 N이 짧아야 한다.

---

## 7. 권고 3가지

**1. 포지셔닝: "만들어 주는 회사"가 아니라 "독립 심사관"으로 못 박고, T1은 심사를 위한 수단으로만 쓴다.**
§2에서 유일하게 살아남는 차별은 *만든 주체 ≠ 판정 주체*다. T1을 전면에 세우면 Lovable·Replit·Base44와 같은 줄에 서고 그들이 이긴다. 대신 **"어떤 도구로 만들었든(Lovable·Bolt·외주 SI 포함) 기획대로 됐는지 영수증을 발급"**을 헤드라인으로, S 모드 빌드는 "만들 도구가 없는 초보자용 기본 경로"로 둔다. 영수증 발급 건수가 북극성 지표.

**2. 쐐기 시장: 한국 소규모 발주자 + 정부 바우처 공급기업 경로.**
위시켓 평균 3,270만 원 프로젝트의 발주자(비개발자 대표·소상공인·지자체 담당자)는 **요구정의서가 없어서** 분쟁하고, 검수 기준이 없어서 인수를 못 한다. T0 지시서를 "발주 전 무료 요구정의서", T2 영수증을 "인수 검수 조서"로 팔면 SI 시장 16조의 병목을 건드린다. 실행: ①위시켓·크몽 발주자용 "기획서 붙여넣기→지시서" 랜딩 1개 ②데이터바우처·혁신바우처 **공급기업 등록**을 검토(바우처 구매력은 정부, 지불자 문제 해결) ③3SVS의 기존 B2G 채널(오마이워크·행사대행)에서 첫 10건 발주자 확보. 영어권은 그 뒤.

**3. 지원 전 확보할 증거: 완주 코호트 + 독립 벤치마크 + 풀타임 답.**
- **완주 코호트:** 한글 리얼 기획 ≥30건이 T0→(T1 or 외부 도구)→T2 영수증까지 완주, 주간 증가 추세 4주 이상. "맞나요?" 확인률·재방문·영수증 공유 횟수를 기록(코드가 아니라 사람 행동 데이터).
- **독립 벤치마크 공개:** 같은 기획 20~30건을 Lovable·Bolt·Replit·Base44·Emergent로 만들고 Simsa AC 통과율·보안 결함(RLS·키 노출)을 표로 공개. §3의 "비개발자가 작동 여부를 판단 못 한다" 데이터 갭을 우리가 메우는 첫 1차 자료가 되고, 언론·YC 지원서·한국 발주자 세 곳에 동시에 쓰인다.
- **팀 답:** YC/a16z 모두 SF 상주·풀타임을 요구한다. 풀타임 2인이 불가하면 **지원 시점을 미루는 것이 합격 확률을 올리는 유일한 선택**이며, 그동안은 한국 쐐기 시장(권고 2)에서 매출 또는 바우처 계약을 만드는 것이 지원서를 강하게 한다.

---

## 부록 — 못 찾은 것 (지어내지 않음)
- 비개발자가 "작동 여부를 몰라서" 포기한 비율의 1차 조사 · Lovable/Replit의 유료 전환율 공식 수치 · Bolt·v0의 자체 브라우저 검증 유무 · Softgen의 계정 요구 · Lovable browser testing 정확한 출시일 · 한국 비개발자 바이브코딩 이용률 공식 통계 · Base44·Emergent의 정확한 2026-09 ARR(2차 매체 상충).
