# Simsa 전체 개발 계획 — 2026-09-24 (SI 티어 설계 잠금 이후)

정본 관계: 결정은 `docs/simsa-si-tier-design-2026-09-24.md`(D-1~D-21), 제품 경계는 `docs/simsa-prd.md`, 증거 규칙은 `docs/EVIDENCE-RULE.md`. 이 문서는 **그 결정들을 언제·어떤 순서로 코드로 만들지**만 다룬다. 결정을 바꾸지 않는다.

## 0. 지금 어디 있나 (2026-09-24 오후, 라이브확인)

| 축 | 상태 | 증거 |
|---|---|---|
| T0 개발 지시서 (Train A) | **완료·라이브**. 한글 리얼 기획 3건 × ko·en 6/6 생성, 빌더 팩 `dev-spec/` 10파일, 대시보드 화면, AC 검수 관통 | `dev-spec-probe.mjs` 세 칸 표(HANDOFF-2026-09-24 §7-b·c) |
| 초보자 기준 (Train N) | **N1~N6 완료·라이브**, N7(랜딩 카피)은 초안만 | journey-audit KO P0=0·P1=0(N6 장비) |
| T1 빌드 + S 호스팅 (Train B) | **미착수** — `train B start approved` 대기 | — |
| T2 인도 (Train C) | 미착수 (B5 뒤) | — |
| Google 로그인 | 코드 준비됨, **프로덕션 미설정**(PROVIDER_NOT_FOUND) | secrets 허용 PR 열림 |
| 로그인 뒤 검수 (Email Routing) | 코드 준비됨, **수신 경로 미연결** — Vercel DNS라 Cloudflare 존 `conclave-ai.dev`로 우회 | `email-routing-setup` 워크플로 PR 열림 |
| 벤더 | Anthropic 킬스위치 ON → 실제 생성 모델은 gpt-5.4 폴백 | `/internal/llm-probe` |
| 지원서(Train Y) | 보류 (Bae) | — |

**근본 문제(Rule 2) 재확인**: 초보자가 "기획대로 작동하는 개발물"을 받으려면 ① 지시서(T0, 됨) → ② Simsa가 대신 빌드해 호스팅(T1·S, **없음**) → ③ 독립 심사·영수증(T2, 부분: AC 검수는 되나 빌드→수리→재검수 루프와 영수증이 없음). ②가 없으면 ①은 문서에서 멈추고, ③은 "검수받을 대상"이 없는 초보자에게 무의미하다. 그래서 다음은 **B**다.

## 1. 의존 사슬과 순서

```
[인프라 준비, 지금]        4-b Google 로그인 ─┐
                           5   Email Routing ─┤ (B와 병렬, 코드 영향 없음)
                                              │
Train B ─ B1 컨테이너 ─ B2 호스팅 기반 ─ B3 템플릿·저장소 ─ B4 워커 확장 ─ B5 빌드 게이트+S 배포 ─┬─ B6 예산 ─ B7 호스팅 의무 ─ B8 대시보드 ─ B9 이전 ─ B10 파일럿 ─ B11 기존 앱 가져오기
                                                                                                 └─ Train C ─ C1 프리뷰 ─ C2 find→fix→verify 루프 ─ C3 영수증 ─ C4 4중항 코퍼스
```

- **B1·B2는 서로 독립** → 병렬 착수. B3은 B2(D1 생성 API·와일드카드 도메인)가 있어야 "배포 green"을 증명.
- **C는 B5 뒤**: 프리뷰 서빙(C1)은 빌드 산출물이 있어야 하고, 루프(C2)는 게이트(B5)가 있어야 "고쳤다"를 판정.
- **B10 파일럿 전 필수**: B6(예산 상한) + B7(킬스위치·신고) — 남의 코드를 우리 계정에서 돌리는 순간부터 의무. 파일럿을 앞당기려고 B6·B7을 건너뛰지 않는다.
- 4-b·5는 트레인과 독립. 5가 붙으면 "로그인 뒤 검수" 깊이 L2가 켜져 C2의 재검수 정확도가 오른다(로그인 벽 뒤 화면).

## 2. 스테이지별 계획 (에이전트 실행 단위 · PR 1개 · base=main)

### Train B — T1 빌드 + S 호스팅 (`train B start approved` 후)
| # | 무엇 | 완료 조건(측정) | 예상 | 위험·주의 |
|---|---|---|---|---|
| B1 | `SimsaBuilder` 컨테이너 클래스·이미지(pnpm·wrangler·playwright·egress 제한)·health | `containers instances` 기동, 30초 내 `pnpm -v` | 1일 | 인스펙터 이미지(0.25vCPU)와 별개 클래스. 이미지 롤아웃 확인은 RUNNER_REV 마커 |
| B2 | Workers for Platforms dispatch namespace + 와일드카드 도메인 + 프로젝트당 D1 생성 API + 운영 토큰(Actions secret) | 빈 템플릿이 `<slug>.<host>`에서 200 + D1 read/write | 2일 | **Bae 결정 1개**: 호스팅 도메인(`*.trysimsa.com` 하위 — Vercel DNS이므로 CNAME/NS 위임 필요 — 또는 Cloudflare 존 `conclave-ai.dev` 하위). WfP 요금(유료) 확인 |
| B3 | 템플릿 저장소(Hono+React/Vite+D1) + Simsa 조직 private 저장소 자동 생성 + 스캐폴드 커밋 | 스캐폴드만으로 `pnpm build` green·배포 green | 2일 | GitHub App 설치 토큰 재사용(D-15) |
| B4 | agent-worker 확장: `create_file`·`run_command` allowlist·**유저 배포 명령 차단 테스트(D-6)**·비밀 차단 유지 | 차단 테스트가 옛 코드에서 실패 | 2일 | `wrangler deploy`·`vercel`·`gh auth` 등 차단 목록은 데이터 파일 |
| B5 | 빌드·테스트 게이트 + `build: unverified` 트레일러 + 잡 상태 머신·D1 `build_jobs` + S 배포 단계 | 고의로 깨진 코드가 `failed(building)`으로 끝나고 배포되지 않음 | 3일 | 여기가 D-4의 핵심. green 아니면 "완성" 금지 |
| B6 | 예산 계좌(D-7): 벤더 usage 합산·상한 정지·일일 상한 | 상한 $0.5로 돌리면 WBS 중간 정지 | 1.5일 | 기존 `cost_meta` 재사용 |
| B7 | 호스팅 사업자 의무(D-6): 프로젝트 킬스위치·신고 링크·요청 상한·금지 콘텐츠·정지 로그 | 관리자 1클릭 정지 → 410 | 1.5일 | 파일럿 전 필수 |
| B8 | 대시보드: "만들기"(S 기본)·잡 진행·내 앱 주소·zip·개발자 모드 토글 EN/KO | journey-audit J6 + 계정 요구 화면 0, P0=P1=0 | 3일 | N6 장비로 후측정 |
| B9 | "내 GitHub로 가져가기"(저장소 이전 + D1 덤프) + 지시서에 이전 안내 | 테스트 계정 라운드트립 | 1.5일 | |
| B10 | **파일럿**: 실기획 3건(한글 리얼) T0→T1→S 완주 | 배포 green 수·실패 사유 표·**정답지 선기록** | 2일 | `pilot start approved.` 게이트. 정답지는 실행 전에 적는다 |
| B11 | "이미 만든 앱": 수리 워커에 D-4 빌드 검증 + D-18 호환 판정·가져오기 | 비호환 저장소가 이유와 함께 A 모드 안내 | 2일 | |

**B 합계 ≈ 3.5주(단독 에이전트)** → 10/1 착수 시 **10/24** 파일럿. 병렬 에이전트 2(B1∥B2, B6∥B7, B8∥B9)면 ~2.5주.

### Train C — T2 인도 (B5 후)
| # | 무엇 | 완료 조건 | 예상 |
|---|---|---|---|
| C1 | 컨테이너 프리뷰 서빙(Worker 경유 임시 URL, 잡 종료 시 소멸) | 외부 200 + 내용 확인 | 1.5일 |
| C2 | AC 검수(A5) → 수리 워커 → 재검수 루프, 예산 공유 | 픽스처 결함 1건 find→fix→verify 자동 완주 | 3일 |
| C3 | 영수증: must AC 표·미검증·"프로덕션 아님"·다음 행동 EN/KO | `assertNoNumericScores` 통과 | 1.5일 |
| C4 | 4중항 코퍼스 기록(D-8) + 관리자 집계 | 파일럿 3건 적재 | 1.5일 |

**C 합계 ≈ 1.5주** → **11/3**. D-19에 따라 C3 영수증이 북극성 지표의 단위다 — C를 B10보다 먼저 당길 수도 있다(C1·C2는 B5만 있으면 됨). 권장: **B5 직후 C1·C2를 B6·B7과 병렬**로 시작해 파일럿에서 영수증까지 나오게 한다.

### 잔여 (트레인 밖)
| 항목 | 내용 | 누가 |
|---|---|---|
| 4-b Google 로그인 | ① Google Cloud OAuth 클라이언트(웹, redirect `https://app.trysimsa.com/api/auth/callback/google`, 승인된 origin `https://app.trysimsa.com`) ② `gh secret set AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET` ③ Actions `set-worker-secrets` names=`AUTH_GOOGLE_CLIENT_ID,AUTH_GOOGLE_CLIENT_SECRET` ④ 실측 `POST /api/auth/sign-in/social` google 200 · 브라우저 로그인 1회 | ①② Bae · ③④ 에이전트 |
| 5 Email Routing | ① PR 머지 → `email-routing-setup` check → apply(존 `conclave-ai.dev`, worker `conclave-ai`) ② 권한 부족이면 CF 토큰에 Zone: Email Routing Rules Edit + DNS Edit 추가(Bae) ③ PR: `PROBE_MAIL_DOMAIN="conclave-ai.dev"` + deploy ④ 실제 메일 수신 시험 + 픽스처 가입 왕복 | 에이전트(②만 Bae) |
| N7 랜딩 카피 | `docs/landing-copy-draft-2026-09-24.md` → 코드. **B8 라이브 전엔 "만들어 준다" 주장 금지**(거짓) → B10 뒤 집행 | 에이전트 + Bae 검토 1회 |
| Anthropic 킬스위치 | 프로브 usable 회복 확인 시 `ANTHROPIC_ENABLED` on + deploy → D-3 프론티어 모델 실제 적용 | 에이전트(월요 프로브) |
| 워크트리 정리 | `.claude/worktrees/agent-a9bbdfb…`·`agent-ad88cbd…`(머지됨) | Bae 수동(경로 길이 초과·자동모드 차단) |
| D-20 KR 팩 | B10 파일럿 실측 뒤 항목 확정 → 데이터 파일 + 감지 규칙. **한국 증거 전 확장 금지** | C4 뒤 |

## 3. 게이트와 승인 문구 (T2-P)
| 시점 | 문구 |
|---|---|
| Train B 착수 | `train B start approved` (D-19 인용: "독립 심사관 + 지시서 표준. T1 빌드는 초보자용 수단") |
| 각 PR 머지 | `PR #N merge approved.` |
| 배포 | `deploy central-plane approved.` / `deploy dashboard approved.` |
| 마이그레이션 | `migration <id> apply approved.` (B5 `build_jobs`, B2 프로젝트 D1 레지스트리) |
| 파일럿 | `pilot start approved.` (B10) |
| Bae 결정(트레인 중) | B2 호스팅 도메인 · WfP 요금 승인(과금 — 표준 문구 없음, 건별) · Email Routing 존 `conclave-ai.dev` 사용 확인 |

## 4. 측정 (증거 규칙)
- 모든 스테이지 완료 보고는 세 칸(라이브확인/테스트만/미측정). 장비: `dev-spec-probe.mjs`(T0·AC), `journey-audit.mjs`(여정·초보자 기준), `anonymous-smoke.mjs`(입구), B에서 신설 `build-probe.mjs`(고의 결함 코드 → failed(building) 확인).
- **새 장비 첫 실행은 응답 모양 확인용**(2026-09-24 교훈: 201/`check.id`/`check.report` 세 번 헛돌음).
- 파일럿 정답지는 실행 전에 기록한다(정답지 선기록 규율).

## 5. 일정 요약
| 주 | 내용 |
|---|---|
| 9/24~9/27 | 4-b·5 인프라 연결 · B 착수 승인 · B1∥B2 |
| 9/28~10/4 | B3·B4·B5 |
| 10/5~10/11 | B6∥B7 · C1·C2 병렬 |
| 10/12~10/18 | B8∥B9 · C3 |
| 10/19~10/25 | B10 파일럿(정답지 선기록) · B11 · C4 · N7 랜딩 집행 |
| 10/26~11/2 | 파일럿 실측 정리 · D-20 KR 팩 착수 · (Y 재개 여부 Bae) |

추정치는 단독 에이전트 기준이며, 외부 대기(WfP 요금·도메인·토큰 권한)는 포함하지 않았다.
