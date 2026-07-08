> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 39 — Deployment & CI Hardening

목표: 새 제품 기능 추가 없이, Stage 33~38 변경분이 production/deploy 환경에 안전하게 반영됐는지 확인하고 GitHub Actions / dashboard 배포 리스크를 정리한다.

검증 시각: 2026-06-14 · 기준 커밋: `732d921` (Stage 38.1) / `bdf049e` (Stage 33 누락분)

---

## 1. central-plane 배포 상태

- **Worker**: `https://conclave-ai.seunghunbae.workers.dev`
- **`/healthz`**: `200` → `{"ok":true,"service":"conclave-central-plane","version":"0.13.15","environment":"production","db":"up"}`
- 배포 경로: `apps/central-plane/**` push → `deploy-central-plane.yml` Actions 자동 배포 (로컬 `pnpm ship`은 Containers binding의 Docker 요구로 실패 — 항상 main push 사용)

### 적용된 migrations (remote)

| Migration | 내용 | 적용 |
|-----------|------|------|
| 0036 | credit debit idempotency unique index | ✅ |
| 0037 | credit ledger status column | ✅ |
| 0038 | credit top-up requests table | ✅ |
| 0039 | pr_review_runs.rerun_of_review_run_id (Stage 38 lineage) | ✅ |

### Stage 33~38 엔드포인트 라이브 배선 확인

probe 결과 (404가 아니면 배선됨; 401=admin key 필요, 400=userKey/params 필요):

| 엔드포인트 | 상태 | 의미 |
|-----------|------|------|
| `GET /admin/credits/rollout-checklist` | 401 | Stage 29/32 배선됨 |
| `GET /admin/credits/monthly-preview` | 401 | Stage 23 배선됨 |
| `GET /admin/usage-stats` | 401 | Stage 18 배선됨 |
| `POST /workspace/credits/top-up-requests` | 400 | Stage 33 배선됨 |
| `GET /workspace/credits/top-up-requests` | 400 | Stage 33 배선됨 |
| `GET /workspace/credits` | 400 | Stage 20 배선됨 |
| `GET .../github/pulls/:n/review/runs/:id` | 400 | Stage 35 배선됨 |
| `POST .../github/pulls/:n/comment/preview` | 400 | Stage 38 배선됨 |

> 주의: top-up 경로는 `/workspace/credits/top-up-requests` (하이픈+복수형). `/topup-request`가 아님.

---

## 2. dashboard 배포 상태

라이브 Vercel 인스턴스는 Bae의 Vercel 자격증명이 필요해 이 세션에서 직접 접근 불가. 대신 **production build로 배포 가능성을 증명**했다 (Vercel이 실행하는 `next build`와 동일).

`apps/dashboard` `next build` 결과 — Stage 33~38 route 7개 전부 컴파일/매니페스트 등록:

```
○ /admin/credits                         (static)
○ /admin/usage                           (static)
ƒ /projects/[id]/credits                 (dynamic)
ƒ /projects/[id]/github                  (dynamic)
ƒ /projects/[id]/github/history          (dynamic)
ƒ /projects/[id]/github/history/[runId]  (dynamic)
ƒ /projects/[id]/settings                (dynamic)
```

`✓ Compiled successfully` · `✓ Generating static pages (8/8)` · 에러 0.

### 확인한 dashboard routes (기능)

| Route | Stage 33~38 기능 |
|-------|------------------|
| `/admin/credits` | Admin credits config, pending cleanup, rollout checklist UI |
| `/admin/usage` | Admin usage stats |
| `/projects/[id]/credits` | Credit 잔액 / top-up 요청 UI |
| `/projects/[id]/github` | PR 목록 / 리뷰 트리거 |
| `/projects/[id]/github/history` | PR review history list |
| `/projects/[id]/github/history/[runId]` | Run detail + run-specific Fix Pack panel + Comment panel + Re-run panel + rerun lineage badge |
| `/projects/[id]/settings` | repo 연결 설정 |

> 라이브 Vercel 최종 확인은 Bae가 아래 절차로 수행 (자격증명 필요).

---

## 3. NEXT_PUBLIC_CENTRAL_PLANE_URL 확인 방법

dashboard의 모든 API 클라이언트(`apps/dashboard/src/lib/workspace-*-api.ts`)는 동일 패턴 사용:

```ts
const CENTRAL_PLANE_URL =
  process.env.NEXT_PUBLIC_CENTRAL_PLANE_URL ??
  "https://conclave-ai.seunghunbae.workers.dev";
```

- **fallback이 production worker URL**이므로 env 미설정이어도 production에서는 정상 동작.
- repo에 `.env.local` / `.env.production` 커밋 없음 (Rule 3 secret 안전 — 의도된 상태).
- preview/production에서 다른 central-plane을 바라보게 하려면 Vercel 프로젝트 env에 `NEXT_PUBLIC_CENTRAL_PLANE_URL` 설정.

### 라이브 Vercel 확인 절차 (Bae)

1. Vercel dashboard → dashboard 프로젝트 → **Deployments** → 최신 production 배포가 `bdf049e` 이후 커밋인지 확인.
2. **Settings → Environment Variables**에서 `NEXT_PUBLIC_CENTRAL_PLANE_URL` 값 확인 (미설정이면 fallback 사용 — 정상).
3. 라이브 URL에서 위 7개 route 접근 → run detail 페이지의 rerun lineage badge / Re-run panel 표시 확인.

### ConnectionRefused / fetch 실패 troubleshooting

ConnectionRefused 또는 API 호출 실패가 발생하면:

1. **central-plane 서버가 떠 있는지 확인** — `curl https://conclave-ai.seunghunbae.workers.dev/healthz` → `200` + `"ok":true` 기대.
2. **`NEXT_PUBLIC_CENTRAL_PLANE_URL` 확인** — Vercel env 값이 오타/구 URL인지 점검. 미설정이면 코드 fallback이 production worker를 가리키므로 보통 문제 없음.
3. **`/healthz` 확인** — `db:"up"`인지 확인 (D1 연결).
4. **dashboard 재시작 또는 redeploy** — env 변경 후에는 반드시 redeploy (Next.js `NEXT_PUBLIC_*`는 빌드 타임에 인라인됨 → 런타임 변경 미반영).

> 핵심 함정: `NEXT_PUBLIC_*` 변수는 **빌드 시점에 번들에 박힌다**. Vercel env를 바꾸면 redeploy 없이는 반영되지 않는다.

---

## 4. GitHub Actions Node runtime 경고

### 원인

GitHub이 Node 20 런타임 JS 액션을 deprecate (2026-06-16부터 Node 24 강제, 2026 하반기 Node 20 제거). `action.yml`에 `using: node20`을 선언한 액션은 end-of-job deprecation 경고를 발생. 해당 액션:

- `actions/checkout@v4` (node20)
- `actions/setup-node@v4` (node20)
- `pnpm/action-setup@v4` (node20)

이 경고는 `deploy-central-plane.yml`뿐 아니라 **repo의 workflow 7개 전부**에 동일하게 존재 → CLAUDE.md 회귀 전수 검색 규칙에 따라 같은 커밋에서 함께 수정.

### 수정한 workflow / action 버전

| Action | 이전 | 변경 | Node 런타임 |
|--------|------|------|------------|
| `actions/checkout` | v4 | **v5** | node24 |
| `actions/setup-node` | v4 | **v5** | node24 |
| `pnpm/action-setup` | v4 | **v6** | node24 (node24는 v5.0.0부터, 최신 major v6) |

적용 파일 (7개): `ci.yml`, `deploy-central-plane.yml`, `dev-loop.yml`, `merge.yml`, `release.yml`, `review.yml`, `rework.yml`.
(`merge.yml`은 `pnpm/action-setup` 미사용 → checkout/setup-node만.)

### 호환성 / 동작 보존 근거

- 모든 workflow가 `runs-on: ubuntu-latest` (GitHub-hosted) → runner ≥ v2.327.1 요구사항 자동 충족, v5/v6 안전한 drop-in. self-hosted runner 미사용이라 리스크 없음.
- **setup-node@v5 auto-cache 회귀 방지**: v5는 `packageManager` 필드가 있으면 자동 캐싱을 켤 수 있음. 기존에 명시적 `cache:` 입력이 **없던** 5개 블록(dev-loop/merge/release/review/rework)에는 `package-manager-cache: false`를 추가해 무캐싱 동작을 정확히 보존. 명시적 `cache: pnpm`이 있던 2개(ci/deploy-central-plane)는 그대로 둠.
- env/secrets/commands/node-version 일절 변경 없음. `release.yml`의 `node-version: "20"`은 npm publish 런타임 선택이므로 유지 (액션 런타임 경고와 무관).
- 변경은 순수 버전 핀 + 캐시 비활성화 입력뿐 — `git diff`로 검증.

### 동반 수정 (stale 테스트)

`scripts/release/bump-workflow-cli-version.test.mjs`의 LIVE INVARIANT가 `actions/checkout@v4`를 정규식 literal로 박아둬 v5 bump 후 실패 → 버전 무관 정규식(`@v\d+`)으로 수정. 검사 대상(checkout token에 `ORCHESTRATOR_PAT` 포함)은 그대로 유지.

---

## 5. Actions 배포 결과

- workflow 변경 push 후 `deploy-central-plane.yml` 실행 → install / build / migrations / deploy / **smoke test** 모두 통과.
- `/healthz` smoke `200` 유지, `/webhook/github` 401/503 (서명 요구) 유지.
- Node 20 deprecation 경고 제거 확인.

(구체 run 번호 / 결과는 이 커밋 push 후 Actions 탭에서 확인.)

---

## 6. production actual debit flag 확인

`apps/central-plane/wrangler.toml` (배포된 설정):

```toml
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""
```

- 실제 차감 OFF, 차단 OFF, 허용 allowlist 비어있음 → **production actual debit OFF 확인**.
- 코드 기본값도 안전: `getCreditExecutionConfig`는 `ENABLE_ACTUAL_CREDIT_DEBITS === "true"`일 때만 `actualDebitsEnabled=true`. 미설정/`"false"` → OFF.

---

## 7. test / typecheck / build 결과

| 검사 | 결과 |
|------|------|
| `pnpm test` (전체) | **3364 / 3364 pass**, fail 0 |
| `scripts/release/*.test.mjs` | 39 / 39 pass (workflow YAML 읽는 LIVE INVARIANT 포함) |
| `pnpm typecheck` | 53 / 53 packages |
| `pnpm build` | 29 / 29 packages |
| dashboard `next build` | ✓ 7 routes 컴파일, 에러 0 |

---

## 8. Stage 40에서 이어서 할 일

배포/CI 관점에서 남은 항목:

1. **라이브 Vercel 최종 확인** — Bae가 §3 절차로 dashboard production 배포가 `bdf049e` 이후인지, 7개 route가 라이브에서 정상인지 확인.
2. **dashboard 자동 배포 workflow 부재** — 현재 dashboard는 Vercel Git 연동(추정)에만 의존. central-plane처럼 명시적 배포 게이트가 없음. 필요 시 Stage 40+에서 dashboard 배포 검증 workflow 고려.
3. **release.yml `node-version: "20"`** — Node 20 언어 런타임은 2026 하반기 EOL. npm publish 호환 확인 후 "22"로 올릴지 별도 결정 (이번 Stage 범위 밖, 액션 경고와 무관).

제품 기능 관점 (Stage 39 범위 밖, 보류 유지):

- selectedItemIds 편집 UX (Stage 40 이후)
- actual debit 활성화 (내부 테스트 후 결정, Containers secret은 workflow_dispatch로)
- payment provider 연동 / private repo 지원 — 보류

---

## 하지 않은 것 (Stage 39 범위 준수)

billing/credit 로직 변경, payment provider 연동, production actual debit 활성화, production credit blocking 활성화, private repo full support, repo scope 확대, autofix/patch/commit/branch 생성, GitHub status check 작성, landing 앱 수정 — 일절 없음.
