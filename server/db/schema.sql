-- ============================================================
-- SkillForge AI - PostgreSQL Schema (Supabase-compatible)
-- Production-ready with indexes, RLS policies, referential integrity
-- ============================================================

-- ── EXTENSIONS ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUM TYPES ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assignment_type AS ENUM ('package', 'skill_package', 'learning_track', 'module');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE progress_status AS ENUM ('not_started', 'in_progress', 'completed', 'locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_type_enum AS ENUM ('concept', 'practice', 'review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE activity_action AS ENUM ('login', 'logout', 'create', 'update', 'delete', 'assign', 'complete', 'submit', 'download', 'upload', 'view');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── USERS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'employee',
  learning_uuid UUID NOT NULL DEFAULT uuid_generate_v4(),
  avatar_url TEXT,
  bio TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT,
  provider TEXT DEFAULT 'email',
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public_users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public_users(role);
CREATE INDEX IF NOT EXISTS idx_users_learning_uuid ON public_users(learning_uuid);
CREATE INDEX IF NOT EXISTS idx_users_active ON public_users(is_active) WHERE is_active = TRUE;

-- ── GROUPS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  organization TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups(created_by);

-- ── GROUP MEMBERSHIPS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  role_in_group TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_grp_mem_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_grp_mem_user ON group_memberships(user_id);

-- ── MANAGERS (manager-employee relationships) ──────────────────────
CREATE TABLE IF NOT EXISTS managers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  manager_id UUID NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(manager_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_mgr_manager ON managers(manager_id);
CREATE INDEX IF NOT EXISTS idx_mgr_employee ON managers(employee_id);

-- ── MODULES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS modules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  difficulty TEXT DEFAULT 'beginner',
  estimated_duration TEXT DEFAULT '7 days',
  skills JSONB DEFAULT '[]',
  tasks JSONB DEFAULT '[]',
  resources JSONB DEFAULT '[]',
  completion_criteria TEXT DEFAULT 'Complete all tasks',
  progress_tracking BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  is_published BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_category ON modules(category);
CREATE INDEX IF NOT EXISTS idx_mod_difficulty ON modules(difficulty);
CREATE INDEX IF NOT EXISTS idx_mod_published ON modules(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_mod_search ON modules USING gin(to_tsvector('english', title || ' ' || COALESCE(description,'')));

-- ── PACKAGES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'custom',
  category TEXT,
  difficulty TEXT DEFAULT 'beginner',
  estimated_duration TEXT DEFAULT '30 days',
  modules JSONB DEFAULT '[]',
  skills_covered JSONB DEFAULT '[]',
  prerequisites JSONB DEFAULT '[]',
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  is_published BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pkg_type ON packages(type);
CREATE INDEX IF NOT EXISTS idx_pkg_category ON packages(category);
CREATE INDEX IF NOT EXISTS idx_pkg_published ON packages(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_pkg_search ON packages USING gin(to_tsvector('english', name || ' ' || COALESCE(description,'')));
CREATE INDEX IF NOT EXISTS idx_pkg_difficulty ON packages(difficulty);

-- ── SKILL PACKAGES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  domain TEXT,
  target_role TEXT,
  skills JSONB DEFAULT '[]',
  estimated_duration TEXT DEFAULT '14 days',
  difficulty TEXT DEFAULT 'intermediate',
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  is_published BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_skp_domain ON skill_packages(domain);
CREATE INDEX IF NOT EXISTS idx_skp_target ON skill_packages(target_role);
CREATE INDEX IF NOT EXISTS idx_skp_published ON skill_packages(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_skp_search ON skill_packages USING gin(to_tsvector('english', name || ' ' || COALESCE(description,'')));

-- ── LEARNING TRACKS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_tracks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  goal TEXT,
  track_type TEXT DEFAULT 'guided',
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  skill_package_id UUID REFERENCES skill_packages(id) ON DELETE SET NULL,
  stages JSONB DEFAULT '[]',
  total_days INTEGER DEFAULT 21,
  difficulty TEXT DEFAULT 'beginner',
  created_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  is_published BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ltr_type ON learning_tracks(track_type);
CREATE INDEX IF NOT EXISTS idx_ltr_package ON learning_tracks(package_id);
CREATE INDEX IF NOT EXISTS idx_ltr_skill_pkg ON learning_tracks(skill_package_id);
CREATE INDEX IF NOT EXISTS idx_ltr_published ON learning_tracks(is_published) WHERE is_published = TRUE;

-- ── ASSIGNMENTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type assignment_type NOT NULL DEFAULT 'package',
  assignable_id UUID,
  assignable_type TEXT NOT NULL,
  assigned_by UUID REFERENCES public_users(id) ON DELETE SET NULL,
  assigned_to_user UUID REFERENCES public_users(id) ON DELETE CASCADE,
  assigned_to_group UUID REFERENCES groups(id) ON DELETE CASCADE,
  assigned_by_manager UUID REFERENCES public_users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'assigned',
  progress INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asgn_user ON assignments(assigned_to_user);
CREATE INDEX IF NOT EXISTS idx_asgn_group ON assignments(assigned_to_group);
CREATE INDEX IF NOT EXISTS idx_asgn_assignable ON assignments(assignable_type, assignable_id);
CREATE INDEX IF NOT EXISTS idx_asgn_status ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_asgn_priority ON assignments(priority);

-- ── PROGRESS TRACKING ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public_users(id) ON DELETE CASCADE,
  module_id UUID REFERENCES modules(id) ON DELETE SET NULL,
  package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
  skill_package_id UUID REFERENCES skill_packages(id) ON DELETE SET NULL,
  learning_track_id UUID REFERENCES learning_tracks(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL,
  status progress_status NOT NULL DEFAULT 'not_started',
  progress_percentage INTEGER DEFAULT 0,
  current_stage INTEGER DEFAULT 0,
  total_stages INTEGER DEFAULT 0,
  score NUMERIC(5,2) DEFAULT 0,
  started_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, COALESCE(module_id,'00000000-0000-0000-0000-000000000000'), COALESCE(package_id,'00000000-0000-0000-0000-000000000000'))
);

CREATE INDEX IF NOT EXISTS idx_prog_user ON progress_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_prog_module ON progress_tracking(module_id);
CREATE INDEX IF NOT EXISTS idx_prog_package ON progress_tracking(package_id);
CREATE INDEX IF NOT EXISTS idx_prog_status ON progress_tracking(status);

-- ── SESSIONS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  learning_uuid UUID NOT NULL,
  day INTEGER NOT NULL,
  skill_name TEXT,
  skill_id TEXT,
  skill_uuid UUID,
  topic TEXT,
  session_type session_type_enum DEFAULT 'practice',
  challenge JSONB DEFAULT '{}',
  score INTEGER,
  grade TEXT,
  strengths TEXT[],
  weaknesses TEXT[],
  user_response TEXT,
  evaluation JSONB DEFAULT '{}',
  next_day INTEGER,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  confidence_before INTEGER,
  confidence_after INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sess_user ON session_data(user_id);
CREATE INDEX IF NOT EXISTS idx_sess_uuid ON session_data(learning_uuid);
CREATE INDEX IF NOT EXISTS idx_sess_day ON session_data(day);
CREATE INDEX IF NOT EXISTS idx_sess_user_day ON session_data(user_id, day);
CREATE INDEX IF NOT EXISTS idx_sess_completed ON session_data(completed);

-- ── ACTIVITY LOGS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public_users(id) ON DELETE SET NULL,
  action activity_action NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_act_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_act_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_act_created ON activity_logs(created_at DESC);

-- ── UPLOADS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public_users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  url TEXT,
  bucket TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upld_user ON uploads(user_id);

-- ── ANALYTICS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  session_id TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anal_user ON analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_anal_event ON analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_anal_ts ON analytics(timestamp DESC);

-- ── LIVE DEMO SESSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_demo_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token TEXT UNIQUE NOT NULL,
  goal TEXT NOT NULL,
  goal_key TEXT,
  status TEXT DEFAULT 'active',
  agent_states JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_token ON live_demo_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_demo_expires ON live_demo_sessions(expires_at);

-- ── AGENT RUNS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES session_data(id) ON DELETE CASCADE,
  demo_session_id UUID REFERENCES live_demo_sessions(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  reasoning TEXT,
  decisions JSONB DEFAULT '[]',
  duration_ms INTEGER,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arun_session ON agent_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_arun_demo ON agent_runs(demo_session_id);

-- ── DIAGNOSTIC RESULTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diagnostic_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public_users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES session_data(id) ON DELETE SET NULL,
  answers JSONB DEFAULT '[]',
  scores JSONB DEFAULT '{}',
  skill_scores JSONB DEFAULT '{}',
  overall_score INTEGER,
  grade TEXT,
  weak_areas TEXT[],
  recommendations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diag_user ON diagnostic_results(user_id);
CREATE INDEX IF NOT EXISTS idx_diag_session ON diagnostic_results(session_id);

-- ── UPDATED AT TRIGGER ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language plpgsql;

DO $$ 
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'pg_%' AND table_name NOT LIKE 'sql_%' AND table_name != 'schema_migrations' AND table_name != 'realtime' LOOP
    BEGIN
      EXECUTE format('CREATE TRIGGER tr_%s_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', r.table_name, r.table_name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────

-- public_users
ALTER TABLE public_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View all users" ON public_users FOR SELECT USING (TRUE);
CREATE POLICY "Update own user" ON public_users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Insert own user" ON public_users FOR INSERT WITH CHECK (auth.uid() = id OR auth.uid() IS NULL);

-- groups
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View groups" ON groups FOR SELECT USING (TRUE);
CREATE POLICY "Manage groups" ON groups FOR ALL USING (
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role IN ('admin','manager'))
);

-- group_memberships
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own memberships" ON group_memberships FOR SELECT USING (
  auth.uid() = user_id OR 
  EXISTS (SELECT 1 FROM group_memberships WHERE group_id = group_memberships.group_id AND user_id = auth.uid())
);

-- modules
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View published modules" ON modules FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Admin modules" ON modules FOR ALL USING (
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'admin')
);

-- packages
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View published packages" ON packages FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Admin packages" ON packages FOR ALL USING (
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'admin')
);

-- skill_packages
ALTER TABLE skill_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View published skill packages" ON skill_packages FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Admin skill packages" ON skill_packages FOR ALL USING (
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'admin')
);

-- learning_tracks
ALTER TABLE learning_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View published tracks" ON learning_tracks FOR SELECT USING (is_published = TRUE);
CREATE POLICY "Admin learning tracks" ON learning_tracks FOR ALL USING (
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role = 'admin')
);

-- assignments
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own assignments" ON assignments FOR SELECT USING (
  assigned_to_user = auth.uid() OR assigned_by = auth.uid() OR
  assigned_to_group IN (SELECT group_id FROM group_memberships WHERE user_id = auth.uid())
);
CREATE POLICY "Create assignments" ON assignments FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Update assignments" ON assignments FOR UPDATE USING (
  assigned_to_user = auth.uid() OR assigned_by = auth.uid() OR
  EXISTS (SELECT 1 FROM public_users WHERE id = auth.uid() AND role IN ('admin','manager'))
);

-- progress_tracking
ALTER TABLE progress_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own progress" ON progress_tracking FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Create/update progress" ON progress_tracking FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Update progress" ON progress_tracking FOR UPDATE USING (user_id = auth.uid());

-- session_data
ALTER TABLE session_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own sessions" ON session_data FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Create sessions" ON session_data FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Update own sessions" ON session_data FOR UPDATE USING (user_id = auth.uid());

-- activity_logs
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own logs" ON activity_logs FOR SELECT USING (user_id = auth.uid() OR user_id IS NULL);

-- uploads
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own uploads" ON uploads FOR ALL USING (user_id = auth.uid());

-- analytics
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own analytics" ON analytics FOR ALL USING (user_id = auth.uid());

-- live_demo_sessions - open access for demo
ALTER TABLE live_demo_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Demo access" ON live_demo_sessions FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- agent_runs
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View demo runs" ON agent_runs FOR SELECT USING (demo_session_id IS NOT NULL);
CREATE POLICY "Session runs" ON agent_runs FOR SELECT USING (
  session_id IN (SELECT id FROM session_data WHERE user_id = auth.uid())
);
CREATE POLICY "Create runs" ON agent_runs FOR INSERT WITH CHECK (TRUE);

-- diagnostic_results
ALTER TABLE diagnostic_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own diagnostics" ON diagnostic_results FOR ALL USING (user_id = auth.uid());