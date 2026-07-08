> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 27 — PR Review Request Idempotency Key

## 목표

클라이언트가 공급한 `Idempotency-Key` 헤더를 바탕으로 deterministic `sourceEventId`를 만든다.
같은 버튼 클릭 → 네트워크 재시도라도 credit debit이 두 번 일어나지 않는다.
Production actual debit flag는 계속 OFF 상태를 유지한다.

---

## 새로 추가한 함수 (`credits.ts`)

### `validateIdempotencyKey(key: string): boolean`

```ts
export function validateIdempotencyKey(key: string): boolean {
  if (typeof key !== "string") return false;
  if (key.length < 8 || key.length > 128) return false;
  return /^[a-zA-Z0-9_\-:]+$/.test(key);
}
```

- 길이: 8–128자
- 허용 문자: `[a-zA-Z0-9_\-:]` only
- 위반 시 서버가 `400 invalid_idempotency_key` 반환

### `buildPrReviewDebitSourceEventId(opts): Promise<string>`

```ts
export async function buildPrReviewDebitSourceEventId(opts: {
  projectId: string;
  repoFullName: string;
  prNumber: number;
  userKey: string;
  idempotencyKey: string;
}): Promise<string>
```

- 입력: `projectId:repoFullName:prNumber:userKey:idempotencyKey`
- SHA-256으로 해시 → 앞 32 hex chars
- 반환: `prr_<32hexchars>`
- 같은 입력 → 항상 같은 ID (deterministic)
- Cloudflare Workers + Node.js 20 모두 `crypto.subtle` 사용

---

## `CreditEnforcementResult` 변경사항

```ts
// Stage 27 추가
idempotency?: {
  provided: boolean;    // 클라이언트가 키를 공급했는가
  keyAccepted: boolean; // 유효성 검사 통과 여부 (invalid → 400 반환이므로 항상 provided와 동일)
  sourceEventId: string; // 실제 사용된 sourceEventId (deterministic or random fallback)
};
```

`checkCreditEnforcement()`는 이 필드를 설정하지 않는다.
PR review 엔드포인트가 `checkCreditEnforcement()` 호출 후 결과에 spread 형태로 추가한다.

---

## PR Review 엔드포인트 변경사항 (`workspace-github.ts`)

### 키 추출 순서 (우선순위)

```
1. Idempotency-Key 헤더  ← 최우선
2. body.idempotencyKey   ← 헤더 없을 때 fallback
3. 없으면 → generateDebitId() 랜덤 ID 사용
```

### 흐름

```
1. rawIdempotencyKey 추출
2. validateIdempotencyKey() 실패 → 400 invalid_idempotency_key (즉시 종료)
3. rawIdempotencyKey 있으면 → buildPrReviewDebitSourceEventId() → deterministic prReviewExecutionId
4. 없으면 → generateDebitId() → random prReviewExecutionId
5. checkCreditEnforcement({ ..., sourceEventId: prReviewExecutionId })
6. 결과에 idempotency 메타데이터 spread
7. blocked → 402 / 계속 진행
```

### 응답에 포함되는 idempotency 메타데이터

```json
{
  "creditEnforcement": {
    ...,
    "idempotency": {
      "provided": true,
      "keyAccepted": true,
      "sourceEventId": "prr_a1b2c3d4e5f6..."
    }
  }
}
```

---

## Dashboard 변경사항

### `startPRReview()` (workspace-github-api.ts)

```ts
export async function startPRReview(
  projectId: string,
  prNumber: number,
  input: {
    userKey: string;
    selectedItemIds?: string[];
    items?: WorkspaceItem[];
    productSpec?: ProductSpec;
    idempotencyKey?: string;  // ← Stage 27 추가
  },
)
```

- `input.idempotencyKey` 있으면 `Idempotency-Key` 헤더로도 전송 (body + header 이중 전송)
- `CreditEnforcementResult` 타입에 `idempotency?` 필드 추가

### `handleStartReview()` (github/page.tsx)

```ts
const idempotencyKey = `${crypto.randomUUID()}`;
const res = await startPRReview(id, lp.number, {
  userKey, selectedItemIds: lp.selectedItemIds,
  items, productSpec,
  idempotencyKey,      // ← Stage 27 추가
});
```

- 버튼 클릭마다 새 UUID 생성
- 버튼은 `reviewPhase === "running"` 동안 렌더링되지 않아 중복 클릭 방지
- "다시 시도"는 새로운 `handleStartReview` 호출 → 새 키 → 새 debit (정상 동작)

---

## 보안 속성

| 속성 | 설명 |
|------|------|
| 클라이언트 키 위조 | userKey가 서버에서 검증됨 → 다른 사용자로의 우회 불가 |
| 키 재사용 공격 | `(userKey, sourceEventId)` 조합 unique index → 다른 사람의 키로 debit 불가 |
| 브루트포스 | 32 hex chars = 128 bits entropy, 현실적 열거 불가 |
| PR 전수 캐시 | 이 stage는 sourceEventId 생성만 deterministic하게 만듦. review 결과 캐싱 없음 |

---

## 엣지 케이스

### 중복 클릭 (이론적)

`reviewPhase === "running"` 동안 버튼이 렌더링되지 않으므로 실질적으로 발생하지 않는다.

### 네트워크 재시도

현재 dashboard에 자동 재시도 로직 없음. 추후 추가 시 same key 재전송으로 deterministic ID 재사용.

### 다른 PR, 같은 key

`buildPrReviewDebitSourceEventId`에 `prNumber`가 포함되므로 같은 key라도 PR 번호가 다르면 다른 ID 생성.

---

## 테스트 결과

**761/761** (이전 744 + 신규 17)

| # | 내용 |
|---|------|
| 43 | validateIdempotencyKey: 8자 최소 허용 |
| 44 | validateIdempotencyKey: UUID 형식 허용 |
| 45 | validateIdempotencyKey: 영숫자+_-: 허용 |
| 46 | validateIdempotencyKey: 7자 거부 |
| 47 | validateIdempotencyKey: 129자 거부 |
| 48 | validateIdempotencyKey: 정확히 128자 허용 |
| 49 | validateIdempotencyKey: 공백 거부 |
| 50 | validateIdempotencyKey: @ 거부 |
| 51 | validateIdempotencyKey: 빈 문자열 거부 |
| 52 | validateIdempotencyKey: non-string 거부 |
| 53 | buildPrReviewDebitSourceEventId: prr_ prefix |
| 54 | buildPrReviewDebitSourceEventId: prr_+32hex 형식 |
| 55 | buildPrReviewDebitSourceEventId: 동일 입력 → 동일 ID (deterministic) |
| 56 | buildPrReviewDebitSourceEventId: key 다르면 ID 다름 |
| 57 | buildPrReviewDebitSourceEventId: prNumber 다르면 ID 다름 |
| 58 | buildPrReviewDebitSourceEventId: userKey 다르면 ID 다름 |
| 59 | round-trip: 동일 deterministic key 두 번 → 두 번째 duplicate |
| 60 | round-trip: balance 1회만 차감 (5-1=4, not 5-2=3) |

---

## CRITICAL: 변경 금지 항목

- production actual debit 활성화 금지 (`wrangler.toml` 변경 없음)
- 실제 결제 연동 금지
- plan gate 구현 금지
- private repo full support 금지
- autofix/patch/commit/branch 생성 금지
- GitHub status check 작성 금지
- landing 앱 수정 금지
- PR review 결과 전체 캐싱 금지 (idempotencyKey는 debit만을 위한 것)

---

## Production Safety 확인

```toml
# apps/central-plane/wrangler.toml (변경 없음)
ENABLE_ACTUAL_CREDIT_DEBITS = "false"
ENABLE_CREDIT_BLOCKING = "false"
```

Stage 27은 idempotency key 인프라만 추가. 실제 차감은 두 flag가 `"true"`로 바뀌기 전까지 발생하지 않는다.
