> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 30 — Pending Ledger Cleanup

## 목적

Stage 28에서 구현한 reservation-first debit 흐름에서 발생할 수 있는 `status=pending` 장부 항목을
운영자가 조회하고, **balance 변경 없이** 수동으로 `failed`로 정리하는 기능을 추가합니다.

**자동 cleanup 없음.** 모든 정리 작업은 운영자가 직접 실행합니다.
**production actual debit 계속 OFF.** 두 feature flag 모두 `"false"` 유지.

---

## Pending Ledger가 생기는 이유

```
INSERT OR IGNORE (status='pending')   ← 여기까지 완료
→ UPDATE balance                       ← Worker timeout/crash 발생
→ UPDATE ledger status='applied'|'failed'  ← 실행 안 됨
```

`status='pending'`이 오래 유지되는 상황:
- Cloudflare Worker CPU limit 초과
- D1 네트워크 지연
- 배포 도중 Worker 교체
- 드문 경우: balance UPDATE 성공 후 finalize UPDATE 실패

---

## 오래된 Pending 기준

기본: **15분 이상** (`olderThanMinutes=15`)

쿼리 파라미터로 조정 가능:
```
GET /admin/credits/pending?olderThanMinutes=30
```

---

## 새 Helper 함수 (credits.ts)

### `listPendingCreditLedgerEntries()`

```ts
async function listPendingCreditLedgerEntries(
  env: Env,
  opts: { olderThanMinutes?: number; limit?: number },
): Promise<PendingLedgerEntry[]>
```

- `direction = 'debit'` + `status = 'pending'` + `created_at <= cutoff`
- default limit 50, max 200
- 각 항목에 `ageMinutes` 포함 (현재시각 - created_at)
- Read-only, balance 변경 없음

### `markPendingCreditLedgerFailed()`

```ts
async function markPendingCreditLedgerFailed(
  env: Env,
  opts: { ledgerEntryId: string; adminReason: string },
): Promise<MarkPendingFailedResult>
```

**balance 절대 변경 안 함.** `workspace_credit_balances` 테이블에 접근하지 않음.

정책:
- `status='pending'` row만 `failed`로 변경
- `direction='debit'`만 대상
- `metadata_json`에 cleanup 정보 기록:
  ```json
  { "cleanup": { "markedFailedBy": "admin", "reason": "...", "at": "..." } }
  ```
- `not_found` / `not_pending` 에러 반환

---

## Admin Endpoints

### `GET /admin/credits/pending`

```
GET /admin/credits/pending?olderThanMinutes=15&limit=50
```

응답:
```ts
{
  ok: true;
  olderThanMinutes: number;
  entries: Array<{
    id: string;
    userKey: string;
    projectId?: string;
    creditType: string;
    amount: number;
    status: "pending";
    reason: string;
    sourceEventId?: string;
    createdAt: string;
    ageMinutes: number;
  }>;
}
```

### `POST /admin/credits/pending/:ledgerEntryId/mark-failed`

```
POST /admin/credits/pending/wcl_abc123/mark-failed
{
  "adminReason": "Worker timeout cleanup 2026-06-13"
}
```

응답:
```ts
// 성공
{ ok: true; entry: { id: string; status: "failed" } }

// 에러
{ ok: false; error: "not_found" }   // 404
{ ok: false; error: "not_pending" } // 409
```

**재시도 정책:** 같은 `sourceEventId`로 새 PR review를 시도하면 `duplicate: true, ledgerStatus: "failed"` 반환.
새 실행을 위해서는 새 `idempotencyKey` (→ 새 `sourceEventId`) 사용 필요.

---

## Balance 불변 보장

```
markPendingCreditLedgerFailed() 내부:
  UPDATE workspace_credit_ledger SET status='failed', metadata_json=? WHERE id=? AND status='pending'
  ← workspace_credit_balances에는 절대 접근하지 않음
```

테스트 91: `env.DB._writeCount.balance === 0` 확인.

---

## Admin Dashboard UI 변경사항

`/admin/credits` 페이지에 "Pending Ledger 수동 정리 (Stage 30)" 섹션 추가:

- 기준 시간 선택: 15분 / 30분 / 60분
- **Pending 조회** 버튼 → GET /admin/credits/pending 호출
- 결과 테이블: ID, userKey, 금액, 경과(분), sourceEventId, 생성일시
  - 60분 이상 항목: 빨간 배지 (주의)
- admin reason 입력
- **failed 처리** 버튼 (행별)
- 처리 후 자동 재조회
- 주의 문구 (항상 표시):
  > "이 작업은 balance를 변경하지 않습니다. pending 상태를 failed로 표시해 운영상 정리하는 작업입니다."

---

## Rollout Checklist 업데이트 (Stage 29)

`GET /admin/credits/rollout-checklist` 응답에 추가된 항목:

**requiredChecks:**
- `pending-ledger-review`: Pending 상태 장부 점검 (manual)
- `pending-cleanup-available`: Pending cleanup 기능 사용 가능 (**passed** — 자동)

**productionEnableCriteria 추가:**
- "오래된 pending ledger를 /admin/credits/pending 에서 조회하고 mark-failed로 수동 정리할 수 있어야 한다"

---

## Production Safety

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

---

## typecheck / build / test 결과

```
pnpm build (central-plane): 오류 없음
pnpm exec tsc --noEmit (dashboard): 오류 없음
794/794 tests pass (이전 780 + 14 신규: 79–92)
```

| # | 내용 |
|---|------|
| 79 | GET /admin/credits/pending → 401 (bad key) |
| 80 | GET /admin/credits/pending → ok:true + entries array |
| 81 | olderThanMinutes 쿼리 파라미터 반영 |
| 82 | 오래된 pending 항목만 반환 |
| 83 | 최근 항목 제외 확인 |
| 84 | applied/failed 항목 제외 확인 |
| 85 | limit 200 상한 확인 |
| 86 | pending → failed 정상 변경 |
| 87 | not_found 에러 반환 |
| 88 | not_pending 에러 반환 |
| 89 | POST mark-failed → 401 (bad key) |
| 90 | POST mark-failed → 404 (not found) |
| 91 | balance 변경 없음 확인 (_writeCount.balance === 0) |
| 92 | metadata_json에 cleanup 정보 기록 |

---

## Stage 31 전 결정 필요한 사항

1. **Pending timeout 정책 표준화**: 15분? 30분? 운영 기준을 문서화할지
2. **Pending 항목 사용자 안내**: failed된 pending이 있을 때 사용자에게 어떻게 알릴지
3. **mark-failed 후 재시도 UX**: dashboard에서 새 idempotencyKey로 재시도 버튼?
4. **409 (not_pending) 처리**: 이미 applied된 항목에 mark-failed 시도 → 현재 409 반환
5. **Production actual debit 활성화**: Stage 30 이후 안전하게 `ENABLE_ACTUAL_CREDIT_DEBITS="true"` 설정 가능

---

## CRITICAL: 변경 금지 항목

- 자동 pending cleanup 금지
- balance 보정 자동화 금지
- production actual debit 활성화 금지
- production credit blocking 활성화 금지
- 결제 연동 금지
- plan gate 구현 금지
- private repo full support 금지
- autofix/patch/commit/branch 생성 금지
- landing 앱 수정 금지
