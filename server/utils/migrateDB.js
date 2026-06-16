/**
 * migrateDB.js — Auto-migrate Supabase tables at startup
 *
 * Checks which JSONB tables exist and tries to create any that are missing.
 * Uses the Supabase service-role key which can execute DDL via pg_catalog.
 *
 * Safe to run on every startup — all CREATE TABLE statements use IF NOT EXISTS.
 */

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const TABLES = [
  {
    name: 'assessments',
    sql: `CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE assessments DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'assessment_submissions',
    sql: `CREATE TABLE IF NOT EXISTS assessment_submissions (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE assessment_submissions DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'assessment_reports',
    sql: `CREATE TABLE IF NOT EXISTS assessment_reports (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE assessment_reports DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'pending_modules',
    sql: `CREATE TABLE IF NOT EXISTS pending_modules (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE pending_modules DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'modules',
    sql: `CREATE TABLE IF NOT EXISTS modules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'General',
      difficulty TEXT DEFAULT 'beginner',
      estimated_duration INTEGER DEFAULT 30,
      skills JSONB DEFAULT '[]'::jsonb,
      tasks JSONB DEFAULT '[]'::jsonb,
      resources JSONB DEFAULT '[]'::jsonb,
      completion_criteria TEXT DEFAULT 'Complete all tasks',
      content JSONB DEFAULT '{}'::jsonb,
      created_by TEXT,
      company_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE modules DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'module_assignments',
    sql: `CREATE TABLE IF NOT EXISTS module_assignments (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE module_assignments DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'companies',
    sql: `CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE companies DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'organizations',
    sql: `CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'departments',
    sql: `CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE departments DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'teams',
    sql: `CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE teams DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'assignment_requests',
    sql: `CREATE TABLE IF NOT EXISTS assignment_requests (
      id TEXT PRIMARY KEY,
      manager_id TEXT,
      employee_id TEXT,
      group_id TEXT,
      module_id TEXT,
      priority TEXT DEFAULT 'medium',
      due_date TIMESTAMPTZ,
      status TEXT DEFAULT 'pending',
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      decided_by TEXT,
      decided_at TIMESTAMPTZ
    );
    ALTER TABLE assignment_requests DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'notifications',
    sql: `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL,
      title TEXT,
      message TEXT,
      type TEXT DEFAULT 'info',
      action_url TEXT,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'approval_requests',
    sql: `CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE approval_requests DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'groups',
    sql: `CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE groups DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'user_jd_profiles',
    sql: `CREATE TABLE IF NOT EXISTS user_jd_profiles (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE user_jd_profiles DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'group_memberships',
    sql: `CREATE TABLE IF NOT EXISTS group_memberships (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_in_group TEXT DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE group_memberships DISABLE ROW LEVEL SECURITY;`,
  },
  {
    name: 'audit_logs',
    sql: `CREATE TABLE IF NOT EXISTS audit_logs (
      log_id TEXT PRIMARY KEY,
      event_type TEXT,
      user_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;`,
  },
];

const USER_COLS_SQL = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role              TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS department            TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete   BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id            TEXT    DEFAULT 'default';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name          TEXT    DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id           TEXT    DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone                 TEXT    DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS status                TEXT    DEFAULT 'active';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS otp                   TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expiry            TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login            TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS learning_uuid         TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS job_description       TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS job_description_file  JSONB;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_skills             JSONB   DEFAULT '[]'::jsonb;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_source_url         TEXT    DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS jd_source_type        TEXT    DEFAULT 'text';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified        BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash         TEXT;
  ALTER TABLE users DISABLE ROW LEVEL SECURITY;
`;

/**
 * Try to create a table using Supabase's query API.
 * Supabase REST API doesn't support raw DDL, but we can probe with a SELECT
 * and tell the user to run the SQL manually if needed.
 */
async function checkTable(sb, tableName) {
  try {
    // select('*').limit(0) returns 0 rows but fails only if the table doesn't exist —
    // avoids false-negatives for tables whose PK is not named 'id' (e.g. audit_logs)
    const { error } = await sb.from(tableName).select('*').limit(0);
    if (!error) return true;
    if (error.code === '42P01') return false; // table does not exist
    console.warn(`[migrate] ${tableName}: ${error.message}`);
    return false;
  } catch (e) {
    return false;
  }
}

export async function migrateDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASESERVICE_ROLE_KEY
           || process.env.SUPABASE_SECRET_KEY
           || process.env.SUPABASE_KEY;

  if (!url || !key) {
    console.log('[migrate] No Supabase credentials — skipping migration check');
    return;
  }

  const sb = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const missing = [];
  for (const t of TABLES) {
    const exists = await checkTable(sb, t.name);
    if (!exists) missing.push(t.name);
  }

  if (missing.length === 0) {
    console.log('[migrate] ✅ All Supabase tables exist');
    return;
  }

  console.warn('\n╔══════════════════════════════════════════════════════════╗');
  console.warn('║  ⚠️  SUPABASE TABLES MISSING — DATA WILL NOT PERSIST!   ║');
  console.warn('╠══════════════════════════════════════════════════════════╣');
  console.warn(`║  Missing tables: ${missing.join(', ').padEnd(41)}║`);
  console.warn('╠══════════════════════════════════════════════════════════╣');
  console.warn('║  TO FIX: Go to Supabase → SQL Editor → New Query        ║');
  console.warn('║  and run the full contents of:  supabase-tables.sql     ║');
  console.warn('╚══════════════════════════════════════════════════════════╝\n');

  // Try to create tables via Supabase RPC if available
  // Note: Supabase REST API does not support raw DDL directly.
  // The service_role key CAN run DDL via the pg REST endpoint if exposed.
  // We attempt it but don't fail if it doesn't work.
  try {
    const fullSQL = TABLES.filter(t => missing.includes(t.name)).map(t => t.sql).join('\n') + '\n' + USER_COLS_SQL;
    // Supabase exposes a /rest/v1/rpc endpoint — try exec_sql (only works if the function exists)
    const rpcRes = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ sql: fullSQL }),
    });
    if (rpcRes.ok) {
      console.log('[migrate] ✅ Tables created via RPC — re-checking...');
      // Verify
      const stillMissing = [];
      for (const t of TABLES.filter(t => missing.includes(t.name))) {
        const exists = await checkTable(sb, t.name);
        if (!exists) stillMissing.push(t.name);
      }
      if (stillMissing.length === 0) {
        console.log('[migrate] ✅ All tables now exist');
      } else {
        console.warn('[migrate] Still missing after RPC:', stillMissing.join(', '));
      }
    }
  } catch (e) {
    // RPC not available — that's fine, we already warned the user
  }
}

export default migrateDB;
