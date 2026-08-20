-- 0065_visual_check_locale.sql (2026-08-20)
--
-- G14-b 후속: 재검수 locale 영속. verify-sweep(find→fix→verify 원)이 원 런의
-- 언어로 재검수를 디스패치할 수 있도록 런 행에 locale을 저장한다.
-- (verify-sweep.ts v1 정직 한계 — "재검수 locale은 ko 고정(런 행에 locale
--  미저장)" — 를 해소하는 마이그레이션.)
--
-- NULL = 레거시 행(locale 미기록) — 코드에서 ko로 취급한다.
ALTER TABLE workspace_visual_checks ADD COLUMN locale TEXT;
