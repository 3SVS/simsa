> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 50 — Release Checkpoint (PR Review Workflow, Stage 33~49)

새 기능 추가 없이 Stage 33~49를 하나의 release checkpoint로 안정화. 라이브 smoke, 수동 QA, 운영 확인, known issues 정리.

기준 커밋: Stage 49 `45beaa0` (main). 검증 시각: 2026-06-14.

---

## 1. Release scope

PR 코드 확인의 **history → run detail → 선택 영속화 → 남은 문제 다시 확인 → 자동 비교 → 남은 문제 Fix Pack → 비교 결과 PR comment** 전 흐름.

### Included stages

| Stage | 내용 | 커밋 |
|------|------|------|
| 33 | Credit top-up 요청 테이블/엔드포인트 | bdf049e |
| 34 | PR review run history 엔드포인트 + 타임라인 | 6fe44c2 |
| 35 | run detail 엔드포인트 + 상세 페이지 | b3ee1e3 |
| 36 | run-specific Fix Pack & comment 패널 | 6045e45 |
| 37 | run-specific 재확인 + 비교 | b8c50bb |
| 38 | rerun lineage DB + PR comment 비교 | 2e4b59b |
| 38.1 | 테스트 2건 수정 → 3364 green | 732d921 |
| 39 | GitHub Actions Node 24 + deploy/CI hardening | 4d83710 |
| 40 | 다시 확인할 항목 선택 UX (+Node20 .mjs fix) | f7d1b9f, 58c99fe |
| 41 | history list 빠른 "남은 문제 다시 확인" | 90026f5 |
| 42 | history list "남은 문제 Fix Pack" → ?action=fix-pack | bcd30c1 |
| 43 | run detail 공유 selectedItemIds | a9ad424 |
| 44 | selectedItemIds localStorage 영속화 | 15f78ad |
| 45 | ?fromRunId 비교 자동 표시 | 9960472 |
| 46 | 비교 결과 PR comment shortcut (Policy A) | 9aa6544 |
| 47 | progress-emit flaky 테스트 안정화 | 0e217b3 |
| 48 | AutoComparisonPanel 상태 전환 표시 | 22445dc |
| 49 | PR comment 비교 섹션 상태 전환 표시 | 45beaa0 |

### 주요 기능

- PR 확인 기록 목록/상세, run별 결과·요약.
- 선택 항목을 (project, run)별 localStorage에 복원(stored []는 의도적 빈 선택).
- 남은 문제(안 맞음/확인 부족/결정 필요)만 빠른 재확인(history list 1-click, detail picker 편집).
- `?fromRunId`/rerun lineage 기반 source↔current 자동 비교(이전→현재 전환 표시).
- 남은 문제 중심 Fix Pack(Claude/Codex 수정 지시서) 생성·복사.
- lineage run에서 비교 결과를 PR comment로(상태 전환 + 다음 조치 포함).

---

## 2. central-plane live status

- URL: `https://conclave-ai.seunghunbae.workers.dev`
- `/healthz` → **200** (`version 0.13.15`, `environment production`, `db up`). (버전 문자열은 스테이지별로 bump하지 않음 — 코드는 `45beaa0` 배포본.)
- 배포: `apps/central-plane/**` push → `deploy-central-plane.yml` 자동 (로컬 `pnpm ship`은 Containers Docker 요구 → 금지).
- D1 migrations 0036~0039 적용 완료.

### central-plane live smoke (2026-06-14)

| 엔드포인트 | 상태 | 의미 |
|-----------|------|------|
| `GET /healthz` | 200 | alive, db up |
| `GET .../github/review-history` | 200 | history list (Stage 34/41) |
| `GET .../github/review/runs/:id` | 404 | run-not-found(정상, 라우트 배선됨, Stage 35) |
| `POST .../pulls/:n/fix-brief` | 400 | params 필요(배선됨, Stage 12/36/42) |
| `POST .../pulls/:n/comment/preview` | 400 | params 필요(배선됨, Stage 13/38/46/49) |
| `GET /admin/credits/rollout-checklist` | 401 | admin key 필요(배선됨, Stage 29/32) |
| `GET /admin/usage-stats` | 401 | admin key 필요(배선됨, Stage 18) |

> 404/400/401은 라우트 미존재가 아니라 인증/파라미터 가드 — 모두 배선 확인.

---

## 3. dashboard live verification checklist

라이브 Vercel 최종 확인은 **Bae의 Vercel 자격증명 필요**(이 세션에서 직접 불가). 대신 `next build`로 배포 가능성 확인(아래 §8). Bae 확인 절차:

1. Vercel dashboard → dashboard 프로젝트 → Deployments에서 production이 `45beaa0` 이후 커밋인지.
2. Settings → Environment Variables에서 `NEXT_PUBLIC_CENTRAL_PLANE_URL` (미설정이면 코드 fallback이 production worker → 정상).
3. 아래 route 접근:
   - `/admin/credits`, `/admin/usage`
   - `/projects/:id/github`
   - `/projects/:id/github/history`
   - `/projects/:id/github/history/:runId`
4. run detail에서 선택 영속화 / 다시 확인 / Fix Pack / 자동 비교(전환 pill) / 비교 comment shortcut 동작 확인.

> ConnectionRefused 시: ① `/healthz` 200 확인 ② `NEXT_PUBLIC_CENTRAL_PLANE_URL` 확인 ③ redeploy(`NEXT_PUBLIC_*`는 빌드타임 인라인).

---

## 4. manual QA checklist

→ 같은 폴더 `stage-50-release-checkpoint.md`의 본 섹션 + 제품 릴리즈 노트(`release-note-v0.14-pr-review-workflow.md`) 참조. 항목 A~J는 아래 §"Manual QA" 표.

### Manual QA (A~J)

각 항목: 목적 / 사전 조건 / 단계 / 기대 / 실패 시 확인.

- **A. PR review history**
  - 목적: 프로젝트의 모든 PR 확인 이력이 최신순으로 보임.
  - 사전: GitHub 연결 + 1회 이상 PR 확인 실행.
  - 단계: `/projects/:id/github/history` 진입.
  - 기대: run 카드(상태/요약/시간), "남은 문제 다시 확인"·"남은 문제 Fix Pack" 버튼.
  - 실패 시: `review-history` 200·`userKey`·console fetch 오류 확인.

- **B. run detail**
  - 목적: 특정 run의 항목별 결과 표시.
  - 사전: history에 run 존재.
  - 단계: run 카드 → 상세.
  - 기대: 요약 카드, 항목별 결과, 선택 패널/재확인/Fix Pack/comment 패널.
  - 실패 시: `review/runs/:id` 응답·runId 매칭 확인.

- **C. selected item persistence**
  - 목적: 선택 항목이 같은 run 재진입 시 복원.
  - 사전: run detail 진입.
  - 단계: 항목 선택 변경 → 새로고침/재진입.
  - 기대: "이전에 고른 항목을 불러왔어요" + 직전 선택 복원. "모두 해제"한 빈 선택도 복원.
  - 실패 시: localStorage 키 `conclave:review-selection:v1:<proj>:<run>`, private mode 여부.

- **D. 남은 문제 quick re-run**
  - 목적: 남은 문제만 빠르게 재확인.
  - 사전: 남은 문제(비통과) 있는 run.
  - 단계: history "남은 문제 다시 확인" 클릭.
  - 기대: 새 run 생성 → 새 detail로 자동 이동(`?fromRunId`).
  - 실패 시: 402/credit 경고(현재 OFF라 비차단), startPRReview 응답.

- **E. fromRunId 자동 비교**
  - 목적: 새 run detail에서 source↔current 비교 자동 표시.
  - 사전: quick re-run으로 진입(또는 lineage 있는 run).
  - 단계: 새 run detail 로드.
  - 기대: "이전 확인 기록과 비교" 패널, 항목별 "이전 → 현재" pill, 4그룹.
  - 실패 시: source run fetch/PR 일치/결과 비어있음 → 안내(non-blocking).

- **F. 남은 문제 Fix Pack**
  - 목적: 남은 문제 기준 수정 지시서 생성.
  - 사전: 남은 문제 있는 run.
  - 단계: history "남은 문제 Fix Pack" → detail `?action=fix-pack` 자동 생성, 또는 detail에서 "선택한 항목으로 Fix Pack 만들기".
  - 기대: 출처 안내 + "남은 문제 N개로 Fix Pack을 만들었어요" + 파일 preview/복사.
  - 실패 시: fix-brief 응답, 선택 0개면 disabled.

- **G. comparison-aware PR comment**
  - 목적: 비교 결과를 PR comment로.
  - 사전: lineage(다시 확인으로 생성된) run + GitHub comment 권한.
  - 단계: 자동 비교 패널 "이 비교 결과를 PR comment로 남기기" → preview → GitHub에 남기기.
  - 기대: comment body의 "다시 확인 결과 비교"에 상태 전환 + 다음 조치. lineage 없으면 안내만.
  - 실패 시: scope/권한, includeRerunComparison 동작.

- **H. Telegram notification 영향 없음**
  - 목적: 알림 기능 회귀 없음.
  - 단계: 기존 알림 설정/테스트 페이지 확인.
  - 기대: 변경 없음(이번 릴리즈 미수정).
  - 실패 시: 알림 설정 엔드포인트.

- **I. credit/debit OFF 확인**
  - 목적: 실제 차감/차단 비활성.
  - 단계: 재확인/Fix Pack/comment 실행이 credit으로 차단되지 않음.
  - 기대: 비차단(dry-run 배너만 가능).
  - 실패 시: wrangler flags(§6).

- **J. admin credits/usage page**
  - 목적: 운영 페이지 정상.
  - 사전: admin key.
  - 단계: `/admin/credits`, `/admin/usage`.
  - 기대: config/rollout/usage 표시.
  - 실패 시: ADMIN_* key, 엔드포인트 401.

---

## 5. live smoke checklist (요약)

central-plane: §2 표 — 전부 배선/200. dashboard: §3 route + `next build`(§8).

---

## 6. production safety flags

`apps/central-plane/wrangler.toml` (배포된 값):
```
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""
```
코드 기본값(`credit-config.ts`): `actualDebitsEnabled: env.ENABLE_ACTUAL_CREDIT_DEBITS === "true"` → 미설정/`"false"` → **false**. blocking도 `=== "true"`만 활성. **production actual debit OFF 확인.**

---

## 7. known issues / deferred decisions

- 라이브 Vercel 최종 확인은 **Bae 자격증명 필요**.
- **fromRunId-only 비교는 PR comment에 포함 불가**(backend가 source 모름, Policy A) — Policy B(comparisonSourceRunId)는 신규 backend scope.
- selectedItemIds 영속화는 **client-side only**(cross-device 복원 안 됨).
- CommentPanel 내부 선택 UI는 추가 강화 여지(Stage 43 이월).
- **actual debit OFF 유지.**
- private repo 지원 안 함.
- autofix/patch/commit/branch 생성 없음.
- `release.yml` node-version "20" 런타임 EOL(2026 하반기) — "22" 승격 여부 미결(Stage 39 이월).
- 타이머/race 의존 테스트 전수 audit 미수행(선택, Stage 47 이월).

---

## 8. test/typecheck/build (release gate)

| 검사 | 결과 |
|------|------|
| 전체 `node --test` | **3456 / 3456 pass**, fail 0 |
| `pnpm typecheck` | 53/53 |
| `pnpm build` | 29/29 |
| dashboard `next build` | ✓ 8/8 pages, 5개 release route 컴파일 |
| ci Node 20·22 | 최근 main(45beaa0) success |
| deploy-central-plane | 45beaa0 success, healthz 200 |

---

## 9. rollback notes

- dashboard 회귀 시: Vercel에서 직전 정상 배포로 **Instant Rollback**(Stage별 대부분 dashboard 전용이라 안전).
- central-plane 회귀 시: 직전 정상 커밋으로 revert 후 main push → `deploy-central-plane.yml` 재배포. D1 migration 0036~0039는 forward-only/additive(컬럼 추가)라 rollback 시 데이터 손실 없음(스키마는 그대로 둬도 무해).
- safety flags는 코드/wrangler 양쪽 OFF가 기본 — 잘못된 활성화는 wrangler.toml 되돌림 + Actions 재배포.

---

## 10. recommended next stage

1. (Bae) 라이브 Vercel 최종 확인 + 실제 PR로 end-to-end 1회.
2. Stage 51 후보: fromRunId-only 비교 comment(Policy B) 또는 selectedItemIds 서버 저장(cross-device) — 둘 다 backend scope, 별도 결정.
3. 또는 실제 사용자 테스트(베타) 진입.

새 버전 태그는 release 프로세스(`.github/workflows/release.yml`, lockstep)가 별도라 **이번 단계에서 만들지 않음**.
