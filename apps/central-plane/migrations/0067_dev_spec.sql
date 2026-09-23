-- 0067 — dev_spec (SI 티어 D-2 LOCKED, 2026-09-24).
--
-- T0 개발 지시서(DevSpec)의 서버 정본. 현행 product_spec_json(9필드 브리프)은 그대로
-- 두고(하위호환, D-2 "brief로 보존"), 지시서는 별도 컬럼에 Zod+무결성 통과본만 저장한다.
-- 저장은 라우트에서 ownership(id + user_key) 조건으로만 UPDATE. Additive only.

ALTER TABLE workspace_projects ADD COLUMN dev_spec_json TEXT;
ALTER TABLE workspace_projects ADD COLUMN dev_spec_updated_at TEXT;
