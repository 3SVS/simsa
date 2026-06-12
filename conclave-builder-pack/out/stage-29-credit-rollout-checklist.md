# Stage 29 — Credit Rollout Checklist & Operational Guide

## 목적

Stage 24–28에서 구축한 credit debit 인프라(feature flags, reservation-first debit, idempotency, ledger status)를
프로덕션에서 실제 활성화하기 전 확인해야 할 항목들을 구조화한 체크리스트 + 운영 가이드입니다.

**중요:** Stage 29는 아무 flag도 활성화하지 않습니다. 두 flag 모두 `"false"` 유지.

---

## 새 Endpoint

### `GET /admin/credits/rollout-checklist`

Admin key 필요 (`x-admin-key` 헤더).

**Response:**

```ts
type AdminCreditRolloutChecklistResponse = {
  ok: true;
  productionSafety: {
    actualDebitsEnabled: boolean;
    blockingEnabled: boolean;
    safeForProductionDefault: boolean;  // true iff 두 flag 모두 false
  };
  requiredChecks: Array<{
    id: string;
    label: string;
    status: "manual" | "passed" | "warning" | "blocked";
    description: string;
  }>;
  recommendedScenarios: Array<{
    id: string;
    label: string;
    flags: { actualDebitsEnabled: boolean; blockingEnabled: boolean };
    expectedOutcome: string;
  }>;
  productionEnableCriteria: string[];
};
```

**status 자동 감지:**
- `feature-flags-off` 체크: 두 flag 모두 false → `"passed"`, 하나라도 true → `"warning"`
- 나머지 항목: 운영자가 직접 확인해야 하는 `"manual"` 상태

---

## 필수 확인 항목 (requiredChecks)

| id | 내용 | 자동/수동 |
|----|------|--------|
| `feature-flags-off` | 두 flag 모두 `"false"` | 자동 (passed/warning) |
| `migration-applied` | Migration 0037 D1 배포 완료 | 수동 |
| `dry-run-preview` | `/admin/credits/preview` 정상 동작 | 수동 |
| `idempotency-key-validation` | Idempotency-Key 검증 동작 | 수동 |
| `duplicate-debit-blocked` | 중복 차감 방지 확인 | 수동 |
| `pending-ledger-review` | Pending 상태 장부 점검 | 수동 |

---

## 권장 시나리오 (recommendedScenarios)

| id | flags | 결과 |
|----|-------|------|
| `safe-mode` | debits=false, blocking=false | 모든 실행 허용, 차감/차단 없음 (현행 기본) |
| `debits-only` | debits=true, blocking=false | 실행 허용, 크레딧 차감됨, 부족 시에도 실행 |
| `full-enforcement` | debits=true, blocking=true | 실행 허용, 크레딧 차감됨, 부족 시 HTTP 402 |

---

## 프로덕션 활성화 순서 (권장)

```
1단계: 현재 (safe-mode)
  - ENABLE_ACTUAL_CREDIT_DEBITS = "false"
  - ENABLE_CREDIT_BLOCKING = "false"
  - 모든 PR review 무제한 허용
  - 장부 기록은 grant 한정

2단계: debits-only (비차단 과금 시작)
  - ENABLE_ACTUAL_CREDIT_DEBITS = "true"
  - ENABLE_CREDIT_BLOCKING = "false"
  - 크레딧 차감 시작 (allowance 5회 무료 후)
  - 잔액 부족 시에도 실행 허용 → 음수 잔액 가능
  - 모니터링: /admin/credits/ledger 에서 status=applied 확인

3단계: full-enforcement (완전 적용)
  - ENABLE_ACTUAL_CREDIT_DEBITS = "true"
  - ENABLE_CREDIT_BLOCKING = "true"
  - 잔액 부족 시 HTTP 402 반환
  - 사전 조건: 크레딧 충전 UX 완성 + 사용자 안내
```

---

## Admin Dashboard UI (Stage 29)

`/admin/credits` 페이지에 "프로덕션 활성화 체크리스트" 섹션 추가:

- **체크리스트 조회** 버튼 → `GET /admin/credits/rollout-checklist` 호출
- **프로덕션 안전 배너**: 두 flag 모두 false → 초록 배너 / 하나라도 true → 빨간 경고
- **필수 확인 항목**: id별 상태 배지 (통과/수동 확인/주의)
- **권장 시나리오 3종**: flag 조합 + 예상 동작 설명
- **프로덕션 활성화 기준 목록**

---

## Production Safety 확인

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

Stage 29는 read-only 엔드포인트만 추가. 두 flag가 `"true"`로 변경되기 전까지 실제 차감/차단 없음.

---

## 테스트 결과

**780/780** (이전 771 + 9 신규: 테스트 71–78 + 전체 카운트 증가)

| # | 내용 |
|---|------|
| 71 | GET /admin/credits/rollout-checklist 정상 응답 (ok:true) |
| 72 | safeForProductionDefault=true when both flags false |
| 73 | safeForProductionDefault=false when actualDebitsEnabled=true |
| 74 | safeForProductionDefault=false when blockingEnabled=true |
| 75 | requiredChecks 구조 검증 (id/label/status/description) |
| 76 | recommendedScenarios에 3종 시나리오 포함 |
| 77 | productionEnableCriteria 비어 있지 않은 string 배열 |
| 78 | 잘못된 admin key → 401 |

---

## CRITICAL: 변경 금지 항목

- production actual debit 활성화 금지
- production credit blocking 활성화 금지
- 결제 연동 금지
- plan gate 구현 금지
- private repo full support 금지
- pending 자동 cleanup 금지
- autofix/patch/commit/branch 생성 금지
- GitHub status check 작성 금지
- landing 앱 수정 금지
- PR review result full cache 구현 금지
