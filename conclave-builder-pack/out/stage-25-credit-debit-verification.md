> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 25 — Staging/Local Verification of Actual Credit Debit Flow

## 목적

Stage 24에서 구축한 feature flag 기반 실제 credit 차감 인프라를 5개 시나리오로 검증한다.
Production flag는 그대로 유지한다 (`"false"`).

---

## 5가지 검증 시나리오

### Scenario A — Dry-run 모드 (기본값)

**환경:** `ENABLE_ACTUAL_CREDIT_DEBITS=false`, `ENABLE_CREDIT_BLOCKING=false`

| 필드 | 기대값 |
|------|--------|
| `actualDebitsEnabled` | `false` |
| `wouldBlock` | `true` (잔액 0, allowance 소진) |
| `blocked` | `false` |
| `debit` | `undefined` |
| D1 UPDATE | 없음 |

**의미:** 현재 production 상태. 실행은 허용, 차감 없음, 차단 없음.

---

### Scenario B — Monthly Allowance 커버 (무료 제공량 안)

**환경:** `ENABLE_ACTUAL_CREDIT_DEBITS=true`, 이번 달 사용 0회 (5회 무료 남음)

| 필드 | 기대값 |
|------|--------|
| `allowance.coveredByAllowance` | `true` |
| `requiredCredits` | `0` |
| `debit` | `undefined` |
| `blocked` | `false` |

**의미:** allowance가 커버하면 credit 잔액 무관하게 차감 없음.

---

### Scenario C — 실제 차감 (allowance 소진 + 잔액 충분)

**환경:** `ENABLE_ACTUAL_CREDIT_DEBITS=true`, allowance 5회 소진, balance=3

| 필드 | 기대값 |
|------|--------|
| `wouldBlock` | `false` |
| `blocked` | `false` |
| `debit.ok` | `true` |
| `debit.newBalance` | `2` (3 - 1) |
| D1 UPDATE | 1회 (balance 차감) |
| D1 INSERT ledger | 1회 |

**의미:** 정상 실제 차감 경로. balance 감소 확인 필수.

---

### Scenario D — 잔액 부족이지만 실행 허용 (blocking off)

**환경:** `ENABLE_ACTUAL_CREDIT_DEBITS=true`, `ENABLE_CREDIT_BLOCKING=false`, balance=0, allowance 소진

| 필드 | 기대값 |
|------|--------|
| `wouldBlock` | `true` |
| `blocked` | `false` (blockingEnabled=false) |
| `debit` | `undefined` (wouldBlock=true라 debit 호출 안 함) |
| D1 UPDATE | 없음 |

**Dashboard 표시:** "잔액 부족이지만 실행 허용" (amber 배너)  
**footer:** "잔액 부족 · 차감 없음 · 실행은 허용됨"

---

### Scenario E — 차단됨 (blocking on)

**환경:** `ENABLE_ACTUAL_CREDIT_DEBITS=true`, `ENABLE_CREDIT_BLOCKING=true`, balance=0, allowance 소진

| 필드 | 기대값 |
|------|--------|
| `wouldBlock` | `true` |
| `blocked` | `true` |
| `debit` | `undefined` |
| HTTP 응답 | `402 Payment Required` |

**Dashboard 표시:** "credit 부족으로 실행이 차단됨" (red 배너)  
**footer:** `현재 잔액: 0 review credit · 필요: 1`

---

## Production 안전 확인

### deploy-central-plane.yml 검토 결과

```yaml
# .github/workflows/deploy-central-plane.yml
- run: npx wrangler deploy   # wrangler.toml 읽기 전용, 추가 env 주입 없음
```

`wrangler.toml`에 명시된 값:
```toml
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

**결론:** 배포 workflow가 이 두 flag를 override하는 env 주입이 없으므로, production은 항상 dry-run 상태를 유지한다. Stage 24 이후 production deploy 2회 확인 (Actions → deploy-central-plane → `8d20cbf`, `24ce137`).

---

## Dashboard CreditDryRunBanner 케이스 매핑

| 상태 | 배너 색상 | headerLabel | footerNote |
|------|-----------|-------------|------------|
| `blocked=true` | 🔴 빨강 | "credit 부족으로 실행이 차단됨" | `현재 잔액: N · 필요: M` |
| `debit.ok=true` | 🔵 인디고 | "credit 차감됨" | `잔액: N review credit` |
| `debit.ok=false` | 🟡 앰버 | "credit 차감 실패" | `차감 오류: <reason>` |
| `insufficientButAllowed` | 🟡 앰버 | "잔액 부족이지만 실행 허용" | "잔액 부족 · 차감 없음 · 실행은 허용됨" |
| `coveredByAllowance=true` | 🟢 초록 | "월 무료 제공량 안에 포함" | "실제 차감 없음 · 실행은 허용됨" |
| dry-run 모드 | 🔵 파랑 | "예상 credit 확인" | "실제 차감 없음 · 실행은 허용됨" |

`insufficientButAllowed` 감지 조건:
```ts
const insufficientButAllowed = actualDebitsEnabled && isWouldBlock && !blocked;
```

---

## HTTP 402 에러 처리 (Dashboard)

PR review 실패 시:
```ts
if (!res.ok && res.error === "insufficient_credits" && res.creditEnforcement) {
  setCreditDryRunByPr((prev) => ({ ...prev, [lp.number]: res.creditEnforcement! }));
}
```

error 상태에서 `blocked=true`이면 `CreditDryRunBanner`가 red 배너를 표시한다.

---

## 자동화 테스트 (Stage 25 추가분: 13개)

| # | 시나리오 | 검증 내용 |
|---|---------|-----------|
| 21 | A | wouldBlock=true, blocked=false, debit=undefined |
| 22 | A | actualDebitsEnabled=false 반영, requiredCredits=1, currentBalance=0 |
| 23 | B | coveredByAllowance=true → requiredCredits=0 |
| 24 | B | debit absent, blocked=false, wouldBlock=false |
| 25 | C | debit.ok=true (allowance 소진 + balance 충분) |
| 26 | C | balance 정확히 1 감소 (3→2) |
| 27 | C | ledger 엔트리 정확히 1개 |
| 28 | D | blocked=false (blockingEnabled=false) |
| 29 | D | debit=undefined (wouldBlock=true라 debit 호출 안 함) |
| 30 | E | blocked=true (두 flag 모두 true, balance=0) |
| 31 | E | debit=undefined (blocked 시 debit 호출 안 함) |
| 32 | gap | 연속 2회 호출 시 두 번 모두 debit.ok=true (멱등성 없음) |
| 33 | gap | 2회 차감 후 balance=0 (Stage 26에서 sourceEventId unique 제약 추가 예정) |

**누적 테스트:** 721 (Stage 24) + 13 = **734**

---

## 멱등성 갭 문서화

**현재 상태:** `checkCreditEnforcement`는 `sourceEventId` 기반 중복 방지 없음.

**위험 시나리오:**
- 사용자가 PR review 버튼을 빠르게 2회 클릭
- 네트워크 재시도 (fetch timeout → retry)
- 각 호출이 독립적으로 debit을 실행 → 이중 차감

**Stage 26에서 수정 예정:**
- `workspace_credit_ledger`에 `source_event_id` 컬럼 추가
- `UNIQUE(user_key, source_event_id)` 제약
- 삽입 충돌 시 `INSERT OR IGNORE` → `debit.ok=true` 반환 (멱등)

---

## CRITICAL: 변경 금지 항목 (Stage 25 이후에도 유지)

- production에서 `ENABLE_ACTUAL_CREDIT_DEBITS` 기본값 true 변경 금지
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
