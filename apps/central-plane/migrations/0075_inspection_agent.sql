-- 0075_inspection_agent.sql (2026-10-05) — 검수 "agent" 엔진(수용 기준 실행기).
--
-- 번호: 0072는 과금 예약, 0074는 플랜 티어 — 이 파일은 0075.
--
-- inspection_run_secrets — 사용자가 **명시적으로 동의하고** 준 시험 계정(아이디·비밀번호·로그인 주소).
--   ciphertext = AES-256-GCM(CONCLAVE_TOKEN_KEK) — 평문은 저장하지 않는다(crypto.ts encryptToken).
--   런 하나에만 쓰인다: 디스패치 순간에만 복호화해 그 런의 컨테이너 페이로드에 싣고, 런이 끝나면(done·failed·
--   스턱 스윕·디스패치 실패·행 폐기) 지운다. 그래도 남은 행은 크론이 created_at 뒤 1시간에 지운다(최후 방어).
--   로그·리포트·고침 지시·LLM 프롬프트에는 절대 들어가지 않는다(컨테이너가 가리고, 테스트가 고정).
--
-- inspection_agent_spend — agent 엔진 런 하나의 LLM 예산(서버 권위). 컨테이너는 LLM 키를 모른다:
--   /internal/inspect-llm/v1/messages 가 런 범위 토큰으로 인증하고 호출마다 최악 비용을 원자적으로 예약한 뒤
--   실제 비용으로 정산한다(build-llm-proxy와 같은 방식). 원장(llm_usage)은 job_kind 'inspection' ·
--   call_site 'inspect_agent' 로 남는다(job_kind CHECK를 넓히려면 원장 표를 다시 만들어야 해서 call_site로 가른다).
--
-- 형태: 새 표 2개만(additive). 기존 표·데이터 변경 0.
-- 배포 순서: `migration 0075 apply approved.` → 적용 확인 → deploy central-plane.

CREATE TABLE IF NOT EXISTS inspection_run_secrets (
  run_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('credentials')),
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS inspection_run_secrets_created_idx ON inspection_run_secrets(created_at);

CREATE TABLE IF NOT EXISTS inspection_agent_spend (
  run_id TEXT PRIMARY KEY,
  budget_usd REAL NOT NULL CHECK (budget_usd > 0),
  spent_usd REAL NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  max_calls INTEGER NOT NULL CHECK (max_calls > 0),
  created_at TEXT NOT NULL
);
