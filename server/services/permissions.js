/**
 * permissions.js
 *
 * Granular feature-permission layer, separate from the role/accesses system
 * in roleCapability.js. Roles answer "what kind of user is this"; permissions
 * answer "which specific platform capabilities has an admin turned on for
 * this specific person." Deliberately dependency-free apart from
 * roleCapability.js (itself dependency-free) so this file can be imported by
 * auth.js, UserStore.js, and any route file without an import cycle.
 */
import { ALL_VALID_ROLES } from './roleCapability.js';

export const PERMISSION_CATALOG = [
  { key: 'users.create',         label: 'Add User',                    description: 'Create individual users and run bulk import', category: 'Users' },
  { key: 'users.view_all',       label: 'View All Employees',          description: 'See the full employee/user list',              category: 'Users' },
  { key: 'modules.create',       label: 'Create Modules',              description: 'Create new training modules',                  category: 'Modules' },
  { key: 'modules.edit',         label: 'Edit Modules',                description: 'Edit existing modules',                        category: 'Modules' },
  { key: 'modules.delete',       label: 'Delete Modules',              description: 'Delete modules',                               category: 'Modules' },
  { key: 'modules.generate',     label: 'Auto-Generate Modules',       description: 'Use AI auto-generation to create modules',     category: 'Modules' },
  { key: 'assessments.create',   label: 'Create Assessments',          description: 'Create new assessments',                       category: 'Assessments' },
  { key: 'assessments.generate', label: 'Generate Assessment Content', description: 'Generate assessment/question content via AI', category: 'Assessments' },
  { key: 'reports.export',       label: 'Export Reports',              description: 'Bulk/filtered assessment report export',      category: 'Reports' },
  { key: 'reports.download',     label: 'Download Reports',            description: "Download another user's individual report",  category: 'Reports' },
  { key: 'roles.create',         label: 'Add Job Role',                description: 'Add a role to the Job Library',                category: 'Job Library' },
  { key: 'roles.edit',           label: 'Edit Job Role',               description: 'Edit or delete a Job Library role',            category: 'Job Library' },
  { key: 'roles.import',         label: 'Import Job Roles',            description: 'Bulk import roles into the Job Library',      category: 'Job Library' },
  { key: 'questions.generate',   label: 'Generate Questions',          description: 'Generate questions from a Job Library role',  category: 'Questions' },
  { key: 'questions.edit',       label: 'Edit Questions',              description: 'View, add, edit, delete questions',            category: 'Questions' },
];
export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.map(p => p.key);

// admin/manager defaults are a strict superset of every route these keys
// gate, so shipping this never removes access an existing admin/manager
// already has today — see the route table in the Permissions plan.
export const ROLE_DEFAULT_PERMISSIONS = {
  admin: [...ALL_PERMISSION_KEYS],
  manager: ['users.create', 'users.view_all', 'modules.create', 'modules.edit', 'modules.delete', 'modules.generate', 'assessments.create', 'assessments.generate', 'reports.export', 'reports.download', 'questions.edit'],
  leadership: ['users.view_all', 'reports.export', 'reports.download'],
  'senior-training-development-manager': ['modules.create', 'modules.edit', 'modules.generate', 'assessments.create', 'assessments.generate', 'questions.generate', 'questions.edit', 'reports.export'],
  'senior-quality-manager': ['assessments.create', 'assessments.generate', 'questions.edit', 'reports.export', 'reports.download'],
  'senior-training-manager': ['modules.create', 'modules.edit', 'modules.generate', 'reports.export'],
  'senior-operations-manager': ['users.view_all', 'reports.export', 'reports.download'],
  'assistant-manager-ops': ['users.view_all', 'reports.download'],
  'assistant-manager-quality': ['assessments.create', 'questions.edit', 'reports.download'],
  'assistant-manager-training': ['modules.create', 'modules.edit', 'reports.download'],
  wfm: ['users.view_all', 'reports.export'],
  lead: ['users.view_all', 'reports.download'],
  trainer: ['modules.create', 'modules.edit', 'modules.generate', 'assessments.create'],
  'quality-analyst': ['assessments.create', 'assessments.generate', 'questions.edit', 'reports.export'],
  sme: ['questions.edit'],
  employee: [],
};
// Any role not explicitly listed above (e.g. a future new role) resolves to
// [] rather than undefined, so getEffectivePermissions never needs a
// null-guard and a forgotten role never silently inherits full access.
for (const role of ALL_VALID_ROLES) {
  if (!(role in ROLE_DEFAULT_PERMISSIONS)) ROLE_DEFAULT_PERMISSIONS[role] = [];
}

/**
 * Resolves a user's final permission set: role defaults, plus explicit
 * per-user grants, minus explicit per-user revokes. Superadmin always
 * bypasses to every permission, matching requireRole's superadmin bypass.
 */
export function getEffectivePermissions(user) {
  if (!user) return new Set();
  if (user.role === 'superadmin' || user.primaryRole === 'superadmin') {
    return new Set(ALL_PERMISSION_KEYS);
  }
  const defaults = ROLE_DEFAULT_PERMISSIONS[user.role] || ROLE_DEFAULT_PERMISSIONS[user.primaryRole] || [];
  const granted = user.permissions?.granted || [];
  const revoked = new Set(user.permissions?.revoked || []);
  const resolved = new Set([...defaults, ...granted]);
  for (const r of revoked) resolved.delete(r);
  return resolved;
}
