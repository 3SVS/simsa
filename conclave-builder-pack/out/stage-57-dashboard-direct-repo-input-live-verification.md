# Stage 57 — Dashboard 직접입력 repo UI 배포 + 라이브 검증

Stage 56에서 구현한 org repo 직접입력 UI를 production dashboard에 배포하고, 라이브에서 동작을 검증. 새 기능/엔드포인트/마이그레이션 없음.

- dashboard: `https://conclave-dashboard.vercel.app`
- backend: `https://conclave-ai.seunghunbae.workers.dev`
- 테스트 repo/PR: `3SVS/My-first-product` PR #1

---

## dashboard deployment commit
- 배포 HEAD: **`ff975f9`** (main; 직접입력 UI 커밋 `b34869f` 포함).
- Vercel project `conclave-dashboard` (team seunghunbae-3svs-projects), `vercel deploy --prod`, readyState **READY**, alias `https://conclave-dashboard.vercel.app` 갱신.
- 새 settings 청크 `page-1ac8ebc25e89ea88.js` (이전 `page-a464e92a…`에서 교체).

## 직접입력 UI live 확인 (에이전트 자동 — 번들 + 호출 흐름)
> 에이전트는 브라우저 자동화 도구가 없어 **육안 클릭**은 못 함. 대신 배포 번들에 UI가 들어갔는지 + 그 UI가 호출하는 lookup/CORS가 라이브로 동작하는지(= 클릭 직전까지) 전수 확인.

| 항목 | 결과 |
|------|------|
| 번들에 직접입력 UI(`목록에 없는`) | 포함 ✓ |
| 번들에 lookup 호출(`repos/lookup`) | 포함 ✓ |
| placeholder `3SVS/My-first-product` | 포함 ✓ |

## 3SVS/My-first-product lookup 결과 (라이브, Origin=vercel)
- `GET /workspace/github/repos/lookup?userKey=…&fullName=3SVS/My-first-product`
- **ok=True**, fullName=`3SVS/My-first-product`, private=`false`, `permissions.pull=true`.
- CORS: `Access-Control-Allow-Origin: https://conclave-dashboard.vercel.app` ✓
- 에러 매핑: `bad`→`invalid_full_name`, `3SVS/none-xyz`→`not_found` (UI 한글 안내로 매핑됨).

## project repo link 결과
- lookup 성공 시 dashboard `handleDirectLookup`이 곧바로 `linkProjectRepo`(`POST /workspace/projects/:id/repo`) 호출 → repo 연결. (이 link 경로는 Stage 55에서 동일하게 라이브 검증됨: `proj_7w5zhyaw`에 `3SVS/My-first-product` link ok=True.)

## PR #1 표시 여부
- repo 연결 후 `/projects/:id/github` → `GET …/github/pulls` → PR #1 표시/연결. (Stage 55 라이브 검증: PR #1 "feat: add task comments + sharing" 목록·링크·review까지 성공.)

## CORS / API 결과
- lookup + repos + pulls + repo-link 모두 vercel origin 반영, evil origin 미반영(exact-match). 5xx 없음.

## production safety
- `ENABLE_ACTUAL_CREDIT_DEBITS=false`, `ENABLE_CREDIT_BLOCKING=false`, `ACTUAL_DEBIT_ALLOWED_USER_KEYS=""` ✅

## test / typecheck / build
- Stage 57 **코드 변경 없음**(배포·검증 단계). Stage 56 게이트 유지: central-plane 950/950, typecheck 53/53, dashboard build green.

## known issues
- **org listing 미표시 유지**: `3SVS` org가 Conclave OAuth 앱 접근을 제한 → `/workspace/github/repos` 목록엔 org repo 안 뜸(설계상). **직접입력으로 우회.** 근본 해결은 org가 OAuth 앱 승인.
- **육안 클릭 검증은 Bae 1회**: 에이전트 브라우저 없음. settings에서 `3SVS/My-first-product` 직접입력→연결→`/github`에서 PR #1 확인. 클릭이 호출하는 모든 API는 라이브 검증됨.
- dashboard는 Vercel Git 미연결 → 변경마다 수동 `vercel deploy --prod`.

## Stage 58 추천
1. (운영) `3SVS` org에서 **Conclave OAuth 앱 승인** → listing에 org repo 자연 노출(직접입력 의존 감소).
2. (운영) Vercel **토큰 revoke** + **Git 연결**(수동 배포 제거).
3. 베타 사용자 온보딩 시작(실데이터 한 바퀴 + 직접입력까지 검증 완료).
4. 보류: private repo full support, OAuth scope 확대, actual debit 활성화.
