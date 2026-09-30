-- 0073_hosting_duties.sql (2026-09-30) — SI 티어 Train B · B-7 호스팅 사업자 의무(D-6).
--
-- 번호: 0071은 Train K(동의), 0072는 과금 예약 — 이 파일은 0073. D1은 이름으로 적용하므로 번호 사이 빈칸은 무해하다.
--
-- 왜: Simsa가 <slug>.simsa.page에 대신 올려 준 앱이 피싱·스팸·성인·악성코드·불법 콘텐츠로 쓰이면 관리자가
-- 즉시 막을 수 있어야 하고(정지 목록은 Workers KV — 라우터가 요청마다 읽는다), 누구나 신고할 수 있어야 하며,
-- **모든 정지·해제는 기록으로 남아야 한다.** 기존 표 중 이 용도에 맞는 것이 없어 두 표를 새로 만든다.
--
-- hosting_suspension_log — 정지·해제 한 번 = 한 행(관리자·자동 모두 같은 함수가 쓴다).
--   순서: 행을 먼저 쓰고(applied=0) → KV에 반영 → applied=1. 행을 못 쓰면 KV도 건드리지 않는다
--   (기록 없는 정지는 없다). KV 반영이 실패하면 행은 applied=0으로 남는다(시도의 기록, 재시도 필요).
--   memo는 운영 메모(≤1000) — 신고자·앱 소유자의 개인정보를 적지 않는다.
--
-- hosting_reports — report.simsa.page 신고 폼·API로 들어온 신고.
--   reporter_key = "v1:" + HMAC(비밀 키, IP) (workspace/rate-limit-key.ts) — **IP 원문은 저장하지 않는다**(#566 원칙).
--   contact는 신고자가 스스로 적은 답장용 연락처(선택, ≤200). description ≤1000.
--   status: open → actioned(그 앱을 정지했을 때) / dismissed(운영자 판단).
--
-- 형태: 새 표 + 인덱스만(additive). 기존 표·데이터 변경 0.
-- 배포 순서: `migration 0073 apply approved.` → 적용 확인 → deploy central-plane(워크플로의 미적용 마이그레이션 게이트가 강제).

CREATE TABLE IF NOT EXISTS hosting_suspension_log (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('suspend', 'unsuspend')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('phishing', 'spam', 'adult', 'malware', 'illegal', 'abuse_other')),
  source TEXT NOT NULL CHECK (source IN ('admin', 'auto')),
  actor TEXT NOT NULL,
  memo TEXT,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL,
  applied_at TEXT
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
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS hosting_reports_slug_idx ON hosting_reports (slug, created_at);
CREATE INDEX IF NOT EXISTS hosting_reports_created_idx ON hosting_reports (created_at);
