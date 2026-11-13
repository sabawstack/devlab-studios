-- Write-up fields for the case-study layout (spec K.2, CMS-01).
-- Additive only: four columns on projects, each with a value that means
-- "not set", so existing rows and code that does not know them are unchanged.
-- The system drawing already has its column (system_diagram_id, 0018).
-- Rollback: stop reading the columns (no drop).
ALTER TABLE projects ADD COLUMN situation TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN decisions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE projects ADD COLUMN scope TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN in_operation_since TEXT NOT NULL DEFAULT '';
