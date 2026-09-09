/**
 * ManagerScope.js
 *
 * Single source of truth for two questions the codebase kept answering
 * differently in different places:
 *
 *   1. "Can this user act as a manager?"
 *      Previously each site tested `user.role === 'manager'`, which silently
 *      excluded admins AND anyone granted manager access via Manage Access
 *      (primary role employee, accesses: ['manager']). UserStore's guard and
 *      bulk-import's guard actively disagreed with each other.
 *
 *   2. "Which employees can this manager see?"
 *      A manager's team is the UNION of two independent mechanisms — the
 *      durable users.manager_id column (set by the Assign Manager dropdown,
 *      individual creation, and bulk import) and Groups membership. Sites
 *      that consulted only one of them silently showed an empty or partial
 *      team; scoping assessment reports by Groups alone is exactly why a
 *      manager could not see the candidates assigned to them.
 *
 * Every manager-scoped read and write should route through here so those two
 * answers can never drift apart again.
 */
import UserStore from './UserStore.js';
import { Groups } from './DataStore.js';
import { canActAsManager } from './roleCapability.js';

// Re-exported so callers can get the predicate and the scope helpers from one
// place. The definition lives in roleCapability.js (no imports) so UserStore
// can use it too without an import cycle.
export { canActAsManager };

/**
 * The set of employee userIds this actor is allowed to see.
 *
 * - superadmin / admin → everyone in their company ('default' stays open for
 *   single-tenant installs).
 * - manager → union of durable manager_id assignments and owned Groups.
 * - anyone else → just themselves.
 *
 * Returns a Set of userId strings. Never throws — a failure in one source
 * degrades to the other rather than blanking a manager's whole team.
 */
export async function getVisibleEmployeeIds(actor) {
  if (!actor) return new Set();
  const actorId = actor.userId || actor.id;
  const company = actor.companyId || 'default';
  const isAdmin = actor.role === 'admin' || actor.role === 'superadmin'
    || actor.primaryRole === 'admin' || actor.primaryRole === 'superadmin';

  if (isAdmin) {
    try {
      const all = await UserStore.getAllUsers({});
      return new Set(
        all
          .filter(u => company === 'default' || (u.companyId || 'default') === company)
          .map(u => u.userId || u.id)
      );
    } catch (e) {
      console.warn('[ManagerScope] admin scope lookup failed:', e.message);
      return new Set();
    }
  }

  if (!canActAsManager(actor)) return new Set(actorId ? [actorId] : []);

  const ids = new Set();

  // Source 1: durable users.manager_id (+ the local file mirror), which is
  // what the Assign Manager dropdown and bulk import actually write.
  try {
    const direct = await UserStore.getManagerEmployees(actorId);
    (direct || []).forEach(e => { if (e) ids.add(e.userId || e.id); });
  } catch (e) {
    console.warn('[ManagerScope] direct-report lookup failed:', e.message);
  }

  // Source 2: Groups this actor manages.
  try {
    const allGroups = await Groups.getAll();
    (allGroups || [])
      .filter(g => g.managerId === actorId && (g.companyId || 'default') === company)
      .flatMap(g => g.employeeIds || [])
      .forEach(id => { if (id) ids.add(id); });
  } catch (e) {
    console.warn('[ManagerScope] group lookup failed:', e.message);
  }

  return ids;
}

/**
 * Link one employee to one manager, writing BOTH the durable column and the
 * group/file mirror. `updateUser` is authoritative and must succeed;
 * `assignEmployeesToManager` maintains the legacy mirror and is best-effort,
 * because on an ephemeral filesystem host that mirror can vanish at any time.
 *
 * Returns { ok, reason } instead of throwing so bulk callers can report a
 * per-row outcome without aborting the whole batch.
 */
export async function linkEmployeeToManager({ employeeUserId, managerUserId, actorUserId }) {
  if (!employeeUserId || !managerUserId) {
    return { ok: false, reason: 'employeeUserId and managerUserId are required' };
  }
  if (employeeUserId === managerUserId) {
    return { ok: false, reason: 'A user cannot be their own manager' };
  }
  try {
    await UserStore.updateUser(employeeUserId, { managerId: managerUserId });
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  try {
    await UserStore.assignEmployeesToManager(managerUserId, [employeeUserId], actorUserId);
  } catch (e) {
    // Mirror-only failure: the authoritative link above already landed.
    console.warn(`[ManagerScope] mirror update failed for ${employeeUserId}:`, e.message);
  }
  return { ok: true, reason: null };
}

/**
 * Batch-resolve manager emails to user records, so a bulk import validates
 * every referenced manager in one pass instead of one lookup per row.
 * Returns a Map of lowercased email → user, containing only users who
 * actually hold manager capability.
 */
export async function resolveManagersByEmail(emails = []) {
  const wanted = new Set(
    emails.map(e => String(e || '').toLowerCase().trim()).filter(Boolean)
  );
  const out = new Map();
  if (wanted.size === 0) return out;
  try {
    const all = await UserStore.getAllUsers({});
    for (const u of all) {
      const key = String(u.email || '').toLowerCase().trim();
      if (wanted.has(key) && canActAsManager(u)) out.set(key, u);
    }
  } catch (e) {
    console.warn('[ManagerScope] manager email resolve failed:', e.message);
  }
  return out;
}
