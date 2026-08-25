/* Migration script: migrate local JSON data to Supabase
   Usage: node server/db/migrate_to_supabase.js
   Requires env vars: SUPABASE_URL, SUPABASE_KEY (service role)

   ── Prerequisite: apply the Supabase schema first ───────────────────────
   1. Open https://supabase.com/dashboard/project/btyyyayavdvvgdelvrhx/sql/new
   2. Paste the contents of  supabase_schema.sql  (project root)
   3. Click  ▶ Run   →   you should see  Schema complete ✅
   4. Then run:  node server/db/migrate_to_supabase.js
   ───────────────────────────────────────────────────────────────────────
*/
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { loadEnv } from '../config/loadEnv.js';

const __dirname = join(process.cwd(), 'server');   // project-root neutral on Windows
loadEnv(process.cwd());                            // .env at project root C:\CODING\HACKap\.env

const SUPABASE_URL = process.env.SUPABASE_URL;
// Prefer the real sb_secret_… service-role key for writes (bypasses RLS).
// Falls back to SUPABASE_KEY / SUPABASE_ANON_KEY if the secret key is absent.
const SERVICE_KEY = process.env.SUPABASESERVICE_ROLE_KEY
                || process.env.SUPABASE_SECRET_KEY
                || process.env.SUPABASE_KEY
                || '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASESERVICE_ROLE_KEY in env. Abort.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const DATA_DIR = join(join(process.cwd(), 'server', 'data'));

function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

async function tableExists(table) {
  try {
    // head:true returns 0 rows; count:'exact' gives the row count stat directly.
    // An absent table throws PGRST205 (error is non-null); an existing empty table
    // returns count=0, which is *not* null and correctly signals "table exists".
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) return false;
    return true;   // count === 0 | 1 | N  →  table is present
  } catch (e) {
    return false;
  }
}

async function upsertChunks(table, rows, chunkSize = 500) {
  const chunks = chunkArray(rows, chunkSize);
  for (const c of chunks) {
    const { data, error } = await supabase.from(table).upsert(c);
    if (error) throw error;
  }
}

async function migrateUsers() {
  const usersPath = join(DATA_DIR, 'users.json');
  try {
    const txt = await readFile(usersPath, 'utf-8');
    const parsed = JSON.parse(txt);
    const users = parsed.users || [];
    if (users.length === 0) { console.log('No users to migrate'); return; }
    const rows = users.map(u => ({
      user_id: u.userId,
      email: u.email,
      password_hash: u.passwordHash || null,
      name: u.name || null,
      role: u.role || 'employee',
      learning_uuid: u.learningUUID || null,
      email_verified: !!u.emailVerified,
      created_at: u.createdAt || new Date().toISOString(),
      updated_at: u.updatedAt || new Date().toISOString(),
      last_login: u.lastLogin || null,
      manager_id: u.managerId || null,
      google_id: u.googleId || null,
    }));
    console.log(`Migrating ${rows.length} users to supabase.users`);
    await upsertChunks('users', rows);
    console.log('Users migrated');
  } catch (e) {
    console.warn('Skipping users migration:', e.message);
  }
}

async function migrateAssignments() {
  const p = join(DATA_DIR, 'assignments.json');
  try {
    const txt = await readFile(p, 'utf-8');
    const parsed = JSON.parse(txt);
    const assignments = parsed.assignments || [];
    if (assignments.length === 0) { console.log('No assignments to migrate'); return; }
    const rows = assignments.map(a => ({
      id: a.assignmentId || a.id,
      type: a.type || 'module',
      assignable_id: a.assignable_id || a.assignableId || a.moduleId || a.module_id || a.id || `asgn_${Date.now()}`,
      assignable_type: a.type || null,
      assigned_by: a.assignedBy || a.assigned_by || null,
      assigned_to_user: a.employeeId || a.assignedToUser || a.assignedTo || null,
      assigned_to_group: a.assignedToGroup || a.assigned_to_group || null,
      assigned_by_manager: a.assignedByManager || a.assigned_by_manager || null,
      priority: a.priority || null,
      due_date: a.dueDate || a.due_date || null,
      status: a.status || 'assigned',
      progress: a.progress || 0,
      created_at: a.assignedAt || a.createdAt || new Date().toISOString(),
      updated_at: a.updatedAt || new Date().toISOString(),
    }));
    console.log(`Migrating ${rows.length} assignments to supabase.assignments`);
    await upsertChunks('assignments', rows);
    console.log('Assignments migrated');
  } catch (e) {
    console.warn('Skipping assignments migration:', e.message);
  }
}

// Strip non-digit suffix from strings like "14 days" → 14
function parseIntSafe(val) {
  if (typeof val === 'number') return val;
  const n = parseInt(String(val).replace(/\D/g, ''), 10);
  return isNaN(n) ? null : n;
}

async function migrateModulesAndPackages() {
  try {
    const mtxt = await readFile(join(DATA_DIR, 'modules.json'), 'utf-8');
    const mp = JSON.parse(mtxt).modules || [];
    if (mp.length) {
      const rows = mp.map(m => ({
        id: m.id || m.moduleId || `mod_${Date.now()}`,
        title: m.title || m.name || null,
        description: m.description || null,
        category: m.category || null,
        difficulty: m.difficulty || null,
        estimated_duration: parseIntSafe(m.estimatedDuration || m.estimated_duration),
        skills: m.skills || null,
        tasks: m.tasks || null,
        resources: m.resources || null,
        completion_criteria: m.completionCriteria || m.completion_criteria || null,
        created_by: m.createdBy || null,
        created_at: m.createdAt || new Date().toISOString(),
        updated_at: m.updatedAt || new Date().toISOString(),
      }));
      console.log(`Migrating ${rows.length} modules to supabase.modules`);
      await upsertChunks('modules', rows);
      console.log('Modules migrated');
    }
  } catch (e) { console.warn('Skipping modules migration:', e.message); }

  try {
    const ptxt = await readFile(join(DATA_DIR, 'packages.json'), 'utf-8');
    const pkgs = JSON.parse(ptxt).packages || [];
    if (pkgs.length) {
      const rows = pkgs.map(p => ({
        id: p.id || `pkg_${Date.now()}`,
        name: p.name,
        description: p.description,
        modules: p.modules || [],
        created_at: p.createdAt || new Date().toISOString(),
      }));
      console.log(`Migrating ${rows.length} packages to supabase.packages`);
      await upsertChunks('packages', rows);
      console.log('Packages migrated');
    }
  } catch (e) { console.warn('Skipping packages migration:', e.message); }

  try {
    const sptxt = await readFile(join(DATA_DIR, 'skill_packages.json'), 'utf-8');
    const sps = JSON.parse(sptxt).skillPackages || [];
    if (sps.length) {
      const rows = sps.map(s => ({
        id: s.id || `sp_${Date.now()}`,
        name: s.name,
        domain: s.domain || null,
        skills: s.skills || [],
        created_at: s.createdAt || new Date().toISOString(),
      }));
      console.log(`Migrating ${rows.length} skill_packages to supabase.skill_packages`);
      await upsertChunks('skill_packages', rows);
      console.log('Skill packages migrated');
    }
  } catch (e) { console.warn('Skipping skill_packages migration:', e.message); }

  try {
    const ttxt = await readFile(join(DATA_DIR, 'learning_tracks.json'), 'utf-8');
    const tracks = JSON.parse(ttxt).tracks || [];
    if (tracks.length) {
      const rows = tracks.map(t => ({
        id: t.id || `lt_${Date.now()}`,
        name: t.name,
        goal: t.goal || null,
        stages: t.stages || null,
        total_days: t.total_days || t.totalDays || null,
        created_at: t.createdAt || new Date().toISOString(),
      }));
      console.log(`Migrating ${rows.length} learning_tracks to supabase.learning_tracks`);
      await upsertChunks('learning_tracks', rows);
      console.log('Learning tracks migrated');
    }
  } catch (e) { console.warn('Skipping learning_tracks migration:', e.message); }
}

async function migrateAssessments() {
  try {
    const txt = await readFile(join(DATA_DIR, 'assessments.json'), 'utf-8');
    const arr = JSON.parse(txt) || [];
    const rows = arr.map(a => ({
      id: a.id || `ass_${Date.now()}`,
      title: a.title,
      description: a.description,
      questions: a.questions || [],
      schedule: a.schedule || null,
      target_users: a.targetUsers || a.target_users || [],
      created_by: a.createdBy || null,
      created_at: a.createdAt || new Date().toISOString(),
      updated_at: a.updatedAt || new Date().toISOString(),
      is_active: a.isActive !== undefined ? a.isActive : true,
    }));
    if (rows.length) {
      console.log(`Migrating ${rows.length} assessments to supabase.assessments`);
      await upsertChunks('assessments', rows);
      console.log('Assessments migrated');
    }
  } catch (e) { console.warn('Skipping assessments migration:', e.message); }
}

async function migrateAuditLogs() {
  try {
    const txt = await readFile(join(DATA_DIR, 'audit.json'), 'utf-8');
    const parsed = JSON.parse(txt) || { logs: [] };
    const rows = (parsed.logs || []).map(l => ({
      log_id: l.logId || `log_${Date.now()}`,
      event_type: l.eventType || l.event_type || null,
      user_id: l.userId || l.user_id || null,
      metadata: l.metadata || l.meta || null,
      timestamp: l.timestamp || new Date().toISOString(),
    }));
    if (rows.length) {
      console.log(`Migrating ${rows.length} audit logs to supabase.audit_logs`);
      await upsertChunks('audit_logs', rows);
      console.log('Audit logs migrated');
    }
  } catch (e) { console.warn('Skipping audit logs migration:', e.message); }
}

async function migrateSessions() {
  try {
    // Build a userId → learning_uuid lookup from users.json
    const usersJson = await readFile(join(DATA_DIR, 'users.json'), 'utf-8').catch(() => '{"users":[]}');
    const userList = (JSON.parse(usersJson).users || []);
    const luMap = {};
    for (const u of userList) {
      if (u.userId)        luMap[u.userId]        = u.learningUUID || null;
      if (u.googleId)      luMap[u.googleId]      = u.learningUUID || null;
    }

    const files = await readdir(DATA_DIR);
    const sessionFiles = files.filter(f => /^[0-9a-fA-F\-]{36}\.json$/.test(f));
    const rows = [];
    for (const f of sessionFiles) {
      try {
        const txt  = await readFile(join(DATA_DIR, f), 'utf-8');
        const obj  = JSON.parse(txt);
        // Match the stored userId (auth_user_XXX or UUID) to a real user row
        const mappedLU = luMap[obj.userId] || null;
        rows.push({
          id:            f.replace('.json', ''),           // session PK = UUID filename
          learning_uuid: mappedLU,                         // nullable — set once users are migrated
          session_json:  obj,
          created_at:    obj.createdAt  || new Date().toISOString(),
          updated_at:    obj.updatedAt  || new Date().toISOString(),
        });
      } catch (e) { /* skip bad session file */ }
    }
    if (rows.length) {
      // upsert on id (UUID filename) to be idempotent on re-runs
      console.log(`Migrating ${rows.length} sessions to supabase.sessions`);
      await upsertChunks('sessions', rows);
      console.log('Sessions migrated');
    }
  } catch (e) { console.warn('Skipping sessions migration:', e.message); }
}

async function migrateGroups() {
  try {
    const txt = await readFile(join(DATA_DIR, 'groups.json'), 'utf-8');
    const parsed = JSON.parse(txt) || { groups: [] };
    const rows = (parsed.groups || []).map(g => ({
      id: g.id || `grp_${Date.now()}`,
      name: g.name,
      description: g.description || null,
      organization: g.organization || null,
      created_by: g.created_by || null,
      created_at: g.created_at || new Date().toISOString(),
    }));
    if (rows.length) {
      console.log(`Migrating ${rows.length} groups to supabase.groups`);
      await upsertChunks('groups', rows);
      console.log('Groups migrated');
    }
  } catch (e) { console.warn('Skipping groups migration:', e.message); }
}

async function run() {
  let exitOk = false;
  try {
    console.log('Checking target tables existence...');
    const need = ['users','assignments','modules','packages','skill_packages','learning_tracks','assessments','audit_logs','sessions','groups'];
    const missing = [];
    for (const t of need) {
      const ok = await tableExists(t);
      if (!ok) missing.push(t);
    }
    if (missing.length) {
      console.error(`Target table(s) missing: ${missing.join(', ')}. Apply the schema first (see supabase_schema.sql), then re-run this script.`);
      exitOk = true;
      setTimeout(() => process.exit(1), 3000);
      return;
    }

    await migrateUsers();
    await migrateAssignments();
    await migrateModulesAndPackages();
    await migrateAssessments();
    await migrateAuditLogs();
    await migrateSessions();
    await migrateGroups();

    console.log('Migration complete.');
    exitOk = true;
    setTimeout(() => process.exit(0), 3000);
  } catch (e) {
    console.error('Migration failed:', e.message || e);
    setTimeout(() => process.exit(1), 3000);
  }
}

run();
