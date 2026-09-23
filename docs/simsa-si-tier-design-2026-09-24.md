# Simsa SI 티어 설계 — "기획을 넣으면 기획대로 작동하는 개발물이 나온다"

**작성 2026-09-24 · 상태: 설계 잠금 대기 (`design lock approved` 전까지 어떤 D도 발효되지 않음)**
**티어 판정: T2-P** (프로덕션 데이터·과금 예정·멀티세션 위임 · 자기주도 제품 → 결정 잠금 + 스테이지 트레인 + literal 게이트)

> Bae 지시(2026-09-24): "SI 업체에 개발을 맡긴 것처럼 기획에 맞게 작동하는 개발을 내놓을 수 있는
> 서비스. 그렇게 될 수 있는 **개발 지시서**를 내놓는 게 최소 티어의 결과물." 그리고 "이걸로
> YC 또는 a16z 프로그램에 제출할 수 있게."
>
> 이 문서는 PRD(`docs/simsa-prd.md`)의 **제품 경계를 옮기는** 결정이다. 충돌 시 이 문서가 우선하고
> PRD §1·§3·§6·§13을 D-번호를 인용해 고친다.

---

## 0. 근본 문제 (Rule 2)

### 0.1 지금 Simsa가 실제로 하는 일 (2026-09-24 프로덕션 실측 + 코드 확인)

| 단계 | 실체 | 근거 |
|---|---|---|
| "제품 설명서" | 사업 브리프 수준 — 이름·한 줄·대상·문제·포함/제외·흐름 문장·결정/미결. **화면·데이터·API·상태·테스트 없음** | `generate.ts:47-57` `ProductSpec` 9필드, haiku 단일 호출 |
| "확인 항목" | 산문 완성 기준. 스펙 문장을 근거로 스펙을 점검하는 **스펙-대-스펙** | `check.ts` `evidence[]` = 설명서 내 문장, `export.ts:526` 면책 문구 |
| "빌더 팩" | md 12종 문자열 조립(LLM 없음). **만드는 주체는 유저의 에디터** | `export.ts:1864` `generateBuilderPack` |
| 코드 쓰기 | **수리형만**: 연결된 저장소의 **기존 파일** 전체 재작성. **새 파일 생성 거부**, 검증은 `node --check` | `repair-brief.ts:432-470` `not_existing_file`, `server.mjs:628` |
| 빌드 검증 | **없음** — 컨테이너 어디에도 install/build/serve 없음 | 두 컨테이너 `.mjs` grep 0건, 주석 "fresh clone has no node_modules" |
| 저장소 생성·배포 | **없음**(읽기만). "배포 토큰 안 만짐"은 문서·프롬프트 문구로만 존재 | `github-oauth.ts:180`, `export.ts:790` |
| 예산 | 수리 워커에 **달러 예산 없음**(3회·5분). 검수·수리 잡은 일일 상한 밖 | `server.mjs:611-614`, `beta-limits.ts` |
| 벤더 | **OpenAI 하나** 도달(Anthropic 403 티켓 열림, Gemini 지역 차단) | `HANDOFF-2026-08-31.md:82` |
| 여정 감사 | KO **P0=0 · P1=0 · P2=10**(전부 비활성 버튼 이유 표시 부류) | 2026-09-24 실주행 |
| 사용자 | **0명** | `HANDOFF-2026-09-02.md:125` |

**결론:** 화면 흐름은 깨끗한데 "제대로 작동 안 한다"고 느끼는 이유는 **산출물의 깊이**(브리프 ≠
지시서)와 **실행 주체**(유저 ≠ Simsa)다. 스펙→전체 앱은 튜닝이 아니라 **새 능력 4가지**가 필요하다:
① 지시서 수준 스펙 ② 저장소 생성·스캐폴드 ③ 컨테이너 안 설치·빌드·기동·테스트 ④ 달러 예산 게이트.

### 0.2 SI 업체의 산출물 사슬에 대응시키면

| SI | Simsa 티어 | 산출물 |
|---|---|---|
| 요구사항 정의·설계서 | **T0 개발 지시서** (최소 티어, 항상 생산) | 기능 ID·수용 기준·화면 정의·데이터 모델·API 계약·비기능·WBS·테스트 계획 |
| 개발 | **T1 빌드** | Simsa 컨테이너에서 에이전트가 저장소 생성→구현→**빌드·테스트 green** 확인 |
| 검수·인도 | **T2 인도** | 프리뷰를 실브라우저로 T0 테스트 계획대로 검수→수리→수용→영수증(receipt) |

### 0.3 의존 사슬 (이게 없으면 다음이 무의미)

```
T0 기계검증 가능한 수용 기준  ──없으면──▶ T1 에이전트가 "다 됐다"를 스스로 판단 불가
컨테이너 안 빌드·기동          ──없으면──▶ T1 결과는 "만들었다"가 아니라 "썼다" (증거 규칙 위반)
저장소 생성 + 동의             ──없으면──▶ T1 산출물을 둘 곳이 없음
달러 예산 게이트               ──없으면──▶ T1 첫 실행부터 비용 통제 불가 (지금 수리 워커가 그 상태)
T0 테스트 계획                 ──없으면──▶ T2 검수는 "핵심 흐름 하나"에 머무름 (지금 상태)
```

---

## 1. 결정 (D-번호)

원칙과 파라미터를 분리한다. `[LOCKED]`는 재론 금지(reopen은 D-번호 인용), `[PILOT]`은 절차는 잠금·수치는
실험 전 조정 가능, `[OPEN]`은 미결 + 재검토 트리거.

### D-1 [LOCKED] 제품 산출물 3티어 — T0는 항상 생산된다
- T0 개발 지시서 / T1 빌드 / T2 인도. **T0 없이는 T1·T2를 시작하지 않는다.**
- 유저가 T1을 켜지 않아도 T0는 그 자체로 인도물이다(외부 개발사·유저 에디터에 그대로 줄 수 있어야 한다).
- 기존 "빌더 팩"은 T0의 **렌더링 한 형태**로 흡수한다(별도 개념 폐지).

### D-2 [LOCKED] T0 스키마 — Zod로 정의하고 링크 무결성을 기계로 검사한다
`DevSpec` (D1 JSON 컬럼 + Zod, `apps/central-plane/src/workspace/dev-spec.ts` 신설):
- `features[]` — `FR-001`… id·제목·설명·우선순위(must/should/could)
- `acceptance[]` — `AC-001`… **Given/When/Then** 3필드·`featureId`·`verifiedBy: build|test|browser|human`
- `screens[]` — `SCR-…` 라우트·목적·주요 컴포넌트·상태(빈/로딩/오류/성공)·진입/이탈·`featureIds[]`
- `dataModel[]` — 엔티티·필드(타입·필수·기본값)·관계·소유권(RLS 힌트)
- `apis[]` — 경로·메서드·요청/응답 형태·오류·인증·`featureIds[]`
- `nonFunctional[]` — 성능·보안·접근성·i18n·비용 (모르면 `unknown`, 지어내지 않음)
- `workBreakdown[]` — `WBS-…` 순서·의존·완료 조건(`acceptanceIds[]`)
- `testPlan[]` — AC마다 실행 가능한 시나리오(브라우저 단계 또는 테스트 이름)
- `assumptions[]`·`openQuestions[]` — 유저가 답할 것과 우리가 가정한 것 분리
- **무결성 규칙(결정론, 저장 전 실패):** 모든 AC는 정확히 1개 FR에 연결 · 모든 FR은 ≥1 AC · 모든 must FR은 ≥1 SCR 또는 API · 고아 WBS 없음 · 숫자 점수 필드 없음(PRD §5.1).
- 현행 `ProductSpec` 9필드는 `DevSpec.brief`로 보존(하위호환·마이그레이션 없음).

### D-3 [LOCKED] T0 생성은 다단계 + 벤더 라우팅 + 프론티어 모델
- 단일 14k 토큰 호출 금지. **브리프 → 섹션별 생성(features/AC → screens → data/api → WBS/test) → 무결성 검사 → 위반 시 해당 섹션만 재생성**.
- 모든 호출은 `vendor-routing.ts` 단일 출처 경유(직접 SDK 금지, CLAUDE.md 효율 게이트 원칙).
- `[PILOT]` 모델: 현재 도달 벤더가 OpenAI뿐이므로 파일럿은 `gpt-5.4`; Anthropic 해제 시 `claude-opus-5` 추가. 수치(섹션당 max_tokens·재시도 1회)는 파일럿 전 조정 가능.
- 한국어 리얼 입력(Rule 6)으로만 "생성 진짜"를 판정한다 — 예시 폴백은 T0에서 **금지**(`llm_unavailable`은 정직하게 실패).

### D-4 [LOCKED] T1은 Simsa 컨테이너 안에서 설치·빌드·테스트까지 하고, green이 아니면 "완성"이라 말하지 않는다
- 새 컨테이너 클래스 `SimsaBuilder`(sandbox 이미지 확장: node20·pnpm·git·gh·playwright 런타임). **런타임 `pnpm install`·`pnpm build`·`pnpm test` 허용**(egress 필요).
- 잡 상태: `queued → scaffolding → implementing(WBS-n/N) → building → testing → pushed → done | failed(stage, reason)`. 대시보드는 이 상태를 그대로 보여준다(진행률 % 아님).
- **빌드 미확인 상태로 push된 커밋은 `build: unverified` 트레일러**를 달고 UI에 "빌드 확인 못 함"으로 표기. 증거 규칙(`docs/EVIDENCE-RULE.md`).
- 워커: `packages/agent-worker` 확장 — `create_file`·`run_command`(allowlist: pnpm/node/git/ls/cat) 툴 추가. 기존 `submit_rewrite`·`submit_edits`·비밀 차단(`denied_file`·`introduces_secret`) 유지.
- `[PILOT]` 상한: WBS당 반복 4회·잡 전체 45분·스냅샷 200KB 유지. 파일럿 후 고정.

### D-5 [LOCKED] 저장소는 유저 계정에, 스택은 파일럿 동안 고정
- GitHub App으로 **유저 계정/조직에 저장소 생성**(명시 동의 1회·저장소 이름 확인). Simsa 조직이 유저 코드를 소유하지 않는다.
- T0는 스택 불가지(PRD 보편성 유지). **T1 파일럿 스택은 Next.js + Supabase + Vercel 하나로 고정**(Rule 4 패턴, 템플릿 저장소 1개). 다른 스택은 T0까지만 제공하고 "T1 준비 중"으로 표기.
- `[PILOT]` 템플릿 내용(auth·RLS 템플릿·env 스캐폴드)은 파일럿 전 조정 가능.

### D-6 [LOCKED] Simsa는 배포 토큰을 갖지 않는다 — 프리뷰는 자기 컨테이너에서 띄운다
- 기존 결정(prep 옵션 A, 2026-07-06) 유지·**코드로 강제**: 환경변수 allowlist에 Vercel/Netlify/CF 배포 토큰 키 이름을 두지 않고, `run_command` allowlist에서 `vercel`·`netlify`·`wrangler deploy` 차단, 테스트로 고정.
- T2 검수 대상 = **SimsaBuilder 컨테이너가 기동한 프리뷰**(Worker 경유 임시 URL, 잡 종료 시 소멸). Supabase는 유저의 prep-A 키(브라우저 주입) 또는 Supabase 로컬 에뮬레이터 `[OPEN → D-12]`.
- 프로덕션 배포는 유저 몫(기존 MCP 안내 경로 유지). T2 영수증에 "프로덕션에는 아직 없음" 명시.

### D-7 [LOCKED] 달러 예산은 잡 시작 전에 결정되고 UI에 보인다
- `build_jobs.budget_usd`·`spent_usd`(벤더 usage 로그 합산). 상한 도달 시 **현재 WBS 단계에서 정지·push·상태 `failed(budget)`**. 조용한 초과 없음.
- 베타 일일 상한에 `builds/day` 추가(현행 검수 100·생성 20 옆에). 수리 워커도 같은 예산 계좌를 쓰도록 이관(현재 무예산 상태 해소).
- `[PILOT]` 수치: 프로젝트당 T1 $10·T2 $5·일 3빌드. 과금 도입은 별도 결정(PRD §12 무료 유지 결정 존중).

### D-8 [LOCKED] 모든 T1·T2 실행은 acceptance 4중항을 남긴다 — 이것이 $500K의 사용처
- `(DevSpec, 빌드 증거, 검수 판정, 수정 diff)`를 training-store에 **기존 동의 정책 그대로**(opt-in, 익명 ID) 기록.
- 목적: 생성기가 아니라 **판정기 자체화**(검수 판정·결함→수정 매핑 증류)의 코퍼스. 코퍼스 규모 임계 전에는 모델 학습 착수 금지 `[OPEN → D-13]`.

### D-9 [LOCKED] 판정 어휘·불변식은 그대로
- 숫자 점수 없음. T1 "완료" = must AC 전부 `verifiedBy: build|test|browser` 통과. 하나라도 `human`이면 **User Acceptance Required**. 브라우저 증거 ≠ AI 의견 분리 유지(PRD §5).

### D-10 [PILOT] 컨테이너 동시성·비용
- 시작: `SimsaBuilder max_instances = 5`, `instance_type = standard`(2 vCPU/4GB, 빌드에 basic 1GB는 부족 — 추정, 파일럿에서 실측). 실측 후 고정.

### D-11 [LOCKED] EN 우선 동등성
- DevSpec 렌더·잡 상태·영수증은 **EN/KO 동시 출하**(YC 데모는 영어). 한쪽만 되는 화면은 배포 금지(기존 E 트레인 규율).

### D-12 [OPEN] 프리뷰의 DB
- 후보 A: 유저 prep-A Supabase 키를 컨테이너에 잡 수명 동안만 주입(서버 무저장 원칙과 충돌 — 메모리 내만 허용 시 가능). 후보 B: 컨테이너 안 Postgres + supabase 로컬 스택(무겁다). 후보 C: T2 파일럿은 DB 없는 템플릿부터.
- **재검토 트리거:** Train B B5(빌드 게이트) 통과 시점. 권고: C로 시작 → A.

### D-13 [OPEN] 판정 모델 자체화 착수 임계
- 트리거: 4중항 코퍼스 ≥ 5,000건 **또는** 검수 벤더 비용이 월 $2K 초과. 그 전엔 착수 금지.

### D-14 [OPEN] T1 실행기 — 자체 agent-worker 루프 vs Claude Code/Codex CLI in-container
- 권고: **자체 agent-worker 루프**(이미 tool_use·벤더 폴백·비밀 차단 보유, CLI는 구독 인증·헤드리스 제약). 재검토 트리거: B4에서 WBS 3개 이상 연속 실패.

### D-15 [LOCKED] Private 저장소 — 지금도 되고, 계속 GitHub App 설치 토큰으로 간다 (Bae 질문 2026-09-24)
**현행 사실(코드):** 로그인 OAuth는 `public_repo` 범위라 **private 저장소를 보지 못한다**(`github-oauth.ts:170`). private는
**GitHub App 설치 토큰으로 폴백**해 읽기·PR·푸시를 한다(`github-app-access.ts:144` `resolveRepoAccessToken`,
OAuth-first → App-fallback). 2026-07-20 Test B에서 private 자동수리가 `simsa-repair[bot]` 커밋으로 라이브 실증됨.
조건은 하나 — **유저가 App을 그 저장소에 설치**(설치 시 "선택한 저장소"면 추가 1클릭). 저장소가 설치에 추가되면
`installation_repositories` 웹훅으로 즉시 인지한다(`saas-auth.ts:168`, #435 백필 포함).
- 결정: T1도 같은 경로. **OAuth 범위를 `repo`로 넓히지 않는다**(전체 private 열쇠를 요구하면 비개발자가 가장 먼저 이탈).
- **새 저장소 생성**은 설치 토큰으로 불가능(GitHub 제약: 유저 계정 저장소 생성은 유저 토큰 필요). 파일럿 경로:
  1) Simsa가 템플릿 딥링크(`github.com/new?template_owner=…&template_name=…&name=<제안명>&visibility=private`)를 열어 **유저가 2클릭으로 자기 계정에 private 저장소를 만든다**
  2) 이어서 App 설치/추가 화면으로 보내고, 웹훅이 오면 화면이 자동으로 "연결됨"으로 바뀐다(폴링 아님)
  3) 그 뒤 모든 쓰기는 설치 토큰.
- `[PILOT]` 후속: GitHub App **user-to-server 토큰 + Administration:write**로 1클릭 생성. 기존 설치자 전원에 권한 재승인 요청이 가므로 파일럿 뒤에 판단.

### D-16 [LOCKED] DB·배포 권한 모델 — 배포 토큰 0, DB는 잡 수명 메모리 전달, OAuth 커넥터는 Supabase만 후순위
| 대상 | 파일럿(지금) | 후속 | Simsa가 갖는 것 |
|---|---|---|---|
| **Vercel(배포)** | 유저가 **자기 Vercel에 Git 연동 1회**(Simsa가 `vercel.com/new/clone?repository-url=…` 딥링크 제공). 이후 push마다 Vercel이 배포하고, Simsa는 **유저가 붙여넣은 배포 URL**을 검수(현행 `/p/{id}/connect`) | GitHub `deployment_status` 이벤트 구독으로 URL 자동 인지(코드 없음 — 현재 `source-evidence.ts:114`는 호스트명으로 vercel 여부만 판별) | **토큰 없음** (D-6 유지) |
| **Supabase(DB)** | prep-A 그대로: 유저가 프로젝트 만들고 URL·anon·service_role·DB URL을 **브라우저에 붙여넣기**. T1 잡 시작 시 브라우저→Worker→컨테이너로 **헤더 전달**(현행 `x-anthropic-key` 패턴과 동일), **컨테이너 메모리에만 잡 수명 동안** 존재, D1·로그·스냅샷 기록 금지(테스트로 고정). 에이전트가 마이그레이션 적용·RLS 생성 | **Supabase OAuth 앱**(Management API)로 프로젝트 생성·마이그레이션·키 발급 1클릭. 토큰은 `CONCLAVE_TOKEN_KEK`로 암호화 저장 — 이 순간부터 "Simsa가 유저 인프라 자격증명을 보관"하는 첫 사례라 **별도 승인 게이트** | 파일럿: 없음 / 후속: 암호화된 Supabase OAuth 토큰 1종 |
| **GitHub** | D-15 | D-15 후속 | App 설치 토큰(일시)·OAuth `public_repo` |
| **Simsa 프리뷰** | 컨테이너 내부 기동(D-6). DB는 위 Supabase 키 주입 또는 D-12 C(DB 없는 템플릿) | — | — |
- **prep-A 불변식 정정:** "서버 무저장"은 유지(영속 저장 없음), "브라우저 주입"은 **"잡 수명 동안 메모리 전달"**로 확장한다. 위반 감지 테스트: 잡 종료 후 D1·R2·로그에 키 문자열 0건.
- 유저가 Supabase를 안 붙이면 T1은 **DB 없는 범위까지만** 만들고 영수증에 "DB 필요 기능 N개 미구현(키 미연결)"로 정직하게 표기.

---

## 2. 스테이지 트레인

에이전트 실행 단위로 잘게 나눈다(실패 격리). 각 스테이지 = PR 1개(base=main, 스택 금지), 테스트 동반, 머지≠배포.

### Train A — T0 개발 지시서 (Anthropic 해제 무관, 지금 착수 가능)
| # | 스테이지 | 완료 조건 |
|---|---|---|
| A1 | `dev-spec.ts` Zod 스키마 + 무결성 검사기 + D1 마이그레이션(`dev_spec` JSON 컬럼) | 무결성 위반 픽스처 6종이 실패, 정상 1종 통과 |
| A2 | 다단계 생성기(`generate-dev-spec.ts`) — 벤더 라우팅 경유, 섹션별 재생성 | 한국어 리얼 기획 3건에서 무결성 통과·예시 폴백 0 |
| A3 | 렌더러: DevSpec → `simsa-dev-spec/` md 묶음(요구사항·화면·데이터·API·WBS·테스트) EN/KO + 기존 팩 흡수 | 렌더 스냅샷 테스트, 두 언어 파일 수 동일 |
| A4 | 대시보드 "개발 지시서" 화면(제품설명서 대체 아님·심화 단계로 추가), 다음 걸음 배선은 `layout.tsx` 단일 마운트 유지 | journey-audit KO/EN P0=P1=0 |
| A5 | 검수 계획 연결: 시각 검수가 `testPlan[]`을 소스로 사용(핵심 흐름 하나 → AC 전부) | 픽스처 앱에서 AC별 판정이 나옴 |
| A6 | 배포 + 라이브 실증(한글 기획 실입력·EN 토글·장비 재측정) | 세 칸 보고: 라이브확인/테스트만/미측정 |

### Train B — T1 빌드 (A1·A2 후 착수, B1은 A와 병렬 가능)
| # | 스테이지 | 완료 조건 |
|---|---|---|
| B1 | `SimsaBuilder` 컨테이너 클래스·이미지(egress·pnpm·playwright)·health | `containers instances`로 기동 확인, 30초 내 `pnpm -v` |
| B2 | GitHub App 저장소 생성 동의 흐름 + `POST /user/repos`(또는 org) + 실패 시 롤백 | 테스트 계정에서 생성·삭제 라운드트립 |
| B3 | 템플릿 저장소(Next+Supabase) + 스캐폴드 커밋 | 스캐폴드만으로 `pnpm build` green |
| B4 | agent-worker 확장: `create_file`·`run_command` allowlist·배포 명령 차단 테스트(D-6) | 차단 테스트가 옛 코드에서 실패함을 확인 |
| B5 | 빌드·테스트 게이트 + `build: unverified` 트레일러 + 잡 상태 머신·D1 `build_jobs` | 고의로 깨진 코드가 `failed(building)`으로 끝남 |
| B6 | 예산 계좌(D-7): 벤더 usage 합산·상한 정지·수리 워커 이관·일일 빌드 상한 | 상한 $0.5로 돌리면 WBS 중간에 정지 |
| B7 | 대시보드 잡 진행 화면(EN/KO) + 다음 걸음 배선 | journey-audit 신규 여정 J6 추가, P0=P1=0 |
| B8 | 파일럿: 실기획 3건 T0→T1 완주 | 3건 중 빌드 green 수·실패 사유 표, 정답지 선기록 |

### Train C — T2 인도 (B5 후)
| # | 스테이지 | 완료 조건 |
|---|---|---|
| C1 | 컨테이너 프리뷰 서빙(Worker 경유 임시 URL, 잡 종료 시 소멸) | 외부에서 200 + 내용 확인 |
| C2 | AC 기반 검수(A5 재사용) → 수리 워커(기존) → 재검수 루프, 예산 공유 | 픽스처 결함 1건이 find→fix→verify 자동 완주 |
| C3 | 영수증(receipt): must AC 표·미검증·"프로덕션 아님"·다음 행동(유저 배포 안내) EN/KO | `assertNoNumericScores` 통과 |
| C4 | 4중항 코퍼스 기록(D-8) + 관리자 집계 | 파일럿 3건이 training-store에 적재 |

### Train Y — YC / a16z 제출물 — **보류** (Bae 2026-09-24 "지원서는 일단 생각하지 말고 개발부터")
> 개발 트레인 A·B·C가 우선. Y는 B8(파일럿) 뒤에 재개하며, 그전까지 어떤 스테이지도 열지 않는다. 아래는 기록용.

| # | 스테이지 | 완료 조건 |
|---|---|---|
| Y1 | 데모 대본(기획 붙여넣기 → 지시서 → 빌드 → 프리뷰 검수 → 영수증) 2분 | 실제 라이브로 끊김 없이 1회 녹화 |
| Y2 | YC 26문항 초안(EN) — bae-pitch-writer/idea-critic 스킬, 팩트만 | Bae 검토 1회 |
| Y3 | speedrun 덱 10~12장 | Bae 검토 1회 |
| Y4 | 창업자 풀타임·법인·SF 상주 답변 | **Bae 결정** |

### 일정 (추정, 단독 에이전트 기준)
- Train A: ~1주 → 10/1 · Train B: ~2.5주 → 10/20 · Train C: ~1.5주 → 10/31 · Y1~Y3: 10/20~11/1
- **speedrun 우선 창구 10/12~11/1 · YC 마감 11/2 20:00 PT.** T0+T1 파일럿(B8)까지가 데모 최소선. C는 마감 뒤 완성돼도 지원서엔 "다음 4주 계획"으로 쓴다.

---

## 3. 자금 사용 서사 (Bae 질문 2026-09-24 "$500K로 뭘 하나")

- **못 하는 것:** 자체 생성 모델. 사전학습은 자릿수가 다르고, 파인튜닝은 컴퓨트가 아니라 **데이터가 병목**(현재 0건).
- **하는 것:** ① T1·T2 추론 비용을 우리가 부담해 무료로 만들어 주고 그 대가로 **acceptance 4중항 코퍼스**를 쌓는다(D-8) ② "AI가 만든 앱이 기획대로 됐는가" 공개 벤치마크 ③ 코퍼스 임계(D-13) 후 **판정 모델 자체화**로 비용 1/10·외부 의존 축소. 생성은 계속 외부 프론티어, 교체 가능하게.
- 배분 참고: 추론·벤치 60% / 인건비(엔지니어 2 + Bae) 30% / 판정 모델 10%(임계 후).

---

## 4. PRD 수정 대상 (design lock 후 같은 PR에서)
- §1 한 줄 정의에 "기획대로 작동하는 개발물을 내놓는다(T0/T1/T2)" 추가 (D-1)
- §3 두 축 → 축 A를 "의도 → **지시서 → 빌드** → 결과"로 (D-1·D-4)
- §6.2 빌더팩 → T0 렌더링으로 흡수 (D-1)
- §13 비목표 "자동 배포 없음" 유지 + "Simsa 컨테이너 프리뷰는 배포가 아님" 각주 (D-6)
- §15 격차에 "T1/T2 미구현" 항목 추가

---

## 5. Bae 결정 필요 (세션당 ≤3)

1. **`design lock approved`** — D-1~D-9·D-11·D-15·D-16 LOCKED 발효. 구현 착수 아님.
2. **T1 파일럿 스택 고정 확인** — Next.js + Supabase (D-5). 다른 스택이면 지금 말씀해 주십시오.
3. **Cloudflare Email Routing 연결**(Bae 액션 3, 이월) — 로그인 뒤 검수의 스위치. 대시보드 → 도메인 `trysimsa.com` → Email → Email Routing → Catch-all → Action "Send to a Worker" → `conclave-ai` 선택 → 저장. 권장 서브도메인 `probe.trysimsa.com`(Resend 발송과 분리). 연결되면 검수 화면의 "확인 메일을 받을 준비가 되어 있지 않습니다" 문구가 사라지는지로 확인.

~~지원서용 답(풀타임·법인·SF 상주)~~ — Train Y 보류로 이번엔 묻지 않음.

---

## 6. 게이트 레지스트리

| 게이트 | 문구 | 발효 일시 | 범위 |
|---|---|---|---|
| 설계 잠금 | `design lock approved` | — | D-1~D-9·D-11 LOCKED |
| Train A 착수 | `train A start approved` | — | A1~A6 코드 작성만 |
| Train B 착수 | `train B start approved` | — | B1~B8 코드 작성만 |
| Train C 착수 | `train C start approved` | — | C1~C4 코드 작성만 |
| 머지 | `PR #N merge approved.` | — | 해당 PR |
| 배포 | `deploy central-plane approved.` / `deploy dashboard approved.` | — | 1회 |
| 마이그레이션 | `migration <id> apply approved.` | — | 1건 |
| 파일럿 | `pilot start approved.` | — | B8 실기획 3건 |

---

## 7. 이번 세션 실측 기록 (증거)
- 인프라: simsa.dev 200 · app.trysimsa.com 307→/projects · Worker /health 200 · 카나리 3주 연속 green · 열린 PR 0 · 마지막 central 배포 2026-09-01(main `c4158eb`)
- journey-audit KO: P0=0 P1=0 P2=10 (`tools/simsa-completion-loop-spike/journey-audit-result.json`)
- 익명 스모크(`anonymous-smoke.mjs`): 장비 노후 2건(첫 화면 `textarea` 2개 매칭 · 답한 질문의 '추천대로' 버튼이 사라져 인덱스 클릭 실패) → **같은 세션에서 수리, 프로덕션 재주행 8/8 PASS**(실 LLM 경유 생성 `proj_bb4rp470`·사이드바·GitHub 탭 숨김·삭제 QA ⓐⓑ)
- 로그인 뒤 검수: UI에 "확인 메일을 받을 준비가 되어 있지 않습니다" (Bae 액션 3 Email Routing 미연결)
- repo secret `LLM_PROBE_TOKEN` 2026-08-21 존재(워커 값 일치 여부 미확인)
