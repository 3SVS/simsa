-- 0073_hosting_duties.sql (2026-09-30, PR #575 검증 반영 2026-10-01) — SI 티어 Train B · B-7 호스팅 사업자 의무(D-6).
--
-- 번호: 0071은 Train K(동의), 0072는 과금 예약 — 이 파일은 0073. D1은 이름으로 적용하므로 번호 사이 빈칸은 무해하다.
--
-- 왜: Simsa가 <slug>.simsa.page에 대신 올려 준 앱이 피싱·스팸·성인·악성코드·불법 콘텐츠로 쓰이면 관리자가
-- 즉시 막을 수 있어야 하고(정지 목록은 Workers KV — 라우터가 요청마다 읽는다), 누구나 신고할 수 있어야 하며,
-- **모든 정지·해제는 기록으로 남아야 한다.** 기존 표 중 이 용도에 맞는 것이 없어 두 표를 새로 만든다.
--
-- hosting_suspension_log — 정지·해제·플래그 한 번 = 한 행.
--   suspend/unsuspend: **관리자만**(source='admin'). 순서: 행을 먼저 쓰고(applied=0) → KV에 반영 → applied=1.
--     행을 못 쓰면 KV도 건드리지 않는다(기록 없는 정지는 없다). KV 반영이 실패하면 행은 applied=0으로 남는다.
--   flag: 요청 상한 초과가 이어진 앱을 운영자에게 알린 기록(source='auto_flag'). **정지가 아니다** — KV를 건드리지
--     않으므로 행 하나가 전부(applied=1). 트래픽 양만으로는 정지하지 않는다(PR #575 검증 P1).
--   memo는 운영 메모(≤1000) — 신고자·앱 소유자의 개인정보를 적지 않는다.
--
-- hosting_reports — report.simsa.page 신고 폼·API로 들어온 신고. 접수 스위치 HOSTING_REPORTS_ENABLED(기본 off).
--   reporter_key = "v1:" + HMAC(비밀 키, 신고자 네트워크 — IPv4 주소 · IPv6 /64) — **IP 원문은 저장하지 않는다**.
--   contact는 신고자가 스스로 적은 답장용 연락처(선택, ≤200). description ≤1000.
--   app_verified: 1 = build_jobs에 있는 앱(Simsa가 실제로 올린 앱) / 0 = 확인 조회가 실패해 확인 못 하고 받음.
--   status: open → actioned(관리자 정지가 닫음, actioned_log_id = 그 정지 로그 id — 해제하면 다시 open) / dismissed(운영자 판단).
--   notified_at: 운영자 알림 묶음(시간당 한 통)에 실린 시각. NULL = 아직 안 알림.
--   보유: created_at 뒤 180일([PILOT]) — 6시간 크론이 지운다(workspace/hosting-duties.ts purgeExpiredHostingReports).
--
-- build_jobs_slug_idx — 신고 대상 확인(SELECT 1 FROM build_jobs WHERE slug = ?)이 공개 경로라 인덱스로 받는다.
--
-- 형태: 새 표 + 인덱스만(additive). 기존 표·데이터 변경 0.
-- 배포 순서: `migration 0073 apply approved.` → 적용 확인 → deploy central-plane(워크플로의 미적용 마이그레이션 게이트가 강제).

CREATE TABLE IF NOT EXISTS hosting_suspension_log (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('suspend', 'unsuspend', 'flag')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('phishing', 'spam', 'adult', 'malware', 'illegal', 'abuse_other')),
  source TEXT NOT NULL CHECK (source IN ('admin', 'auto_flag')),
  actor TEXT NOT NULL,
  memo TEXT,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  CHECK ((action = 'flag') = (source = 'auto_flag'))
);

CREATE INDEX IF NOT EXISTS hosting_suspension_log_slug_idx ON hosting_suspension_log (slug, created_at);

CREATE TABLE IF NOT EXISTS hosting_reports (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('phishing', 'spam', 'adult', 'malware', 'illegal', 'abuse_other')),
  description TEXT NOT NULL DEFAULT '',
  contact TEXT,
  reporter_key TEXT NOT NULL,
  lang TEXT,
  app_verified INTEGER NOT NULL DEFAULT 1 CHECK (app_verified IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  actioned_log_id TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hosting_reports_slug_idx ON hosting_reports (slug, created_at);
CREATE INDEX IF NOT EXISTS hosting_reports_created_idx ON hosting_reports (created_at);
CREATE INDEX IF NOT EXISTS hosting_reports_pending_idx ON hosting_reports (created_at) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS build_jobs_slug_idx ON build_jobs (slug);
