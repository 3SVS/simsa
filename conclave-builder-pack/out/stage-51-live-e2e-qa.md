> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 51 — Live End-to-End QA (PR Review Workflow)

QA/validation 단계. 새 기능 없음. Stage 33~49 흐름을 라이브에서 검증.

기준 커밋: `6527392` (Stage 50 checkpoint, main). 검증 시각: 2026-06-14.

---

## ⚠️ 검증 범위와 한계 (정직한 고지)

이 세션의 에이전트는 **브라우저나 Bae의 Vercel 자격증명에 접근할 수 없습니다.** 따라서:

- **검증 가능(에이전트 수행)**: central-plane production worker의 라이브 API 계약(E2E backend 절반), 결정적 로직(비교/comment body/선택)의 정확성(테스트), production safety flags, dashboard 빌드 가능성.
- **BLOCKED — Bae 필요**: 라이브 dashboard UI 클릭(OAuth, 버튼, 화면 표시), GitHub에 실제 comment post, 브라우저 localStorage 영속화 육안 확인.

브라우저 테스트 결과를 지어내지 않았습니다. 아래는 **에이전트가 실제로 확인한 것**과 **Bae가 실행할 수동 스크립트**로 나눕니다.

---

## 0. 테스트 환경

- central-plane: `https://conclave-ai.seunghunbae.workers.dev` (production, `45beaa0` 배포본)
- dashboard live URL: ✅ **`https://conclave-dashboard.vercel.app`** (Stage 53 배포 완료, CORS+OAuth allowlist 반영). 코드 fallback은 위 worker.
- 데모 repo/PR: `https://github.com/3SVS/My-first-product` (public), PR #1 (10-bug seed)

---

## A) 에이전트가 검증한 것 — central-plane 라이브 backend E2E

dashboard가 보내는 **실제 request shape**로 production을 probe (404=route 미존재가 아니라 인증/리소스 가드).

| E2E 단계 | 요청 | 응답 | 판정 |
|---------|------|------|------|
| /healthz | GET | `200 {ok, db:up, production}` | PASS |
| D. history list | GET `.../github/review-history?userKey=` | `200 {ok, runs:[]}` | PASS (배선·shape) |
| C/H. PR 확인/재확인 | POST `.../github/pulls/1/review` (`rerunOfReviewRunId`+`selectedItemIds`) | `400 no_repo_linked` | PASS (배선·검증, fake project라 repo 없음) |
| E/I. run detail | GET `.../github/review/runs/:id` | `404 run_not_found` | PASS (배선·검증) |
| G. Fix Pack | POST `.../pulls/1/fix-brief` (`reviewRunId`+`selectedItemIds`) | `400 no_repo_linked` | PASS (배선·검증) |
| J. comment preview | POST `.../pulls/1/comment/preview` (`includeRerunComparison:true`+`reviewRunId`) | `400 no_repo_linked` | PASS (배선, includeRerunComparison 수용) |
| admin credits | GET `/admin/credits/rollout-checklist` | `401` | PASS (admin key 가드) |
| admin usage | GET `/admin/usage-stats` | `401` | PASS (admin key 가드) |

- 모든 라우트 배선·정상 검증·**500 없음**. 검증 체인이 repo 조회까지 정상 도달(`no_repo_linked`).
- 참고: review 엔드포인트는 `/github/pulls/:number/review` 경로(초기 probe에서 `/github/review`로 잘못 쳐 404 → 정정 후 400 확인).

## B) 에이전트가 검증한 것 — 결정적 로직(테스트)

E2E 단계 E/I/J의 결과를 만드는 backend/dashboard 순수 로직은 테스트로 검증됨(전체 3456 green):
- 비교 분류(좋아진/아직 남은/새로 생긴 문제/변화 없음) + 상태 전환(`안 맞음 → 통과`) — Stage 45/48/49 테스트.
- comment body의 "다시 확인 결과 비교" 섹션 전환·다음 조치 — Stage 49 `buildCommentBody` 테스트.
- 선택 영속화(stored []≠null, stale 제거) — Stage 44 테스트.
- 공유 선택/toggle — Stage 43 테스트.

## C) 에이전트가 검증한 것 — production safety (L)

`wrangler.toml`(배포됨): `ENABLE_ACTUAL_CREDIT_DEBITS="false"`, `ENABLE_CREDIT_BLOCKING="false"`, `ACTUAL_DEBIT_ALLOWED_USER_KEYS=""`. 코드 기본값도 `=== "true"`만 활성 → **actual debit/blocking OFF 확인**. dry-run/allowance banner만 표시되는 설계.

## D) 에이전트가 검증한 것 — dashboard 빌드 가능성 (A/D/E 렌더)

`next build`: 8/8 pages, release 대상 5개 route(`/admin/credits`, `/admin/usage`, `/projects/[id]/github`, `.../history`, `.../history/[runId]`) 전부 컴파일. (라이브 렌더 육안 확인은 §F Bae 스크립트.)

---

## E) 발견 이슈

| 분류 | 항목 | 처리 |
|------|------|------|
| (없음) P0/P1 | backend 계약에서 흐름 차단/액션 실패 없음 | — |
| 프로세스 한계 | 브라우저 UI E2E를 에이전트가 직접 못 함 | BLOCKED → §F Bae 스크립트로 위임 |
| P3 | 라이브 dashboard URL이 레포에 미기록 | known issue, Bae 확인 |

**코드 수정 없음** (P0/P1 미발견). 새 기능/endpoint/DB 변경 없음.

---

## F) Bae 실행용 수동 QA 스크립트 (브라우저 필요)

> 사전: 라이브 dashboard URL(`$DASH`), GitHub OAuth 가능 계정, `3SVS/My-first-product` 같은 public repo + PR.

**라이브 route 로드 확인(터미널, URL만 있으면 에이전트도 가능)**:
```bash
for r in /admin/credits /admin/usage; do
  curl -sS -o /dev/null -w "$r → %{http_code}\n" "$DASH$r"
done
# 200이면 OK, 404면 배포 commit/route 확인
```

**A. Dashboard 배포**: 위 route + `/projects/<id>/github`, `.../history`, `.../history/<runId>` 접속 → 404/ConnectionRefused 없음. (실패: Vercel production commit이 `6527392` 이후인지, `NEXT_PUBLIC_CENTRAL_PLANE_URL`, redeploy, worker `/healthz` 200.)
**B. GitHub 연결**: 연결 상태 표시 + repo list 로드 + project-repo 연결 확인.
**C. PR 확인 실행**: `/projects/<id>/github` → public repo → PR 목록 → PR link → review 실행 → run 생성, dry-run/allowance banner만(actual debit 없음).
**D. History**: `.../history` → 최신순 run, summary, "남은 문제 다시 확인"·"남은 문제 Fix Pack" 버튼. passed-only run은 disabled, 비통과 있는 run은 enabled.
**E. Run detail**: `.../history/<runId>` → summary, "이번에 다룰 항목" picker, 기본 선택=비통과(통과 미선택), 변경 가능.
**F. 선택 영속화**: 선택 변경 → 새로고침 → 재진입 → "이전에 고른 항목을 불러왔어요." + 직전 선택 복원(빈 선택 []도 유지).
**G. Fix Pack**: history "남은 문제 Fix Pack" → `.../history/<runId>?action=fix-pack` 자동 진입 → autoOpen/autoGenerate → 출처 안내 + "남은 문제 N개로 Fix Pack을 만들었어요" + 복사/ZIP.
**H. Quick re-run**: history "남은 문제 다시 확인" → 새 run detail 자동 이동, URL `?fromRunId=<oldRunId>` 포함, 새 run 생성.
**I. 자동 비교**: 새 run detail에 "이전 확인 기록과 비교" 패널 자동 표시 + 전환(`안 맞음 → 통과` 등) + 4그룹. (실패: fromRunId/lineage/source fetch/same-PR.)
**J. 비교 PR comment**: 비교 패널 "이 비교 결과를 PR comment로 남기기" → CommentPanel preview 자동 생성 → "GitHub에 남기기". body의 "## 다시 확인 결과 비교"에 요약 + 전환 라벨 포함. (lineage 없는 run은 안내만.)
**K. Telegram**: 알림 설정대로 동작 + 실패 non-fatal + history와 충돌 없음.
**L. Credit/debit**: 위 흐름이 차단/차감되지 않음(banner만).

각 단계 실패 시 분류: **P0**(진행 불가)/**P1**(핵심 가능, 주요 액션 실패)/**P2**(문구/UI)/**P3**(문서). P0/P1만 다음 스테이지에서 최소 수정.

---

## G) production safety 재확인

actual debit OFF / blocking OFF / allowlist 빈값 — §C. 변경 없음.

---

## H) test/typecheck/build

코드 변경 없음(QA 단계). 동일 트리(`6527392`) 재실행:

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | 3456 / 3456 pass (Stage 50 동일 트리) |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | 8/8 pages |
| central-plane 라이브 | healthz 200, E2E backend 계약 PASS |

---

## I) 남은 known issues

- 라이브 dashboard URL 미기록 → Bae 제공 필요.
- 브라우저 UI E2E(§F)는 Bae 수동 실행 대기.
- fromRunId-only 비교는 PR comment 불가(Policy A; Policy B 미구현).
- 선택 영속화 client-side only(cross-device 안 됨).
- actual debit OFF 유지, private repo 없음, autofix/patch/commit 없음.
- release.yml node "20" EOL 미결, 타이머 테스트 audit 선택.

---

## J) 다음 단계 추천

1. **Bae가 §F 수동 스크립트 1회 실행** + 라이브 dashboard URL 공유 → 발견 P0/P1을 Stage 52에서 최소 수정.
2. 또는 베타 사용자 테스트 진입.
3. Stage 52 후보(backend scope, 택1): Policy B(fromRunId-only 비교 comment) / selectedItemIds 서버 저장.
