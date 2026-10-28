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
  const map = new Map();
  for (const u of list) {
    if (!u) continue;
    if (u.userId) map.set(u.userId, u);
    if (u.id) map.set(u.id, u);
    if (u.email) map.set(u.email.toLowerCase(), u);
    if (u.learningUUID) map.set(u.learningUUID, u);
    if (u.employeeId) map.set(u.employeeId, u);
    if (u.employee_id) map.set(u.employee_id, u);
  }
  return map;
}

function findUser(userById, idOrEmail) {
  if (!idOrEmail || !userById) return null;
  const key = String(idOrEmail).trim();
  return userById.get(key) || userById.get(key.toLowerCase()) || null;
}

async function loadModules(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    for (const m of (await db.getModulesByIds(ids)) || []) out.set(m.id, m);
  } catch { /* titles fall back to the assignment's saved name */ }
  return out;
}

export function getRecencyScore(item) {
  const { assignment: a, row } = item;

  const interactionTimes = [
    row?.completedAt,
    a.completed_at || a.completedAt,
    a.updated_at || a.updatedAt,
    a.last_active_at || a.lastActiveAt || a.last_accessed_at || a.lastAccessedAt,
    row?.startedAt,
    a.started_at || a.startedAt,
  ].map(t => t ? new Date(t).getTime() : 0).filter(n => !isNaN(n) && n > 0);

  const creationTimes = [
    row?.assignedAt,
    a.assigned_at || a.assignedAt || a.created_at || a.createdAt,
  ].map(t => t ? new Date(t).getTime() : 0).filter(n => !isNaN(n) && n > 0);

  const maxInteractionTime = interactionTimes.length ? Math.max(...interactionTimes) : 0;
  const maxCreationTime = creationTimes.length ? Math.max(...creationTimes) : 0;
  const maxAnyTime = Math.max(maxInteractionTime, maxCreationTime);

  const statusStr = String(row?.status || a.status || '').toLowerCase();
  let statusWeight = 1;
  if (statusStr.includes('complete')) statusWeight = 3;
  else if (statusStr.includes('progress') || statusStr.includes('ongoing')) statusWeight = 2;
  else if (statusStr.includes('cancel')) statusWeight = 0;

  const progress = Number(row?.progressPct ?? a.progress ?? 0) || 0;
  const daysCompleted = Number(row?.daysCompleted ?? 0) || 0;
  const questionsAnswered = Number(row?.questionsAnswered ?? 0) || 0;

  return {
    maxInteractionTime,
    maxCreationTime,
    maxAnyTime,
    statusWeight,
    progress,
    daysCompleted,
    questionsAnswered,
    hasActivity: maxInteractionTime > 0 || progress > 0 || daysCompleted > 0 || questionsAnswered > 0,
  };
}

export function isMoreRecent(candItem, existItem) {
  const c = getRecencyScore(candItem);
  const e = getRecencyScore(existItem);

  if (c.hasActivity && !e.hasActivity) return true;
  if (!c.hasActivity && e.hasActivity) return false;

  if (c.maxInteractionTime > 0 && e.maxInteractionTime > 0) {
    if (Math.abs(c.maxInteractionTime - e.maxInteractionTime) > 1000) {
      return c.maxInteractionTime > e.maxInteractionTime;
    }
  }

  if (Math.abs(c.maxAnyTime - e.maxAnyTime) > 1000) {
    if (c.statusWeight >= e.statusWeight) return c.maxAnyTime > e.maxAnyTime;
    if (e.statusWeight > c.statusWeight && e.progress > c.progress && !c.hasActivity) return false;
    return c.maxAnyTime > e.maxAnyTime;
  }

  if (c.statusWeight !== e.statusWeight) {
    return c.statusWeight > e.statusWeight;
  }

  if (c.progress !== e.progress) {
    return c.progress > e.progress;
  }

  if (c.daysCompleted !== e.daysCompleted) {
    return c.daysCompleted > e.daysCompleted;
  }

  return false;
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

  const allItems = mine.map((a) => {
    const ownerId = a.assigned_to_user || a.assignedToUser;
    const user = findUser(userById, ownerId);
    const manager = user?.managerId ? (findUser(userById, user.managerId) || null) : null;
    return {
      assignment: a,
      row: buildEngagement({ assignment: a, module: moduleById.get(a.assignable_id || a.assignableId) || null, user, manager, company, light: true, now }),
    };
  });

  // Deduplicate: Keep only the single most recent/last updated status for each employee + module pair
  const deduplicatedMap = new Map();

  for (const item of allItems) {
    const { assignment: a, row } = item;
    const empKey = String(row.userId || a.assigned_to_user || a.assignedToUser || '').trim().toLowerCase();
    const modKey = String(row.moduleId || row.moduleTitle || a.assignable_id || a.assignableId || '').trim().toLowerCase();
    const pairKey = `${empKey}:::${modKey}`;

    if (!deduplicatedMap.has(pairKey)) {
      deduplicatedMap.set(pairKey, item);
    } else {
      const existing = deduplicatedMap.get(pairKey);
      if (isMoreRecent(item, existing)) {
        deduplicatedMap.set(pairKey, item);
      }
    }
  }

  const rows = [...deduplicatedMap.values()].map(item => item.row);
  return { rows, company };
}

/** Full detail for ONE assignment, or null if it does not exist / is outside the actor's scope. */
export async function loadModuleDetail(actor, assignmentId, { now = new Date(), ctx = null } = {}) {
  const [a] = await UserStore.getAssignments({ id: assignmentId });
  if (!a || !isModuleAssignment(a)) return { error: 'not_found' };
  const ownerId = a.assigned_to_user || a.assignedToUser;
  const visible = ctx?.visible || await getVisibleEmployeeIds(actor);
  if (!visible.has(ownerId)) return { error: 'forbidden' };
  const user = findUser(ctx?.userById, ownerId) || await UserStore.getUserById(ownerId).catch(() => null);
  const managerId = user?.managerId;
  const manager = managerId ? (findUser(ctx?.userById, managerId) || await UserStore.getUserById(managerId).catch(() => null)) : null;
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
