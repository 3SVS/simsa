# Simsa — 오픈 체크리스트

> 베타 오픈(공개 유입 시작) **직전에** 순서대로 확인. 위에서부터.
> 원칙: main 머지 ≠ 라이브. 배포해야 라이브. 데이터 캡처는 배포 후부터.

---

## 1. ★ 오픈 전 배포 필수 (가장 먼저, 절대 빠뜨리지 말 것)

**main은 코드 완성이어도 배포 안 하면 프로덕션은 구코드다.** 데이터 골격(P1 envelope·built_with·topic_tags·outcome poll)은 전부 main에 있지만, **배포 전에는 옵트인해도 캡처 0**이다. 오픈 = 유저 유입 = 이 순간부터 소급 불가 데이터가 쌓여야 하므로, 배포를 오픈 직전 한 번에 몰아서 하되 **라이브 스모크까지** 검증한다.

배포 배치(순서대로, 하나라도 빠지면 미완):

- [ ] **인증 3액션 (Bae 수동 — central-plane 배포 전에)**
  1. GitHub **로그인용 OAuth 앱** 등록 (기존 WORKSPACE_GH 앱과 별개!) — callback `https://app.trysimsa.com/api/auth/callback/github`
  2. `gh workflow run set-worker-secrets`로 `AUTH_GH_CLIENT_ID` / `AUTH_GH_CLIENT_SECRET` / `BETTER_AUTH_SECRET` 주입 (로컬 wrangler secret put 금지 — Containers staged-version 사고)
  3. wrangler.toml [vars]에 `BETTER_AUTH_BASE_URL=https://app.trysimsa.com` + `AUTH_ENABLED=true` 확인
- [ ] **central-plane (Worker + D1 migrations)** — `gh workflow run deploy-central-plane -f confirm=deploy -f apply-migrations=true`
  - migrations 0054~0057(training_consent / built_with·entry_path / topic·acquisition / review_run training_r2_key) + 흐름재구성 트랙 migration까지 프로덕션 D1 적용
  - 스모크: `/healthz` ok · `/baselines` 401(인증 게이트) · `/workspace/training-consent` 200 · `/api/auth/get-session` 200
- [ ] **dashboard (Vercel)** — `cd <repo root> && git pull && vercel deploy --prod --yes --archive=tgz` (project conclave-dashboard → app.trysimsa.com)
- [ ] **simsa-landing (Vercel)** — trysimsa.com (오픈 베타 초대 톤 반영분)
- [ ] **landing (Vercel)** — project `conclave-ai`(→ www.conclave-ai.dev), root apps/landing, `--archive=tgz` (변경 시에만)
- [ ] **npm 재릴리스** (필요 시) — CLI/코어 변경분: `gh workflow run release -f bump=patch`
- [ ] **라이브 스모크 4종 (진짜 마지막 게이트 — 전부 눈으로)**
  1. 익명 프로젝트 생성 → 검수 실행 → 결과 표시 (로그인 없이 끝까지)
  2. 결과 화면에서 로그인 승격 배너 → GitHub 로그인 → **claim 실작동** (프로젝트가 workspace에 연결됐는지 D1로 확인)
  3. 옵트인 계정으로 리뷰 1건 → R2 `events/{region}/...`에 envelope(`built_with`·`entry_path`·`region` 태그 포함) 실축적 확인
  4. 남용상한 실작동 — `BETA_PROJECT_CREATE_DAILY_LIMIT=2`처럼 낮춰 스테이징성 확인하거나, 검수 429 응답(`scope:"beta_daily"`)을 curl로 확인 후 원복

> 배포는 되돌리기 어렵다. 각 배포는 **그 커밋이 원격 CI green**인 상태에서만. (참고: 되돌리기 어려운 PR 원격-CI-게이트 원칙)

---

## 2. 오픈 필수 운영 (배포 전 코드 준비 완료돼야)

- [x] **남용 상한 (beta_limits, PR B 구현됨)** — 검수 100/day + 프로젝트 생성 20/day (유저별, UTC 기준, 재저장 비카운트). **임시 방어선** — 오픈 후 cost_meta 실측으로 재조정. env로 무배포 조정 가능: `BETA_REVIEW_DAILY_LIMIT` / `BETA_PROJECT_CREATE_DAILY_LIMIT`.
- [x] **랜딩 "베타 무료" 프레이밍 + 온보딩 "학습 옵트인 = 무료"** (PR B 구현됨) — simsa-landing(trysimsa.com) 오픈 베타 초대 톤(early-access 게이트 제거), 동의 카드에 "무료 베타는 이 참여로 운영" 문구. ※ apps/landing(conclave-ai.dev)은 GHM 유료 판매 라이브라 미변경.
- [ ] 마켓플레이스 리스팅 URL 공개 확인(현재 App 페이지로 연결 중) — 공개되면 CTA 교체.

---

## 3. 오픈 후 (P2, 소급 가능 — 지금 안 함)

- [ ] D1 event_index + 집계 뷰/대시보드 (R2 원유에서 재구축)
- [ ] 자연어 PII 스크럽 → idea/spec 원문 캡처 활성화 (지금은 metadata_only)
- [ ] GitHub webhook merge/reject → outcome 자동 수집 (지금은 재검수 기반 resolved/unresolved만)
- [ ] journey 이벤트 파이프라인 확장
- [ ] 레벨업 · MCP 채널 · 데이터 판매 기능 (웹 데이터·신뢰 성숙 후)

---

## 4. 확정된 전략 (참고)

- 오픈 = **작게 공개**(반응 + 데이터 균형). 결제 dry-run은 블로커 아님(베타 무료).
- **BYO 영구 무료** / 관리형 베타 무료(= 리뷰당 ~1센트로 프런티어 라벨 매입).
- 데이터 경계: **패턴은 팔되 사람은 팔지 마라** — 집계·익명만, `subject_hash`로 역추적 불가, 동의 문구에 명시됨.
