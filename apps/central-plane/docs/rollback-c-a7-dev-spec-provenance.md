# 롤백 주의 — C-A7 (PR #577) 이후 central-plane을 이전 버전으로 되돌릴 때

## 한 줄

PR #577을 배포한 뒤 central-plane을 **그 이전 코드로 되돌리려면, 되돌리기 전에 지시서 변환을 먼저 해야 한다.**
안 하면 기존 앱 문 프로젝트의 지시서가 **조용히** 무효가 된다.

## 왜

- PR #577 이후, 기존 앱 문(`entry_path = "code"`) 프로젝트가 지시서를 만들면 `workspace_projects.dev_spec_json`에
  `meta.provenance`(만든 도구·갈래·스택·유저가 확인한 AC id)가 저장된다.
- 그 이전 코드(예: origin/main `3a1ca07`)의 `DevSpecMetaSchema`는 `.strict()`라 `provenance`를 모르는 키로
  거부한다. 실측(2026-10-01, origin/main의 `dev-spec.ts`를 그대로 불러 같은 지시서를 검증):
  `meta: Unrecognized key(s) in object: 'provenance'`.
- 무효가 되면: `acceptancePlanFromDevSpec`이 `[]`를 돌려 검수가 **AC 없이 조용히** 돌고, GET dev-spec은 무효로
  보이고, 빌드 작업은 거부한다. 에러로 드러나지 않는다.
- `provenance`만 지우는 것으로는 부족하다: 이전 코드는 읽지만, 다시 PR #577 이후 코드로 올리면
  "`inferred`인데 확인 목록이 없는 must"가 무결성 위반(`inferred_must_unconfirmed`)이 되어 같은 방식으로 무효가
  된다(실측). 그래서 변환은 `provenance`를 지우고 `source: "inferred"`를 `"generated"`로 내린다. 저장된 우선순위는
  이미 "확인된 것만 must"로 맞춰져 있으므로 must/should는 그대로 — 두 버전 모두에서 유효하다(테스트
  `train-c-a7-provenance-rollback`이 실제 SQL을 SQLite에서 돌려 고정한다). 잃는 것은 출처 표지뿐이고, 그
  프로젝트가 다음에 지시서를 다시 만들면 inferred와 출처가 돌아온다.

## 절차 (롤백할 때만)

1. **개수 확인(읽기)** — 영향받는 행이 있는지.
   ```
   cd apps/central-plane
   pnpm exec wrangler d1 execute conclave-ai --remote --file=./scripts/rollback/c-a7-provenance-count.sql
   ```
   `rows_with_provenance = 0`이면 변환 없이 되돌려도 된다.
2. **변환(쓰기 — 건별 명시 승인 필요)** — 프로덕션 데이터를 바꾼다.
   ```
   pnpm exec wrangler d1 execute conclave-ai --remote --file=./scripts/rollback/c-a7-provenance-strip.sql
   ```
3. 이전 central-plane 배포.
4. **1을 다시** — 2와 3 사이에 새 코드가 만든 행이 있을 수 있다. 0이 아니면 2를 한 번 더(멱등).

## 되돌리지 않는 길

C-A7 기능만 문제라면 코드를 되돌리지 말고 고치는 커밋을 올리는 편이 안전하다 — 이 PR 이후 코드는
provenance가 있는 행과 없는 행을 모두 읽는다.
