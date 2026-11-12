-- 0019: one row per scheduled job run (audit OPS-03).
--
-- ADDITIVE ONLY. Each cron task records when it started, how it ended and a
-- short detail, so a failure is visible in a table and in the daily summary
-- email instead of only in Workers logs. Code tolerates the table being absent
-- (it logs instead), so this can be applied before or after the deploy.
--
--   npx wrangler d1 migrations apply devlab-studios-cms-preview --remote --env preview
--   npx wrangler d1 migrations apply devlab-studios-cms --remote

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('running', 'ok', 'failed')),
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_outcome_started ON job_runs(outcome, started_at DESC);
