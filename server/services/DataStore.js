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
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import ws from 'ws';
import { TtlCache } from './TtlCache.js';
import { mirrorWrite } from '../db/mysqlMirror.js';

// ── MySQL best-effort mirror helpers ─────────────────────────────────────────
// See server/db/mysqlMirror.js for the full contract: never throws, never
// blocks/slows the caller, no-ops at ~zero cost when MySQL isn't configured.
// Called ONLY after the real (Supabase/file) write already succeeded.
//
// Doc-style tables (the `{id, data JSON}` pattern used by most collections
// here): strip `id`/`_created`/`_updated` so the mirror wraps `{id, data}`
// itself (mysqlMirror.buildRow — data must NOT already contain `idColumn`).
function mirrorDocUpsert(table, id, doc) {
  if (!doc || typeof doc !== 'object') return;
  const { id: _id, _created, _updated, ...rest } = doc;
  mirrorWrite({ table, op: 'upsert', id, data: rest });
}
// Flat-column tables (question_bank_versions, employee_assessment_assignments,
// reminders, platform_settings, groups): pass the COMPLETE row (it already
// contains the id/idColumn field) so mysqlMirror.buildRow uses it as-is.
function mirrorRowUpsert(table, id, row, idColumn = 'id') {
  if (!row || typeof row !== 'object') return;
  mirrorWrite({ table, op: 'upsert', id, data: row, idColumn });
}
function mirrorDelete(table, id, idColumn = 'id') {
  mirrorWrite({ table, op: 'delete', id, idColumn });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
import { DATA_DIR } from '../config/dataDir.js';
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
  // Write-to-temp-then-rename: no file locking exists in this fallback store,
  // so a concurrent reader could otherwise observe a partially-written file.
  // renameSync is atomic on the same filesystem — readers see the old or the
  // complete new content, never a truncated intermediate state.
  const targetPath = join(DATA_DIR, name);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, targetPath);
  invalidateFile(name);
}

// ── Read cache for whole-table reads (getAllHealed) ───────────────────────────
// Every list page used to re-download/re-parse the WHOLE table on every call
// (assessments, reports, users, groups...). Several of those run per request and
// several run in parallel on one page load. This cache:
//   * lives <= 5 s when Supabase is the source (30 s in file mode, where it is
//     additionally validated against the backing file's mtime+size, so even a
//     writer that bypasses DataStore is noticed immediately),
//   * coalesces concurrent identical reads into one backend call,
//   * is invalidated by EVERY write path in this module: sbInsert/sbUpdate/sbDelete
//     (by table), writeFile (by file name), the direct Groups upserts, and
//     bumpTable() for any caller that writes behind our back.
// Callers get a shallow copy of the array (safe to push/filter/sort); the row
// objects are shared, so rows must be treated as read-only (spread to modify).
const tableCache = new TtlCache({ ttlMs: 5000, maxEntries: 100 });
const tableVersions = new Map();           // table -> write counter (also read by UserStore)
const fileToTables = new Map();            // file name -> Set(table) (filled on first read)
export function getTableVersion(table) { return tableVersions.get(table) || 0; }
function invalidateTable(table) {
  tableVersions.set(table, getTableVersion(table) + 1);
  tableCache.invalidate(table);
}
function invalidateFile(name) {
  for (const t of fileToTables.get(name) || []) invalidateTable(t);
}
export function bumpTable(table) { invalidateTable(table); }
export function clearReadCache() { tableCache.invalidateAll(); }
export function readCacheStats() { return tableCache.stats(); }
function fileSig(name) {
  try { const st = statSync(join(DATA_DIR, name)); return `${st.mtimeMs}:${st.size}`; } catch { return 'none'; }
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
    invalidateTable(table);
    if (error) { console.error(`[DataStore] ${table} insert:`, error.message); return null; }
    mirrorDocUpsert(table, id, rest);
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
    invalidateTable(table);
    if (error) { console.error(`[DataStore] ${table} update:`, error.message); return null; }
    mirrorDocUpsert(table, id, rest);
    return data ? { id: data.id, ...data.data } : merged;
  } catch (e) { console.error(`[DataStore] ${table} update exception:`, e.message); return null; }
}

async function sbDelete(table, id) {
  const sb = getSB();
  if (!sb) return false;
  try {
    const { error } = await sb.from(table).delete().eq('id', id);
    invalidateTable(table);
    if (error) { console.error(`[DataStore] ${table} delete:`, error.message); return false; }
    mirrorDelete(table, id);
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
  if (!fileToTables.has(fileName)) fileToTables.set(fileName, new Set());
  fileToTables.get(fileName).add(table);
  const rows = await tableCache.get(table, () => getAllHealedUncached(table, fileName), {
    ttlMs: getSB() ? 5000 : 30000,
    meta: () => fileSig(fileName),
    validate: (sig) => sig === fileSig(fileName),
  });
  return rows.slice();
}

async function getAllHealedUncached(table, fileName) {
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
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...updates };
    writeFile(fileName, all);
    // Reached only when Supabase isn't configured, or just failed/returned
    // null above — the file write is this request's real, successful
    // persistence, so mirror it (mirroring is independent of which primary
    // backend answered the write).
    mirrorDocUpsert(table, id, all[idx]);
    return all[idx];
  }
  return null;
}

// Delete from BOTH Supabase and the local file — a stale file copy would
// otherwise be resurrected by the self-healing read.
async function deleteHealed(table, fileName, id) {
  const sb = getSB();
  // sbDelete() already mirrors the delete on success; only mirror here when
  // that didn't already happen (no Supabase configured, or it just failed),
  // so a successful Supabase delete is never double-mirrored.
  const sbOk = sb ? await sbDelete(table, id) : false;
  const all = readFileRecords(fileName);
  if (all.some(r => r?.id === id)) {
    writeFile(fileName, all.filter(r => r?.id !== id));
    if (!sbOk) mirrorDelete(table, id);
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
    // File fallback: use the mtime-validated read cache instead of re-parsing the
    // whole assessments.json (tens of MB with rosters) for a single row.
    // (With Supabase on, keep the old cheap local-file lookup: no extra table download.)
    const all = sb ? readFile('assessments.json') : await getAllHealed('assessments', 'assessments.json');
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
    mirrorDocUpsert('assessments', doc.id, doc);
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
    mirrorDocUpsert('assessment_submissions', doc.id, doc);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('assessment_submissions', 'assessment_submissions.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('assessment_submissions', 'assessment_submissions.json', id);
  },
  // Hard-delete every submission of one employee for one assessment
  // (assessmentId + userId), or of the whole assessment when userId is null.
  // Returns how many rows were removed.
  async deleteByAssessmentUser(assessmentId, userId = null) {
    const all = await this.getAll();
    const rows = (all || []).filter(s => s.assessmentId === assessmentId && (userId == null || s.employeeId === userId || s.userId === userId));
    for (const r of rows) await deleteHealed('assessment_submissions', 'assessment_submissions.json', r.id);
    return rows.length;
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
    mirrorDocUpsert('assessment_reports', doc.id, doc);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('assessment_reports', 'assessment_reports.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('assessment_reports', 'assessment_reports.json', id);
  },
  // Same contract as Submissions.deleteByAssessmentUser; returns the removed rows' ids.
  async deleteByAssessmentUser(assessmentId, userId = null) {
    const all = await this.getAll();
    const rows = (all || []).filter(r => r.assessmentId === assessmentId && (userId == null || r.employeeId === userId || r.userId === userId));
    for (const r of rows) await deleteHealed('assessment_reports', 'assessment_reports.json', r.id);
    return rows.map(r => r.id);
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
    mirrorDocUpsert('pending_modules', doc.id, doc);
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
    mirrorDocUpsert('module_assignments', doc.id, doc);
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
    mirrorDocUpsert('companies', doc.id, doc);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('companies', 'companies.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('companies', 'companies.json', id);
  },
};

// ── PLATFORM SETTINGS ──────────────────────────────────────────────────────────
// Per-company admin settings (General/Security/Notifications sections).
// Kept as its own small table/file rather than nested in Companies so a
// missing `platform_settings` Supabase table (not every deployment has run
// the migration for it) degrades to the file fallback instead of breaking
// company reads/writes elsewhere.
export const PlatformSettings = {
  async getByCompany(companyId) {
    const key = companyId || 'default';
    const sb = getSB();
    if (sb) {
      try {
        const { data, error } = await sb.from('platform_settings').select('*').eq('company_id', key).maybeSingle();
        if (!error) return data?.settings || {};
      } catch (e) {
        console.warn('[DataStore] platform_settings.getByCompany:', e.message);
      }
    }
    const all = readFile('platform_settings.json');
    const row = all.find(r => r.companyId === key);
    return row?.settings || {};
  },
  // Shallow-merges `values` into settings[section] only — other sections
  // (and other fields within the same section) are left untouched.
  async updateSection(companyId, section, values) {
    const key = companyId || 'default';
    const current = await this.getByCompany(key);
    const merged = { ...current, [section]: { ...(current[section] || {}), ...values } };
    const sb = getSB();
    if (sb) {
      try {
        const { error } = await sb.from('platform_settings').upsert(
          { company_id: key, settings: merged, updated_at: new Date().toISOString() },
          { onConflict: 'company_id' }
        );
        if (!error) {
          mirrorRowUpsert('platform_settings', key, { company_id: key, settings: merged, updated_at: new Date().toISOString() }, 'company_id');
          return merged;
        }
      } catch (e) {
        console.warn('[DataStore] platform_settings.updateSection:', e.message);
      }
    }
    const all = readFile('platform_settings.json');
    const idx = all.findIndex(r => r.companyId === key);
    const row = { companyId: key, settings: merged, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = row; else all.push(row);
    writeFile('platform_settings.json', all);
    mirrorRowUpsert('platform_settings', key, { company_id: key, settings: merged, updated_at: row.updatedAt }, 'company_id');
    return merged;
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
    mirrorDocUpsert('organizations', doc.id, doc);
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
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFileSync(join(DATA_DIR, 'organizations.json'), JSON.stringify({ organizations: all }, null, 2));
      mirrorDocUpsert('organizations', id, all[idx]);
      return all[idx];
    }
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
    mirrorDocUpsert('departments', doc.id, doc);
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
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFileSync(join(DATA_DIR, 'departments.json'), JSON.stringify({ departments: all }, null, 2));
      mirrorDocUpsert('departments', id, all[idx]);
      return all[idx];
    }
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
    mirrorDocUpsert('teams', doc.id, doc);
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
    if (idx >= 0) {
      rawAll[idx] = { ...rawAll[idx], ...updates };
      writeFileSync(join(DATA_DIR, 'teams.json'), JSON.stringify({ teams: rawAll }, null, 2));
      mirrorDocUpsert('teams', id, rawAll[idx]);
      return rawAll[idx];
    }
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
    mirrorDocUpsert('approval_requests', doc.id, doc);
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
      invalidateTable('groups');
      if (error) throw new Error(`Failed to save group: ${error.message} (code: ${error.code})`);
      mirrorRowUpsert('groups', doc.id, { id: doc.id, name: doc.name, data: rest });
      return data ? { id: data.id, ...data.data } : doc;
    }
    // No Supabase configured — file fallback is acceptable for local dev
    const all = readFileRecords('groups.json');
    all.push(doc);
    writeFile('groups.json', all);
    {
      const { id: _id, name: _name, _created, _updated, ...rest } = doc;
      mirrorRowUpsert('groups', doc.id, { id: doc.id, name: doc.name, data: rest });
    }
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
        invalidateTable('groups');
        if (!error && data) {
          mirrorRowUpsert('groups', id, { id, name: mergedName || data.data?.name, data: data.data });
          return { id: data.id, ...data.data, name: mergedName || data.data?.name };
        }
        if (error) console.error('[DataStore] groups update:', error.message);
      } catch (e) {
        console.error('[DataStore] groups update exception:', e.message);
      }
    }
    const all = readFileRecords('groups.json');
    const idx = all.findIndex(r => r?.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFile('groups.json', all);
      const { id: _id, name: _name, _created, _updated, ...rest } = all[idx];
      mirrorRowUpsert('groups', id, { id, name: all[idx].name, data: rest });
      return all[idx];
    }
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
    mirrorDocUpsert('user_jd_profiles', userId, entry);
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
  async delete(userId) {
    return deleteHealed('user_jd_profiles', 'user_jd_profiles.json', userId);
  },
};

// ── ROLE LIBRARY ──────────────────────────────────────────────────────────────
// Company-scoped master list of job roles with JD and skills.
// id = uuid, data = { companyId, roleName, department, jobDescription, skills[], status }

// ── ACTIVATION TOKENS ─────────────────────────────────────────────────────────
export const ActivationTokens = {
  async create(doc)       { return (await (async () => { const sb = getSB(); if (sb) { const r = await sbInsert('activation_tokens', doc.id, doc); if (r) return r; } const all = readFile('activation_tokens.json'); all.push(doc); writeFile('activation_tokens.json', all); mirrorDocUpsert('activation_tokens', doc.id, doc); return doc; })()) },
  async getAll()           { return getAllHealed('activation_tokens', 'activation_tokens.json'); },
  async getById(id) {
    const sb = getSB();
    if (sb) { const r = await sbGetById('activation_tokens', id); if (r) return r; }
    return readFile('activation_tokens.json').find(t => t.id === id) || null;
  },
  async update(id, updates) { return updateHealed('activation_tokens', 'activation_tokens.json', id, updates); },
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
  // Exact-duplicate check for ROLE CREATION ONLY — completely separate from
  // findByName's intentional fuzzy matching (contains/word-overlap tiers),
  // which is correct and must stay unchanged for its actual use cases
  // (matching an employee's loosely-typed job title to the right role in
  // auth.js/users.js/assessment.js and this file's own /search endpoint).
  // Using findByName for duplicate-prevention was the bug: "Quality Analyst –
  // IT Infra" and "Quality Analyst – LPO" share enough words to trip
  // findByName's word-overlap tier even though they are different, legitimate
  // roles. This checks case-insensitive, whitespace/punctuation-normalized
  // EXACT equality only — same normalization as findByName's own tier 1, but
  // with no contains/overlap fallback.
  // Uniqueness is company + department + complete role name — the same role
  // title in two different departments (e.g. "Quality Analyst" in Engineering
  // vs. "Quality Analyst" in Operations) is legitimately two different roles
  // and must be allowed to coexist. `department` is optional so callers that
  // don't track it (or a role genuinely has none) keep the prior
  // company-only behavior for that comparison. `excludeId` lets an update
  // (rename) check for collisions with OTHER roles without flagging itself.
  async findExactDuplicate(roleName, companyId, { department, excludeId } = {}) {
    const all = await this.getByCompany(companyId);
    if (!roleName?.trim() || !all?.length) return null;
    const norm = (s) => (s || '').toLowerCase().trim().replace(/[-_/]+/g, ' ');
    const q = norm(roleName);
    const deptQ = department !== undefined ? norm(department) : null;
    return all.find(r => {
      if (excludeId && r.id === excludeId) return false;
      if (norm(r.roleName) !== q) return false;
      if (deptQ !== null && norm(r.department) !== deptQ) return false;
      return true;
    }) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) { const r = await sbInsert('role_library', doc.id, doc); if (r) return r; }
    const all = readFile('role_library.json');
    all.push(doc);
    writeFile('role_library.json', all);
    mirrorDocUpsert('role_library', doc.id, doc);
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
    mirrorDocUpsert('employee_checklists', userId, entry);
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
    mirrorDocUpsert('generated_content', doc.id, doc);
    return doc;
  },
  async update(id, updates) { return updateHealed('generated_content', 'generated_content.json', id, updates); },
};

// ── SESSION CONTENT CACHE ─────────────────────────────────────────────────────
// A day's deep content costs a full ~8k-token generation, and LLMCache is
// in-memory only — every server restart would re-pay for content that never
// changes. This gives it a PERSISTENT tier keyed by a content fingerprint, so
// a second employee on the same role + gap profile reuses the first
// employee's day at zero cost, across restarts.
//
// Deliberately backed by the existing `generated_content` table rather than a
// new one, so this needs NO SQL migration to work in production, and keyed
// under a sentinel companyId that can never equal a real company's — otherwise
// these rows would show up in the admin Content Review list, which reads
// GeneratedContent.getByCompany().
const CONTENT_CACHE_COMPANY = '__cache__';
const CONTENT_CACHE_PREFIX = 'daycontent_';

export const SessionContentCache = {
  async get(fingerprint) {
    if (!fingerprint) return null;
    try {
      const row = await GeneratedContent.getById(`${CONTENT_CACHE_PREFIX}${fingerprint}`);
      return row?.payload || null;
    } catch {
      return null;
    }
  },
  async set(fingerprint, payload) {
    if (!fingerprint || !payload) return;
    try {
      await GeneratedContent.create({
        id: `${CONTENT_CACHE_PREFIX}${fingerprint}`,
        companyId: CONTENT_CACHE_COMPANY,
        kind: 'day_content_cache',
        payload,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      // A cache write must never break generation — worst case we regenerate.
      console.warn('[SessionContentCache] persist failed:', e.message);
    }
  },
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
    mirrorDocUpsert('access_codes', doc.id, doc);
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
    mirrorDocUpsert('assessment_thresholds', id, doc);
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
    mirrorDocUpsert('generated_modules', doc.id, doc);
    return doc;
  },
  async update(id, updates) {
    return updateHealed('generated_modules', 'generated_modules_ds.json', id, updates);
  },
  async delete(id) {
    return deleteHealed('generated_modules', 'generated_modules_ds.json', id);
  },
};

// ── QUESTION BANK ARCHIVES (quarterly snapshots) ──────────────────────────────
// Table: question_bank_archives { id TEXT PK, data JSONB, created_at, updated_at }
// Immutable deep-copy snapshots of a role's question bank, created by the Role
// Library "New Generation" flow. Deliberately separate from
// question_bank_versions so later edits/locks of live versions never touch them.
// Doc: { id, roleId, companyId, label ('Q1'..), quarterNumber, createdAt,
//        createdBy, questionCount, sourceVersionId, sourceVersion, questions }
export const QuestionBankArchives = {
  async getAll() {
    return getAllHealed('question_bank_archives', 'question_bank_archives.json');
  },
  async getByRole(roleId) {
    const all = await this.getAll();
    return all.filter(r => r?.roleId === roleId)
      .sort((a, b) => (a.quarterNumber || 0) - (b.quarterNumber || 0));
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const result = await sbGetById('question_bank_archives', id);
      if (result) return result;
    }
    return readFileRecords('question_bank_archives.json').find(r => r?.id === id) || null;
  },
  async create(doc) {
    const sb = getSB();
    if (sb) {
      const result = await sbInsert('question_bank_archives', doc.id, doc);
      if (result) return result;
    }
    const all = readFileRecords('question_bank_archives.json');
    all.push(doc);
    writeFile('question_bank_archives.json', all);
    mirrorDocUpsert('question_bank_archives', doc.id, doc);
    return doc;
  },
};

// ── QUESTION BANK VERSIONS ────────────────────────────────────────────────────
// Real (non-JSONB-blob) table: version-controlled, frozen-once-approved
// question banks for a job role. A bank is never mutated in place — every
// regenerate/approve creates a new row. See sql/assessment_engine_v2.sql.
const QBV_FILE = 'question_bank_versions.json';

export const QuestionBankVersions = {
  async getByRole(roleId) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').select('*').eq('role_id', roleId).order('version', { ascending: true });
      if (!error) return data || [];
      console.warn('[DataStore] question_bank_versions.getByRole:', error.message);
    }
    return readFileRecords(QBV_FILE).filter(r => r.role_id === roleId).sort((a, b) => a.version - b.version);
  },
  async getApproved(roleId) {
    const all = await this.getByRole(roleId);
    return all.find(r => r.status === 'approved') || null;
  },
  async getById(id) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').select('*').eq('id', id).maybeSingle();
      if (!error) return data || null;
      console.warn('[DataStore] question_bank_versions.getById:', error.message);
    }
    return readFileRecords(QBV_FILE).find(r => r.id === id) || null;
  },
  async getNextVersion(roleId) {
    const all = await this.getByRole(roleId);
    return all.length ? Math.max(...all.map(r => r.version)) + 1 : 1;
  },
  async create({ roleId, version, questions, questionCount, generationConfig, validationReport, unlockedAt = null, unlockedBy = null }) {
    const row = {
      id: `qbv-${roleId}-v${version}-${randomUUID()}`,
      role_id: roleId,
      version,
      status: 'draft',
      questions,
      question_count: questionCount,
      generation_config: generationConfig || {},
      validation_report: validationReport || null,
      approved_by: null,
      approved_at: null,
      // Set only when this draft was created via the "unlock & regenerate"
      // flow on a role that had a previously-locked (approved) version — a
      // fresh draft on a never-locked role leaves these null.
      unlocked_at: unlockedAt,
      unlocked_by: unlockedBy,
      created_at: new Date().toISOString(),
    };
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').insert(row).select('*').maybeSingle();
      if (!error) {
        mirrorRowUpsert('question_bank_versions', row.id, data || row);
        return data || row;
      }
      console.warn('[DataStore] question_bank_versions.create:', error.message);
    }
    const all = readFileRecords(QBV_FILE);
    all.push(row);
    writeFile(QBV_FILE, all);
    mirrorRowUpsert('question_bank_versions', row.id, row);
    return row;
  },
  // Approves one version and archives (never deletes) any prior approved
  // version for the same role, so historical assignments keep resolving.
  async approve(id, approvedBy) {
    const version = await this.getById(id);
    if (!version) return null;
    const prevApproved = await this.getApproved(version.role_id);
    if (prevApproved && prevApproved.id !== id) {
      await this._setStatus(prevApproved.id, 'archived');
    }
    return this._setStatus(id, 'approved', { approved_by: approvedBy, approved_at: new Date().toISOString() });
  },
  async _setStatus(id, status, extra = {}) {
    const updates = { status, ...extra };
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').update(updates).eq('id', id).select('*').maybeSingle();
      if (!error) {
        mirrorRowUpsert('question_bank_versions', id, data || { id, ...updates });
        return data;
      }
      console.warn('[DataStore] question_bank_versions._setStatus:', error.message);
    }
    const all = readFileRecords(QBV_FILE);
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFile(QBV_FILE, all);
      mirrorRowUpsert('question_bank_versions', id, all[idx]);
      return all[idx];
    }
    return null;
  },
  // Generic questions-array updater for an EDITABLE (draft) version — used by
  // the question CRUD endpoints (add/edit/delete a single question, or
  // replace the whole set) while a role is unlocked for review. Never called
  // on an approved/locked version — callers must check status first (see
  // roles.js question CRUD routes), since this has no lock check of its own.
  async updateQuestions(id, questions, extra = {}) {
    const updates = { questions, question_count: questions.length, ...extra };
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').update(updates).eq('id', id).select('*').maybeSingle();
      if (!error) {
        mirrorRowUpsert('question_bank_versions', id, data || { id, ...updates });
        return data;
      }
      console.warn('[DataStore] question_bank_versions.updateQuestions:', error.message);
    }
    const all = readFileRecords(QBV_FILE);
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      writeFile(QBV_FILE, all);
      mirrorRowUpsert('question_bank_versions', id, all[idx]);
      return all[idx];
    }
    return null;
  },
  // Every version across every role — used only by the retention cleanup
  // job to find superseded drafts. Everyday lookups should use getByRole.
  async getAll() {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('question_bank_versions').select('*');
      if (!error) return data || [];
      console.warn('[DataStore] question_bank_versions.getAll:', error.message);
    }
    return readFileRecords(QBV_FILE);
  },
  // Permanently removes a version row. Only ever called on superseded
  // 'draft' rows (never 'approved'/'archived' — those must persist so
  // historical assignments keep resolving, per approve()'s own comment).
  async delete(id) {
    const sb = getSB();
    if (sb) {
      const { error } = await sb.from('question_bank_versions').delete().eq('id', id);
      if (!error) { mirrorDelete('question_bank_versions', id); return true; }
      console.warn('[DataStore] question_bank_versions.delete:', error.message);
    }
    const all = readFileRecords(QBV_FILE);
    const next = all.filter(r => r.id !== id);
    writeFile(QBV_FILE, next);
    if (next.length !== all.length) mirrorDelete('question_bank_versions', id);
    return next.length !== all.length;
  },
};

// ── EMPLOYEE ASSESSMENT ASSIGNMENTS ───────────────────────────────────────────
// One row per (assessment, employee): references a frozen question_bank_version
// plus a per-employee shuffled question order. No question text is duplicated.
const EAA_FILE = 'employee_assessment_assignments.json';

export const EmployeeAssessmentAssignments = {
  // Every row across every assessment — used only by the deadline-reminder
  // background sweep (ReminderSweep.js). Everyday lookups should use
  // getByAssessment/getByUser/getOne instead.
  async getAll() {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments').select('*');
      if (!error) return data || [];
      console.warn('[DataStore] employee_assessment_assignments.getAll:', error.message);
    }
    return readFileRecords(EAA_FILE);
  },
  async getByAssessment(assessmentId) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments').select('*').eq('assessment_id', assessmentId);
      if (!error) return data || [];
      console.warn('[DataStore] employee_assessment_assignments.getByAssessment:', error.message);
    }
    return readFileRecords(EAA_FILE).filter(r => r.assessment_id === assessmentId);
  },
  async getByUser(userId) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments').select('*').eq('user_id', userId);
      if (!error) return data || [];
      console.warn('[DataStore] employee_assessment_assignments.getByUser:', error.message);
    }
    return readFileRecords(EAA_FILE).filter(r => r.user_id === userId);
  },
  async getOne(assessmentId, userId) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments').select('*').eq('assessment_id', assessmentId).eq('user_id', userId).maybeSingle();
      if (!error) return data || null;
      console.warn('[DataStore] employee_assessment_assignments.getOne:', error.message);
    }
    return readFileRecords(EAA_FILE).find(r => r.assessment_id === assessmentId && r.user_id === userId) || null;
  },
  async bulkCreate(rows) {
    const prepared = rows.map(r => ({
      id: r.id || `eaa-${randomUUID()}`,
      assessment_id: r.assessmentId,
      user_id: r.userId,
      question_bank_version_id: r.questionBankVersionId,
      question_order: r.questionOrder,
      status: r.status || 'assigned',
      assigned_at: r.assignedAt || new Date().toISOString(),
      // Resolved once at assignment time — see roles.js handleLockAssessment
      // and AssessmentAutoAssign.js, both of which compute these from the
      // assessment's schedulingPolicy before calling bulkCreate. Optional so
      // old callers/rows that predate this field keep working untouched.
      start_at: r.startAt || null,
      due_at: r.dueAt || null,
      submitted_at: null,
      scoring: null,
    }));
    const sb = getSB();
    if (sb) {
      let { data, error } = await sb.from('employee_assessment_assignments')
        .upsert(prepared, { onConflict: 'assessment_id,user_id' })
        .select('*');
      if (error?.code === '42703') {
        // start_at/due_at columns don't exist yet on this Supabase instance —
        // degrade gracefully (assignment creation must not fail outright)
        // rather than silently pretend scheduling succeeded; the one-time
        // warning tells the admin exactly what to run.
        console.warn('[DataStore] employee_assessment_assignments missing start_at/due_at columns — run: ALTER TABLE employee_assessment_assignments ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;');
        const stripped = prepared.map(({ start_at, due_at, ...rest }) => rest);
        ({ data, error } = await sb.from('employee_assessment_assignments')
          .upsert(stripped, { onConflict: 'assessment_id,user_id' })
          .select('*'));
      }
      if (!error) {
        for (const row of (data || prepared)) mirrorRowUpsert('employee_assessment_assignments', row.id, row);
        return data || prepared;
      }
      console.warn('[DataStore] employee_assessment_assignments.bulkCreate:', error.message);
    }
    const all = readFileRecords(EAA_FILE);
    for (const row of prepared) {
      const idx = all.findIndex(r => r.assessment_id === row.assessment_id && r.user_id === row.user_id);
      if (idx >= 0) all[idx] = row; else all.push(row);
    }
    writeFile(EAA_FILE, all);
    for (const row of prepared) mirrorRowUpsert('employee_assessment_assignments', row.id, row);
    return prepared;
  },
  async updateSubmission(id, updates) {
    const payload = {};
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.submittedAt !== undefined) payload.submitted_at = updates.submittedAt;
    if (updates.scoring !== undefined) payload.scoring = updates.scoring;
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments').update(payload).eq('id', id).select('*').maybeSingle();
      if (!error) {
        if (data) mirrorRowUpsert('employee_assessment_assignments', id, data);
        return data;
      }
      console.warn('[DataStore] employee_assessment_assignments.updateSubmission:', error.message);
    }
    const all = readFileRecords(EAA_FILE);
    const idx = all.findIndex(r => r.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...payload };
      writeFile(EAA_FILE, all);
      mirrorRowUpsert('employee_assessment_assignments', id, all[idx]);
      return all[idx];
    }
    return null;
  },
  // Merge-safe: touches ONLY question_order, by (assessment_id, user_id) —
  // unlike bulkCreate's upsert (which always resets status/submitted_at/
  // scoring to fresh-assignment defaults), this is safe to call against a
  // row that may already carry real submission data. Used to self-heal a
  // stale/short question_order without any risk of clobbering a score.
  async updateQuestionOrder(assessmentId, userId, order) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('employee_assessment_assignments')
        .update({ question_order: order })
        .eq('assessment_id', assessmentId).eq('user_id', userId)
        .select('*').maybeSingle();
      if (!error) {
        if (data) mirrorRowUpsert('employee_assessment_assignments', data.id, data);
        return data;
      }
      console.warn('[DataStore] employee_assessment_assignments.updateQuestionOrder:', error.message);
    }
    const all = readFileRecords(EAA_FILE);
    const idx = all.findIndex(r => r.assessment_id === assessmentId && r.user_id === userId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], question_order: order };
      writeFile(EAA_FILE, all);
      mirrorRowUpsert('employee_assessment_assignments', all[idx].id, all[idx]);
      return all[idx];
    }
    return null;
  },
  // Merge-safe window edit: touches ONLY start_at / due_at, never status or scoring.
  async updateWindow(assessmentId, userId, { startAt, dueAt }) {
    const payload = { start_at: startAt || null, due_at: dueAt || null };
    const sb = getSB();
    if (sb) {
      const { error } = await sb.from('employee_assessment_assignments')
        .update(payload).eq('assessment_id', assessmentId).eq('user_id', userId);
      if (error) console.warn('[DataStore] employee_assessment_assignments.updateWindow:', error.message);
    }
    const all = readFileRecords(EAA_FILE);
    const idx = all.findIndex(r => r.assessment_id === assessmentId && r.user_id === userId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...payload };
      writeFile(EAA_FILE, all);
      mirrorRowUpsert('employee_assessment_assignments', all[idx].id, all[idx]);
      return all[idx];
    }
    return null;
  },
  // HARD delete of one employee's row for one assessment (or every row of the
  // assessment when userId is null), in Supabase AND the local file copy so the
  // self-healing paths cannot resurrect it. Returns true when no error occurred.
  async deleteByAssessmentUser(assessmentId, userId = null) {
    let ok = true;
    const sb = getSB();
    if (sb) {
      let q = sb.from('employee_assessment_assignments').delete().eq('assessment_id', assessmentId);
      if (userId != null) q = q.eq('user_id', userId);
      const { error } = await q;
      if (error) { ok = false; console.warn('[DataStore] employee_assessment_assignments.delete:', error.message); }
    }
    const all = readFileRecords(EAA_FILE);
    const matching = all.filter(r => r.assessment_id === assessmentId && (userId == null || r.user_id === userId));
    const keep = all.filter(r => !(r.assessment_id === assessmentId && (userId == null || r.user_id === userId)));
    if (keep.length !== all.length) {
      writeFile(EAA_FILE, keep);
      for (const r of matching) mirrorDelete('employee_assessment_assignments', r.id);
    }
    return ok;
  },
};

// ── REMINDERS ─────────────────────────────────────────────────────────────
// Audit log + cooldown source for both manual ("Send Reminder" button) and
// automated (deadline-approaching sweep) assessment reminders. One row per
// send attempt — never updated in place, so the log is a true history.
const REMINDERS_FILE = 'reminders.json';

export const Reminders = {
  async getByAssignment(assessmentId, employeeId) {
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('reminders').select('*')
        .eq('assessment_id', assessmentId).eq('employee_id', employeeId)
        .order('sent_at', { ascending: false });
      if (!error) return data || [];
      console.warn('[DataStore] reminders.getByAssignment:', error.message);
    }
    return readFileRecords(REMINDERS_FILE)
      .filter(r => r.assessment_id === assessmentId && r.employee_id === employeeId)
      .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
  },
  async getLatest(assessmentId, employeeId, type = null) {
    const rows = await this.getByAssignment(assessmentId, employeeId);
    return (type ? rows.filter(r => r.type === type) : rows)[0] || null;
  },
  async create({ assessmentId, employeeId, senderId, type, deliveryStatus, errorMessage = null }) {
    const row = {
      id: `rem-${randomUUID()}`,
      assessment_id: assessmentId,
      employee_id: employeeId,
      sender_id: senderId || 'system',
      type, // 'manual' | 'auto_deadline'
      sent_at: new Date().toISOString(),
      delivery_status: deliveryStatus, // 'sent' | 'failed'
      error_message: errorMessage,
    };
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('reminders').insert(row).select('*').maybeSingle();
      if (!error) {
        mirrorRowUpsert('reminders', row.id, data || row);
        return data || row;
      }
      console.warn('[DataStore] reminders.create:', error.message);
    }
    const all = readFileRecords(REMINDERS_FILE);
    all.push(row);
    writeFile(REMINDERS_FILE, all);
    mirrorRowUpsert('reminders', row.id, row);
    return row;
  },
  // Hard-delete the reminder history of one assignment (or of a whole assessment
  // when employeeId is null). Supabase and the local file copy.
  async deleteByAssignment(assessmentId, employeeId = null) {
    let ok = true;
    const sb = getSB();
    if (sb) {
      let q = sb.from('reminders').delete().eq('assessment_id', assessmentId);
      if (employeeId != null) q = q.eq('employee_id', employeeId);
      const { error } = await q;
      if (error) { ok = false; console.warn('[DataStore] reminders.delete:', error.message); }
    }
    const all = readFileRecords(REMINDERS_FILE);
    const matching = all.filter(r => r.assessment_id === assessmentId && (employeeId == null || r.employee_id === employeeId));
    const keep = all.filter(r => !(r.assessment_id === assessmentId && (employeeId == null || r.employee_id === employeeId)));
    if (keep.length !== all.length) {
      writeFile(REMINDERS_FILE, keep);
      for (const r of matching) mirrorDelete('reminders', r.id);
    }
    return ok;
  },
};

export default { Assessments, Submissions, Reports, PendingModules, ModuleAssignments, Companies, Organizations, Departments, Teams, ApprovalRequests, Groups, UserJDProfiles, RoleLibrary, ActivationTokens, EmployeeChecklists, GeneratedContent, AssessmentThresholds, AccessCodes, GeneratedModules, QuestionBankVersions, QuestionBankArchives, EmployeeAssessmentAssignments, Reminders };
