#!/usr/bin/env node
/**
 * server/scripts/backfillMysql.mjs
 *
 * ONE-TIME (but safe to re-run) backfill: copies every row the app currently
 * has in Supabase/file-mode into the MySQL mirror (server/db/mysqlMirror.js,
 * server/db/mysql.js). Run manually — this is NOT part of server startup and
 * nothing calls it automatically.
 *
 * Supabase/file stays authoritative. This script only READS through the same
 * real store modules the app already uses (server/services/DataStore.js,
 * server/services/UserStore.js, server/db/store.js) so it automatically
 * works whether the live source is Supabase or local JSON files — it never
 * hand-rolls a parallel Supabase/file query.
 *
 * WRITES reuse the exact row-shaping the live mirror calls use (userToRow,
 * assignmentToMysqlRow, toSupabaseModule, splitPackageRow — all exported
 * additively from their modules for this script — plus the same
 * {id,data}/{idColumn,...row} conventions server/db/mysqlMirror.js's
 * buildRow() uses), but go straight to server/db/mysql.js's upsertRow()
 * instead of mysqlMirror.mirrorWrite(): a bulk backfill of thousands of rows
 * must not queue thousands of retry-file entries on a single bad connection
 * blip. Failures are instead collected into a report printed at the end.
 *
 * Usage:
 *   npm run db:backfill-mysql             (from server/)
 *   node scripts/backfillMysql.mjs
 *   node scripts/backfillMysql.mjs --dry-run   # counts only, writes nothing
 *
 * See docs/MYSQL_DUAL_WRITE.md for the full setup walkthrough.
 */

import { pathToFileURL } from 'url';
import { mirrorEnabled } from '../db/mysqlMirror.js';
import * as mysqlDb from '../db/mysql.js';

import {
  Assessments, Submissions, Reports, PendingModules, ModuleAssignments, Companies,
  PlatformSettings, Organizations, Departments, Teams, ApprovalRequests, Groups,
  UserJDProfiles, ActivationTokens, RoleLibrary, EmployeeChecklists, GeneratedContent,
  AccessCodes, AssessmentThresholds, GeneratedModules, QuestionBankArchives,
  QuestionBankVersions, EmployeeAssessmentAssignments, Reminders,
} from '../services/DataStore.js';

import UserStore, { userToRow, assignmentToMysqlRow } from '../services/UserStore.js';

import {
  getModules, getPackages, getSkillPackages, getLearningTracks,
  getGroupMemberships, getNotifications, toSupabaseModule, splitPackageRow,
} from '../db/store.js';

const DRY_RUN = process.argv.includes('--dry-run');

// ── shared helpers ────────────────────────────────────────────────────────────

// Mirrors server/db/mysqlMirror.js's buildRow() contract exactly (not
// imported — that function isn't exported — but the two calling
// conventions are tiny and must stay byte-for-byte identical to what the
// live mirrorWrite() calls produce):
//   - doc-style tables ({id, data JSON}): pass the raw doc as `data` (no
//     idColumn key on it) and this wraps it as { [idColumn]: id, data }.
//   - flat-column tables: pass the COMPLETE row (already containing
//     idColumn) and it's used as-is.
function buildRow({ id, data, idColumn }) {
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, idColumn)) {
    return data;
  }
  return { [idColumn]: id, data };
}

// Strips the bookkeeping fields DataStore.js's doc-style collections add
// (id itself, plus the _created/_updated timestamps some rows carry) —
// identical to DataStore.js's own mirrorDocUpsert() helper.
function docRest(doc) {
  const { id: _id, _created, _updated, ...rest } = doc || {};
  return rest;
}

// Module-level so every helper function can reach them without threading a
// context object through every call; reset at the top of main() (via
// resetState()) so a test harness can call main() more than once in the
// same process (e.g. to verify a second run is idempotent) without counts
// from the first run leaking into the second.
let failures = []; // { table, id, error }
let counts = {};    // table -> { read, written }

function resetState() {
  failures = [];
  counts = {};
}

function bump(table, field, n = 1) {
  if (!counts[table]) counts[table] = { read: 0, written: 0 };
  counts[table][field] += n;
}

async function writeOne(table, id, data, idColumn = 'id') {
  bump(table, 'read');
  if (DRY_RUN) return;
  try {
    const row = buildRow({ id, data, idColumn });
    await mysqlDb.upsertRow(table, row);
    bump(table, 'written');
  } catch (e) {
    failures.push({ table, id, error: e.message });
  }
}

async function writeDocRows(table, docs, idColumn = 'id') {
  for (const doc of docs || []) {
    if (!doc || doc[idColumn] == null) continue;
    await writeOne(table, doc[idColumn], docRest(doc), idColumn);
  }
}

// For tables where the already-fetched object is itself the final row
// (contains idColumn) — pass straight through buildRow's "used as-is" branch.
async function writeFlatRows(table, rows, idColumn = 'id') {
  for (const row of rows || []) {
    if (!row || row[idColumn] == null) continue;
    await writeOne(table, row[idColumn], row, idColumn);
  }
}

function logLine(table, read, written) {
  const suffix = DRY_RUN ? `${read} row(s) found` : `${written}/${read} row(s) copied`;
  console.log(`  ${table.padEnd(34)} ${suffix}`);
}

// ── collection backfills ──────────────────────────────────────────────────────

// Tier 1: DataStore.js doc-style collections with a plain getAll().
const DOC_COLLECTIONS = [
  ['assessments', Assessments],
  ['assessment_submissions', Submissions],
  ['assessment_reports', Reports],
  ['pending_modules', PendingModules],
  ['module_assignments', ModuleAssignments],
  ['companies', Companies],
  ['approval_requests', ApprovalRequests],
  ['user_jd_profiles', UserJDProfiles],
  ['activation_tokens', ActivationTokens],
  ['role_library', RoleLibrary],
  ['generated_content', GeneratedContent],
  ['access_codes', AccessCodes],
  ['generated_modules', GeneratedModules],
  ['question_bank_archives', QuestionBankArchives],
];

async function backfillDocCollections() {
  let generatedModuleIds = [];
  for (const [table, store] of DOC_COLLECTIONS) {
    const docs = (await store.getAll()) || [];
    await writeDocRows(table, docs, 'id');
    logLine(table, counts[table]?.read || 0, counts[table]?.written || 0);
    if (table === 'generated_modules') generatedModuleIds = docs.map(d => d.id).filter(Boolean);
  }

  // organizations / departments / teams take an optional filter arg —
  // calling with none returns everything, same as every other getAll() here.
  for (const [table, fn] of [
    ['organizations', () => Organizations.getAll()],
    ['departments', () => Departments.getAll()],
    ['teams', () => Teams.getAll()],
  ]) {
    const docs = (await fn()) || [];
    await writeDocRows(table, docs, 'id');
    logLine(table, counts[table]?.read || 0, counts[table]?.written || 0);
  }

  return generatedModuleIds;
}

// Tier 2: DataStore.js row-style collections (already flat, or need the same
// {id, name, data} reshaping their own create()/update() mirror calls use.
async function backfillGroups() {
  const docs = (await Groups.getAll()) || [];
  const rows = docs.filter(g => g?.id).map(g => {
    const { id, name, _created, _updated, ...rest } = g;
    return { id, name: name ?? null, data: rest };
  });
  await writeFlatRows('groups', rows, 'id');
  logLine('groups', counts.groups?.read || 0, counts.groups?.written || 0);
}

async function backfillQuestionBankVersions() {
  const rows = (await QuestionBankVersions.getAll()) || [];
  await writeFlatRows('question_bank_versions', rows, 'id');
  logLine('question_bank_versions', counts.question_bank_versions?.read || 0, counts.question_bank_versions?.written || 0);
}

async function backfillEmployeeAssessmentAssignments() {
  const rows = (await EmployeeAssessmentAssignments.getAll()) || [];
  await writeFlatRows('employee_assessment_assignments', rows, 'id');
  logLine('employee_assessment_assignments', counts.employee_assessment_assignments?.read || 0, counts.employee_assessment_assignments?.written || 0);
  return rows; // reused below to enumerate (assessment, employee) pairs for reminders
}

// Tier 3: collections with no bulk getAll() in DataStore.js — enumerate the
// known key space (companies/users) and read each row the same per-key way
// the app already does (getByCompany/getByUserId/getByAssignment).
async function backfillPlatformSettingsAndThresholds(companyIds) {
  const ids = [...new Set([...companyIds, 'default'])];
  for (const id of ids) {
    const settings = await PlatformSettings.getByCompany(id);
    if (settings && Object.keys(settings).length > 0) {
      await writeOne('platform_settings', id, { company_id: id, settings, updated_at: new Date().toISOString() }, 'company_id');
    }
    const thresholds = await AssessmentThresholds.getByCompany(id);
    if (thresholds) {
      await writeDocRows('assessment_thresholds', [thresholds], 'id');
    }
  }
  logLine('platform_settings', counts.platform_settings?.read || 0, counts.platform_settings?.written || 0);
  logLine('assessment_thresholds', counts.assessment_thresholds?.read || 0, counts.assessment_thresholds?.written || 0);
}

async function backfillEmployeeChecklists(userIds) {
  for (const userId of userIds) {
    const checklist = await EmployeeChecklists.getByUserId(userId);
    if (checklist) await writeDocRows('employee_checklists', [checklist], 'id');
  }
  logLine('employee_checklists', counts.employee_checklists?.read || 0, counts.employee_checklists?.written || 0);
}

async function backfillReminders(eaaRows) {
  const pairs = new Set();
  for (const r of eaaRows || []) {
    if (r?.assessment_id && r?.user_id) pairs.add(`${r.assessment_id}::${r.user_id}`);
  }
  for (const pair of pairs) {
    const [assessmentId, userId] = pair.split('::');
    const rows = await Reminders.getByAssignment(assessmentId, userId);
    await writeFlatRows('reminders', rows, 'id');
  }
  logLine('reminders', counts.reminders?.read || 0, counts.reminders?.written || 0);
}

// Tier 4: UserStore.js (users, assignments, assignment_requests, audit_logs).
// Split in two: backfillUsers() must run BEFORE anything with a foreign key
// to users(user_id) — assignments, assignment_requests, employee_assessment_
// assignments, group_memberships, notifications, modules.created_by — and
// backfillAssignmentsEtc() runs after (it itself depends on users + groups).
async function backfillUsers() {
  const users = (await UserStore.getAllUsers({})) || [];
  const userRows = users.map(userToRow);

  // users.manager_id is a SELF-referencing foreign key (users.manager_id ->
  // users.user_id). A manager can appear later in this same list than their
  // reports, so a single insert pass in arbitrary order can fail on a fresh
  // database. Two passes fixes it without needing a topological sort: first
  // insert every user with manager_id omitted entirely (so upsertRow's
  // INSERT doesn't set the column, and ON DUPLICATE KEY UPDATE — which only
  // touches columns present in the row — leaves any existing value alone on
  // a re-run), then, once every user row is guaranteed to exist, a second
  // pass sets manager_id safely.
  const withoutManager = userRows.map(({ manager_id, ...rest }) => rest);
  await writeFlatRows('users', withoutManager, 'user_id');

  const withManager = userRows.filter(r => r.manager_id != null);
  for (const r of withManager) {
    if (DRY_RUN) continue;
    try {
      await mysqlDb.upsertRow('users', { user_id: r.user_id, manager_id: r.manager_id });
    } catch (e) {
      failures.push({ table: 'users', id: r.user_id, error: `manager_id update: ${e.message}` });
    }
  }
  logLine('users', counts.users?.read || 0, counts.users?.written || 0);
  return users;
}

async function backfillAssignmentsEtc() {
  const assignments = (await UserStore.getAssignments({})) || [];
  const assignmentRows = assignments.map(assignmentToMysqlRow);
  await writeFlatRows('assignments', assignmentRows, 'id');
  logLine('assignments', counts.assignments?.read || 0, counts.assignments?.written || 0);

  const requests = (await UserStore.getAssignmentRequests({})) || [];
  await writeFlatRows('assignment_requests', requests, 'id');
  logLine('assignment_requests', counts.assignment_requests?.read || 0, counts.assignment_requests?.written || 0);

  const logs = (await UserStore.getAuditLogs({})) || [];
  const logRows = logs.map(l => ({
    log_id: l.logId,
    event_type: l.eventType,
    user_id: l.userId || null,
    metadata: l.metadata || {},
    timestamp: l.timestamp,
  }));
  await writeFlatRows('audit_logs', logRows, 'log_id');
  logLine('audit_logs', counts.audit_logs?.read || 0, counts.audit_logs?.written || 0);
}

// Tier 5: server/db/store.js (modules, packages, skill_packages,
// learning_tracks, group_memberships, notifications).
async function backfillModules(generatedModuleIds) {
  const merged = (await getModules({})) || [];
  // getModules() merges the flat `modules` table with DataStore's
  // generated_modules JSONB fallback (for ids not already in `modules`).
  // The generated_modules half is backfilled separately, under its own
  // table, by backfillDocCollections() above — re-writing those same ids
  // into `modules` here (in a different, flat row shape) would be wrong.
  const seen = new Set(generatedModuleIds);
  const flatOnly = merged.filter(m => m?.id && !seen.has(m.id));
  for (const m of flatOnly) {
    const row = toSupabaseModule(m, m.createdBy || m.created_by || null, m.id);
    await writeOne('modules', m.id, row, 'id');
  }
  logLine('modules', counts.modules?.read || 0, counts.modules?.written || 0);
}

async function backfillPackagesFamily() {
  const packages = (await getPackages({})) || [];
  for (const p of packages) {
    if (!p?.id) continue;
    const row = { id: p.id, created_by: p.createdBy ?? p.created_by ?? null, created_at: p.createdAt ?? p.created_at ?? new Date().toISOString(), ...splitPackageRow(p, ['id', 'category']) };
    await writeOne('packages', p.id, row, 'id');
  }
  logLine('packages', counts.packages?.read || 0, counts.packages?.written || 0);

  const skillPackages = (await getSkillPackages({})) || [];
  for (const p of skillPackages) {
    if (!p?.id) continue;
    const row = { id: p.id, created_by: p.createdBy ?? p.created_by ?? null, created_at: p.createdAt ?? p.created_at ?? new Date().toISOString(), ...splitPackageRow(p, ['id']) };
    await writeOne('skill_packages', p.id, row, 'id');
  }
  logLine('skill_packages', counts.skill_packages?.read || 0, counts.skill_packages?.written || 0);

  const learningTracks = (await getLearningTracks({})) || [];
  for (const t of learningTracks) {
    if (!t?.id) continue;
    const row = { id: t.id, created_by: t.createdBy ?? t.created_by ?? null, created_at: t.createdAt ?? t.created_at ?? new Date().toISOString(), ...splitPackageRow(t, ['id']) };
    await writeOne('learning_tracks', t.id, row, 'id');
  }
  logLine('learning_tracks', counts.learning_tracks?.read || 0, counts.learning_tracks?.written || 0);
}

async function backfillGroupMemberships() {
  const rows = (await getGroupMemberships()) || []; // no groupId => every row
  await writeFlatRows('group_memberships', rows, 'id');
  logLine('group_memberships', counts.group_memberships?.read || 0, counts.group_memberships?.written || 0);
}

async function backfillNotifications(userIds) {
  for (const userId of userIds) {
    const notifs = (await getNotifications(userId)) || [];
    for (const n of notifs) {
      if (!n?.id) continue;
      const { id, user_id, read, created_at, ...rest } = n;
      const row = { id, user_id: user_id ?? userId, read: read || false, payload: rest, created_at: created_at || new Date().toISOString() };
      await writeOne('notifications', id, row, 'id');
    }
  }
  logLine('notifications', counts.notifications?.read || 0, counts.notifications?.written || 0);
}

// ── main ──────────────────────────────────────────────────────────────────────

// Exported for tests. Returns a summary { counts, failures, totalRead,
// totalWritten, elapsedMs } instead of calling process.exit() itself — the
// CLI guard at the bottom of this file turns that into an exit code; a test
// harness can call main() directly and inspect the summary (or catch the
// thrown error when MySQL isn't configured) without the process dying.
export async function main() {
  if (!mirrorEnabled()) {
    throw new Error(
      '[backfill] MySQL is not configured — mirrorEnabled() is false. ' +
      'Set MYSQL_URL (or MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE) ' +
      'and try again. See docs/MYSQL_DUAL_WRITE.md.'
    );
  }

  resetState();
  console.log(`[backfill] ${DRY_RUN ? 'DRY RUN — no writes will be made' : 'LIVE RUN — writing to MySQL'}`);
  const started = Date.now();

  // Order matters here: several tables carry a foreign key onto `users` or
  // `groups` (assignments, assignment_requests, employee_assessment_
  // assignments, group_memberships, notifications, modules.created_by), and
  // employee_assessment_assignments also references question_bank_versions.
  // Users/groups/question_bank_versions are backfilled first so every later
  // table's foreign key target already exists on a fresh database.
  console.log('\n[backfill] UserStore.js users (users.manager_id is self-referencing — written in two passes):');
  const users = await backfillUsers();
  const userIds = users.map(u => u.userId).filter(Boolean);

  console.log('\n[backfill] DataStore.js row-style collections:');
  await backfillGroups();
  await backfillQuestionBankVersions();

  console.log('\n[backfill] DataStore.js doc-style collections:');
  const generatedModuleIds = await backfillDocCollections();

  console.log('\n[backfill] UserStore.js (assignments, assignment_requests, audit_logs):');
  await backfillAssignmentsEtc();

  const eaaRows = await backfillEmployeeAssessmentAssignments();

  console.log('\n[backfill] DataStore.js per-key collections (enumerated by company/user):');
  const companies = (await Companies.getAll()) || [];
  const companyIds = companies.map(c => c.id).filter(Boolean);
  await backfillPlatformSettingsAndThresholds(companyIds);

  await backfillEmployeeChecklists(userIds);
  await backfillReminders(eaaRows);

  console.log('\n[backfill] server/db/store.js (modules, packages, skill_packages, learning_tracks, group_memberships, notifications):');
  await backfillModules(generatedModuleIds);
  await backfillPackagesFamily();
  await backfillGroupMemberships();
  await backfillNotifications(userIds);

  const elapsedMs = Date.now() - started;
  const totalRead = Object.values(counts).reduce((s, c) => s + c.read, 0);
  const totalWritten = Object.values(counts).reduce((s, c) => s + c.written, 0);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`[backfill] ${DRY_RUN ? 'Dry run complete' : 'Backfill complete'}`);
  console.log(`[backfill] total rows ${DRY_RUN ? 'found' : 'read'}:   ${totalRead}`);
  if (!DRY_RUN) console.log(`[backfill] total rows written: ${totalWritten}`);
  console.log(`[backfill] total failures:     ${failures.length}`);
  console.log(`[backfill] elapsed:            ${(elapsedMs / 1000).toFixed(1)}s`);

  if (failures.length > 0) {
    console.log('\n[backfill] FAILURES (table, id, error):');
    for (const f of failures) console.log(`  ${f.table}  ${f.id}  ${f.error}`);
  }

  return { counts, failures, totalRead, totalWritten, elapsedMs };
}

// CLI entry point — only runs when this file is executed directly (`node
// scripts/backfillMysql.mjs`), never when a test imports it to call main()
// itself, so tests never trigger a real process.exit().
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main()
    .then(({ failures: f }) => process.exit(f.length > 0 ? 1 : 0))
    .catch((e) => {
      console.error(e.message || e);
      process.exit(1);
    });
}
