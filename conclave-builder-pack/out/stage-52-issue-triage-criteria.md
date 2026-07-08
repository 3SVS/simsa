> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 52 — 피드백 / 이슈 분류 기준 (Triage)

베타 QA·피드백에서 나온 이슈를 일관되게 분류·우선순위화하는 기준. Bae 수동 QA(`stage-52-bae-manual-ui-qa-pack.md`)와 피드백 템플릿(`stage-52-feedback-template.md`)이 이 기준을 참조.

---

## Severity (심각도 → 처리 우선순위)

| 등급 | 정의 | 처리 |
|------|------|------|
| **P0** | 테스트/사용 **진행 불가** — 로그인 안 됨, 페이지 404, PR 확인 실행 자체 불가, dashboard가 central-plane에 연결 실패(ConnectionRefused) | 즉시 수정(최소 변경). 베타 차단 사유. |
| **P1** | 핵심 흐름은 가능하나 **주요 작업 실패** — Fix Pack 생성 실패, 다시 확인 실패, 자동 비교 안 뜸, comment preview/post 실패 | 다음 스테이지에서 최소 수정. |
| **P2** | 동작은 하지만 **이해/마찰이 큼** — 버튼 의미 오해, 상태가 헷갈림, 흐름이 직관적이지 않음 | known issue 기록 + 카피/UX 개선 백로그. |
| **P3** | **문구/정리/개선 제안** — 오탈자, 더 친절한 안내, nice-to-have | 백로그/문서. |

> 원칙: **P0/P1만** 기능 외 최소 수정 대상. P2/P3는 새 기능으로 확장하지 말고 기록.

---

## Category (영역 — 어디 문제인지)

| 카테고리 | 범위 |
|----------|------|
| OAuth / login | GitHub 로그인·연결, 토큰 |
| GitHub repo/PR 연결 | repo 목록, PR 목록/link, public repo 권한 |
| PR review result 이해 | 통과/안 맞음/확인 부족/결정 필요, 근거 |
| History / run detail | 기록 목록, 상세, 요약 |
| Item selection | 이번에 다룰 항목 picker, preset, 영속화 |
| Fix Pack | 수정 지시서 생성/복사/ZIP, ?action=fix-pack |
| Re-run | 남은 문제 다시 확인, ?fromRunId |
| Comparison | 자동 비교 패널, 이전→현재 전환, 4그룹 |
| PR comment | 비교 결과 comment preview/post, body 포맷 |
| Credit / safety | dry-run/allowance 배너, debit OFF |
| Performance | 로딩 시간, 응답성 |
| Copywriting | 문구/라벨/안내 |

---

## 기록 포맷 (이슈 1건)

```text
[등급][카테고리] 한 줄 제목
- 어디서(단계 A~L / route):
- 재현: (단계 / 입력)
- 기대 vs 실제:
- 캡처: (스크린샷 / 콘솔 / 네트워크 status·URL)
- 환경: dashboard URL / 시각 / repo·PR
```

예:
```text
[P1][Fix Pack] ?action=fix-pack 진입 시 자동 생성이 안 됨
- 어디서: history "남은 문제 Fix Pack" → /history/<runId>?action=fix-pack
- 재현: 버튼 클릭 → 상세 진입했으나 패널이 idle
- 기대: autoOpen+자동 생성 / 실제: 버튼만 보임
- 캡처: 콘솔 무에러, network /fix-brief 호출 없음
- 환경: <url> / 14:20 / 3SVS/My-first-product PR#1
```

---

## 분류 후 흐름

1. P0 발견 → 베타 일시중지, 최소 수정 → 재확인.
2. P1 모음 → 다음 스테이지 최소 수정 묶음.
3. P2/P3 → known issue 목록 + 카피/UX 백로그.
4. 모든 이슈는 카테고리별 집계 → 어느 영역이 약한지 파악.
