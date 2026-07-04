# Simsa — 오픈 체크리스트

> 베타 오픈(공개 유입 시작) **직전에** 순서대로 확인. 위에서부터.
> 원칙: main 머지 ≠ 라이브. 배포해야 라이브. 데이터 캡처는 배포 후부터.

---

## 1. ★ 오픈 전 배포 필수 (가장 먼저, 절대 빠뜨리지 말 것)

**main은 코드 완성이어도 배포 안 하면 프로덕션은 구코드다.** 데이터 골격(P1 envelope·built_with·topic_tags·outcome poll)은 전부 main에 있지만, **배포 전에는 옵트인해도 캡처 0**이다. 오픈 = 유저 유입 = 이 순간부터 소급 불가 데이터가 쌓여야 하므로, 배포를 오픈 직전 한 번에 몰아서 하되 **라이브 스모크까지** 검증한다.

배포 배치(순서대로, 하나라도 빠지면 미완):

- [ ] **central-plane (Worker + D1 migrations)** — `gh workflow run deploy-central-plane -f confirm=deploy -f apply-migrations=true`
  - migrations 0054~0057(training_consent / built_with·entry_path / topic·acquisition / review_run training_r2_key) + 흐름재구성 트랙 migration까지 프로덕션 D1 적용
  - 스모크: `/healthz` ok · `/baselines` 401(인증 게이트) · `/workspace/training-consent` 200
- [ ] **dashboard (Vercel)** — `cd <repo root> && git pull && vercel deploy --prod --yes --archive=tgz` (project conclave-dashboard → app.trysimsa.com)
- [ ] **landing (Vercel)** — project `conclave-ai`(→ www.conclave-ai.dev), root apps/landing, `--archive=tgz`
- [ ] **npm 재릴리스** (필요 시) — CLI/코어 변경분: `gh workflow run release -f bump=patch`
- [ ] **라이브 검증(눈으로)**: 실제 리뷰 1건 돌려 R2 `events/{region}/...`에 레코드가 쓰였는지(옵트인 계정으로) + envelope 태그 존재 확인

> 배포는 되돌리기 어렵다. 각 배포는 **그 커밋이 원격 CI green**인 상태에서만. (참고: 되돌리기 어려운 PR 원격-CI-게이트 원칙)

---

## 2. 오픈 필수 운영 (배포 전 코드 준비 완료돼야)

- [ ] **남용 상한** (무료 관리형 비용 방어) — 유저당 하루 20회(결정됨). 아직 미착수(PR B). 오픈 전 구현 + 배포.
- [ ] **랜딩 "베타 무료" 프레이밍 + 온보딩 "학습 옵트인 = 무료"** — A(소프트 프레이밍) 확정. 미착수.
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
