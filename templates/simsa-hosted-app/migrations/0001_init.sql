-- Simsa 호스팅 템플릿 — 초기 스키마. 새 테이블·컬럼은 새 번호의 파일로 추가한다(기존 파일 수정 금지).
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
