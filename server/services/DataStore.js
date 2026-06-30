/**
 * DataStore.js — Supabase-first store for all non-user data
 * Covers: assessments, submissions, reports, pending_modules,
 *         module_assignments, companies, organizations, departments, teams
 *
 * Uses JSONB `data` column pattern for flexibility.
 * Falls back to local JSON files when Supabase is not configured OR when
 * Supabase returns an error (e.g. table doesn't exist yet).
 *
 * CRITICAL: getAll/getById MUST fall back to file when sbGetAll/sbGetById
 * returns null — otherwise data written to file can never be read back.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── Supabase client ───────────────────────────────────────────────────────────
let _sb = null;
function getSB() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASESERVICE_ROLE_KEY
           || process.env.SUPABASE_SECRET_KEY
           || process.env.SUPABASE_KEY;
  if (url && key && url.startsWith('http') && key.length > 20) {
    _sb = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws },
    });
  }
  return _sb;
}

// ── File helpers (fallback) ───────────────────────────────────────────────────
function readFile(name) {
  const p = join(DATA_DIR, name);
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return []; }
}
function writeFile(name, data) {
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

// ── Generic JSONB table CRUD ──────────────────────────────────────────────────
// All Supabase tables follow: { id TEXT PK, data JSONB, created_at, updated_at }
// The `data` column stores the full document.

// Track which tables already warned about missing timestamp columns (log once per process)
const _warnedTables = new Set();

async function sbGetAll(table) {
  const sb = getSB();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(table).select('id, data, created_at, updated_at');
    if (error) {
      if (!_warnedTables.has(table)) {
        console.warn(`[DataStore] ${table}: no created_at/updated_at columns, using id+data select`);
        _warnedTables.add(table);
      }
      // Graceful fallback: table may not have created_at/updated_at columns
      const { data: d2, error: e2 } = await sb.from(table).select('id, data');
      if (e2) { console.error(`[DataStore] ${table}.getAll: Supabase error (${e2.code} ${e2.message}), using file fallback`); return null; }
      return (d2 || []).map(row => ({ id: row.id, ...row.data }));
    }
    return (data || []).map(row => ({ id: row.id, ...row.data, _created: row.created_at, _updated: row.updated_at }));
  } catch (e) { console.error(`[DataStore] ${table} getAll exception:`, e.message); return null; }
}

async function sbGetById(table, id) {
  const sb = getSB();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(table).select('id, data').eq('id', id).maybeSingle();
    if (error) { console.error(`[DataStore] ${table} getById:`, error.message); return null; }
    return data ? { id: data.id, ...data.data } : null;
  } catch (e) { console.error(`[DataStore] ${table} getById exception:`, e.message); return null; }
}

async function sbInsert(table, id, doc) {
  const sb = getSB();
  if (!sb) return null;
  try {
    const { id: _id, _created, _updated, ...rest } = doc;
    // upsert (not insert): a retry or re-create with the same id must not fail —
    // a failed insert silently strands the record in the ephemeral file fallback
    const { data, error } = await sb.from(table)
      .upsert({ id, data: rest }, { onConflict: 'id' })
      .select('id, data')
      .maybeSingle();
    if (error) { console.error(`[DataStore] ${table} insert:`, error.message); return null; }
    return data ? { id: data.id, ...data.data } : doc;
  } catch (e) { console.error(`[DataStore] ${table} insert exception:`, e.message); return null; }
}

async function sbUpdate(table, id, updates) {
  const sb = getSB();
  if (!sb) return null;
  try {
    // Merge with existing data
    const existing = await sbGetById(table, id);
    const { _created, _updated, id: _id, ...cleanUpdates } = updates;
    const merged = { ...(existing || {}), ...cleanUpdates };
    const { id: __id, _created: _c, _updated: _u, ...rest } = merged;
    // upsert (not update): if the row was stranded in the file fallback by an
    // earlier failed insert, update().eq() matches 0 rows and the change is
    // silently lost while the route reports success
    let { data, error } = await sb.from(table)
      .upsert({ id, data: rest, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('id, data')
      .maybeSingle();
    if (error?.code === '42703') {
      // Table missing updated_at column — retry without it
      ({ data, error } = await sb.from(table)
        .upsert({ id, data: rest }, { onConflict: 'id' })
        .select('id, data')
        .maybeSingle());
    }
    if (error) { console.error(`[DataStore] ${table} update:`, error.message); return null; }
    return data ? { id: data.id, ...data.data } : merged;
  } catch (e) { console.error(`[DataStore] ${table} update exception:`, e.message); return null; }
}

async function sbDelete(table, id) {
  const sb = getSB();
  if (!sb) return false;
  try {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) { console.error(`[DataStore] ${table} delete:`, error.message); return false; }
    return true;
  } catch (e) { return false; }
}

// ── Self-healing read ─────────────────────────────────────────────────────────
// If a write ever fell back to the local JSON file (Supabase momentarily down,
// table missing, transient error), that record was INVISIBLE to reads (which
// prefer Supabase) and got WIPED on the next Render restart. getAllHealed
// merges file-fallback records into the result and re-uploads them to Supabase
// once per table per process, so stranded data becomes durable again.
const _syncedTables = new Set();

// Some fallback files are written as bare arrays, others as wrapped objects
// (e.g. db/store.js writes groups.json as { groups: [...] }). Normalize both.
function readFileRecords(fileName) {
  const raw = readFile(fileName);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const arr = Object.values(raw).find(Array.isArray);
    if (arr) return arr;
  }
  return [];
}

async function getAllHealed(table, fileName) {
  const sb = getSB();
  if (!sb) return readFileRecords(fileName);

  const sbRows = await sbGetAll(table);
  if (sbRows === null) {
    // Supabase errored (e.g. table missing) — file is the source of truth
    console.warn(`[DataStore] ${table}.getAll: Supabase error, using file fallback`);
    return readFileRecords(fileName);
  }

  const fileRows = readFileRecords(fileName);
  if (fileRows.length === 0) return sbRows;

  const sbIds = new Set(sbRows.map(r => r.id));
  const stranded = fileRows.filter(r => r?.id && !sbIds.has(r.id));
  if (stranded.length === 0) return sbRows;

  // Re-upload stranded file records to Supabase (once per table per process)
  if (!_syncedTables.has(table)) {
    _syncedTables.add(table);
    console.warn(`[DataStore] ${table}: re-syncing ${stranded.length} file-fallback record(s) to Supabase`);
    for (const doc of stranded) {
      await sbInsert(table, doc.id, doc);
    }
  }

  return [...sbRows, ...stranded];
}

// Update that survives a record stranded in the file fallback: pushes the
// file copy up to Supabase first so the merge in sbUpdate sees the full
// document, then applies the update.
async function updateHealed(table, fileName, id, updates) {
  const sb = getSB();
  if (sb) {
    const inSb = await sbGetById(table, id);
    if (!inSb) {
      const fileRec = readFileRecords(fileName).find(r => r?.id === id);
      if (fileRec) await sbInsert(table, id, fileRec);
    }
    const result = await sbUpdate(table, id, updates);
    if (result) return result;
  }
  const all = readFileRecords(fileName);
  const idx = all.findIndex(r => r?.id === id);
  if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile(fileName, all); return all[idx]; }
  return null;
}

// Delete from BOTH Supabase and the local file — a stale file copy would
// otherwise be resurrected by the self-healing read.
async function deleteHealed(table, fileName, id) {
  const sb = getSB();
  if (sb) await sbDelete(table, id);
  const all = readFileRecords(fileName);
  if (all.some(r => r?.id === id)) {
    writeFile(fileName, all.filter(r => r?.id !== id));
  }
}

// ── ASSESSMENTS ───────────────────────────────────────────────────────────────

export const Assessments = {
  async getAll() {
    return getAllHealed('assessments', 'assessments.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('assessments', id);
      if (result) return result;  // truthy = found; null (error or not-found) falls through to file
    }
    const all = readFile('assessments.json');
    return all.find(a => a.id === id) || null;
  },
  async getByUserId(userId) {
    const all = await this.getAll();
    return (all || []).filter(a => a.employeeId === userId || a.userId === userId);
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('assessments', doc.id, doc);
      if (result) return result;
      console.warn('[DataStore] assessments.create: Supabase insert failed, using file fallback');
    }
    // File fallback
    const all = readFile('assessments.json');
    all.push(doc);
    writeFile('assessments.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('assessments', 'assessments.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('assessments', 'assessments.json', id);
  },
};

// ── ASSESSMENT SUBMISSIONS ────────────────────────────────────────────────────

export const Submissions = {
  async getAll() {
    return getAllHealed('assessment_submissions', 'assessment_submissions.json');
  },
  async getByUserId(userId) {
    const all = await this.getAll();
    return (all || []).filter(s => s.employeeId === userId || s.userId === userId);
  },
  async getByAssessmentId(assessmentId) {
    const all = await this.getAll();
    return (all || []).filter(s => s.assessmentId === assessmentId);
  },
  async getOne(assessmentId, userId) {
    const all = await this.getAll();
    return (all || []).find(s => s.assessmentId === assessmentId && (s.employeeId === userId || s.userId === userId)) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('assessment_submissions', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('assessment_submissions.json');
    all.push(doc);
    writeFile('assessment_submissions.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('assessment_submissions', 'assessment_submissions.json', id, updates);
  },
};

// ── ASSESSMENT REPORTS ────────────────────────────────────────────────────────

export const Reports = {
  async getAll() {
    return getAllHealed('assessment_reports', 'assessment_reports.json');
  },
  async getByUserId(userId) {
    const all = await this.getAll();
    return (all || []).filter(r => r.employeeId === userId || r.userId === userId);
  },
  async getByAssessmentId(assessmentId) {
    const all = await this.getAll();
    return (all || []).filter(r => r.assessmentId === assessmentId);
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('assessment_reports', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('assessment_reports.json');
    all.push(doc);
    writeFile('assessment_reports.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('assessment_reports', 'assessment_reports.json', id, updates);
  },
};

// ── PENDING MODULES ───────────────────────────────────────────────────────────

export const PendingModules = {
  async getAll() {
    return getAllHealed('pending_modules', 'pending_modules.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('pending_modules', id);
      if (result) return result;
    }
    return readFile('pending_modules.json').find(m => m.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('pending_modules', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('pending_modules.json');
    all.push(doc);
    writeFile('pending_modules.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('pending_modules', 'pending_modules.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('pending_modules', 'pending_modules.json', id);
  },
};

// ── MODULE ASSIGNMENTS ────────────────────────────────────────────────────────

export const ModuleAssignments = {
  async getAll() {
    return getAllHealed('module_assignments', 'module_assignments.json');
  },
  async getByUserId(userId) {
    const all = await this.getAll();
    return (all || []).filter(a => a.userId === userId || a.employeeId === userId || a.targetUserId === userId);
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('module_assignments', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('module_assignments.json');
    all.push(doc);
    writeFile('module_assignments.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('module_assignments', 'module_assignments.json', id, updates);
  },
};

// ── COMPANIES ─────────────────────────────────────────────────────────────────

export const Companies = {
  async getAll() {
    return getAllHealed('companies', 'companies.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('companies', id);
      if (result) return result;
    }
    return readFile('companies.json').find(c => c.id === id) || null;
  },
  async findByCode(code) {
    const all = await this.getAll();
    return (all || []).find(c => c.companyCode?.toUpperCase() === code?.toUpperCase().trim()) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('companies', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('companies.json');
    all.push(doc);
    writeFile('companies.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('companies', 'companies.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('companies', 'companies.json', id);
  },
};

// ── ORGANIZATIONS ─────────────────────────────────────────────────────────────

export const Organizations = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('organizations');
      if (result !== null) return result;
      console.warn('[DataStore] organizations.getAll: Supabase error, using file fallback');
    }
    try {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, 'organizations.json'), 'utf-8'));
      return raw.organizations || raw || [];
    } catch { return []; }
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('organizations', doc.id, doc);
      if (result) return result;
    }
    const all = await this.getAll();
    all.push(doc);
    writeFileSync(join(DATA_DIR, 'organizations.json'), JSON.stringify({ organizations: all }, null, 2));
    return doc;
  },
  async update(id, updates) {
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('organizations', id, updates);
      if (result) return result;
    }
    const all = await this.getAll();
    const idx = all.findIndex(o => o.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFileSync(join(DATA_DIR, 'organizations.json'), JSON.stringify({ organizations: all }, null, 2)); return all[idx]; }
    return null;
  },
};

// ── DEPARTMENTS ───────────────────────────────────────────────────────────────

export const Departments = {
  async getAll(orgId) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('departments');
      if (result !== null) {
        return orgId ? result.filter(d => d.org_id === orgId) : result;
      }
      console.warn('[DataStore] departments.getAll: Supabase error, using file fallback');
    }
    try {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, 'departments.json'), 'utf-8'));
      const all = raw.departments || raw || [];
      return orgId ? all.filter(d => d.org_id === orgId) : all;
    } catch { return []; }
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('departments', doc.id, doc);
      if (result) return result;
    }
    const all = await this.getAll();
    all.push(doc);
    writeFileSync(join(DATA_DIR, 'departments.json'), JSON.stringify({ departments: all }, null, 2));
    return doc;
  },
  async update(id, updates) {
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('departments', id, updates);
      if (result) return result;
    }
    const all = await this.getAll();
    const idx = all.findIndex(d => d.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFileSync(join(DATA_DIR, 'departments.json'), JSON.stringify({ departments: all }, null, 2)); return all[idx]; }
    return null;
  },
};

// ── TEAMS ─────────────────────────────────────────────────────────────────────

export const Teams = {
  async getAll(deptId, managerId) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('teams');
      if (result !== null) {
        let all = result;
        if (deptId) all = all.filter(t => t.dept_id === deptId);
        if (managerId) all = all.filter(t => t.manager_id === managerId);
        return all;
      }
      console.warn('[DataStore] teams.getAll: Supabase error, using file fallback');
    }
    try {
      const raw = JSON.parse(readFileSync(join(DATA_DIR, 'teams.json'), 'utf-8'));
      let all = raw.teams || raw || [];
      if (deptId) all = all.filter(t => t.dept_id === deptId);
      if (managerId) all = all.filter(t => t.manager_id === managerId);
      return all;
    } catch { return []; }
  },
  async getById(id) {
    const all = await this.getAll();
    return (all || []).find(t => t.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('teams', doc.id, doc);
      if (result) return result;
    }
    const all = await this.getAll();
    all.push(doc);
    writeFileSync(join(DATA_DIR, 'teams.json'), JSON.stringify({ teams: all }, null, 2));
    return doc;
  },
  async update(id, updates) {
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('teams', id, updates);
      if (result) return result;
    }
    const rawAll = await this.getAll();
    const idx = rawAll.findIndex(t => t.id === id);
    if (idx >= 0) { rawAll[idx] = { ...rawAll[idx], ...updates }; writeFileSync(join(DATA_DIR, 'teams.json'), JSON.stringify({ teams: rawAll }, null, 2)); return rawAll[idx]; }
    return null;
  },
};

// ── APPROVAL REQUESTS ─────────────────────────────────────────────────────────

export const ApprovalRequests = {
  async getAll() {
    return getAllHealed('approval_requests', 'approval_requests.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('approval_requests', id);
      if (result) return result;
    }
    return readFile('approval_requests.json').find(a => a.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('approval_requests', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('approval_requests.json');
    all.push(doc);
    writeFile('approval_requests.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('approval_requests', 'approval_requests.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('approval_requests', 'approval_requests.json', id);
  },
};

// ── GROUPS ────────────────────────────────────────────────────────────────────

export const Groups = {
  async getAll() {
    return getAllHealed('groups', 'groups.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('groups', id);
      if (result) return result;
    }
    return readFileRecords('groups.json').find(g => g.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const { id: _id, _created, _updated, ...rest } = doc;
      const { data, error } = await sb.from('groups')
        .upsert({ id: doc.id, name: doc.name, data: rest }, { onConflict: 'id' })
        .select('id, data')
        .maybeSingle();
      if (error) throw new Error(`Failed to save group: ${error.message} (code: ${error.code})`);
      return data ? { id: data.id, ...data.data } : doc;
    }
    // No Supabase configured — file fallback is acceptable for local dev
    const all = readFileRecords('groups.json');
    all.push(doc);
    writeFile('groups.json', all);
    return doc;
  },
  async update(id, updates) {
    const sb = getSB();
    if (sb) {
      try {
        const existing = await sbGetById('groups', id);
        const { _created, _updated, id: _id, ...cleanUpdates } = updates;
        const merged = { ...(existing || {}), ...cleanUpdates };
        const { id: __id, name: mergedName, _created: _c, _updated: _u, ...rest } = merged;
        const upsertPayload = { id, data: rest };
        if (mergedName) upsertPayload.name = mergedName;

        let { data, error } = await sb.from('groups')
          .upsert(upsertPayload, { onConflict: 'id' })
          .select('id, data')
          .maybeSingle();
        if (error?.code === '42703') {
          ({ data, error } = await sb.from('groups')
            .upsert({ id, data: rest }, { onConflict: 'id' })
            .select('id, data')
            .maybeSingle());
        }
        if (!error && data) return { id: data.id, ...data.data, name: mergedName || data.data?.name };
        if (error) console.error('[DataStore] groups update:', error.message);
      } catch (e) {
        console.error('[DataStore] groups update exception:', e.message);
      }
    }
    const all = readFileRecords('groups.json');
    const idx = all.findIndex(r => r?.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('groups.json', all); return all[idx]; }
    return null;
  },
  async delete(id) {
    return deleteHealed('groups', 'groups.json', id);
  },
};

// ── USER JD PROFILES ──────────────────────────────────────────────────────────
// Separate JSONB table so JD data persists even when the users table lacks
// job_description / jd_skills / jd_source_url columns (older Supabase schemas).
// id = userId, data = { jobDescription, jobDescriptionFile, jdSkills, jdSourceUrl, jdSourceType }

export const UserJDProfiles = {
  async upsert(userId, jdData) {
    const sb = getSB();
    if (sb) {
      // sbInsert uses upsert under the hood — safe for both create and update
      const result = await sbInsert('user_jd_profiles', userId, jdData);
      if (result) return result;
    }
    const all = readFile('user_jd_profiles.json');
    const idx = all.findIndex(p => p.id === userId);
    const entry = { id: userId, ...jdData };
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    writeFile('user_jd_profiles.json', all);
    return entry;
  },
  async getAll() {
    return getAllHealed('user_jd_profiles', 'user_jd_profiles.json');
  },
  async getById(userId) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('user_jd_profiles', userId);
      if (result) return result;
    }
    return readFile('user_jd_profiles.json').find(p => p.id === userId) || null;
  },
};

// ── ROLE LIBRARY ──────────────────────────────────────────────────────────────
// Company-scoped master list of job roles with JD and skills.
// id = uuid, data = { companyId, roleName, department, jobDescription, skills[], status }

// ── ACTIVATION TOKENS ─────────────────────────────────────────────────────────
export const ActivationTokens = {
  async create(doc)       { return (await (async () => { const sb = getSB(); if (sb) { const r = await sbInsert('activation_tokens', doc.id, doc); if (r) return r; } const all = readFile('activation_tokens.json'); all.push(doc); writeFile('activation_tokens.json', all); return doc; })()) },
  async getById(id) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('activation_tokens', id); if (r) return r; }
    return readFile('activation_tokens.json').find(t => t.id === id) || null;
  },
  async delete(id)        { return deleteHealed('activation_tokens', 'activation_tokens.json', id); },
};

// ── ROLE LIBRARY ──────────────────────────────────────────────────────────────
export const RoleLibrary = {
  async getAll()           { return getAllHealed('role_library', 'role_library.json'); },
  async getByCompany(cid)  {
    const all = await this.getAll();
    return (all || []).filter(r => (r.companyId || 'default') === (cid || 'default'));
  },
  async getById(id) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('role_library', id); if (r) return r; }
    return readFile('role_library.json').find(r => r.id === id) || null;
  },
  async findByName(roleName, companyId) {
    const all = await this.getByCompany(companyId);
    if (!roleName?.trim() || !all?.length) return null;
    const q = roleName.toLowerCase().trim().replace(/[-_/]+/g, ' ');

    // 1. Exact (case-insensitive)
    const exact = all.find(r => r.roleName?.toLowerCase().trim().replace(/[-_/]+/g, ' ') === q);
    if (exact) return exact;

    // 2. One fully contains the other
    const contains = all.find(r => {
      const rn = r.roleName?.toLowerCase().trim().replace(/[-_/]+/g, ' ');
      return rn && (rn.includes(q) || q.includes(rn));
    });
    if (contains) return contains;

    // 3. Word-overlap score ≥ 50 %
    const qWords = q.split(/\s+/).filter(Boolean);
    let best = null, bestScore = 0;
    for (const r of all) {
      const rWords = (r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ') || '').split(/\s+/).filter(Boolean);
      const overlap = qWords.filter(w => rWords.includes(w)).length;
      const score = overlap / Math.max(qWords.length, rWords.length, 1);
      if (score > bestScore && score >= 0.5) { best = r; bestScore = score; }
    }
    return best;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) { const r = await sbInsert('role_library', doc.id, doc); if (r) return r; }
    const all = readFile('role_library.json');
    all.push(doc);
    writeFile('role_library.json', all);
    return doc;
  },
  async update(id, updates) { return updateHealed('role_library', 'role_library.json', id, updates); },
  async delete(id)           { return deleteHealed('role_library', 'role_library.json', id); },
};

// ── EMPLOYEE CHECKLISTS ───────────────────────────────────────────────────────
// id = userId, data = { roleId, roleName, items:[{id,title,description,dueDay,completed,completedAt}] }
export const EmployeeChecklists = {
  async getByUserId(userId) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('employee_checklists', userId); if (r) return r; }
    return readFile('employee_checklists.json').find(c => c.id === userId) || null;
  },
  async upsert(userId, doc) {
    const sb = getSB();
    if (sb) { const r = await sbInsert('employee_checklists', userId, doc); if (r) return r; }
    const all = readFile('employee_checklists.json');
    const idx = all.findIndex(c => c.id === userId);
    const entry = { id: userId, ...doc };
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    writeFile('employee_checklists.json', all);
    return entry;
  },
  async updateItem(userId, itemId, updates) {
    const existing = await this.getByUserId(userId);
    if (!existing) return null;
    const items = (existing.items || []).map(i => i.id === itemId ? { ...i, ...updates } : i);
    return this.upsert(userId, { ...existing, items });
  },
};

// ── GENERATED CONTENT ─────────────────────────────────────────────────────────
// Tracks all AI-generated content (assessments, modules, learning paths) for admin review.
export const GeneratedContent = {
  async getAll()           { return getAllHealed('generated_content', 'generated_content.json'); },
  async getByCompany(cid)  {
    const all = await this.getAll();
    return (all || []).filter(r => (r.companyId || 'default') === (cid || 'default'));
  },
  async getById(id) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('generated_content', id); if (r) return r; }
    return readFile('generated_content.json').find(r => r.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) { const r = await sbInsert('generated_content', doc.id, doc); if (r) return r; }
    const all = readFile('generated_content.json');
    all.push(doc);
    writeFile('generated_content.json', all);
    return doc;
  },
  async update(id, updates) { return updateHealed('generated_content', 'generated_content.json', id, updates); },
};

// ── ACCESS CODES ─────────────────────────────────────────────────────────────
// Role-scoped signup codes per company. id = uuid, data = { companyId, code, role, isActive, ... }
export const AccessCodes = {
  async getAll()           { return getAllHealed('access_codes', 'access_codes.json'); },
  async getByCompany(cid)  {
    const all = await this.getAll();
    return (all || []).filter(r => r.companyId === cid);
  },
  async getById(id) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('access_codes', id); if (r) return r; }
    return readFile('access_codes.json').find(r => r.id === id) || null;
  },
  async findByCode(code) {
    const all = await this.getAll();
    return (all || []).find(r => r.code?.toUpperCase() === code?.toUpperCase().trim()) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) { const r = await sbInsert('access_codes', doc.id, doc); if (r) return r; }
    const all = readFile('access_codes.json');
    all.push(doc);
    writeFile('access_codes.json', all);
    return doc;
  },
  async update(id, updates) { return updateHealed('access_codes', 'access_codes.json', id, updates); },
  async delete(id)           { return deleteHealed('access_codes', 'access_codes.json', id); },
};

// ── ASSESSMENT THRESHOLDS ─────────────────────────────────────────────────────
// Per-company configurable performance classification thresholds.
export const AssessmentThresholds = {
  async getByCompany(companyId) {
    const id = companyId || 'default';
    const sb = getSB();
    if (sb) { const r = await sbGetById('assessment_thresholds', id); if (r) return r; }
    return readFile('assessment_thresholds.json').find(r => r.id === id) || null;
  },
  async upsert(companyId, thresholds) {
    const id = companyId || 'default';
    const doc = { id, thresholds, updatedAt: new Date().toISOString() };
    const sb = getSB();
    if (sb) { const r = await sbInsert('assessment_thresholds', id, doc); if (r) return r; }
    const all = readFile('assessment_thresholds.json');
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) all[idx] = doc; else all.push(doc);
    writeFile('assessment_thresholds.json', all);
    return doc;
  },
};

// ── GENERATED MODULES (JSONB fallback for flat-column modules table) ──────────
// Table: generated_modules { id TEXT PK, data JSONB, created_at, updated_at }
// Used when the flat-column `modules` Supabase table is missing or has schema issues.
// SQL to create: CREATE TABLE IF NOT EXISTS generated_modules (
//   id TEXT PRIMARY KEY, data JSONB NOT NULL,
//   created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
// );

export const GeneratedModules = {
  async getAll() {
    return getAllHealed('generated_modules', 'generated_modules_ds.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('generated_modules', id);
      if (result) return result;
    }
    return readFile('generated_modules_ds.json').find(m => m?.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('generated_modules', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('generated_modules_ds.json');
    all.push(doc);
    writeFile('generated_modules_ds.json', all);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('generated_modules', 'generated_modules_ds.json', id, updates);
  },
};

export default { Assessments, Submissions, Reports, PendingModules, ModuleAssignments, Companies, Organizations, Departments, Teams, ApprovalRequests, Groups, UserJDProfiles, RoleLibrary, ActivationTokens, EmployeeChecklists, GeneratedContent, AssessmentThresholds, AccessCodes, GeneratedModules };
