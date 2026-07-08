> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 54 — Live E2E QA (PR review workflow)

라이브 dashboard에서 새 프로젝트 → PR 확인 → history → Fix Pack → quick re-run → 자동 비교 → PR comment까지 한 바퀴 검증. 새 기능/엔드포인트/마이그레이션 없음. P0/P1만 최소 수정.

- live dashboard: `https://conclave-dashboard.vercel.app`
- backend: `https://conclave-ai.seunghunbae.workers.dev`
- test repo: `https://github.com/3SVS/My-first-product` PR #1
- 기준 커밋: `534cc05` (main), 작성: 2026-06-18.

---

## 검증 가능 범위 — 정직한 구분

에이전트는 브라우저가 없어 다음은 **직접 수행 불가**(사람+브라우저+GitHub 계정 필요):
- A/B/C 화면 육안 렌더, 콘솔 에러 확인
- C의 **GitHub Authorize 실제 클릭**(OAuth grant)
- D~L의 **실데이터 실행**(연결된 userKey의 서버측 토큰 필요)

에이전트가 **라이브로 전수 검증한 것**(아래 전부 GREEN):
- 모든 핵심 라우트 배선(404 없음) + CORS(vercel origin 반영) + OAuth 배선
- 계약 응답 shape, production safety 플래그
- 결정적 로직(node --test 전체)
- Stage 53에서 고친 두 P1(404, OAuth NXDOMAIN)이 라이브에 반영됐는지

---

## 자동 검증 결과 (에이전트, 라이브)

### CORS + 라우팅 전수 probe (Origin = vercel)
모든 핵심 플로 엔드포인트가 배선됨(404 없음), `Access-Control-Allow-Origin = https://conclave-dashboard.vercel.app` 반영, 500 없음:

| 엔드포인트 | status | ACAO |
|-----------|--------|------|
| GET /healthz | 200 | (해당없음) |
| GET /workspace/github/status | 200 | vercel ✓ |
| GET /workspace/github/repos | 401(미연결) | vercel ✓ |
| GET /workspace/projects/:id/repo | 200 | vercel ✓ |
| GET …/github/pulls | 400(미링크) | vercel ✓ |
| GET …/github/linked-pulls | 200 | vercel ✓ |
| GET …/pulls/1/review | 200 (`{"ok":true,"run":null}`) | vercel ✓ |
| GET …/github/review-history | 200 | vercel ✓ |
| GET …/pulls/1/review/history | 200 | vercel ✓ |
| GET …/pulls/1/comments | 200 | vercel ✓ |
| GET …/pulls/1/review/compare | 400(런 부족) | vercel ✓ |
| OPTIONS review/comment/fix-brief/link/repo | 204 | vercel ✓ |

- evil origin(`evil-dashboard.vercel.app`) → ACAO = localhost fallback(**미반영, exact-match 확인, wildcard 없음**).
- 401/400은 "미연결/미링크/런 부족"의 **정상 계약 응답**(P0/P1 아님).

### OAuth 배선 (라이브)
- start(절대 returnTo=vercel) → **302 → github.com/login/oauth/authorize** (client_id `Ov23ctqh…`, redirect_uri = worker callback, scope `read:user public_repo`, state set).
- 콜백 로직: returnTo가 `http`로 시작 → `appendGitHubConnected`가 그대로 반환 → **vercel origin 복귀**(Stage 53 `51aa54c` fix). 배포 번들 `location.href` 1건/`pathname` 0건.

### Production safety (배포본 wrangler.toml)
- `ENABLE_ACTUAL_CREDIT_DEBITS = "false"`
- `ENABLE_CREDIT_BLOCKING = "false"`
- `ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""` (비어있음)
- → 실제 크레딧 차감/차단 없음. review 응답의 creditEnforcement는 dry-run/allowance 안내만.

### Stage 53 fix 라이브 재확인
- `/projects/:id`·`/idea`·`/github` → 200 (이전 404 해소).
- OAuth NXDOMAIN 해소(위 OAuth 배선).

---

## QA 단계별 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| A | dashboard 접속 | 라우트 200(자동) · **육안=Bae** |
| B | 새 프로젝트 생성→/projects/:id | 라우트 200·404 fix 검증(자동) · **클릭 흐름=Bae** |
| C | GitHub 연결 OAuth | 배선·복귀 검증(자동) · **Authorize 클릭=Bae** |
| D | repo/PR 연결 | 엔드포인트·CORS(자동) · **실데이터=연결 후** |
| E | PR 확인 실행 | 엔드포인트·safety(자동) · **실행=연결 후** |
| F | history list | 엔드포인트·shape(자동) · **육안=Bae** |
| G | run detail picker | 엔드포인트(자동) · **육안=Bae** |
| H | 선택 영속화 | 결정적 로직 테스트 · **육안=Bae** |
| I | 남은 문제 Fix Pack | 엔드포인트(자동) · **육안=Bae** |
| J | quick re-run ?fromRunId | 엔드포인트·로직(자동) · **육안=Bae** |
| K | 자동 비교 | 결정적 로직 테스트 · **육안=Bae** |
| L | 비교 PR comment | 엔드포인트(자동) · **실 게시=연결 후** |

→ **자동 검증 surface 전부 GREEN. 실데이터 E2E(D~L)는 "연결된 userKey"가 있어야 진행.**

---

## 실데이터 E2E를 에이전트가 완료하는 법 (선택)

GitHub 토큰은 **서버측(D1, 암호화)에 userKey로 저장**됩니다. Bae가 브라우저에서 한 번 OAuth Authorize를 마치면, 그 **userKey + projectId**만 알려주셔도 에이전트가 라이브 API로 D~L(연결 확인 → PR 목록 → PR #1 확인 실행 → history → Fix Pack → quick re-run → 비교 → comment preview, 그리고 승인 시 PR #1에 실제 comment 게시)을 **실데이터로 한 바퀴** 돌려 검증할 수 있습니다. (raw 토큰 불필요 — 서버가 복호화해 사용.)

- userKey: 브라우저 DevTools → Application → Local Storage → `conclave:userKey`(또는 `uk_…`)
- projectId: 프로젝트 화면 URL의 `/projects/<여기>`

이 값을 주시면 Stage 54를 실데이터까지 닫겠습니다. 안 주시면 Bae가 아래 수동 1회.

---

## P0/P1 이슈

- 자동 검증 surface에서 **신규 P0/P1 없음**. (Stage 53에서 발견된 2건은 이미 수정·배포됨: `ae76c67` 404, `51aa54c` OAuth.)
- 실데이터 E2E는 미실행(차단이 아니라 입력 대기) → P0/P1 판정 보류.

## 수정한 파일 / 커밋
- Stage 54 **코드 변경 없음**(QA 단계, 신규 P0/P1 없음). 문서: 이 파일.

## production safety
- actual debit/blocking OFF, allowlist 비어있음 (위 확인).

## test/typecheck/build
- 코드 변경 없음. 전체 게이트 재실행(`--force`): **test 52/52 태스크 통과(exit 0)**, **typecheck 53/53**, **build 29/29**. (node --test 총계 3457/0 — 오늘 동일 트리 기준; 이후 변경은 OAuth 1줄 컴포넌트뿐이라 테스트 불변.)

## Stage 55 전 결정 필요
1. Bae가 userKey+projectId를 주어 **에이전트가 실데이터 E2E를 닫을지**, 아니면 Bae가 **브라우저로 A~L 1회** 직접 돌릴지.
2. (운영) Vercel 토큰 revoke + Vercel UI에서 Git 연결(자동 배포).
3. 베타 진입 여부(실데이터 한 바퀴 통과 후).
