-- 0064 — workspace_project_ext (G8 D-1, DR-1 LOCKED 2026-07-19).
--
-- ExtendedProjectData(검수 결과·고쳐보기·userProfile 등 제품 루프의 실질 상태)의
-- 서버 정본. 지금까지 localStorage 전용이라 기기 변경 = 유실이었다.
-- 소유권은 기존 owned-project 게이트(project_id+user_key)를 그대로 따르고,
-- ext_json은 서버에서 256KB 캡(스크린샷류는 이미 R2 — 텍스트 상태만).
-- 충돌 규칙 = last-write-wins (DR-2). Additive only.

CREATE TABLE IF NOT EXISTS workspace_project_ext (
  project_id TEXT NOT NULL PRIMARY KEY,
  user_key   TEXT NOT NULL,
  ext_json   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_project_ext_user
  ON workspace_project_ext(user_key);
