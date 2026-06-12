# Stage 23 — Monthly Credit Preview

## 목적

관리자가 월별 allowance 적용 후 예상 credit 부담을 사용자/프로젝트별로 사전에 파악할 수 있도록 한다.
실제 credit 차감 없음, 기능 차단 없음.

---

## 새 파일

없음 (Stage 23은 기존 파일 확장만)

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/central-plane/src/workspace/allowance-rules.ts` | `getPeriodFromMonthKey(monthKey)` 추가 |
| `apps/central-plane/src/workspace/credits.ts` | `CreditLedgerPreviewEntry` 타입 추가, `PreviewEntry.rawEventCount` 추가, `buildLedgerPreview` 함수 추가 |
| `apps/central-plane/src/routes/workspace-admin-credits.ts` | `GET /admin/credits/preview` 확장 (`allowanceSummary`, `enforcementSummary`, `ledgerPreview`), `GET /admin/credits/monthly-preview` 신규 추가 |
| `apps/central-plane/test/workspace-admin-credits.test.mjs` | mock 확장 (monthly user/project 쿼리 핸들러), 테스트 25-36 추가 |
| `apps/dashboard/src/lib/workspace-admin-credits-api.ts` | `CreditLedgerPreviewEntry`, `AllowanceSummary`, `MonthlyCreditPreviewResult` 타입 추가, `fetchMonthlyCreditPreview` 추가 |
| `apps/dashboard/src/app/admin/credits/page.tsx` | `MonthlyPreviewSection`, `LedgerPreviewTable` 컴포넌트 추가, 월별 조회 UI 섹션 추가 |
| `apps/dashboard/src/app/admin/usage/page.tsx` | "credit 미리보기 보기 →" 링크 추가 |

---

## 새 타입

### `CreditLedgerPreviewEntry`

```ts
type CreditLedgerPreviewEntry = {
  id: string;
  userKey: string;
  projectId?: string;
  eventType: string;
  creditType: CreditType;
  amount: number;
  direction: "preview_debit";     // 리터럴 — 실제 ledger와 구분
  reason: string;
  allowance?: {
    periodKey: string;
    includedRuns: number;
    usedBeforeThisEvent: number;
    coveredByAllowance: boolean;
  };
  balance: {
    currentBalance: number;
    wouldHaveRemainingBalance: number;
    wouldBlockIfEnforced: boolean;
  };
  createdAt: string;
};
```

- `direction: "preview_debit"` 리터럴 타입으로 실제 `workspace_credit_ledger` 행과 명확히 구분
- D1에 **절대 기록되지 않음**

### `AllowanceSummary`

```ts
type AllowanceSummary = {
  enabled: true;
  rule: string;                      // "월 5회 PR 코드 확인 무료"
  totalCoveredByAllowance: number;   // 이번 기간 allowance가 커버한 이벤트 수
  totalBillableAfterAllowance: number; // allowance 적용 후 billable 이벤트 수 (= totalEstimatedCredits)
};
```

### `MonthlyCreditPreviewResult`

```ts
type MonthlyCreditPreviewResult = {
  ok: true;
  actualDebitsEnabled: false;
  month: string;             // "2026-06"
  userKey?: string;
  allowanceRule: { eventType: string; includedRuns: number; creditType: string; };
  users: MonthlyUserSummary[];
  projects: MonthlyProjectSummary[];
};

type MonthlyUserSummary = {
  userKey: string;
  totalPrReviewRuns: number;
  coveredByAllowance: number;        // min(5, totalRuns) — 정확
  billableRuns: number;              // max(0, totalRuns - 5) — 정확
  estimatedReviewCredits: number;    // = billableRuns (creditCost=1)
  currentReviewBalance: number;
  wouldBlockCount: number;           // max(0, billableRuns - currentBalance)
};

type MonthlyProjectSummary = {
  projectId: string;
  totalPrReviewRuns: number;
  billableRuns: number;              // 비례 추정 (user allowance 적용 후)
  estimatedReviewCredits: number;
};
```

---

## 확장된 GET /admin/credits/preview 응답

```ts
{
  ok: true;
  actualDebitsEnabled: false;        // 항상 false
  range: "24h" | "7d" | "30d";
  totalEstimatedCredits: number;
  allowanceSummary: {                // Stage 23 신규
    enabled: true;
    rule: "월 5회 PR 코드 확인 무료";
    totalCoveredByAllowance: number;
    totalBillableAfterAllowance: number;
  };
  previewEntries: PreviewEntry[];
  enforcementPreview: { ... };       // 기존 필드 유지
  enforcementSummary: { ... };       // Stage 23 신규 (enforcementPreview와 동일 데이터)
  ledgerPreview: CreditLedgerPreviewEntry[];  // amount > 0인 항목만
}
```

---

## GET /admin/credits/monthly-preview

```
GET /admin/credits/monthly-preview?month=YYYY-MM&userKey=...
Authorization: x-admin-key
```

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `month` | `YYYY-MM` (선택) | 기본값: 현재 UTC 월 |
| `userKey` | string (선택) | 특정 사용자만 필터링 |

### 쿼리 2개 병렬 실행

1. `SELECT user_key, COUNT(*) as total_runs FROM workspace_usage_events WHERE event_type = 'workspace_pr_review_run' AND ... GROUP BY user_key LIMIT 50`
2. `SELECT user_key, project_id, COUNT(*) as total_runs FROM workspace_usage_events WHERE ... GROUP BY user_key, project_id LIMIT 100`

### allowance 계산

- 사용자별 정확 계산:
  - `coveredByAllowance = min(5, totalRuns)`
  - `billableRuns = max(0, totalRuns - 5)`
  - `wouldBlockCount = max(0, billableRuns - currentBalance)`
- 프로젝트별 비례 추정:
  - `projectBillable = round(projectRuns × userBillableRuns / userTotalRuns)`
  - 정확한 시간순 귀속이 불가하므로 비례 분배 사용 (admin 리포팅 목적)

---

## buildLedgerPreview 로직

```ts
function buildLedgerPreview(entries: PreviewEntry[]): CreditLedgerPreviewEntry[] {
  // 1. estimatedAmount > 0인 항목만 선택
  // 2. (userKey, creditType) 단위로 running balance 추적
  //    - first entry: currentBalance에서 시작
  //    - 이후 entry: remaining balance가 감소
  // 3. wouldBlockIfEnforced = current < amount
  // 결과: direction="preview_debit", D1 미기록
}
```

---

## allowanceSummary 계산

```ts
totalCoveredByAllowance = sum of (entry.rawEventCount - entry.estimatedAmount) for entries with allowance
// rawEventCount: previewCreditDebitFromUsageEvents에서 allowance 적용 전 원본 event count
// estimatedAmount: allowance 적용 후 billable credit 수 (creditCost=1이므로 billableRuns와 동일)
totalBillableAfterAllowance = totalEstimatedCredits
```

---

## 핵심 보장

1. `actualDebitsEnabled: false` 리터럴 타입 — 항상 고정
2. `buildLedgerPreview` — D1 쓰기 없음, 메모리 내 계산만
3. `GET /admin/credits/monthly-preview` — SELECT만, INSERT/UPDATE/DELETE 없음
4. `CreditLedgerPreviewEntry.direction = "preview_debit"` — 실제 ledger row와 타입 수준에서 구분
5. `wouldBlockCount > 0`이어도 실행 차단 없음 (dry-run only)

---

## dashboard 변경사항

### `/admin/credits` 신규 섹션

1. **Dry-run 차감 미리보기** 확장:
   - `allowanceSummary` 배너: 무료 커버/과금 후보 수 표시
   - `ledgerPreview` 테이블: 예상 차감 + 차감 후 잔액 + 차단 여부

2. **월별 Credit 미리보기** 신규 섹션:
   - 월 입력 (YYYY-MM, 미입력 시 이번 달)
   - userKey 필터 (선택)
   - 상단 알림: "실제 credit은 차감되지 않습니다"
   - 사용자별 테이블: PR확인수, 무료커버, credit후보, 예상credit, 현재잔액, 차단됐을실행
   - 프로젝트별 테이블: PR확인수, credit후보(추정), 예상credit

### `/admin/usage` 변경

헤더 우측에 "credit 미리보기 보기 →" 링크 추가 (→ `/admin/credits`)

---

## 테스트 결과

```
701/701 통과 (+12 신규)
  workspace-admin-credits.test.mjs — 36개 (기존 24 + 신규 12)
    25. allowanceSummary present
    26. totalBillableAfterAllowance matches totalEstimatedCredits
    27. totalCoveredByAllowance counts covered events
    28. ledgerPreview array present
    29. ledgerPreview only amount > 0
    30. ledgerPreview excludes covered entries
    31. ledgerPreview direction=preview_debit
    32. ledgerPreview no DB writes
    33. monthly-preview user summary with allowance
    34. monthly-preview wouldBlockCount uses balance
    35. monthly-preview userKey filter
    36. monthly-preview project summary
```

---

## Stage 24 TODO

- 실제 billing 활성화 준비 (`actualDebitsEnabled: true` flip 조건)
- credit 자동 충전 정책 설계
- 월별 allowance 이메일/Telegram 알림
