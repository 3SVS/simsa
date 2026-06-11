# Stage 9 — GitHub Connect

## 추가한 Migration / Table

**파일:** `apps/central-plane/migrations/0029_workspace_github.sql`

| 테이블 | 목적 |
|--------|------|
| `workspace_oauth_states` | OAuth 흐름의 CSRF state 저장 (TTL 15분, 사용 후 used=1) |
| `workspace_github_connections` | GitHub 사용자 연결 정보 (login, name, avatar, 암호화 토큰) |
| `workspace_project_repos` | 프로젝트 ↔ 저장소 링크 |

인덱스:
- `idx_workspace_github_connections_user_key` (user_key)
- `idx_workspace_github_connections_github_user` UNIQUE (github_user_id)
- `idx_workspace_project_repos_project` (project_id)
- `idx_workspace_project_repos_user_key` (user_key)

---

## 추가한 Env

`wrangler.toml [vars]` (공개값):
```
WORKSPACE_GH_CLIENT_ID   = "REPLACE_WITH_..."   ← GitHub OAuth App에서 발급
WORKSPACE_GH_REDIRECT_URI = "https://...workers.dev/workspace/github/oauth/callback"
WORKSPACE_GH_SCOPES      = "read:user public_repo"
WORKSPACE_GH_DASHBOARD_URL = "https://dashboard.conclave-ai.dev"
```

`wrangler secret put` (비공개):
```
WORKSPACE_GH_CLIENT_SECRET   ← 절대 wrangler.toml에 저장 금지
```

**등록 방법:**
1. https://github.com/settings/developers → New OAuth App
2. Authorization callback URL: `https://conclave-ai.seunghunbae.workers.dev/workspace/github/oauth/callback`
3. Client ID → `WORKSPACE_GH_CLIENT_ID`
4. Generate secret → `wrangler secret put WORKSPACE_GH_CLIENT_SECRET`

---

## 추가한 Endpoint

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/workspace/github/oauth/start` | GitHub OAuth 시작 (리다이렉트) |
| `GET` | `/workspace/github/oauth/callback` | OAuth 코드 교환, 연결 저장, 대시보드로 리다이렉트 |
| `GET` | `/workspace/github/status` | 연결 상태 조회 (`?userKey=...`) |
| `GET` | `/workspace/github/repos` | 공개 저장소 목록 조회 (`?userKey=...`) |
| `POST` | `/workspace/projects/:id/repo` | 프로젝트에 저장소 연결 |
| `GET` | `/workspace/projects/:id/repo` | 연결된 저장소 조회 |

---

## OAuth Flow

```
1. 대시보드 → GET /workspace/github/oauth/start?userKey=...&returnTo=...
   서버: state 생성 → D1 저장 → GitHub authorization URL로 302 리다이렉트

2. GitHub 인증 완료 → callback: GET /workspace/github/oauth/callback?code=...&state=...
   서버:
     a. state D1 검증 (TTL 15분, 재사용 불가)
     b. state.used = 1 mark
     c. GitHub /login/oauth/access_token 호출 (code 교환)
     d. GitHub /user 호출 (사용자 정보)
     e. AES-256-GCM으로 토큰 암호화 (CONCLAVE_TOKEN_KEK)
     f. workspace_github_connections upsert
     g. returnTo URL + ?github=connected 로 302 리다이렉트

3. 대시보드 → returnTo 페이지에 도착, ?github=connected 감지 → 연결 완료 표시
```

---

## Token 저장 방식

- `encryptToken` / `decryptToken` (기존 `crypto.ts` AES-256-GCM 재사용)
- KEK: `CONCLAVE_TOKEN_KEK` (이미 프로덕션에 설정됨)
- D1 컬럼: `access_token_enc TEXT` — base64(IV || ciphertext || auth_tag)
- **대시보드는 GitHub 토큰을 절대 받지 않음**
- KEK 미설정 시: 토큰 암호화 없이 연결만 저장 (`access_token_enc = ""`), repo 목록 조회 시 503 반환

---

## Repo 목록 조회 방식

- `GET /workspace/github/repos?userKey=...`
- D1에서 user_key로 연결 조회 → access_token_enc 복호화 → GitHub API `GET /user/repos?visibility=public&sort=updated&per_page=100` 호출
- Stage 9: 공개 repo만 (`public_repo` scope)
- Stage 10+: private repo 추가 예정

---

## Project-Repo 연결 방식

- `POST /workspace/projects/:id/repo` body: `{ userKey, repo: { id, fullName, owner, name, ... } }`
- GitHub 연결 확인 → `workspace_project_repos` upsert (project당 1개, ON CONFLICT UPDATE)
- `GET /workspace/projects/:id/repo` → 연결 상태 반환

---

## Dashboard UI 변경사항

### 신규: `/projects/:id/settings` 페이지

nav 항목: "저장소 연결"

주요 UI:
- **GitHub 미연결**: "GitHub로 연결" 버튼 → OAuth 시작
- **연결됨**: GitHub 사용자 아바타 + 이름 표시, "저장소 선택" 버튼
- **저장소 선택 모드**: 검색 + 목록 (최대 50개), 선택 시 즉시 연결
- **연결 완료**: "만들기 패키지로 이동 →" CTA

문구:
- "아직 PR을 확인하거나 코드를 검사하지는 않아요. 이번 단계에서는 프로젝트와 저장소만 연결합니다."
- 다음 단계 안내: PR 목록, Conclave 자동 검토 예정

### 수정: export/page.tsx 이전 기록

이력 카드에 **"다시 확인"** 링크 추가 → `/projects/:id/checks`
문구: "다시 확인은 제품 설명서 기준의 사전 점검입니다. 아직 GitHub 코드 확인은 아니에요."

---

## 아직 /saas/review와 연결하지 않은 점

Stage 9에서 구현하지 않은 것:
- PR 목록 조회
- PR review 실행 (`/saas/review`)
- autofix pipeline 연결
- GitHub webhook 연동

이 기능들은 Stage 10+에서 구현 예정.

---

## typecheck / build / test 결과

```
central-plane: typecheck ✅  build ✅
dashboard:     typecheck ✅  build ✅  lint ✅

테스트:
  workspace-github.test.mjs — 14/14 pass (신규)
  기존 테스트               — 417/417 pass
  합계: 431/431 pass, 0 fail
```

---

## Stage 10에서 이어서 할 일

1. GitHub OAuth App 등록 + `WORKSPACE_GH_CLIENT_ID` / `WORKSPACE_GH_CLIENT_SECRET` 실제 값 설정
2. PR 목록 조회: `GET /workspace/projects/:id/prs`
3. `/saas/review` job 연결 (PR 선택 → review 실행)
4. private repo 지원 (`repo` scope 추가)
5. OAuth refresh token (현재 GitHub OAuth는 만료 없음, but token revoke 처리 필요)
6. 연결 해제: DELETE /workspace/projects/:id/repo, DELETE /workspace/github/connection
