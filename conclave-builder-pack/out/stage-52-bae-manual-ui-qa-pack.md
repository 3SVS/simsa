> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 52 — Bae 수동 브라우저 QA 패키지

라이브 dashboard에서 PR review workflow를 **직접 클릭하며** 검증하는 체크리스트. 에이전트가 못 하는 브라우저/OAuth/comment-post 부분을 Bae가 한 번 실행.

기준 커밋: `036518f` (main). 대상: Stage 33~49 흐름.

---

## 목적

라이브 환경에서 사용자 흐름(접속 → GitHub 연결 → PR 확인 → 기록/상세 → 선택/영속화 → Fix Pack → 다시 확인 → 자동 비교 → 비교 PR comment)이 끊기지 않는지 확인하고, 막히는 지점을 P0~P3로 분류해 보고.

---

## 사전 준비

- [x] **live dashboard URL** = **`https://conclave-dashboard.vercel.app`** (배포·CORS·OAuth allowlist 반영 완료, Stage 53). 이 URL로 QA 진행.
- [ ] central-plane healthz 200 확인:
  ```bash
  curl -sS https://conclave-ai.seunghunbae.workers.dev/healthz
  # {"ok":true, ... "db":"up"} 기대
  ```
- [ ] (URL 확보 후) dashboard route 로드 확인:
  ```bash
  DASH="<live dashboard URL>"
  for r in /admin/credits /admin/usage; do curl -sS -o /dev/null -w "$r -> %{http_code}\n" "$DASH$r"; done
  # 200 기대. 404면 Vercel production commit/route 확인.
  ```

## 테스트 계정 / 권한

- [ ] GitHub OAuth 가능한 계정(public repo 권한).
- [ ] (admin 페이지용) admin key — `/admin/credits`, `/admin/usage`.

## 테스트 repo / PR

- 권장: `https://github.com/3SVS/My-first-product` · **PR #1** (10-bug seed, public).

---

## QA 실행 순서 (체크박스)

> 각 항목: 클릭/동작 → 기대 결과. 막히면 "실패 시 캡처" 참고.

### A. dashboard 접속
- [ ] `$DASH` 접속 → 로그인 화면/홈 정상, 404·ConnectionRefused 없음.

### B. GitHub 연결 확인
- [ ] GitHub 연결(OAuth) → 연결 상태 표시.
- [ ] repo 목록 로드.
- [ ] 프로젝트에 test repo 연결 상태 확인.

### C. 프로젝트 / repo / PR 선택 + PR 확인 실행
- [ ] `/projects/<id>/github` 진입.
- [ ] PR 목록 로드 → PR #1 link.
- [ ] **PR 확인(review) 실행** → run 생성.
- [ ] dry-run / allowance 배너만 표시(실제 차감/차단 없음).

### D. history list 확인
- [ ] `/projects/<id>/github/history` → run이 최신순.
- [ ] summary count 표시.
- [ ] **"남은 문제 다시 확인"**·**"남은 문제 Fix Pack"** 버튼 표시.
- [ ] passed만 있는 run은 두 버튼 disabled / 비통과 있는 run은 enabled.
- [ ] "상세에서 항목 선택 →" 링크 표시.

### E. run detail 확인
- [ ] run 카드 → 상세(`/projects/<id>/github/history/<runId>`).
- [ ] run summary + 항목별 결과 표시.
- [ ] **"이번에 다룰 항목" picker** 표시.
- [ ] 기본 선택 = 안 맞음/확인 부족/결정 필요(통과는 미선택).

### F. 선택 항목 변경 + 새로고침 복원
- [ ] picker에서 선택 변경(추천/전체/통과 제외/모두 해제 또는 개별).
- [ ] 페이지 **새로고침** → 같은 run 재진입.
- [ ] 직전 선택 복원 + **"이전에 고른 항목을 불러왔어요."** 표시.
- [ ] "모두 해제"한 빈 선택([])도 그대로 복원되는지.

### G. 남은 문제 Fix Pack
- [ ] history에서 **"남은 문제 Fix Pack"** 클릭 → `.../history/<runId>?action=fix-pack` 자동 진입.
- [ ] FixPackPanel autoOpen + 자동 생성.
- [ ] "특정 확인 기록 기준" 안내 + "남은 문제 N개로 Fix Pack을 만들었어요" 표시.
- [ ] Claude/Codex 수정 지시서 생성 + 복사/ZIP 동작.

### H. 남은 문제 quick re-run
- [ ] history에서 **"남은 문제 다시 확인"** 클릭.
- [ ] 새 run detail로 자동 이동.
- [ ] URL에 **`?fromRunId=<oldRunId>`** 포함.
- [ ] 로딩/에러 상태 정상.

### I. 자동 비교 확인
- [ ] 새 run detail에 **"이전 확인 기록과 비교"** 패널 자동 표시.
- [ ] 항목별 상태 전환 표시: `안 맞음 → 통과`, `확인 부족 → 통과`, `통과 → 안 맞음` 등.
- [ ] 좋아진 항목 / 아직 남은 항목 / 새로 생긴 문제 / 변화 없음 그룹 표시.

### J. (위 I와 연결) 비교 PR comment preview/post
- [ ] 비교 패널 **"이 비교 결과를 PR comment로 남기기"** 클릭.
- [ ] CommentPanel로 스크롤 + **preview 자동 생성**.
- [ ] preview body에 "## 다시 확인 결과 비교" + 요약 + 전환 라벨 포함.
- [ ] **"GitHub에 남기기"** → 실제 PR에 comment 게시(GitHub에서 확인).
- [ ] lineage 없는 run에서는 버튼 대신 "다시 확인으로 생성된 기록이 필요해요" 안내.

### K. Telegram (해당 시)
- [ ] 알림 설정대로 동작, 실패해도 흐름 안 끊김, history와 충돌 없음.

### L. credit / debit OFF
- [ ] 위 흐름이 credit으로 차단/차감되지 않음(배너만).

---

## 실패 시 캡처할 정보

- [ ] 어느 단계(A~L) / 무슨 버튼·화면.
- [ ] 화면 스크린샷.
- [ ] 브라우저 콘솔 에러(F12 → Console).
- [ ] 네트워크 실패 요청(F12 → Network: URL, status, 응답).
- [ ] dashboard URL + 시각 + 사용한 repo/PR.
- [ ] central-plane `/healthz` 동시 확인(200인지).

---

## P0/P1/P2/P3 분류 기준

| 등급 | 기준 |
|------|------|
| **P0** | 라이브 흐름 진행 불가 (로그인 안 됨, 페이지 404, review 실행 자체 불가) |
| **P1** | 핵심 흐름은 가능하나 주요 액션 실패 (Fix Pack 생성 실패, re-run 실패, comment post 실패) |
| **P2** | 동작은 하지만 문구/UI 혼란이 큼 |
| **P3** | 문구/정리/개선 제안 |

→ P0/P1만 다음 스테이지에서 최소 수정 대상. P2/P3는 known issue로 기록.

---

## 결과 보고 형식

```text
- 테스트 일시 / dashboard URL / repo·PR
- A~L 각 단계: PASS / FAIL(등급) / 비고
- 발견 이슈: [등급][카테고리] 설명 + 캡처 위치
- 전체 판정: 베타 진입 가능 / P0·P1 수정 후 재시도
```

(카테고리는 `stage-52-issue-triage-criteria.md` 참조.)
