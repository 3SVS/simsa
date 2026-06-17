# Stage 55 — Live-data E2E QA (PR review workflow)

실제 userKey/projectId/repo/PR로 라이브 dashboard backend를 통해 PR 확인 → history → Fix Pack → quick re-run → 자동 비교 → PR comment까지 실데이터로 검증. 에이전트가 라이브 API(브라우저 UI가 호출하는 것과 동일한 호출)로 D~L을 직접 닫음.

- QA 일시: 2026-06-18 (KST)
- dashboard URL: `https://conclave-dashboard.vercel.app`
- backend URL: `https://conclave-ai.seunghunbae.workers.dev`
- projectId: `proj_7w5zhyaw`  (userKey는 의도적으로 미기록 — 브라우저 로컬 식별자)
- repo / PR: `3SVS/My-first-product` PR #1 (`feat: add task comments + sharing`, `demo/all-bugs-template → main`)
- GitHub 연결 계정: `seunghunbae-3svs` (OAuth Authorize는 Bae가 브라우저로 완료)

> 에이전트 도구 한계: 브라우저 자동화 도구가 없어 (A)(B)(C)의 **육안 렌더**와 **OAuth Authorize 클릭**은 Bae가 수행. 그 외 D~L 실데이터 흐름은 에이전트가 라이브 HTTP로 직접 실행.

---

## production safety (먼저 확인)

배포본 `apps/central-plane/wrangler.toml`:
- `ENABLE_ACTUAL_CREDIT_DEBITS = "false"`
- `ENABLE_CREDIT_BLOCKING = "false"`
- `ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""`

실행한 모든 review 응답에서 `actualDebitsEnabled=false, blocked=false, wouldBlock=false` 확인 → **실제 크레딧 차감/차단 없음.**

---

## 통과한 단계 (실데이터)

| 단계 | 결과 |
|------|------|
| repo 연결 | `3SVS/My-first-product` 링크 성공 (공개 org repo, `public_repo` 스코프로 접근) |
| PR #1 연결 | 링크 성공 (selectedItemIds 4개) |
| **PR 확인 실행** | run `wprr_ibf0fylv8t` 생성, status=inconclusive, **passed=2 / failed=0 / inconclusive=2 / needsDecision=0**, actual debit 없음 |
| history list | 최신순 표시, run별 summary + `rerunAction.recommendedItemCount=2`(inconclusive 2개) 정확 |
| run detail | req-comments=passed, req-sharing=passed, req-security=inconclusive, req-errors=inconclusive |
| **Fix Pack** | deterministic, selectedItemIds=[req-security, req-errors], Claude/Codex 지시서 + 7개 파일, sourceReviewRun=원본 run(특정 기록 기준) |
| **quick re-run** | new run `wprr_ibf2dysh36`, `rerunOfReviewRunId`=원본(lineage 정상) |
| **자동 비교** | comparable=True, stillOpen=[req-security, req-errors] (inconclusive→inconclusive, PR 코드 무변경이라 정확), improved/newlyProblematic=0 |
| **PR comment (실 게시)** | PR #1에 실제 comment 게시 — `다시 확인 결과 비교` 섹션 + 상태 전환(→) 포함, 한글 본문 정상 |

**PR comment URL**: https://github.com/3SVS/My-first-product/pull/1#issuecomment-4733114388
(GitHub API로 본문 재검증: 비교 섹션 포함=True, 항목 제목 정상=True, 상태 전환 포함=True.)

선택 영속화(9단계)는 **dashboard localStorage(client-only)** 기능이라 API로는 검증 불가 — 결정적 로직은 `review-selection-storage` 테스트로 커버됨. 육안은 Bae 1회.

---

## P0/P1 이슈 + 수정

### P1 (발견·수정·배포·재검증 완료) — 부분 productSpec → 불투명한 review 크래시
- **증상**: 배열 필드(`excluded`/`openQuestions` 등)가 빠진 productSpec으로 review 실행 시 `review_failed: Cannot read properties of undefined (reading 'some')`.
- **원인**: review route가 `bodySpec as ProductSpecForCheck` / `dbProj.productSpec ?? {} as ...`로 **검증 없이 캐스팅** → 휴리스틱의 `spec.excluded.some(...)`가 undefined 접근. 프로젝트 규칙 "no `as` at the edge / validate at every boundary" 위반.
- **수정**: `workspace/check.ts`에 `normalizeProductSpec` / `normalizeCheckableItems` 추가(모든 배열 필드 기본값 `[]`, 비객체 강제 변환, 비문자열/ id 없는 항목 제거) → review boundary에서 캐스팅 대신 사용. dashboard는 항상 완전한 spec을 보내므로 정상 경로 무변경.
- **범위**: review 경로만. fix-brief(optional 타입, 이미 방어적) · builder-pack export 경로는 무변경.
- **검증**: 6개 신규 테스트, central-plane 942/942. 배포 후 라이브에서 부분 spec → graceful review(`wprr_ibqx03t2o0`) 확인 (이전엔 크래시).

### 수정한 파일 / 커밋
- `apps/central-plane/src/workspace/check.ts`, `apps/central-plane/src/routes/workspace-github.ts`, `apps/central-plane/test/workspace-spec-normalize.test.mjs`
- 커밋 `08b0edc` → deploy-central-plane.yml 자동 배포 성공(build/migrations/deploy/smoke ✓).

---

## 남은 known issues

- **(P2) repo 목록이 본인 소유 repo만 표시**: `/workspace/github/repos`가 연결 계정의 owner repo만 반환(11개, 전부 `seunghunbae-3svs/*`). org repo(`3SVS/My-first-product`)는 목록에 없어 **dashboard UI 피커로는 org/협업 repo 연결 불가**. 이번 QA는 API로 직접 링크(공개 repo + `public_repo` 스코프라 review/comment는 정상). → Stage 56 후보(endpoint에 org/collaborator affiliation 추가 검토).
- **(비이슈, 테스트 하네스 한정)** Windows에서 PYTHONUTF8 없이 Korean을 보내면 cp949로 인코딩돼 항목 제목이 깨짐. 서버 생성 텍스트는 정상. 실제 dashboard(브라우저 UTF-8 fetch)에는 무관. 최종 게시 comment는 UTF-8로 다시 보내 정상.
- 선택 영속화(9)·UI 육안 렌더는 브라우저 필요 → Bae 1회 확인.

---

## test / typecheck / build
- central-plane 테스트 **942/942**(신규 6 포함), typecheck **53/53**, build **29/29**. dashboard 변경 없음.

## Stage 56 전 결정 필요한 점
1. **베타 진입 여부**: 실데이터 한 바퀴(D~L) + 실 PR comment 게시까지 검증됨, production safety OFF, P1 수정 배포. → 베타 사용자 테스트 진입 가능.
2. **(P2) repo 피커 org repo 미표시** 수정 여부 — 베타 사용자가 org repo를 쓸 거면 Stage 56에서 affiliation 확장 고려.
3. (운영) Vercel 토큰 revoke + Git auto-deploy 연결(완료 시 수동 배포 불요).
4. 보류 유지: actual debit 활성화, payment, private repo full support, autofix/patch/commit.
