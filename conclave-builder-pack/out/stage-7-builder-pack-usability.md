> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 7 — Builder Pack Usability

## pre-work 결과

### 마이그레이션 / 배포 상태

Stage 6 세션에서 이미 완료:
- `0026_workspace_rate_limit.sql` ✅ 원격 적용
- `0027_workspace_stage5.sql` ✅ 원격 적용
- `deploy-central-plane.yml` GitHub Actions → ✅ 배포 완료 (smoke test 통과)

Stage 7 세션 `migrate:list` 결과: **"No migrations to apply"** — 추가 적용 불필요.

### Smoke test 결과 (production)

| Endpoint | 결과 | 비고 |
|----------|------|------|
| `GET /healthz` | ✅ `ok: true, version: 0.13.15` | |
| `POST /workspace/idea-to-spec-draft` | ✅ `source: mock-fallback, items: 8` | ANTHROPIC_API_KEY 없는 경우 fallback 정상 |
| `POST /workspace/export-builder-pack` | ✅ `files: 7` | deterministic, LLM 없음 |
| `POST /workspace/projects` | ✅ D1 write 성공 | `wsp_*` ID 반환 |
| `GET /workspace/projects/:id` | ✅ D1 read 성공 | title 정상 반환 |
| `POST /workspace/check-draft` | ✅ `source: mock-fallback, results: 1` | |
| `POST /workspace/fix-suggestion` | ✅ `source: mock-fallback, summary_len: 120` | |

---

## 추가/수정한 파일 목록

### Central Plane

| 파일 | 변경 |
|------|------|
| `apps/central-plane/src/workspace/export.ts` | 전면 개선 — `selectedItemIds` 필터링, Claude/Codex prompt 강화 |
| `apps/central-plane/test/workspace-export.test.mjs` | Stage 7 선택 필터 테스트 9개 추가 |

### Dashboard

| 파일 | 변경 |
|------|------|
| `apps/dashboard/src/lib/workspace-export-api.ts` | `selectedItemIds` 추가, response에 `totalItems/selectedItems` 추가 |
| `apps/dashboard/src/lib/workflow-store.ts` | `BuilderPackOutcome`, `saveOutcome`, `loadOutcomes`, `generateOutcomeId` 추가 |
| `apps/dashboard/src/app/projects/[id]/export/page.tsx` | 전면 재작성 — 항목 선택 UI + 추천 선택 + 결과 기록 + 이력 |

### 문서

| 파일 | 변경 |
|------|------|
| `conclave-builder-pack/out/stage-7-builder-pack-usability.md` | 신규 — 이 파일 |

---

## selectedItemIds 동작 방식

**요청:**
```typescript
POST /workspace/export-builder-pack
{
  selectedItemIds?: string[]  // 없거나 빈 배열 → 전체 포함
}
```

**동작:**
- `selectedItemIds`가 없거나 `[]` → 전체 항목 포함 (기존 동작 유지)
- `selectedItemIds`가 있으면:
  - `items.md` → 선택 항목만
  - `checks.md` → 선택 항목의 check result만
  - `fixes.md` → 선택 항목의 fix suggestion만
  - `CLAUDE_CODE_PROMPT.md` / `CODEX_PROMPT.md` → 선택 항목만 포함
  - `product.md` → **항상 전체 제품 맥락 유지** (선택과 무관)
  - `README.md` → "포함된 항목: X개 (전체 Y개 중)" 표시

**Response에 추가된 필드:**
```typescript
summary: {
  fileCount: number;
  totalItems: number;   // NEW — 전체 항목 수
  selectedItems: number; // NEW — 실제 포함된 항목 수
  recommendedNextStep: string;
}
```

---

## export 화면 변경사항

### 새로운 UI 요소

1. **포함 범위 토글**
   - "전체 항목 포함" / "선택한 항목만" 버튼
   - 선택 모드에서는 항목 선택 패널 표시

2. **항목 선택 패널 (선택 모드)**
   - 현재 선택 개수 표시 (`X개 선택됨 / 전체 Y개`)
   - 상태별 필터 탭: 전체 / 안 맞음 / 확인 부족 / 결정 필요 / 통과 / 시작 전
   - 항목별 체크박스 + 상태 배지
   - "먼저 고쳐야 할 항목 추천 선택" 버튼 (안 맞음/확인 부족/결정 필요 최대 3개 자동 선택)
   - "패키지 생성" 버튼 (선택 완료 후 명시적 생성)

3. **Summary bar 개선**
   - 포함 항목 수 표시 (`포함 항목: X개 / 전체 Y개 중`)
   - Claude Code 지시서 포함 여부 ✓ 배지
   - Codex 지시서 포함 여부 ✓ 배지

4. **결과 기록 섹션** (패키지 생성 후 표시)
   - 결과 선택: 잘 됨 / 일부만 됨 / 안 됨 / 아직 확인 전
   - 메모 입력 (선택사항)
   - "기록하기" 버튼

5. **이전 기록 섹션**
   - 날짜 / 타깃 / 항목 수 / 결과 / 메모 이력 표시 (최근 10개)

---

## 추천 선택 로직

```
1. 확인 결과에서 status = "failed" | "inconclusive" | "needs_decision" 항목 수집
2. 우선순위 정렬: failed > inconclusive > needs_decision
3. 최대 3개까지만 선택
4. 확인 결과가 없으면 버튼 비활성화
```

구현 위치: `export/page.tsx` `handleRecommend()`

---

## Claude Code용 prompt 개선 내용

기존 6개 지시사항 → **7개 지시사항 + "중요한 제약" 섹션** 추가

새 7단계 흐름:
1. `product.md`로 전체 맥락 이해
2. `items.md`에서 이번 포함 항목만 확인 (개수 명시)
3. `checks.md`에서 문제 이유 확인
4. `fixes.md`의 수정 지시를 따름
5. **코딩 전 구현 계획 작성** (신규)
6. 완성 기준별 자기 확인
7. 완료 보고

중요한 제약 섹션:
- **포함된 항목만 구현하거나 수정**
- 포함되지 않은 항목은 건드리지 않음
- 제외 항목 절대 구현 금지
- 전체 제품을 한 번에 만들지 않음

선택 필터 시: README에 `이번 패키지에 포함된 항목: X개 (전체 Y개 중)` 블록인용 추가

---

## Codex용 prompt 개선 내용

기존 섹션 구조 유지 + **"Selected tasks" 섹션 추가** (Goal 다음에 위치)

```
Goal
Context
Selected tasks  ← 신규 (이번 포함 항목 + fix suggestion 세부 작업)
Constraints
Done when
Do not do
Verify by
Final response format
```

**"Selected tasks" 내용:**
- 항목 수 명시 (`이번에 구현할 항목 X개 / 전체 Y개 중`)
- 각 항목 아래 fix suggestion의 세부 tasks 들여쓰기
- "포함되지 않은 항목은 건드리지 마세요" 블록인용

**"Constraints" 강화:**
- "위 'Selected tasks' 목록의 항목만 구현한다"
- "전체 제품을 한 번에 만들지 않는다"

**"Do not do" 강화:**
- 필터링 시: `이번 패키지에 포함되지 않은 항목 (전체 Y개 중 X개만 포함)은 건드리지 마세요`

---

## 결과 기록 기능 구현 방식

**저장소:** localStorage (`conclave_outcomes_{projectId}` 키)

**저장 데이터 (BuilderPackOutcome):**
```typescript
{
  id: string;            // "oc_xxxxx"
  projectId: string;
  target: ExportTarget;  // "claude_code" | "codex" | "both"
  selectedItemIds: string[];
  outcome: "worked" | "partial" | "failed" | "not_checked";
  note?: string;
  createdAt: string;     // ISO 8601
}
```

**동작:**
- 최신 기록이 앞에 (unshift)
- 최대 50개 저장 (초과 시 오래된 것 자동 삭제)
- 이력은 최근 10개만 화면에 표시

**D1 저장 여부:** Stage 7에서는 localStorage만 사용. Stage 8에서 D1 선택적 동기화 예정.

---

## typecheck / build / test 결과

```
central-plane: typecheck ✅  build ✅
dashboard:     typecheck ✅  build ✅

테스트 (node --test):
  workspace-check.test.mjs   — 9/9  pass
  workspace-fix.test.mjs     — 4/4  pass
  workspace-export.test.mjs  — 22/22 pass  (Stage 7 테스트 9개 신규)
  기타 기존 테스트            — 371/371 pass
  합계: 406/406 pass, 0 fail
```

---

## Stage 8에서 이어서 할 일

1. **D1 outcome 저장** — `builder_pack_outcomes` 테이블 + `POST /workspace/outcomes` endpoint
2. **Zip 다운로드** (Stage 6.1 → Stage 8로 이월) — jszip으로 폴더 구조 포함
3. **outcome → 다음 체크 연결** — "결과 기록" 후 "다시 확인 실행" CTA 추가
4. **GitHub 연결 시작** — OAuth, repo 선택 (Stage 7 결정에 따라 Stage 8+)
5. **export 이력 화면** — `/projects/:id/history` 페이지에서 모든 패키지 내보내기 이력 조회
6. **프로젝트 목록에 outcome 요약** — 목록 페이지에 "마지막 결과: 잘 됨/안 됨" 표시
