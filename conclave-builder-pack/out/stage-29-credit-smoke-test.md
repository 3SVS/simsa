> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 29 — Credit System Smoke Test Guide

실제 프로덕션 flag를 활성화하기 전 단계별 smoke test 절차입니다.
**현재 두 flag 모두 비활성 상태에서 실행합니다.**

---

## 전제 조건

- `pnpm migrate:apply --remote` 완료 (migration 0037: status 컬럼 추가)
- 운영자 admin key 준비 (`ADMIN_USAGE_STATS_KEY`)
- 테스트용 GitHub 계정 + 연결된 workspace project

---

## Smoke Test 1: Feature Flag 상태 확인

```bash
curl -H "x-admin-key: <ADMIN_KEY>" \
  https://conclave-ai.seunghunbae.workers.dev/admin/credits/config
```

**기대 결과:**
```json
{
  "ok": true,
  "actualDebitsEnabled": false,
  "blockingEnabled": false,
  "envFlags": {
    "ENABLE_ACTUAL_CREDIT_DEBITS": "false",
    "ENABLE_CREDIT_BLOCKING": "false"
  }
}
```

---

## Smoke Test 2: Rollout Checklist 조회

```bash
curl -H "x-admin-key: <ADMIN_KEY>" \
  https://conclave-ai.seunghunbae.workers.dev/admin/credits/rollout-checklist
```

**기대 결과:**
```json
{
  "ok": true,
  "productionSafety": {
    "actualDebitsEnabled": false,
    "blockingEnabled": false,
    "safeForProductionDefault": true
  },
  "requiredChecks": [...],
  "recommendedScenarios": [...],
  "productionEnableCriteria": [...]
}
```

`safeForProductionDefault: true` 확인.

---

## Smoke Test 3: Dry-run Preview

```bash
curl -H "x-admin-key: <ADMIN_KEY>" \
  "https://conclave-ai.seunghunbae.workers.dev/admin/credits/preview?range=7d"
```

**기대 결과:**
- `ok: true`
- `actualDebitsEnabled: false`
- `totalEstimatedCredits`: 0 이상의 숫자

---

## Smoke Test 4: Idempotency Key 검증

**4a. 잘못된 형식의 키 → 400:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -H "Idempotency-Key: invalid key with spaces" \
  -d '{"projectId":"...","repoFullName":"owner/repo","prNumber":1}' \
  https://conclave-ai.seunghunbae.workers.dev/workspace/github/review
```
**기대 결과:** HTTP 400, `{"ok":false,"error":"invalid_idempotency_key"}`

**4b. 유효한 UUID 키 → 정상 처리:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -H "Idempotency-Key: $(uuidgen | tr -d '-')" \
  -d '{"projectId":"...","repoFullName":"owner/repo","prNumber":1}' \
  https://conclave-ai.seunghunbae.workers.dev/workspace/github/review
```
**기대 결과:** HTTP 200, `creditEnforcement.idempotency.provided: true`

---

## Smoke Test 5: Duplicate Debit 방지

같은 Idempotency-Key로 두 번 요청:

```bash
IDEM_KEY="smoke-test-$(date +%s)"

# 첫 번째 요청
curl -X POST \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '...' \
  .../workspace/github/review

# 두 번째 요청 (같은 키)
curl -X POST \
  -H "Idempotency-Key: $IDEM_KEY" \
  -d '...' \
  .../workspace/github/review
```

**기대 결과 (두 번째):**
```json
{
  "creditEnforcement": {
    "debit": {
      "duplicate": true,
      "ledgerStatus": "applied"
    }
  }
}
```

잔액이 두 번 감소하지 않음 확인:
```bash
curl -H "x-admin-key: <ADMIN_KEY>" \
  ".../admin/credits/ledger?userKey=gh:<username>"
```

---

## Smoke Test 6: Pending 상태 장부 점검

PR review가 진행 중일 때 장부 항목이 `status=pending`으로 생성되고
완료 후 `status=applied`로 업데이트되는지 확인:

```bash
# 장부 조회
curl -H "x-admin-key: <ADMIN_KEY>" \
  ".../admin/credits/ledger?userKey=gh:<username>"
```

**관찰 포인트:**
- `status=pending` 항목이 장기 잔류하는 경우 → Worker 중간 실패 의심
- 정상 흐름: pending → applied (거의 즉시)
- 잔액 부족 시: pending → failed

---

## Smoke Test 7: Monthly Preview

```bash
curl -H "x-admin-key: <ADMIN_KEY>" \
  ".../admin/credits/monthly-preview"
```

**기대 결과:**
- `ok: true`
- `actualDebitsEnabled: false`
- `allowanceRule.includedRuns: 5`

---

## 활성화 전 최종 체크

| 항목 | 확인 방법 | 결과 |
|------|----------|------|
| Migration 0037 배포 | `wrangler d1 migrations list --remote` | ☐ |
| Feature flags off | Smoke Test 1 | ☐ |
| Rollout checklist ok | Smoke Test 2 | ☐ |
| Dry-run preview 동작 | Smoke Test 3 | ☐ |
| Idempotency 검증 | Smoke Test 4 | ☐ |
| 중복 차감 방지 | Smoke Test 5 | ☐ |
| Pending → Applied 확인 | Smoke Test 6 | ☐ |
| Monthly preview 동작 | Smoke Test 7 | ☐ |

모든 항목 체크 완료 후 2단계(debits-only) 활성화 가능.

---

## 주의 사항

1. **pending 장기 잔류**: Worker가 INSERT pending 후 timeout되면 pending 상태가 남음.
   이 경우 수동으로 장부 확인 후 해당 사용자에게 크레딧 재지급 필요.

2. **failed 항목 재시도**: 동일 idempotencyKey로 재시도하면 `duplicate: true, ledgerStatus: "failed"` 반환.
   새로운 idempotencyKey (새 UUID)로 시도해야 새 reservation 생성 가능.

3. **잔액 음수 방지**: `debits-only` 모드에서는 blocking이 없으므로 이론상 음수 잔액이 될 수 있음.
   `full-enforcement` 전환 전 잔액 모니터링 필수.
