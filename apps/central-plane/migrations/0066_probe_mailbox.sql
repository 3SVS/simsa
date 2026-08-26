-- 0066 — 검수용 일회용 메일함 (2026-08-26).
--
-- 왜: 로그인 뒤 화면을 검수하려면 계정이 필요한데, **남의 비밀번호를 받아 보관하는
-- 것은 하지 않는다**(유출 시 그 앱뿐 아니라 비밀번호를 재사용한 다른 계정까지
-- 열리고, 비개발자에게 "검수 도구에 비밀번호를 주는 습관"을 가르치게 된다).
--
-- 대신 **우리가 일회용 계정을 만든다.** 그러려면 앱이 보내는 확인 메일을 받아야 하고,
-- 그게 이 표다. `probe-<runId>@<수신도메인>` 앞으로 온 메일을 Email Worker가 여기에
-- 넣고, 컨테이너가 링크를 꺼내 가입을 완주한다.
--
-- 보존: 본문은 저장하지 않는다. **링크와 제목만** 남긴다 — 남의 앱이 보낸 메일에는
-- 그 앱 사용자의 정보가 담길 수 있으므로 필요한 최소치만 갖는다.
CREATE TABLE IF NOT EXISTS probe_emails (
  id TEXT PRIMARY KEY,
  -- 어느 검수 실행의 메일함인가. probe-<run_id>@... 의 그 run_id.
  run_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  from_addr TEXT,
  subject TEXT,
  -- 본문에서 뽑아낸 링크 목록(JSON 배열). 본문 자체는 저장하지 않는다.
  links TEXT NOT NULL DEFAULT '[]',
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS probe_emails_run_idx ON probe_emails(run_id, received_at);

-- 오래된 메일은 남겨둘 이유가 없다. 정리는 기존 GC 크론이 이 인덱스로 훑는다.
CREATE INDEX IF NOT EXISTS probe_emails_received_idx ON probe_emails(received_at);
