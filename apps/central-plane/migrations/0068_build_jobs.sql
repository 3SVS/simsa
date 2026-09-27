-- 0068 — build_jobs (SI 티어 Train B — B5, D-4 · D-7, 2026-09-26).
--
-- T1 빌드 잡의 상태 머신. Simsa가 유저 기획(개발 지시서)을 컨테이너 안에서 구현·빌드·테스트하고
-- S 모드(우리 Workers for Platforms)에 배포하는 한 번의 실행이 한 행이다.
--
-- 상태(D-4): queued → scaffolding → implementing → building → testing → pushed → deploying → done | failed
-- 대시보드는 이 상태를 **그대로** 보여준다(진행률 % 아님). failed는 어느 단계에서(failed_stage) 왜(error).
--
-- 예산(D-7): budget_usd는 잡 시작 전에 정해지고 spent_usd는 벤더 usage 합산. 상한 도달 시
-- 현재 WBS 단계에서 정지 → failed(budget). 조용한 초과 없음.
--
-- 비밀은 이 표에 없다. 운영 토큰·LLM 키는 디스패치 페이로드로만 컨테이너 메모리에 잡 수명 동안 존재.
CREATE TABLE IF NOT EXISTS build_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  -- 호스팅 slug = 유저 Worker 이름 = 저장소 이름 (hosting-provision.toHostedSlug)
  slug TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','scaffolding','implementing','building','testing','pushed','deploying','done','failed')),
  -- 실패했을 때 어느 단계였나(queued~deploying 중 하나 또는 'budget')
  failed_stage TEXT,
  error TEXT,
  -- 진행 표시: WBS n/N
  wbs_done INTEGER NOT NULL DEFAULT 0,
  wbs_total INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL,
  spent_usd REAL NOT NULL DEFAULT 0,
  -- 배포 결과
  d1_id TEXT,
  repo_full_name TEXT,
  commit_sha TEXT,
  deployed_url TEXT,
  -- 빌드 게이트 증거: 마지막 pnpm run build 종료 코드. done인데 0이 아니면 있을 수 없다(테스트로 고정).
  build_exit_code INTEGER,
  locale TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS build_jobs_project_idx ON build_jobs(project_id, created_at);
CREATE INDEX IF NOT EXISTS build_jobs_status_updated_idx ON build_jobs(status, updated_at);

-- 타임라인(대시보드 "지금 무엇을 하고 있나"). 컨테이너가 단계마다 한 줄씩 보낸다.
CREATE TABLE IF NOT EXISTS build_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  at TEXT NOT NULL,
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS build_job_events_job_idx ON build_job_events(job_id, at);
