> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 20 — Credit Ledger Skeleton

## 목적

운영자가 특정 `userKey`에 credit을 수동 지급하고,
잔액과 장부를 볼 수 있으며, 최근 usage event를 기준으로
예상 차감을 **dry-run preview**할 수 있다.

실제 기능 실행 시 credit은 **차감되지 않는다** (`actualDebitsEnabled: false` 고정).

---

## 새 파일

| 파일 | 역할 |
|------|------|
| `apps/central-plane/migrations/0035_workspace_credit_ledger.sql` | `workspace_credit_balances` + `workspace_credit_ledger` D1 테이블 |
| `apps/central-plane/src/workspace/credits.ts` | balance CRUD + grant + preview 헬퍼 |
| `apps/central-plane/src/routes/workspace-admin-credits.ts` | 4개 admin endpoint |
| `apps/central-plane/test/workspace-admin-credits.test.mjs` | 20개 테스트 |
| `apps/dashboard/src/lib/workspace-admin-credits-api.ts` | 대시보드 API 클라이언트 |
| `apps/dashboard/src/app/admin/credits/page.tsx` | 대시보드 `/admin/credits` 페이지 |

---

## D1 마이그레이션

```sql
-- workspace_credit_balances
id TEXT PK, user_key TEXT, credit_type TEXT, balance INTEGER, created_at TEXT, updated_at TEXT
UNIQUE INDEX (user_key, credit_type)

-- workspace_credit_ledger
id TEXT PK, user_key TEXT, project_id TEXT?, credit_type TEXT,
amount INTEGER, direction TEXT, reason TEXT, source_event_id TEXT?,
metadata_json TEXT?, created_at TEXT
INDEX (user_key, created_at DESC)
INDEX (project_id, created_at DESC)
```

마이그레이션 적용:
```
# 별도 터미널에서 실행
cd C:\Users\seung\.conclave\conclave-ai\apps\central-plane
npx wrangler d1 migrations apply DB --remote
```

---

## API Endpoints

모든 엔드포인트: `x-admin-key: <ADMIN_USAGE_STATS_KEY>` 헤더 필요.
키 미설정 → 503 `{ error: "disabled" }` / 키 불일치 → 401.

### GET /admin/credits?userKey=\<key\>

사용자의 credit_type별 잔액 목록 반환.

```json
{
  "ok": true,
  "userKey": "gh:octocat",
  "balances": [
    { "creditType": "review", "balance": 10, "updatedAt": "2026-06-12T..." }
  ]
}
```

### POST /admin/credits/grant

수동 크레딧 지급. 잔액 테이블 UPSERT + 장부 INSERT.

```json
// Request
{ "userKey": "gh:octocat", "creditType": "review", "amount": 5, "reason": "베타 환영 지급" }

// Response
{
  "ok": true,
  "balance": { "userKey": "gh:octocat", "creditType": "review", "balance": 15 },
  "ledgerEntry": { "id": "wcl_...", "direction": "grant", "amount": 5, "reason": "...", "createdAt": "..." }
}
```

유효성 검사: `amount` 양의 정수, `creditType` ∈ `[review, fix, workspace]`, `reason` 비어있지 않음.

### GET /admin/credits/ledger?userKey=\<key\>&limit=50

최신순 장부 내역 반환 (max limit 200).

```json
{
  "ok": true,
  "userKey": "gh:octocat",
  "entries": [
    { "id": "wcl_...", "creditType": "review", "amount": 5, "direction": "grant", "reason": "...", "createdAt": "..." }
  ]
}
```

### GET /admin/credits/preview?range=7d&userKey=\<key\>

`workspace_usage_events`에서 billable 이벤트를 읽어 예상 차감을 계산.
**D1 쓰기 없음.**

```json
{
  "ok": true,
  "actualDebitsEnabled": false,
  "range": "7d",
  "totalEstimatedCredits": 3,
  "previewEntries": [
    {
      "userKey": "gh:octocat",
      "eventType": "workspace_pr_review_run",
      "creditType": "review",
      "estimatedAmount": 3,
      "reason": "PR 코드 확인 × 3회 예상",
      "createdAt": "..."
    }
  ]
}
```

---

## Credits Helper (`credits.ts`)

```typescript
getCreditBalance(env, userKey, creditType): Promise<CreditBalance | null>
listCreditBalances(env, userKey): Promise<CreditBalance[]>
listCreditLedger(env, userKey, limit?): Promise<LedgerEntry[]>
grantCredits(env, input): Promise<GrantCreditsResult>
  // UPSERT balance + INSERT ledger, throws if amount <= 0
previewCreditDebitFromUsageEvents(env, opts): Promise<PreviewEntry[]>
  // read-only, filters billable_candidate events only
```

---

## 과금 정책 (현행)

| 이벤트 | 과금 상태 | 크레딧 |
|--------|-----------|--------|
| `workspace_pr_review_run` | 과금 후보 | 1 review/회 |
| 나머지 workspace_* | 무료 포함 (included) | 0 |

`actualDebitsEnabled: false` — 실제 차감 없음.

---

## 테스트

```
apps/central-plane/test/workspace-admin-credits.test.mjs
20 tests — 650/650 total pass
```

커버리지:
- 503/401 auth guard (모든 endpoint)
- GET /admin/credits 잔액 조회 (빈 배열 / 지급 후 반영)
- POST /admin/credits/grant (성공 / 잔액 증가 / amount 0 / 소수 / 잘못된 creditType / reason 없음)
- GET /admin/credits/ledger (항목 반환 / 인증 실패)
- GET /admin/credits/preview (actualDebitsEnabled false / billable 매핑 / included 제외 / total 합산 / userKey 필터 / 빈 결과 / invalid range → 7d)

---

## 대시보드

`/admin/credits` 페이지 (`apps/dashboard/src/app/admin/credits/page.tsx`)

- Admin key 입력 (password 필드)
- 잔액 조회 (userKey → BalanceTable)
- 장부 조회 (userKey → LedgerTable)
- 수동 크레딧 지급 폼 (userKey, creditType 드롭다운, amount, reason)
- Dry-run 미리보기 (range 선택 + userKey 옵션 필터 → PreviewTable)
- 무료 허용 정책 안내 섹션

---

## 금지 사항 (Stage 20 범위 외)

- 실제 credit 차감 (`actualDebitsEnabled` 항상 `false`)
- 결제 연동 (LemonSqueezy/Stripe 없음)
- plan gate 없음
- autofix / patch / commit / branch 생성 없음
- GitHub status check 없음
- landing 앱 수정 없음
