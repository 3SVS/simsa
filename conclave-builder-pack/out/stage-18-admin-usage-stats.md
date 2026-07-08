> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 18 — Admin 사용 현황

## 개요

워크스페이스 기능 사용 이벤트를 집계해 운영자가 조회할 수 있는 어드민 엔드포인트와 대시보드 페이지를 추가합니다.

성공 기준: ADMIN_USAGE_STATS_KEY를 아는 운영자가 `GET /admin/usage-stats?range=7d`를 호출하면 이벤트 집계, 활성 사용자 수, Telegram 실패율, LLM 폴백률을 반환받을 수 있습니다.

---

## 추가한 env

```text
ADMIN_USAGE_STATS_KEY  — 어드민 엔드포인트 접근 키 (wrangler secret put ADMIN_USAGE_STATS_KEY)
                         없으면 503 disabled, 틀리면 401 unauthorized
```

설정 방법:
```bash
# 별도 터미널에서 실행
cd apps/central-plane
npx wrangler secret put ADMIN_USAGE_STATS_KEY
# 프롬프트에 값 입력 (긴 랜덤 문자열 권장)
```

---

## 추가한 UsageEventType (usage-events-db.ts)

```ts
| "workspace_idea_to_spec_generated"      // 제품 설명서 생성 (신규)
| "workspace_telegram_notification_sent"  // Telegram 알림 전송 (신규)
| "workspace_telegram_notification_error" // Telegram 알림 실패 (신규)
// 기존 유지
| "workspace_pr_review_run"
| "workspace_pr_comment_posted"
| "workspace_pr_comment_updated"
| "workspace_fix_pack_exported"
```

---

## 추가한 insertUsageEvent 호출

| 위치 | 이벤트 타입 | 조건 |
|---|---|---|
| `workspace.ts` — POST /workspace/idea-to-spec-draft | `workspace_idea_to_spec_generated` | 생성 성공 후 |
| `workspace-github.ts` — POST .../review | `workspace_pr_review_run` | 리뷰 완료 후 (step 9b) |

(Telegram sent/error는 Stage 17에서 이미 기록 중이었고, 이번에 UsageEventType union에만 추가)

---

## 추가한 endpoint

```text
GET /admin/usage-stats?range=24h|7d|30d
```

### 헤더

```text
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

### 응답 예시 (200 OK)

```json
{
  "ok": true,
  "range": "7d",
  "cutoff": "2026-06-05T12:00:00.000Z",
  "summary": {
    "totalEvents": 42,
    "activeUsers": 5,
    "telegramErrorRate": 3.57,
    "llmFallbackRate": 0.00
  },
  "byEventType": [
    { "eventType": "workspace_pr_review_run", "label": "PR 코드 확인", "count": 18 },
    { "eventType": "workspace_pr_comment_posted", "label": "PR 코멘트 작성", "count": 12 },
    { "eventType": "workspace_idea_to_spec_generated", "label": "제품 설명서 생성", "count": 8 }
  ],
  "topUsers": [
    { "userKey": "uk_abc123", "count": 15 }
  ],
  "dailyActivity": [
    { "date": "2026-06-10", "count": 8 },
    { "date": "2026-06-11", "count": 12 },
    { "date": "2026-06-12", "count": 22 }
  ]
}
```

### 오류 응답

```json
// ADMIN_USAGE_STATS_KEY 미설정
{ "ok": false, "error": "disabled", "message": "ADMIN_USAGE_STATS_KEY가 설정되지 않았습니다." }  // 503

// 키 불일치
{ "ok": false, "error": "unauthorized" }  // 401
```

---

## 이벤트 레이블 매핑

| eventType | label |
|---|---|
| workspace_idea_to_spec_generated | 제품 설명서 생성 |
| workspace_pr_review_run | PR 코드 확인 |
| workspace_pr_comment_posted | PR 코멘트 작성 |
| workspace_pr_comment_updated | PR 코멘트 수정 |
| workspace_fix_pack_exported | 수정 지시서 내보내기 |
| workspace_telegram_notification_sent | Telegram 알림 전송 |
| workspace_telegram_notification_error | Telegram 알림 실패 |
| (기타) | eventType 그대로 표시 |

---

## 실패율 계산

### telegramErrorRate

```
telegramErrorRate = telegram_error / (telegram_sent + telegram_error) × 100
```

- 분모가 0이면 0% 반환

### llmFallbackRate

```
llmFallbackRate = pr_review_runs with metadata_json LIKE '%mock-fallback%'
                  / total pr_review_runs × 100
```

- 분모가 0이면 0% 반환
- `workspace_pr_review_run` 이벤트의 `metadata_json`에 `source` 필드가 포함됨

---

## dashboard 어드민 페이지

위치: `/admin/usage`

구성:
- Admin Key 입력 (password input)
- 기간 선택 (24h / 7d / 30d)
- 조회 버튼
- 요약 카드 4개 (총 이벤트 / 활성 사용자 / Telegram 실패율 / LLM 폴백률)
  - 실패율 > 10% 또는 폴백률 > 30% 시 amber 하이라이트
- 기능별 이벤트 표 (eventType + label + 횟수)
- 일별 이벤트 표
- 활성 사용자 Top 10 표

Admin Key는 입력 시에만 사용되며 로컬 스토리지에 저장되지 않습니다.

---

## 아직 billing/private repo/autofix가 아닌 점

- billing/credit 차감 없음
- private repo 지원 없음
- autofix pipeline 연결 없음
- patch/commit/branch 생성 없음
- GitHub status check 없음
- Telegram webhook 없음

---

## typecheck/build/test 결과

- typecheck: ✅ clean
- build: ✅ (central-plane)
- tests: 621/621 pass (+20 new in workspace-admin-stats.test.mjs)
- commit: (이 파일 커밋과 함께 기록될 예정)
