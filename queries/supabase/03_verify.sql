-- ============================================================================
-- SkillForge AI - VERIFY THE DATABASE SETUP (read-only)
-- File: queries/supabase/03_verify.sql
--
-- Only SELECT statements - nothing is changed. The Supabase SQL Editor shows
-- only the result of the LAST statement in a run, so run each numbered block
-- on its own (select the block, then Run Selected) or paste one at a time.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Which expected tables exist?  Every row should say OK.
--    (any row saying MISSING -> run 01_full_schema_new_database.sql again)
-- ---------------------------------------------------------------------------
SELECT e.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
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
ORDER BY status DESC, e.table_name;


-- ---------------------------------------------------------------------------
-- 2. Row count per table (exact counts; fine for the small tables used here)
-- ---------------------------------------------------------------------------
SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'user_jd_profiles', COUNT(*) FROM user_jd_profiles
UNION ALL SELECT 'activation_tokens', COUNT(*) FROM activation_tokens
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'companies', COUNT(*) FROM companies
UNION ALL SELECT 'organizations', COUNT(*) FROM organizations
UNION ALL SELECT 'departments', COUNT(*) FROM departments
UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'access_codes', COUNT(*) FROM access_codes
UNION ALL SELECT 'groups', COUNT(*) FROM groups
UNION ALL SELECT 'group_memberships', COUNT(*) FROM group_memberships
UNION ALL SELECT 'manager_mappings', COUNT(*) FROM manager_mappings
UNION ALL SELECT 'bulk_import_logs', COUNT(*) FROM bulk_import_logs
UNION ALL SELECT 'role_library', COUNT(*) FROM role_library
UNION ALL SELECT 'question_bank_versions', COUNT(*) FROM question_bank_versions
UNION ALL SELECT 'question_bank_archives', COUNT(*) FROM question_bank_archives
UNION ALL SELECT 'assessments', COUNT(*) FROM assessments
UNION ALL SELECT 'assessment_submissions', COUNT(*) FROM assessment_submissions
UNION ALL SELECT 'employee_assessment_assignments', COUNT(*) FROM employee_assessment_assignments
UNION ALL SELECT 'assessment_reports', COUNT(*) FROM assessment_reports
UNION ALL SELECT 'reminders', COUNT(*) FROM reminders
UNION ALL SELECT 'modules', COUNT(*) FROM modules
UNION ALL SELECT 'packages', COUNT(*) FROM packages
UNION ALL SELECT 'skill_packages', COUNT(*) FROM skill_packages
UNION ALL SELECT 'learning_tracks', COUNT(*) FROM learning_tracks
UNION ALL SELECT 'pending_modules', COUNT(*) FROM pending_modules
UNION ALL SELECT 'module_assignments', COUNT(*) FROM module_assignments
UNION ALL SELECT 'generated_modules', COUNT(*) FROM generated_modules
UNION ALL SELECT 'generated_content', COUNT(*) FROM generated_content
UNION ALL SELECT 'employee_checklists', COUNT(*) FROM employee_checklists
UNION ALL SELECT 'approval_requests', COUNT(*) FROM approval_requests
UNION ALL SELECT 'assignments', COUNT(*) FROM assignments
UNION ALL SELECT 'assignment_requests', COUNT(*) FROM assignment_requests
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'user_skill_interactions', COUNT(*) FROM user_skill_interactions
UNION ALL SELECT 'rec_metrics', COUNT(*) FROM rec_metrics
UNION ALL SELECT 'recommendations_log', COUNT(*) FROM recommendations_log
UNION ALL SELECT 'rec_exclusions', COUNT(*) FROM rec_exclusions
UNION ALL SELECT 'rec_skills', COUNT(*) FROM rec_skills
UNION ALL SELECT 'rec_market_demand', COUNT(*) FROM rec_market_demand
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'platform_settings', COUNT(*) FROM platform_settings
UNION ALL SELECT 'assessment_thresholds', COUNT(*) FROM assessment_thresholds
ORDER BY table_name;


-- ---------------------------------------------------------------------------
-- 3. Columns of the key tables: users + employee_assessment_assignments
--    users must include employee_id, phone, status, company_id, otp_expires,
--    permissions ... ; employee_assessment_assignments must include start_at
--    and due_at.
-- ---------------------------------------------------------------------------
SELECT table_name, ordinal_position, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'employee_assessment_assignments')
ORDER BY table_name, ordinal_position;


-- ---------------------------------------------------------------------------
-- 4. Required columns still missing (expected result: ZERO rows)
-- ---------------------------------------------------------------------------
SELECT r.table_name, r.column_name AS missing_column
FROM (VALUES
  ('users','employee_id'),('users','phone'),('users','status'),('users','company_id'),
  ('users','company_name'),('users','job_role'),('users','department'),
  ('users','job_description'),('users','job_description_file'),('users','jd_skills'),
  ('users','accesses'),('users','permissions'),('users','additional_job_roles'),
  ('users','otp'),('users','otp_expires'),('users','reset_token'),
  ('users','reset_token_expires'),('users','must_change_password'),
  ('users','google_id'),('users','manager_id'),('users','learning_uuid'),
  ('users','password_hash'),('users','email_verified'),('users','last_login'),
  ('employee_assessment_assignments','start_at'),
  ('employee_assessment_assignments','due_at'),
  ('employee_assessment_assignments','question_order'),
  ('employee_assessment_assignments','scoring'),
  ('question_bank_versions','unlocked_at'),('question_bank_versions','unlocked_by'),
  ('groups','name'),
  ('assignments','module_name'),('assignments','session_progress'),('assignments','progress_data'),
  ('modules','content'),('modules','company_id'),
  ('reminders','sent_at'),('reminders','delivery_status'),
  ('platform_settings','settings')
) AS r(table_name, column_name)
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = r.column_name
WHERE c.column_name IS NULL;


-- ---------------------------------------------------------------------------
-- 5. Indexes (the important ones are listed first)
-- ---------------------------------------------------------------------------
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY (indexname IN ('idx_users_company_employee_id','uq_eaa_assessment_user','uq_qbv_role_version')) DESC,
         tablename, indexname;


-- ---------------------------------------------------------------------------
-- 6. Storage buckets (this app does not use Supabase Storage, so an empty
--    result is normal)
-- ---------------------------------------------------------------------------
SELECT id, name, public, created_at FROM storage.buckets ORDER BY name;


-- ---------------------------------------------------------------------------
-- 7. Row Level Security state per table (app tables should show rls_enabled = false)
-- ---------------------------------------------------------------------------
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
