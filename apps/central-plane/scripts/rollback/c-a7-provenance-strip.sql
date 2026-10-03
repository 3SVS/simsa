-- C-A7 (PR #577) 롤백용 변환 — 쓰기. 프로덕션 데이터를 바꾸므로 **건별 명시 승인 뒤에만** 실행한다.
-- 절차: apps/central-plane/docs/rollback-c-a7-dev-spec-provenance.md
--
-- 무엇을: meta.provenance가 있는 지시서에서 그 키를 지우고, source가 "inferred"면 "generated"로 바꾼다.
-- 왜 source까지: provenance만 지우면 이 PR 이전 코드는 읽지만, 다시 이 PR 이후 코드로 올렸을 때
--   "inferred인데 확인 목록이 없는 must"가 무결성 위반(inferred_must_unconfirmed)이 되어 같은 방식으로
--   조용히 무효가 된다(실측). 저장된 우선순위는 이미 "확인된 것만 must"로 맞춰져 있으므로 must/should는
--   그대로 두고 출처 표지만 내린다 — 두 버전 모두에서 유효하다. 다음 재생성 때 다시 inferred가 된다.
-- 멱등: 두 번 돌려도 두 번째는 바꾸는 행이 0이다. dev_spec_updated_at은 건드리지 않는다.
UPDATE workspace_projects
SET dev_spec_json = json_set(
  json_remove(dev_spec_json, '$.meta.provenance'),
  '$.meta.source',
  CASE json_extract(dev_spec_json, '$.meta.source')
    WHEN 'inferred' THEN 'generated'
    ELSE json_extract(dev_spec_json, '$.meta.source')
  END
)
WHERE CASE WHEN json_valid(dev_spec_json) THEN json_extract(dev_spec_json, '$.meta.provenance') IS NOT NULL ELSE 0 END;
