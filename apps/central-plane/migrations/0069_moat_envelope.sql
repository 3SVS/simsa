-- 0069_moat_envelope.sql (2026-09-27) — Train C · C4a 데이터 봉투 (재정렬 D-8 amend, W1 §3).
--
-- 왜: 기록 단위를 "4중항 + 맥락 봉투 + 사람 수용 라벨"로 넓힌다(D-8 amend). 봉투(region·
-- built_with·entry_path·topic_tags·locale·content_lang)는 training-store.ts EnvelopeInput 모양을
-- 그대로 쓰고, 사람 수용 라벨은 finding_codes[]·user_verdict·resolved 세 개다. 나라·도구·유형별
-- 실패 지도(D-21 ⓪)와 북극성(user_verdict = as_intended로 닫힌 건수, D-19 amend)이 여기서 나온다.
--
-- 선례: 0065(visual_check locale)·0052(repair_job mode) — ALTER TABLE ADD COLUMN, NULL 허용,
-- 데이터 변경 없음. 모두 additive. 레거시 행은 NULL = "기록되지 않음"(코드에서 null 취급).
--
-- ★ 배포 순서(강제): additive는 옛 **행**에 안전할 뿐, 옛 **스키마**에는 안전하지 않다. 이 파일
-- 뒤의 Worker는 아래 컬럼을 SELECT에 이름으로 박아 두므로, 0069 미적용 D1에 배포되면 getProject가
-- throw → /workspace/projects/:id/* 전부 500. 순서는 `migration 0069 apply approved.` → 적용 확인 →
-- `deploy central-plane approved.`. deploy-central-plane 워크플로와 `pnpm ship`은
-- scripts/d1-migrations-gate.mjs로 이 순서를 코드로 강제한다(미적용 마이그레이션 있으면 배포 거부).
-- 번호: 이 브랜치의 다음 빈 번호. 0068은 #548(org hosting) 몫이며 D1은 이름 기준 적용이라 공백은 무해.
--
-- workspace_visual_checks
--   region             ISO-3166 국가 코드(request.cf.country, 거친 값·PII 아님). NULL = 미기록.
--   envelope_json      런 시점 프로젝트 봉투 스냅샷 { builtWith, entryPath, topicTags, locale, contentLang }.
--   finding_codes_json 검수 완료 콜백의 report.findings[].code 배열(안정 코드, 문장 아님).
--   user_verdict       사람 수용 라벨: as_intended | works_but_different | still_broken | unsure.
--   user_verdict_at    라벨을 남긴 시각(재제출은 덮어쓴다).
--   source_check_id    재검수의 원 런 id(C0: intent·target 상속의 출처).
-- workspace_repair_jobs
--   region             수리 요청 시점의 국가 코드.
--   verify_check_id    verify-sweep이 이 수리 뒤에 디스패치한 재검수 런 id.
--   resolved           재검수 완료 시 works===true → 1, false → 0, 판정 불가 → NULL 유지.
-- workspace_projects
--   region_at_create   프로젝트 생성 시점의 국가 코드(capture-once, 업데이트에 덮이지 않음).

ALTER TABLE workspace_visual_checks ADD COLUMN region TEXT;
ALTER TABLE workspace_visual_checks ADD COLUMN envelope_json TEXT;
ALTER TABLE workspace_visual_checks ADD COLUMN finding_codes_json TEXT;
ALTER TABLE workspace_visual_checks ADD COLUMN user_verdict TEXT;
ALTER TABLE workspace_visual_checks ADD COLUMN user_verdict_at TEXT;
ALTER TABLE workspace_visual_checks ADD COLUMN source_check_id TEXT;

ALTER TABLE workspace_repair_jobs ADD COLUMN region TEXT;
ALTER TABLE workspace_repair_jobs ADD COLUMN verify_check_id TEXT;
ALTER TABLE workspace_repair_jobs ADD COLUMN resolved INTEGER;

ALTER TABLE workspace_projects ADD COLUMN region_at_create TEXT;
