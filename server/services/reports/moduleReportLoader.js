/**
 * moduleReportLoader.js - gathers module assignments, modules and people for
 * the Reports > Modules section, scoped to what the caller may see:
 *   admin / superadmin -> their company, manager -> their own team only
 * (both through getVisibleEmployeeIds, the single source of truth).
 */
import UserStore from '../UserStore.js';
import { Companies } from '../DataStore.js';
import * as db from '../../db/store.js';
import { getVisibleEmployeeIds } from '../ManagerScope.js';
import { ensureUsers } from './reportLoader.js';
import { buildEngagement } from './moduleReportData.js';

const isModuleAssignment = (a) => (a.assignable_type || a.type || 'module') === 'module' && !!(a.assigned_to_user || a.assignedToUser);

async function companyFor(id) {
  if (!id || id === 'default') return null;
  return Companies.getById(id).catch(() => null);
}

async function loadUsers() {
  const res = await UserStore.getAllUsers({}).catch(() => []);
  const list = Array.isArray(res) ? res : (res?.users || []);
  return new Map(list.map(u => [u.userId || u.id, u]));
}

async function loadModules(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    for (const m of (await db.getModulesByIds(ids)) || []) out.set(m.id, m);
  } catch { /* titles fall back to the assignment's saved name */ }
  return out;
}

/** Light rows for every module assignment the actor may see (no per-question data). */
export async function loadModuleRows(actor, { now = new Date() } = {}) {
  const visible = await getVisibleEmployeeIds(actor);
  const all = await UserStore.getAssignments({});
  const mine = (all || []).filter(a => isModuleAssignment(a) && visible.has(a.assigned_to_user || a.assignedToUser));
  const [userById, moduleById, company] = await Promise.all([
    loadUsers(),
    loadModules([...new Set(mine.map(a => a.assignable_id || a.assignableId).filter(Boolean))]),
    companyFor(actor.companyId),
  ]);
  await ensureUsers(userById, mine.map(a => a.assigned_to_user || a.assignedToUser));
  const rows = mine.map((a) => {
    const user = userById.get(a.assigned_to_user || a.assignedToUser) || null;
    const manager = user?.managerId ? (userById.get(user.managerId) || null) : null;
    return buildEngagement({ assignment: a, module: moduleById.get(a.assignable_id || a.assignableId) || null, user, manager, company, light: true, now });
  });
  return { rows, company };
}

/** Full detail for ONE assignment, or null if it does not exist / is outside the actor's scope. */
export async function loadModuleDetail(actor, assignmentId, { now = new Date(), ctx = null } = {}) {
  const [a] = await UserStore.getAssignments({ id: assignmentId });
  if (!a || !isModuleAssignment(a)) return { error: 'not_found' };
  const ownerId = a.assigned_to_user || a.assignedToUser;
  const visible = ctx?.visible || await getVisibleEmployeeIds(actor);
  if (!visible.has(ownerId)) return { error: 'forbidden' };
  const user = ctx?.userById?.get(ownerId) || await UserStore.getUserById(ownerId).catch(() => null);
  const managerId = user?.managerId;
  const manager = managerId ? (ctx?.userById?.get(managerId) || await UserStore.getUserById(managerId).catch(() => null)) : null;
  const modId = a.assignable_id || a.assignableId;
  const mod = ctx?.moduleById?.get(modId) || await db.getModuleById(modId).catch(() => null);
  const company = ctx ? ctx.company : await companyFor(actor.companyId);
  return { record: buildEngagement({ assignment: a, module: mod, user, manager, company, light: false, now }), company };
}

/** Full detail for a list of light rows (used by exports); stops at a question cap to protect memory. */
export async function loadDetails(actor, rows, { maxQuestions = 5000, now = new Date() } = {}) {
  const ctx = {
    visible: await getVisibleEmployeeIds(actor),
    userById: await loadUsers(),
    moduleById: await loadModules([...new Set(rows.map(r => r.moduleId).filter(Boolean))]),
    company: await companyFor(actor.companyId),
  };
  const out = [];
  let questionCount = 0;
  let truncated = false;
  for (const r of rows) {
    if (questionCount >= maxQuestions) { truncated = true; break; }
    const d = await loadModuleDetail(actor, r.assignmentId, { now, ctx });
    if (!d.record) continue;
    out.push(d.record);
    questionCount += d.record.questions.length;
  }
  return { records: out, truncated, questionCount, company: ctx.company };
}
