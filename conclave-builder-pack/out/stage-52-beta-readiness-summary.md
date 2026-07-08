> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 52 — 베타 준비 상태 요약 (Beta Readiness)

Conclave PR review workflow(Stage 33~49)를 베타 사용자 테스트에 넣기 위한 준비 상태 한 장 요약.

기준 커밋: `036518f` (main). 작성: 2026-06-14.

---

## ✅ 무엇이 준비됐는지

- **central-plane production 라이브**: `/healthz` 200, Stage 33~49 엔드포인트 전부 배선·정상 검증·500 없음 (Stage 51 backend E2E probe).
- **결정적 로직 검증**: 비교 분류/상태 전환, comment body 전환, 선택 영속화, 공유 선택 — 전체 `node --test` **3456 green**.
- **production safety OFF**: `ENABLE_ACTUAL_CREDIT_DEBITS=false`, `ENABLE_CREDIT_BLOCKING=false`, `ACTUAL_DEBIT_ALLOWED_USER_KEYS=""` (코드 기본값도 safe).
- **dashboard 빌드 가능**: `next build` 8/8 pages, 5개 release route 컴파일.
- **CI/배포 안정**: ci Node 20·22 green, deploy-central-plane 자동.
- **베타 운영 문서 패키지**(이번 Stage):
  - `stage-52-bae-manual-ui-qa-pack.md` — Bae 수동 브라우저 QA(A~L 체크박스).
  - `stage-52-beta-user-test-scenario.md` — 베타 사용자 6과제 시나리오.
  - `stage-52-feedback-template.md` — 피드백 수집 템플릿(KR).
  - `stage-52-issue-triage-criteria.md` — P0~P3 / 카테고리 분류 기준.
  - (제품) `release-note-v0.14-pr-review-workflow.md`, (운영) `stage-50-release-checkpoint.md`.

## ⏳ 아직 수동 확인이 필요한 것

- **라이브 dashboard 브라우저 E2E** — OAuth, 화면 클릭, 실제 GitHub comment post, in-browser 영속화 육안. → Bae가 `stage-52-bae-manual-ui-qa-pack.md`로 1회 실행.
- ✅ **라이브 dashboard URL 확정** = **`https://conclave-dashboard.vercel.app`** (Stage 53에서 Vercel 프로젝트 `conclave-dashboard` 생성·배포, exact origin을 CORS+OAuth allowlist에 추가). 이제 수동 QA 실행 가능.
- (선택) git auto-deploy 연결은 Bae UI에서(현재는 `vercel deploy --prod` 수동).

## 🚦 베타 테스트 시작 조건

1. Bae 수동 QA(A~L)에서 **P0 없음** 확인.
2. live dashboard URL 확정 + route 200 로드.
3. `/healthz` 200 + safety flags OFF 재확인.
4. 데모 repo/PR(`3SVS/My-first-product` PR#1) 또는 테스터 본인 public PR 준비.

→ 위 4개 충족 시 베타 진입.

## 🚫 베타 테스트 중 하지 말아야 할 것

- actual debit / credit blocking **활성화 금지**(계속 OFF).
- private repo로 테스트 유도 금지(public만).
- 새 기능/endpoint/DB 변경 금지(베타는 현 상태 검증이 목적).
- autofix/patch/commit/branch/status check 금지.
- payment provider 연동 금지.

## ➡️ 테스트 후 다음 결정지

- **P0/P1 발견** → 다음 스테이지에서 최소 수정 후 재테스트.
- **P2/P3** → known issue + 카피/UX 백로그.
- **막힘 없음** → 다음 기능 후보 결정:
  - Policy B: `?fromRunId`-only 비교도 PR comment에 포함(backend `comparisonSourceRunId`).
  - selectedItemIds **서버 저장**(cross-device 복원).
  - 또는 사용자 수 확대 / onboarding 개선.

---

## 한 줄 상태

> backend·로직·안전성·빌드는 라이브 검증 완료. **남은 건 Bae의 브라우저 수동 QA 1회 + 라이브 URL 확정**이며, 그 후 베타 진입 가능.
