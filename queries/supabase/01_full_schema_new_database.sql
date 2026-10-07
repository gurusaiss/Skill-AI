-- ============================================================================
-- SkillForge AI - FULL DATABASE SETUP (Supabase / PostgreSQL)
-- File: queries/supabase/01_full_schema_new_database.sql
--
-- WHAT THIS DOES
--   Creates every table, column, index and trigger the app uses, in one go.
--   It is IDEMPOTENT: every statement is CREATE ... IF NOT EXISTS /
--   ADD COLUMN IF NOT EXISTS, so running it twice (or on a database that
--   already has some of these tables) changes nothing that already exists and
--   never removes or overwrites data. It contains no statements that remove
--   or empty tables or rows.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file ->
--   Run. Then run 03_verify.sql to confirm.
--
-- DESIGN NOTES (derived from server/services/DataStore.js, UserStore.js,
-- server/db/store.js, server/agent/SmartAgent.js and rec-engine/database.py)
--   * "Document" tables hold id TEXT PK + data JSONB (+ created_at/updated_at).
--     The server reads/writes everything for those tables inside `data`.
--   * "Flat" tables (users, assignments, modules, question_bank_versions,
--     employee_assessment_assignments, reminders, ...) use real columns that
--     the code names explicitly.
--   * No foreign keys point at users(user_id) on purpose: the code stores ids
--     such as 'system' or a learning UUID in created_by / assigned_by and
--     would otherwise fail inserts. (The one exception is
--     employee_assessment_assignments -> question_bank_versions, as before.)
--   * Row Level Security is DISABLED on app tables (same as the older scripts).
--     The server only uses the service-role key, which bypasses RLS anyway.
--     See the OPTIONAL block at the very end to lock tables down further.
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS + SHARED FUNCTIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- Keeps updated_at fresh on UPDATE (document upserts only touch `data`).
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 1. USERS AND AUTH
-- ============================================================================

-- 1.1 users  (server/services/UserStore.js rowToUser / userToRow)
CREATE TABLE IF NOT EXISTS users (
  user_id              TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT,
  name                 TEXT,
  role                 TEXT NOT NULL DEFAULT 'employee',
  learning_uuid        TEXT UNIQUE,
  email_verified       BOOLEAN DEFAULT FALSE,
  manager_id           TEXT,
  google_id            TEXT UNIQUE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  last_login           TIMESTAMPTZ
);
-- Columns added over time (safe on an older users table too):
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_description      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_description_file JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete  BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name         TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id           TEXT DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id          TEXT DEFAULT '';   -- Employee / Manager ID
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone                TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status               TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_skills            JSONB DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_source_url        TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_source_type       TEXT DEFAULT 'text';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accesses             TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions          JSONB DEFAULT '{"granted":[],"revoked":[]}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_job_roles JSONB DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp                  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires          TIMESTAMPTZ;       -- name the code uses
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry           TIMESTAMPTZ;       -- legacy name in older scripts
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token          TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_role                ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_manager_id          ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_learning_uuid       ON users(learning_uuid);
CREATE INDEX IF NOT EXISTS idx_users_company_id          ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company_employee_id ON users (company_id, lower(employee_id));
CREATE INDEX IF NOT EXISTS idx_users_email_lower         ON users (lower(email));

-- 1.2 user_jd_profiles  (id = user id; job-description data kept separately)
CREATE TABLE IF NOT EXISTS user_jd_profiles (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 activation_tokens  (email activation / set-password links)
CREATE TABLE IF NOT EXISTS activation_tokens (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 sessions  (AI learning-session state, server/agent/SmartAgent.js)
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  learning_uuid  TEXT,
  session_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_learning_uuid ON sessions(learning_uuid);


-- ============================================================================
-- 2. COMPANIES AND ORGANISATION
--    (companies: every extra field - domain, plan, status, logo, limits,
--     settings ... - lives inside data JSONB; there are no extra columns)
-- ============================================================================
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- access_codes: role-scoped signup codes per company
CREATE TABLE IF NOT EXISTS access_codes (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- groups: JSONB document + a real `name` column (DataStore.Groups writes both)
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS name        TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS company_id  TEXT;  -- only so sql/migration_add_company_indexes.sql works; the app keeps companyId inside data
ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_groups_company_id ON groups(company_id);

CREATE TABLE IF NOT EXISTS group_memberships (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  role_in_group  TEXT DEFAULT 'member',
  joined_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_group_memberships_user  ON group_memberships(user_id);

-- Legacy tables created by older scripts; the current code does not read them
-- but production already has them, so they are kept for parity.
CREATE TABLE IF NOT EXISTS manager_mappings (
  id          TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  manager_id  TEXT NOT NULL,
  company_id  TEXT,
  mapped_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bulk_import_logs (
  id           TEXT PRIMARY KEY,
  import_type  TEXT NOT NULL,
  imported_by  TEXT NOT NULL,
  company_id   TEXT,
  summary      JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- 3. ROLE LIBRARY AND QUESTION BANKS
-- ============================================================================
CREATE TABLE IF NOT EXISTS role_library (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Versioned, frozen question banks (draft -> approved -> archived)
CREATE TABLE IF NOT EXISTS question_bank_versions (
  id                 TEXT PRIMARY KEY,
  role_id            TEXT NOT NULL,
  version            INT  NOT NULL,
  status             TEXT NOT NULL DEFAULT 'draft',
  questions          JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_count     INT  NOT NULL DEFAULT 0,
  generation_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_report  JSONB,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  unlocked_at        TIMESTAMPTZ,
  unlocked_by        TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_by TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbv_role_version ON question_bank_versions(role_id, version);
CREATE INDEX IF NOT EXISTS idx_qbv_role_status        ON question_bank_versions(role_id, status);

-- Quarterly snapshots of a role's question bank (Role Library "New Generation")
CREATE TABLE IF NOT EXISTS question_bank_archives (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- 4. ASSESSMENTS AND ASSIGNMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assessments (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_submissions (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- One row per (assessment, employee). The app upserts with
-- onConflict 'assessment_id,user_id', so the unique index below is REQUIRED.
CREATE TABLE IF NOT EXISTS employee_assessment_assignments (
  id                        TEXT PRIMARY KEY,
  assessment_id             TEXT NOT NULL,
  user_id                   TEXT NOT NULL,
  question_bank_version_id  TEXT NOT NULL REFERENCES question_bank_versions(id),
  question_order            JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                    TEXT DEFAULT 'assigned',
  assigned_at               TIMESTAMPTZ DEFAULT NOW(),
  start_at                  TIMESTAMPTZ,      -- scheduling window opens
  due_at                    TIMESTAMPTZ,      -- deadline (drives reminders + reports)
  submitted_at              TIMESTAMPTZ,
  scoring                   JSONB
);
ALTER TABLE employee_assessment_assignments ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE employee_assessment_assignments ADD COLUMN IF NOT EXISTS due_at   TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uq_eaa_assessment_user ON employee_assessment_assignments(assessment_id, user_id);
CREATE INDEX IF NOT EXISTS idx_eaa_assessment ON employee_assessment_assignments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_eaa_user       ON employee_assessment_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_eaa_version    ON employee_assessment_assignments(question_bank_version_id);
CREATE INDEX IF NOT EXISTS idx_eaa_due_at     ON employee_assessment_assignments(due_at);


-- ============================================================================
-- 5. REPORTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS assessment_reports (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- 6. REMINDERS  (audit log + cooldown source for manual and automatic reminders)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reminders (
  id               TEXT PRIMARY KEY,
  assessment_id    TEXT NOT NULL,
  employee_id      TEXT NOT NULL,
  sender_id        TEXT,
  type             TEXT,                       -- 'manual' | 'auto_deadline'
  sent_at          TIMESTAMPTZ DEFAULT NOW(),
  delivery_status  TEXT,                       -- 'sent' | 'failed'
  error_message    TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_assignment ON reminders(assessment_id, employee_id, sent_at DESC);


-- ============================================================================
-- 7. MODULES AND LEARNING CONTENT
-- ============================================================================
CREATE TABLE IF NOT EXISTS modules (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT DEFAULT '',
  category             TEXT DEFAULT 'General',
  difficulty           TEXT DEFAULT 'beginner',
  estimated_duration   INTEGER DEFAULT 30,
  skills               JSONB DEFAULT '[]'::jsonb,
  tasks                JSONB DEFAULT '[]'::jsonb,
  resources            JSONB DEFAULT '[]'::jsonb,
  completion_criteria  TEXT DEFAULT 'Complete all tasks',
  content              JSONB DEFAULT '{}'::jsonb,
  created_by           TEXT,
  company_id           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE modules ADD COLUMN IF NOT EXISTS content            JSONB DEFAULT '{}'::jsonb;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS sessions           JSONB DEFAULT '[]'::jsonb;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS progress_tracking  BOOLEAN DEFAULT TRUE;
ALTER TABLE modules ADD COLUMN IF NOT EXISTS company_id         TEXT;
CREATE INDEX IF NOT EXISTS idx_modules_category   ON modules(category);
CREATE INDEX IF NOT EXISTS idx_modules_difficulty ON modules(difficulty);
CREATE INDEX IF NOT EXISTS idx_modules_company_id ON modules(company_id);

-- packages / skill_packages / learning_tracks: server/db/store.js inserts the
-- request body as-is and does NOT send an id, so id needs a default.
CREATE TABLE IF NOT EXISTS packages (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                TEXT NOT NULL,
  description         TEXT,
  type                TEXT,
  category            TEXT,
  difficulty          TEXT,
  estimated_duration  TEXT,
  modules             JSONB DEFAULT '[]'::jsonb,
  skills_covered      JSONB DEFAULT '[]'::jsonb,
  prerequisites       JSONB DEFAULT '[]'::jsonb,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE packages ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS type               TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS category           TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS difficulty         TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS estimated_duration TEXT;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS skills_covered     JSONB DEFAULT '[]'::jsonb;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS prerequisites      JSONB DEFAULT '[]'::jsonb;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_packages_created_by ON packages(created_by);
CREATE INDEX IF NOT EXISTS idx_packages_category   ON packages(category);

CREATE TABLE IF NOT EXISTS skill_packages (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                TEXT NOT NULL,
  description         TEXT,
  domain              TEXT,
  target_role         TEXT,
  skills              JSONB DEFAULT '[]'::jsonb,
  estimated_duration  TEXT,
  difficulty          TEXT,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE skill_packages ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE skill_packages ADD COLUMN IF NOT EXISTS description        TEXT;
ALTER TABLE skill_packages ADD COLUMN IF NOT EXISTS target_role        TEXT;
ALTER TABLE skill_packages ADD COLUMN IF NOT EXISTS estimated_duration TEXT;
ALTER TABLE skill_packages ADD COLUMN IF NOT EXISTS difficulty         TEXT;
ALTER TABLE skill_packages ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_skill_packages_domain     ON skill_packages(domain);
CREATE INDEX IF NOT EXISTS idx_skill_packages_created_by ON skill_packages(created_by);

CREATE TABLE IF NOT EXISTS learning_tracks (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name              TEXT NOT NULL,
  description       TEXT,
  goal              TEXT,
  track_type        TEXT,
  package_id        TEXT,
  skill_package_id  TEXT,
  stages            JSONB DEFAULT '[]'::jsonb,
  total_days        INTEGER,
  difficulty        TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE learning_tracks ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS track_type       TEXT;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS package_id       TEXT;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS skill_package_id TEXT;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS difficulty       TEXT;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_learning_tracks_created_by ON learning_tracks(created_by);

CREATE TABLE IF NOT EXISTS pending_modules (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS module_assignments (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_modules (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_content (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- id = user id (onboarding checklist)
CREATE TABLE IF NOT EXISTS employee_checklists (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- assignments (module/assessment assigned to a user or group)
CREATE TABLE IF NOT EXISTS assignments (
  id                   TEXT PRIMARY KEY,
  type                 TEXT NOT NULL DEFAULT 'module',
  assignable_id        TEXT NOT NULL,
  assignable_type      TEXT,
  assigned_by          TEXT,
  assigned_to_user     TEXT,
  assigned_to_group    TEXT,
  assigned_by_manager  TEXT,
  priority             TEXT DEFAULT 'medium',
  due_date             TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'assigned',
  progress             INTEGER DEFAULT 0,
  module_name          TEXT,
  session_progress     JSONB DEFAULT '{}'::jsonb,
  progress_data        JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS module_name       TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS session_progress  JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS progress_data     JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_assignments_assignee ON assignments(assigned_to_user);
CREATE INDEX IF NOT EXISTS idx_assignments_assigner ON assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_assignments_group    ON assignments(assigned_to_group);
CREATE INDEX IF NOT EXISTS idx_assignments_status   ON assignments(status);

-- manager -> admin approval queue
CREATE TABLE IF NOT EXISTS assignment_requests (
  id            TEXT PRIMARY KEY,
  manager_id    TEXT,
  employee_id   TEXT,
  group_id      TEXT,
  module_id     TEXT,
  priority      TEXT DEFAULT 'medium',
  due_date      TIMESTAMPTZ,
  status        TEXT DEFAULT 'pending',
  requested_at  TIMESTAMPTZ DEFAULT NOW(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ
);
ALTER TABLE assignment_requests ADD COLUMN IF NOT EXISTS group_id     TEXT;
ALTER TABLE assignment_requests ADD COLUMN IF NOT EXISTS priority     TEXT DEFAULT 'medium';
ALTER TABLE assignment_requests ADD COLUMN IF NOT EXISTS due_date     TIMESTAMPTZ;
ALTER TABLE assignment_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_assignment_requests_status  ON assignment_requests(status);
CREATE INDEX IF NOT EXISTS idx_assignment_requests_manager ON assignment_requests(manager_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL,
  title       TEXT,
  message     TEXT,
  type        TEXT DEFAULT 'info',
  action_url  TEXT,
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);


-- ============================================================================
-- 8. RECOMMENDATIONS  (Python service in rec-engine/; mirrors
--    rec-engine/supabase_migration.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_skill_interactions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  skill_id          TEXT NOT NULL,
  engagement_score  FLOAT NOT NULL DEFAULT 0.5 CHECK (engagement_score >= 0 AND engagement_score <= 1),
  interaction_type  TEXT NOT NULL DEFAULT 'view',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);
CREATE TABLE IF NOT EXISTS rec_metrics (
  id              BIGSERIAL PRIMARY KEY,
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  precision_at_5  FLOAT NOT NULL DEFAULT 0,
  recall_at_5     FLOAT NOT NULL DEFAULT 0,
  ndcg_at_10      FLOAT NOT NULL DEFAULT 0,
  coverage        FLOAT NOT NULL DEFAULT 0,
  total_users     INT   NOT NULL DEFAULT 0,
  total_skills    INT   NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recommendations_log (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  recommended_skills  TEXT[] NOT NULL DEFAULT '{}',
  clicked_skills      TEXT[] NOT NULL DEFAULT '{}',
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rec_exclusions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  skill_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);
CREATE TABLE IF NOT EXISTS rec_skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  domain       TEXT NOT NULL DEFAULT 'general',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rec_market_demand (
  skill_id      TEXT PRIMARY KEY,
  demand_score  FLOAT NOT NULL DEFAULT 0.5,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interactions_user  ON user_skill_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_skill ON user_skill_interactions (skill_id);
CREATE INDEX IF NOT EXISTS idx_rec_log_user       ON recommendations_log (user_id);
CREATE INDEX IF NOT EXISTS idx_exclusions_user    ON rec_exclusions (user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_date       ON rec_metrics (calculated_at DESC);


-- ============================================================================
-- 9. LOGS AND AUDIT
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id      TEXT PRIMARY KEY,
  event_type  TEXT,
  user_id     TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);


-- ============================================================================
-- 10. SETTINGS
-- ============================================================================
-- Per-company admin settings (General / Security / Notifications sections).
-- Without this table settings only live in a local file that is lost on every
-- server restart.
CREATE TABLE IF NOT EXISTS platform_settings (
  company_id  TEXT PRIMARY KEY,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Assessment pass/fail thresholds (id = company id or 'default')
CREATE TABLE IF NOT EXISTS assessment_thresholds (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================================
-- 11. STORAGE BUCKETS
--     The application code does NOT use Supabase Storage (no storage.from(),
--     no file uploads - job-description files are stored inside JSONB). So no
--     bucket is created here on purpose; 03_verify.sql lists buckets anyway.
--     If a bucket is ever needed, the pattern is:
--       INSERT INTO storage.buckets (id, name, public)
--       VALUES ('my-bucket', 'my-bucket', false) ON CONFLICT (id) DO NOTHING;
-- ============================================================================


-- ============================================================================
-- 12. UPDATED_AT TRIGGERS (only where a table has an updated_at column and no
--     such trigger exists yet - existing triggers are left untouched)
-- ============================================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_jd_profiles','activation_tokens','sessions',
    'companies','organizations','departments','teams','access_codes','groups',
    'role_library','question_bank_archives',
    'assessments','assessment_submissions','assessment_reports',
    'modules','packages','skill_packages','learning_tracks','pending_modules',
    'module_assignments','generated_modules','generated_content',
    'employee_checklists','approval_requests','assignments',
    'platform_settings','assessment_thresholds'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger
                        WHERE tgrelid = to_regclass('public.' || t)
                          AND NOT tgisinternal
                          AND tgname LIKE '%updated_at%') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
        'trg_' || t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;


-- ============================================================================
-- 13. ROW LEVEL SECURITY + PERMISSIONS
-- ============================================================================
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','user_jd_profiles','activation_tokens','sessions',
    'companies','organizations','departments','teams','access_codes','groups',
    'group_memberships','manager_mappings','bulk_import_logs',
    'role_library','question_bank_versions','question_bank_archives',
    'assessments','assessment_submissions','employee_assessment_assignments',
    'assessment_reports','reminders',
    'modules','packages','skill_packages','learning_tracks','pending_modules',
    'module_assignments','generated_modules','generated_content',
    'employee_checklists','approval_requests','assignments','assignment_requests',
    'notifications','audit_logs','platform_settings','assessment_thresholds'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
  -- Recommendation tables: RLS on, as in rec-engine/supabase_migration.sql
  -- (the service-role key bypasses RLS, so the Python service is unaffected).
  FOREACH t IN ARRAY ARRAY[
    'user_skill_interactions','rec_metrics','recommendations_log',
    'rec_exclusions','rec_skills','rec_market_demand'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- The backend connects with the service-role key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
  END IF;
END $$;

-- Make the Supabase REST layer notice the new tables/columns immediately
-- (avoids "Could not find the 'x' column ... in the schema cache" errors).
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- OPTIONAL HARDENING (NOT run by default - remove the leading "-- " to use)
-- Tables above have RLS disabled, like the original scripts. The server only
-- uses the service-role key, which ignores RLS, so you may safely turn RLS ON
-- with no policies: the public/anon key then cannot read or write anything.
-- ----------------------------------------------------------------------------
-- DO $$
-- DECLARE r RECORD;
-- BEGIN
--   FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
--     EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
--   END LOOP;
-- END $$;
-- ============================================================================
