> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 56 — Org repo picker (dashboard repo 연결 개선)

dashboard repo picker가 조직(org) repo도 연결할 수 있게 개선. 새 PR review 기능 없음. private repo full support·OAuth scope 확대 없음.

- dashboard: `https://conclave-dashboard.vercel.app`
- backend: `https://conclave-ai.seunghunbae.workers.dev`
- 대상 repo: `3SVS/My-first-product` (공개 org repo) PR #1

---

## 문제 배경

Stage 55에서 API로는 `3SVS/My-first-product`를 link/review/comment까지 성공했지만, dashboard repo picker에는 안 떴다. 원인: `GET /workspace/github/repos`의 `fetchGitHubRepos`가 `GET /user/repos?visibility=public`만 호출 → 실제로 **연결 계정 본인 소유 repo(11개)만** 반환, org repo 누락.

## GitHub repo listing 변경 (1차)

`fetchGitHubRepos`를 명시적으로:
```
GET /user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=updated&per_page=100
```
+ Link-header pagination(maxPages=5) + GitHub `permissions` 비트 additive 전달.
- `visibility=all`은 `public_repo` 토큰에선 안전(비공개는 scope상 반환 안 됨) → **private 지원 추가 아님.**
- 커밋 `a2f4902`, deploy-central-plane 자동 배포.

### ★ 라이브 결과: listing 개선만으로는 부족
배포 후 `GET /workspace/github/repos`는 **여전히 owner repo 11개만, `3SVS/*` 0개.** 진단:
- `seunghunbae-3svs`의 공개 org=없음, `3SVS` 공개 멤버=아님(404).
- 그러나 직접 lookup의 permissions가 `admin:true` → 계정은 repo 접근 권한 보유.
- 결론: **`3SVS` org가 OAuth 앱(Conclave) 접근을 제한** → `/user/repos` 류 listing이 org repo를 반환하지 않음. (Vercel GitHub App이 org repo를 못 본 것과 같은 계열.) public repo는 **full-name 직접 접근**으로만 도달 가능.

## 직접 입력(owner/repo) fallback (2차) — 성공 기준 충족 경로

listing으로 못 띄우므로 spec §6의 직접 입력을 구현:
- **backend**: `GET /workspace/github/repos/lookup?userKey&fullName=owner/repo` → `fetchGitHubRepoByFullName`(`GET /repos/:owner/:repo`). 404→`not_found`, private→`private_unsupported`(Stage 56는 private 미지원), public→picker가 쓰는 동일 repo shape.
- **dashboard**: repo picker에 "목록에 없는 저장소 직접 입력"(owner/repo) 입력 + "연결" 버튼. 형식 검증 → lookup → 성공 시 즉시 link, 에러별 한글 안내. 목록이 비어도 picker 렌더, 검색 placeholder에 owner 포함.
- 커밋 `b34869f`.

### 라이브 검증 (backend, 직접 lookup)
| 케이스 | 결과 |
|--------|------|
| `3SVS/My-first-product` | **ok=True**, owner=3SVS, private=False, branch=main, permissions(admin/push/pull) ✓ |
| CORS | `Access-Control-Allow-Origin: https://conclave-dashboard.vercel.app` ✓ |
| 없는 repo | `not_found` ✓ |
| 잘못된 형식 | `invalid_full_name` ✓ |

→ **backend로 org repo를 직접 입력으로 연결 가능 확인.** dashboard UI는 코드 커밋·build green, **Vercel 재배포 후 육안 확인 남음**(아래).

## response shape 변경
- additive만: repo에 `permissions?: { pull?, push?, admin? }` 추가(central-plane 타입 + dashboard 타입). 기존 필드 불변.

## dashboard picker UI 변경
- 기존에 이미 owner/repo(`fullName`) + `public/private` + 이름 검색 표시(§4§5 충족).
- 추가: 직접 입력 input/버튼, 목록 빈 경우도 렌더, 검색 힌트에 owner 언급.

## private repo scope 제한
- `public_repo` 스코프 유지(확대 안 함). 직접 입력에서 private→`private_unsupported` 안내. private full support는 범위 밖.

## pagination 정책
- Link header rel="next" 추종, `maxPages=5`(최대 500개)로 bound. 첫 100개 보장 + 그 이상은 페이지네이션.

## tests / typecheck / build
- backend 신규 8 (listing 5: affiliation/org포함/permissions/pagination merge/maxPages bound; lookup 3: resolve/404→null/non-ok throw). central-plane **950/950**, typecheck **53/53**, dashboard build green.

## Stage 57에서 이어서 할 일
1. **dashboard Vercel 재배포** → repo picker 직접 입력으로 `3SVS/My-first-product` 연결 육안 확인(현재 backend만 라이브, dashboard UI는 배포 대기).
2. (선택) org-list 열거(`/user/orgs`+`/orgs/:org/repos`) — 단, OAuth 앱 제한 org에선 효과 제한적. 더 근본적으론 org가 Conclave OAuth 앱을 승인하면 listing에 자동 노출.
3. 보류: private repo full support, OAuth scope 확대.
