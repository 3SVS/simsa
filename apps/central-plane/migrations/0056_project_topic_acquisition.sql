-- 0056 — P1 envelope collection on the project: topic_tags + acquisition.
--
-- topic_tags: structured market-map classification (domain/pattern/integrations/
-- ai_feature), computed at project creation from the idea/spec (deterministic).
-- acquisition: where/how the user arrived (source), captured at creation.
-- Both are capture-time tags copied onto every training record's envelope.
-- JSON columns, 'null' default until sourced.

ALTER TABLE workspace_projects ADD COLUMN topic_tags_json TEXT NOT NULL DEFAULT 'null';
ALTER TABLE workspace_projects ADD COLUMN acquisition_json TEXT NOT NULL DEFAULT 'null';
