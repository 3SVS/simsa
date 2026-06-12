# Stage 32 — 내부 Actual Debit 테스트 실행 가이드

> **목적:** allowlist 등록된 내부 userKey로 actual debit 흐름 전체(allowance 계산 → 차감 → ledger → balance)를 안전하게 검증한다.  
> **비용:** 테스트 credit은 admin grant로 수동 지급. 결제 연동 없음.  
> **복구:** 테스트 완료 후 반드시 `ENABLE_ACTUAL_CREDIT_DEBITS = "false"` 로 복구한다.

---

## 사전 조건

| 항목 | 확인 방법 |
|------|-----------|
| Stage 31 배포 완료 | `GET /admin/credits/config` 응답에 `limitedRollout` 필드 존재 |
| `ACTUAL_DEBIT_ALLOWED_USER_KEYS` 설정 | 아래 Step 2 참고 |
| `ENABLE_ACTUAL_CREDIT_DEBITS = "false"` | 기본값 확인 (Step 3에서 임시 변경) |
| `ENABLE_CREDIT_BLOCKING = "false"` | **테스트 중에도 이 값 변경 금지** |
| 테스트용 userKey 준비 | 내부 계정의 userKey (예: `gh:internal-tester`) |
| 테스트 대상 public GitHub repo 준비 | PR을 열 수 있는 repo |

---

## 테스트 절차

### Step 1 — Production 플래그 상태 확인

```bash
# wrangler.toml 또는 CF Dashboard에서 확인
ENABLE_ACTUAL_CREDIT_DEBITS = "false"   ← 확인 필요
ENABLE_CREDIT_BLOCKING = "false"         ← 변경 금지
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""      ← Step 2에서 채울 예정
```

Admin endpoint로도 확인 가능:
```http
GET /admin/credits/config
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

응답에서 `actualDebitsEnabled: false` 확인.

---

### Step 2 — 테스트 userKey를 allowlist에 등록

`wrangler.toml` 수정 (또는 별도 터미널에서 wrangler secret put):

```toml
ACTUAL_DEBIT_ALLOWED_USER_KEYS = "gh:internal-tester"
```

복수 등록 시 쉼표로 구분:
```toml
ACTUAL_DEBIT_ALLOWED_USER_KEYS = "gh:internal-tester,gh:another-tester"
```

> **주의:** `"*"` wildcard 미지원. 리터럴 값만 파싱됨.

allowlist 등록 후 배포:
```bash
cd apps/central-plane
pnpm ship
```

---

### Step 3 — Actual Debit 플래그 임시 활성화

`wrangler.toml` 수정:

```toml
ENABLE_ACTUAL_CREDIT_DEBITS = "true"    # 테스트 시작
ENABLE_CREDIT_BLOCKING = "false"         # 변경 금지
```

배포:
```bash
pnpm ship
```

활성화 확인:
```http
GET /admin/credits/config
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

예상 응답:
```json
{
  "actualDebitsEnabled": true,
  "limitedRollout": {
    "enabled": true,
    "allowedUserKeyCount": 1,
    "allowedUserKeysPreview": ["gh:internal-tester"]
  }
}
```

---

### Step 4 — 테스트 userKey에 Credit 수동 지급

```http
POST /admin/credits/grant
x-admin-key: <ADMIN_USAGE_STATS_KEY>
Content-Type: application/json

{
  "userKey": "gh:internal-tester",
  "amount": 100,
  "reason": "Stage 32 internal test run"
}
```

지급 확인:
```http
GET /admin/credits/balance?userKey=gh:internal-tester
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

예상: `"balance": 100`

---

### Step 5 — PR Review 실행 (allowance 소비 + 차감 검증)

테스트 대상 PR에 대해 PR review 실행.  
Dashboard `/projects/[id]/github` 에서 해당 PR 선택 후 "확인 실행".

실행 시 `Idempotency-Key` 헤더가 자동 생성되며, debit 요청이 allowlist 확인 후 실행됨.

---

### Step 6 — 결과 검증

#### 6-A. CreditDryRunBanner 확인

Dashboard에서 `CreditDryRunBanner`가 다음 중 하나 표시해야 함:
- **초록색** (`debitOk`): 정상 차감 완료. `"credit 1개 차감 완료"` 메시지.
- **파란색** (`allowanceCovered`): 이번 달 무료 allowance로 처리됨.
- **파란색** (same-userKey): allowlisted 알림 표시.

**잘못된 상태:**
- 배너가 `notAllowlisted` 파란색이면 → allowlist 등록 미반영. Step 2 재확인.
- 배너가 `debitFailed` 빨간색이면 → ledger status 확인 (6-C 참고).

#### 6-B. Allowance 확인

```http
GET /admin/usage-stats?userKey=gh:internal-tester
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

`allowance` 섹션에서 `used` 카운트 증가 확인.

#### 6-C. Ledger 확인

```http
GET /admin/credits/ledger?userKey=gh:internal-tester
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

최신 항목 확인:
- `status: "applied"` → 정상 차감
- `status: "pending"` → debit 미완료 (Step 7 참고)
- `status: "failed"` → 차감 실패 (Step 7 참고)

#### 6-D. Balance 확인

```http
GET /admin/credits/balance?userKey=gh:internal-tester
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

차감 1회 후: `balance = 99` (100 - 1) 확인.

---

### Step 7 — Pending / Failed 처리 (문제 발생 시)

#### Pending 항목이 남은 경우

```http
GET /admin/credits/pending?userKey=gh:internal-tester
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

pending 항목 확인 후 mark-failed:

```http
POST /admin/credits/pending/mark-failed
x-admin-key: <ADMIN_USAGE_STATS_KEY>
Content-Type: application/json

{
  "ledgerEntryId": "<pending-entry-id>"
}
```

> **주의:** mark-failed는 balance를 변경하지 않음. balance는 pending INSERT 시점에 이미 차감됨.

새 PR review 재실행 시 새 `Idempotency-Key`를 생성해야 함 (동일 key로 재시도 불가).

#### Failed 항목 처리

Dashboard에서 `CreditDryRunBanner` → `"이전 credit 처리 요청이 실패 처리되었습니다. 새로 다시 실행해주세요."` 메시지 확인.

새 PR review를 새 idempotencyKey로 실행하면 됨.

---

### Step 8 — 플래그 복구 (필수)

```toml
ENABLE_ACTUAL_CREDIT_DEBITS = "false"    # 반드시 복구
ENABLE_CREDIT_BLOCKING = "false"          # 유지
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""       # 테스트 후 비워도 됨 (또는 유지)
```

배포:
```bash
pnpm ship
```

복구 확인:
```http
GET /admin/credits/config
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

`actualDebitsEnabled: false` 확인.

---

## Smoke Checklist

테스트 전 자동화된 rollout checklist로 사전 확인:

```http
GET /admin/credits/rollout-checklist
x-admin-key: <ADMIN_USAGE_STATS_KEY>
```

확인해야 할 `requiredChecks`:

| check id | 기대 status | 의미 |
|----------|-------------|------|
| `enable-actual-credit-debits-flag` | `manual` | wrangler.toml 확인 |
| `actual-debit-allowlist-configured` | `passed` (flag=true, 비어 있지 않을 때) | allowlist 등록 확인 |
| `internal-actual-debit-test-run` | `manual` | 이 가이드 절차 수행 여부 |
| `enable-credit-blocking-flag` | `manual` | blocking은 별도 단계 |

`safeForProduction: false`이면 위 checklist를 통과하지 못한 항목이 있음.

---

## 시나리오 매트릭스

| 시나리오 | `actualDebitsEnabled` | allowlist | `userKey` 일치 | 기대 결과 |
|---------|----------------------|-----------|---------------|----------|
| A — flag off | false | 무관 | 무관 | 차감 없음, `rollout.reason: "flag_off"` |
| B — not allowlisted | true | 있음 | 불일치 | 차감 없음, `reason: "not_allowlisted"` |
| C — allowlisted (allowance) | true | 있음 | 일치 | allowance로 처리, balance 불변 |
| D — allowlisted (debit) | true | 있음 | 일치 | balance 차감, ledger `status: "applied"` |
| E — duplicate idempotency key | true | 있음 | 일치 | 중복 감지, `isDuplicate: true`, 차감 없음 |

---

## 주의사항

1. **`ENABLE_CREDIT_BLOCKING` 절대 변경 금지** — 테스트 중에도 `false` 유지. credit이 부족해도 PR review는 계속 실행되어야 함.
2. **테스트 후 반드시 `ENABLE_ACTUAL_CREDIT_DEBITS = "false"` 복구** — 미복구 시 allowlist 외 사용자에게도 플래그가 켜진 상태로 서비스됨.
3. **동일 Idempotency-Key 재사용 금지** — 동일 key로 재실행 시 `isDuplicate: true`로 처리되어 차감 없음. 재테스트 시 새 key 사용.
4. **balance가 0인 상태에서 `ENABLE_CREDIT_BLOCKING = "true"` 로 전환 시 blocking 발생** — Stage 32에서는 blocking 테스트 불포함.
5. **admin grant는 취소 불가** — 테스트 grant는 실제 balance에 반영됨. 필요한 만큼만 지급.

---

## 성공 기준

이 문서의 절차를 완료하고 다음을 확인하면 Stage 32 완료:

- [x] `ENABLE_ACTUAL_CREDIT_DEBITS = "true"` + allowlist 상태에서 allowlist 사용자의 ledger에 `status: "applied"` 항목 생성
- [x] balance가 PR review 1회 실행 후 1 감소
- [x] non-allowlisted userKey는 차감 없이 `reason: "not_allowlisted"` 반환
- [x] 테스트 완료 후 `ENABLE_ACTUAL_CREDIT_DEBITS = "false"` 복구 확인

---

## 관련 문서

- [Stage 31 — Limited Actual Debit Rollout Guard](stage-31-limited-actual-debit-rollout.md)
- [Stage 28 — Reservation-First Credit Debit](stage-28-transaction-safe-credit-debit.md)
- [Stage 30 — Pending Ledger Cleanup](stage-30-pending-ledger-cleanup.md)
- [Stage 29 — Credit Rollout Checklist](stage-29-credit-rollout-checklist.md)
