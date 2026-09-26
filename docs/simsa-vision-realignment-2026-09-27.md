# Simsa 비전 재정렬 — 2026-09-27

**출처**: Bae 비전 원문(2026-09-26) + 병렬 분석(조사 5영역 → 로드맵 3관점 → 심사 3 → 합성 → 반박 검증 8주장 × 3 → 완결성 비평, 에이전트 37개). 모든 코드 사실은 `파일:줄`로 대조했고, 반박 검증에서 뒤집힌 것은 정정해 실었다.
**표기**: [확정] 파일·라이브 근거 / [추정] 근거 있는 추정 / [미확인].

## 0. 비전 (Bae 원문 요약)

비개발자가 AI로 만든 결과물이 **안 되거나 생각과 다를 때** Simsa를 써서 **작동하게 / 생각대로** 만들어 준다. 그 과정에서 **나라 × 도구 × 만들려는 서비스 × 활용 방식 × 문제 지점 × 결과** 데이터를 쌓아 해자로 삼고, 나라·유형별로 더 원하는 결과물을 내주는 쪽으로 발전한다.

**세 문은 동급이고 엔진 하나를 공유한다**(Bae 2026-09-26 확인):

| 문 | 유저 상태 | 엔진 | 지금 |
|---|---|---|---|
| (a) 아이디어 | 만든 게 없음 | 기획 캐묻기 → 지시서 → 빌드(T1) → 검수 → 영수증 | 지시서·검수·호스팅 라이브, 빌드 잡 B5 진행 중 |
| (b) 안 됨 | 앱은 있는데 고장 | 검수 → 수리 → 재검수 → 영수증 | 검수 라이브, 수리는 조건부(§2) |
| (c) 생각과 다름 | 되긴 하는데 의도와 어긋남 | 의도 캐묻기 → 지시서 갱신 → 수리/재빌드 → 영수증 | 의도 입력만 있음, 루프 없음 |

공통 엔진 = **의도 확보 + 의도 대조 판정 + 고치기/만들기 루프 + 출처 구분 영수증 + 데이터 봉투.**
파일럿 재료 = Bae의 아이디어 20+개(문 a) → 그것을 Lovable/Bolt/v0로 만들어 보면 문 (b)(c)의 재료와 첫 도구별 데이터가 함께 생긴다. 병목은 모집이 아니라 개발 완료.

## 1. 조사에서 확인된 사실 — 끊긴 곳 (전부 [확정], 반박 검증 통과)

| # | 끊긴 곳 | 근거 | 뜻 |
|---|---|---|---|
| 1 | 의도 확인 카드 "맞나요?"를 확정해도 **D1·검수 기준에 닿지 않는다**. `confirm()`은 localStorage+ext 블롭만 저장, `mirrorLocalProjectToDb` 미호출. (반박: ext는 1.5초 디바운스 PUT로 서버에 가긴 하나 검수·지시서는 그 표를 읽지 않음) | `IntentConfirmCard.tsx:101-137`, `project-mirror.ts:22` | 문 (c)의 입구가 판정과 연결돼 있지 않다 |
| 2 | **재검수가 원래 의도를 잃는다**. 재검수 버튼은 `{userKey, locale}`만 보내 서버 기본 문장으로 바뀜 | `[runId]/page.tsx:395`, `workspace-visual-check-runs.ts:198-205` | "고친 뒤 다시 확인"이 다른 자로 잰다 |
| 3 | 자동 재검수(verify-sweep)에 **지시서 AC가 전달되지 않는다** | `verify-sweep.ts:109-117` vs `runs.ts:263-274` | 수동과 자동 재검수의 자(尺)가 다르다 |
| 4 | **수리는 GitHub 저장소 + 유저 OAuth 둘 다 필요**. 주소만 있는 앱(Lovable·Base44 등)은 서버 수리 불가. 공개 저장소도 OAuth 없으면 `not_connected` | `workspace-repair-jobs.ts:257-307`, `github-app-access.ts:152-153` | 문 (b)의 절반이 막혀 있다 |
| 5 | 주소만 유저에게도 "고치기" 버튼이 보이고 누르면 "GitHub 저장소를 먼저 연결"(한국어 하드코딩) | `repair-state.mjs:19-22`, `workspace-repair-jobs.ts:276` | 기본 흐름의 외부 계정 CTA(D-17 위반) |
| 6 | 빌더용 고침 지시(`web_builder`)는 **타입에만 있고 리포트에 배선 0** — 리포트는 CLI 에이전트(Claude Code·Cursor) 형식 하나 | `nondev-report.ts:688-790`, `pr-fix-brief.ts:22` | Lovable 유저가 붙여넣을 수 있는 형식이 없다 |
| 7 | 수리 컨테이너의 사후 검증은 `.js/.mjs`의 `node --check`뿐. TS/TSX/CSS는 건너뜀, fresh clone에 node_modules 없음 | `container/server.mjs:622-638` | 수리 PR은 빌드 미검증 — D-4 트레일러 필요 |
| 8 | **데이터 봉투가 검수 행에 없다**: `workspace_visual_checks`에 region·built_with·topic_tags·finding_code·user_verdict 컬럼 0. `cf.country`를 읽는 곳은 `workspace-github.ts:1030` 한 곳. `NonDevFinding`에 코드 필드 없음. built_with는 캡처 시점만 가능(백필 불가) | `0050:14-31`, `0065`, `visual-check-db.ts:204-224`, `nondev-report.ts:72-83`, `built-with.ts:7-9` | 비전의 6축 중 검수 행에 잡히는 것이 0 — 첫 파일럿 **전에** 컬럼이 있어야 한다 |
| 9 | 검수·수리 라우트에 **일일 상한·킬스위치 0건**(`consumeUserDailyLimit` 호출부는 dev-spec·github·projects뿐) | `beta-limits.ts:22-27` | 파일럿 전 비용 방어선 없음 |
| 10 | "생각과 다르다"의 기계 판정은 then 내용어 절반 일치 휴리스틱, **라이브 참양성 0건**(오탐 0만 확인) | `acceptance-observe.mjs:8,65`, HANDOFF-2026-09-25 §3 | 문 (c)의 핵심 능력이 아직 측정되지 않았다 |
| 11 | 빌더 호스트 감지 0건(`.vercel.app`·`.netlify.app`만) → 도구 축(built_with) 자동 추정 불가 | `source-evidence.ts:108-115` | lovable.app·bolt.host·replit.app 감지 추가 필요 |
| 12 | 고침 지시 복사 버튼은 usage 이벤트 0건 → "활용 방식" 축 미계측 | `[runId]/page.tsx:646-656` | 데이터 6축 중 '어떻게 활용' 공백 |
| 13 | 여정 감사의 초보자 P0 검사는 J0·J2·J7만 기본 흐름 — 기존 앱 여정 J1은 P2로만 기록 | `beginner-terms.mjs:81-83` | 문 (b)(c)의 위반이 감사에 안 보인다 |

정정(비평가): 랜딩 FAQ 실제 문구는 "Your work stays in your browser **and your account**"(`simsa-landing dictionary.mjs:90`) — D1 저장과 충돌하지 않는다. 마이그레이션 0068은 PR #548(B5a, 미머지)에 있으므로 봉투 마이그레이션은 **0069**로 번호를 잡고 #548 머지 뒤 적용한다.

## 2. 결정 문안 (설계 문서 재론 요청 — D-번호 인용)

LOCKED 재론은 번호 인용·문안·이유로. `design lock approved`(재정렬) 발화 시 발효.

| 결정 | 조치 | 문안 |
|---|---|---|
| **D-19** | amend | 포지셔닝에 "어떤 도구로 만들었든, 안 되거나 생각과 다른 앱을 되게 만들고 그 결과를 독립적으로 확인해 준다" 추가. **북극성 = 접수 건 중 `user_verdict = as_intended`로 닫힌 건수**(컨시어지 개입 0건 완주 수 병기). 영수증은 증빙으로 유지하되 "수리 diff"와 "재검수 증거"를 별도 섹션으로(고친 주체 ≠ 판정 주체). B 우선순위 문장 "T0·T2 품질 → S 빌드"는 "세 문 공통 엔진 → 문별 인도 경로"로 |
| **D-17** | amend | 기본 흐름의 첫 문을 세 개로 명시: "아이디어가 있어요 / 만든 앱이 안 돼요 / 만들었는데 생각과 달라요". 기존 앱 문에서만 "코드 연결(GitHub App 설치)"을 **선택 단계**로 허용(건너뛰면 빌더용 고침 지시 복사 → 재검수 → user_verdict 경로). 여정 감사 P0 검사를 J1(기존 앱)에도 적용 |
| **D-8** | amend | 기록 단위를 "4중항 + **맥락 봉투**(region·locale·content_lang·entry_path·built_with·detected_stack·topic_tags·acquisition) + **사람 수용 라벨**(`finding_codes[]`·`user_verdict`·`resolved`)"로. 봉투 스키마는 `training-store.ts:102-123 EnvelopeInput`을 그대로 |
| **D-21** | amend | 순서 앞에 ⓪ "내부 활용: 나라·도구·유형별 실패 지도 → 수리 프롬프트·로컬 팩 개선(첫 건부터)". 동의 두 층: ⓐ **비식별 운영 메타**(ISO-3166 국가 코드만·locale·built_with·topic_tags·entry_path·finding_codes·user_verdict·resolved)는 개인정보처리방침 고지 후 운영 D1에 기록·집계 / ⓑ **내용 데이터**(의도 원문·diff·스크린샷)는 opt-in 유지 |
| **D-20** | amend(주석) | "한국 증거 전 확장 금지"는 로컬 팩 **출하**에만. region·locale 수집과 나라별 집계는 첫 건부터 전 지역 — 그것이 JP·SEA 순서를 정하는 증거 |
| **D-13** | amend(주석) | 임계(4중항 ≥5,000 / 월 $2K)는 **모델 학습 착수**에만. 집계·분석·프롬프트 튜닝은 첫 건부터 |
| **D-2** | amend(추가만) | `DevSpecMeta.provenance{ builtWith, entryPath, detectedStack, userConfirmedAcIds[] }`. 무결성: `source === "inferred"`이면 must AC는 `userConfirmedAcIds`에 있는 것만 must. (**출처 구분 = 어제 A안**) |
| **D-1** | amend | 기존 앱 문의 최소 인도물 = "확인된 문제 + 수정 후 재확인 결과(user_verdict)". T0(inferred)는 판정 척도로 내부 생성, 유저에게 문서 단계 강요 없음. T2 시작 조건 = "맞나요? 카드에서 확인한 must 항목 ≥1" |
| **D-7** | amend([PILOT] 수치) | 검수·수리 라우트 유저당 일일 상한(검수 10/일·수리 5/일) + `INSPECTION_ENABLED`/`REPAIR_ENABLED` [vars] 킬스위치 |
| **D-4** | keep | 수리 PR에는 당장 게이트가 아닌 **라벨** `build: unverified`(TS/TSX 등 `node --check` 밖 변경). 문 (a)의 T1은 B5(b) 게이트 그대로 |
| **D-15** | keep | 공개 저장소 OAuth 없음 → App 설치 토큰 폴백 허용(범위 내 분기 추가) |
| **Train C** | reopen | 기존 앱 문에 한해 B5 의존 해제: **C2a**(코드 연결: 수리 PR 루프) / **C2b**(주소만: 빌더용 고침 지시 → 재검수 → user_verdict). C1 프리뷰는 기존 앱 문에 불필요 |
| **B10 파일럿** | amend | "실기획 3건 T0→T1→S"에서 **"Bae 아이디어 20개 중 6건: (a) 3건 S 빌드 완주 + (b)(c) 3건 — 같은 아이디어를 Lovable/v0/Bolt로 만들어 안 되는/다른 앱을 만든 뒤 검수→수리→재검수→user_verdict 완주"**로. 정답지 선기록 규율 유지. 레지스트리 B8→B10 통일 |
| PRD | amend(소폭) | §1 해자에 "나라·도구·유형별 실패·수리 데이터" 1줄, §3 축 B(기존 것의 문제 찾기·고치기)를 주 축으로 표기, §11 봉투·라벨 스키마. 설계 §4 "PRD를 빌드 중심으로" 집행 보류 |
| EVIDENCE-RULE | fix | 메모리·D-4가 인용하는 `docs/EVIDENCE-RULE.md`가 repo에 **없다**(ls 확인) — 위치 확인 또는 링크 정정 |

## 3. 로드맵 (세 문 동급, 단독 에이전트 기준 일수)

원칙: **W1은 세 문이 공유하는 엔진과 데이터 봉투**(어느 문이 먼저든 필요), 그다음 문별 인도 경로를 병렬로.

### W1 — 공통 엔진·정직성·데이터 (합 ~9일)
| # | 항목 | 완료 조건 | 재사용 |
|---|---|---|---|
| 1 (0.5d) | 재검수가 원 intent 유지 + `source_check_id` | 옛 코드 실패 테스트 + 라이브 재검수 intent 동일(D1) | `runs.ts:198-205` |
| 2 (1d) | 비용 방어선: 검수·수리 킬스위치 [vars] + 일일 상한(10/5) → 429, 정직 카피 KO/EN | 상한 테스트 + off 시 503 카피 + 라이브 1회 | `beta-limits.ts`, `LEGACY_AUTO_REVIEW` 패턴 |
| 3 (1d) | 정직성 3건: queued 카피, "공개 저장소는 로그인 불필요"의 범위 명시, 수리 PR `build: unverified` 트레일러 | KO/EN 라이브 + 트레일러 테스트 | `server.mjs:517-573` |
| 4 (0.5d) | **0069**(additive): `workspace_visual_checks` += region·envelope_json·finding_codes_json·user_verdict(+at)·source_check_id; `workspace_repair_jobs` += region·verify_check_id·resolved; `workspace_projects` += region_at_create | `migration 0069 apply approved.` | 0065·0052 선례 |
| 5 (2d) | 캡처 배선: region(`cf.country`)·봉투 스냅샷·`NonDevFinding.code`(FIND 키 재사용)·복사 버튼 usage 이벤트·빌더 호스트 감지(lovable.app·bolt.host·replit.app·base44) | 옛 코드 실패 회귀 + 라이브 한글 앱 1건의 행에 봉투·코드 채움 | `workspace-github.ts:1030`, `training-store.ts:102-123`, `nondev-report.ts:414` |
| 6 (1d) | 의도 확정 → 판정 자: `IntentConfirmCard.confirm()`이 `mirrorLocalProjectToDb` 호출 → D1 idea/productSpec/items → `classifyTopics` 재계산; 확정 oneLine이 검수 intent 기본값 | 라이브 D1 + 한글 의도 3건 테스트 | `project-mirror.ts:22`, `workspace.ts:399-401` |
| 7 (1.5d) | **빌더용 고침 지시**(`web_builder`): 브랜치·터미널·PR 문구 제거, 채팅창 1덩어리; built_with가 lovable/bolt/v0/replit이면 기본 + "빌더 채팅에 붙여넣기" 복사 버튼 | KO/EN 스냅샷 + 라이브 리포트 기본 노출 + **실제 Lovable 프로젝트 1건 붙여넣기→Publish→재검수 왕복 실측**(비평가 지적) | `nondev-report.ts:691` |
| 8 (1.5d) | **user_verdict**: `POST …/visual-checks/:runId/verdict`(4값) + 리포트 하단 1탭 "생각대로 됐어요 / 되긴 하는데 달라요 / 아직 안 돼요 / 모르겠어요" | 옛 코드 실패 테스트 + 라이브 D1 + 재열람 유지 | `outcomes.ts` enum 패턴 |
| 9 (0.5d) | 프라이버시 정합: 방침 §1에 "IP 기반 국가 코드(ISO-3166만)" 고지, 동의 유저 삭제 시 R2 journey 삭제 | 삭제 테스트 + Bae 검토 1회 | `legal/privacy/page.tsx` |

### W2~W3 — 문별 인도 경로 (병렬)
| 문 | 항목 | 완료 조건 |
|---|---|---|
| (a) | **B5(b)** 빌더 컨테이너 잡(executor·WBS 루프·`pnpm run build` 게이트·D1 마이그레이션·`--dispatch-namespace` 배포·push) + B7 킬스위치(라우터 410) | 고의로 깨진 코드가 failed(building), 정상 기획이 `<slug>.simsa.page` 200 |
| (b) | C2a 수리 진입 완화(공개 저장소 OAuth 없음 → App 토큰), verify-sweep에 acceptancePlan 전달, `repair_jobs.resolved` 기록 | 라이브 수리 잡 1건 + 자동 재검수 resolved ≥1 |
| (c) | A7 역추론 지시서(`source: inferred`, provenance, must AC = 확인 카드 kept) + **인터뷰 프롬프트 팩**(유저 AI에 붙여넣기 → 고정 양식 회수 → 결정 반영·재생성) + 의도 불일치 픽스처 10변형 정답지(참양성 최초 1건 목표) | 파일럿 3앱 무결성 통과·다음 검수에 AC 포함; 픽스처 오탐/미탐 표 커밋 |

### W3~W4 — 파일럿 (`pilot start approved.`)
- **재료**: Bae 아이디어 20개 중 6건. (a) 3건은 S 빌드 완주. (b)(c) 3건은 같은 아이디어를 Lovable·v0·Bolt로 만들어 "안 되는/다른" 앱으로 준비 → 검수→고침 지시/수리→재검수→user_verdict.
- **정답지 선기록**: 건별 "원래 의도 1문장·지금 다른 점 1문장·예상 실패 지점·기대 판정·기대 user_verdict" 커밋 후 실행.
- **측정**: user_verdict 분포(as_intended 건수·개입 0건 완주 수 병기), 6축 채움률, 기계 판정 vs 사람 라벨 일치율(비평가 지적: 정확도 지표 정의 필요), 문별 소요 시간·비용(`spent_usd`).
- **집계**: `GET /admin/moat-stats`(region × built_with × topic × finding_code × user_verdict × resolved) JSON 1개.
- 3라운드 회고 → 다음 4주 2안(데이터 인용) + 랜딩 첫 문 v2 초안.

## 4. 보류·폐기
- B9(내 GitHub로 가져가기)·B6 예산 UI(코드 상한만)·C1 프리뷰·D-18 가져오기 판정·D-20 JP/SEA 팩·Train Y·N7 전면 랜딩 재작성(첫 문 1줄만)·StuckHelper→수리 자동 연결·관리자 집계 UI(JSON만)·topic_tags LLM 보강.
- B5(b)는 **보류하지 않는다**(문 a의 파일럿 재료가 Bae 아이디어이므로). 단 W1 공통 엔진 뒤에 착수.

## 5. Bae 결정 (3개)
1. **D-21 두 층**: 비식별 운영 메타(국가 코드·도구·유형·실패 코드·user_verdict)를 opt-in 없이 방침 고지만으로 기록·집계해도 됩니까? (아니오면 첫 데이터가 동의율에 묶임 — 법률 판단은 [미확인])
2. **재정렬 승인**: 위 D-번호 문안으로 `design lock approved`(재정렬) + `train C start approved`(C2a/C2b) — 그리고 B10 파일럿 정의 교체.
3. **파일럿 재료 준비**: 아이디어 20개 중 6건 선정과, (b)(c)용 3건을 Lovable·v0·Bolt로 미리 만들어 두는 일(Bae 또는 팀원, 각 30분~1시간)을 W3 전에 해 주실 수 있습니까?

## 6. 지금 상태와의 연결
- 열린 PR: #548 B5(a). 머지 후 0069 번호로 봉투 마이그레이션.
- 어제 합의한 A안(출처 구분)은 D-2 provenance로, 인터뷰 프롬프트 팩은 문 (c) W2~W3 항목으로 이 로드맵에 들어 있다.
- BM·이코노미 분석(글로벌, 5개 수익 엔진)은 별도 진행 중 → `docs/simsa-bm-economics-2026-09-27.md`.
