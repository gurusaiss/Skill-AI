/**
 * roleCapability.js
 *
 * Deliberately dependency-free. Role/access predicates are needed by the auth
 * middleware, by UserStore's data-layer guards, and by ManagerScope — and
 * those three already import each other in a chain (auth → UserStore), so
 * putting these predicates in any of them would create an import cycle.
 * Keeping them here, importing nothing, means every layer can share one
 * definition safely.
 */

/**
 * A manager/admin who has never had `accesses` explicitly set (the common
 * case) implicitly gets the standard role-switch options, so the
 * "Switch to X View" UI has something to offer. Must stay in sync with the
 * client mirror in UserManagement.jsx.
 */
export function getEffectiveAccesses(user) {
  const stored = user?.accesses || [];
  if (stored.length > 0) return stored;
  if (user?.role === 'manager') return ['employee'];
  if (user?.role === 'admin') return ['manager', 'employee'];
  return stored;
}

/**
 * True when `user` may act in a manager capacity — by primary role, by being
 * an admin, or by an explicitly granted 'manager' access.
 *
 * Testing `user.role === 'manager'` (the old pattern, still scattered around
 * before this) silently excluded admins and every user granted manager access
 * through Manage Access, which is why such users could not be picked as a
 * manager and why assignEmployeesToManager rejected them outright.
 */
export function canActAsManager(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.primaryRole === 'admin' || user.primaryRole === 'manager') return true;
  return getEffectiveAccesses(user).includes('manager');
}
