-- 0061 — reengage_nudges (G1, 2026-07-18 backlog 승인).
--
-- 빌더팩을 받아 나간 뒤 돌아오지 않은 유저에게 보낸 복귀 넛지 기록.
-- (user_key, project_id)당 딱 1회 — 재발송 없음(스팸 방지가 하드 규칙).
-- Additive only.

CREATE TABLE IF NOT EXISTS reengage_nudges (
  user_key   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (user_key, project_id)
);
