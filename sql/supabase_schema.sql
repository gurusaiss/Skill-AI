-- ============================================================
-- SkillForge AI — Canonical Supabase Schema
-- Covers all 10 tables, correct constraints, GRANTs only
-- Run in: https://supabase.com/dashboard/project/btyyyayavdvvgdelvrhx/sql/new
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT,
  name           TEXT,
  role           TEXT NOT NULL DEFAULT 'employee',
  learning_uuid  TEXT UNIQUE,
  email_verified BOOLEAN DEFAULT false,
  manager_id     TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  google_id      TEXT UNIQUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  last_login     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_manager_id    ON users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_learning_uuid ON users(learning_uuid);

-- ── 2. sessions ────────────────────────────────────────────────
-- id = UUID PK (matches the 36-char session JSON filename)
-- learning_uuid = FK target users.learning_uuid — nullable so that orphaned
-- session rows survive the initial migration from file-based JSON files
-- whose UUID filenames pre-date the users table.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  learning_uuid TEXT,
  session_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_learning_uuid ON sessions(learning_uuid);
COMMENT ON COLUMN sessions.learning_uuid IS 'FK to users.learning_uuid; nullable — orphans survive initial migration';

-- ── 3. assignments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL DEFAULT 'module',
  assignable_id     TEXT NOT NULL,
  assignable_type   TEXT,
  assigned_by       TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_to_user  TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  assigned_to_group TEXT,
  assigned_by_manager TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  priority          TEXT,
  due_date          TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'assigned',
  progress          INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignments_assignee   ON assignments(assigned_to_user);
CREATE INDEX IF NOT EXISTS idx_assignments_assigner   ON assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_assignments_group      ON assignments(assigned_to_group);
CREATE INDEX IF NOT EXISTS idx_assignments_status     ON assignments(status);

-- ── 4. modules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  difficulty          TEXT,
  estimated_duration  INTEGER,
  skills              TEXT[],
  tasks               JSONB,
  resources           JSONB,
  completion_criteria JSONB,
  created_by          TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_modules_category   ON modules(category);
CREATE INDEX IF NOT EXISTS idx_modules_difficulty ON modules(difficulty);

-- ── 5. packages ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  modules     JSONB DEFAULT '[]'::jsonb,
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packages_created_by ON packages(created_by);

-- ── 6. skill_packages ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_packages (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT,
  skills      TEXT[] DEFAULT '{}',
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_packages_domain     ON skill_packages(domain);
CREATE INDEX IF NOT EXISTS idx_skill_packages_created_by ON skill_packages(created_by);

-- ── 7. learning_tracks ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_tracks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  goal        TEXT,
  stages      JSONB,
  total_days  INTEGER,
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_learning_tracks_created_by ON learning_tracks(created_by);

-- ── 8. assessments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assessments (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  questions   JSONB DEFAULT '[]'::jsonb,
  schedule    JSONB,
  target_users TEXT[] DEFAULT '{}',
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assessments_is_active  ON assessments(is_active);
CREATE INDEX IF NOT EXISTS idx_assessments_created_by ON assessments(created_by);

-- ── 9. audit_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id     TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  metadata   JSONB DEFAULT '{}'::jsonb,
  timestamp  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);

-- ── 10. groups ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  organization TEXT,
  created_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

-- ============================================================
-- FK: reconcile sessions.learning_uuid → users.learning_uuid after users are present
-- (Left as a plain TEXT column so orphaned session rows survive migration; index keeps lookups fast)
-- ============================================================

-- ============================================================
-- GRANTS — backend always connects with service-role key
-- ============================================================
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================
-- Realtime publication
-- ============================================================
CREATE PUBLICATION sf_realtime_publication FOR TABLE
  users, sessions, assignments, modules, packages,
  skill_packages, learning_tracks, assessments, audit_logs, groups;

-- ============================================================
-- Auto-update triggers
-- ============================================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Explicit per-table triggers (fully Postgres-clean; no loop variable needed)
DROP TRIGGER IF EXISTS trg_users_updated_at          ON users;
CREATE TRIGGER  trg_users_updated_at          BEFORE UPDATE ON users          FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_sessions_updated_at        ON sessions;
CREATE TRIGGER  trg_sessions_updated_at        BEFORE UPDATE ON sessions        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_assignments_updated_at     ON assignments;
CREATE TRIGGER  trg_assignments_updated_at     BEFORE UPDATE ON assignments     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_modules_updated_at         ON modules;
CREATE TRIGGER  trg_modules_updated_at         BEFORE UPDATE ON modules         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_assessments_updated_at     ON assessments;
CREATE TRIGGER  trg_assessments_updated_at     BEFORE UPDATE ON assessments     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_assignment_requests_updated_at ON assignment_requests;
CREATE TRIGGER  trg_assignment_requests_updated_at BEFORE UPDATE ON assignment_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_employee_progress_updated_at ON employee_progress;
CREATE TRIGGER  trg_employee_progress_updated_at BEFORE UPDATE ON employee_progress FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 11. assignment_requests (Manager → Admin approval queue)
CREATE TABLE IF NOT EXISTS assignment_requests (
  id               TEXT PRIMARY KEY,
  manager_id       TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  employee_id      TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  module_id        TEXT REFERENCES modules(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  requested_at     TIMESTAMPTZ DEFAULT NOW(),
  decided_at       TIMESTAMPTZ,
  decided_by       TEXT REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_requests_status ON assignment_requests(status);
CREATE INDEX IF NOT EXISTS idx_assignment_requests_manager ON assignment_requests(manager_id);

-- ── 12. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  type        TEXT,
  title       TEXT,
  message     TEXT,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- ── 13. employee_progress
CREATE TABLE IF NOT EXISTS employee_progress (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  module_id     TEXT REFERENCES modules(id) ON DELETE CASCADE,
  progress      INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'in_progress',
  last_updated  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_progress_employee ON employee_progress(employee_id);

-- ── 14. reports (Manager/Admin aggregated views)
CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  generated_by  TEXT REFERENCES users(user_id),
  report_type   TEXT,
  period        TEXT,
  data          JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Seed admin user  (onConflict = do nothing)
-- ============================================================
INSERT INTO users (user_id, email, name, role, learning_uuid, email_verified, created_at, updated_at)
VALUES ('usr_admin_001', 'admin@skillforge.ai', 'System Admin', 'admin', uuid_generate_v4()::TEXT, true, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- Schema complete ✅   Next:  node server/db/migrate_to_supabase.js
-- ============================================================
