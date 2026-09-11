import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, rename, access, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { GeneratedModules } from '../services/DataStore.js';
import * as mysqlDb from './mysql.js';

// Same opt-in contract as DataStore.js/UserStore.js: unset DB_BACKEND (the
// default) leaves every existing Supabase/file behavior in this file
// completely untouched. Supabase keeps working exactly as it does today
// until DB_BACKEND=mysql is explicitly set.
function useMySQL() {
  return process.env.DB_BACKEND === 'mysql' && !!mysqlDb.getPool();
}

// new URL('..', import.meta.url).pathname produces a leading-slash path on
// Windows (e.g. /D:/HACKap/server) which join() then treats as relative,
// prepending the cwd's own drive on top (D:\D:\HACKap\...) — the same
// fileURLToPath+dirname pattern DataStore.js/UserStore.js already use
// avoids that entirely.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
let supabase = null;
let enabled = false;

/**
 * Lazy self-init from process.env.
 *
 * index.js starts the HTTP server BEFORE the async initSupabase() call
 * completes, so early requests used to see enabled=false and write to the
 * local JSON file fallback — which is EPHEMERAL on Render (wiped on every
 * restart/spin-down). That was the root cause of "created data disappears
 * after logout". isOn() closes that window by initializing the client from
 * env vars on first use.
 */
function isOn() {
  if (enabled) return true;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASESERVICE_ROLE_KEY
           || process.env.SUPABASE_SECRET_KEY
           || process.env.SUPABASE_KEY;
  if (url && key && url.startsWith('http') && key.length >= 10) {
    try {
      supabase = createClient(url, key, { auth: { persistSession: false } });
      enabled = true;
    } catch { /* stay disabled, fall back to file */ }
  }
  return enabled;
}

async function ensureFile(path, defaultContent) {
  try {
    await access(path);
  } catch (e) {
    await writeFile(path, JSON.stringify(defaultContent, null, 2), 'utf-8');
  }
}

export async function initContentFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  await ensureFile(join(DATA_DIR, 'packages.json'), { packages: [], nextId: 1 });
  await ensureFile(join(DATA_DIR, 'skill_packages.json'), { skillPackages: [], nextId: 1 });
  await ensureFile(join(DATA_DIR, 'learning_tracks.json'), { tracks: [], nextId: 1 });
  await ensureFile(join(DATA_DIR, 'groups.json'), { groups: [], nextId: 1 });
  await ensureFile(join(DATA_DIR, 'group_memberships.json'), { memberships: [] });
  await ensureFile(join(DATA_DIR, 'audit.json'), { logs: [], nextLogId: 1 });
  await ensureFile(join(DATA_DIR, 'modules.json'), { modules: [], nextModuleId: 1 });
  await ensureFile(join(DATA_DIR, 'assignments.json'), { assignments: [], nextAssignmentId: 1 });
  await ensureFile(join(DATA_DIR, 'assignment_requests.json'), { requests: [], nextId: 1 });
  await ensureFile(join(DATA_DIR, 'notifications.json'), { notifications: [] });
}

export async function initSupabase(url, key) {
  try {
    // Prefer the real service-role secret key (sb_secret_…) if it is set.
    // Falls back to SUPABASESERVICE_ROLE_KEY env var, then SUPABASE_KEY (legacy JWT / anon).
    const serviceKey = process.env.SUPABASESERVICE_ROLE_KEY
                   || process.env.SUPABASE_SECRET_KEY
                   || key
                   || '';
    if (!url || !serviceKey || serviceKey.length < 10) {
      enabled = false;
      return;
    }
    supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    enabled = true;
    return;
  } catch (e) {
    enabled = false;
    return;
  }
}

export function supabaseEnabled() {
  return isOn();
}

export function getSupabaseClient() {
  return isOn() ? supabase : null;
}

async function readJsonFile(path) {
  try {
    const txt = await readFile(path, 'utf-8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

async function writeJsonFile(path, data) {
  // Write-to-temp-then-rename: this JSON-fallback store (used when Supabase
  // isn't configured/reachable) has no file locking, so a concurrent reader
  // could otherwise see a partially-written file mid-write. rename() is
  // atomic on the same filesystem, so readers always see either the old or
  // the fully-written new content, never a truncated intermediate state.
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmpPath, path);
}

// Content: Packages
export async function getPackages(filters = {}) {
  if (useMySQL()) {
    const rows = filters.category
      ? await mysqlDb.selectWhere('packages', { category: filters.category })
      : await mysqlDb.selectAll('packages');
    return (rows || []).map(r => ({ ...r, ...(r.extra || {}) }));
  }
  if (isOn()) {
    let qb = supabase.from('packages').select('*');
    if (filters.category) qb = qb.eq('category', filters.category);
    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'packages.json'));
  let list = f?.packages || [];
  if (filters.category) list = list.filter(p => p.category === filters.category);
  return list;
}

// Normalize Supabase snake_case module record → camelCase for client
function normalizeModule(m) {
  if (!m) return null;
  const content = m.content || {};
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    category: m.category,
    difficulty: m.difficulty,
    estimatedDuration: m.estimated_duration ? `${m.estimated_duration} days` : (m.estimatedDuration || '30 days'),
    skills: m.skills || [],
    tasks: m.tasks || [],
    resources: content.resources || m.resources || [],
    completionCriteria: m.completion_criteria || m.completionCriteria || 'Complete all tasks',
    targetRoles: content.targetRoles || m.targetRoles || [],
    progressTracking: content.progressTracking !== undefined ? content.progressTracking : (m.progressTracking !== undefined ? m.progressTracking : true),
    // Spread generated content fields to top level for easy access
    sessions: content.sessions || m.sessions || [],
    roadmap: content.roadmap || m.roadmap || [],
    projects: content.projects || m.projects || [],
    content,
    createdBy: m.created_by || m.createdBy,
    companyId: m.company_id || m.companyId || null,
    createdAt: m.created_at || m.createdAt,
    updatedAt: m.updated_at || m.updatedAt,
  };
}

// JSONB-fallback (generated_modules) documents don't go through
// normalizeModule (that's flat-table-only), so a top-level field written by
// one update call (e.g. `sessions`) can go stale relative to `content` set by
// a LATER call that only touched `content` — updateHealed's shallow merge
// preserves whatever top-level value was already there. Applied at every
// JSONB read/write return point so `sessions`/`roadmap`/`projects` always
// reflect the current `content`, mirroring what normalizeModule already
// guarantees for the flat-table path.
function reconcileModuleFields(doc) {
  if (!doc) return doc;
  const content = doc.content || {};
  return {
    ...doc,
    sessions: content.sessions || doc.sessions || [],
    roadmap: content.roadmap || doc.roadmap || [],
    projects: content.projects || doc.projects || [],
  };
}

// Fixes the drift at the SOURCE, not just on the next read: whenever an
// update sets `content.sessions`/`roadmap`/`projects`, mirror the same value
// onto the top-level field being written into the JSONB document.
// updateHealed does a plain shallow merge, so without this, an update that
// only touches `content` (e.g. ModuleManagement removing a day) leaves
// whatever top-level `sessions` a PRIOR update call happened to write
// (e.g. the deep-content job's persist step) stranded and stale forever —
// reconcileModuleFields patches every read, but the stored document itself
// would still disagree with itself.
function jsonbUpdatePayload(updates) {
  const payload = { ...updates, updatedAt: new Date().toISOString() };
  if (updates.content) {
    if (updates.content.sessions !== undefined) payload.sessions = updates.content.sessions;
    if (updates.content.roadmap !== undefined) payload.roadmap = updates.content.roadmap;
    if (updates.content.projects !== undefined) payload.projects = updates.content.projects;
  }
  return payload;
}

// Build a safe Supabase-compatible payload from a module object
function toSupabaseModule(module, createdBy, id) {
  const durationRaw = module.estimatedDuration || module.estimated_duration || '';
  const durationInt = parseInt(durationRaw) || 30;
  return {
    id,
    title: module.title,
    description: module.description || '',
    category: module.category || 'General',
    difficulty: module.difficulty || 'beginner',
    estimated_duration: durationInt,
    skills: Array.isArray(module.skills) ? module.skills.filter(Boolean) : [],
    tasks: module.tasks || [],
    resources: module.resources || [],
    completion_criteria: module.completionCriteria || module.completion_criteria || 'Complete all tasks',
    content: {
      ...(module.content || {}),
      ...(module.targetRoles !== undefined ? { targetRoles: Array.isArray(module.targetRoles) ? module.targetRoles : [] } : {}),
      ...(module.progressTracking !== undefined ? { progressTracking: module.progressTracking } : {}),
    },
    created_by: createdBy,
    company_id: module.companyId || module.company_id || null,
  };
}

export async function getModules(filters = {}) {
  let flatModules = [];
  if (useMySQL()) {
    const where = {};
    if (filters.category) where.category = filters.category;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.companyId) where.company_id = filters.companyId;
    const rows = await mysqlDb.selectWhere('modules', where);
    flatModules = (rows || []).map(normalizeModule);
  } else if (isOn()) {
    let qb = supabase.from('modules').select('*');
    if (filters.category) qb = qb.eq('category', filters.category);
    if (filters.difficulty) qb = qb.eq('difficulty', filters.difficulty);
    if (filters.companyId) qb = qb.eq('company_id', filters.companyId);
    const { data, error } = await qb;
    if (!error) flatModules = (data || []).map(normalizeModule);
  }
  // Also pull from DataStore JSONB table (generated_modules) and merge
  let dsModules = [];
  try {
    const all = await GeneratedModules.getAll();
    dsModules = (all || []).filter(m => {
      if (!m?.id) return false;
      if (filters.category && m.category !== filters.category) return false;
      if (filters.difficulty && m.difficulty !== filters.difficulty) return false;
      if (filters.companyId && m.companyId && m.companyId !== filters.companyId) return false;
      return true;
    }).map(reconcileModuleFields);
  } catch (_) {}
  // Merge: flat-column modules take precedence; JSONB fills the gaps
  const seen = new Set(flatModules.map(m => m.id));
  const merged = [...flatModules, ...dsModules.filter(m => !seen.has(m.id))];
  if (merged.length > 0) return merged;
  // Absolute fallback: ephemeral file (pre-migration data)
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return f?.modules || [];
}

export async function getModuleById(id) {
  if (useMySQL()) {
    const row = await mysqlDb.selectById('modules', id, 'id');
    if (row) return normalizeModule(row);
  } else if (isOn()) {
    // maybeSingle() returns null (not error) when no row matches
    const { data, error } = await supabase.from('modules').select('*').eq('id', id).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (data) return normalizeModule(data);
  }
  // Check DataStore JSONB table (generated_modules) — used when flat-column table fails
  try {
    const dsModule = await GeneratedModules.getById(id);
    if (dsModule) return reconcileModuleFields(dsModule);
  } catch (_) {}
  // Check ephemeral file (last resort / pre-migration stranded data)
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return (f?.modules || []).find(m => m.id === id) || null;
}

export async function getModulesByIds(ids) {
  if (!ids?.length) return [];
  let found = [];
  if (useMySQL()) {
    const pool = mysqlDb.getPool();
    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await pool.query(`SELECT * FROM \`modules\` WHERE \`id\` IN (${placeholders})`, ids);
    found = (rows || []).map(normalizeModule);
  } else if (isOn()) {
    const { data, error } = await supabase.from('modules').select('*').in('id', ids);
    if (!error) found = (data || []).map(normalizeModule);
  }
  // Fill missing IDs from DataStore JSONB
  const foundIds = new Set(found.map(m => m.id));
  const missingIds = ids.filter(id => !foundIds.has(id));
  if (missingIds.length) {
    try {
      const dsAll = await GeneratedModules.getAll();
      const dsFound = (dsAll || []).filter(m => missingIds.includes(m.id)).map(reconcileModuleFields);
      found = [...found, ...dsFound];
    } catch (_) {}
  }
  if (found.length > 0) return found;
  // Ephemeral file as absolute last resort
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return (f?.modules || []).filter(m => ids.includes(m.id));
}

export async function createModule(module, createdBy) {
  const { randomUUID } = await import('crypto');
  const id = `mod_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // MySQL's schema (sql/mysql_schema.sql) is created fresh and complete, so
  // none of the defensive missing-column/FK retry logic the Supabase branch
  // below needs (that complexity exists only because the LIVE Supabase
  // schema drifted from its own migration files over time) is needed here.
  if (useMySQL()) {
    const payload = toSupabaseModule(module, createdBy, id);
    payload.created_at = new Date().toISOString();
    payload.updated_at = payload.created_at;
    await mysqlDb.upsertRow('modules', payload);
    return normalizeModule(payload);
  }

  if (isOn()) {
    const payload = toSupabaseModule(module, createdBy, id);
    const { data, error } = await supabase.from('modules').upsert([payload], { onConflict: 'id' }).select().single();
    if (error) {
      console.error('[createModule] Supabase error:', JSON.stringify(error));
      // content column might not exist on older tables — retry without it, then patch
      if (error.code === '42703' || (error.message && error.message.includes('content'))) {
        const { content: _c, ...payloadNoContent } = payload;
        const retry = await supabase.from('modules').upsert([payloadNoContent], { onConflict: 'id' }).select().single();
        if (retry.error) {
          console.error('[createModule] Retry error:', JSON.stringify(retry.error));
          // Fall through to file fallback rather than throwing — prevents data loss
        } else {
          try {
            await supabase.from('modules').update({ content: module.content || {} }).eq('id', id);
          } catch (_) {}
          return normalizeModule({ ...retry.data, content: module.content || {} });
        }
      }
      // FK / NULL violation on created_by — retry without it (let column use DB default)
      if (error.code === '23502' || error.code === '23503' || (error.message && (error.message.includes('created_by') || error.message.includes('foreign key') || error.message.includes('null value')))) {
        const { created_by: _cb, ...payloadNoCreator } = payload;
        const retry2 = await supabase.from('modules').upsert([payloadNoCreator], { onConflict: 'id' }).select().single();
        if (!retry2.error && retry2.data) {
          return normalizeModule(retry2.data);
        }
        console.error('[createModule] Retry without created_by also failed:', JSON.stringify(retry2.error));
      }
      // Fall through to JSONB fallback
      console.warn('[createModule] Flat-column Supabase write failed, trying JSONB fallback:', error.message);
    } else {
      return normalizeModule(data);
    }
  } // end if (isOn())

  // Flat-column modules table unavailable or errored — persist via DataStore JSONB (generated_modules table)
  // This survives Render restarts because DataStore writes to Supabase.
  console.warn('[createModule] Using DataStore JSONB fallback for module persistence.');
  const newModule = {
    id,
    title: module.title,
    description: module.description || '',
    category: module.category || 'General',
    difficulty: module.difficulty || 'beginner',
    estimatedDuration: module.estimatedDuration || '30 days',
    skills: Array.isArray(module.skills) ? module.skills.filter(Boolean) : [],
    tasks: module.tasks || [],
    resources: module.resources || [],
    completionCriteria: module.completionCriteria || 'Complete all tasks',
    content: module.content || {},
    companyId: module.companyId || module.company_id || null,
    createdBy,
    createdAt: new Date().toISOString(),
    _source: 'generated_modules',
  };
  try {
    const saved = await GeneratedModules.create(newModule);
    console.log(`[createModule] Saved to generated_modules JSONB table: ${id}`);
    return saved || newModule;
  } catch (dsErr) {
    // Absolute last resort: ephemeral file (data will be lost on Render restart)
    console.error('[createModule] ⚠️ DataStore JSONB also failed — falling back to ephemeral file. Check SUPABASE_URL and SUPABASESERVICE_ROLE_KEY.', dsErr.message);
    const path = join(DATA_DIR, 'modules.json');
    const f = await readJsonFile(path) || { modules: [], nextModuleId: 1 };
    f.modules.push(newModule);
    f.nextModuleId += 1;
    await writeJsonFile(path, f);
    return newModule;
  }
}

/**
 * Sync any modules stranded in the ephemeral JSON file into Supabase.
 * Called once at startup after Supabase is confirmed live.
 */
export async function syncFileModulesToSupabase() {
  if (!isOn()) return;
  try {
    const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
    const fileModules = f?.modules || [];
    if (!fileModules.length) return;
    let synced = 0;
    for (const fm of fileModules) {
      try {
        const { data: existing } = await supabase.from('modules').select('id').eq('id', fm.id).maybeSingle();
        if (!existing) {
          const payload = toSupabaseModule(fm, fm.createdBy, fm.id);
          const { error } = await supabase.from('modules').upsert([payload], { onConflict: 'id' });
          if (!error) synced++;
        }
      } catch (_) { /* skip individual failures */ }
    }
    if (synced > 0) console.log(`[syncFileModules] Synced ${synced} stranded module(s) to Supabase`);
  } catch (e) {
    console.warn('[syncFileModules] Error during sync:', e.message);
  }
}

export async function updateModule(id, updates) {
  if (useMySQL()) {
    const row = {};
    if (updates.title !== undefined) row.title = updates.title;
    if (updates.description !== undefined) row.description = updates.description;
    if (updates.category !== undefined) row.category = updates.category;
    if (updates.difficulty !== undefined) row.difficulty = updates.difficulty;
    if (updates.estimatedDuration !== undefined) row.estimated_duration = parseInt(updates.estimatedDuration) || 30;
    if (updates.skills !== undefined) row.skills = updates.skills;
    if (updates.tasks !== undefined) row.tasks = updates.tasks;
    if (updates.resources !== undefined) row.resources = updates.resources;
    if (updates.completionCriteria !== undefined) row.completion_criteria = updates.completionCriteria;
    if (updates.companyId !== undefined) row.company_id = updates.companyId;
    if (updates.company_id !== undefined) row.company_id = updates.company_id;
    if (updates.sessions !== undefined || updates.content !== undefined || updates.targetRoles !== undefined || updates.progressTracking !== undefined) {
      const existing = await mysqlDb.selectById('modules', id, 'id');
      const existingContent = existing?.content || {};
      row.content = {
        ...existingContent,
        ...(updates.content || {}),
        ...(updates.sessions !== undefined ? { sessions: updates.sessions } : {}),
        ...(updates.targetRoles !== undefined ? { targetRoles: Array.isArray(updates.targetRoles) ? updates.targetRoles : [] } : {}),
        ...(updates.progressTracking !== undefined ? { progressTracking: updates.progressTracking } : {}),
      };
    }
    row.updated_at = new Date().toISOString();
    const pool = mysqlDb.getPool();
    const [result] = await pool.query(
      `UPDATE \`modules\` SET ${Object.keys(row).map(c => `\`${c}\` = ?`).join(', ')} WHERE \`id\` = ?`,
      [...Object.values(row).map(v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v), id]
    );
    if (result.affectedRows > 0) {
      return normalizeModule(await mysqlDb.selectById('modules', id, 'id'));
    }
    // Not in the flat modules table — same JSONB/file fallback the
    // Supabase branch below uses for a module stranded in generated_modules.
    const dsUpdated = await GeneratedModules.update(id, jsonbUpdatePayload(updates)).catch(() => null);
    if (dsUpdated) return reconcileModuleFields(dsUpdated);
    return null;
  }
  if (isOn()) {
    // Normalize updates to snake_case for Supabase
    const sbUpdates = {};
    if (updates.title !== undefined) sbUpdates.title = updates.title;
    if (updates.description !== undefined) sbUpdates.description = updates.description;
    if (updates.category !== undefined) sbUpdates.category = updates.category;
    if (updates.difficulty !== undefined) sbUpdates.difficulty = updates.difficulty;
    if (updates.estimatedDuration !== undefined) sbUpdates.estimated_duration = parseInt(updates.estimatedDuration) || 30;
    if (updates.skills !== undefined) sbUpdates.skills = updates.skills;
    if (updates.tasks !== undefined) sbUpdates.tasks = updates.tasks;
    if (updates.resources !== undefined) sbUpdates.resources = updates.resources;
    if (updates.completionCriteria !== undefined) sbUpdates.completion_criteria = updates.completionCriteria;
    if (updates.companyId !== undefined) sbUpdates.company_id = updates.companyId;
    if (updates.company_id !== undefined) sbUpdates.company_id = updates.company_id;
    // Merge sessions / content / targetRoles / progressTracking into existing DB content
    if (updates.sessions !== undefined || updates.content !== undefined || updates.targetRoles !== undefined || updates.progressTracking !== undefined) {
      const { data: existing } = await supabase.from('modules').select('content').eq('id', id).maybeSingle();
      const existingContent = existing?.content || {};
      sbUpdates.content = {
        ...existingContent,
        ...(updates.content || {}),
        ...(updates.sessions !== undefined ? { sessions: updates.sessions } : {}),
        ...(updates.targetRoles !== undefined ? { targetRoles: Array.isArray(updates.targetRoles) ? updates.targetRoles : [] } : {}),
        ...(updates.progressTracking !== undefined ? { progressTracking: updates.progressTracking } : {}),
      };
    }
    sbUpdates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('modules').update(sbUpdates).eq('id', id).select().single();
    if (error) {
      if (error.code === 'PGRST116') {
        // Row not in the flat `modules` table. Two places it could actually
        // live instead: the ephemeral file (pre-migration, stranded), or the
        // `generated_modules` JSONB DataStore table — createModule() falls
        // back there whenever the flat-table write fails, and getModuleById/
        // getModules already check it, but this function previously didn't,
        // so any module actually stored there could be viewed and listed but
        // never updated ("Module not found" on every edit).
        const existing = await (async () => {
          const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
          return (f?.modules || []).find(m => m.id === id) || null;
        })();
        if (existing) {
          const payload = toSupabaseModule({ ...existing, ...updates }, existing.createdBy, id);
          const { data: d2, error: e2 } = await supabase.from('modules').upsert([payload], { onConflict: 'id' }).select().single();
          if (e2) throw e2;
          return normalizeModule(d2);
        }
        const dsUpdated = await GeneratedModules.update(id, jsonbUpdatePayload(updates)).catch(() => null);
        if (dsUpdated) return reconcileModuleFields(dsUpdated);
        return null;
      }
      throw error;
    }
    return normalizeModule(data);
  }
  // Supabase not configured — try the JSONB DataStore first (its own update()
  // already falls back to the file store), then the legacy ephemeral file.
  const dsUpdated = await GeneratedModules.update(id, jsonbUpdatePayload(updates)).catch(() => null);
  if (dsUpdated) return reconcileModuleFields(dsUpdated);
  const path = join(DATA_DIR, 'modules.json');
  const f = await readJsonFile(path) || { modules: [] };
  const idx = f.modules.findIndex(m => m.id === id);
  if (idx === -1) return null;
  f.modules[idx] = { ...f.modules[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.modules[idx];
}

export async function deleteModule(id) {
  if (useMySQL()) {
    const deleted = await mysqlDb.deleteRow('modules', id, 'id');
    if (deleted) return true;
    // fall through to check the JSONB/file fallback locations below
  } else if (isOn()) {
    // .delete() succeeds with an empty result (no error) even when no row
    // matches — checking rows-affected via .select() first, same asymmetry
    // as updateModule() above: a module actually stored in the
    // `generated_modules` JSONB fallback would report "deleted" here
    // without anything actually being removed from where it really lives.
    const { data: existing } = await supabase.from('modules').select('id').eq('id', id).maybeSingle();
    if (existing) {
      const { error } = await supabase.from('modules').delete().eq('id', id);
      if (error) throw error;
      return true;
    }
  }
  const path = join(DATA_DIR, 'modules.json');
  const f = await readJsonFile(path) || { modules: [] };
  const initial = f.modules.length;
  f.modules = f.modules.filter(m => m.id !== id);
  if (f.modules.length !== initial) {
    await writeJsonFile(path, f);
    return true;
  }
  // Not in the flat table or the legacy file — check the JSONB fallback.
  const dsExisting = await GeneratedModules.getById(id).catch(() => null);
  if (dsExisting) {
    await GeneratedModules.delete(id);
    return true;
  }
  return false;
}

// packages/skill_packages/learning_tracks are opaque pass-through tables —
// only `id`/`category`/`created_by` are real columns, everything else the
// caller passes goes into the `extra` JSON column and is spread back out
// on read (see getPackages above).
function splitPackageRow(obj, knownCols) {
  const row = {};
  const extra = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (knownCols.includes(k)) row[k] = v;
    else extra[k] = v;
  }
  row.extra = extra;
  return row;
}

export async function createPackage(pkg, createdBy) {
  if (useMySQL()) {
    const id = pkg.id || `pkg_${Date.now()}`;
    const row = { id, created_by: createdBy, created_at: new Date().toISOString(), ...splitPackageRow(pkg, ['id', 'category']) };
    await mysqlDb.insertRow('packages', row);
    return { ...row, ...row.extra };
  }
  if (isOn()) {
    const { data, error } = await supabase.from('packages').insert([{ ...pkg, created_by: createdBy }]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'packages.json');
  const f = await readJsonFile(path) || { packages: [], nextId: 1 };
  const id = `pkg_${String(f.nextId).padStart(4, '0')}`;
  const newPkg = { id, ...pkg, createdBy, createdAt: new Date().toISOString() };
  f.packages.push(newPkg);
  f.nextId += 1;
  await writeJsonFile(path, f);
  return newPkg;
}

export async function updatePackage(id, updates) {
  if (useMySQL()) {
    const existing = await mysqlDb.selectById('packages', id, 'id');
    if (!existing) return null;
    const row = splitPackageRow(updates, ['category']);
    row.extra = { ...(existing.extra || {}), ...row.extra }; // merge, don't replace — a partial update must not drop prior extra fields
    row.updated_at = new Date().toISOString();
    await mysqlDb.updateRow('packages', id, row, 'id');
    const updated = await mysqlDb.selectById('packages', id, 'id');
    return updated ? { ...updated, ...(updated.extra || {}) } : null;
  }
  if (isOn()) {
    const { data, error } = await supabase.from('packages').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'packages.json');
  const f = await readJsonFile(path) || { packages: [] };
  const idx = f.packages.findIndex(p => p.id === id);
  if (idx === -1) return null;
  f.packages[idx] = { ...f.packages[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.packages[idx];
}

export async function deletePackage(id) {
  if (useMySQL()) {
    return await mysqlDb.deleteRow('packages', id, 'id');
  }
  if (isOn()) {
    const { error } = await supabase.from('packages').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
  const path = join(DATA_DIR, 'packages.json');
  const f = await readJsonFile(path) || { packages: [] };
  const initial = f.packages.length;
  f.packages = f.packages.filter(p => p.id !== id);
  if (f.packages.length === initial) return false;
  await writeJsonFile(path, f);
  return true;
}

// Skill packages
export async function getSkillPackages(filters = {}) {
  if (useMySQL()) {
    const rows = await mysqlDb.selectAll('skill_packages');
    return (rows || []).map(r => ({ ...r, ...(r.extra || {}) }));
  }
  if (isOn()) {
    const { data, error } = await supabase.from('skill_packages').select('*');
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'skill_packages.json'));
  return f?.skillPackages || [];
}

export async function createSkillPackage(pkg, createdBy) {
  if (useMySQL()) {
    const id = pkg.id || `sp_${Date.now()}`;
    const row = { id, created_by: createdBy, created_at: new Date().toISOString(), ...splitPackageRow(pkg, ['id']) };
    await mysqlDb.insertRow('skill_packages', row);
    return { ...row, ...row.extra };
  }
  if (isOn()) {
    const { data, error } = await supabase.from('skill_packages').insert([{ ...pkg, created_by: createdBy }]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'skill_packages.json');
  const f = await readJsonFile(path) || { skillPackages: [], nextId: 1 };
  const id = `sp_${String(f.nextId).padStart(4, '0')}`;
  const newPkg = { id, ...pkg, createdBy, createdAt: new Date().toISOString() };
  f.skillPackages.push(newPkg);
  f.nextId += 1;
  await writeJsonFile(path, f);
  return newPkg;
}

export async function updateSkillPackage(id, updates) {
  if (useMySQL()) {
    const existing = await mysqlDb.selectById('skill_packages', id, 'id');
    if (!existing) return null;
    const row = splitPackageRow(updates, []);
    row.extra = { ...(existing.extra || {}), ...row.extra };
    await mysqlDb.updateRow('skill_packages', id, row, 'id');
    const updated = await mysqlDb.selectById('skill_packages', id, 'id');
    return updated ? { ...updated, ...(updated.extra || {}) } : null;
  }
  if (isOn()) {
    const { data, error } = await supabase.from('skill_packages').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'skill_packages.json');
  const f = await readJsonFile(path) || { skillPackages: [] };
  const idx = f.skillPackages.findIndex(p => p.id === id);
  if (idx === -1) return null;
  f.skillPackages[idx] = { ...f.skillPackages[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.skillPackages[idx];
}

// Learning tracks
export async function getLearningTracks(filters = {}) {
  if (useMySQL()) {
    const rows = await mysqlDb.selectAll('learning_tracks');
    return (rows || []).map(r => ({ ...r, ...(r.extra || {}) }));
  }
  if (isOn()) {
    const { data, error } = await supabase.from('learning_tracks').select('*');
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'learning_tracks.json'));
  return f?.tracks || [];
}

export async function createLearningTrack(track, createdBy) {
  if (useMySQL()) {
    const id = track.id || `lt_${Date.now()}`;
    const row = { id, created_by: createdBy, created_at: new Date().toISOString(), ...splitPackageRow(track, ['id']) };
    await mysqlDb.insertRow('learning_tracks', row);
    return { ...row, ...row.extra };
  }
  if (isOn()) {
    const { data, error } = await supabase.from('learning_tracks').insert([{ ...track, created_by: createdBy }]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'learning_tracks.json');
  const f = await readJsonFile(path) || { tracks: [], nextId: 1 };
  const id = `lt_${String(f.nextId).padStart(4, '0')}`;
  const newTrack = { id, ...track, createdBy, createdAt: new Date().toISOString() };
  f.tracks.push(newTrack);
  f.nextId += 1;
  await writeJsonFile(path, f);
  return newTrack;
}

// Groups
export async function _sbSelect(table) {
  if (isOn()) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw error;
    return data || [];
  }
  if (table === 'groups') {
    const f = await readJsonFile(join(DATA_DIR, 'groups.json'));
    return f?.groups || [];
  }
  return [];
}

export async function getGroups() {
  if (useMySQL()) {
    const rows = await mysqlDb.selectAll('groups');
    return (rows || []).map(r => ({ id: r.id, ...(r.data || {}) }));
  }
  if (isOn()) {
    // groups table uses the JSONB { id, data } pattern (shared with DataStore.Groups)
    const { data, error } = await supabase.from('groups').select('id, data');
    if (error) throw error;
    return (data || []).map(r => ({ id: r.id, ...(r.data || {}) }));
  }
  const f = await readJsonFile(join(DATA_DIR, 'groups.json'));
  return f?.groups || [];
}

export async function createGroup(group) {
  if (useMySQL()) {
    const id = group.id || `grp_${Date.now()}`;
    const { id: _i, ...rest } = group;
    await mysqlDb.upsertRow('groups', {
      id,
      name: rest.name || null,
      manager_id: rest.managerId || null,
      data: rest,
    }, ['name', 'manager_id', 'data']);
    return { id, ...rest };
  }
  if (isOn()) {
    const id = group.id || `grp_${Date.now()}`;
    const { id: _i, ...rest } = group;
    const { data, error } = await supabase.from('groups')
      .upsert({ id, data: rest }, { onConflict: 'id' })
      .select('id, data')
      .single();
    if (error) throw error;
    return { id: data.id, ...(data.data || {}) };
  }
  const path = join(DATA_DIR, 'groups.json');
  const f = await readJsonFile(path) || { groups: [], nextId: 1 };
  const newGroup = { ...group, id: group.id || `grp_${String(f.nextId).padStart(4, '0')}` };
  f.groups.push(newGroup);
  f.nextId += 1;
  await writeJsonFile(path, f);
  return newGroup;
}

export async function addGroupMembers(groupId, userIds, roleInGroup = 'member') {
  const memberships = userIds.map(userId => ({
    id: `gm_${Date.now()}_${userId}`,
    group_id: groupId,
    user_id: userId,
    role_in_group: roleInGroup,
    joined_at: new Date().toISOString(),
  }));
  if (useMySQL()) {
    for (const m of memberships) await mysqlDb.insertRow('group_memberships', m);
    return memberships;
  }
  if (isOn()) {
    const { data, error } = await supabase.from('group_memberships').insert(memberships).select();
    if (error) throw error;
    return data || memberships;
  }
  const path = join(DATA_DIR, 'group_memberships.json');
  const f = await readJsonFile(path) || { memberships: [] };
  f.memberships.push(...memberships);
  await writeJsonFile(path, f);
  return memberships;
}

export async function getGroupMemberships(groupId) {
  if (useMySQL()) {
    return groupId
      ? await mysqlDb.selectWhere('group_memberships', { group_id: groupId })
      : await mysqlDb.selectAll('group_memberships');
  }
  if (isOn()) {
    let qb = supabase.from('group_memberships').select('*');
    if (groupId) qb = qb.eq('group_id', groupId);
    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'group_memberships.json'));
  const all = f?.memberships || [];
  return groupId ? all.filter(m => m.group_id === groupId) : all;
}

// Audit logging
export async function logAuthEvent(eventType, userId, metadata = {}) {
  const logEntry = { log_id: `log_${Date.now()}`, event_type: eventType, user_id: userId || null, metadata, timestamp: new Date().toISOString() };
  if (useMySQL()) {
    try { await mysqlDb.insertRow('audit_logs', logEntry); } catch (e) { console.warn('audit log error', e.message); }
    return logEntry;
  }
  if (isOn()) {
    const { error } = await supabase.from('audit_logs').insert([logEntry]);
    if (error) console.warn('audit log error', error.message);
    return logEntry;
  }
  const path = join(DATA_DIR, 'audit.json');
  const f = await readJsonFile(path) || { logs: [], nextLogId: 1 };
  f.logs.push(logEntry);
  f.nextLogId += 1;
  await writeJsonFile(path, f);
  return logEntry;
}

export async function getAuditLogs(filters = {}) {
  if (useMySQL()) {
    return filters.userId
      ? await mysqlDb.selectWhere('audit_logs', { user_id: filters.userId })
      : await mysqlDb.selectAll('audit_logs');
  }
  if (isOn()) {
    const qb = supabase.from('audit_logs').select('*');
    if (filters.userId) qb.eq('user_id', filters.userId);
    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'audit.json'));
  let logs = f?.logs || [];
  if (filters.userId) logs = logs.filter(l => l.user_id === filters.userId);
  return logs;
}

export default {
  initSupabase,
  supabaseEnabled,
  getSupabaseClient,
  initContentFiles,
  syncFileModulesToSupabase,
  getPackages,
  getModules,
  getModuleById,
  createModule,
  updateModule,
  deleteModule,
  createPackage,
  updatePackage,
  deletePackage,
  getSkillPackages,
  createSkillPackage,
  updateSkillPackage,
  getLearningTracks,
  createLearningTrack,
  _sbSelect,
  getGroups,
  createGroup,
  addGroupMembers,
  getGroupMemberships,
  logAuthEvent,
  getAuditLogs,
  getAssignments,
  createAssignment,
  updateAssignment,
  createAssignmentRequest,
  getAssignmentRequests,
  updateAssignmentRequest,
  createNotification,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
};

// ─────────────────────────────────────────────────────────────
// Assignments (Supabase + fallback)
export async function getAssignments(filters = {}) {
  if (useMySQL()) {
    const where = {};
    if (filters.user_id) where.assigned_to_user = filters.user_id;
    if (filters.status) where.status = filters.status;
    return (await mysqlDb.selectWhere('assignments', where)) || [];
  }
  if (isOn()) {
    let qb = supabase.from('assignments').select('*');
    if (filters.user_id) qb = qb.eq('assigned_to_user', filters.user_id);
    if (filters.status) qb = qb.eq('status', filters.status);
    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'assignments.json'));
  return f?.assignments || [];
}

export async function createAssignment(assignment) {
  if (useMySQL()) {
    const id = assignment.id || `assign_${Date.now()}`;
    const row = { ...assignment, id, created_at: new Date().toISOString() };
    await mysqlDb.insertRow('assignments', row);
    return row;
  }
  if (isOn()) {
    const { data, error } = await supabase.from('assignments').insert([assignment]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'assignments.json');
  const f = await readJsonFile(path) || { assignments: [], nextAssignmentId: 1 };
  const id = `assign_${String(f.nextAssignmentId).padStart(4, '0')}`;
  const newA = { id, ...assignment, created_at: new Date().toISOString() };
  f.assignments.push(newA);
  f.nextAssignmentId += 1;
  await writeJsonFile(path, f);
  return newA;
}

export async function updateAssignment(id, updates) {
  if (useMySQL()) {
    const row = { ...updates, updated_at: new Date().toISOString() };
    await mysqlDb.updateRow('assignments', id, row, 'id');
    return await mysqlDb.selectById('assignments', id, 'id');
  }
  if (isOn()) {
    const { data, error } = await supabase.from('assignments').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'assignments.json');
  const f = await readJsonFile(path) || { assignments: [] };
  const idx = f.assignments.findIndex(a => a.id === id);
  if (idx === -1) return null;
  f.assignments[idx] = { ...f.assignments[idx], ...updates, updated_at: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.assignments[idx];
}

// Assignment Requests (Manager → Admin)
export async function createAssignmentRequest(req) {
  if (useMySQL()) {
    const id = req.id || `req_${Date.now()}`;
    const row = { ...req, id, requested_at: new Date().toISOString() };
    await mysqlDb.insertRow('assignment_requests', row);
    return row;
  }
  if (isOn()) {
    const { data, error } = await supabase.from('assignment_requests').insert([req]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'assignment_requests.json');
  const f = await readJsonFile(path) || { requests: [], nextId: 1 };
  const id = `req_${String(f.nextId).padStart(4, '0')}`;
  const newReq = { id, ...req, requested_at: new Date().toISOString() };
  f.requests.push(newReq);
  f.nextId += 1;
  await writeJsonFile(path, f);
  return newReq;
}

export async function getAssignmentRequests(filters = {}) {
  if (useMySQL()) {
    return filters.status
      ? await mysqlDb.selectWhere('assignment_requests', { status: filters.status })
      : await mysqlDb.selectAll('assignment_requests');
  }
  if (isOn()) {
    let qb = supabase.from('assignment_requests').select('*');
    if (filters.status) qb = qb.eq('status', filters.status);
    const { data, error } = await qb;
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'assignment_requests.json'));
  return f?.requests || [];
}

export async function updateAssignmentRequest(id, updates) {
  if (useMySQL()) {
    const row = { ...updates, decided_at: new Date().toISOString() };
    await mysqlDb.updateRow('assignment_requests', id, row, 'id');
    return await mysqlDb.selectById('assignment_requests', id, 'id');
  }
  if (isOn()) {
    const { data, error } = await supabase.from('assignment_requests').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'assignment_requests.json');
  const f = await readJsonFile(path) || { requests: [] };
  const idx = f.requests.findIndex(r => r.id === id);
  if (idx === -1) return null;
  f.requests[idx] = { ...f.requests[idx], ...updates, decided_at: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.requests[idx];
}

// Notifications
export async function createNotification(notif) {
  if (useMySQL()) {
    const id = notif.id || `notif_${Date.now()}`;
    const { user_id, read, ...rest } = notif;
    const row = { id, user_id, read: read || false, payload: rest, created_at: new Date().toISOString() };
    await mysqlDb.insertRow('notifications', row);
    return { ...row, ...rest };
  }
  if (isOn()) {
    const { data, error } = await supabase.from('notifications').insert([notif]).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'notifications.json');
  const f = await readJsonFile(path) || { notifications: [] };
  const id = `notif_${Date.now()}`;
  const newNotif = { id, ...notif, created_at: new Date().toISOString() };
  f.notifications.push(newNotif);
  await writeJsonFile(path, f);
  return newNotif;
}

export async function getNotifications(userId) {
  if (useMySQL()) {
    const pool = mysqlDb.getPool();
    const [rows] = await pool.query('SELECT * FROM `notifications` WHERE `user_id` = ? ORDER BY `created_at` DESC', [userId]);
    return (rows || []).map(({ payload, ...r }) => ({ ...r, ...(payload || {}) }));
  }
  if (isOn()) {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'notifications.json'));
  return (f?.notifications || []).filter(n => n.user_id === userId);
}

export async function markNotificationRead(notifId, userId) {
  if (useMySQL()) {
    const pool = mysqlDb.getPool();
    const [result] = await pool.query('UPDATE `notifications` SET `read` = TRUE WHERE `id` = ? AND `user_id` = ?', [notifId, userId]);
    if (result.affectedRows === 0) throw new Error('Notification not found');
    const { payload, ...row } = await mysqlDb.selectById('notifications', notifId, 'id');
    return { ...row, ...(payload || {}) };
  }
  if (isOn()) {
    const { data, error } = await supabase.from('notifications').update({ read: true }).eq('id', notifId).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }
  const path = join(DATA_DIR, 'notifications.json');
  const f = await readJsonFile(path) || { notifications: [] };
  const idx = f.notifications.findIndex(n => n.id === notifId && n.user_id === userId);
  if (idx === -1) throw new Error('Notification not found');
  f.notifications[idx].read = true;
  await writeJsonFile(path, f);
  return f.notifications[idx];
}

export async function markAllNotificationsRead(userId) {
  if (useMySQL()) {
    const pool = mysqlDb.getPool();
    await pool.query('UPDATE `notifications` SET `read` = TRUE WHERE `user_id` = ? AND `read` = FALSE', [userId]);
    return true;
  }
  if (isOn()) {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    if (error) throw error;
    return true;
  }
  const path = join(DATA_DIR, 'notifications.json');
  const f = await readJsonFile(path) || { notifications: [] };
  f.notifications = f.notifications.map(n => n.user_id === userId ? { ...n, read: true } : n);
  await writeJsonFile(path, f);
  return true;
}