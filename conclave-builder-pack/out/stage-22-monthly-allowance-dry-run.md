> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 22 — Monthly Allowance Dry-run

## 목적

워크스페이스당 매월 5회 PR 코드 확인을 무료로 제공하는 정책을 dry-run으로 계산하고,
실제 credit 차감 및 기능 차단 없이 UI에 안내한다.

---

## 새 파일

| 파일 | 역할 |
|------|------|
| `apps/central-plane/src/workspace/allowance-rules.ts` | 월 allowance 규칙 정의 + period 헬퍼 |
| `apps/central-plane/src/workspace/allowance-usage.ts` | `getAllowanceDryRun` — D1 읽기 전용 |
| `apps/central-plane/test/workspace-allowance.test.mjs` | 15개 테스트 |

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/central-plane/src/workspace/credit-enforcement.ts` | `allowance?` 필드 추가, `getAllowanceDryRun` 호출, 메시지 업데이트 |
| `apps/central-plane/src/workspace/credits.ts` | `PreviewEntry.allowance?` 추가, `previewCreditDebitFromUsageEvents` allowance 적용 |
| `apps/central-plane/test/workspace-credit-enforcement.test.mjs` | mock 업데이트 (COUNT 쿼리 처리), 기존 테스트 allowance-aware 수정, 신규 3개 |
| `apps/central-plane/test/workspace-admin-credits.test.mjs` | mock 업데이트, 기존 3개 수정, 신규 4개 |
| `apps/dashboard/src/lib/workspace-github-api.ts` | `CreditEnforcementDryRun.allowance?` 추가 |
| `apps/dashboard/src/lib/workspace-admin-credits-api.ts` | `PreviewEntry.allowance?` 추가 |
| `apps/dashboard/src/app/projects/[id]/github/page.tsx` | `CreditDryRunBanner` allowance-aware (초록/파랑/주황) |
| `apps/dashboard/src/app/admin/credits/page.tsx` | 미리보기 테이블에 "무료 제공량" 컬럼 추가 |

---

## allowance 규칙 구조

```ts
type MonthlyAllowanceRule = {
  eventType: string;
  label: string;
  period: "monthly";
  includedRuns: number;   // 5
  creditType: CreditType; // "review"
};
```

현재 규칙:
- `workspace_pr_review_run`: 월 5회 무료

---

## period 계산

```ts
getCurrentAllowancePeriod(now?: Date): { periodKey: string; periodStart: string; periodEnd: string }
// periodKey: "2026-06"
// periodStart: "2026-06-01T00:00:00.000Z"  (UTC 월 시작)
// periodEnd:   "2026-07-01T00:00:00.000Z"  (UTC 다음 달 시작)
```

---

## AllowanceDryRun 타입

```ts
type AllowanceDryRun = {
  enabled: true;
  eventType: string;
  period: "monthly";
  periodKey: string;        // "2026-06"
  includedRuns: number;     // 5
  usedThisPeriod: number;   // D1에서 조회한 이번 달 사용 횟수
  remainingIncludedRuns: number; // max(0, 5 - used)
  coveredByAllowance: boolean;   // remaining > 0
  billableUnitsAfterAllowance: number; // 0 또는 1
};
```

---

## checkCreditEnforcementDryRun 변경사항

```
billable_candidate 이벤트 처리 순서:
  1. getAllowanceDryRun → allowance 체크
  2. coveredByAllowance=true → requiredCredits=0, wouldBlock=false (잔액 무관)
  3. coveredByAllowance=false → requiredCredits=1, wouldBlock=(balance < 1)
  4. 잔액은 항상 조회 (informational)
```

메시지:
- 커버됨: "이번 PR 코드 확인은 월 무료 제공량 안에 포함됩니다. 현재는 실제 credit을 차감하지 않습니다."
- 커버 안 됨 + 잔액 충분: "월 무료 제공량을 초과하면 1 review credit이 필요할 예정입니다. 현재는 실제 차감하지 않습니다."
- 커버 안 됨 + 잔액 부족: "월 무료 제공량을 초과했고 review credit이 부족할 예정입니다. 현재는 테스트 기간이라 실행을 막지 않습니다."

---

## previewCreditDebitFromUsageEvents 변경사항

allowance 적용 알고리즘:
```
currentMonthCount = D1 SELECT COUNT(*) for (userKey, eventType) in current period
usedBeforeThisEvent = max(0, currentMonthCount - entry.count)
coveredRuns = max(0, min(includedRuns - usedBeforeThisEvent, entry.count))
estimatedAmount = max(0, entry.count - coveredRuns) * creditCost
```

- 기존 `if (estimatedAmount <= 0) continue;` 필터 제거 → 커버된 항목도 표시 (estimatedAmount=0)
- `PreviewEntry.allowance?` 필드 추가:
  ```ts
  { periodKey, includedRuns, usedBeforeThisEvent, coveredByAllowance }
  ```

---

## dashboard 표시

### `/projects/:id/github` — CreditDryRunBanner

| 상태 | 색상 | 헤더 |
|------|------|------|
| coveredByAllowance=true | 초록 | "월 무료 제공량 안에 포함" |
| allowance 초과, balance 충분 | 파랑 | "예상 credit 확인" |
| allowance 초과, balance 부족 | 주황 | "예상 credit 확인" |

이번 달 사용량 / 남은 무료 횟수 표시: `이번 달 사용: N / 5회 · 남은 무료 K회`

### `/admin/credits` — 미리보기 테이블

추가 컬럼 "무료 제공량":
- 커버됨: `무료 (2026-06)` (초록 배지)
- 초과됨: `초과 (5/5)` (회색 배지)
- 해당 없음: `—`

---

## 핵심 보장

1. `actualDebitsEnabled: false` 리터럴 타입 — 항상 고정
2. `getAllowanceDryRun` — SELECT COUNT만, 쓰기 없음
3. `checkCreditEnforcementDryRun` — 쓰기 없음, allowance 실패해도 non-fatal (try/catch)
4. `coveredByAllowance=true`여도 잔액 조회 (정보 제공 목적)
5. `wouldBlock=true`여도 review 실행 계속 (endpoint try/catch non-fatal)
6. `totalEstimatedCredits`는 allowance 적용 후 계산 → 0이면 "과금 후보 없음"

---

## 테스트 결과

```
690/690 통과 (+23 신규)
  workspace-allowance.test.mjs      — 15개 신규 (rules, period, getAllowanceDryRun)
  workspace-credit-enforcement.test.mjs — 20개 (기존 12→20, allowance-aware 수정 + 3 신규)
  workspace-admin-credits.test.mjs  — 24개 (기존 20→24, 3개 수정 + 4 신규)
```

---

## Stage 23 TODO (admin usage-stats allowanceSummary)

`GET /admin/usage-stats` dryRunBilling에 `allowanceSummary` 추가는 Stage 23으로 이관.
이유: `computeDryRunBilling`이 aggregated rows를 처리하므로 추가 per-user COUNT 쿼리 필요 —
현재 preview 엔드포인트와 동일한 구조 확장이 필요함.

추가 시 포함 내용:
```ts
allowanceSummary: {
  enabled: true;
  rule: "workspace_pr_review_run → 5/month";
  totalCoveredByAllowance: number;
  totalBillableAfterAllowance: number;
}
```
