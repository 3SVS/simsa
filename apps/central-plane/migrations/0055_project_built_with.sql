-- 0055 — builtWith: which AI tool(s) built this app.
--
-- The single most defensible axis of the data moat: only Simsa sits across many
-- agents' outputs judging them against user intent, so a per-agent failure map
-- is uniquely ours — but ONLY if every project (and the records copied from it)
-- carries the tool tag. The tag can only be attached at capture time (the user
-- tells us when creating the project) and cannot be backfilled, so the column
-- ships before the beta opens. Stored as JSON: { tools[], primary?, other?, modelNote? }.

ALTER TABLE workspace_projects ADD COLUMN built_with_json TEXT NOT NULL DEFAULT 'null';
