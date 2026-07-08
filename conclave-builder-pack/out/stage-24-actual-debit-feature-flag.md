> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 24 — Actual Debit Feature Flag Skeleton

## 목적

실제 credit 차감을 위한 feature flag 기반 인프라를 구축한다.
두 flag 모두 기본값은 `false` — production은 dry-run 상태를 유지한다.

---

## 핵심 보장

1. `ENABLE_ACTUAL_CREDIT_DEBITS` 미설정 / `"false"` → D1 balance UPDATE 없음
2. `ENABLE_CREDIT_BLOCKING` 미설정 / `"false"` → HTTP 402 반환 없음
3. 두 flag 모두 `"true"` 이어야 blocking이 활성화됨
4. blocking만 true이고 actualDebits가 false면 차단 없음
5. `debitCredits()` — `WHERE balance >= ?` 낙관적 잠금으로 race condition 방지

---

## 새 파일

### `apps/central-plane/src/workspace/credit-config.ts`

```ts
export type CreditExecutionConfig = {
  actualDebitsEnabled: boolean;
  blockingEnabled: boolean;
};

export function getCreditExecutionConfig(env: Env): CreditExecutionConfig {
  return {
    actualDebitsEnabled: env.ENABLE_ACTUAL_CREDIT_DEBITS === "true",
    blockingEnabled: env.ENABLE_CREDIT_BLOCKING === "true",
  };
}
```

---

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `apps/central-plane/src/env.ts` | `ENABLE_ACTUAL_CREDIT_DEBITS?: string`, `ENABLE_CREDIT_BLOCKING?: string` 추가 |
| `apps/central-plane/src/workspace/credits.ts` | `debitCredits()` export 추가 |
| `apps/central-plane/src/workspace/credit-enforcement.ts` | `CreditEnforcementResult` 타입 + `checkCreditEnforcement()` 추가, `getCreditExecutionConfig` import |
| `apps/central-plane/src/routes/workspace-admin-credits.ts` | `GET /admin/credits/config` 엔드포인트 추가 |
| `apps/central-plane/src/routes/workspace-github.ts` | PR review → `checkCreditEnforcement()` 사용, blocked=true 시 HTTP 402 반환 |
| `apps/central-plane/wrangler.toml` | `ENABLE_ACTUAL_CREDIT_DEBITS="false"`, `ENABLE_CREDIT_BLOCKING="false"` 추가 |
| `apps/dashboard/src/lib/workspace-github-api.ts` | `CreditEnforcementResult` 타입 추가, `StartReviewResponse` 확장 |
| `apps/dashboard/src/lib/workspace-admin-credits-api.ts` | `CreditExecutionConfigResult` 타입 + `fetchCreditConfig()` 추가 |
| `apps/dashboard/src/app/admin/credits/page.tsx` | 설정 섹션 + `handleFetchConfig()` 추가 |
| `apps/dashboard/src/app/projects/[id]/github/page.tsx` | `CreditDryRunBanner` 확장 (차감됨/차감 실패/차단 상태 표시), `CreditEnforcementResult` import |

---

## 새 타입

### `CreditEnforcementResult`

```ts
type CreditEnforcementResult = {
  actualDebitsEnabled: boolean;   // boolean (not literal false)
  blocked: boolean;               // true → caller returns HTTP 402
  wouldBlock: boolean;            // true → insufficient credit (dry-run or actual)
  billingStatus: BillingStatus;
  eventType: string;
  creditType?: CreditType;
  requiredCredits: number;
  currentBalance: number;
  remainingAfter: number;
  message: string;
  debit?: {
    ok: boolean;
    newBalance?: number;
    ledgerEntryId?: string;
    reason?: "insufficient_balance" | "race_condition" | "db_error";
  };
  allowance?: { ... };  // same as CreditEnforcementDryRun
};
```

### `DebitCreditsResult`

```ts
type DebitCreditsResult =
  | { ok: true; newBalance: number; ledgerEntryId: string }
  | { ok: false; reason: "insufficient_balance" | "race_condition" | "db_error"; currentBalance: number };
```

---

## `debitCredits()` 로직

```
1. SELECT balance FROM workspace_credit_balances WHERE user_key=? AND credit_type=?
   → currentBalance=0: return {ok:false, reason:"insufficient_balance"}
2. UPDATE ... SET balance = balance - ? WHERE user_key=? AND credit_type=? AND balance >= ?
   → meta.changes=0: return {ok:false, reason:"race_condition"}
3. INSERT INTO workspace_credit_ledger direction='debit'
4. return {ok:true, newBalance, ledgerEntryId}
```

---

## `checkCreditEnforcement()` 로직

```
1. getCreditExecutionConfig(env)
2. getBillingRule(eventType) → non-billable: return blocked=false, debit absent
3. getAllowanceDryRun() → coveredByAllowance=true: requiredCredits=0
4. getCreditBalance() → currentBalance
5. wouldBlock = !covered && balance < required
6. blocked = actualDebitsEnabled && blockingEnabled && wouldBlock
7. if actualDebitsEnabled && required > 0 && !wouldBlock:
     debit = await debitCredits(...)
8. return { actualDebitsEnabled, blocked, wouldBlock, ..., debit? }
```

---

## GET /admin/credits/config 응답

```json
{
  "ok": true,
  "actualDebitsEnabled": false,
  "blockingEnabled": false,
  "envFlags": {
    "ENABLE_ACTUAL_CREDIT_DEBITS": "(unset)",
    "ENABLE_CREDIT_BLOCKING": "(unset)"
  }
}
```

---

## PR review 엔드포인트 변경

```
POST /workspace/projects/:id/github/pulls/:number/review

변경 전: checkCreditEnforcementDryRun() → non-blocking
변경 후: checkCreditEnforcement()
  → blocked=true: return 402 { ok:false, error:"insufficient_credits", creditEnforcement }
  → blocked=false: 기존 흐름 유지, response에 creditEnforcement 포함
```

---

## wrangler.toml 추가

```toml
# Stage 24 — Credit execution feature flags (default false = dry-run only).
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

---

## Dashboard 변경

### `/admin/credits` — Credit 실행 설정 섹션

- "설정 확인" 버튼 → `GET /admin/credits/config`
- env flag 값 + 해석된 boolean 표시
- 상태별 설명:
  - 둘 다 false: "현재 dry-run 모드: 실제 차감 없음, 실행 차단 없음"
  - actualDebits=true + blocking=false: "실제 차감 활성 · 차단 비활성"
  - 둘 다 true: "실제 차감 + 차단 모두 활성: credit 부족 시 HTTP 402 반환"

### CreditDryRunBanner (github/page.tsx)

- `actualDebitsEnabled=true` + `debit.ok=true`: "credit 차감됨" (인디고 배너)
- `actualDebitsEnabled=true` + `debit.ok=false`: "credit 차감 실패" (앰버 배너)
- `actualDebitsEnabled=false`: 기존 dry-run 배너 유지

---

## 표현 가이드

| 상황 | 사용자 노출 메시지 |
|------|-------------------|
| allowance 커버 | "월 무료 제공량 안에 포함" |
| 차감 완료 | "credit 차감됨" |
| 차감 실패 (잔액 부족) | "credit 차감 실패 · 잔액 부족" |
| 차단됨 (HTTP 402) | "credit 부족으로 실행이 차단됨" |
| dry-run 모드 | "예상 credit 확인 (차감 없음)" |

---

## 테스트 결과

```
20개 신규 (workspace-credit-config.test.mjs):
  01-04: getCreditExecutionConfig flag parsing
  05-08: debitCredits D1 write + race condition + db_error
  09-14: checkCreditEnforcement blocking logic
  15-18: GET /admin/credits/config endpoint
  19-20: PR review 402 / dry-run pass-through
```

---

## CRITICAL: 변경 금지 항목

- production에서 actual debit 기본값 true 금지
- 실제 결제 연동 금지 (LemonSqueezy/Stripe)
- plan gate 구현 금지
- 가입 시 자동 credit grant 금지
- private repo full support 금지
- repo scope 강제 확대 금지
- Telegram webhook 구현 금지
- autofix pipeline 연결 금지
- patch/commit/branch 생성 금지
- GitHub status check 작성 금지
- landing 앱 수정 금지
- 기존 review/autofix pipeline 동작 변경 금지
