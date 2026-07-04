-- 0057 — STEP 4 outcome poll: remember where a review run's training record was
-- written in R2, so a later recheck can find the PRIOR record and fill its
-- outcome (pending → resolved/unresolved). Only set when a record was actually
-- captured (consent on). Null otherwise.

ALTER TABLE workspace_pr_review_runs ADD COLUMN training_r2_key TEXT;
