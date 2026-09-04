-- migration_add_company_indexes.sql
--
-- Adds the missing company_id index (and a few other high-traffic filter
-- columns) found during this session's performance audit. Every statement
-- is idempotent (IF NOT EXISTS) and additive-only — safe to run more than
-- once, and safe to run against a live database with no downtime.
--
-- Why this matters: company_id is the primary tenant-isolation filter used
-- on nearly every query in this app (user lists, dashboards, assignments,
-- modules), but it has never had a supporting index. At current pilot-scale
-- data this is invisible; as each company's data grows, these queries will
-- degrade from an index lookup to a full table scan.
--
-- How to run: paste this into the Supabase project's SQL Editor and run it.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block — if the
-- SQL Editor wraps statements in one, run each CONCURRENTLY statement
-- individually (one at a time) rather than as a single pasted block.

-- users.company_id — filters nearly every admin/manager query in the app
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_company_id
  ON users(company_id);

-- modules.company_id — module list/lookup is filtered by company on every load
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modules_company_id
  ON modules(company_id);

-- assignments — the two columns nearly every assignment query filters by
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignments_assigned_to_user
  ON assignments(assigned_to_user);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assignments_assigned_by
  ON assignments(assigned_by);

-- groups.company_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_groups_company_id
  ON groups(company_id);

-- Note: this does NOT address the separate, larger issue found in the same
-- audit — several tables (assessments, assessment_submissions,
-- assessment_reports, role_library, generated_content, access_codes, etc.)
-- store all filterable fields inside a single JSONB `data` column with only
-- `id` as a real column, so no index can target companyId/userId/
-- assessmentId there at all — every query against those tables is
-- structurally a full scan regardless of size. Fixing that requires either
-- PostgreSQL generated columns + expression indexes (e.g.
-- `((data->>'companyId'))`) or moving the hot fields to real flat columns —
-- a larger, deliberate schema change, not a drop-in migration. Flagging
-- here so it isn't lost; happy to design that migration when you're ready
-- to schedule it.
