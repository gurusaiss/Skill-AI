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

-- ============================================================
-- Disable Row Level Security on all tables so the service_role
-- key can read/write without JWT issues.
-- ============================================================
ALTER TABLE assessments           DISABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_reports    DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_modules       DISABLE ROW LEVEL SECURITY;
ALTER TABLE module_assignments    DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies             DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations         DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments           DISABLE ROW LEVEL SECURITY;
ALTER TABLE teams                 DISABLE ROW LEVEL SECURITY;

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
-- pending_modules, module_assignments, companies,
-- organizations, departments, teams
-- ============================================================
