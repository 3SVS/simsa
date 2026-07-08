> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 26 — Credit Debit Idempotency

## 목표

동일한 credit debit source에 대해 ledger debit이 두 번 생성되지 않도록 막는다.
Production actual debit flag는 계속 OFF 상태를 유지한다.

---

## 추가한 Migration / Index

**`apps/central-plane/migrations/0036_workspace_credit_debit_idempotency.sql`**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_credit_ledger_debit_idempotency
  ON workspace_credit_ledger(user_key, source_event_id)
  WHERE direction = 'debit' AND source_event_id IS NOT NULL;
```

- `direction = 'debit'` 제한: grant/adjustment 엔트리는 영향 없음
- `source_event_id IS NOT NULL` 제한: NULL은 unique index에서 제외 (SQLite 동작)
- 중복 debit 시 `INSERT OR IGNORE`로 조용히 스킵

---

## sourceEventId 필수화

**`DebitCreditsInput.sourceEventId`**: 이제 필수 (`string`, `optional` 제거)

```ts
export type DebitCreditsInput = {
  userKey: string;
  creditType: CreditType;
  amount: number;
  reason: string;
  projectId?: string;
  sourceEventId: string;   // required
  metadata?: Record<string, unknown>;
};
```

누락 시 → `{ ok: false, error: "missing_source_event_id", currentBalance: 0 }`

**`generateDebitId()`** 새로 export:
```ts
export function generateDebitId(): string {
  return randId("prr");
}
```

---

## debitCredits duplicate 처리 방식

### DebitCreditsResult 새 타입

```ts
type DebitCreditsResult =
  | { ok: true; duplicate: false; newBalance: number; ledgerEntryId: string; sourceEventId: string }
  | { ok: true; duplicate: true; newBalance: number; ledgerEntryId: string; sourceEventId: string }
  | { ok: false; error: "missing_source_event_id" | "insufficient_credits" | "race_condition" | "db_error"; currentBalance: number };
```

변경점: `reason` → `error`, `"insufficient_balance"` → `"insufficient_credits"`, `duplicate` 필드 추가

### 흐름

```
1. sourceEventId 유효성 확인 (빈 문자열 → missing_source_event_id)
2. SELECT FROM workspace_credit_ledger WHERE user_key=? AND source_event_id=? AND direction='debit'
   → 존재하면: balance 조회 후 { ok:true, duplicate:true, ... } 즉시 반환 (D1 UPDATE 없음)
3. SELECT current balance
   → insufficient → { ok:false, error:"insufficient_credits" }
4. UPDATE balance WHERE balance >= amount  (optimistic lock)
   → changes=0 → { ok:false, error:"race_condition" }
5. INSERT OR IGNORE INTO ledger
   → changes=1: 정상 완료 → { ok:true, duplicate:false }
   → changes=0: concurrent race (balance decremented, insert ignored)
     → existing entry 조회 후 { ok:true, duplicate:true } 반환
```

---

## PR review sourceEventId 생성 방식 (Option A)

PR review 요청 시작 시점에 per-request ID 생성:

```ts
// workspace-github.ts (PR review endpoint)
const prReviewExecutionId = generateDebitId(); // "prr_..." 형식
// ...
creditEnforcement = await checkCreditEnforcement({
  env: c.env, userKey, eventType: "workspace_pr_review_run",
  projectId, sourceEventId: prReviewExecutionId,
});
```

**선택 이유 (Option A vs Option B):**
- Option A (request-scoped ID): 단순, review run 생성 전 debit 가능
- Option B (review run skeleton 먼저): 구조 변경 크고 에러 복잡
- Option A 채택 → `prr_` prefix로 ID 생성, checkCreditEnforcement에 전달

**idempotency 보장 범위:**
- 같은 request ID로 순차 호출 → 두 번째 호출은 `duplicate=true`, balance 변경 없음 ✅
- 다른 request ID (재시도 없는 double-click) → 각각 독립 debit (dashboard에서 버튼 disabled로 방지)
- 동시 concurrent 요청 동일 ID: step 2 통과 후 INSERT IGNORE로 balance double-debit 가능 (알려진 race caveat, 실제 발생 확률 매우 낮음)

---

## CreditEnforcementResult 변경사항

```ts
// Before (Stage 24)
debit?: {
  ok: boolean;
  newBalance?: number;
  ledgerEntryId?: string;
  reason?: "insufficient_balance" | "race_condition" | "db_error";
};

// After (Stage 26)
debit?: {
  attempted: boolean;    // debit이 시도됐는가
  applied: boolean;      // 실제 balance 감소됐는가 (duplicate=true면 false)
  duplicate?: boolean;   // true = 같은 sourceEventId 이미 처리됨
  sourceEventId?: string;
  ledgerEntryId?: string;
  newBalance?: number;
  error?: string;
};
```

**`checkCreditEnforcement`** 내부: `sourceEventId` 없으면 `generateDebitId()`로 자동 생성

---

## Dashboard / Admin UI 변경사항

### `CreditDryRunBanner` 케이스 매핑 (Stage 26 추가)

| 상태 | 배너 | headerLabel | footerNote |
|------|------|-------------|------------|
| `blocked=true` | 🔴 red | "credit 부족으로 실행이 차단됨" | `잔액: N · 필요: M` |
| `debit.duplicate=true` | 🔵 indigo | "이미 처리된 credit 차감 요청" | "이미 처리된 credit 차감 요청이라 추가 차감은 하지 않았어요." |
| `debit.applied=true` | 🔵 indigo | "credit 차감됨" | `잔액: N review credit` |
| `debit.applied=false` (error) | 🟡 amber | "credit 차감 실패" | `차감 오류: <error>` |
| `insufficientButAllowed` | 🟡 amber | "잔액 부족이지만 실행 허용" | "잔액 부족 · 차감 없음..." |
| covered | 🟢 green | "월 무료 제공량 안에 포함" | — |
| dry-run | 🔵 blue | "예상 credit 확인" | — |

`debitOk` 감지 조건 변경:
```tsx
// Before
const debitOk = actualDebitsEnabled && enforcement.debit?.ok === true;
// After
const debitOk = actualDebitsEnabled && enforcement.debit?.attempted === true
  && enforcement.debit?.applied === true && !enforcement.debit?.duplicate;
const debitDuplicate = actualDebitsEnabled && enforcement.debit?.duplicate === true;
```

`footerNote` duplicate 오류 필드:
```tsx
// Before: enforcement.debit?.reason
// After:  enforcement.debit?.error
```

---

## Race condition 검토 결과

### 순차 호출 (Primary target) ✅

```
Request 1: step 2 → no existing → UPDATE → INSERT → duplicate:false
Request 2: step 2 → FOUND existing → return duplicate:true (no UPDATE)
```

Balance 정확히 1회만 감소. 검증: tests 32, 33, 37, 38, 42.

### 동시 concurrent 호출 (알려진 edge case) ⚠️

```
R1 + R2 both pass step 2 (no existing)
R1 UPDATE success, R2 UPDATE success (only if balance >= 2)
R1 INSERT OR IGNORE success (changes=1)
R2 INSERT OR IGNORE ignored (changes=0) → R2 fetches R1's entry → duplicate:true
```

Balance가 2 감소할 수 있음. 단, INSERT OR IGNORE 덕분에 ledger entry는 정확히 1개.
실제 발생 조건: 동일 sourceEventId + 동일 ms내 동시 요청. Dashboard 버튼 disabled 처리로 실용적 방지.

### 대응 방향 (Stage 27 이후)

- Dashboard: 버튼 클릭 시 `prReviewExecutionId` 생성 후 in-flight 동안 disabled
- Optional: `Idempotency-Key` request header 지원

---

## Production Safety 확인

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

Stage 26는 idempotency 인프라만 추가. Production에서 실제 차감은 두 flag가 모두 `"true"`로 바뀌기 전까지 발생하지 않는다.

---

## 테스트 결과

**744/744** (이전 735 + 9 신규)

| # | 내용 |
|---|------|
| 32 | 동일 sourceEventId 두 번째 호출 → duplicate=true |
| 33 | 동일 sourceEventId 두 번 후 balance=1 (1회만 차감) |
| 34 | missing sourceEventId → error:"missing_source_event_id" |
| 35 | 첫 번째 호출 → duplicate:false, sourceEventId 포함 |
| 36 | 두 번째 동일 ID → duplicate:true |
| 37 | 두 번째 호출 balance 미차감 확인 |
| 38 | 두 번째 호출 ledger entry 미생성 확인 |
| 39 | 다른 sourceEventId → 독립 차감 (두 번 모두 applied:true) |
| 40 | checkCreditEnforcement debit 필드 attempted/applied/sourceEventId |
| 41 | checkCreditEnforcement 동일 ID 두 번 → duplicate:true, applied:false |
| 42 | checkCreditEnforcement 동일 ID 두 번 → balance=4 (1회만) |

**기존 테스트 수정:**
- 05: `reason` → `error`, `"insufficient_balance"` → `"insufficient_credits"`
- 06: `duplicate:false`, `sourceEventId` 포함 확인 추가
- 07-08: `reason` → `error`
- 12, 25, 26: `debit?.ok` → `debit?.applied`
- 32-33: Stage 25 gap doc → Stage 26 idempotency 동작 확인으로 교체

---

## CRITICAL: 변경 금지 항목

- production actual debit 활성화 금지
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

---

## Stage 27 전 결정 필요한 사항

1. **Dashboard retry key**: 재시도 시 같은 `prReviewExecutionId`를 재사용할지 여부. 현재는 버튼 클릭마다 새 ID 생성 → 재시도도 새 debit.
2. **Production actual debit 활성화 타이밍**: `ENABLE_ACTUAL_CREDIT_DEBITS="true"` 변경 기준 결정.
3. **Credit top-up / 외부 구매 연결**: 실제 차감 켠 이후 balance 충전 방법 정의.
4. **Concurrent race hardening**: INSERT OR IGNORE 후 balance double-debit 방어가 필요하다면 D1 batch (UPDATE + INSERT 원자 실행) 도입 검토.
