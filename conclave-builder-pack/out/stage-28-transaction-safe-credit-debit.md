> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 28 — Transaction-Safe Credit Debit (Reservation-First)

## 해결한 문제

Stage 26/27까지 남아 있던 concurrent double-debit 리스크:

```
기존 흐름:
  SELECT existing debit (idempotency check)
  → UPDATE balance
  → INSERT OR IGNORE ledger

리스크:
  요청 A와 B가 동시에 "SELECT existing debit → 없음" 확인
  → 둘 다 UPDATE balance 성공 (balance 두 번 감소)
  → ledger는 unique index로 하나만 남음
  → balance double-debit 발생 가능
```

---

## 새 reservation-first 흐름

```
1. INSERT OR IGNORE ledger (status='pending')
   → unique index = distributed lock
   → changes=0: 이미 reservation 존재 → duplicate 반환, balance 변경 없음
   → changes=1: 이 요청이 reservation 소유권 획득

2. (소유권 획득 시) UPDATE balance WHERE balance >= amount
   → changes=0: 잔액 부족 → UPDATE ledger SET status='failed' → insufficient_credits
   → changes=1: 차감 성공 → UPDATE ledger SET status='applied' → ok

이렇게 하면 같은 sourceEventId 동시 요청에서 하나만 2단계에 도달한다.
```

### 핵심 속성

| 상황 | 결과 |
|------|------|
| 첫 번째 요청, 잔액 충분 | reservation INSERT → balance UPDATE → status=applied |
| 두 번째 요청 (같은 ID) | INSERT 실패 (unique) → duplicate 반환 |
| 잔액 부족 요청 | reservation INSERT → balance UPDATE 실패 → status=failed |
| concurrent 동일 ID | 하나만 INSERT 성공 → 하나만 balance 차감 |

---

## Migration 0037

```sql
ALTER TABLE workspace_credit_ledger
ADD COLUMN status TEXT NOT NULL DEFAULT 'applied';
```

- 기존 row: `DEFAULT 'applied'` (실제 차감이 완료된 것들)
- 새 상태값: `pending`, `applied`, `failed`

---

## LedgerStatus 타입

```ts
export type LedgerStatus = "pending" | "applied" | "failed";
```

| 값 | 의미 |
|---|------|
| `pending` | reservation은 생성됐지만 balance 차감 전 (매우 짧은 과도 상태) |
| `applied` | balance 차감 완료 |
| `failed` | 잔액 부족 또는 DB 오류로 차감 실패 |

---

## failed ledger 재시도 정책

같은 sourceEventId로 failed ledger가 이미 있으면 **duplicate=true 반환**, 추가 차감 없음.

```
이유: 같은 sourceEventId는 같은 요청을 의미.
     실패도 idempotent하게 처리해야 재시도 폭풍을 막을 수 있다.

새로운 시도: 새 idempotencyKey → 새 sourceEventId → 새 reservation
```

---

## DebitCreditsResult 변경사항

```ts
// Before (Stage 26)
| { ok: true; duplicate: false; newBalance; ledgerEntryId; sourceEventId }
| { ok: true; duplicate: true; newBalance; ledgerEntryId; sourceEventId }
| { ok: false; error: "missing_source_event_id" | "insufficient_credits" | "race_condition" | "db_error" }

// After (Stage 28)
| { ok: true; duplicate: false; newBalance; ledgerEntryId; sourceEventId; ledgerStatus: "applied" }
| { ok: true; duplicate: true; newBalance; ledgerEntryId; sourceEventId; ledgerStatus: LedgerStatus }
| { ok: false; error: "missing_source_event_id" | "insufficient_credits" | "db_error" }
```

변경점:
- `duplicate` 결과에 `ledgerStatus` 추가 (applied/failed/pending)
- `race_condition` 오류 제거 (reservation-first로 해결됨)
- `ledgerStatus: "applied"` 성공 결과에 추가

---

## CreditEnforcementResult 변경사항

```ts
debit?: {
  attempted: boolean;
  applied: boolean;
  duplicate?: boolean;
  sourceEventId?: string;
  ledgerEntryId?: string;
  ledgerStatus?: "pending" | "applied" | "failed";  // Stage 28 추가
  newBalance?: number;
  error?: string;
};
```

---

## grantCredits INSERT 변경사항

```sql
-- Before
INSERT INTO workspace_credit_ledger
  (id, user_key, ..., direction, reason, source_event_id, metadata_json, created_at)
VALUES (?, ?, ..., 'grant', ?, NULL, ?, ?)

-- After (Stage 28)
INSERT INTO workspace_credit_ledger
  (id, user_key, ..., direction, reason, source_event_id, metadata_json, status, created_at)
VALUES (?, ?, ..., 'grant', ?, NULL, ?, 'applied', ?)
```

Grant는 즉시 적용이므로 `status='applied'`로 직접 삽입.

---

## Admin/Dashboard UI 변경사항

### `LedgerEntry` 타입 (workspace-admin-credits-api.ts)

```ts
export type LedgerStatus = "pending" | "applied" | "failed";

export type LedgerEntry = {
  id: string;
  creditType: CreditType;
  amount: number;
  direction: LedgerDirection;
  status: LedgerStatus;       // Stage 28 추가
  reason: string;
  ...
};
```

### `/admin/credits` LedgerTable

- "상태" 컬럼 추가 (유형 | 방향 | **상태** | 금액 | 사유 | 날짜)
- 상태별 색상:
  - `applied` → 초록 ("적용됨")
  - `failed` → 빨강 ("실패")
  - `pending` → 노란색 ("대기 중")

---

## 동시성 보장 (Race Condition Analysis)

### 순차 호출 ✅ (완벽 보장)

```
Request 1: INSERT pending (win) → UPDATE balance → applied
Request 2: INSERT pending (lose, changes=0) → fetch existing → duplicate
```

Balance 정확히 1회 감소. Tests 63, 65, 68.

### 동시 호출 ✅ (단일 reservation으로 보장)

```
R1 INSERT pending → changes=1 (WIN)
R2 INSERT pending → changes=0 (LOSE, unique index conflict) → immediately duplicate
R1 UPDATE balance → success
R1 UPDATE ledger status='applied'
```

R2는 balance UPDATE에 도달하지 못한다. Tests 69, 70.

### 이전 방식 vs 새 방식

```
이전: SELECT → UPDATE → INSERT
  둘 다 SELECT 통과 가능 → 둘 다 UPDATE 가능 → ledger 1개지만 balance 2회 감소

새: INSERT → UPDATE (소유권 획득 시에만)
  하나만 INSERT 성공 → 하나만 UPDATE 가능 → balance 1회만 감소
```

---

## 테스트 결과

**771/771** (이전 761 + 10 신규)

| # | 내용 |
|---|------|
| 06 | 수정: ledgerStatus='applied' 포함 확인 추가 |
| 07 | 수정: race_condition → insufficient_credits (changesOnUpdate=0) |
| 61 | 성공 debit → ledger status=applied |
| 62 | 잔액 부족 → ledger status=failed |
| 63 | duplicate(applied) → ledgerStatus=applied |
| 64 | duplicate(failed) → ledgerStatus=failed |
| 65 | failed duplicate은 balance 변경 없음 |
| 66 | grant → status=applied 기본값 |
| 67 | checkCreditEnforcement.debit.ledgerStatus=applied |
| 68 | checkCreditEnforcement duplicate → ledgerStatus 전파 |
| 69 | concurrent 동일 ID → balance 1회만 차감 |
| 70 | concurrent 동일 ID → ledger entry 1개만 |

---

## Production Safety 확인

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

Stage 28은 debit 인프라 재설계만. 두 flag가 `"true"`로 바뀌기 전까지 실제 차감 없음.

---

## CRITICAL: 변경 금지 항목

- production actual debit 활성화 금지
- production credit blocking 활성화 금지
- 결제 연동 금지
- plan gate 구현 금지
- private repo full support 금지
- autofix/patch/commit/branch 생성 금지
- GitHub status check 작성 금지
- landing 앱 수정 금지
- PR review result full cache 구현 금지

---

## Stage 29 전 결정 필요한 사항

1. **Production actual debit 활성화**: `ENABLE_ACTUAL_CREDIT_DEBITS="true"` 변경 타이밍 결정
2. **Credit top-up UX**: 잔액 충전 방법 (현재 admin grant만 가능)
3. **pending 타임아웃 처리**: 극도로 긴 리뷰 실행 중에 pending이 남을 경우 cleanup 정책
4. **failed entry 사용자 안내**: dashboard에서 "잔액 부족으로 실패한 이전 요청" 표시
5. **balance 부족 시 UI 안내 개선**: 현재 CreditDryRunBanner로 처리 중
