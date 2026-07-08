> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 21 — Credit Enforcement Dry-run

## 목적

PR 코드 확인 실행 전에 credit 충분 여부를 계산하고,
부족하면 `wouldBlock=true`로 알려주지만,
**실제 실행은 막지 않고, credit도 차감하지 않는다.**

---

## 새 파일

| 파일 | 역할 |
|------|------|
| `apps/central-plane/src/workspace/credit-enforcement.ts` | dry-run enforcement helper |
| `apps/central-plane/test/workspace-credit-enforcement.test.mjs` | 17개 테스트 |

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/central-plane/src/workspace/credits.ts` | `PreviewEntry`에 `currentBalance?` + `wouldBlockIfEnforced?` 추가, 잔액 어노테이션 로직 |
| `apps/central-plane/src/routes/workspace-github.ts` | review endpoint step 5b: dry-run 호출 + response에 `creditDryRun` 추가 |
| `apps/central-plane/src/routes/workspace-admin-credits.ts` | preview response에 `enforcementPreview` 추가 |
| `apps/dashboard/src/lib/workspace-github-api.ts` | `CreditEnforcementDryRun` 타입 + `StartReviewResponse` 확장 |
| `apps/dashboard/src/lib/workspace-admin-credits-api.ts` | `PreviewEntry`, `PreviewResult`, `EnforcementPreview` 타입 확장 |
| `apps/dashboard/src/app/projects/[id]/github/page.tsx` | `creditDryRunByPr` state + `CreditDryRunBanner` 컴포넌트 |
| `apps/dashboard/src/app/admin/credits/page.tsx` | `EnforcementSummaryBanner` + wouldBlockIfEnforced 컬럼 |

---

## credit enforcement helper 구조

```ts
type CreditEnforcementDryRun = {
  actualDebitsEnabled: false;  // 항상 false
  wouldBlock: boolean;         // balance < required
  billingStatus: BillingStatus;
  eventType: string;
  creditType?: CreditType;
  requiredCredits: number;     // billing rule creditCost
  currentBalance: number;      // D1에서 조회한 현재 잔액
  remainingAfter: number;      // max(0, currentBalance - required)
  message: string;             // 한국어 안내 메시지
};

async function checkCreditEnforcementDryRun({ env, userKey, eventType })
```

**정책:**
- `included` / `ignored` → `requiredCredits=0`, `wouldBlock=false`, 잔액 조회 없음
- `billable_candidate` → 잔액 조회, `currentBalance < requiredCredits` 이면 `wouldBlock=true`
- `actualDebitsEnabled: false` 항상 고정
- D1 쓰기 없음 (잔액 테이블 변경 없음, 장부 INSERT 없음)

---

## PR review endpoint 연결 방식

```
POST /workspace/projects/:id/github/pulls/:number/review
  step 5  — items + productSpec 로드
  step 5b — checkCreditEnforcementDryRun (비차단, 실패해도 계속 진행)
  step 6  — DB에 run 생성
  step 7  — PR 파일 가져오기
  step 8  — LLM 리뷰 실행
  step 9  — 결과 저장
  step 9b — usage event 기록
  step 10 — Telegram 알림
  return  → { ok, run, creditDryRun?, warnings? }
```

`creditDryRun.wouldBlock=true`여도 실행은 계속 진행됩니다.

---

## response creditDryRun shape

```json
{
  "ok": true,
  "run": { ... },
  "creditDryRun": {
    "actualDebitsEnabled": false,
    "wouldBlock": false,
    "billingStatus": "billable_candidate",
    "eventType": "workspace_pr_review_run",
    "creditType": "review",
    "requiredCredits": 1,
    "currentBalance": 5,
    "remainingAfter": 4,
    "message": "이 실행은 1 review credit이 필요할 예정입니다. 현재는 실제 차감하지 않습니다."
  }
}
```

credit 부족 시:
```json
{
  "wouldBlock": true,
  "currentBalance": 0,
  "remainingAfter": 0,
  "message": "review credit이 부족할 예정이지만, 현재는 테스트 기간이라 실행을 막지 않습니다."
}
```

---

## dashboard 표시 방식

### `/projects/:id/github` 페이지

review 완료 후 `ReviewResultPanel` 바로 아래에 `CreditDryRunBanner` 표시.

- **credit 충분** (`wouldBlock=false`): 파란 배너 — "예상 credit 확인 / 이 실행은 1 review credit이 필요할 예정입니다. 현재는 실제 차감하지 않습니다."
- **credit 부족** (`wouldBlock=true`): 주황 배너 — "review credit이 부족할 예정이지만, 테스트 기간이라 실행을 막지 않습니다."
- `included` / `ignored` billingStatus → 배너 숨김
- 모든 경우: "실제 차감 없음 · 실행은 허용됨" 표시

### `/admin/credits` 페이지

- preview 테이블에 **잔액**, **예상 차감**, **부족 여부** (`credit 부족 예상` / `credit 충분`) 컬럼 추가
- `EnforcementSummaryBanner`: "차감 시 credit 부족 예상: N / M건"

---

## admin preview 확장

`GET /admin/credits/preview` 응답에 `enforcementPreview` 추가:

```json
{
  "ok": true,
  "actualDebitsEnabled": false,
  "totalEstimatedCredits": 5,
  "previewEntries": [
    {
      "userKey": "gh:octocat",
      "eventType": "workspace_pr_review_run",
      "creditType": "review",
      "estimatedAmount": 3,
      "currentBalance": 1,
      "wouldBlockIfEnforced": true,
      "reason": "PR 코드 확인 × 3회 예상",
      "createdAt": "..."
    }
  ],
  "enforcementPreview": {
    "actualDebitsEnabled": false,
    "wouldBlockCount": 1,
    "checkedEventCount": 1
  }
}
```

`previewCreditDebitFromUsageEvents`가 각 entry의 `(userKey, creditType)` 잔액을 D1에서 조회 후 어노테이션.
동일한 pair는 한 번만 조회 (Map 캐싱).

---

## 실제 차감/차단이 아닌 점 보장

1. `credit-enforcement.ts` — DB prepare/bind/run 없음, SELECT만 사용
2. `workspace-github.ts` — dry-run 실패해도 `try/catch`로 non-fatal 처리, review 실행 계속
3. `actualDebitsEnabled` 타입이 `false` (리터럴 타입) — `true`로 설정 불가
4. ledger에 debit INSERT 없음 (Stage 21에서 debit 경로 없음)

---

## typecheck/build/test 결과

```
pnpm build  → clean (TypeScript strict)
tsc --noEmit (dashboard) → clean
667/667 tests pass (17 new tests in workspace-credit-enforcement.test.mjs)
```

---

## Stage 22 전 결정 필요한 점

1. **실제 차감 활성화 조건**: `actualDebitsEnabled: true`로 바꿀 조건 (베타 종료, 결제 연동 완료 등)
2. **차단 정책**: `wouldBlock=true` 시 실행을 막을지, 경고만 줄지
3. **무료 allowance**: "매월 N 크레딧 무료 포함" 정책 D1 반영 여부
4. **credit 자동 지급**: 가입 시 또는 특정 이벤트 시 자동으로 grant_credits를 트리거할지
