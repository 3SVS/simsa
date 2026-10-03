-- C-A7 (PR #577) 롤백 전 확인 — 읽기 전용. 무엇이 영향을 받는지 개수만 센다(내용·id는 내지 않는다).
-- 이 PR 뒤의 central-plane은 기존 앱 문 지시서에 meta.provenance를 저장한다. 이 PR 이전 코드의
-- DevSpecMetaSchema는 .strict()라 그 키를 모른다며 지시서 전체를 무효로 본다(검수가 AC 없이 조용히 돈다).
-- 절차: apps/central-plane/docs/rollback-c-a7-dev-spec-provenance.md
SELECT
  COUNT(*) AS rows_with_provenance,
  COALESCE(SUM(json_extract(dev_spec_json, '$.meta.source') = 'inferred'), 0) AS inferred_rows
FROM workspace_projects
WHERE CASE WHEN json_valid(dev_spec_json) THEN json_extract(dev_spec_json, '$.meta.provenance') IS NOT NULL ELSE 0 END;
