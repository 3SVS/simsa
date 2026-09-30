# Simsa SI 티어 설계 — "기획을 넣으면 기획대로 작동하는 개발물이 나온다"

**작성 2026-09-24 · 수정 2026-09-24 오후(Bae 결정: 기본 경로 = S Simsa 호스팅, A는 개발자 모드) · 상태: `design lock approved` 2026-09-24 (Bae) — D-1~D-9·D-11·D-12·D-15~D-17 LOCKED 발효. Train A·N 착수 승인.**
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

### 0.4 초보자 기본 경로 — 유저가 만들 계정 0개, 클릭 3번 (Bae 2026-09-24 "초보자 대상인 거 알잖아")

| 방식 | 유저 계정 | 클릭 | 우리가 지는 것 |
|---|---|---|---|
| A. 유저 인프라(GitHub·Vercel·Supabase 딥링크) — **개발자 모드로 유지** | 3 | ~15 | 없음. 초보자 이탈 |
| M. OAuth 커넥터 | 2 | ~6 | 파트너 OAuth·토큰 보관 |
| **S. Simsa 호스팅(기본)** — 코드는 Simsa 조직, 실행은 우리 Cloudflare, DB는 프로젝트당 D1 | **0** | **3** | 호스팅 비용·악용 대응·가동 책임. "내 계정으로 가져가기"로 상쇄 |

초보자 여정(S): 기획 붙여넣기 → "이렇게 이해했어요, 맞나요?" → **만들기** → 진행 상태 → `내앱.simsa.app`에서 직접 눌러봄 →
"여기 이상해요" 한 줄 → 수리 → 재확인 → (원하면) 내 GitHub로 가져가기. 지시서(ERD·API)는 접힌 "개발자용"에만 보인다.

### 0.5 세 갈래 커버리지 — 아이디어 · 기획서 · 이미 만든 것 (Bae 질문 "그 3가지가 다 커버 가능한가")

| 갈래 | T0 지시서 | T1 빌드 | T2 검수·인도 | 유저 계정 |
|---|---|---|---|---|
| **아이디어** | 인터뷰 → DevSpec | **S** (Simsa 호스팅) | S 배포 주소를 AC대로 검수·수리 | 0 |
| **기획서 붙여넣기** | 변환 → DevSpec | **S** | 위와 동일 | 0 |
| **이미 만든 앱 — 주소만**(Lovable·Bolt 등, 코드 없음) | 주소에서 **역추론 DevSpec**(AF 트레인의 의도 추론을 스키마로 승격) | 재빌드 없음. 선택지 **"Simsa에서 새로 만들기"**(역추론 DevSpec으로 S 빌드 — 기존 데이터 승계 안 됨을 명시) | 라이브 URL 검수(현행) + 그들 도구용 수정 지시(현행 fix brief) | 0 |
| **이미 만든 앱 — GitHub 연결**(private 포함) | 저장소+주소에서 역추론 DevSpec | **A 모드**: 그들 저장소에 수리 PR(현행 워커) — 단 **D-4 빌드 검증을 수리 워커에도 적용**(지금은 문법 검사뿐). 스택이 S 템플릿과 호환이면 **"Simsa로 가져오기"** 제공(D-18) | 배포 URL 검수 + 수리 PR 라운드트립 | GitHub 1(이미 있음) |

- 세 갈래 모두 **T0가 공통 척도**다. "이미 만든 것" 갈래는 T0를 *앞*이 아니라 *뒤*에서(역추론) 얻고, 검수는 그 AC를 기준으로 한다.
- 정직성: 역추론 DevSpec은 `source: inferred`로 표시하고 must AC는 유저가 "맞나요?"에서 확인한 것만 인정한다.

---

## 1. 결정 (D-번호)

원칙과 파라미터를 분리한다. `[LOCKED]`는 재론 금지(reopen은 D-번호 인용), `[PILOT]`은 절차는 잠금·수치는
실험 전 조정 가능, `[OPEN]`은 미결 + 재검토 트리거.

### D-1 [LOCKED] 제품 산출물 3티어 — T0는 항상 생산된다
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 기존 앱 문(안 됨·생각과 다름)의 최소 인도물 = "확인된 문제 + 수정 후 재확인 결과(user_verdict)". T0(inferred)는 판정 척도로 내부 생성하고 유저에게 문서 단계를 강요하지 않는다. T2 시작 조건 = "맞나요? 카드에서 확인한 must 항목 ≥1".
- T0 개발 지시서 / T1 빌드 / T2 인도. **T0 없이는 T1·T2를 시작하지 않는다.**
- 유저가 T1을 켜지 않아도 T0는 그 자체로 인도물이다(외부 개발사·유저 에디터에 그대로 줄 수 있어야 한다).
- 기존 "빌더 팩"은 T0의 **렌더링 한 형태**로 흡수한다(별도 개념 폐지).

### D-2 [LOCKED] T0 스키마 — Zod로 정의하고 링크 무결성을 기계로 검사한다
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 추가만: `DevSpecMeta.provenance{ builtWith, entryPath, detectedStack, userConfirmedAcIds[] }`. 무결성 규칙 추가 — `source === "inferred"`이면 must AC는 `userConfirmedAcIds`에 있는 것만 must(출처 구분).
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

### D-5 [LOCKED] 코드는 Simsa 조직 private 저장소에, 소유권은 유저 것 — 스택은 파일럿 동안 Cloudflare 네이티브 하나
*(2026-09-24 오후 수정 — 종전 "유저 계정에 생성 + Next.js/Supabase"는 A 모드로 강등)*
- **S 모드(기본):** 프로젝트당 Simsa GitHub 조직에 private 저장소 자동 생성(유저 클릭 0). 유저는 언제든 **zip 다운로드**·**"내 GitHub로 가져가기"**(저장소 소유권 이전 — 그때 처음 GitHub 계정 필요)가 가능하고, 약관에 "코드는 유저 소유, Simsa는 보관·실행 대행"을 명시. 저장소 이름은 `simsa-hosted/<projectId>`.
- **A 모드(개발자):** 유저 저장소에서 작업(D-15 경로). 새로 만들지 않고 **이미 있는** 저장소만 연결.
- T0는 스택 불가지(PRD 보편성 유지). **S 템플릿은 Cloudflare 네이티브 하나로 고정: Hono Worker + React/Vite + D1**(우리가 호스팅하는 스택과 일치). Next.js + Supabase + Vercel은 "가져가기" 시 T0 지시서의 이전 안내에만 등장.
- `[PILOT]` 템플릿 내용(라우팅·D1 마이그레이션·간단 세션)은 파일럿 전 조정 가능. **앱 내 로그인·결제·이메일 발송은 파일럿 범위 밖** — 지시서에 "이번 버전 제외"로 정직하게 표기(넣는 순간 계정 문제가 돌아온다).

### D-6 [LOCKED] 유저의 배포 토큰은 갖지 않는다 — 실행은 우리 Cloudflare 계정(Workers for Platforms)에서
> **[주석 ① 적용 범위 — [제안 — design lock 대기] 2026-09-30 W-D, 계획 `docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §5.2 W-D 행(`:199` "D-6 amend 2건")·§5.3]** **지금의 효력은 본문 그대로다.** 아래 "호스팅 사업자 의무(파일럿 전 필수 … 없으면 `pilot start approved` 불가)"에는 범위 한정이 없으므로, **D-6 amend가 발효되기 전까지는 파일럿 (b)(c)도 B7(호스팅 의무)이 선행한다.**
>
> 제안하는 amend: `design lock approved`(D-6 amend)로 발효되면, 이 선행 조건은 S 호스팅을 쓰는 파일럿 범위 (a)(B10 (a) 3건: 지시서 → 빌드 → `<slug>.simsa.page`)에만 걸린다. (b)(c)는 Lovable·v0·Bolt가 호스팅하는 앱을 검수·수리할 뿐 우리 계정에 아무것도 올리지 않으므로 이 의무가 `pilot start approved.`(b)(c)를 막지 않게 된다. 원칙·의무 목록은 amend 뒤에도 그대로다.
>
> 계획 §5.3의 (b)(c) 임계 경로(`:249`)에 B-7이 없는 것은 이 amend를 전제로 한 것이다 — amend가 거절되면 (b)(c) 경로에 B-7을 넣어야 한다. 이 amend의 승인 근거는 아직 없다: `train W start approved`(2026-09-28)는 문서 작성 범위이고, D-6 amend의 설계 잠금 문구는 레포에 0건이다(재정렬 문서·`docs/HANDOFF-2026-09-27.md`·`docs/HANDOFF-2026-09-29.md`에서 "D-6" grep 0건, 계획 `:199`에만 등장). 이견이 있으면 D-6을 인용해 reopen.
>
> **[주석 ② 파라미터 기록 2026-09-30 — W-D]** 아래 `[PILOT] 도메인명`은 **`simsa.page`**로 정해졌다(2026-09-25 Bae, Cloudflare Registrar 구매 — `docs/HANDOFF-2026-09-25.md:14-16`). 코드 `HOSTING_ROOT_DOMAIN = "simsa.page"`: `apps/hosting-dispatch/wrangler.toml:15`(#538 `69605d4`, 2026-09-25) · `apps/central-plane/wrangler.toml:45`(#548 `e82f12e`, 2026-09-27 — `git log -S` 기준). 본문의 `<slug>.simsa.app`은 원문 표기로 남긴다 — `simsa.app`은 타인 소유 도메인이다(RDAP, 같은 HANDOFF `:14`).
*(2026-09-24 오후 수정 — 종전 결정의 **의도**는 "유저 자격증명 미보관"이지 "유저 인프라에서 실행"이 아니었다)*
- **S 모드:** 빌드 산출물을 **Cloudflare Workers for Platforms**(dispatch namespace, 테넌트별 격리)에 우리 계정 토큰으로 배포. 주소 `<slug>.simsa.app`(와일드카드 도메인, `[PILOT]` 도메인명). 이 토큰은 central-plane 배포와 같은 **운영 자격**이며 유저 자격증명이 아니다. 저장은 GitHub Actions/Worker secret만(로컬 wrangler 금지 — 기존 규율).
- **유저 토큰 금지는 코드로 강제:** 환경변수 allowlist에 Vercel/Netlify/유저 CF 토큰 키 이름 없음, 워커 `run_command` allowlist에서 `vercel`·`netlify`·`wrangler deploy` 차단, 테스트로 고정.
- T2 검수 대상 = **S 배포 주소 자체**(프리뷰=프로덕션 초기값). 유저가 "가져가기"로 옮기기 전까지 그 주소가 실서비스다. 영수증에 "Simsa 호스팅 중 · 언제든 가져갈 수 있음" 명시.
- **A 모드:** 종전대로 유저가 자기 배포(딥링크·MCP 안내), Simsa는 URL만 검수.
- **호스팅 사업자 의무(파일럿 전 필수, Train B 스테이지):** 프로젝트별 킬스위치·신고 링크·요청 상한·금지 콘텐츠 규칙(피싱·스팸·성인)·자동 정지 로그. 없으면 `pilot start approved` 불가.

### D-7 [LOCKED] 달러 예산은 잡 시작 전에 결정되고 UI에 보인다
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** [PILOT] 수치 추가 — 검수·수리 라우트 유저당 일일 상한(검수 10/일·수리 5/일) + `INSPECTION_ENABLED`/`REPAIR_ENABLED` [vars] 킬스위치. BM 분석(#550 §1)이 확인한 build-loop 요청-모델 과금·pricing.ts 단가 결함은 이 결정의 집행 전제.
>
> **[주석 2026-09-30 — W-D, 계획 정본 §5.2 W-D]** 아래 `[PILOT]`의 **T2 $5(프로젝트당 달러 예산)는 일일 횟수 상한으로 대체**한다. 실브라우저 검수는 LLM을 한 번도 부르지 않아 회당 원가 $0.004다(BM `docs/simsa-bm-economics-2026-09-27.md:17` — inspector-container grep 0건). 달러 계좌로 셀 것이 없으므로 비용 통제 수단은 횟수 상한·킬스위치다. 단 **일일 상한 3층에 계상되는 것은 유저가 누른 검수·수리뿐**이다. 시스템이 시작하는 자동 재검수(verify-sweep, 10분 크론)는 일일 상한 밖에 있고, **스윕당 10건** 별도 상한과 킬스위치만 적용된다(아래 표 #561 행). **T1 $10·일 3빌드는 그대로**(B-6 예산 정지는 미구현 — main 기준 빌드 실행체 B5(b)가 없다, 계획 §5.1). 수치는 전부 `[PILOT]`이고 원칙("잡 시작 전 결정·UI에 보임·조용한 초과 없음")은 바뀌지 않는다.
>
> 2026-09-28~30 집행된 상한 (세 칸은 `docs/EVIDENCE-RULE.md` R2):
>
> | PR · 커밋 | 무엇 | 수치 `[PILOT]` | 배포 | 라이브확인 / 미측정 |
> |---|---|---|---|---|
> | #561 `a47e72a` | 검수·수리 **일일 상한 3층**(사용자·네트워크·서비스 전체) + 킬스위치 `INSPECTION_ENABLED`/`REPAIR_ENABLED`. **킬스위치**는 `dispatchInspection`·`dispatchRepairJob` 내부라 크론과 공유한다(`apps/central-plane/src/routes/workspace-visual-check-runs.ts:178` · `workspace-repair-jobs.ts:232`). **일일 상한 3층은 run 라우트에서만 차감**된다(검수 `workspace-visual-check-runs.ts:473-483` "Charged only here" · 수리 `workspace-repair-jobs.ts:426-431`). **verify-sweep 자동 재검수는 일일 상한에 계상되지 않고**, 스윕당 10건(`VERIFY_SWEEP_MAX_DISPATCH` — `apps/central-plane/src/workspace/verify-sweep.ts:24-29, 60, 131-135`)을 10분 주기(`apps/central-plane/src/index.ts:313-325`)로 따로 상한한다. 입력은 24시간 창의 수리 PR 머지 신호이고 신호당 재검수는 1회다(`verify-sweep.ts:12-15, 94`). `dispatchInspection` 호출자는 run 라우트(`workspace-visual-check-runs.ts:542`)와 verify-sweep(`verify-sweep.ts:169`) 둘뿐이다. 수리 dispatch 호출자는 라우트 하나(`workspace-repair-jobs.ts:479`)라 수리에는 상한 밖 경로가 없다 | 검수 10 · 30 · 300 / 수리 5 · 15 · 50 (UTC 하루) — `apps/central-plane/src/workspace/beta-limits.ts:60-76`, `apps/central-plane/wrangler.toml:27-31` | 2026-09-29 run 36503316428 | 라이브확인: 검수 2회 dispatch가 새 상한 경유(`docs/HANDOFF-2026-09-29.md:22`) / 미측정: 실제 429·503 화면(같은 파일 `:27`), 수치 Bae 확인 대기(`:35`) |
> | #562 `4b3fe4f` | L-3 사용량 원장 `llm_usage`(0070) + `/admin/usage-stats` — **T1 달러 예산(B-6)의 입력** | 없음(단가 공식가 L-1) | 2026-09-29 run 36503316428(0070 적용) | 라우트 도달만(무토큰 401 — 상태 코드라 내용 증거 아님) / 미측정: 행 실제 적재(HANDOFF-2026-09-29 `:27`) |
> | #566 `3a1ca07` | 상한 카운터 저장 키를 KEK 파생 HMAC(`v1:`)으로 · 48시간·옛 형식 청소 크론 · 방침 고지. **수치 불변**, 배포 순간 카운터 1회 초기화 | 불변 | 2026-09-30 run 36721292314(Version 7f14fb1d, 마이그레이션 없음) + dashboard `5jg3lrr6o` | 라이브확인: 방침 페이지 "요청 횟수 제한"·시행일 2026-09-30(2026-09-30 응답 본문 확인) / 미측정: 첫 `rate-limit-purge` 틱의 옛 행 삭제 |
> | 진행 중 — **PR 번호 미정** | 비용 상한(브랜치 `feat/cost-caps-repair-generation`, 2026-09-30 기준 origin에 없음·열린 PR 0) — [추정] 브랜치 이름상 수리·생성 경로 | 미정 | — | 미측정. PR이 열리면 이 행을 번호·수치로 채운다 |
- `build_jobs.budget_usd`·`spent_usd`(벤더 usage 로그 합산). 상한 도달 시 **현재 WBS 단계에서 정지·push·상태 `failed(budget)`**. 조용한 초과 없음.
- 베타 일일 상한에 `builds/day` 추가(현행 검수 100·생성 20 옆에). 수리 워커도 같은 예산 계좌를 쓰도록 이관(현재 무예산 상태 해소).
- `[PILOT]` 수치: 프로젝트당 T1 $10·T2 $5·일 3빌드. 과금 도입은 별도 결정(PRD §12 무료 유지 결정 존중).

### D-8 [LOCKED] 모든 T1·T2 실행은 acceptance 4중항을 남긴다 — 이것이 $500K의 사용처
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 기록 단위 = 4중항 + **맥락 봉투**(region·locale·content_lang·entry_path·built_with·detected_stack·topic_tags·acquisition, 스키마는 `training-store.ts EnvelopeInput` 그대로) + **사람 수용 라벨**(`finding_codes[]`·`user_verdict`·`resolved`). 검수 행(`workspace_visual_checks`)에 컬럼으로 존재해야 한다(0069, additive).
- `(DevSpec, 빌드 증거, 검수 판정, 수정 diff)`를 training-store에 **기존 동의 정책 그대로**(opt-in, 익명 ID) 기록.
- 목적: 생성기가 아니라 **판정기 자체화**(검수 판정·결함→수정 매핑 증류)의 코퍼스. 코퍼스 규모 임계 전에는 모델 학습 착수 금지 `[OPEN → D-13]`.

### D-9 [LOCKED] 판정 어휘·불변식은 그대로
- 숫자 점수 없음. T1 "완료" = must AC 전부 `verifiedBy: build|test|browser` 통과. 하나라도 `human`이면 **User Acceptance Required**. 브라우저 증거 ≠ AI 의견 분리 유지(PRD §5).

### D-10 [PILOT] 컨테이너 동시성·비용
- 시작: `SimsaBuilder max_instances = 5`, `instance_type = standard`(2 vCPU/4GB, 빌드에 basic 1GB는 부족 — 추정, 파일럿에서 실측). 실측 후 고정.

### D-11 [LOCKED] EN 우선 동등성
- DevSpec 렌더·잡 상태·영수증은 **EN/KO 동시 출하**(YC 데모는 영어). 한쪽만 되는 화면은 배포 금지(기존 E 트레인 규율).

### D-12 [LOCKED] S 모드의 DB = 프로젝트당 Cloudflare D1 하나 (2026-09-24 오후 해소)
- 우리 계정 API로 생성·바인딩, 마이그레이션은 빌드 잡이 적용. 유저 키 0개. "가져가기" 시 D1 export(SQL 덤프)를 zip에 동봉.
- A 모드는 종전 후보(유저 Supabase 키 잡 수명 메모리 전달)를 D-16에 둔다.

### D-13 [OPEN] 판정 모델 자체화 착수 임계
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 주석 — 임계(4중항 ≥5,000 / 월 $2K)는 **모델 학습 착수**에만 적용. 집계·분석·프롬프트 튜닝은 첫 건부터.
- 트리거: 4중항 코퍼스 ≥ 5,000건 **또는** 검수 벤더 비용이 월 $2K 초과. 그 전엔 착수 금지.

### D-14 [OPEN] T1 실행기 — 자체 agent-worker 루프 vs Claude Code/Codex CLI in-container
- 권고: **자체 agent-worker 루프**(이미 tool_use·벤더 폴백·비밀 차단 보유, CLI는 구독 인증·헤드리스 제약). 재검토 트리거: B4에서 WBS 3개 이상 연속 실패.

### D-15 [LOCKED] Private 저장소 — 지금도 되고, 계속 GitHub App 설치 토큰으로 간다 (Bae 질문 2026-09-24)
*(적용 범위: **A 모드와 "이미 만든 앱 — GitHub" 갈래**. S 모드는 유저 GitHub이 아예 필요 없으므로 해당 없음. 아래 "새 저장소 생성 딥링크"는 A 모드 옵션으로만 남긴다.)*
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

### D-16 [LOCKED] A 모드(개발자)의 DB·배포 권한 모델 — 유저 토큰 0, DB 키는 잡 수명 메모리 전달, OAuth 커넥터는 Supabase만 후순위
*(적용 범위: A 모드만. S 모드는 D-5·D-6·D-12로 유저 계정 0개.)*
| 대상 | 파일럿(지금) | 후속 | Simsa가 갖는 것 |
|---|---|---|---|
| **Vercel(배포)** | 유저가 **자기 Vercel에 Git 연동 1회**(Simsa가 `vercel.com/new/clone?repository-url=…` 딥링크 제공). 이후 push마다 Vercel이 배포하고, Simsa는 **유저가 붙여넣은 배포 URL**을 검수(현행 `/p/{id}/connect`) | GitHub `deployment_status` 이벤트 구독으로 URL 자동 인지(코드 없음 — 현재 `source-evidence.ts:114`는 호스트명으로 vercel 여부만 판별) | **토큰 없음** (D-6 유지) |
| **Supabase(DB)** | prep-A 그대로: 유저가 프로젝트 만들고 URL·anon·service_role·DB URL을 **브라우저에 붙여넣기**. T1 잡 시작 시 브라우저→Worker→컨테이너로 **헤더 전달**(현행 `x-anthropic-key` 패턴과 동일), **컨테이너 메모리에만 잡 수명 동안** 존재, D1·로그·스냅샷 기록 금지(테스트로 고정). 에이전트가 마이그레이션 적용·RLS 생성 | **Supabase OAuth 앱**(Management API)로 프로젝트 생성·마이그레이션·키 발급 1클릭. 토큰은 `CONCLAVE_TOKEN_KEK`로 암호화 저장 — 이 순간부터 "Simsa가 유저 인프라 자격증명을 보관"하는 첫 사례라 **별도 승인 게이트** | 파일럿: 없음 / 후속: 암호화된 Supabase OAuth 토큰 1종 |
| **GitHub** | D-15 | D-15 후속 | App 설치 토큰(일시)·OAuth `public_repo` |
| **Simsa 프리뷰** | 컨테이너 내부 기동(D-6). DB는 위 Supabase 키 주입 또는 D-12 C(DB 없는 템플릿) | — | — |
- **prep-A 불변식 정정:** "서버 무저장"은 유지(영속 저장 없음), "브라우저 주입"은 **"잡 수명 동안 메모리 전달"**로 확장한다. 위반 감지 테스트: 잡 종료 후 D1·R2·로그에 키 문자열 0건.
- 유저가 Supabase를 안 붙이면 T1은 **DB 없는 범위까지만** 만들고 영수증에 "DB 필요 기능 N개 미구현(키 미연결)"로 정직하게 표기.

### D-17 [LOCKED] 기본 경로는 S, A는 "개발자 모드" 토글 — 초보자에게 계정을 요구하는 화면은 기본 흐름에 없다
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 기본 흐름의 첫 문을 세 개로 명시: "아이디어가 있어요 / 만든 앱이 안 돼요 / 만들었는데 생각과 달라요". 기존 앱 문에서만 "코드 연결(GitHub App 설치)"을 **선택 단계**로 허용 — 건너뛰면 빌더용 고침 지시 복사 → 재검수 → user_verdict 경로. 여정 감사 P0 검사를 J1(기존 앱)에도 적용.
- 아이디어·기획서 갈래의 "만들기"는 **항상 S**. 설정 화면의 "개발자 모드"를 켠 유저에게만 A(내 GitHub·내 배포)가 보인다.
- UI 규칙: 기본 흐름 어디에도 GitHub·Vercel·Supabase 단어가 나오지 않는다. 지시서 상세(ERD·API·WBS)는 "개발자용 보기"에 접힌다. 초보자 화면은 **"무엇을 만들지 · 화면 N개 · 저장하는 것 N가지 · 이번엔 안 만드는 것"** 4줄.
- 여정 감사에 **"계정 요구 화면 0"** 검사를 추가한다(기본 흐름에서 외부 계정 CTA가 보이면 P0).

### D-18 [PILOT] "이미 만든 앱"의 S 가져오기 — 호환 판정은 결정론
- 연결된 저장소를 **결정론적 스택 감지**(PRD §6.1의 기존 감지기 확장: `wrangler.toml`/Vite/정적 HTML → 호환, Next.js·서버 프레임워크·네이티브 → 비호환)로 분류. 호환이면 "Simsa로 가져오기"(Simsa 조직에 fork → S 배포), 비호환이면 A 모드 수리 PR만 제공하고 이유를 한 줄로 표시.
- `[PILOT]` 호환 목록은 파일럿에서 실측 후 고정. 재검토 트리거: 가져오기 요청의 50% 이상이 비호환으로 거절될 때(Next.js on Workers 지원 검토).

### D-19 [LOCKED] 포지셔닝 = "독립 심사관 + 지시서 표준". T1 빌드는 초보자용 수단이지 정체성이 아니다
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 포지셔닝에 "어떤 도구로 만들었든, 안 되거나 생각과 다른 앱을 되게 만들고 그 결과를 독립적으로 확인해 준다" 추가. **북극성 = 접수 건 중 `user_verdict = as_intended`로 닫힌 건수**(컨시어지 개입 0건 완주 수 병기). 영수증은 "수리 diff"와 "재검수 증거"를 별도 섹션으로(고친 주체 ≠ 판정 주체). B 우선순위 문장 "T0·T2 품질 → S 빌드"는 "세 문 공통 엔진 → 문별 인도 경로"로.
*(2026-09-24 시장 조사 `docs/simsa-market-research-2026-09-24.md` 반영)*
- 실브라우저 검증·계정 0 호스팅은 2026년 표준(Replit Agent 3·Lovable Cloud·Base44 Testing Agent). 차별은 **형식 수용 기준(FR↔AC↔화면↔테스트)에 대조해 판정하고 영수증을 내는 것**뿐이며, 빌더는 구조적으로 자기 산출물을 심사하지 못한다.
- 따라서 **북극성 지표 = 영수증 발급 수**(빌드 수 아님). 랜딩·지원서·영수증 카피는 "만들어 주고"보다 "기획대로 됐는지 **독립적으로** 확인해 준다"를 앞세운다. T1(S 모드 빌드)은 "검수받을 대상이 없는 초보자에게 대상을 만들어 주는 수단"으로 설명한다.
- Train B 착수 요청 시 이 문장을 인용한다. B의 우선순위는 **T0·T2 품질 → S 빌드**.

### D-20 [LOCKED] 로컬 수용 기준 팩 — KR 먼저, 같은 형식으로 JP·TH·VN·ID
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 주석 — "한국 증거 전 확장 금지"는 로컬 팩 **출하**에만. region·locale 수집과 나라별 집계는 첫 건부터 전 지역(그것이 JP·SEA 순서를 정하는 증거).
- 글로벌 빌더의 현지화는 UI 번역 수준이고 **실패 지점은 로컬**이다: 결제(토스·PromptPay·GCash·PIX)·본인확인·법정 표기(통신판매업·개인정보처리방침)·문자 체계(한글 IME·태국어·일본어)·모바일 웹 비중.
- `DevSpec.nonFunctional`과 `testPlan`에 **로컬 팩**(`locale-pack: kr`)이 결정론으로 주입할 수 있는 AC 템플릿을 둔다. 팩 = 데이터 파일(코드 아님) + 감지 규칙(예: 결제 언급 → 토스 AC 추가).
- 순서: KR 팩(파일럿) → 실측으로 항목 확정 → JP → SEA(3SVS 발판). **한국 증거 전 확장 금지.**
- 투자자 문장: "영어가 모국어가 아닌 세계 80%를 위한 AI 결과물 심사 레이어."

### D-21 [LOCKED] 데이터는 "판다"가 아니라 "벤치마크 → 평가 → 라이선스" 순서. 동의·보상 먼저
> **[amend 2026-09-27 — 재정렬 `docs/simsa-vision-realignment-2026-09-27.md` §2, `design lock approved`(재정렬) Bae]** 순서 앞에 ⓪ "내부 활용: 나라·도구·유형별 실패 지도 → 수리 프롬프트·로컬 팩 개선(첫 건부터)". 동의 두 층: ⓐ **비식별 운영 메타**(ISO-3166 국가 코드만·locale·built_with·topic_tags·entry_path·finding_codes·user_verdict·resolved)는 개인정보처리방침 고지 후 운영 D1에 기록·집계 / ⓑ **내용 데이터**(의도 원문·diff·스크린샷)는 opt-in 유지. 법률 판단은 [미확인] — BM 결정 ⑥(대칭 opt-in + 비EU 보너스, #550 §9)과 정합.
- 팔리는 것은 로그가 아니라 **검증된 4중항**(지시서·빌드 증거·검수 판정·수정)이다(D-8). 랩이 못 만드는 것은 실제 비개발자 의도+실패+검증된 해결+사람 수용 판정이 한 줄로 묶인 데이터.
- 순서 고정: ① **공개 벤치마크**("한국 비개발자 기획 N건 × 빌더 5개 → AC 통과율") ② **평가 서비스**(벤더 신모델을 우리 코퍼스로 돌린 리포트) ③ **데이터 라이선스**(동의된 4중항, 익명화). ③은 규모가 된 뒤 마지막.
- 전제: 랜딩 약속("Your work stays in your browser")과 충돌하지 않게 **opt-in 유지·익명 ID·보상(크레딧)·개인정보 마스킹**을 D-8 기록 경로에 코드로 둔다. 몰래 쌓지 않는다.
- 기업가치 계단(추정, 조사 문서 §5·§7): 월 500~1,000 완주 + 벤치마크 1회 → 시드 $5~15M / 4중항 1만 건 + 평가 계약 2~3건 → 시리즈 A 서사.

### D-23 [제안 — design lock 대기] 과금 설계 잠금 — "작동한 결과에만" 두 가지 예외, 나머지는 영구 무료
> **Bae 결정 ④⑤⑥ 대기 — 이 절은 제안이며 `design lock approved`(과금) 전까지 효력 없음.**
>
> ④ 과금 예외 범위·순서 · ⑤ 청구 주체 · ⑥ 동의 정책(계획 `docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §7). 아래 `[LOCKED 후보]`·`[PILOT 후보]`는 잠금 때 발효될 등급이지 지금의 등급이 아니다. 지금의 정본은 PRD §12 "당분간 전면 무료"(2026-08-20 Bae)이고, 코드에는 결제 연동이 없다(`BILLING_ENABLED` 0건, Lemon Squeezy 레거시 503 — 계획 §5.1).
>
> **이 절이 잠기기 전에는 Train $의 `$-1`(billing 테이블) 이후를 착수하지 않는다**(계획 §5.2 D-23 행, T2-P 규율). D-7의 "과금 도입은 별도 결정"이 가리키는 그 결정이 이 절이다.
>
> 원문: 계획 §5.5(`…-2026-09-27.md:264-265`). 근거 표·수치의 출처는 같은 문서 §1~§4. Paddle 사실 확인은 `docs/billing/paddle-sandbox-2026-10.md` §1(문서 조사 [확정]) — 샌드박스 실행(§3 결과 칸)은 **실행 대기**(샌드박스 키 없음)라 상태 머신 분기(§4)는 아직 미정이다.

**① 과금 예외 범위와 순서** — 원칙 `[LOCKED 후보]` · 금액·쿼터 `[PILOT 후보]`
- 전면 무료의 예외는 **두 가지뿐**이고 순서가 정해져 있다.
  1. **S2 수리 초과 $29 — 먼저.** 월 무료 수리 쿼터(3회) 소진 뒤, **재검수 통과(`repair_jobs.resolved=1`) 시에만** 청구. 미해결·타임아웃은 $0. "되긴 하는데 달라요"(`works_but_different`)는 환불이 아니라 7일 내 1회 재작업. 발효 조건: L0 계측 + W-2 상한 + 수리 라운드트립 ≥3건 실측 + Paddle 라이브 승인. 재검토 트리거: 첫 유료 10건의 support_minutes 중앙값 > 15분 → $39, > 25분 → $49(계획 §2.4 `:99`).
  2. **S1 빌드 works-or-free — 표시 $199, 파일럿 (a) 뒤.** 발효 조건: B5(b)·B6·B7 라이브 + 파일럿 (a) 3건 spent_usd·성공률 실측 + 별도 건별 승인. 파일럿 (a) 실측값을 ⑦ 공식에 넣어 **$149 회귀 여부를 판정**한다(계획 §2.4 `:100`; "내리기는 쉽고 올리기는 어렵다"는 §0 `:11`).
- **영구 무료:** 검수 · 지시서 · 심사 · 호스팅 · 일 1회 감시 · 수리 월 쿼터(계획 §2.4 `:98`, BM §9 결정 ①).
- 이번 범위 밖: S3 Care $19(M6+) · S6 검수 API(후불 인보이스) · 수리 3회권(Paddle AUP 서면 확인 전) · **크레딧 지갑 금지**(AUP "stored value", 계획 §1.1 `:34`).

**② 성공 정의(청구 predicate)** — 식 `[LOCKED 후보]` · N일 `[PILOT 후보]`
```
charge_allowed(build) :=
      build.status == "done"  ∧  build.exit_code == 0  ∧  build.works === true
  ∧ ( count(must AC where verifiedBy == "human") == 0      -- D-9: 기계 증거로 전부 통과
      ∨ user_verdict == "as_intended" within N days )      -- human AC가 있으면 사람 확인이 있어야
  ∧   receipt.issued == true                               -- 영수증(C-3) 발행 뒤에만
```
- **D-9 정합:** must AC 하나라도 `verifiedBy: human`이면 User Acceptance Required — 사람 확인 없이 청구하지 않는다.
- **고객 무응답은 청구 근거가 아니다.** N일 안에 `as_intended`가 오지 않으면 cancel, 청구 $0. `user_verdict` 4값(`as_intended`·`works_but_different`·`still_broken`·`unsure` — `apps/central-plane/src/workspace/visual-check-db.ts:21`) 중 청구는 `as_intended`만.
- **무조건 $0:** 빌드 실패 · exit ≠ 0 · works ≠ true · 45분 초과 · 예산 상한(D-7) 도달 · 킬스위치 · 빌더 외부 장애.
- **1회 청구 = 최대 3회 시도.** 해석 `[확인 필요]`: 계획 §2.4(`:100`) 문맥은 "같은 기획의 **빌드 시도** 3회까지 청구는 1회"인데, `docs/billing/paddle-sandbox-2026-10.md` §5는 같은 문구를 **결제 재시도**(`on_payment_failure`)로 읽는다. 두 문서가 갈린다. 권고: 유저에게 한 약속인 **빌드 시도**로 잠그고, 결제 재시도 정책은 샌드박스 S-A 결과로 따로 정한다.
- 멱등 키 = `build_id`(`billing_charges`, `$-1`). S2의 성공 = `repair_jobs.resolved=1`.

**③ 청구 주체** — `[PILOT 후보]`, Bae 결정 ⑤ 대기
- **오마이워크**(현행 약관·환불정책·방침 명의)로 Paddle을 개통한다. 3SVS 법인은 청구 주체로 쓰지 않는다(계획 §3 `:151`).
- 전제: 사업자등록증으로 형태 1문장 확인(번호 규칙상 개인사업자 [확정 번호 규칙] — "대표이사" 표기와 불일치, 계획 §3 `:160`) · **3SVS → Simsa 사업 주체 IP 양도 서면** 착수(어느 안이든 필요).
- **전환 트리거**(하나라도 충족 시 신설 한국 법인 또는 미국 C-Corp 설립 착수): works-or-free 누적 ≥ 10건 · 월 Supplier Fee ≥ $100 3개월 연속 · 첫 채용 · 투자 논의 개시 · YC 합격(계획 §3 `:162`).

**④ 동의 3분리** — `[LOCKED 후보]`, Bae 결정 ⑥과 함께
1. **결제수단 저장** = Paddle 체크아웃 UI.
2. **조건부 청구 동의** = Simsa 결제 화면의 **별도 체크박스**. 첫 줄 "실패하면 $0" · 성공 정의(②) 링크 · 1회 청구 = 최대 3회 시도 · 무응답은 청구 근거 아님 · 철회권. Paddle 화면은 "성공 시 $199" 조건을 표시하지 않으므로 이것이 유일한 고지다.
3. **데이터·학습 동의** = 별도(D-21 ⓑ). **결제 동의를 데이터 동의의 조건으로 삼지 않는다**(계획 §4 `:179`).

**⑤ 금지** — `[LOCKED 후보]`
- **Care 자동 부착 금지.** 빌드 성공 화면의 opt-in 1클릭만. 트라이얼 만료 뒤 Care로 넘어가지 않게 `scheduled_change` cancel을 예약하고, 상품명은 "Care 트라이얼"로 보이지 않게 별도 상품("빌드 보증")으로 둔다(계획 §1.1 `:34`).
- **선결제 + 자동 환불 금지.** 실패율(D3 80%)이 곧 환불률이 되고, Paddle은 환불해도 수수료를 돌려주지 않으며(MSA §10.4) 판매자가 직접 환불할 수 없다(계획 §0 `:10`, §1.1 `:26-28`).

**⑥ D-17 예외 — 결제 화면 직전 Simsa 로그인 1회** — `[LOCKED 후보]`
- 기본 흐름에 계정 요구 화면을 두지 않는다는 D-17의 **유일한 예외**: 유료 경로에서 결제 화면 직전 **Simsa 로그인 1회**(Google·이메일 — N2 순서). **GitHub은 예외가 아니다.**
- 무료 경로는 계정 승격 없음(익명 `userKey` 유지, 계획 §5.6). 유료 경로의 계정 승격은 claim 1클릭(`$-1`).
- 예외 자체의 근거: 계획 §5.2 B-8 행(`:219`). 제안: journey-audit "계정 요구 화면 0" 검사(N6)에 두는 예외도 이 1곳뿐으로 한다.

**⑦ 가격 공식(D-22)** — 식·상수 `[LOCKED 후보]` · 입력값 `[PILOT 후보]`
- 번호 주: 계획 문서가 "D-22 공식"이라 먼저 불렀지만 이 설계 문서에는 **D-22 절이 없다**. 여기 식을 싣고, 잠금 때 D-22로 떼어낼지 D-23에 둘지 함께 정한다.
- 건당 기여(계획 §2.3 `:76`): `기여 = P − (0.05P + $0.50) − f·P − r·(P + $20) − S − C`
  (P 가격 · f 환불률 · r 차지백률 · S 건당 지원 원가 · C = 시도 원가 ÷ 성공률, D-7 상한 C_cap 기준)
- 기여 ≥ 0.60P(총마진 60%)를 P에 대해 풀면:
  `P60 = ($0.50 + $20·r + S + C) / (1 − 0.05 − f − r − 0.60) = ($0.50 + $20·r + S + C) / (0.35 − f − r)`
- **상수 유도:** 0.05·$0.50 = Paddle 거래 수수료 5% + $0.50(구독·일회성·국제카드 구분 없음 — 계획 §1.1 `:23`, MSA §3.2) · $20 = 차지백 건당 수수료(승소해도 미반환 — `:27`) · 0.60 = 목표 총마진(계획 §2.1 P60) · 환불은 가격 전액 손실(f·P)이고 수수료는 돌려받지 못하므로 수수료 항은 f와 독립(`:26`).
- 검산(입력은 계획 §2.3 `:77` 가정 세트. 성공률·시도 원가는 **[측정 불가]** — 빌드 실행체 0건이라 결과는 [추정]):

  | 경우 | f | r | S | C | P60 |
  |---|---|---|---|---|---|
  | S1 빌드 · D3 | 10% | 1.5% | $12.5 | $50 | **$269** |
  | S1 빌드 · D2 | 5% | 0.7% | $8 | $22.2 | **$105** |
  | S2 수리 · D3 | 10% | 1.5% | $12.5 | $1.25 | **$62** |
  | S2 수리 · D2 | 5% | 0.7% | $8 | $0.91 | **$33** |
  | S2 수리 · 셀프서브 목표 | 5% | 0.7% | $3 | $0.91 | **$15.5** |

  (계획 §2.3 표 `:79-88`의 P60 값과 일치.)
- **판정 규칙:** P-6 회고에서 파일럿 (a) 실측 C·S를 넣는다. 실측 C ≤ $22 · 지원 ≤ $8이면 표시가를 **$149로 내린다**(계획 §2.4 `:100`). 가격 신호의 다른 규칙(빌드 0/6 → S1 보류 등)은 계획 §2.7에 사전 등록된 5개를 따른다 — 이 절은 새 규칙을 만들지 않는다.

**PRD §12에 넣을 예외 문단 초안** (잠금 PR에서 PRD를 함께 고친다 — §4의 관례)

> **[D-7·D-23 예외 — `design lock approved`(과금) 뒤 발효]** 2026-08-20 "당분간 전면 무료" 결정은 유지한다. 예외는 D-23이 정한 두 가지뿐이다. ① 월 무료 수리 쿼터(3회 `[PILOT]`)를 넘긴 수리가 **재검수를 통과했을 때만** $29 `[PILOT]`. ② Simsa가 만든 앱이 D-23 ② 성공 정의를 **모두** 충족했을 때만 빌드 $199 `[PILOT]`(파일럿 (a) 뒤 D-22 공식으로 $149 회귀 판정). 실패·시간 초과·예산 상한(D-7)·킬스위치·무응답이면 $0이고, 선결제 후 환불하는 방식은 쓰지 않는다. 검수·지시서·심사·호스팅·일 1회 감시는 영구 무료다. 결제는 Paddle(MoR)이 처리하며, 결제 직전 Simsa 로그인 1회가 필요하다(D-17 예외, GitHub 아님). 결제 동의는 데이터·학습 동의와 분리되고 서로의 조건이 되지 않는다. 기존 GitHub Marketplace SKU·Lemon Squeezy의 dormant 상태(이 절 위 문단)는 이 예외가 바꾸지 않는다.

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

### Train N — 초보자 기준 전수 수정 (§8 결과 집행 · A와 병렬, 카피/노출 변경은 즉시 가능)
| # | 스테이지 | 완료 조건 |
|---|---|---|
| N1 | 인터뷰 인프라 5문항 제거(§8-1)·도구 픽커를 "기존 앱" 갈래로 이동+기본 "모르겠어요"(§8-3)·예시 문장 교체(§8-11) | 아이디어·기획서 갈래 스크린샷에 GitHub/Vercel/Supabase/도구명 0 |
| N2 | 로그인 순서: Google·이메일 우선, GitHub은 "개발자용"으로(§8-4). Google 비활성 원인 확인 | 로그인 첫 화면에 GitHub 버튼이 1순위가 아님 |
| N3 | 사이드바·설정 재편: 기본 = 개요/만들 것/내 앱/확인 결과/설정. "코드 변경"·"빌더 팩"·Telegram·GitHub 연결·별 주기는 개발자 모드(§8-6·§8-10) | 기본 모드 사이드바 개발 용어 0 |
| N4 | 검수 화면·리포트 용어: "클라우드 실행"→삭제, "증거 파일 N개"→"스크린샷 N장", 파일명 캡션→단계 이름, 미준비 기능은 숨김(§8-7·§8-8) | 스크린샷 대조 |
| N5 | "이미 만든 앱" 입력 오류 문구·안내(§8-5), "만들다가 막혔나요?"→"앱에서 이상한 점이 있나요?"(§8-15) | KO/EN 동시 |
| N6 | journey-audit에 **"계정 요구 화면 0 · 개발 용어 사전 매칭 0"** 검사 추가(용어 사전: GitHub·repo·PR·diff·Vercel·Netlify·Supabase·Firebase·Cursor·Codex·클라우드·증거 파일·워크스페이스) | 옛 코드에서 P0가 뜨고 N1~N5 후 0 |
| N7 | 랜딩 카피 재작성(§8-9) — S 확정 정체성 "만들어 주고, 되는지 확인해 준다", 문 3개 | Bae 검토 1회 |

### Train B — T1 빌드 + S 호스팅 (A1·A2 후 착수, B1·B2는 A와 병렬 가능)
| # | 스테이지 | 완료 조건 |
|---|---|---|
| B1 | `SimsaBuilder` 컨테이너 클래스·이미지(egress·pnpm·wrangler·playwright)·health | `containers instances`로 기동 확인, 30초 내 `pnpm -v` |
| B2 | **호스팅 기반**: Workers for Platforms dispatch namespace + 와일드카드 도메인 + 프로젝트당 D1 생성 API + 운영 토큰(Actions secret) | 빈 템플릿이 `<slug>.<host>`에서 200 + D1 read/write |
| B3 | 템플릿 저장소(Hono + React/Vite + D1) + Simsa 조직 private 저장소 자동 생성 + 스캐폴드 커밋 | 스캐폴드만으로 `pnpm build` green·배포 green |
| B4 | agent-worker 확장: `create_file`·`run_command` allowlist·**유저 배포 명령 차단 테스트(D-6)**·비밀 차단 유지 | 차단 테스트가 옛 코드에서 실패함을 확인 |
| B5 | 빌드·테스트 게이트 + `build: unverified` 트레일러 + 잡 상태 머신·D1 `build_jobs` + **S 배포 단계** | 고의로 깨진 코드가 `failed(building)`으로 끝나고 배포되지 않음 |
| B6 | 예산 계좌(D-7): 벤더 usage 합산·상한 정지·수리 워커 이관·일일 빌드 상한 | 상한 $0.5로 돌리면 WBS 중간에 정지 |
| B7 | **호스팅 사업자 의무(D-6)**: 프로젝트 킬스위치·신고 링크·요청 상한·금지 콘텐츠 규칙·정지 로그 | 관리자 1클릭 정지 → 주소 즉시 410 |
| B8 | 대시보드: "만들기" 버튼(S 기본)·잡 진행 화면·내 앱 주소 카드·zip 다운로드·개발자 모드 토글(D-17) EN/KO | journey-audit 신규 여정 J6 + "계정 요구 화면 0" 검사, P0=P1=0 |
| B9 | **"내 GitHub로 가져가기"**(저장소 이전 + D1 SQL 덤프 동봉) + T0 지시서에 이전 안내 | 테스트 계정으로 이전 라운드트립 |
| B10 | 파일럿 **[amend 2026-09-27]**: Bae 아이디어 20개 중 6건 — (a) 3건 T0→T1→S 배포 완주 + (b)(c) 3건은 같은 아이디어를 Lovable/v0/Bolt로 만들어 안 되는/다른 앱을 준비한 뒤 검수→수리→재검수→user_verdict 완주. 정답지 선기록 유지. (원문: 실기획 3건 T0→T1→S) | 6건의 user_verdict 분포·6축 채움률·기계 판정 vs 사람 라벨 일치율·문별 소요 시간·비용 |
| B11 | "이미 만든 앱" 갈래: 수리 워커에 D-4 빌드 검증 적용 + D-18 호환 판정·가져오기 | 비호환 저장소가 이유와 함께 A 모드로 안내됨 |

### Train C — T2 인도 · 기존 앱 문 (b)(c) 인도 경로 **[amend 2026-09-27 — reopen, 기존 앱 문에 한해 B5 의존 해제]**
| # | 스테이지 | 완료 조건 |
|---|---|---|
| C0 | 공통 엔진 정합 (재정렬 W1 항목 1·6): 재검수가 원 intent·acceptancePlan 유지 + `source_check_id`; 의도 확정 카드 confirm → D1 미러(`mirrorLocalProjectToDb`) → 확정 oneLine이 검수 intent 기본값 | 옛 코드 실패 테스트 + 라이브 재검수 intent 동일(D1) + 한글 의도 3건 |
| C2b | **주소만 앱** 경로 (W1 항목 7·8): 빌더용 고침 지시(`web_builder`, 채팅창 1덩어리, built_with가 lovable/bolt/v0/replit이면 기본) + `POST …/visual-checks/:runId/verdict`(user_verdict 4값) + 리포트 하단 1탭 | KO/EN 스냅샷 + 라이브 리포트 기본 노출 + **실제 Lovable 프로젝트 1건 붙여넣기→Publish→재검수 왕복 실측** + verdict D1 저장·재열람 유지 |
| C2a | **코드 연결 앱** 경로: 수리 진입 완화(공개 저장소 OAuth 없음 → App 설치 토큰 폴백, D-15 범위 내) + verify-sweep에 acceptancePlan 전달 + `repair_jobs.resolved` 기록 + 주소만 유저에게 "고치기" 대신 C2b 안내(D-17) | 라이브 수리 잡 1건 + 자동 재검수 resolved ≥1 + 옛 코드 실패 테스트 |
| C1 | 컨테이너 프리뷰 서빙(Worker 경유 임시 URL) — **기존 앱 문에 불필요, 문 (a) T1과 함께 B5 뒤로** | 외부에서 200 + 내용 확인 |
| C3 | 영수증(receipt): must AC 표·미검증·"프로덕션 아님"·**수리 diff 섹션 ≠ 재검수 증거 섹션**(D-19 amend)·다음 행동 EN/KO | `assertNoNumericScores` 통과 |
| C4 | 4중항 코퍼스 기록(D-8 amend: 봉투+라벨) + 관리자 집계 `GET /admin/moat-stats` JSON | 파일럿 6건이 training-store·검수 행에 적재, 6축 채움률 |

원문(2026-09-24): C1 프리뷰 → C2 AC 검수→수리→재검수 루프 → C3 영수증 → C4 코퍼스. 재정렬로 C2를 C2a/C2b로 갈라 B5 의존을 풀고 C0을 앞세웠다.

### Train Y — YC / a16z 제출물 — **보류** (Bae 2026-09-24 "지원서는 일단 생각하지 말고 개발부터")
> 개발 트레인 A·B·C가 우선. Y는 B8(파일럿) 뒤에 재개하며, 그전까지 어떤 스테이지도 열지 않는다. 아래는 기록용.

| # | 스테이지 | 완료 조건 |
|---|---|---|
| Y1 | 데모 대본(기획 붙여넣기 → 지시서 → 빌드 → 프리뷰 검수 → 영수증) 2분 | 실제 라이브로 끊김 없이 1회 녹화 |
| Y2 | YC 26문항 초안(EN) — bae-pitch-writer/idea-critic 스킬, 팩트만 | Bae 검토 1회 |
| Y3 | speedrun 덱 10~12장 | Bae 검토 1회 |
| Y4 | 창업자 풀타임·법인·SF 상주 답변 | **Bae 결정** |

### 일정 (추정, 단독 에이전트 기준)
- Train A: ~1주 → 10/1 · Train B: ~3주(호스팅 기반 추가) → 10/22 · Train C: ~1.5주 → 11/2 · Y는 보류
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

1. **`design lock approved`** — D-1~D-9·D-11·D-12·D-15~D-17 LOCKED 발효(S 기본·A 개발자 모드 반영본). 구현 착수 아님.
2. **호스팅 도메인**: `*.simsa.app`(구매 필요 여부 확인) 또는 `*.trysimsa.com` 하위. 파일럿은 `*.trysimsa.com`으로 시작 가능 — 이견 없으시면 그렇게 갑니다.
3. **Cloudflare Email Routing 연결**(Bae 액션 3, 이월) — 로그인 뒤 검수의 스위치. 대시보드 → 도메인 `trysimsa.com` → Email → Email Routing → Catch-all → Action "Send to a Worker" → `conclave-ai` 선택 → 저장. 권장 서브도메인 `probe.trysimsa.com`(Resend 발송과 분리). 연결되면 검수 화면의 "확인 메일을 받을 준비가 되어 있지 않습니다" 문구가 사라지는지로 확인.

~~지원서용 답(풀타임·법인·SF 상주)~~ — Train Y 보류로 이번엔 묻지 않음.

---

## 6. 게이트 레지스트리

| 게이트 | 문구 | 발효 일시 | 범위 |
|---|---|---|---|
| 설계 잠금 | `design lock approved` | 2026-09-24 (Bae) | D-1~D-9·D-11·D-12·D-15~D-17 LOCKED |
| Train A 착수 | `train A start approved` | 2026-09-24 (Bae) | A1~A6 코드 작성만 |
| Train N 착수 | `train N start approved` | 2026-09-24 (Bae) | N1~N7 코드 작성만 |
| 설계 잠금 2차 | `design lock approved` | 2026-09-24 오전 (Bae) | D-19·D-20·D-21 LOCKED 발효 (어제 오후 논의분 — 이 행 전까지는 문서 표기만 LOCKED였음) |
| A1~A5 코드 완료 | — | 2026-09-24 | PR #521(central-plane A1~A5) · #524(dashboard A4+A5) → 2026-09-24 밤 머지·0067·배포 완료 |
| 머지 (집행) | `PR #527 merge approved.` `PR #528 merge approved.` | 2026-09-24 오전 (Bae) | #527 `a6f7445` · #528 `12f09a4` (앞서 #520~#526은 밤에 같은 문구로) |
| 배포 (집행) | `deploy central-plane approved.` `deploy dashboard approved.` | 2026-09-24 오전 (Bae) | central run 35948123514 success(deployedSha 12f09a4) · dashboard `24v0yx3ud` Ready |
| 머지·배포 (집행) | `PR #530 merge approved.` `deploy central-plane approved.` | 2026-09-24 오전 (Bae) | #530 `f09e99c` · central run 35951724360 success · 기획 3 en 422→200 실측 |
| N1~N3·N2 PR | — | 2026-09-24 | #522 · #523 (Train N 에이전트) |
| Train B 착수 | `train B start approved` | 2026-09-24 오후 (Bae) | B1~B11 코드 작성만. B1 = PR(SimsaBuilder 컨테이너·BUILDER 바인딩·자가점검 프로브) |
| 설계 잠금 3차 (재정렬) | `design lock approved`(재정렬) | 2026-09-27 (Bae) | D-1·D-2·D-7·D-8·D-13·D-17·D-19·D-20·D-21 amend 발효(문안 `docs/simsa-vision-realignment-2026-09-27.md` §2, PR #549) · Train C reopen(C0·C2a·C2b) · B10 정의 교체. D-4·D-15 keep |
| Train C 착수 | `train C start approved` | 2026-09-27 (Bae) | C0·C2a·C2b·C3·C4 코드 작성만(머지·배포·마이그레이션 적용 아님). C1은 B5 뒤 |
| C0·C2a·C2b·C4a 코드 완료 | — | 2026-09-27 | PR #553(central-plane, 0069 포함) · #552(dashboard). 3렌즈 검증에서 P0 1건(App 토큰 폴백 cross-tenant) 머지 전 수정. 머지·0068/0069 적용·배포는 대기 |
| 머지·마이그레이션·배포 (집행) | `PR #548 merge approved.` `PR #553 merge approved.` `migration 0068 apply approved.` `migration 0069 apply approved.` `deploy central-plane approved.` `PR #552 merge approved.` `deploy dashboard approved.` | 2026-09-27 새벽 (Bae) | #548 `e82f12e` · #553 `74b7e2f` · run 36284522877(0068·0069 ✅, 게이트 ok, Version 31864bcf) · #552 `1102c10` · dashboard `5lz22z9s6` Ready. 라이브: 새 라우트 400·청크에 새 카피 확인 |
| Train W·L·$ 착수 | `train W start approved` `train L start approved` `train $ start approved` | 2026-09-28 (Bae) | W(상한·킬스위치·정직성·방침 고지)·L(L0 계측)·$-0(Paddle 샌드박스 도구) 코드 작성만. 계획 정본 `docs/simsa-pricing-entity-consent-plan-2026-09-27.md` §5 |
| 머지·배포 (집행) | `PR #556 merge approved.` `deploy central-plane approved.` | 2026-09-28 (Bae) | #556 `f8ad95e`(설치 리다이렉트·호스팅 전용 App 분리) · run 36380871543 Version 4f234bda. 호스팅 App 시크릿 Worker 반영(run 36381296460) |
| 머지 (집행) | `PR #554/#557/#560/#558 merge approved.` `PR #561 merge approved.` `PR #563 merge approved.` `PR #562 merge approved.` `PR #559 merge approved.` | 2026-09-29 (Bae) | #554 `a62ecb1` · #557 `0bd1f2f` · #560 `c8e1296` · #558 `4f56aff` · #561 `a47e72a` · #563 `aabb962`(#561 반영 뒤 재CI) · #562 `4b3fe4f`(충돌 해소 뒤 재CI) · #559 `6e54f4e`(충돌 해소 뒤 재CI). 근거 `docs/HANDOFF-2026-09-29.md` §1 *(W-D 2026-09-30 추가 — 이 행 전까지 레지스트리 누락)* |
| 마이그레이션·배포 (집행) | `migration 0070 apply approved.` `deploy central-plane approved.` `deploy dashboard approved.` | 2026-09-29 (Bae) | run 36503316428(0070 ✅, 게이트 `{"ok":true,"pending":[]}`, Version 96f3c523, healthz deployedSha 4b3fe4f) · dashboard `9i3cucrin` Ready·Production. 세 칸 결과 `docs/HANDOFF-2026-09-29.md` §2 *(W-D 추가)* |
| 머지·배포 (집행) | `PR #566 merge approved.` → `deploy central-plane approved.` → `deploy dashboard approved.` (출처: 커밋 `3a1ca07` 메시지 "Bae 승인 체인(2026-09-30)"). **#564·#565·#567 머지 승인 문구 원문은 레포 미기록**(세 커밋 메시지·PR 스레드에서 "approved" grep 0건) — 다음 HANDOFF에 원문 기입 필요 | 2026-09-30 (Bae) | #567 `b725b58` · #564 `2956eb7` · #565 `9f02919` · #566 `3a1ca07`(13:07~13:23 UTC) · central run 36721292314 success(headSha 3a1ca07, 적용할 마이그레이션 없음, Version 7f14fb1d, smoke 401) · dashboard `5jg3lrr6o` Ready·Production(`vercel ls`, 2026-09-30). 라이브확인: 방침 페이지 본문에 시행일 2026-09-30·"요청 횟수 제한". 미측정: #564 결과 화면 재확인(HANDOFF-2026-09-29 §5-1) · 첫 `rate-limit-purge` 틱 *(W-D 추가)* |
| 머지 | `PR #N merge approved.` | — | 해당 PR |
| 배포 | `deploy central-plane approved.` / `deploy dashboard approved.` / `deploy hosting-dispatch approved.` | — | 해당 타겟 1회 (hosting-dispatch는 B-7 `deploy-hosting-dispatch.yml` 신설 뒤 — 계획 §5.2) |
| 마이그레이션 | `migration <id> apply approved.` | — | 1건 |
| 파일럿 | `pilot start approved.` | — | ~~B8 실기획 3건~~ → **B10**(amend 2026-09-27): 범위 (b)(c) 3건과 (a) 3건을 **따로** 발효(계획 §5.2 P-4·P-5, §5.3). 문구에 범위를 붙인다 — 예 `pilot start approved.` (b)(c). **단 D-6 amend(D-6 주석 ①)가 발효되기 전까지는 (b)(c)도 호스팅 의무(B7)가 선행한다**(D-6 본문 "없으면 `pilot start approved` 불가"에 범위 한정 없음) *[정정 2026-09-30 W-D]* |
| 설계 잠금 (D-6 amend) | `design lock approved`(D-6 amend) | — | D-6 주석 ① 발효 — 호스팅 의무 선행을 파일럿 (a)로 한정. 이것 없이는 (b)(c)에도 B7 선행 *(W-D 추가 — 제안)* |
| Train K 착수 | `train K start approved` | — | K-1~K-3 코드 작성만(마이그레이션 0071 적용은 별도 문구) *(W-D 추가 — 계획 §5.2)* |
| 설계 잠금 (과금) | `design lock approved`(과금) | — | D-23 발효. 이것 없이 `$-1` 이후 착수 금지 *(W-D 추가)* |
| 과금 라이브 | 표준 문구 없음 — 건별 명시 승인(`BILLING_ENABLED` on 배포 · S2 외부 개시 · Paddle 라이브 가입·서면 질의) | — | 건별 *(W-D 추가 — 계획 §5.2 $-7)* |

---

## 7. 이번 세션 실측 기록 (증거)
- 인프라: simsa.dev 200 · app.trysimsa.com 307→/projects · Worker /health 200 · 카나리 3주 연속 green · 열린 PR 0 · 마지막 central 배포 2026-09-01(main `c4158eb`)
- journey-audit KO: P0=0 P1=0 P2=10 (`tools/simsa-completion-loop-spike/journey-audit-result.json`)
- 익명 스모크(`anonymous-smoke.mjs`): 장비 노후 2건(첫 화면 `textarea` 2개 매칭 · 답한 질문의 '추천대로' 버튼이 사라져 인덱스 클릭 실패) → **같은 세션에서 수리, 프로덕션 재주행 8/8 PASS**(실 LLM 경유 생성 `proj_bb4rp470`·사이드바·GitHub 탭 숨김·삭제 QA ⓐⓑ)
- 로그인 뒤 검수: UI에 "확인 메일을 받을 준비가 되어 있지 않습니다" (Bae 액션 3 Email Routing 미연결)
- repo secret `LLM_PROBE_TOKEN` 2026-08-21 존재(워커 값 일치 여부 미확인)

---

## 8. 초보자 기준 전수 점검 (2026-09-24 프로덕션 스크린샷·코드에서 셈)

기준: **유저가 만들 계정 수 · 클릭 수 · 개발 용어 노출 수**. 아래 번호는 Train N 스테이지가 인용한다.
기본 흐름(아이디어·기획서 갈래)에서 초보자가 만나는 외부 계정·개발 용어 노출은 **약 19곳** [스크린샷에서 셈].

### P0 — 초보자가 여기서 멈춘다
1. **아이디어 인터뷰의 인프라 5문항.** "GitHub 써보셨어요?" · "AI 코딩 도구(예: Cursor)?" · "앱이 인터넷 어디에 올라가 있나요? Vercel/Netlify" · "데이터는 어디에? Supabase/Firebase". 아이디어만 있는 사람에게 인프라를 묻는다. S에서는 전부 불필요 → **삭제**(개발자 모드만 유지).
2. **개요의 "지금 할 일"이 유저 노동을 요구.** "빌더 팩을 받아 쓰시는 도구(Lovable·v0·Claude Code)로 앱을 만들고 URL을 연결" — 도구가 없는 초보자는 막다른 길. → **"만들기" 버튼(S)**. 3단계 지도 "준비 → 만들기·검수 → 결과"의 2단계가 "만드는 중(Simsa)"으로 바뀐다.
3. **기획서 변환 결과 상단의 도구 픽커.** "이 앱을 어떤 도구로 만들었나요? v0/Lovable/Bolt/Cursor/Claude Code/Replit/Windsurf/Codex/직접 코딩" — 아직 안 만든 사람에게 묻는다. → 기존 앱 갈래에서만, 기본값 "모르겠어요".
4. **로그인이 GitHub 우선.** 코드 주석 "GitHub-first (the vibe-coder audience has GitHub)" — 대상 정의와 모순. Google은 `googleUnavailable` 플래그가 있어 꺼질 수 있음. → Google·이메일 우선, GitHub은 "개발자용".
5. **"이미 만든 앱" 입력 오류 문구.** "my-app.vercel.app 이나 owner/repo 형태로 넣어 주세요" — `owner/repo`는 개발자 언어. → "앱 주소(https://…)를 붙여넣어 주세요. 주소를 모르면 만든 도구의 '공유/Publish' 버튼에서 복사하세요."

### P1 — 용어와 선택지가 개발자 것
6. **사이드바:** "코드 변경" · "빌더 팩" · "GitHub에서 별 주기" · "워크스페이스" · "고급 +" · "연결". → 기본 모드: 개요 / 만들 것(설명서·확인 항목) / 내 앱(주소·진행) / 확인 결과 / 설정. 나머지는 개발자 모드.
7. **검수 화면의 내부 상태 노출:** "클라우드 실행" · "증거 파일 4개" · "로그인 뒤 화면까지 확인할까요? 아직 사용할 수 없어요 — 확인 메일을 받을 준비가 되어 있지 않습니다"(운영 상태를 유저에게). → 미준비 기능은 숨김, "스크린샷 N장".
8. **리포트:** 제목·무엇/왜/어떻게·개발자용 접기는 좋다. 그러나 스크린샷 캡션이 `step-00-initial.png` 파일명, "대상"·"클라우드 실행" 라벨. → "처음 화면 / 버튼 누른 뒤", "확인한 주소".
9. **랜딩:** "Code home (GitHub)" · "Code change (PR)" · "checking items" · 문 6개. 정체성 카피가 "검수 레이어"인데 S 확정 후 정체성은 "만들어 주고, 되는지 확인해 준다". → 문 3개, PR/GitHub 단어 제거(개발자 섹션 하단에만).
10. **설정:** Telegram 알림 · GitHub 연결 · 학습 동의가 같은 무게. → 기본 = 이메일 알림 + 학습 동의만. Telegram·GitHub는 개발자 모드.
11. **인터뷰 예시 문장** "회의 녹음을 요약해서 할 일을 Linear로 보내는 앱" — Linear는 개발팀 도구. → 오늘 감사가 쓴 입력("동네 빵집 픽업 예약", "댕댕 산책 기록") 같은 생활 예시로.
12. **언어 기본값** EN 기본 + KO 토글(PRD §2). 한국 초보자 첫 화면이 영어면 이탈. #433이 첫 방문 locale을 고쳤다고 기록돼 있으나 **이번 세션 미측정** → N6 감사에 "첫 방문 브라우저 locale = 화면 언어" 검사 추가.
13. **"만들다가 막혔나요?" 카드** — S에서는 만드는 것이 우리 몫. → "앱에서 이상한 점이 있나요?"(수리 요청 입구로 재정의).

### P2 — 다듬기
14. 사이드바 예시 프로젝트 "회의록 자동 요약 앱"(예시 배지) — 유지 가능하나 예시도 §8-11 기준으로.
15. 개요의 "결과 통계" 카드가 첫 방문에 비어 있음 — "아직 만들기 전이에요" 한 줄.

### 유지할 것 (초보자 기준에 이미 맞음)
- 첫 화면 문 3개 + 한 줄 설명 · "추천대로" 버튼 · 리포트의 무엇/왜/어떻게 3줄과 개발자용 접기 · 한국어 오류 번역 · 삭제 모달 ack 게이트 · "다음 →" 안내 바(레이아웃 단일 마운트).

---

## 9. 진행 로그

### 2026-09-30 — W-D 문서 정리 (Train W 범위, `train W start approved` 2026-09-28)
- `docs/EVIDENCE-RULE.md` 정본 복원·확장(R1~R11). 원본 `91c4d33`(2026-08-25)은 PR 없이 브랜치 `docs/evidence-rule`에만 있었다.
- D-6 주석 2건(① 호스팅 의무 선행을 파일럿 (a)로 한정하는 amend **[제안 — design lock 대기, 발효 전에는 (b)(c)에도 B7 선행]** · ② 도메인 파라미터 `simsa.page` 기록) · D-7 주석(T2 $5 → 일일 횟수 상한, 2026-09-28~30 집행표 — verify-sweep 자동 재검수는 일일 상한 밖·스윕당 10건 별도 상한) · 게이트 레지스트리 09-29·09-30 집행 행과 새 트레인 게이트 행 · 파일럿 행 B8 → B10 정정.
- **D-23 [제안]** 과금 설계 잠금 초안 신설 — Bae 결정 ④⑤⑥ + `design lock approved`(과금) 대기. 효력 없음.

### 2026-09-27 — 재정렬 design lock + Train C 착수
- `design lock approved`(재정렬)·`train C start approved`(Bae). 근거 문서 #549(재정렬)·#550(BM). 열린 코드 PR #548(B5a)·#551(OpenAI 블록).
- 착수 순서: C0(재검수 intent 유지·의도 확정→D1) → C2b(web_builder 고침 지시·user_verdict) → C2a(수리 진입 완화·verify-sweep AC·resolved). 0069(봉투 컬럼)는 #548 머지 뒤 번호 확정, `migration 0069 apply approved.` 별도.

### 2026-09-24 오후 — Train B 착수 (B1)
- `train B start approved`(Bae). **B1 코드**: `builder-container/`(Dockerfile playwright 베이스 + pnpm·git·gh·wrangler, server.mjs `/health`·`/selfcheck`·`POST /run`, builder-run.mjs 자가점검·상태 머신 상수·미구현 kind 정직 실패) · `src/builder-container.ts`(SimsaBuilder, sleepAfter 50m) · wrangler `[[containers]]` standard/max 5 + `BUILDER` + `v3-builder` · `GET /internal/builder/selfcheck`(관측 토큰) · 불변식 9 + 단위 13 테스트. `container-images.yml`(PR에서 이미지 빌드 + 빌더 /selfcheck 스모크 — 노트북 Docker 없음). **라이브 0** — 배포 승인 후 `/internal/builder/selfcheck`로 "30초 내 pnpm -v" 실측.
- 같은 날: Google 로그인 프로덕션 라이브(시작 200), Email Routing은 Bae 선택 대기(대시보드 3클릭 / 토큰 권한).

### 2026-09-24 (설계 잠금 당일)
- **Train A 코드 완료 (A1~A5)** — PR #521 central-plane: `dev-spec.ts`(Zod+무결성 13규칙) · `generate-dev-spec.ts`(3패스, 예시 폴백 없음) · `render-dev-spec.ts`(md 10종, EN/KO 동일) · `acceptance-plan.ts` + inspector 시나리오 실행(RUNNER_REV a5-acceptance-1) · `migrations/0067`. PR #524 dashboard: 개발 지시서 화면(초보자 4줄+개발자용) · 사이드바 · 다음 걸음 · 검수 상세 AC 섹션. 테스트: central 2263/2263 · dashboard 710/710. **라이브 0건 — A6는 머지·배포·0067 적용 뒤.**
- **Train N 코드 완료** — #522(N1+N3) · #523(N2) · #525(N4+N5+N7 초안) · #526(N6 감사 장비). **프로덕션 기준선 P0=16**(초보자 기준 위반, 수정 전) 실측. 라이브 발견: **Google 로그인 프로덕션 미설정**(PROVIDER_NOT_FOUND) → Bae 액션(OAuth 클라이언트 + set-worker-secrets).
- **시장 조사** — `docs/simsa-market-research-2026-09-24.md`. 결론: 차별은 형식 AC 판정+영수증뿐 → D-19.
- **대기 문구(순서):** `PR #520 merge approved.` → `PR #521 merge approved.` → `migration 0067 apply approved.` → `deploy central-plane approved.` → `PR #524 merge approved.` → `deploy dashboard approved.` → A6 라이브 실측(한글 리얼 기획 3건 + journey-audit).
