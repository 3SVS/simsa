> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 53 — Dashboard Vercel Deployment Setup

`apps/dashboard`를 Vercel Production에 배포해 live dashboard URL을 확보하기 위한 설정/검증. 새 제품 기능 없음.

기준 커밋: `080f73d` (main). 작성: 2026-06-14.

> ⚠️ 에이전트는 Bae의 Vercel 계정에 접근할 수 없어 **프로젝트 생성/배포를 직접 수행 못 함.** 이 문서는 (1) repo가 deploy-ready임을 검증하고, (2) Bae가 한 번에 올바르게 배포하도록 정확한 설정 + **CORS/OAuth 도메인 핵심 발견**을 제공함. 실제 배포 + URL 확정은 Bae 작업.

---

## ★ 핵심 발견 (배포 전 반드시 읽기) — 도메인 선택이 결정적

central-plane 코드 전체가 dashboard 도메인을 **`https://dashboard.conclave-ai.dev`** 로 하드와이어해 둠:

| 위치 | 내용 |
|------|------|
| CORS allowlist (3파일: `workspace-github.ts`, `workspace.ts`, `workspace-notifications.ts`) | `https://dashboard.conclave-ai.dev` + `.conclave-ai.dev` suffix 허용 |
| OAuth return 검증 `github-oauth.ts isAllowedReturnTo` | `ALLOWED_RETURN_ORIGINS` **exact-match**에 `https://dashboard.conclave-ai.dev` |
| `DEFAULT_DASHBOARD_URL` / `WORKSPACE_GH_DASHBOARD_URL` | `https://dashboard.conclave-ai.dev` |

**결론:**
- **(권장) custom domain `dashboard.conclave-ai.dev` 부착** → CORS·OAuth·dashboard URL **즉시 동작, backend 변경 0.**
- **(비권장) bare `*.vercel.app` 기본 URL** → ① CORS 차단(브라우저가 API 호출 막힘) ② **OAuth return 차단**(로그인 후 dashboard로 못 돌아옴). user 예시였던 `conclave-dashboard.vercel.app`은 그대로는 **동작 안 함.**

> `isAllowedReturnTo`의 exact-match는 OAuth open-redirect를 막는 **의도된 보안 통제**입니다. 여기에 `*.vercel.app` wildcard를 넣는 것은 보안 회귀이므로 하지 않습니다. vercel.app을 꼭 써야 하면 **확정된 정확한 URL**을 두 곳(CORS + ALLOWED_RETURN_ORIGINS)에 추가하는 별도 backend 변경(Stage 54)이 필요합니다.

현재 상태: `dashboard.conclave-ai.dev`는 **DNS 미설정**(resolve 실패) → 아직 live 아님. Bae가 Vercel에서 도메인 부착 + DNS 설정 필요.

---

## repo deploy-readiness (에이전트 검증 완료)

- `apps/dashboard`는 **self-contained Next 15 앱**: deps = `jszip`, `next`, `react`, `react-dom`만. **`@conclave-ai/*` workspace 의존성 0** (패키지명만 `@conclave-ai/dashboard`).
- `next.config.ts` 비어있음(기본). `vercel.json`/`.vercelignore` 없음(불필요).
- root `packageManager: pnpm@9.15.0`, `pnpm-lock.yaml` at root, `pnpm-workspace.yaml`에 `apps/*`.
- **Vercel-sim build 통과**: `apps/dashboard`에서 `next build` → ✓ 8/8 pages, 5개 release route 컴파일.

→ 추가 코드/설정 변경 없이 Vercel에 그대로 올릴 수 있음.

---

## Bae 작업: Vercel 프로젝트 생성

1. Vercel → **Add New… → Project** → GitHub repo `3SVS/conclave-ai` import.
2. **Project Name**: `conclave-dashboard` (또는 `conclave-ai-dashboard`).
3. **Framework Preset**: Next.js (자동 감지).
4. **Root Directory**: `apps/dashboard` ← **필수**.
5. **Build & Output**:
   - Install Command: 기본(Vercel이 root `pnpm-lock.yaml` 감지해 `pnpm install`) — 건드리지 말 것. (실패 시 Option B 아래.)
   - Build Command: 기본 `next build` 또는 `pnpm build` (동일). 
   - Output Directory: Next.js preset가 관리(설정 불필요).
6. **Environment Variables** (Production + Preview):
   ```
   NEXT_PUBLIC_CENTRAL_PLANE_URL = https://conclave-ai.seunghunbae.workers.dev
   ```
   > `NEXT_PUBLIC_*`는 **build-time에 번들에 인라인**. 값 변경 시 **redeploy 필수.**
7. **Deploy.**

### 빌드 실패 시 (monorepo/pnpm)
- Option A(우선): Build Command 기본 / `pnpm build`.
- Option B(실패 시): Build Command `cd ../.. && pnpm --filter @conclave-ai/dashboard build`, Install Command `cd ../.. && pnpm install`.
- 확인: Root Directory가 정확히 `apps/dashboard`인지, packageManager pnpm 감지됐는지.

### 도메인 (권장)
- Vercel Project → **Settings → Domains → Add** `dashboard.conclave-ai.dev`.
- Vercel이 안내하는 **DNS 레코드(CNAME)**를 `conclave-ai.dev` DNS에 추가.
- 전파 후 production이 `https://dashboard.conclave-ai.dev`로 서빙 → CORS·OAuth 즉시 정상.

---

## 배포 후 smoke (Bae 실행)

`$DASH` = 확정된 live URL (권장: `https://dashboard.conclave-ai.dev`).

**projectId 불필요 route 먼저:**
```bash
DASH="https://dashboard.conclave-ai.dev"   # 실제 확정 URL로
for r in / /admin/credits /admin/usage /projects; do
  curl -sS -o /dev/null -w "$r -> %{http_code}\n" "$DASH$r"
done
# 200(또는 인증 리다이렉트) 기대. 404면 Root Directory/배포 commit 확인.
```

**테스트 project 있으면:**
```
/projects/:id/github
/projects/:id/github/history
/projects/:id/github/history/:runId
```

**API 연결 (브라우저 DevTools → Network):**
- 기대: dashboard → `https://conclave-ai.seunghunbae.workers.dev` 호출, 2xx/4xx 정상.
- 실패 증상: `ConnectionRefused`, `localhost:8787` 호출, **CORS error**, central-plane 404.
- 실패 시: ① Vercel Production에 `NEXT_PUBLIC_CENTRAL_PLANE_URL` 설정됐는지 ② 설정 후 redeploy ③ `/healthz` 200 ④ **dashboard origin이 CORS allowlist에 있는지**(= 도메인이 `*.conclave-ai.dev`인지). vercel.app이면 CORS error 예상 → 도메인을 conclave-ai.dev로.

---

## CORS 수정 여부

- **custom domain `dashboard.conclave-ai.dev` 경로**: 수정 **불필요**(이미 허용).
- **vercel.app 경로 선택 시**: 수정 필요하지만 이번 Stage에서는 **하지 않음**(OAuth open-redirect 보안 통제를 wildcard로 풀지 않기 위해). 정확한 URL 확정 후 별도 처리(Stage 54).

→ 이번 Stage 53: **backend CORS 코드 변경 없음.**

---

## 결과 기록 — ✅ 배포 완료 (2026-06-14, Vercel API/CLI로 에이전트가 생성·배포)

| 항목 | 값 |
|------|----|
| Vercel project name | **`conclave-dashboard`** (projectId `prj_mAOqO6RIHIQRYNfnfgpe4cMrg4j9`, team `seunghunbae-3svs-projects`) |
| **live dashboard URL** | **`https://conclave-dashboard.vercel.app`** (verified production alias) |
| Root Directory | `apps/dashboard` |
| Install / Build | 기본 (pnpm workspace, `next build`) |
| env | `NEXT_PUBLIC_CENTRAL_PLANE_URL=https://conclave-ai.seunghunbae.workers.dev` (production+preview+development) |
| deployment | repo root에서 `vercel deploy --prod` (현재 main `080f73d`), readyState READY |
| smoke route 결과 | `/` 307(로그인 리다이렉트), `/admin/credits` 200, `/admin/usage` 200 |
| CORS/OAuth 수정 | **예** — `https://conclave-dashboard.vercel.app` exact origin을 CORS 3파일 + OAuth ALLOWED_RETURN_ORIGINS에 추가 (wildcard 없음), central-plane 재배포 |

### 도메인 선택 변경 (vs 위 §핵심 발견)
- Bae 결정: **도메인 새로 안 사고 Vercel 기본 production URL(`conclave-dashboard.vercel.app`)로 QA.**
- 따라서 `dashboard.conclave-ai.dev` custom domain은 미사용. 대신 vercel.app origin을 allowlist에 정확히 추가(아래).
- OAuth: dashboard가 `returnTo = window.location.href`(절대 URL) 전송 → `ALLOWED_RETURN_ORIGINS`에 추가로 충분. `WORKSPACE_GH_DASHBOARD_URL`(절대 returnTo엔 미사용) 변경 불필요.

### git auto-deploy (남은 작업 — Bae UI)
- 토큰이 collaborator 권한이라 API로 GitHub git-link 생성 불가 → 현재 프로젝트는 **git 미연결**(수동 `vercel deploy`로 배포됨).
- main push 시 auto-deploy를 원하면: Vercel UI → conclave-dashboard 프로젝트 → Settings → Git → Connect `3SVS/conclave-ai`(Bae 계정은 GitHub App 보유). 또는 dashboard 변경 때마다 `vercel deploy --prod` 재실행.

---

## 자동 라이브 E2E 검증 (에이전트 수행, 2026-06-14)

브라우저 없이 HTTP 레벨로 검증 가능한 전부:

| 항목 | 결과 |
|------|------|
| dashboard 라이브 | `https://conclave-dashboard.vercel.app` 서빙 |
| route (5xx 없음) | `/admin/credits` 200, `/admin/usage` 200, `/projects` 200, `/projects/:id/github` 200, `.../history` 200, `/` 307(로그인), `/login`·`/admin` 404(인덱스 없음, 정상) |
| dashboard 번들 → central-plane | worker URL(`conclave-ai.seunghunbae.workers.dev`) 인라인 확인 |
| CORS (라이브) | dashboard origin → `Access-Control-Allow-Origin` 반영(preflight 204 + GET 200); `evil.vercel.app` → localhost fallback(미반영, exact-match) |
| OAuth start (라이브) | → `github.com/login/oauth/authorize`, `client_id` SET(`Ov23ctqh…`), `redirect_uri = {worker}/workspace/github/oauth/callback`(안정적), `scope read:user public_repo`(private 없음), `state` set |
| safety flags | ENABLE_ACTUAL_CREDIT_DEBITS/BLOCKING=false (OFF) |
| backend E2E 계약 + 로직 | Stage 51 probe + node --test 3457 green |

→ **자동 검증 가능 surface 전부 GREEN.**

### 라이브 QA 중 발견·수정한 P1 (2026-06-18, `ae76c67`)
- **증상**: "저장하고 프로젝트 시작하기" → `/projects/<id>` 이동 시 **404**.
- **원인**: `projects/[id]/page.tsx`(개요)와 `projects/[id]/idea/page.tsx`가 **async Server Component**로 `getProject(id)`(=MOCK 데모만) + `notFound()`. 로컬 생성 프로젝트는 **localStorage(client-only)**라 서버가 못 찾아 404. (다른 탭은 이미 client + `getLocalProject`.)
- **수정**: 두 페이지를 client component로 전환, `getLocalProject(id) ?? getProject(id)` + graceful fallback("프로젝트를 찾을 수 없습니다"). layout은 `project?.name ?? "프로젝트"`로 이미 안전(무변경).
- **검증**: 재배포 후 라이브 `/projects/<any-id>`·`/idea`·`/github` 모두 **200**(이전 404→200). node --test 3457/3457, typecheck 53/53, build 29/29.

### 진짜 남은 것 (사람+브라우저+GitHub 계정 필수 — 어떤 에이전트도 불가)
- GitHub "Authorize" 실제 클릭(OAuth grant)
- UI 클릭 흐름(review 실행, Fix Pack 생성, comment 작성 버튼)
- 실제 PR에 comment 게시
- 패널 육안 확인

→ `stage-52-bae-manual-ui-qa-pack.md` B~K를 Bae가 1회. OAuth는 백엔드 구성이 검증됐으니 "Authorize 후 dashboard로 복귀되는지"만 확인하면 됨.

## known issues

- 라이브 URL/배포는 **Bae 작업** (에이전트 배포 불가).
- `dashboard.conclave-ai.dev` DNS 미설정 → 부착+전파 필요.
- vercel.app 기본 URL은 CORS+OAuth로 그대로는 미동작(도메인 선택 주의).
- (이전 May 11~12 배포는 오래됨/별도 → 새 프로젝트로 대체.)

## 다음 QA 단계

배포 + URL 확정 후 → `stage-52-bae-manual-ui-qa-pack.md`(A~L) 실행 → P0 없으면 베타 진입.
