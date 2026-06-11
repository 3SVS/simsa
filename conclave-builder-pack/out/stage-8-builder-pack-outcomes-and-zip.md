# Stage 8 — Builder Pack Outcomes & Zip Download

## 추가한 Migration / Table

**파일:** `apps/central-plane/migrations/0028_builder_pack_outcomes.sql`

```sql
CREATE TABLE IF NOT EXISTS builder_pack_outcomes (
  id                     TEXT NOT NULL PRIMARY KEY,
  project_id             TEXT NOT NULL,
  user_key               TEXT NOT NULL DEFAULT '',
  target                 TEXT NOT NULL,
  selected_item_ids_json TEXT NOT NULL DEFAULT '[]',
  outcome                TEXT NOT NULL,
  note                   TEXT,
  created_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_builder_pack_outcomes_project
  ON builder_pack_outcomes (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_builder_pack_outcomes_user_key
  ON builder_pack_outcomes (user_key, created_at DESC);
```

- `target`: `"claude_code" | "codex" | "both"`
- `outcome`: `"worked" | "partial" | "failed" | "not_checked"`
- `selected_item_ids_json`: JSON array of item ID strings
- `user_key`: 익명 UUID (Stage 8에서는 auth 없음)

---

## 추가한 Endpoint

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/workspace/builder-pack-outcomes` | 결과 기록 저장 |
| `GET` | `/workspace/projects/:id/builder-pack-outcomes` | 프로젝트별 결과 조회 |

### POST `/workspace/builder-pack-outcomes`

**Request:**
```typescript
{
  projectId: string;
  userKey?: string;
  target: "claude_code" | "codex" | "both";
  selectedItemIds: string[];
  outcome: "worked" | "partial" | "failed" | "not_checked";
  note?: string;
}
```

**Response (200):**
```typescript
{ ok: true; outcome: { id, projectId, target, selectedItemIds, outcome, note?, createdAt } }
```

**Validation errors (400):**
- `projectId_required` — projectId 누락
- `target_invalid` — 유효하지 않은 target
- `outcome_invalid` — 유효하지 않은 outcome

### GET `/workspace/projects/:id/builder-pack-outcomes`

**Response (200):**
```typescript
{ ok: true; outcomes: Array<{ id, projectId, target, selectedItemIds, outcome, note?, createdAt }> }
```

---

## Outcome 저장/조회 방식

### D1 저장 (`outcomes.ts`)

```
saveOutcome(env, input) → DbOutcome
listOutcomes(env, projectId, limit=50) → DbOutcome[]
```

- `selectedItemIds`는 JSON 직렬화 후 D1에 저장 (`selected_item_ids_json` 컬럼)
- 조회 시 역직렬화 (try/catch — 파싱 실패 시 빈 배열)
- ID 형식: `bpo_XXXXXX` (타임스탬프 + 랜덤)

---

## localStorage fallback 정책

```
[outcome 저장 시]
1. callSaveOutcomeApi() 호출 (D1 시도)
2. 성공 → 서버 outcome id로 localStorage에도 캐시 저장
   → UI: "✓ 결과 기록이 저장됐어요."
3. 실패 → localStorage만 저장
   → UI: "⚠ 연결 문제로 이 기기에만 임시 저장됐어요."

[페이지 로드 시]
1. callListOutcomesApi() 호출 (D1 시도)
2. 성공 + 결과 있음 → D1 결과 우선 표시
3. 실패 또는 비어있음 → localStorage 결과 표시
```

---

## Zip 다운로드 구현 방식

**라이브러리:** `jszip@^3.10.1` (client-side, browser-compatible)

**파일:** `apps/dashboard/src/lib/zip-utils.ts`

```typescript
buildPackToZip(files: ExportFile[]): Promise<Blob>  // zip Blob 생성
downloadBuildPackZip(files, projectTitle): Promise<void>  // 브라우저 다운로드
```

**동작:**
- `export-builder-pack` 응답의 `bundle.files` 사용
- zip 내부 경로: 응답의 `path` 그대로 사용 (`conclave-build-pack/` prefix 포함)
- 파일명: `conclave-build-pack.zip`
- 압축: DEFLATE level 6

**버튼:** "zip으로 다운로드" — 클릭 중 "압축 중..." 표시

---

## 추가/수정한 파일 목록

### Central Plane (신규)
| 파일 | 내용 |
|------|------|
| `migrations/0028_builder_pack_outcomes.sql` | D1 테이블 + 인덱스 |
| `src/workspace/outcomes.ts` | `saveOutcome`, `listOutcomes`, `isValidOutcome`, `isValidTarget` |
| `test/workspace-outcomes.test.mjs` | 11개 테스트 |

### Central Plane (수정)
| 파일 | 변경 |
|------|------|
| `src/routes/workspace.ts` | `POST /workspace/builder-pack-outcomes`, `GET /workspace/projects/:id/builder-pack-outcomes` 추가 |

### Dashboard (신규)
| 파일 | 내용 |
|------|------|
| `src/lib/zip-utils.ts` | jszip 기반 zip 생성 유틸 |

### Dashboard (수정)
| 파일 | 변경 |
|------|------|
| `package.json` | `jszip`, `@types/jszip` 의존성 추가 |
| `src/lib/workspace-export-api.ts` | `callSaveOutcomeApi`, `callListOutcomesApi`, `RemoteOutcome`, `OutcomeStatus`, `SaveOutcomeInput` 추가 |
| `src/app/projects/[id]/export/page.tsx` | zip 다운로드 버튼, D1 outcome 동기화, 4단계 사용 안내, 저장 상태 메시지 |

---

## typecheck / build / test 결과

```
central-plane: typecheck ✅  build ✅
dashboard:     typecheck ✅  build ✅  lint ✅

테스트:
  workspace-outcomes.test.mjs  — 11/11 pass (신규)
  기존 테스트                   — 406/406 pass
  합계: 417/417 pass, 0 fail
```

---

## Stage 9에서 이어서 할 일

1. **GitHub OAuth 연결** — repo 선택, PR 생성 흐름
2. **outcome → 다음 체크 연결** — 결과 기록 후 "다시 확인 실행" CTA
3. **프로젝트 목록에 outcome 요약** — "마지막 결과: 잘 됨" 표시
4. **export 이력 화면** — `/projects/:id/history`
5. **user auth** — 현재 user_key 기반 → 실제 계정 연결
