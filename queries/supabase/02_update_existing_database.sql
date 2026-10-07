-- ============================================================================
-- SkillForge AI - UPDATE AN EXISTING (PRODUCTION) DATABASE
-- File: queries/supabase/02_update_existing_database.sql
--
-- WHAT THIS DOES
--   Brings an OLDER database that already holds data up to date with what the
--   current code needs. It adds ONLY things that are missing:
--     - new columns (ADD COLUMN IF NOT EXISTS)
--     - new tables  (CREATE TABLE IF NOT EXISTS)
--     - new indexes (CREATE INDEX IF NOT EXISTS)
--   Existing rows and existing columns are never changed or removed. There are
--   no statements that remove or empty tables or rows. Safe to run repeatedly.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--   Then run 03_verify.sql.
--
-- If the database is brand new and EMPTY, run 01_full_schema_new_database.sql
-- instead (it already contains everything below).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- A. users: Employee/Manager ID, phone, status (+ other columns the code uses)
--    Without employee_id the app silently loses the ID on save and the
--    reports/downloads show it blank.
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS employee_id          TEXT DEFAULT '';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS phone                TEXT DEFAULT '';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS status               TEXT DEFAULT 'active';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS company_id           TEXT DEFAULT 'default';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS company_name         TEXT DEFAULT '';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS job_role             TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS department           TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS job_description      TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS job_description_file JSONB;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS onboarding_complete  BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS jd_skills            JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS jd_source_url        TEXT DEFAULT '';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS jd_source_type       TEXT DEFAULT 'text';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS accesses             TEXT[] DEFAULT '{}';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS permissions          JSONB DEFAULT '{"granted":[],"revoked":[]}'::jsonb;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS additional_job_roles JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS otp                  TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS otp_expires          TIMESTAMPTZ;   -- the code uses otp_expires (older scripts said otp_expiry)
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS reset_token          TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS reset_token_expires  TIMESTAMPTZ;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS google_id            TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS manager_id           TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_company_id          ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_employee_id ON users (company_id, lower(employee_id));

-- ----------------------------------------------------------------------------
-- B. employee_assessment_assignments: schedule window (start_at / due_at)
--    (needed for assignment dates in the UI, reminders and report downloads)
-- ----------------------------------------------------------------------------
ALTER TABLE IF EXISTS employee_assessment_assignments ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS employee_assessment_assignments ADD COLUMN IF NOT EXISTS due_at   TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_eaa_due_at ON employee_assessment_assignments(due_at);
-- the app upserts on (assessment_id, user_id); make sure that key is unique
CREATE UNIQUE INDEX IF NOT EXISTS uq_eaa_assessment_user ON employee_assessment_assignments(assessment_id, user_id);

-- question_bank_versions: unlock audit columns (lock/unlock workflow)
ALTER TABLE IF EXISTS question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_by TEXT;

-- ----------------------------------------------------------------------------
-- C. New / possibly-missing tables
-- ----------------------------------------------------------------------------

-- Quarterly question-bank snapshots (Role Library "New Generation")
CREATE TABLE IF NOT EXISTS question_bank_archives (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Reminder log (manual "Send Reminder" button + automatic deadline sweep)
CREATE TABLE IF NOT EXISTS reminders (
  id               TEXT PRIMARY KEY,
  assessment_id    TEXT NOT NULL,
  employee_id      TEXT NOT NULL,
  sender_id        TEXT,
  type             TEXT,
  sent_at          TIMESTAMPTZ DEFAULT NOW(),
  delivery_status  TEXT,
  error_message    TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_assignment ON reminders(assessment_id, employee_id, sent_at DESC);

-- Per-company admin settings (was missing in production: settings were only
-- kept in a local file and lost on every server restart)
CREATE TABLE IF NOT EXISTS platform_settings (
  company_id  TEXT PRIMARY KEY,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Document tables the server auto-migration (server/utils/migrateDB.js) does
-- NOT create; created here if absent.
CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS generated_content (
  id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS generated_modules (
  id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS assessment_thresholds (
  id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, learning_uuid TEXT, session_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- D. Column drift fixes on older flat tables
-- ----------------------------------------------------------------------------
-- groups: DataStore.Groups upserts a real `name` column
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS name       TEXT;
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_groups_company_id ON groups(company_id);

-- assignments
ALTER TABLE IF EXISTS assignments ADD COLUMN IF NOT EXISTS module_name      TEXT;
ALTER TABLE IF EXISTS assignments ADD COLUMN IF NOT EXISTS session_progress JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS assignments ADD COLUMN IF NOT EXISTS progress_data    JSONB DEFAULT '{}'::jsonb;

-- modules
ALTER TABLE IF EXISTS modules ADD COLUMN IF NOT EXISTS content           JSONB DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS modules ADD COLUMN IF NOT EXISTS sessions          JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS modules ADD COLUMN IF NOT EXISTS progress_tracking BOOLEAN DEFAULT TRUE;
ALTER TABLE IF EXISTS modules ADD COLUMN IF NOT EXISTS company_id        TEXT;
CREATE INDEX IF NOT EXISTS idx_modules_company_id ON modules(company_id);

-- assignment_requests
ALTER TABLE IF EXISTS assignment_requests ADD COLUMN IF NOT EXISTS group_id     TEXT;
ALTER TABLE IF EXISTS assignment_requests ADD COLUMN IF NOT EXISTS priority     TEXT DEFAULT 'medium';
ALTER TABLE IF EXISTS assignment_requests ADD COLUMN IF NOT EXISTS due_date     TIMESTAMPTZ;
ALTER TABLE IF EXISTS assignment_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW();

-- notifications
ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS action_url TEXT;

-- packages / skill_packages / learning_tracks: the API stores the whole
-- request body, so these columns must exist; ids are generated by the DB.
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS type               TEXT;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS category           TEXT;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS difficulty         TEXT;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS estimated_duration TEXT;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS skills_covered     JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS prerequisites      JSONB DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS packages ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS packages ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE IF EXISTS skill_packages ADD COLUMN IF NOT EXISTS description        TEXT;
ALTER TABLE IF EXISTS skill_packages ADD COLUMN IF NOT EXISTS target_role        TEXT;
ALTER TABLE IF EXISTS skill_packages ADD COLUMN IF NOT EXISTS estimated_duration TEXT;
ALTER TABLE IF EXISTS skill_packages ADD COLUMN IF NOT EXISTS difficulty         TEXT;
ALTER TABLE IF EXISTS skill_packages ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS skill_packages ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS track_type       TEXT;
ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS package_id       TEXT;
ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS skill_package_id TEXT;
ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS difficulty       TEXT;
ALTER TABLE IF EXISTS learning_tracks ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE IF EXISTS learning_tracks ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- ----------------------------------------------------------------------------
-- E. Permissions and cache refresh
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'question_bank_archives','reminders','platform_settings','access_codes',
    'generated_content','generated_modules','assessment_thresholds','sessions'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
  END IF;
END $$;

-- Make the Supabase REST layer pick up the new columns/tables right away.
NOTIFY pgrst, 'reload schema';
