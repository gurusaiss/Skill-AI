-- ============================================================
-- SkillForge AI — MySQL Ground-Truth Schema (Aiven free MySQL)
--
-- This is the new single source of truth for the MySQL migration.
-- It supersedes sql/supabase-tables.sql, sql/supabase_schema.sql,
-- sql/supabase_enterprise_schema.sql, sql/assessment_engine_v2.sql,
-- sql/assessment_lock_unlock_v1.sql, sql/migration_add_company_indexes.sql,
-- and sql/supabase_migration_content_column.sql, which had drifted apart
-- and disagreed with each other on some of these same table names
-- (e.g. `assessments` was flat-column in one file, JSONB-blob in another).
-- Those files are kept for historical/audit reference only — do not run
-- them again. This file's shape was derived from TWO sources, not from
-- any prior .sql file: (1) a live read-only sample of every table's
-- actual columns in production Supabase, and (2) an exhaustive grep of
-- every column name actually read/written in server/services/DataStore.js,
-- server/services/UserStore.js, and server/db/store.js — the real
-- contract is what the app code does, not what any schema file claims.
--
-- Run this against a fresh Aiven MySQL instance (or a local MySQL 8 for
-- dev/testing) via: mysql -h <host> -u <user> -p <database> < mysql_schema.sql
-- Safe to re-run: every statement uses CREATE TABLE IF NOT EXISTS.
--
-- Engine/charset: InnoDB (FK + transaction support) + utf8mb4 throughout
-- (user-entered text can contain any Unicode, including emoji). String ID
-- columns are VARCHAR(191), not VARCHAR(255), to stay under the index-key
-- byte limit on older InnoDB configs once multiplied by utf8mb4's 4
-- bytes/char (191 * 4 = 764 bytes, safely under the 767-byte limit).
--
-- Type-mapping decisions applied uniformly (see the MySQL migration plan):
--   Postgres JSONB          -> MySQL JSON            (app never queries
--                               inside JSONB server-side — confirmed no
--                               ->, ->>, @>, ? operators anywhere in code
--                               — so this is a drop-in swap)
--   Postgres TEXT[]          -> MySQL JSON (array)    (app already treats
--                               these as plain JS arrays after fetch; no
--                               array-containment queries exist)
--   gen_random_uuid() default -> dropped               (app already
--                               generates IDs client-side via
--                               crypto.randomUUID()/uuid — no DB-side
--                               default needed)
--   TIMESTAMPTZ DEFAULT NOW() -> TIMESTAMP DEFAULT CURRENT_TIMESTAMP
--                               (requires the mysql2 pool connection to be
--                               pinned to timezone: 'Z' — see server/db/mysql.js)
--   touch_updated_at() trigger -> dropped; each store file sets
--                               updated_at explicitly in its one shared
--                               write helper instead of 30 DB triggers
--   Row Level Security       -> not ported (confirmed never enforced —
--                               Supabase RLS was either disabled or
--                               declared with zero policies; all
--                               authorization already happens in Node)
-- ============================================================


-- ============================================================
-- TIER C — Real, already-normalized flat-column tables
-- (ported near-verbatim; these never used the JSONB-blob pattern)
-- ============================================================

-- ── users ───────────────────────────────────────────────────
-- The most central table — FK target for ~10 other tables, touched by
-- nearly every route via UserStore.js. Column names/mapping confirmed
-- against UserStore.js's rowToUser()/userToRow().
--
-- NOTE: users.group_id / users.group (referenced only in file-fallback
-- code, explicitly commented "No groupId column in Supabase schema") is
-- intentionally NOT included here — it never existed as a real column.
CREATE TABLE IF NOT EXISTS users (
  user_id                VARCHAR(191) PRIMARY KEY,
  -- Explicit case-insensitive collation (not just relying on the table's
  -- utf8mb4 default) so "John@x.com" and "john@x.com" collide on
  -- uq_users_email below exactly like the app-layer case-insensitive
  -- lookup in UserStore.getUserByEmail() — the stored value itself keeps
  -- whatever casing the user typed; only comparison/uniqueness ignores it.
  email                  VARCHAR(255) COLLATE utf8mb4_general_ci NOT NULL,
  password_hash          VARCHAR(255) NOT NULL,
  name                   VARCHAR(200) NOT NULL,
  role                    VARCHAR(30)  NOT NULL DEFAULT 'employee',
  learning_uuid          VARCHAR(191),
  email_verified         BOOLEAN      NOT NULL DEFAULT FALSE,
  manager_id             VARCHAR(191),
  google_id              VARCHAR(191),
  created_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  last_login             TIMESTAMP    NULL,
  job_role               VARCHAR(200),
  department             VARCHAR(200),
  job_description        LONGTEXT,
  job_description_file   JSON,
  onboarding_complete    BOOLEAN      NOT NULL DEFAULT FALSE,
  company_name           VARCHAR(200),
  company_id             VARCHAR(191) NOT NULL DEFAULT 'default',
  employee_id            VARCHAR(191),
  phone                  VARCHAR(50),
  status                 VARCHAR(30)  NOT NULL DEFAULT 'active',
  jd_skills              JSON,
  jd_source_url          VARCHAR(2000),
  jd_source_type         VARCHAR(30),
  accesses               JSON,
  additional_job_roles   JSON,
  otp                    VARCHAR(20),
  otp_expires            TIMESTAMP    NULL,
  reset_token            VARCHAR(191),
  reset_token_expires    TIMESTAMP    NULL,
  must_change_password   BOOLEAN      NOT NULL DEFAULT FALSE,
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_google_id (google_id),
  KEY idx_users_company_id (company_id),
  KEY idx_users_role (role),
  KEY idx_users_manager_id (manager_id),
  CONSTRAINT fk_users_manager FOREIGN KEY (manager_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── groups (Tier B — hybrid flat+JSON, created here not with the rest
-- of Tier B below, since assignments/group_memberships FK-reference it
-- and MySQL requires the referenced table to exist first) ───────────
-- Already broke the pure-blob pattern in Supabase (real `name` column).
-- Promoting `manager_id` too — it's read as `g.managerId` throughout the
-- manager-scoping code fixed earlier this project and deserves a real
-- index rather than living only inside the JSON blob.
CREATE TABLE IF NOT EXISTS groups (
  id           VARCHAR(191) PRIMARY KEY,
  name         VARCHAR(255),
  manager_id   VARCHAR(191),
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_groups_manager_id (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── assignments ─────────────────────────────────────────────
-- Second-highest traffic table — queried on every dashboard load.
-- assignments.title / assignments.is_mandatory are intentionally NOT
-- included — confirmed by an explicit code comment that these are
-- file-fallback-only display fields, never sent to Supabase.
CREATE TABLE IF NOT EXISTS assignments (
  id                    VARCHAR(191) PRIMARY KEY,
  type                  VARCHAR(50),
  assignable_id         VARCHAR(191),
  assignable_type       VARCHAR(50),
  assigned_by           VARCHAR(191),
  assigned_to_user      VARCHAR(191),
  assigned_to_group     VARCHAR(191),
  assigned_by_manager   VARCHAR(191),
  priority              VARCHAR(20)  NOT NULL DEFAULT 'medium',
  due_date              TIMESTAMP    NULL,
  status                VARCHAR(30)  NOT NULL DEFAULT 'assigned',
  progress              INT          NOT NULL DEFAULT 0,
  module_name           VARCHAR(255),
  session_progress      JSON,
  progress_data         JSON,
  created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_assignments_assigned_to_user (assigned_to_user),
  KEY idx_assignments_assigned_to_group (assigned_to_group),
  KEY idx_assignments_assigned_by (assigned_by),
  KEY idx_assignments_status (status),
  CONSTRAINT fk_assignments_user FOREIGN KEY (assigned_to_user) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_group FOREIGN KEY (assigned_to_group) REFERENCES groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── assignment_requests ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_requests (
  id            VARCHAR(191) PRIMARY KEY,
  manager_id    VARCHAR(191) NOT NULL,
  employee_id   VARCHAR(191),
  group_id      VARCHAR(191),
  module_id     VARCHAR(191),
  priority       VARCHAR(20) NOT NULL DEFAULT 'medium',
  due_date      TIMESTAMP   NULL,
  status        VARCHAR(30) NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  decided_by    VARCHAR(191),
  decided_at    TIMESTAMP   NULL,
  KEY idx_assignment_requests_manager (manager_id),
  KEY idx_assignment_requests_employee (employee_id),
  KEY idx_assignment_requests_status (status),
  CONSTRAINT fk_assignment_requests_manager FOREIGN KEY (manager_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_assignment_requests_employee FOREIGN KEY (employee_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── audit_logs ──────────────────────────────────────────────
-- Very high WRITE volume (every auth event, every assessment-engine state
-- change), low read volume (admin-only). Note: user_id has NO foreign key
-- to users — a log entry must survive the referenced user being deleted.
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id       VARCHAR(191) PRIMARY KEY,
  event_type   VARCHAR(100) NOT NULL,
  user_id      VARCHAR(191),
  metadata     JSON,
  timestamp    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_logs_user_id (user_id),
  KEY idx_audit_logs_event_type (event_type),
  KEY idx_audit_logs_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── question_bank_versions ──────────────────────────────────
-- The one clean, deliberately-normalized subsystem in the original
-- Postgres schema (sql/assessment_engine_v2.sql) — ported directly.
CREATE TABLE IF NOT EXISTS question_bank_versions (
  id                  VARCHAR(191) PRIMARY KEY,
  role_id             VARCHAR(191) NOT NULL,
  version             INT          NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'draft',
  questions           JSON         NOT NULL,
  question_count      INT          NOT NULL DEFAULT 0,
  generation_config   JSON,
  validation_report   JSON,
  approved_by         VARCHAR(191),
  approved_at         TIMESTAMP    NULL,
  unlocked_at         TIMESTAMP    NULL,
  unlocked_by         VARCHAR(191),
  created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_qbv_role_id (role_id),
  KEY idx_qbv_role_status (role_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── employee_assessment_assignments ──────────────────────────
-- One row per (assessment, employee); references a frozen
-- question_bank_version. UNIQUE(assessment_id, user_id) is required —
-- the app upserts on this exact composite key (onConflict: 'assessment_id,user_id').
CREATE TABLE IF NOT EXISTS employee_assessment_assignments (
  id                          VARCHAR(191) PRIMARY KEY,
  assessment_id               VARCHAR(191) NOT NULL,
  user_id                     VARCHAR(191) NOT NULL,
  question_bank_version_id    VARCHAR(191),
  question_order              JSON,
  status                      VARCHAR(30)  NOT NULL DEFAULT 'assigned',
  assigned_at                 TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  submitted_at                TIMESTAMP    NULL,
  scoring                     JSON,
  UNIQUE KEY uq_eaa_assessment_user (assessment_id, user_id),
  KEY idx_eaa_user_id (user_id),
  CONSTRAINT fk_eaa_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_eaa_qbv FOREIGN KEY (question_bank_version_id) REFERENCES question_bank_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── modules ─────────────────────────────────────────────────
-- The "real" flat-column modules table (server/db/store.js), distinct
-- from generated_modules (a JSONB-blob table, see Tier A below).
CREATE TABLE IF NOT EXISTS modules (
  id                     VARCHAR(191) PRIMARY KEY,
  title                  VARCHAR(500),
  description            LONGTEXT,
  category               VARCHAR(100),
  difficulty             VARCHAR(30),
  estimated_duration     INT,
  skills                 JSON,
  tasks                  JSON,
  resources              JSON,
  completion_criteria    TEXT,
  content                JSON,
  created_by             VARCHAR(191),
  company_id             VARCHAR(191),
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_modules_company_id (company_id),
  KEY idx_modules_category (category),
  KEY idx_modules_difficulty (difficulty),
  CONSTRAINT fk_modules_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── packages / skill_packages / learning_tracks ──────────────
-- Opaque pass-through tables (server/db/store.js spreads the caller's
-- object directly) — 0 rows in production today. `extra` carries
-- whatever fields the caller passed beyond the two known columns.
CREATE TABLE IF NOT EXISTS packages (
  id           VARCHAR(191) PRIMARY KEY,
  category     VARCHAR(100),
  created_by   VARCHAR(191),
  extra        JSON,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_packages_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS skill_packages (
  id           VARCHAR(191) PRIMARY KEY,
  created_by   VARCHAR(191),
  extra        JSON,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_tracks (
  id           VARCHAR(191) PRIMARY KEY,
  created_by   VARCHAR(191),
  extra        JSON,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── group_memberships ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_memberships (
  id             VARCHAR(191) PRIMARY KEY,
  group_id       VARCHAR(191) NOT NULL,
  user_id        VARCHAR(191) NOT NULL,
  role_in_group  VARCHAR(30)  NOT NULL DEFAULT 'member',
  joined_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_group_memberships_group_id (group_id),
  KEY idx_group_memberships_user_id (user_id),
  CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── notifications ───────────────────────────────────────────
-- 0 rows in production today, but the read path (`read`, `created_at`)
-- is a real, currently-reachable hot filter/sort.
CREATE TABLE IF NOT EXISTS notifications (
  id           VARCHAR(191) PRIMARY KEY,
  user_id      VARCHAR(191) NOT NULL,
  `read`       BOOLEAN      NOT NULL DEFAULT FALSE,
  payload      JSON,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notifications_user_id (user_id),
  KEY idx_notifications_user_read (user_id, `read`),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── sessions (server/agent/SmartAgent.js — AI conversation state) ──
-- Separate from assessment_submissions; keyed by learning_uuid, not user_id.
CREATE TABLE IF NOT EXISTS sessions (
  id              VARCHAR(191) PRIMARY KEY,
  learning_uuid   VARCHAR(191),
  session_json    JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sessions_learning_uuid (learning_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- TIER B — Flat + JSON hybrid tables
-- (real indexed columns for confirmed hot-filter fields, everything
-- else stays in `data` — promoted from pure-blob because these are
-- either filtered constantly in app code today, or are the exact
-- tables sql/migration_add_company_indexes.sql already flagged as
-- full-table-scans waiting to happen)
--
-- NOTE: `groups` is a Tier B table by design (hybrid flat+JSON) but is
-- physically created up in the Tier C block above, right after `users`
-- — `assignments` and `group_memberships` both have a foreign key to
-- it, and MySQL requires the referenced table to exist first.
-- ============================================================

-- ── role_library ────────────────────────────────────────────
-- Every method in RoleLibrary scopes by companyId — promoted despite low
-- row count today because the traffic pattern (constant company-scoped
-- reads) is what matters, not current row count.
CREATE TABLE IF NOT EXISTS role_library (
  id           VARCHAR(191) PRIMARY KEY,
  company_id   VARCHAR(191),
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_role_library_company_id (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── generated_content ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS generated_content (
  id           VARCHAR(191) PRIMARY KEY,
  company_id   VARCHAR(191),
  data         JSON NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_generated_content_company_id (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── access_codes ────────────────────────────────────────────
-- `code` matched case-insensitively today (app uppercases before
-- comparing) — MySQL's default utf8mb4 collation is already
-- case-insensitive for equality, so no extra normalization needed.
CREATE TABLE IF NOT EXISTS access_codes (
  id           VARCHAR(191) PRIMARY KEY,
  company_id   VARCHAR(191),
  code         VARCHAR(100),
  data         JSON NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_access_codes_company_id (company_id),
  KEY idx_access_codes_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── departments ─────────────────────────────────────────────
-- 0 rows in production (unused feature today) but org_id is a genuine
-- hot filter in the code that touches it.
CREATE TABLE IF NOT EXISTS departments (
  id           VARCHAR(191) PRIMARY KEY,
  org_id       VARCHAR(191),
  data         JSON NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_departments_org_id (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── teams ───────────────────────────────────────────────────
-- 0 rows in production today; dept_id and manager_id are both real
-- filters in the code that touches this table.
CREATE TABLE IF NOT EXISTS teams (
  id           VARCHAR(191) PRIMARY KEY,
  dept_id      VARCHAR(191),
  manager_id   VARCHAR(191),
  data         JSON NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_teams_dept_id (dept_id),
  KEY idx_teams_manager_id (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── platform_settings ───────────────────────────────────────
-- IMPORTANT: this table does not exist in production Supabase at all —
-- confirmed via a live PGRST205 "table not found" error. Every settings
-- save has been silently hitting the file-only fallback since it was
-- added, which means every Render restart wipes company settings
-- (Render's disk is ephemeral). Creating this table properly here fixes
-- that for MySQL; consider also creating it in Supabase now as a
-- separate, smaller fix if the cutover to MySQL is still far off.
CREATE TABLE IF NOT EXISTS platform_settings (
  company_id   VARCHAR(191) PRIMARY KEY,
  settings     JSON      NOT NULL,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- TIER A — Pure `id + data JSON` blob tables
-- (low-traffic, no confirmed hot-filter fields beyond `id` itself,
-- which is already the primary key / naturally indexed)
-- ============================================================

CREATE TABLE IF NOT EXISTS assessments (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessment_submissions (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessment_reports (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pending_modules (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS module_assignments (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS companies (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS organizations (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS approval_requests (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- id = userId (FK relationship implicit, not enforced — this table's id
-- IS a users.user_id, but adding a real FK here isn't necessary since it
-- was never enforced in Supabase either)
CREATE TABLE IF NOT EXISTS user_jd_profiles (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activation_tokens (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- id = userId, same as user_jd_profiles
CREATE TABLE IF NOT EXISTS employee_checklists (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- id = companyId or the literal string 'default' — the id itself is the
-- filter, no separate column needed.
CREATE TABLE IF NOT EXISTS assessment_thresholds (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Distinct from `modules` (Tier C) — this is the JSONB-blob-pattern
-- generated-content table, an older/parallel design for the same concept.
CREATE TABLE IF NOT EXISTS generated_modules (
  id           VARCHAR(191) PRIMARY KEY,
  data         JSON      NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- Excluded from this migration entirely
-- ============================================================
-- The following 5 tables appear in older .sql files but are referenced
-- by ZERO `.from()` calls in DataStore.js, UserStore.js, or
-- server/db/store.js, and a live check against production Supabase
-- confirms why: employee_progress, task_submissions, and reports don't
-- exist as tables at all (PGRST205 "table not found"); manager_mappings
-- and bulk_import_logs exist but hold 0 rows. Nothing reads or writes
-- them today, and there is no data to lose either way — they are not
-- created here. If a future need resurrects one of these, re-add it as
-- its own migration rather than reviving it silently.
