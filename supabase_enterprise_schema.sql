-- ============================================================
-- SkillForge AI — Enterprise Schema Extension
-- Run AFTER supabase_schema.sql
-- Adds: organizations, departments, teams, group_memberships,
--       employee_progress, task_submissions, enhanced notifications
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── organizations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  industry    TEXT,
  size        TEXT,
  description TEXT,
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── departments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS departments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  org_id       UUID REFERENCES organizations(id) ON DELETE CASCADE,
  description  TEXT,
  head_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_by   TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);

-- ── teams ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  dept_id     UUID REFERENCES departments(id) ON DELETE CASCADE,
  manager_id  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  description TEXT,
  member_ids  TEXT[] DEFAULT '{}',
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teams_dept ON teams(dept_id);
CREATE INDEX IF NOT EXISTS idx_teams_manager ON teams(manager_id);

-- ── group_memberships ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_memberships (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,
  user_id       TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  role_in_group TEXT DEFAULT 'member',
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_memberships_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_group_memberships_user ON group_memberships(user_id);

-- ── employee_progress ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_progress (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE,
  module_id     TEXT,
  progress_pct  INT DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  score         INT,
  sessions_done INT DEFAULT 0,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emp_progress_user ON employee_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_emp_progress_module ON employee_progress(module_id);

-- ── task_submissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  module_id     TEXT,
  task_name     TEXT NOT NULL,
  submission    TEXT,
  score         INT,
  feedback      TEXT,
  status        TEXT DEFAULT 'submitted',
  submitted_at  TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by   TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON task_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_module ON task_submissions(module_id);

-- ── enhanced notifications ─────────────────────────────────────
-- Add columns if notifications table exists from base schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notifications') THEN
    CREATE TABLE notifications (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      type       TEXT NOT NULL,
      title      TEXT NOT NULL,
      body       TEXT,
      action_url TEXT,
      is_read    BOOLEAN DEFAULT false,
      metadata   JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_notifications_user ON notifications(user_id);
    CREATE INDEX idx_notifications_read ON notifications(user_id, is_read);
  END IF;
END $$;

-- ── Add dept_id / team_id to users ────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS dept_id  UUID REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id  UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- ── RLS Policies ──────────────────────────────────────────────
ALTER TABLE organizations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_submissions   ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS automatically (no policy needed for backend)
-- Anon key gets no access (safe default)

-- ── Triggers: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['organizations','departments','teams','employee_progress'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      tbl
    );
  END LOOP;
END $$;

-- ── Seed: Demo organization structure ─────────────────────────
-- Safe to run multiple times (INSERT ... WHERE NOT EXISTS)
INSERT INTO organizations (id, name, industry, size, description)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Acme Corp',
  'Technology',
  '500-1000',
  'Demo organization for SkillForge AI'
WHERE NOT EXISTS (
  SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

INSERT INTO departments (id, org_id, name, description)
VALUES
  ('00000000-0000-0000-0001-000000000001'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Engineering', 'Software engineering department'),
  ('00000000-0000-0000-0001-000000000002'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Product', 'Product management department'),
  ('00000000-0000-0000-0001-000000000003'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Data & AI', 'Data science and AI department')
ON CONFLICT DO NOTHING;
