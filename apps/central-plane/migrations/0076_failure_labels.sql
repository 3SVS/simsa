-- 0076_failure_labels.sql (2026-10-24, train L3) — 실패 데이터 라벨(라벨링 설계 v1, 2026-10-21 LOCKED) 저장.
--
-- 두 표, 둘 다 append-only(고치면 새 행 + supersedes, 지우지 않는다 — L-D7):
--   label_ac_verdicts — 기준 하나의 판정(H): 출처(machine·labeler_agent·user)마다 따로. 서로 덮어쓰지 않는다(L-D9).
--   label_failure_events — 실패 사건(F): 사용자가 결과를 못 얻는 한 지점. 데이터 판매·통계의 단위.
--
-- ★닫힌 어휘 칸만 저장한다. 화면 글자 인용·판정 문장·행동 기록·앱 주소는 넣지 않는다(사용자 앱의 화면에는 다른 사람의 정보가
--   있을 수 있다 — inspection_defects(C13)와 같은 원칙). 앱은 app_id(주소 해시)로만, 화면은 정규화한 경로(W2)만.
--   원문 증거는 그 런의 report_json(소유자 범위)에 남고, 여기서는 런 id로만 가리킨다.
-- 쓰는 곳: 검수 완료 콜백 — 운영 정보 기록이 허용된 런만(finding codes·inspection_defects와 같은 게이트 opsMetaAllowedForRun).
-- 읽는 곳: 관리자 집계 /admin/failure-stats(내부 토큰)만. 행 단위 내보내기 없음(설계 §9 — 판매·공개는 집계만).
--
-- 형태: 새 표 2개만(additive). 기존 표·데이터 변경 0. 0072는 과금 예약 번호.
-- 배포 순서: `migration 0076 apply approved.` → 적용 확인 → deploy central-plane. 적용 전에는 쓰기가 실패하고 조용히 건너뛴다.

CREATE TABLE IF NOT EXISTS label_ac_verdicts (
  label_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  ac_id TEXT NOT NULL,
  priority TEXT,
  source TEXT NOT NULL CHECK (source IN ('machine', 'labeler_agent', 'user')),
  producer TEXT NOT NULL,
  model TEXT,
  h1 TEXT NOT NULL CHECK (h1 IN ('pass', 'fail', 'cannot_verify', 'not_applicable')),
  h2 TEXT,
  h3 TEXT NOT NULL,
  h4 TEXT NOT NULL,
  machine_reasons TEXT,
  label_schema_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  axes_version TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  supersedes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS label_ac_verdicts_run_idx ON label_ac_verdicts(run_id);
CREATE INDEX IF NOT EXISTS label_ac_verdicts_created_idx ON label_ac_verdicts(created_at);

CREATE TABLE IF NOT EXISTS label_failure_events (
  failure_id TEXT PRIMARY KEY,
  label_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  ac_id TEXT NOT NULL,
  builder TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('machine', 'labeler_agent', 'user')),
  producer TEXT NOT NULL,
  model TEXT,
  w1 TEXT NOT NULL,
  w2 TEXT NOT NULL,
  w3 TEXT NOT NULL,
  y TEXT NOT NULL,
  c TEXT NOT NULL,
  k TEXT NOT NULL,
  s TEXT NOT NULL CHECK (s IN ('S1', 'S2', 'S3', 'S4')),
  r TEXT,
  reproduced_k INTEGER,
  reproduced_n INTEGER,
  a TEXT NOT NULL,
  p INTEGER NOT NULL CHECK (p IN (0, 1)),
  x TEXT,
  defect_group TEXT,
  label_schema_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  axes_version TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  supersedes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS label_failure_events_run_idx ON label_failure_events(run_id);
CREATE INDEX IF NOT EXISTS label_failure_events_created_idx ON label_failure_events(created_at);
CREATE INDEX IF NOT EXISTS label_failure_events_builder_idx ON label_failure_events(builder, k);
