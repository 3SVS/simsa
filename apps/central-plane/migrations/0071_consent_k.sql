-- 0071_consent_k.sql (2026-09-30) — Train K · 동의·프라이버시 D-21 집행 (가격·동의 계획 §4 · §5.2 K-1·K-2·K-3).
--
-- 왜 (코드로 확인한 결함 3건):
--   ① 학습 동의 거절이 저장되지 않았다 — setTrainingConsent(false)가 consent_version을 NULL로 지워
--     "거절"과 "아직 안 정함"이 구분되지 않았고, 그래서 거절한 사람이 다시 초대됐다.
--     → decided_at(결정 시각)을 더하고, 거절도 현재 조항 버전으로 저장한다(training-consent-db.ts).
--   ② 운영 정보(0069 region·envelope_json·finding_codes_json·region_at_create·수리 잡 region)는
--     방침 §1에 고지됐지만 끄는 설정이 없었다(privacy-ops-info.mjs OPS_INFO_OPT_OUT "준비 중").
--     → privacy_prefs: 사람별 '운영 정보 기록' 선택. 행 없음 = 기본값(EU/EEA·GB·CH는 off, 그 밖은 on —
--       workspace/privacy-prefs.ts defaultOpsMetaForRegion).
--   ③ 학습 사본(R2 events/{region}/… · journey/…)은 키에 사람이 없고 본문에만 subject_hash(= sha256(userKey))·
--     project_id가 있어, 버킷을 다 읽지 않고는 철회·프로젝트 삭제 때 찾을 수 없었다(방침 TRAINING_COPY_NOTE
--     "지워지지 않습니다").
--     → training_records_index: 캡처할 때 R2 키를 사람·프로젝트와 함께 적는 색인.
--       0071 이전 사본(PR #574 검증 #574-2로 정정): 본문의 subject_hash·project_id로 사람·프로젝트를 **찾을 수
--       있다**(동의 행의 원문 user_key를 sha256하면 1:1). 일회성 백필 scripts/backfill-training-index.mjs(읽기 전용
--       R2 → SQL 파일, **적용은 별도 승인**)가 색인에 넣으면 그 뒤로 철회·프로젝트 삭제·크론이 지운다.
--       백필 전 자동 경로가 닿는 것은 검수 런 행(workspace_pr_review_runs.training_r2_key, 0057)이 아직 가리키는
--       events/ 사본뿐이다 — 여정 사본(journey/…) 전부와, 검수 런 행이 사라진 events/ 사본(0071 이전에 삭제된
--       프로젝트의 사본·0057 이전 캡처·키 기록 실패분)은 백필 전까지 자동으로 지워지지 않는다(PR·방침에 명시).
--
-- user_key 저장 방식: workspace_training_consent(0054)와 **같이 원문**. 동의 행이 원문 user_key로 찾히므로
-- 철회 요청을 받은 그 키로 색인을 찾아야 한다. R2 사본 자체는 여전히 sha256(userKey)만 담는다(training-store.ts).
--
-- training_records_index 칸
--   id                   'tri_' + sha256(r2_key) 앞 32자 — 같은 키를 다시 쓰면 같은 행(멱등)
--   user_key             캡처한 사람(원문, 위 참고)
--   project_id           캡처가 속한 프로젝트(프로젝트 삭제 시 이것으로 찾는다)
--   r2_key               EVIDENCE 버킷의 객체 키(events/… 또는 journey/…)
--   kind                 'training'(training-store) | 'journey'(journey-store)
--   captured_at          캡처 시각
--   delete_requested_at  삭제가 요청된 시각(철회 또는 프로젝트 삭제). **계약 표 대비 추가 칸** — 요청을
--                        D1에 먼저 남겨야 R2 삭제가 실패해도 크론이 다시 시도할 수 있다(요청 없이 deleted_at만
--                        있으면 "지워야 하는데 아직 못 지운 것"을 구분할 방법이 없다).
--   deleted_at           R2에서 실제로 지운 시각(지운 뒤에만 찍는다)
--
-- ★ 배포 순서(강제): 이 파일 뒤의 Worker는 workspace_training_consent.decided_at을 쓰고 privacy_prefs·
-- training_records_index를 읽고 쓴다. 0071 미적용 D1에서 이 Worker가 돌면:
--   - 동의 저장(POST /workspace/training-consent)이 실패한다.
--   - **프로젝트 삭제 전체가 실패한다** — deleteProject의 캐스케이드 배치 맨 앞 두 문장이 training_records_index를
--     쓰므로 'no such table'로 배치가 통째로 되돌려진다(PR #574 검증 #574-8).
--   - **모든 학습 사본 캡처가 저장되지 않는다**(색인을 못 쓰면 사본도 저장하지 않는다 — index_error 한 줄 로그).
--   - 운영 정보 게이트는 fail-closed(기록 안 함)로 떨어진다.
-- 순서는 `migration 0071 apply approved.` → 적용 확인 → deploy central-plane. deploy-central-plane 워크플로와
-- `pnpm ship`은 scripts/d1-migrations-gate.mjs로 미적용 마이그레이션이 있으면 배포를 거부한다.
-- 형태: ADD COLUMN 1 + 새 표 2 + 인덱스(additive). 데이터 변경 0.

ALTER TABLE workspace_training_consent ADD COLUMN decided_at TEXT;

CREATE TABLE IF NOT EXISTS privacy_prefs (
  user_key TEXT PRIMARY KEY,
  ops_meta TEXT CHECK (ops_meta IN ('on','off')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS training_records_index (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  project_id TEXT,
  r2_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  delete_requested_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS training_records_index_user_idx ON training_records_index(user_key);
CREATE INDEX IF NOT EXISTS training_records_index_project_idx ON training_records_index(project_id);
-- 0071 이전 검수 사본(workspace_pr_review_runs.training_r2_key)을 색인에 옮길 때 "이미 색인에 있나"를 키로 찾는다.
CREATE INDEX IF NOT EXISTS training_records_index_r2key_idx ON training_records_index(r2_key);
-- 크론 재시도: "요청됐지만 아직 안 지운 것"만 훑는다(부분 인덱스 — 지운 행·요청 없는 행은 담지 않는다).
CREATE INDEX IF NOT EXISTS training_records_index_pending_idx ON training_records_index(delete_requested_at)
  WHERE delete_requested_at IS NOT NULL AND deleted_at IS NULL;
