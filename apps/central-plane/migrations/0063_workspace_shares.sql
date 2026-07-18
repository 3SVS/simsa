-- 0063 — workspace_shares (G11, 2026-07-18 backlog).
--
-- 검수 리포트/브리프의 읽기전용 공유: 공유 시점의 스냅샷을 저장하고
-- 추측 불가 id로만 열람한다. 살아있는 데이터를 노출하지 않는 스냅샷 모델이
-- 프라이버시 경계다("공유한 그 내용만, 그 시점 그대로"). 회수는 revoked_at
-- 타임스탬프(DELETE 아님 — 이력 보존). Additive only.

CREATE TABLE IF NOT EXISTS workspace_shares (
  id           TEXT NOT NULL PRIMARY KEY,   -- shr_<hex20> (추측 불가)
  user_key     TEXT NOT NULL,
  project_id   TEXT,
  payload_json TEXT NOT NULL,               -- 스냅샷 (서버 크기 캡)
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_shares_user
  ON workspace_shares(user_key, created_at DESC);
