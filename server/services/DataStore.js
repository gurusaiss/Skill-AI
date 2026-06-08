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

async function sbGetAll(table) {
  const sb = getSB();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(table).select('id, data, created_at, updated_at');
    if (error) { console.error(`[DataStore] ${table} getAll:`, error.message); return null; }
    // Merge id + data fields for convenience
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
    const { data, error } = await sb.from(table)
      .insert({ id, data: rest })
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
    const { data, error } = await sb.from(table)
      .update({ data: rest, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, data')
      .maybeSingle();
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

// ── ASSESSMENTS ───────────────────────────────────────────────────────────────

export const Assessments = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('assessments');
      if (result !== null) return result;   // ✅ only use Supabase if it worked
      console.warn('[DataStore] assessments.getAll: Supabase error, using file fallback');
    }
    return readFile('assessments.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('assessments', id, updates);
      if (result) return result;
    }
    const all = readFile('assessments.json');
    const idx = all.findIndex(a => a.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('assessments.json', all); return all[idx]; }
    return null;
  },
  async delete(id) {
    const sb = getSB();
    if (sb) {
      const ok = await sbDelete('assessments', id);
      if (ok) return;
    }
    writeFile('assessments.json', readFile('assessments.json').filter(a => a.id !== id));
  },
};

// ── ASSESSMENT SUBMISSIONS ────────────────────────────────────────────────────

export const Submissions = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('assessment_submissions');
      if (result !== null) return result;
      console.warn('[DataStore] assessment_submissions.getAll: Supabase error, using file fallback');
    }
    return readFile('assessment_submissions.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('assessment_submissions', id, updates);
      if (result) return result;
    }
    const all = readFile('assessment_submissions.json');
    const idx = all.findIndex(s => s.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('assessment_submissions.json', all); return all[idx]; }
    return null;
  },
};

// ── ASSESSMENT REPORTS ────────────────────────────────────────────────────────

export const Reports = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('assessment_reports');
      if (result !== null) return result;
      console.warn('[DataStore] assessment_reports.getAll: Supabase error, using file fallback');
    }
    return readFile('assessment_reports.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('assessment_reports', id, updates);
      if (result) return result;
    }
    const all = readFile('assessment_reports.json');
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('assessment_reports.json', all); return all[idx]; }
    return null;
  },
};

// ── PENDING MODULES ───────────────────────────────────────────────────────────

export const PendingModules = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('pending_modules');
      if (result !== null) return result;
      console.warn('[DataStore] pending_modules.getAll: Supabase error, using file fallback');
    }
    return readFile('pending_modules.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('pending_modules', id, updates);
      if (result) return result;
    }
    const all = readFile('pending_modules.json');
    const idx = all.findIndex(m => m.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('pending_modules.json', all); return all[idx]; }
    return null;
  },
  async delete(id) {
    const sb = getSB();
    if (sb) { await sbDelete('pending_modules', id); return; }
    writeFile('pending_modules.json', readFile('pending_modules.json').filter(m => m.id !== id));
  },
};

// ── MODULE ASSIGNMENTS ────────────────────────────────────────────────────────

export const ModuleAssignments = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('module_assignments');
      if (result !== null) return result;
      console.warn('[DataStore] module_assignments.getAll: Supabase error, using file fallback');
    }
    return readFile('module_assignments.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('module_assignments', id, updates);
      if (result) return result;
    }
    const all = readFile('module_assignments.json');
    const idx = all.findIndex(a => a.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('module_assignments.json', all); return all[idx]; }
    return null;
  },
};

// ── COMPANIES ─────────────────────────────────────────────────────────────────

export const Companies = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('companies');
      if (result !== null) return result;
      console.warn('[DataStore] companies.getAll: Supabase error, using file fallback');
    }
    return readFile('companies.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('companies', id);
      if (result) return result;
    }
    return readFile('companies.json').find(c => c.id === id) || null;
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('companies', id, updates);
      if (result) return result;
    }
    const all = readFile('companies.json');
    const idx = all.findIndex(c => c.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('companies.json', all); return all[idx]; }
    return null;
  },
  async delete(id) {
    const sb = getSB();
    if (sb) {
      const ok = await sbDelete('companies', id);
      if (ok) return;
    }
    writeFile('companies.json', readFile('companies.json').filter(c => c.id !== id));
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
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('approval_requests');
      if (result !== null) return result;
      console.warn('[DataStore] approval_requests.getAll: Supabase error, using file fallback');
    }
    return readFile('approval_requests.json');
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
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('approval_requests', id, updates);
      if (result) return result;
    }
    const all = readFile('approval_requests.json');
    const idx = all.findIndex(a => a.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], ...updates }; writeFile('approval_requests.json', all); return all[idx]; }
    return null;
  },
  async delete(id) {
    const sb = getSB();
    if (sb) {
      const ok = await sbDelete('approval_requests', id);
      if (ok) return;
    }
    writeFile('approval_requests.json', readFile('approval_requests.json').filter(a => a.id !== id));
  },
};

// ── GROUPS ────────────────────────────────────────────────────────────────────

export const Groups = {
  async getAll() {
    const sb = getSB();
    if (sb) {
      const result = await sbGetAll('groups');
      if (result !== null) return result;
      console.warn('[DataStore] groups.getAll: Supabase error, using file fallback');
    }
    return readFile('groups.json');
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('groups', id);
      if (result) return result;
    }
    return readFile('groups.json').find(g => g.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('groups', doc.id, doc);
      if (result) return result;
    }
    const all = readFile('groups.json');
    all.push(doc);
    writeFile('groups.json', all);
    return doc;
  },
  async update(id, updates) {
    const sb = getSB();
    if (sb) {
      const result = await sbUpdate('groups', id, updates);
      if (result) return result;
    }
    const all = readFile('groups.json');
    const idx = all.findIndex(g => g.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFile('groups.json', all);
      return all[idx];
    }
    return null;
  },
  async delete(id) {
    const sb = getSB();
    if (sb) {
      const ok = await sbDelete('groups', id);
      if (ok) return;
    }
    writeFile('groups.json', readFile('groups.json').filter(g => g.id !== id));
  },
};

export default { Assessments, Submissions, Reports, PendingModules, ModuleAssignments, Companies, Organizations, Departments, Teams, ApprovalRequests, Groups };
