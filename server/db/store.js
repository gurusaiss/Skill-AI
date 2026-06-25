import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join } from 'path';

const DATA_DIR = join(new URL('..', import.meta.url).pathname, 'data');
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
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

// Content: Packages
export async function getPackages(filters = {}) {
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
  if (isOn()) {
    let qb = supabase.from('modules').select('*');
    if (filters.category) qb = qb.eq('category', filters.category);
    if (filters.difficulty) qb = qb.eq('difficulty', filters.difficulty);
    if (filters.companyId) qb = qb.eq('company_id', filters.companyId);
    const { data, error } = await qb;
    if (error) throw error;
    // When Supabase is ON, always return its result (even if empty).
    // Never fall through to the ephemeral file — it is wiped on every Render restart.
    return (data || []).map(normalizeModule);
  }
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return f?.modules || [];
}

export async function getModuleById(id) {
  if (isOn()) {
    // maybeSingle() returns null (not error) when no row matches
    const { data, error } = await supabase.from('modules').select('*').eq('id', id).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (data) return normalizeModule(data);
    // Not in Supabase — check file for stranded modules (pre-migration data)
    const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
    const fileModule = (f?.modules || []).find(m => m.id === id) || null;
    if (fileModule) {
      // Sync stranded module to Supabase so it persists
      try {
        const payload = toSupabaseModule(fileModule, fileModule.createdBy, fileModule.id);
        await supabase.from('modules').upsert([payload], { onConflict: 'id' });
        console.log(`[getModuleById] Synced stranded module ${id} to Supabase`);
      } catch (e) {
        console.warn(`[getModuleById] Failed to sync stranded module ${id}:`, e.message);
      }
    }
    return fileModule;
  }
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return (f?.modules || []).find(m => m.id === id) || null;
}

export async function getModulesByIds(ids) {
  if (!ids?.length) return [];
  if (isOn()) {
    const { data, error } = await supabase.from('modules').select('*').in('id', ids);
    if (!error) {
      const found = (data || []).map(normalizeModule);
      const foundIds = new Set(found.map(m => m.id));
      const missingIds = ids.filter(id => !foundIds.has(id));
      // For IDs not in Supabase, check file (stranded modules) and sync them up
      if (missingIds.length) {
        const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
        const fileModules = (f?.modules || []).filter(m => missingIds.includes(m.id));
        for (const fm of fileModules) {
          try {
            const payload = toSupabaseModule(fm, fm.createdBy, fm.id);
            await supabase.from('modules').upsert([payload], { onConflict: 'id' });
            console.log(`[getModulesByIds] Synced stranded module ${fm.id} to Supabase`);
          } catch (e) { /* non-fatal */ }
        }
        return [...found, ...fileModules];
      }
      return found;
    }
  }
  const f = await readJsonFile(join(DATA_DIR, 'modules.json'));
  return (f?.modules || []).filter(m => ids.includes(m.id));
}

export async function createModule(module, createdBy) {
  const { randomUUID } = await import('crypto');
  const id = `mod_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

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
          throw retry.error;
        }
        // Immediately try to patch content back in — attempt ADD COLUMN + UPDATE
        try {
          await supabase.from('modules').update({ content: module.content || {} }).eq('id', id);
        } catch (_) { /* column still missing — sessions stored in file fallback below */ }
        return normalizeModule({ ...retry.data, content: module.content || {} });
      }
      throw error;
    }
    return normalizeModule(data);
  }

  // Supabase is not available — writing to ephemeral file (data will be lost on Render restart!)
  console.error('[createModule] ⚠️ Supabase is OFF — module will be written to ephemeral JSON file and will not survive a server restart. Check SUPABASE_URL and SUPABASESERVICE_ROLE_KEY env vars.');
  const path = join(DATA_DIR, 'modules.json');
  const f = await readJsonFile(path) || { modules: [], nextModuleId: 1 };
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
    companyId: module.companyId || null,
    createdBy,
    createdAt: new Date().toISOString(),
  };
  f.modules.push(newModule);
  f.nextModuleId += 1;
  await writeJsonFile(path, f);
  return newModule;
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
        // Row not in Supabase yet (stranded in file) — upsert it
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
      }
      throw error;
    }
    return normalizeModule(data);
  }
  const path = join(DATA_DIR, 'modules.json');
  const f = await readJsonFile(path) || { modules: [] };
  const idx = f.modules.findIndex(m => m.id === id);
  if (idx === -1) return null;
  f.modules[idx] = { ...f.modules[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeJsonFile(path, f);
  return f.modules[idx];
}

export async function deleteModule(id) {
  if (isOn()) {
    const { error } = await supabase.from('modules').delete().eq('id', id);
    if (error) throw error;
    return true;
  }
  const path = join(DATA_DIR, 'modules.json');
  const f = await readJsonFile(path) || { modules: [] };
  const initial = f.modules.length;
  f.modules = f.modules.filter(m => m.id !== id);
  if (f.modules.length === initial) return false;
  await writeJsonFile(path, f);
  return true;
}

export async function createPackage(pkg, createdBy) {
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
  if (isOn()) {
    const { data, error } = await supabase.from('skill_packages').select('*');
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'skill_packages.json'));
  return f?.skillPackages || [];
}

export async function createSkillPackage(pkg, createdBy) {
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
  if (isOn()) {
    const { data, error } = await supabase.from('learning_tracks').select('*');
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'learning_tracks.json'));
  return f?.tracks || [];
}

export async function createLearningTrack(track, createdBy) {
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
  if (isOn()) {
    const { data, error } = await supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  const f = await readJsonFile(join(DATA_DIR, 'notifications.json'));
  return (f?.notifications || []).filter(n => n.user_id === userId);
}

export async function markNotificationRead(notifId, userId) {
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