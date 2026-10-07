#!/usr/bin/env node
/**
 * verify_schema.mjs - offline check that the SQL setup covers what the code uses.
 *
 * Plain Node, no dependencies, never touches a database or the network.
 * Usage (from anywhere):   node queries/verify_schema.mjs
 *
 * What it does
 *  1. Scans server/ and rec-engine/ for every table the code touches:
 *       .from('x'), sbGetAll/sbInsert/sbGetById/getAllHealed('x', ...),
 *       and rec-engine REST calls  /rest/v1/x
 *  2. For tables with real (explicit) columns it re-derives the column names
 *     from the source (UserStore row mapping, DataStore insert payloads, ...)
 *  3. Parses queries/supabase/01_full_schema_new_database.sql and checks every
 *     table and column is created there.
 *  4. Checks 02_update_existing_database.sql only adds things 01 also has, and
 *     that neither file contains DROP / TRUNCATE / DELETE statements.
 * Prints OK / MISSING per item; exits 1 if anything is missing.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SQL01 = join(HERE, 'supabase', '01_full_schema_new_database.sql');
const SQL02 = join(HERE, 'supabase', '02_update_existing_database.sql');

const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------- source scan
const SKIP_DIRS = new Set(['node_modules', 'data', '.git', 'dist', 'build', '__pycache__']);
// one-off diagnostic scripts probe tables that do not exist on purpose
const SKIP_FILE = /([\\/]server[\\/]db[\\/]_[^\\/]+\.js$)|\.test\.js$|testFixtures\.js$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|py)$/.test(name) && !SKIP_FILE.test(p)) out.push(p);
  }
  return out;
}

const files = [...walk(join(ROOT, 'server')), ...walk(join(ROOT, 'rec-engine'))];
const tableUses = new Map(); // table -> Set(relative file)

function addTable(name, file) {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || IGNORE_TABLES.has(name)) return;
  if (!tableUses.has(name)) tableUses.set(name, new Set());
  tableUses.get(name).add(relative(ROOT, file).split(sep).join('/'));
}

const IGNORE_TABLES = new Set(['rpc']); // /rest/v1/rpc/<fn> is a function call, not a table
const patterns = [
  /\.from\(\s*['"`]([a-z0-9_]+)['"`]\s*\)/g,
  /\b(?:sbGetAll|sbGetById|sbInsert|getAllHealed|updateHealed|deleteHealed)\(\s*['"`]([a-z0-9_]+)['"`]/g,
  /\/rest\/v1\/([a-z0-9_]+)/g,
];
for (const f of files) {
  const src = read(f);
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) addTable(m[1], f);
  }
}
// Tables referenced only through a variable table-name cannot be regex'd; these
// are accessed via DataStore helpers whose literal names are caught above.

// ---------------------------------------------------- explicit-column derivation
const expectedCols = new Map(); // table -> Set(columns)
function addCols(table, cols) {
  if (!expectedCols.has(table)) expectedCols.set(table, new Set());
  for (const c of cols) if (/^[a-z][a-z0-9_]*$/.test(c)) expectedCols.get(table).add(c);
}

/** returns the text between the first `startMarker` and the next `endMarker` */
function slice(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) return '';
  const j = src.indexOf(endMarker, i + startMarker.length);
  return src.slice(i, j < 0 ? undefined : j);
}
const objKeys = (txt) => [...txt.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);

const userStorePath = join(ROOT, 'server', 'services', 'UserStore.js');
const dataStorePath = join(ROOT, 'server', 'services', 'DataStore.js');
if (existsSync(userStorePath)) {
  const us = read(userStorePath);
  // users: every `row.xxx` in rowToUser and `row.xxx =` in userToRow
  const r2u = slice(us, 'function rowToUser', 'function userToRow');
  const u2r = slice(us, 'function userToRow', 'const JD_FIELDS');
  addCols('users', [...r2u.matchAll(/\brow\.([a-z_]+)/g)].map((m) => m[1]));
  addCols('users', [...u2r.matchAll(/\brow\.([a-z_]+)\s*=/g)].map((m) => m[1]));
  // assignments: sbRow payload + update mapping
  const aRow = slice(us, 'const sbRow = {', '};');
  addCols('assignments', objKeys(aRow));
  addCols('assignments', [...slice(us, 'const sbUpdates', 'let { data, error } = await sb.from(\'assignments\')')
    .matchAll(/sbUpdates\.([a-z_]+)\s*=/g)].map((m) => m[1]));
  // assignment_requests payload
  const reqRow = slice(us, 'const newReq = {', '};');
  addCols('assignment_requests', objKeys(reqRow));
  // audit_logs insert payload
  addCols('audit_logs', ['log_id', 'event_type', 'user_id', 'metadata', 'timestamp']);
}
if (existsSync(dataStorePath)) {
  const ds = read(dataStorePath);
  addCols('employee_assessment_assignments', objKeys(slice(ds, 'const prepared = rows.map', '}));')));
  addCols('employee_assessment_assignments', ['scoring', 'submitted_at', 'status', 'question_order']);
  addCols('question_bank_versions', objKeys(slice(ds, 'async create({ roleId', 'const sb = getSB();')));
  addCols('reminders', objKeys(slice(ds, 'async create({ assessmentId, employeeId', 'const sb = getSB();')));
  addCols('platform_settings', ['company_id', 'settings', 'updated_at']);
  addCols('groups', ['id', 'name', 'data']);
}
// packages / skill_packages / learning_tracks: the route handlers pass the payload straight to store.js
const contentPath = join(ROOT, 'server', 'routes', 'content.js');
if (existsSync(contentPath)) {
  const ct = read(contentPath);
  const keys = (txt) => [...txt.matchAll(/^\s*([a-z][a-z0-9_]*)\s*(?::|,)/gm)].map((m) => m[1]);
  addCols('packages', keys(slice(ct, 'db.createPackage({', '}, userId')));
  addCols('skill_packages', keys(slice(ct, 'db.createSkillPackage({', '}, userId')));
  addCols('learning_tracks', keys(slice(ct, 'db.createLearningTrack({', '}, userId')));
  addCols('packages', ['created_by']); addCols('skill_packages', ['created_by']); addCols('learning_tracks', ['created_by']);
}
// notifications: keys passed by routes / created by store.js
addCols('notifications', ['id', 'user_id', 'title', 'message', 'type', 'action_url', 'read', 'created_at']);
addCols('group_memberships', ['id', 'group_id', 'user_id', 'role_in_group', 'joined_at']);
addCols('sessions', ['id', 'learning_uuid', 'session_json', 'updated_at']);
// store.js module payload (toSupabaseModule)
addCols('modules', ['id', 'title', 'description', 'category', 'difficulty', 'estimated_duration', 'skills',
  'tasks', 'resources', 'completion_criteria', 'content', 'created_by', 'company_id', 'updated_at']);
// rec-engine/database.py payloads
addCols('rec_metrics', ['precision_at_5', 'recall_at_5', 'ndcg_at_10', 'coverage', 'total_users', 'total_skills', 'calculated_at']);
addCols('recommendations_log', ['user_id', 'recommended_skills', 'clicked_skills']);
addCols('user_skill_interactions', ['user_id', 'skill_id', 'engagement_score', 'interaction_type', 'created_at']);
addCols('rec_exclusions', ['user_id', 'skill_id']);
addCols('rec_skills', ['id', 'name', 'description', 'domain']);
addCols('rec_market_demand', ['skill_id', 'demand_score']);

// ------------------------------------------------------------ SQL file parsing
function parseSql(path) {
  const raw = read(path);
  const noComments = raw.replace(/--[^\n]*/g, '');
  const tables = new Map(); // name -> Set(columns)
  const ensure = (n) => { if (!tables.has(n)) tables.set(n, new Set()); return tables.get(n); };

  const createRe = /CREATE TABLE IF NOT EXISTS\s+([a-z_0-9]+)\s*\(/gi;
  let m;
  while ((m = createRe.exec(noComments))) {
    const name = m[1].toLowerCase();
    // find matching close paren
    let depth = 1, i = createRe.lastIndex;
    while (i < noComments.length && depth > 0) {
      const ch = noComments[i++];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    const body = noComments.slice(createRe.lastIndex, i - 1);
    // split top-level commas
    const parts = []; let d = 0, cur = '';
    for (const ch of body) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    const cols = ensure(name);
    for (const p of parts) {
      const first = p.trim().split(/\s+/)[0].toLowerCase();
      if (!first || ['unique', 'primary', 'constraint', 'foreign', 'check'].includes(first)) continue;
      cols.add(first.replace(/"/g, ''));
    }
  }
  const alterRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?([a-z_0-9]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-z_0-9]+)/gi;
  while ((m = alterRe.exec(noComments))) ensure(m[1].toLowerCase()).add(m[2].toLowerCase());

  const bad = [...noComments.matchAll(/\b(DROP|TRUNCATE|DELETE)\b/g)].map((x) => x[1]);
  return { tables, bad, raw };
}

let failures = 0;
const line = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? 'OK     ' : 'MISSING'} ${msg}`); };

if (!existsSync(SQL01)) { console.error('Cannot find ' + SQL01); process.exit(1); }
const sql01 = parseSql(SQL01);

console.log('== 1. Tables used by the code vs 01_full_schema_new_database.sql ==');
const tableNames = [...tableUses.keys()].sort();
for (const t of tableNames) {
  line(sql01.tables.has(t), `table ${t.padEnd(34)} (used in ${[...tableUses.get(t)].slice(0, 2).join(', ')}${tableUses.get(t).size > 2 ? ', ...' : ''})`);
}

console.log('\n== 2. Columns the code reads/writes on explicit-column tables ==');
for (const [t, cols] of [...expectedCols.entries()].sort()) {
  const have = sql01.tables.get(t);
  if (!have) { line(false, `table ${t} absent, cannot check ${cols.size} columns`); continue; }
  const missing = [...cols].filter((c) => !have.has(c));
  line(missing.length === 0, `columns ${t.padEnd(32)} ${cols.size} checked${missing.length ? '  missing: ' + missing.join(', ') : ''}`);
}

console.log('\n== 3. 02_update_existing_database.sql only adds things 01 also has ==');
if (existsSync(SQL02)) {
  const sql02 = parseSql(SQL02);
  for (const [t, cols] of sql02.tables) {
    const have = sql01.tables.get(t);
    const missing = have ? [...cols].filter((c) => !have.has(c)) : [...cols];
    line(!!have && missing.length === 0, `02 -> 01 ${t.padEnd(32)} ${cols.size} columns${missing.length ? '  not in 01: ' + missing.join(', ') : ''}`);
  }
  line(sql02.bad.length === 0, `02 has no DROP/TRUNCATE/DELETE statements${sql02.bad.length ? ' (found ' + sql02.bad.join(',') + ')' : ''}`);
} else {
  line(false, '02_update_existing_database.sql not found');
}
line(sql01.bad.length === 0, `01 has no DROP/TRUNCATE/DELETE statements${sql01.bad.length ? ' (found ' + sql01.bad.join(',') + ')' : ''}`);

console.log('\n== 4. Key schema facts ==');
const flat = sql01.raw.replace(/\s+/g, ' ');
line(/CREATE UNIQUE INDEX IF NOT EXISTS uq_eaa_assessment_user ON employee_assessment_assignments\(assessment_id, user_id\)/i.test(flat),
  'unique (assessment_id, user_id) on employee_assessment_assignments (needed for upsert onConflict)');
line(/idx_users_company_employee_id ON users \(company_id, lower\(employee_id\)\)/i.test(flat),
  'index users(company_id, lower(employee_id))');

console.log(`\n${tableNames.length} tables detected in code, ${failures} problem(s).`);
process.exit(failures ? 1 : 0);
