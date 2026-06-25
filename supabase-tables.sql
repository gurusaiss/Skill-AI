-- ============================================================
-- SkillForge AI — Supabase Tables Setup
-- Run this in Supabase → SQL Editor → New Query → Run
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING
-- ============================================================

-- ── 1. Assessments ──────────────────────────────────────────
-- Stores per-employee assessment configs with unique AI-generated questions
CREATE TABLE IF NOT EXISTS assessments (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Assessment Submissions ────────────────────────────────
-- Employee answers for a given assessment
CREATE TABLE IF NOT EXISTS assessment_submissions (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Assessment Reports ────────────────────────────────────
-- Auto-scored reports after employee submits
CREATE TABLE IF NOT EXISTS assessment_reports (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Pending Modules ───────────────────────────────────────
-- Auto-generated training modules awaiting admin/manager approval
CREATE TABLE IF NOT EXISTS pending_modules (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4b. Modules ─────────────────────────────────────────────
-- All approved/active learning modules (admin + AI-generated)
CREATE TABLE IF NOT EXISTS modules (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT DEFAULT '',
  category            TEXT DEFAULT 'General',
  difficulty          TEXT DEFAULT 'beginner',
  estimated_duration  INTEGER DEFAULT 30,
  skills              JSONB DEFAULT '[]'::jsonb,
  tasks               JSONB DEFAULT '[]'::jsonb,
  resources           JSONB DEFAULT '[]'::jsonb,
  completion_criteria TEXT DEFAULT 'Complete all tasks',
  content             JSONB DEFAULT '{}'::jsonb,
  created_by          TEXT,
  company_id          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Module Assignments ────────────────────────────────────
-- Maps approved modules to specific employees
CREATE TABLE IF NOT EXISTS module_assignments (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Companies ─────────────────────────────────────────────
-- Superadmin-managed company accounts
CREATE TABLE IF NOT EXISTS companies (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Organizations ─────────────────────────────────────────
-- Admin-managed org hierarchy (org → department → team)
CREATE TABLE IF NOT EXISTS organizations (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. Departments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. Teams ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. Assignment Requests ──────────────────────────────────
-- Manager -> Admin approval workflow
CREATE TABLE IF NOT EXISTS assignment_requests (
  id           TEXT PRIMARY KEY,
  manager_id   TEXT,
  employee_id  TEXT,
  group_id     TEXT,
  module_id    TEXT,
  priority     TEXT DEFAULT 'medium',
  due_date     TIMESTAMPTZ,
  status       TEXT DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  decided_by   TEXT,
  decided_at   TIMESTAMPTZ
);

-- ── 11. Notifications ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL,
  title        TEXT,
  message      TEXT,
  type         TEXT DEFAULT 'info',
  action_url   TEXT,
  read         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. Approval Requests (JSONB pattern) ────────────────────
CREATE TABLE IF NOT EXISTS approval_requests (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 13. Groups (JSONB pattern) ───────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 14a. User Accesses column (multi-access system) ─────────
-- Adds accesses TEXT[] to users table for multi-role support (safe to re-run)
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS accesses TEXT[] DEFAULT '{}';

-- ── 14. Group Memberships ────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_memberships (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role_in_group TEXT DEFAULT 'member',
  joined_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 15. Audit Logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id       TEXT PRIMARY KEY,
  event_type   TEXT,
  user_id      TEXT,
  metadata     JSONB DEFAULT '{}'::jsonb,
  timestamp    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Disable Row Level Security on all tables so the service_role
-- key can read/write without JWT issues.
-- ============================================================
ALTER TABLE assessments            DISABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_reports     DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_modules        DISABLE ROW LEVEL SECURITY;
ALTER TABLE modules                DISABLE ROW LEVEL SECURITY;
ALTER TABLE module_assignments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies              DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations          DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments            DISABLE ROW LEVEL SECURITY;
ALTER TABLE teams                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_requests    DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          DISABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests      DISABLE ROW LEVEL SECURITY;
ALTER TABLE groups                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships      DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Also ensure the users table has all required columns
-- (safe to run again — ALTER TABLE ADD COLUMN IF NOT EXISTS)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id         TEXT    DEFAULT 'default';
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp                TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS learning_uuid      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_description    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified     BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash      TEXT;

-- Disable RLS on users too
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- DONE. You should now see these tables in Table Editor:
-- assessments, assessment_submissions, assessment_reports,
-- pending_modules, modules, module_assignments, companies,
-- organizations, departments, teams,
-- assignment_requests, notifications,
-- approval_requests, groups, group_memberships, audit_logs
-- ============================================================
