-- 0062 — client_errors (G12, 2026-07-18 backlog).
--
-- 비개발자는 오류를 신고하지 않고 조용히 이탈한다. dashboard의 전역
-- error/unhandledrejection을 여기로 모아 서버 로그만 보던 사각을 없앤다.
-- 저장 전 절단(서버측 강제) + IP 레이트리밋. Additive only.

CREATE TABLE IF NOT EXISTS client_errors (
  id         TEXT NOT NULL PRIMARY KEY,
  user_key   TEXT,
  path       TEXT,
  message    TEXT NOT NULL,
  stack      TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created
  ON client_errors(created_at DESC);
