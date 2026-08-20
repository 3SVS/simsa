# Simsa 테스트 케이스 명세 — 2026-08-20

> 목적: 흩어져 있던 검증(유닛 401파일·journey-audit·스모크·픽스처 eval·수동 QA)을
> **케이스 단위 단일 장부**로 성문화한다. 각 케이스는 "지금 무엇으로 실행되는가"를
> 정직하게 표기한다 — 자동화 태그가 없는 케이스는 **수동 전용이며 미실행이면 미검증**이다.
>
> 기준 문서: `docs/simsa-prd.md`(§5 불변식·§6·§7 여정) ·
> `docs/simsa-standard-eval-2026-07-21.md`(10축) ·
> `docs/simsa-stack-agnostic-design-2026-08-20.md`(D-1~D-4) ·
> `docs/simsa-open-gate-2026-07-21.md`(휴먼 QA).

## 실행 태그 (자동화 커버리지 대응표)

| 태그 | 수단 | 실행 위치 · 실행 시점 |
|---|---|---|
| **[U]** | 유닛 (`node --test`) | CI(push/PR, Node 20·22) — 상시 |
| **[J]** | journey-audit (실브라우저 KO+EN) | `tools/simsa-completion-loop-spike/journey-audit.mjs` — 수동 실행(배포 게이트 절차) |
| **[S]** | 스모크 (프로덕션 API) | `anonymous-smoke.mjs` · `en-report-smoke.mjs` · 5분 프로브 — 수동 실행 |
| **[F]** | 검수 픽스처 eval | `tools/simsa-inspection-fixtures/` F1~F8 + R1~R3 — 수동 실행 |
| **[C]** | 카나리 (15분 크론) | `.github/workflows/canary.yml` — 상시 |
| **[M]** | 수동(사람) | 휴먼 QA 체크리스트 / 건별 |

우선순위: **P0** = 진행 불가·오도·데드엔드·데이터 소실(오픈 차단급) · **P1** = 핵심 품질 · **P2** = 마감 품질.

---

## A. 진입·갈래 선택 (TC-ENT)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| ENT-01 | 신규 익명 유저 첫 진입 | P0 | 시크릿 창 → app.trysimsa.com → 가입 없이 갈래 선택 화면 도달, 데드엔드 없음 | [J] J0 · [M] |
| ENT-02 | 세 갈래 문 이해 가능성 | P0 | 갈래 선택 화면에서 idea/code/spec 중 선택지가 3초 내 이해 | [M] 휴먼 QA A-1 ([J]는 존재·출구만 측정) |
| ENT-03 | 갈래 선택이 URL에 미러 | P1 | 갈래 진입 후 브라우저 뒤로 → 선택 화면 복귀 (?path= 파라미터) | [U] project-steps · [J] |
| ENT-04 | 첫 방문 locale 감지·고정 | P0 | KO 브라우저 첫 방문 → UI·생성물 한국어(감지 즉시 저장) | [U] i18n · [J] (2026-07-20 P0 회귀 가드) |
| ENT-05 | 예시 프로젝트 읽기 전용 | P1 | 예시 프로젝트 열람·수정 시도 → D1 기록 없음, 소유권 오염 없음 | [U] example-fixture (7/10 사고 가드) |

## B. 아이디어 갈래 (TC-IDEA)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| IDEA-01 | 아이디어→스펙 생성이 진짜(LLM) | P0 | 고유 디테일 포함 아이디어 입력 → source=llm, 디테일이 초안에 반영 | [C] 크라운주얼 · [S] · [M] ②재확인 |
| IDEA-02 | 생성 실패 시 정직 에러 | P0 | LLM 불가 시 → 날조된 초안 대신 "생성 실패+재시도" (user-words 게이트) | [U] verify-spec · [S] (8/20 503 실측) |
| IDEA-03 | 인터뷰 질문이 아이디어 맞춤 | P1 | 솔로/팀·규모 등 축이 입력에 맞게 조정(D17 4~12개) | [U] generate-idea-question-ux |
| IDEA-04 | 질문 거절→재생성 반영 | P1 | "내 경우엔 안 맞아요"+사유 → 재생성 질문이 사유 회피 | [U] |
| IDEA-05 | 실현가능성 정직 경고 | P0 | 네이티브/3D게임 아이디어 → 웹 검수 한계 경고+excluded 반영 | [U] generate-feasibility |
| IDEA-06 | 호스팅·데이터 질문 선택성 | P1 | 전부 미응답으로도 진행 가능, "모르겠어요" 정상 저장 | [U] stack-profile · [M] |
| IDEA-07 | 열린 결정 추천이 날조 금지 | P1 | recommend 실패 시 기본값 지어내지 않고 재시도 안내 | [U] recommend |
| IDEA-08 | 준비 화면 다음 행동 가시성 | P0 | 저장 후 랜딩에서 다음 할 일이 보임(데드엔드 0) | [J] J0 · [M] |

## C. 기존-앱 갈래 (TC-CODE)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| CODE-01 | 스텝1만으로 프로젝트 생성 | P0 | 이름+URL만으로 생성, 아이디어 스텝 강요 없음 | [J] J1 · [S] 5분 프로브(54초 완주) |
| CODE-02 | "꼭 작동해야 하는 것" 의도 반영 | P1 | 1문항 답 → 검수 intent에 반영(composeCodeIntent) | [U] code-intent |
| CODE-03 | 생성 실패 시 항목 없이 정직 생성 | P1 | LLM 실패 → mock 항목을 진짜처럼 저장하지 않음 | [U] |
| CODE-04 | 저장 완료 전 네비게이션 금지 | P0 | 생성→즉시 repo 연결해도 소유권 404 없음(D1 선저장) | [U] (#258 가드) |
| CODE-05 | 소스 없이 검수 시도 → 안내 | P0 | website 소스 없이 심사 → 막힘 안내(데드엔드 아님) | [J] J1 |

## D. 기획서 갈래 (TC-SPEC)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| SPEC-01 | 붙여넣기→원샷 변환→미리보기 | P0 | 기획서 텍스트 → 변환 결과 화면, 수정 가능 | [J] J2/J2e |
| SPEC-02 | 문서 업로드(PDF) 정직 한계 | P1 | PDF 업로드 → pdf_text_extraction_unsupported 정직 에러 | [U] document-intake |
| SPEC-03 | 변환도 사용자 언어 | P1 | EN 상태 변환 → 영어 스펙 | [U] · [J] J2e |

## E. 문서 검수 check-draft + RC-2/RC-3 (TC-CHK)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| CHK-01 | 검수 4상태 판정 정확성 | P0 | 제외범위→안 맞음 · 기준0→확인 부족 · 미결연결→결정 필요 | [U] workspace-check |
| CHK-02 | LLM 실패 시 휴리스틱 폴백 표기 | P1 | source=mock-fallback으로 정직 표기(무표기 날조 금지) | [U] |
| CHK-03 | RC-2 교차확인: 유죄만 2차 | P0 | failed만 교차 → 동의=dual_confirmed·불일치=확인 부족 강등+양관점·실패=single | [U] verify-panel |
| CHK-04 | RC-3 협의체 합의·불합의 | P1 | 3벤더 독립→다수결→미합의=council_split(단정 금지) | [U] council-review · 라이브 9/9(7/17) |
| CHK-05 | 협의체 자격 게이팅 | P1 | 무료 플랜 council 요청 → 402 plan_required(UI 숨김 아닌 서버 집행) | [U] |
| CHK-06 | 벤더 부족 시 정직 503 | P1 | 가용 벤더<2 → council_unavailable(조용한 대체 금지) | [U] |
| CHK-07 | 검수 EN 전면 | P0 | EN 상태 검수 → 판정 프로즈·강등 사유·split 요약 전부 영어 | [U] *-en 4파일 (#467) |

## F. 실화면 심사 visual check (TC-VIS)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| VIS-01 | 심사 완주 시간 | P1 | 디스패치→done ~1분 내(컨테이너) | [S] 5분 프로브(48초 실측) |
| VIS-02 | 변별력: 정상 vs Potemkin vs 크래시 | P0 | F1~F5 아키타입 각각 구분 판정, 오판 0 | [F] (7/17 6/6 — ⚠️ 단일 스위트 재실행은 백로그) |
| VIS-03 | 낙관적 유령(optimistic ghost) | P1 | 저장 안 되는 UI → reload-persistence로 적발 | [F] F6 |
| VIS-04 | 무거운 사이트 hang 없음 | P0 | 대형 페이지 → 타임아웃 내 done(F7, context.close 가드) | [F] F7 |
| VIS-05 | 권한 게이트(위치) 통과 | P1 | geolocation 앱 → 결정론 좌표로 실플로우 도달 | [F] F8 |
| VIS-06 | 판정 어휘: 숫자 점수 금지 | P0 | 리포트에 점수 없음, 상태 라벨 11종만 | [U] assertNoNumericScores |
| VIS-07 | 자동 Ready 금지 | P0 | works=true는 사람 수용 없이 절대 미발생(UAR 정지) | [U] · [F] 전 결과 works=null |
| VIS-08 | "왜 이 판정" 증거 체인 | P1 | 3열(항목↔증거↔상태)·"해석≠측정 사실" 구분 렌더 | [J] J5 · [M] |
| VIS-09 | 앱 백엔드 실패는 유지, 잡음만 allowlist | P0 | 애널리틱스 실패≠결함, Supabase 실패=결함 유지 | [U] nondev-report (신호/잡음 분리) |
| VIS-10 | 재검수 locale 승계 | P1 | EN 런의 수리 머지 → 자동 재검수도 EN | [U] verify-sweep-locale (#468, 0065) |
| VIS-11 | find→fix→verify 원 자동 완주 | P0 | 수리 PR 머지→웹훅 기록→크론 재검수 자동 생성 | [U] verify-sweep · 라이브 1회 실증(7/22) |

## G. 빌더팩·수리팩 (TC-PACK)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| PACK-01 | 타깃 5종 파일 계약 | P0 | claude_code/codex/both/web_builder/handoff 각각 약속된 파일 세트 | [U] workspace-export |
| PACK-02 | 조합 소비: 미응답=중립 | P0 | 스택 미응답 팩 → Supabase/Vercel 단정 없음, 물음-먼저 안내 | [U] export-stack (#477) |
| PACK-03 | 조합 소비: 답변 추종 | P0 | data=firebase→Firebase 안내 · other="PocketBase"→그 이름, 치환 금지 · builder_hosted→Publish 버튼 | [U] export-stack |
| PACK-04 | 팩 EN 전면(KO 불변) | P0 | EN 팩 무한글(유저 콘텐츠 제외) · KO는 byte-identical | [U] export-en (#473) |
| PACK-05 | 시크릿 무저장·무누출 | P0 | 서비스 키는 .env.local만, 프롬프트·서버 무기록 | [U] no-secret · export-key-no-store |
| PACK-06 | 항목 선택 필터 | P1 | selectedItemIds만 팩에 포함 | [U] |
| PACK-07 | 성과(outcome) 5타깃 수용 | P0 | web_builder/handoff 성과 기록 400 없음 | [U] outcomes (#474 회귀 가드) |
| PACK-08 | 수리팩 web_builder | P1 | 웹빌더 유저 수리팩=채팅 프롬프트 1장, CLI/저장소 지시 없음 | [U] pr-fix-brief-web-builder (#479) |
| PACK-09 | 수리팩 타깃 자동 선택 | P1 | builtWith=lovable→web_builder, 미응답→both 무회귀 | [U] agent-registry-p3 |

## H. GitHub·PR 검수·auto_fix (TC-GH)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| GH-01 | repo 연결 왕복(코드 갈래 직행) | P0 | 연결→미연결 안내→연결 후 검수 가능 | [J] J3 · [M] |
| GH-02 | PR 검수 결과가 항목 기준 | P0 | diff를 확인 항목 대비 판정, PR 밖 단정 금지 caveat | [U] pr-review |
| GH-03 | PR 코멘트·수정지시 locale | P1 | KO/EN 유저별 PR 본문 언어 | [U] repair-pr-i18n · walmart EN 라이브(7/21) |
| GH-04 | auto_fix 정직 강등 | P0 | 대형파일 등 auto 불가 → brief_only+modeReason 기록(몰래 성공 연출 금지) | [U] repair-jobs · 라이브(7/20) |
| GH-05 | private repo 접근(App 설치) | P1 | 설치 repo만 60분 토큰 발급, 미설치 repo_access_denied 정직 | [U] · Test A/B 라이브(7/20) |
| GH-06 | 소유권 게이트 전 라우트 | P0 | 타 userKey 프로젝트 접근 → 403/404, 사이드이펙트 없음 | [U] (26라우트, #195 계보) |

## I. i18n EN (TC-I18N)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| I18N-01 | 사전 키 패리티 | P0 | EN/KO 딕셔너리 키 완전 일치 | [U] i18n(CI 강제) |
| I18N-02 | EN 여정 한글 누수 0 | P0 | EN 12여정 본문 한글 0(토글 라벨 제외) | [J] EN축 koLeak |
| I18N-03 | EN 리포트 프로즈 | P0 | EN 검수 리포트 문장 영어 | [S] en-report-smoke · [U] nondev-report-i18n |
| I18N-04 | EN 원어민 톤·마크업 | P1 | 기계 무한글 넘어 원어민 자연스러움 | **[M] 전용 — Not Verified(표준평가 §2.5)** |

## J. 알림 (TC-NTF)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| NTF-01 | 이메일 테스트 실발송 | P0 | 설정 저장→테스트→실수신(notify@trysimsa.com) | [S] 8/20 실측 sent · [M] 수신 확인 |
| NTF-02 | 미설정 시 정직 503 | P1 | RESEND 부재 시 email_not_configured(무소음 실패 금지) | [U] |
| NTF-03 | problems_only 정책 | P1 | 전항목 통과 리뷰 → 발송 skip 기록 | [U] review-notify |
| NTF-04 | 재참여 평생 1통 가드 | P0 | reengage 크론이 유저·프로젝트당 1통 초과 금지 | [U] reengage |
| NTF-05 | 텔레그램 경로 | P1 | 연결 시 PR 검수 결과 DM | [U] · [M] 실수신 |

## K. 소유권·보안·한계 (TC-SEC)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| SEC-01 | 삭제 캐스케이드 완전성 | P0 | 프로젝트 삭제 → D1+R2 증거 전체 삭제(고아 0) | [U] r2-sweep (#336 회귀) |
| SEC-02 | 검사 대상 read-only | P0 | 심사는 등록된 website 소스 origin만, 임의 URL 금지 | [U] visual-check-runs |
| SEC-03 | 레이트리밋·베타 상한 | P1 | 시간당/일일 상한 → 429+재시도 안내(fail-open 아님 항목별 확인) | [U] rate-limit·beta-limits |
| SEC-04 | 훈련 수집 동의 게이트 | P0 | 동의 없으면 training/journey 저장 0(기본 OFF) | [U] training-store·journey-store |
| SEC-05 | idempotency·중복 생성 방지 | P1 | 동일 요청 재전송 → 중복 런/과금 없음 | [U] |

## L. 정직성·오류 (TC-HON)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| HON-01 | 프로덕션 생성 순단 대응 | P0 | LLM 503 창에서 유저는 정직 에러+재시도(데드엔드 아님) | [S] 8/20 실측 · [C] |
| HON-02 | 카나리 크라운주얼 | P0 | 15분마다 source=llm 프로브, mock 강등 시 이슈 오픈 | [C] |
| HON-03 | 배포 신선도 감시 | P1 | main이 Worker보다 12h+ 앞서면 카나리 경고 | [C] (8/20 29일 적체 적발 실증) |

## M. 리얼 데이터 (Rule 6) (TC-R6)

| ID | 케이스 | 우선 | 절차 → 기대 결과 | 실행 |
|---|---|---|---|---|
| R6-01 | 한글 상호·아이디어 전 경로 | P0 | "(주)밀앤솔트" 류 입력이 스펙·검수·팩·PR까지 무깨짐 | [S] 프로브(한글 데이터) · [U] 다수 |
| R6-02 | 한글 자유텍스트 → ASCII 키 정규화 | P1 | 스택 other "회사 자체 서버"·서비스 "우리회사포스" → 표시 원본 보존+키 ASCII | [U] stack-profile·service-catalog (#475·#478) |
| R6-03 | 한글 파일명 업로드 | P1 | 기획서 "발표자료 한글.pdf" 업로드 키 InvalidKey 없음 | **[M] 전용 — ssf2026 교훈, 자동화 백로그** |

## 수동 전용(자동화 없음) 최종 목록 — 미실행이면 미검증

ENT-02(3초 이해) · I18N-04(원어민 톤) · R6-03(한글 파일명) · 모바일 실기기 360px ·
유료 협의체 실과금 여정(과금 OFF 결정으로 동결) · 이메일/텔레그램 실수신 확인.
→ 이 중 오픈 게이트 필수분은 휴먼 QA 체크리스트(§14)에 포함되어 있다.
