> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Conclave 베타 — Readiness Checklist

상태 표기: **Ready** / **Needs Bae check** / **Known limitation** / **Blocked**
기준일: 2026-06-18. live 확인은 Stage 55~57에서 수행.

| # | 항목 | 상태 | 근거 / 비고 |
|---|------|------|-------------|
| 1 | live dashboard URL | **Ready** | `https://conclave-dashboard.vercel.app` `/projects` HTTP 200 |
| 2 | backend healthz | **Ready** | `https://conclave-ai.seunghunbae.workers.dev/healthz` HTTP 200 |
| 3 | GitHub OAuth | **Ready** | start→authorize 302, returnTo 절대 URL로 vercel 복귀(Stage 53 fix), 연결 status `connected:true` 라이브 확인 |
| 4 | test repo/PR | **Ready** | `3SVS/My-first-product` PR #1 공개, lookup ok=True |
| 5 | org repo 직접입력 | **Ready** | lookup 엔드포인트 라이브(ok/CORS/not_found/invalid 검증), dashboard 직접입력 UI 배포(Stage 57 번들 확인) |
| 6 | PR review 실행 | **Ready** | Stage 55 실데이터 review 성공(2 passed/2 inconclusive), actual debit 없음 |
| 7 | history | **Ready** | review-history 라이브, rerunAction 정확 |
| 8 | Fix Pack | **Ready** | deterministic 생성, Claude/Codex 프롬프트 + 7파일 |
| 9 | quick re-run | **Ready** | rerunOfReviewRunId lineage 정상 |
| 10 | comparison | **Ready** | comparisonToSourceRun + 상태 전환 표시 |
| 11 | PR comment preview/post | **Ready** | PR #1에 실제 게시 검증(issuecomment-4733114388), 비교 섹션·한글 정상 |
| 12 | production safety | **Ready** | ENABLE_ACTUAL_CREDIT_DEBITS=false, ENABLE_CREDIT_BLOCKING=false, ACTUAL_DEBIT_ALLOWED_USER_KEYS="" |
| 13 | org repo 목록 노출 | **Known limitation** | 3SVS org가 OAuth 앱 제한 → 목록 미표시(직접입력으로 우회). org가 앱 승인 시 해소 |
| 14 | private repo | **Known limitation** | 정식 미지원(설계). private→`private_unsupported` 안내 |
| 15 | UI 육안 클릭 E2E | **Needs Bae check** | 에이전트 브라우저 없음. settings 직접입력→연결→/github PR#1까지 Bae 1회 클릭 확인 권장 |
| 16 | Vercel token revoke | **Needs Bae check** | 베타 배포에 토큰 반복 사용·노출됨 → 폐기 권장 |
| 17 | Git auto-deploy 연결 | **Needs Bae check** | conclave-dashboard Vercel-Git 미연결 → 변경마다 수동 `vercel deploy --prod`. UI에서 Git 연결 시 해소 |

## 요약
- **기능 surface(1~12)**: 전부 **Ready** (라이브 검증 완료, safety OFF).
- **한계(13~14)**: 직접입력/공개 repo 범위로 베타 진행 가능, 문서에 명시됨.
- **Bae 확인(15~17)**: 육안 클릭 1회 + 토큰 revoke + (선택) Git 연결. 기능 차단 아님.

→ **베타 사용자에게 dashboard URL + 테스트 가이드를 전달할 준비 완료.** (15번 육안 1회는 첫 사용자 전 권장.)

## 첫 사용자에게 보낼 짧은 안내문 (복사용)

```
안녕하세요. Conclave 베타 테스트에 참여해주셔서 감사합니다 🙏

Conclave는 GitHub PR이 우리가 만들려던 요구사항을 실제로 충족하는지
자동으로 확인해주고, 그 결과를 PR 코멘트로 정리해주는 도구입니다.

[준비물]
- GitHub 계정 + 공개 repo 1개 + 그 안의 열린 PR 1개
  (없으면 데모 repo 3SVS/My-first-product 의 PR #1을 그대로 쓰셔도 됩니다)
- 약 15~20분, 크롬 권장

[시작]
1) https://conclave-dashboard.vercel.app  접속 (로그인 없음)
2) 첨부한 "테스트 가이드"의 과제 1~11을 순서대로 따라 해주세요
3) repo가 목록에 안 보이면, "목록에 없는 저장소 직접 입력"에
   owner/repo (예: 3SVS/My-first-product) 를 넣어 연결하시면 됩니다

[부탁]
- 끝까지 못 가도 괜찮아요. "어디서 멈췄는지 / 무엇이 헷갈렸는지"가 제일 중요합니다.
- 다 하신 뒤 첨부 "피드백 폼"을 채워 보내주세요.

참고: 베타 동안 실제 비용/크레딧은 청구되지 않고(차감 OFF),
코드를 자동으로 고치거나 커밋하지 않습니다. PR 코멘트도 직접 확인 후 게시합니다.

감사합니다!
```
