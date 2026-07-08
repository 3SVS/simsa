> **SUPERSEDED** — 이 문서는 Conclave 시대 가정 하에 작성되었습니다. 제품은 Simsa로 전환되었고, 최신 방향·우선순위는 `docs/simsa-research-audit-2026-07.md` (감사 v2)를 보세요.

# Stage 6 — Builder Pack Export

## 개요

사용자가 제품 설명서와 확인 결과를 바탕으로 Claude Code 또는 Codex에 바로 넘길 수 있는 "개발 AI에게 넘길 만들기 패키지"를 생성하는 기능을 구현했습니다.

---

## 추가/수정한 파일 목록

### Central Plane

| 파일 | 변경 |
|------|------|
| `apps/central-plane/src/workspace/export.ts` | 신규 — deterministic builder pack 생성 로직 |
| `apps/central-plane/src/routes/workspace.ts` | `POST /workspace/export-builder-pack` 엔드포인트 추가 |
| `apps/central-plane/test/workspace-export.test.mjs` | 신규 — 13개 테스트 |

### Dashboard

| 파일 | 변경 |
|------|------|
| `apps/dashboard/src/lib/workspace-export-api.ts` | 신규 — export API 클라이언트 |
| `apps/dashboard/src/lib/labels.ts` | `export: "만들기 패키지"` nav label 추가 |
| `apps/dashboard/src/app/projects/[id]/layout.tsx` | nav에 export 항목 추가 |
| `apps/dashboard/src/app/projects/[id]/export/page.tsx` | 신규 — export UI 페이지 |
| `apps/dashboard/src/app/projects/[id]/items/page.tsx` | export CTA 추가 |
| `apps/dashboard/src/app/projects/[id]/checks/page.tsx` | 모든 항목 통과 시 export CTA 추가 |
| `apps/dashboard/src/app/projects/[id]/fixes/page.tsx` | 하단 export CTA 추가 |

### 문서

| 파일 | 변경 |
|------|------|
| `conclave-builder-pack/out/stage-6-builder-pack-export.md` | 신규 — 이 파일 |

---

## 추가한 endpoint

```
POST /workspace/export-builder-pack
```

- **인증 불필요** — deterministic 생성, LLM 호출 없음
- **Rate limit 없음** — 순수 문자열 조립
- CORS: dashboard origin 허용

---

## Export Request / Response Shape

### Request

```typescript
type WorkspaceExportBuilderPackRequest = {
  projectId?: string;       // D1에서 로드할 경우
  project?: {               // 인라인 데이터 (dashboard에서 주로 사용)
    title: string;
    idea?: string;
    productSpec: ExportProductSpec;
    items: Array<{
      id: string;
      title: string;
      status: string;
      criteria: string[];
    }>;
    checkResults?: ExportCheckResults;
    fixSuggestions?: Record<string, ExportFixSuggestion>;
  };
  target: "claude_code" | "codex" | "both";
  format: "json" | "markdown_bundle";
  locale?: "ko" | "en";
};
```

### Response

```typescript
type WorkspaceExportBuilderPackResponse = {
  ok: true;
  source: "deterministic";
  bundle: {
    files: Array<{ path: string; content: string }>;
  };
  summary: {
    fileCount: number;
    recommendedNextStep: string;
  };
};
```

---

## 생성되는 파일 목록

| 파일 경로 | 목적 | 생성 조건 |
|-----------|------|-----------|
| `conclave-build-pack/README.md` | 패키지 사용 방법, 파일 읽는 순서, 주의사항 | 항상 |
| `conclave-build-pack/product.md` | 제품 설명서 전문 (이름, 문제, 포함/제외, 사용자 흐름, 결정) | 항상 |
| `conclave-build-pack/items.md` | 꼭 들어가야 할 항목 목록 + 완성 기준 | 항상 |
| `conclave-build-pack/checks.md` | 확인 결과 (요약 표 + 항목별 이유/근거/다음 행동) + 사전 점검 안내 | 항상 (결과 없으면 안내 메시지) |
| `conclave-build-pack/fixes.md` | 고쳐야 할 항목 + 수정 제안 + 작업 지시 | 항상 (없으면 "모두 통과") |
| `conclave-build-pack/CLAUDE_CODE_PROMPT.md` | Claude Code에 붙여넣을 지시서 (6개 지시사항 + 항목 목록) | `target != codex` |
| `conclave-build-pack/CODEX_PROMPT.md` | Codex에 붙여넣을 지시서 (Goal/Context/Constraints/Tasks/Done when/Do not do/Verify by/Final response format) | `target != claude_code` |

---

## CLAUDE_CODE_PROMPT.md 지시서 내용 요약

1. product.md, items.md, checks.md, fixes.md를 먼저 읽어라
2. 전체를 한 번에 만들지 말고, 항목 하나씩 구현하라
3. 범위를 벗어난 기능 (이번 버전 제외 항목) 절대 구현 금지
4. 애매한 점이 있으면 코드 작성 전에 질문하라
5. 구현 후 완성 기준 기준으로 스스로 확인하라
6. 완료 시 변경 파일 / 완료 항목 / 실행 테스트 / 남은 위험 형식으로 보고하라

---

## CODEX_PROMPT.md 지시서 내용 요약

| 섹션 | 내용 |
|------|------|
| **Goal** | productSpec.oneLine (제품의 한 줄 목표) |
| **Context** | 제품명, 대상 사용자, 핵심 문제, 포함 기능 목록 |
| **Constraints** | 버전 범위 준수, Do not do 항목 금지, 코드 작성 전 질문, 기존 패턴 준수 |
| **Tasks** | 구현할 항목 목록 (fix suggestion의 세부 작업 포함) |
| **Done when** | 항목별 완성 기준 (fix suggestion의 doneWhen 우선) |
| **Do not do** | 제외 기능 목록 + fix suggestion의 doNotDo |
| **Verify by** | 완성 기준 직접 확인, 범위 밖 기능 체크, 미결 사항 영향 확인 |
| **Final response format** | 완료 항목 / 변경 파일 / 실행 테스트 / 남은 위험 |

---

## Dashboard Export 화면 사용법

**Route:** `/projects/:id/export`

**기능:**
1. **타깃 선택** — Claude Code용 / Codex용 / 둘 다 버튼으로 전환 (선택 즉시 재생성)
2. **자동 생성** — 페이지 진입 시 즉시 API 호출하여 파일 생성
3. **파일 목록** — 좌측 패널에 파일명 목록 (클릭으로 선택)
4. **파일 내용** — 우측 패널에 선택된 파일 내용 (monospace, 스크롤 가능)
5. **파일별 복사** — 우측 상단 "복사" 버튼 (2초 후 초기화)
6. **전체 복사** — 상단 바 "전체 복사" 버튼 (모든 파일 합본)
7. **MD 묶음 내려받기** — 전체 파일을 단일 .md 파일로 다운로드

**진입 경로:**
- `/projects/:id/items` 하단 CTA
- `/projects/:id/checks` 모든 항목 통과 시 CTA
- `/projects/:id/fixes` 하단 CTA
- 좌측 사이드바 "만들기 패키지" 메뉴

---

## Zip 다운로드 구현 여부

**Stage 6에서는 zip 미구현.** 단일 Markdown 묶음 파일(`.md`) 다운로드만 지원합니다.
- 각 파일은 `<!-- FILE: path -->` 구분자로 연결
- 라이브러리 의존성 없음 (Blob + URL.createObjectURL)

**Stage 6.1 예정:** jszip 또는 서버사이드 zip 생성으로 폴더 구조 포함 zip 다운로드

---

## GitHub / PR / Review 미연결

Stage 6에서는 다음을 의도적으로 구현하지 않았습니다:
- GitHub OAuth / repo 연결
- `/saas/review` job 연결
- autofix pipeline 연결
- 실제 코드 patch/commit 생성

이 기능들은 Stage 7 이후에 구현 예정입니다.

---

## typecheck / build / lint / test 결과

```
central-plane: build ✓  typecheck ✓
dashboard:     build ✓  typecheck ✓

테스트 (node --test):
  workspace-check.test.mjs  — 9/9  pass
  workspace-fix.test.mjs    — 4/4  pass
  workspace-export.test.mjs — 13/13 pass
  합계: 26/26 pass, 0 fail
```

---

## Stage 7에서 이어서 할 일

1. **GitHub 연결** — OAuth로 repo 선택, PR 생성
2. **`/saas/review` job 연결** — builder pack → Conclave review 자동 실행
3. **zip 다운로드** (Stage 6.1) — jszip으로 폴더 구조 포함 zip
4. **export 화면 개선** — 항목별 선택 체크박스 (구현할 항목만 포함)
5. **프로젝트 목록 페이지 CTA** — 목록에서 export 바로 접근
6. **export 이력 저장** — D1에 export 기록 남기기
