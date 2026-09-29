-- 0070_llm_usage.sql (2026-09-28) — Train L · L-3 LLM 사용량 원장 (BM §1 결함 3건의 계측 토대, D-7 [PILOT]).
--
-- 왜: 원가가 로그(anthropic_usage/llm_usage 줄)에만 있어서 집계가 tail 추측이었다. 게다가 라벨이 **요청 모델**
-- 이었다(프로덕션은 ANTHROPIC_ENABLED=off라 실응답은 gpt-5.4). 이 표는 호출 1건 = 1행으로 벤더·요청/실제
-- 모델·토큰·비용(실응답 모델의 공식 단가)·지연을 남기고, /admin/usage-stats가 이것을 job_kind × vendor ×
-- model_actual로 집계해 BM 원가표를 [추정]에서 [확정]으로 옮기는 입력이 된다.
--
-- 개인정보: userKey 원본은 저장하지 않는다 — user_key_hash = sha256(userKey)만(training-store subjectHash와 같은 함수).
-- 프롬프트·응답 본문은 저장하지 않는다(토큰 수만).
--
-- 컬럼
--   job_kind           generate · dev_spec · check · council · repair · build · inspection · other
--   job_id             잡 id(빌드 bj_…, 수리 wrj_…) 또는 동기 요청 id(한 요청의 여러 호출을 묶는다)
--   project_id         소유권이 확인된 프로젝트만(남의 프로젝트 id를 대면 NULL). 콜백 행은 잡 행에서 가져온다.
--   vendor             anthropic · openai · google · cloudflare(컨테이너 시간 행)
--   model_requested    코드가 요청한 모델 · model_actual 실제로 응답한 모델(과금 기준)
--   call_site          호출 지점(generate · dev-spec · check · verify-panel · council-round1 …). 설계 표 외 추가 컬럼:
--                      job_kind 'check' 안에서 검수와 검증 패널(2차 확인)의 원가를 가르기 위함.
--   input_tokens       캐시 제외 입력 · cache_read_tokens · cache_write_tokens · output_tokens
--   cost_usd           model_actual의 공식 단가로 계산(워커 가격표 = llm-pricing.ts)
--   unpriced           1 = 공식 단가 없음 → 보수(최고) 단가로 계산했다(컨테이너 행은 단가 미정이라 0달러 + 1)
--   latency_ms         호출 지연 · container_seconds 컨테이너 행의 실행 초
--
-- ★ 배포 순서(강제): 이 파일 뒤의 Worker는 llm_usage에 INSERT한다. 기록은 fail-open이라 0070 미적용 D1에서도
-- 요청은 깨지지 않지만(행이 조용히 빠진다), 원장이 비는 것 자체가 계측 실패다. 순서는
-- `migration 0070 apply approved.` → 적용 확인 → deploy central-plane. deploy-central-plane 워크플로와 `pnpm ship`은
-- scripts/d1-migrations-gate.mjs로 미적용 마이그레이션이 있으면 배포를 거부한다.
-- 형태: 새 표 + 인덱스만(additive). 데이터 변경 0.

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  job_kind TEXT NOT NULL CHECK (job_kind IN ('generate','dev_spec','check','council','repair','build','inspection','other')),
  job_id TEXT,
  project_id TEXT,
  user_key_hash TEXT,
  vendor TEXT NOT NULL,
  model_requested TEXT,
  model_actual TEXT NOT NULL,
  call_site TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  unpriced INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  container_seconds REAL
);

CREATE INDEX IF NOT EXISTS llm_usage_kind_created_idx ON llm_usage(job_kind, created_at);
CREATE INDEX IF NOT EXISTS llm_usage_job_idx ON llm_usage(job_id);
-- /admin/usage-stats의 기간 조회(job_kind 조건 없음)는 (job_kind, created_at)의 선두 컬럼이 없어 그 인덱스를
-- 못 탄다(전체 SCAN). created_at 단독 인덱스로 범위 검색 + 최신순 역스캔(ORDER BY created_at DESC LIMIT).
CREATE INDEX IF NOT EXISTS llm_usage_created_idx ON llm_usage(created_at);
