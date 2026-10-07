-- ============================================================================
-- SkillForge AI - CHECK THAT NOTHING IS MISSING OR EMPTY  (READ-ONLY)
-- File: queries/supabase/00_check_nothing_lost_READ_ONLY.sql
--
-- This is ONE SELECT statement. It cannot change, add, or delete anything.
-- It lists every table the app uses, whether the table exists, and how many
-- rows it holds. A missing table never causes an error: it just shows MISSING.
--
-- HOW TO USE (Supabase > SQL Editor):
--   1. Paste this whole file and press Run.
--   2. Take a screenshot or copy the result BEFORE you run any other script.
--   3. Run it again AFTER. The row counts must be the same or higher.
--      A count that goes DOWN means data was lost: stop and tell me.
--
-- STATUS column:
--   OK       table exists and has rows
--   EMPTY    table exists but has 0 rows (normal for: reminders,
--            question_bank_archives, assessment_thresholds, platform_settings,
--            rec_* tables, bulk_import_logs, manager_mappings; NOT normal for
--            users, companies, assessments or assessment_reports on a live DB)
--   MISSING  table does not exist yet (run 01 or 02 to create it)
-- ============================================================================

SELECT
  e.table_name,
  CASE
    WHEN t.table_name IS NULL THEN 'MISSING'
    WHEN COALESCE(c.row_count, 0) = 0 THEN 'EMPTY'
    ELSE 'OK'
  END AS status,
  c.row_count
FROM (VALUES
  ('users'),('user_jd_profiles'),('activation_tokens'),('sessions'),
  ('companies'),('organizations'),('departments'),('teams'),('access_codes'),
  ('groups'),('group_memberships'),('manager_mappings'),('bulk_import_logs'),
  ('role_library'),('question_bank_versions'),('question_bank_archives'),
  ('assessments'),('assessment_submissions'),('employee_assessment_assignments'),
  ('assessment_reports'),('reminders'),
  ('modules'),('packages'),('skill_packages'),('learning_tracks'),
  ('pending_modules'),('module_assignments'),('generated_modules'),
  ('generated_content'),('employee_checklists'),('approval_requests'),
  ('assignments'),('assignment_requests'),('notifications'),
  ('user_skill_interactions'),('rec_metrics'),('recommendations_log'),
  ('rec_exclusions'),('rec_skills'),('rec_market_demand'),
  ('audit_logs'),('platform_settings'),('assessment_thresholds')
) AS e(table_name)
LEFT JOIN information_schema.tables t
       ON t.table_schema = 'public' AND t.table_name = e.table_name
LEFT JOIN LATERAL (
  -- Counts rows only when the table exists, so a missing table cannot raise
  -- an error. query_to_xml runs a plain "select count(*)" (read-only).
  SELECT CASE
           WHEN t.table_name IS NULL THEN NULL
           ELSE (xpath('/row/c/text()',
                  query_to_xml(format('select count(*) as c from public.%I', e.table_name),
                               false, true, '')))[1]::text::bigint
         END AS row_count
) c ON true
ORDER BY
  CASE WHEN t.table_name IS NULL THEN 0
       WHEN COALESCE(c.row_count, 0) = 0 THEN 1
       ELSE 2 END,
  e.table_name;
