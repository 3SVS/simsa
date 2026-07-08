> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 13 — PR에 코멘트 남기기

## 개요

PR 코드 확인 결과(Stage 11)를 GitHub PR에 코멘트로 남기는 기능을 추가합니다.
코드를 자동으로 고치거나 patch/commit/branch를 만들지 않습니다.

---

## 추가한 migration/table

**`migrations/0032_workspace_pr_comments.sql`**

```sql
workspace_pr_comments (
  id, project_id, user_key, repo_full_name, pr_number,
  review_run_id, selected_item_ids_json,
  github_comment_id, github_comment_url,
  body_preview, status, error_message,
  created_at, updated_at
)
```

- `status`: `draft` | `posted` | `error`
- 인덱스: (project_id, updated_at DESC), (project_id, repo_full_name, pr_number)

---

## 추가한 endpoint 목록

| Method | Path | 설명 |
|--------|------|------|
| POST | `/workspace/projects/:id/github/pulls/:number/comment/preview` | 코멘트 body 미리보기 (저장 안 함) |
| POST | `/workspace/projects/:id/github/pulls/:number/comment` | GitHub에 코멘트 작성 + D1 저장 |
| GET  | `/workspace/projects/:id/github/pulls/:number/comments` | 이전 코멘트 목록 조회 |

---

## comment preview 생성 방식

`buildCommentBody(opts)` — 결정적(deterministic), no LLM:

1. 헤더: `## 🔍 Conclave PR 확인 결과`
2. disclaimer: "전체 저장소나 배포된 서비스 전체를 확인한 것은 아닙니다"
3. 요약 테이블 (failed/inconclusive/needsDecision/passed)
4. 고쳐야 할 항목 (failed/inconclusive/needs_decision만)
   - 항목별: 제목, 이유, 확인 근거, 다음 단계
5. `<details>` 블록: Conclave 소개 + "코드 자동 고침 아님" 안내
6. 최대 60,000자; 초과 시 잘라내고 warning 추가

---

## GitHub comment post 방식

`POST /repos/{owner}/{repo}/issues/{issue_number}/comments`

- PR number가 issue_number로 들어감 (GitHub PR = issue)
- Authorization: `Bearer {decrypted_token}`
- 성공 시 `github_comment_id`, `github_comment_url` D1에 저장

---

## GitHub scope 정책

필요 scope: `public_repo` (또는 `repo`)

확인 방식:
1. DB에서 connection 로드 → `scopes` 필드 확인
2. scope 부족 → HTTP 403 + `{ error: "github_scope_required" }` 반환
3. GitHub API 403 응답 → 동일하게 `github_scope_required`
4. GitHub API 404 응답 → `repo_not_found` (private repo 또는 접근 불가)

OAuth start 기본 scope: `read:user public_repo` (wrangler.toml `WORKSPACE_GH_SCOPES` env var로 오버라이드 가능)

---

## dashboard UI 변경사항

`github/page.tsx`에 `PRCommentPanel` 컴포넌트 추가:

- `ReviewResultPanel` 아래에 표시 (review results가 있을 때)
- 항목 체크박스 (전체 항목 표시, failed 우선 최대 3개 pre-select)
- "코멘트 미리보기" 버튼 → 미리보기 body 표시
- "GitHub에 남기기" 버튼 → 작성 후 URL 링크 표시
- 공개 저장소 전용 안내 문구
- scope 오류 시: amber 박스 + "권한 다시 연결 →" 링크
- "이전에 남긴 코멘트 보기" 토글 → 날짜/상태/링크 목록

---

## 권한 부족 처리 방식

시나리오 1 — DB scope 부족 (connection has `read:user` only):
- 서버: 403 + `{ error: "github_scope_required", message: "..." }`
- 클라이언트: amber 경고 박스 + settings 링크

시나리오 2 — GitHub API 403:
- 서버: GitHub 응답 확인 → 403 + `github_scope_required`
- 동일 UX

시나리오 3 — GitHub API 404:
- 서버: 404 + `{ error: "repo_not_found", message: "공개 저장소인지 확인..." }`
- 클라이언트: 동일 amber 박스 (scope 오류와 동일 UX)

---

## 아직 자동 코드 수정이 아닌 점

이 단계에서는:
- 코드 patch 생성 없음
- commit 생성 없음
- branch 생성 없음
- autofix pipeline 없음

GitHub PR에 텍스트 코멘트만 남깁니다.

---

## typecheck/build/test 결과

- typecheck: ✅ clean
- build: ✅ tsc success
- tests: 506/506 pass (22 new in workspace-pr-comment.test.mjs)
- migration: 0032 ✅ remote 적용 완료

---

## Stage 14에서 이어서 할 일

후보:
1. **billing/credit** — PR 확인 + 코멘트 작성 토큰 소비 차감
2. **private repo 지원** — `repo` scope + UI 안내
3. **PR comment update** — 기존 코멘트 업데이트 (re-post 대신 PATCH)
4. **/checks 화면 개선** — 코멘트 작성 현황 표시
5. **알림 연동** — Telegram 등으로 PR 확인 완료 알림
