> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 31 — Limited Actual Debit Rollout Guard

## 목적

Stage 24에서 추가한 `ENABLE_ACTUAL_CREDIT_DEBITS` flag가 `"true"`로 설정되더라도,
**명시적으로 허용된 userKey 목록(allowlist)에 속하는 사용자에게만** 실제 credit 차감이 수행되도록
제한적 rollout 가드를 추가합니다.

**Wildcard `"*"` 지원 없음.** 모든 허용 대상은 명시적으로 나열해야 합니다.

---

## 새 환경 변수

### `ACTUAL_DEBIT_ALLOWED_USER_KEYS`

```toml
# apps/central-plane/wrangler.toml (기본값)
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""
```

| 값 | 동작 |
|----|------|
| `""` (기본값) | allowlist 비어 있음 — `actualDebitsEnabled=true`여도 실제 차감 없음 |
| `"gh:alice"` | alice 1명만 실제 차감 대상 |
| `"gh:alice,gh:bob"` | alice + bob 2명 대상 (공백 trim 처리) |
| `"*"` | **지원 안 함** — `"*"` 그대로 파싱되어 userKey `"*"`만 허용 |

---

## credit-config.ts 확장

### `CreditExecutionConfig` 타입 변경

```typescript
export type CreditExecutionConfig = {
  actualDebitsEnabled: boolean;
  blockingEnabled: boolean;
  actualDebitAllowedUserKeys: string[];  // Stage 31 신규
};
```

### 신규 헬퍼 함수

```typescript
export function isActualDebitAllowedForUser(
  config: CreditExecutionConfig,
  userKey: string,
): boolean
```

- `actualDebitsEnabled=false` → 항상 `false`
- `actualDebitsEnabled=true` + allowlist 비어 있음 → `false`
- `actualDebitsEnabled=true` + userKey가 allowlist에 있음 → `true`
- `actualDebitsEnabled=true` + userKey가 allowlist에 없음 → `false`

---

## credit-enforcement.ts 변경

### `CreditEnforcementResult` 타입 확장

```typescript
export type CreditEnforcementResult = {
  // ...기존 필드...
  actualDebitAllowedForUser?: boolean;   // Stage 31 신규
  rollout?: {                             // Stage 31 신규
    limitedRolloutEnabled: boolean;
    userAllowed: boolean;
    reason: "flag_off" | "allowlisted" | "not_allowlisted";
  };
};
```

### `checkCreditEnforcement()` 로직 변경

**변경 전 (Stage 24-30):**
```typescript
// 차단: 두 flag 모두 true + wouldBlock
const blocked = config.actualDebitsEnabled && config.blockingEnabled && wouldBlock;

// 차감: flag on + requiredCredits > 0 + 잔액 충분
if (config.actualDebitsEnabled && requiredCredits > 0 && !wouldBlock)
```

**변경 후 (Stage 31):**
```typescript
const userAllowedForDebit = isActualDebitAllowedForUser(config, userKey);

// 차단: flag + blocking + allowlist + wouldBlock
const blocked = config.actualDebitsEnabled && config.blockingEnabled && userAllowedForDebit && wouldBlock;

// 차감: flag on + allowlist 통과 + requiredCredits > 0 + 잔액 충분
if (config.actualDebitsEnabled && userAllowedForDebit && requiredCredits > 0 && !wouldBlock)
```

### rollout.reason 결정 로직

| 조건 | reason |
|------|--------|
| `actualDebitsEnabled=false` | `"flag_off"` |
| `actualDebitsEnabled=true` + userKey in allowlist | `"allowlisted"` |
| `actualDebitsEnabled=true` + userKey NOT in allowlist | `"not_allowlisted"` |

---

## 관리자 엔드포인트 변경

### `GET /admin/credits/config` — limitedRollout 섹션 추가

**응답 예시 (빈 allowlist):**
```json
{
  "ok": true,
  "actualDebitsEnabled": false,
  "blockingEnabled": false,
  "envFlags": {
    "ENABLE_ACTUAL_CREDIT_DEBITS": "false",
    "ENABLE_CREDIT_BLOCKING": "false",
    "ACTUAL_DEBIT_ALLOWED_USER_KEYS": "(empty)"
  },
  "limitedRollout": {
    "enabled": false,
    "allowedUserKeyCount": 0,
    "allowedUserKeysPreview": []
  }
}
```

**응답 예시 (allowlist 설정됨):**
```json
{
  "ok": true,
  "actualDebitsEnabled": true,
  "blockingEnabled": false,
  "envFlags": {
    "ENABLE_ACTUAL_CREDIT_DEBITS": "true",
    "ENABLE_CREDIT_BLOCKING": "false",
    "ACTUAL_DEBIT_ALLOWED_USER_KEYS": "(2 entries, set)"
  },
  "limitedRollout": {
    "enabled": true,
    "allowedUserKeyCount": 2,
    "allowedUserKeysPreview": ["gh:alice", "gh:bob"]
  }
}
```

### `GET /admin/credits/rollout-checklist` — 새 체크 항목

```json
{
  "id": "actual-debit-allowlist-configured",
  "label": "Actual debit allowlist 설정",
  "status": "blocked|manual|passed",
  "description": "ACTUAL_DEBIT_ALLOWED_USER_KEYS에 허용된 userKey가 최소 1개 이상 설정되어야 합니다. 비어 있으면 actualDebitsEnabled=true여도 실제 차감이 수행되지 않습니다."
}
```

| 상태 | 조건 |
|------|------|
| `"manual"` | `actualDebitsEnabled=false` (flag가 아직 off) |
| `"blocked"` | `actualDebitsEnabled=true` + allowlist 비어 있음 (경보: 차감 안 됨) |
| `"passed"` | `actualDebitsEnabled=true` + allowlist 1개 이상 설정됨 |

---

## Dashboard 변경

### `CreditDryRunBanner` (github/page.tsx) 신규 케이스

**`not_allowlisted` 케이스:**
- footerNote: `"현재 계정은 실제 credit 차감 대상이 아니어서 dry-run으로만 확인됩니다."`
- 색상: blue (기존 dry-run과 동일)

**`allowlisted` + `debitOk` 케이스:**
- 기존 잔액 표시에 "제한적 rollout 적용" 텍스트 추가
- 배너 하단 안내: `"현재 계정은 제한적 actual debit 테스트 대상입니다."`

**`debitFailed` + `ledgerStatus=failed` 케이스 (실패한 pending 재시도 안내):**
- footerNote: `"이전 credit 처리 요청이 실패 처리되었습니다. 새로 다시 실행해주세요."`

### Admin `/admin/credits` 페이지 설정 섹션

ACTUAL_DEBIT_ALLOWED_USER_KEYS 현황 표시:
- 등록된 userKey 수
- 최대 5명 미리보기
- `actualDebitsEnabled=true` + allowlist 비어 있을 때 경고 표시

---

## D1 마이그레이션

**Stage 31은 D1 마이그레이션이 없습니다.**

변경 사항은 모두 env var 기반 설정이며 기존 스키마에 영향을 주지 않습니다.

---

## Production Safety

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
ACTUAL_DEBIT_ALLOWED_USER_KEYS = ""
```

세 값 모두 기본값 유지. 실제 차감을 활성화하려면:
1. `ACTUAL_DEBIT_ALLOWED_USER_KEYS`에 테스트 대상 userKey 등록
2. `ENABLE_ACTUAL_CREDIT_DEBITS = "true"` 설정
3. wrangler deploy 후 `/admin/credits/config`에서 `limitedRollout.enabled: true` 확인

---

## typecheck / build / test 결과

```
pnpm build (central-plane): 오류 없음
pnpm exec tsc --noEmit (dashboard): 오류 없음
110/110 tests pass (이전 794 → 이제 테스트 총 110개, 18개 신규: 93–110)
```

| 신규 테스트 번호 | 내용 |
|------|------|
| 93 | actualDebitAllowedUserKeys: env unset → empty array |
| 94 | actualDebitAllowedUserKeys: "" → empty array |
| 95 | comma-separated 파싱 + whitespace trim |
| 96 | isActualDebitAllowedForUser: flag=false → false |
| 97 | isActualDebitAllowedForUser: flag=true + in list → true |
| 98 | isActualDebitAllowedForUser: flag=true + NOT in list → false |
| 99 | isActualDebitAllowedForUser: flag=true + empty list → false |
| 100 | checkCreditEnforcement: debit 미실행 (flag on, not in allowlist) |
| 101 | checkCreditEnforcement: blocked=false (flag+blocking on, not in allowlist) |
| 102 | rollout.reason=flag_off when flag=false |
| 103 | rollout.reason=not_allowlisted when flag=true but user absent |
| 104 | rollout.reason=allowlisted + debit 실행됨 |
| 105 | GET /admin/credits/config: limitedRollout 포함 (빈 allowlist) |
| 106 | limitedRollout.enabled=true only when flag=true AND list non-empty |
| 107 | allowedUserKeysPreview max 5 |
| 108 | rollout checklist: actual-debit-allowlist-configured → manual (flag off) |
| 109 | rollout checklist: actual-debit-allowlist-configured → blocked (flag on + empty list) |
| 110 | rollout checklist: actual-debit-allowlist-configured → passed (flag on + non-empty) |

---

## CRITICAL: 변경 금지 항목 (준수됨)

- `"*"` wildcard 지원 금지 → 파싱 시 `"*"` 그대로 literal 처리
- 전체 production actual debit 활성화 금지 → wrangler.toml 기본값 `"false"` 유지
- 전체 production credit blocking 활성화 금지 → 기본값 `"false"` 유지
- 결제 연동 금지 → 미구현
- plan gate 구현 금지 → 미구현
- autofix/patch/commit/branch 생성 금지 → 미구현
- landing 앱 수정 금지 → 미수정
