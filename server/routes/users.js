import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sanitizeText, sanitizeEmail, sanitizePhone, sanitizeId } from '../utils/sanitize.js';
import UserStore from '../services/UserStore.js';
import AuthService from '../services/AuthService.js';
import { v4 as uuidv4 } from 'uuid';
import { randomUUID } from 'crypto';
import EmailService from '../services/EmailService.js';
import { ActivationTokens, Assessments, RoleLibrary, GeneratedContent, Groups } from '../services/DataStore.js';
import { autoAssignPreAssessment } from '../services/AssessmentAutoAssign.js';
import { randomBytes } from 'crypto';
import { getGroups } from '../db/store.js';
import { buildTypeSequence } from '../services/QuestionMix.js';
import { canActAsManager, linkEmployeeToManager } from '../services/ManagerScope.js';

// ── Authorization helper: can `actor` (req.user) access `target` user record? ──
// Rules (additive, preserves existing single-tenant 'default' behavior):
//  • The user themselves → always.
//  • superadmin → always.
//  • admin/manager → only within the SAME company (company 'default' stays open
//    for single-tenant installs, matching existing list-endpoint behavior).
//  • everyone else → denied.
function canAccessUser(actor, target) {
  if (!actor || !target) return false;
  const actorId = actor.userId || actor.id;
  const targetId = target.userId || target.id;
  if (actorId && targetId && actorId === targetId) return true;
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin' || actor.role === 'manager') {
    const actorCompany = actor.companyId || 'default';
    const targetCompany = target.companyId || 'default';
    // Single-tenant default installs: admins in 'default' retain full visibility.
    if (actorCompany === 'default') return true;
    return actorCompany === targetCompany;
  }
  return false;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) s += chars[bytes[i] % chars.length];
  return `Skill@${s}`;
}

// autoAssignPreAssessment moved to services/AssessmentAutoAssign.js (shared
// with auth.js's self-registration flow) — see that file for the full
// "always assign the complete approved bank, never a hardcoded subset" logic.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../data/uploads/jd');
const IMPORT_DIR  = path.join(__dirname, '../data/uploads/import');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });
if (!existsSync(IMPORT_DIR))  mkdirSync(IMPORT_DIR,  { recursive: true });

const router = express.Router();

// ── Multer setup for import file uploads ─────────────────────────────────────
const importStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMPORT_DIR),
  filename: (_req, file, cb) => {
    cb(null, `import-${Date.now()}-${uuidv4().slice(0, 6)}${path.extname(file.originalname)}`);
  },
});
const importUpload = multer({
  storage: importStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Parse import sheet → array of row objects ─────────────────────────────────
async function parseImportFile(filePath) {
  const XLSX = await import('xlsx');
  const wb = XLSX.default.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.default.utils.sheet_to_json(ws, { defval: '' });
  return rows;
}

// Normalise column name variants to canonical keys
const COL_MAP = {
  name: 'name', full_name: 'name', fullname: 'name', 'full name': 'name',
  email: 'email', email_address: 'email', 'email address': 'email',
  role: 'role', user_role: 'role', system_role: 'role', 'system role': 'role', 'system_role': 'role',
  employee_id: 'employeeId', 'employee id': 'employeeId', employeeid: 'employeeId', emp_id: 'employeeId',
  job_role: 'jobRole', jobrole: 'jobRole', 'job role': 'jobRole', position: 'jobRole', title: 'jobRole',
  job_role_1: 'jobRole', 'job role 1': 'jobRole', jobrole1: 'jobRole',
  job_role_2: 'jobRole2', 'job role 2': 'jobRole2', jobrole2: 'jobRole2',
  job_role_3: 'jobRole3', 'job role 3': 'jobRole3', jobrole3: 'jobRole3',
  job_role_4: 'jobRole4', 'job role 4': 'jobRole4', jobrole4: 'jobRole4',
  department: 'department', dept: 'department',
  job_description: 'jobDescription', 'job description': 'jobDescription', jd: 'jobDescription',
  company_name: 'companyName', 'company name': 'companyName', company: 'companyName',
  password: 'password', temp_password: 'password', 'temp password': 'password',
  phone: 'phone', phone_number: 'phone', 'phone number': 'phone',
  status: 'status',
  manager_email: 'managerEmail', 'manager email': 'managerEmail', manageremail: 'managerEmail',
  reports_to: 'managerEmail', 'reports to': 'managerEmail', reportsto: 'managerEmail',
  manager_name: 'managerName', 'manager name': 'managerName', managername: 'managerName',
  manager: 'managerName',
};

function normaliseRow(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const canon = COL_MAP[k.toLowerCase().trim()];
    if (canon) out[canon] = String(v ?? '').trim();
  }
  return out;
}

// A template's `#` instruction lines parse as data rows. They used to survive
// only because unmapped columns are dropped, but they still surfaced as bogus
// "name required" error rows in the preview.
function isCommentRow(raw) {
  const first = Object.values(raw || {})[0];
  return String(first ?? '').trim().startsWith('#');
}

const IMPORT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMPORT_ROLES = ['employee', 'manager', 'admin'];

/**
 * The single validator used by BOTH /bulk-import/preview and /bulk-import.
 *
 * Previously each endpoint had its own rules, so a row could show as "valid"
 * in the preview and then be silently skipped on import. Any change to import
 * rules must happen here so the two can never drift apart again.
 *
 * `ctx.managerIndex` is a Map of lowercased email → user for every existing
 * user, and `ctx.batchManagers` is a Set of lowercased emails belonging to
 * manager/admin rows appearing anywhere in the same file — so a single file
 * can create a manager and their reports together.
 */
function validateImportRow(row, ctx) {
  const { existingEmails, existingEmpIds, seenInBatch, managerIndex, batchManagers } = ctx;
  const errors = [];
  const warnings = [];

  const emailLc = row.email ? row.email.toLowerCase() : '';
  const isExisting = Boolean(emailLc && existingEmails.has(emailLc));

  if (!row.name) errors.push('name required');
  if (!row.email) errors.push('email required');
  else if (!IMPORT_EMAIL_RE.test(row.email)) errors.push('invalid email format');
  else if (seenInBatch.has(emailLc)) errors.push('duplicate email in file');
  else seenInBatch.add(emailLc);

  if (row.employeeId && existingEmpIds.has(row.employeeId) && !isExisting) {
    errors.push('employee ID already exists');
  }
  if (row.role && !IMPORT_ROLES.includes(row.role.toLowerCase())) {
    errors.push(`invalid role "${row.role}" — use employee/manager/admin`);
  }

  // Manager linkage is mandatory for employees — every employee must have a
  // manager, which is the whole point of collecting these columns. Manager and
  // admin rows are exempt because they sit at the top of the chain (requiring
  // it there would make importing your first manager impossible).
  const effectiveRole = (row.role || 'employee').toLowerCase();
  if (effectiveRole === 'employee') {
    if (!row.managerName) errors.push('manager_name required for employee rows');
    if (!row.managerEmail) errors.push('manager_email required for employee rows');
  }

  if (row.managerEmail) {
    if (!IMPORT_EMAIL_RE.test(row.managerEmail)) {
      errors.push('invalid manager_email format');
    } else {
      const mgrLc = row.managerEmail.toLowerCase();
      if (mgrLc === emailLc) {
        errors.push('manager_email cannot be the user\'s own email');
      } else {
        const existingMgr = managerIndex.get(mgrLc);
        const inBatch = batchManagers.has(mgrLc);
        if (!existingMgr && !inBatch) {
          errors.push(`manager_email "${row.managerEmail}" not found — add that manager first or include them in this file`);
        } else if (existingMgr && !canActAsManager(existingMgr)) {
          errors.push(`"${row.managerEmail}" exists but is not a manager`);
        } else if (existingMgr && row.managerName) {
          // The email is the key; a name mismatch is informational only, so a
          // typo in a display name never blocks an otherwise-correct import.
          const a = row.managerName.toLowerCase().replace(/\s+/g, ' ').trim();
          const b = String(existingMgr.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (a && b && a !== b) warnings.push(`manager_name "${row.managerName}" does not match "${existingMgr.name}" on record`);
        }
      }
    }
  }

  return { errors, warnings, isExisting };
}

/**
 * Builds the lookup context validateImportRow needs, in one pass over the
 * file plus one user fetch — so validation costs the same whether the file
 * has 5 rows or 5000.
 */
async function buildImportContext(rawRows) {
  const allUsers = await UserStore.getAllUsers({});
  const managerIndex = new Map();
  for (const u of allUsers) {
    const key = String(u.email || '').toLowerCase().trim();
    if (key) managerIndex.set(key, u);
  }
  // Emails of manager/admin rows anywhere in this same file, so a file that
  // creates a manager and then their reports validates in one pass regardless
  // of row order.
  const batchManagers = new Set();
  for (const raw of rawRows) {
    if (isCommentRow(raw)) continue;
    const r = normaliseRow(raw);
    const role = (r.role || 'employee').toLowerCase();
    if ((role === 'manager' || role === 'admin') && r.email) {
      batchManagers.add(r.email.toLowerCase());
    }
  }
  return {
    allUsers,
    managerIndex,
    existingEmails: new Set(managerIndex.keys()),
    existingEmpIds: new Set(allUsers.map(u => u.employeeId).filter(Boolean)),
    seenInBatch: new Set(),
    batchManagers,
  };
}

// ── Multer setup for JD file uploads ─────────────────────────────────────────
const jdStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4().slice(0, 8)}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});
const jdUpload = multer({
  storage: jdStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── File MIME magic-number check (blocklist approach) ─────────────────────────
// Only blocks clearly dangerous types (executables, scripts). Never rejects
// legitimate document formats like PDF, DOCX, CSV, PNG — even if file-type
// cannot identify them (returns null for plain text, which is fine).
const BLOCKED_MIMES = new Set([
  'application/x-executable',
  'application/x-msdownload',       // Windows PE / DLL
  'application/x-sh',
  'application/x-shellscript',
  'application/javascript',
  'text/javascript',
  'application/x-php',
  'text/x-php',
  'application/x-httpd-php',
  'application/x-perl',
  'application/x-python',
  'application/x-python-code',
  'application/x-ruby',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/x-elf',
]);

async function checkFileMime(filePath) {
  try {
    const { fileTypeFromFile } = await import('file-type');
    const ft = await fileTypeFromFile(filePath);
    if (ft && BLOCKED_MIMES.has(ft.mime)) {
      return { blocked: true, mime: ft.mime };
    }
  } catch {
    // file-type unavailable or unreadable — skip check silently
  }
  return { blocked: false };
}

// ── Sanitize user for response (include all profile fields) ───────────────────
// `managerIndex` (optional) is a Map<userId, {name, email}> supplied by list
// handlers that have already fetched every user, so the manager's NAME can be
// resolved with zero extra queries and no N+1. Previously only `managerId`
// was returned, which is why no screen could show a manager's name without a
// second round-trip (and the one place that tried was reading the wrong field).
function sanitizeUser(user, managerIndex) {
  const mgr = user.managerId && managerIndex ? managerIndex.get(user.managerId) : null;
  return {
    userId: user.userId || user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLogin: user.lastLogin,
    managerId: user.managerId || null,
    managerName: mgr?.name || null,
    managerEmail: mgr?.email || null,
    learningUUID: user.learningUUID || null,
    // Extended profile
    jobRole: user.jobRole || '',
    department: user.department || '',
    jobDescription: user.jobDescription || '',
    jobDescriptionFile: user.jobDescriptionFile || null,
    onboardingComplete: user.onboardingComplete || false,
    companyName: user.companyName || '',
    employeeId: user.employeeId || '',
    phone: user.phone || '',
    status: user.status || 'active',
    jdSkills: user.jdSkills || [],
    jdSourceUrl: user.jdSourceUrl || '',
    jdSourceType: user.jdSourceType || 'text',
    accesses: user.accesses || [],
    additionalJobRoles: user.additionalJobRoles || [],
  };
}

/**
 * GET /api/users/role-counts
 * Returns count per unique jobRole for employees in the same company (admin/manager)
 */
router.get('/role-counts', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const companyId = req.user.companyId || 'default';
    const allUsers = await UserStore.getAllUsers({ role: 'employee' });
    const companyEmployees = allUsers.filter(u => (u.companyId || 'default') === companyId);

    const counts = {};
    for (const u of companyEmployees) {
      const jobRole = (u.jobRole || '').trim();
      if (!jobRole) continue;
      counts[jobRole] = (counts[jobRole] || 0) + 1;
    }

    res.json({ success: true, data: counts, error: null });
  } catch (error) {
    console.error('[User Routes] Role counts error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get role counts' } });
  }
});

/**
 * GET /api/users
 * Get all users (admin/manager)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const { role, emailVerified } = req.query;
    const filters = {};
    if (role) filters.role = role;
    if (emailVerified !== undefined) filters.emailVerified = emailVerified === 'true';
    if (isManager && !filters.role) filters.role = 'employee';

    const allUsers = await UserStore.getAllUsers(filters);
    // Company isolation: both admin and manager only see their own company's users
    const myCompany = req.user.companyId || 'default';
    let users = (isAdmin || isManager)
      ? allUsers.filter(u => (u.companyId || 'default') === myCompany)
      : allUsers;

    // Manager visibility: show employees from ALL sources — groups, direct assignment, or managerId field
    if (isManager) {
      try {
        const visibleIds = new Set();

        // Source 1: employees in manager's Groups (DataStore/Supabase)
        try {
          const allGroups = await Groups.getAll();
          const managerGroups = allGroups.filter(g =>
            g.managerId === req.user.userId &&
            (g.companyId || 'default') === (req.user.companyId || 'default')
          );
          managerGroups.flatMap(g => g.employeeIds || []).forEach(id => visibleIds.add(id));
        } catch (_) {}

        // Source 2: employees assigned via UserStore manager-employee assignments
        try {
          const assigned = await UserStore.getManagerEmployees(req.user.userId);
          (assigned || []).forEach(emp => visibleIds.add(emp.userId || emp.id));
        } catch (_) {}

        // Source 3: employees whose managerId field points directly to this manager
        users
          .filter(u => u.managerId === req.user.userId || u.manager_id === req.user.userId)
          .forEach(u => visibleIds.add(u.userId));

        if (visibleIds.size > 0) {
          users = users.filter(u => visibleIds.has(u.userId));
        } else {
          // No employees found via any source — return empty (not all company employees)
          users = [];
        }
      } catch (groupErr) {
        console.warn('[User Routes] Manager employee filtering failed:', groupErr.message);
        users = [];
      }
    }

    // Built from the full company list already fetched above, so every row
    // carries its manager's name without any extra query per user.
    const managerIndex = new Map(
      allUsers.map(u => [u.userId || u.id, { name: u.name, email: u.email }])
    );
    const sanitizedUsers = users.map(u => sanitizeUser(u, managerIndex));

    res.json({ success: true, data: { users: sanitizedUsers, count: sanitizedUsers.length }, error: null });
  } catch (error) {
    console.error('[User Routes] Get all users error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get users' } });
  }
});

/**
 * POST /api/users
 * Admin/Manager creates a new user directly (bypasses email signup)
 */
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const raw = req.body;
    const email       = sanitizeEmail(raw.email);
    const name        = sanitizeText(raw.name, 200);
    const role        = raw.role;
    const jobRole     = sanitizeText(raw.jobRole, 200);
    const department  = sanitizeText(raw.department, 200);
    const jobDescription = sanitizeText(raw.jobDescription, 5000);
    const companyName = sanitizeText(raw.companyName, 200);
    const password    = raw.password; // passwords must not be stripped
    const managerEmail = sanitizeEmail(raw.managerEmail || '');

    if (!email || !name) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_INPUT', message: 'Email and name are required' } });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_EMAIL', message: 'Invalid email format' } });
    }

    // Prevent duplicate
    const existing = await UserStore.getUserByEmail(email);
    if (existing) {
      return res.status(409).json({ success: false, data: null, error: { code: 'USER_EMAIL_EXISTS', message: 'Email already registered' } });
    }

    // Validate manager reference up-front (before creating the user) so a
    // bad manager email fails loudly instead of silently creating a broken
    // relationship — same validation the bulk-import path already applies.
    let managerRecord = null;
    let managerError = null;
    if (managerEmail) {
      managerRecord = await UserStore.getUserByEmail(managerEmail);
      if (!managerRecord || !['manager', 'admin'].includes(managerRecord.role)) {
        managerError = `Manager "${raw.managerEmail}" not found or not a manager role`;
        managerRecord = null;
      }
    }

    // Managers can only create employees
    const assignedRole = (req.user.role === 'manager') ? 'employee' : (role || 'employee');
    // Generate a real temporary password — admin can share it directly, and/or
    // share the activation link below. Either path forces a real password to be
    // set before normal login proceeds (see mustChangePassword).
    const tempPassword = generatePassword();
    const passwordHash = await AuthService.hashPassword(tempPassword);

    const user = await UserStore.createUser({
      email,
      passwordHash,
      name: name.trim(),
      role: assignedRole,
      emailVerified: true,
      onboardingComplete: false,
      jobRole: jobRole || '',
      department: department || '',
      jobDescription: jobDescription || '',
      companyName: companyName || '',
      companyId: req.user.companyId || 'default',
    });
    // Best-effort: mark forced-password-change (new optional column — must not
    // block user creation if the migration hasn't been applied yet).
    UserStore.updateUser(user.userId, { mustChangePassword: true }).catch(() => {});

    if (managerRecord) {
      try {
        await UserStore.updateUser(user.userId, { managerId: managerRecord.userId });
        await UserStore.assignEmployeesToManager(managerRecord.userId, [user.userId], req.user.userId).catch(() => {});
        user.managerId = managerRecord.userId;
      } catch (e) {
        managerError = e.message;
      }
    }

    await UserStore.logAuthEvent('user_created_by_admin', user.userId, {
      createdBy: req.user.userId,
      createdByRole: req.user.role,
      ipAddress: req.ip,
    });

    // Create activation token and attempt email — 25s timeout to survive SMTP retries
    let emailSent = false;
    let emailError = null;
    let activationUrl = null;
    try {
      const tokenId = uuidv4();
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await ActivationTokens.create({ id: tokenId, userId: user.userId, email: user.email, expiresAt, used: false });
      const frontendUrl = process.env.FRONTEND_URL || 'https://skillforge-swart-mu.vercel.app';
      activationUrl = `${frontendUrl}/auth/activate?token=${tokenId}`;
      const timeout = new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'timeout' }), 25000));
      const result = await Promise.race([
        EmailService.sendInvitationEmail(user.email, {
          name: user.name,
          role: user.role,
          companyName: user.companyName || req.user.companyName || 'SkillForge AI',
          activationUrl,
          fromEmail: req.user.email,
          fromName: req.user.name || user.companyName || 'SkillForge AI',
        }),
        timeout,
      ]);
      emailSent = result?.success === true;
      if (!emailSent) {
        emailError = result?.error || 'Unknown error';
        console.warn(`[users] Invitation email to ${user.email} failed: ${emailError}`);
      }
    } catch (emailErr) {
      emailError = emailErr.message;
      console.warn('[users] Invitation email failed:', emailErr.message);
    }

    // Auto-assign role-specific pre-assessment (non-blocking)
    if (user.jobRole) setImmediate(() => autoAssignPreAssessment(user));

    res.status(201).json({
      success: true,
      data: {
        ...sanitizeUser(user),
        emailSent,
        emailError,
        managerError,
        activationUrl,
        tempPassword,
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Create user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to create user' } });
  }
});

/**
 * POST /api/users/:userId/regenerate-password
 * Admin action: invalidate all existing credentials and issue a fresh temporary
 * password + activation link. Touches ONLY auth fields — no other user data
 * (progress, assessments, modules, reports, assignments) is modified.
 */
router.post('/:userId/regenerate-password', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const target = await UserStore.getUserById(req.params.userId);
    if (!target) return res.status(404).json({ success: false, error: 'User not found' });
    if (!canAccessUser(req.user, target)) return res.status(403).json({ success: false, error: 'Access denied' });

    const tempPassword = generatePassword();
    const passwordHash = await AuthService.hashPassword(tempPassword);
    // Critical path first (guaranteed-existing columns) — the new password must
    // take effect even if the optional mustChangePassword column isn't migrated yet.
    await UserStore.updateUser(target.userId, {
      passwordHash,
      // Clear any outstanding self-service reset token so the old one can't be used
      resetToken: null,
      resetTokenExpires: null,
    });
    UserStore.updateUser(target.userId, { mustChangePassword: true }).catch(() => {});

    // Invalidate previous activation tokens and issue a fresh one
    let activationUrl = null;
    try {
      const allTokens = await ActivationTokens.getAll?.() ?? [];
      await Promise.all((allTokens || []).filter(t => t.userId === target.userId && !t.used)
        .map(t => ActivationTokens.update?.(t.id, { used: true }).catch(() => {})));
      const tokenId = uuidv4();
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      await ActivationTokens.create({ id: tokenId, userId: target.userId, email: target.email, expiresAt, used: false });
      const frontendUrl = process.env.FRONTEND_URL || 'https://skillforge-swart-mu.vercel.app';
      activationUrl = `${frontendUrl}/auth/activate?token=${tokenId}`;
    } catch (e) {
      console.warn('[regenerate-password] Activation token issue failed:', e.message);
    }

    await UserStore.logAuthEvent('password_regenerated_by_admin', target.userId, {
      regeneratedBy: req.user.userId,
      regeneratedByRole: req.user.role,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { tempPassword, activationUrl } });
  } catch (e) {
    console.error('[regenerate-password]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/users/:userId
 * Get user by ID (self, admin, or manager of this user)
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    res.json({ success: true, data: sanitizeUser(user), error: null });
  } catch (error) {
    console.error('[User Routes] Get user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get user' } });
  }
});

/**
 * PUT /api/users/:userId
 * Update user profile — self can update own info; admin/manager can update all fields
 */
router.put('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Cannot update this user' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Cannot update this user' } });
    }

    const { name, email, role, status, jobRole, department, jobDescription, companyName, onboardingComplete } = req.body;
    const updates = {};

    // Name — anyone can update own name; admin/manager can update any
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_NAME', message: 'Name cannot be empty' } });
      updates.name = name.trim();
    }

    // Email — self or admin only
    if (email !== undefined && email !== user.email) {
      if (!isSelf && !isAdmin) return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Only admin can change email' } });
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_EMAIL', message: 'Invalid email format' } });
      const existingUser = await UserStore.getUserByEmail(email);
      if (existingUser && existingUser.userId !== userId) {
        return res.status(409).json({ success: false, data: null, error: { code: 'USER_EMAIL_EXISTS', message: 'Email already in use' } });
      }
      updates.email = email;
    }

    // Role — admin only
    if (role !== undefined && isAdmin) {
      const validRoles = ['admin', 'manager', 'employee'];
      if (validRoles.includes(role)) updates.role = role;
    }

    // Status — admin or manager only
    if (status !== undefined && (isAdmin || isManager)) {
      const validStatuses = ['active', 'inactive', 'blocked'];
      if (validStatuses.includes(status)) updates.status = status;
    }

    // Extended profile — admin or manager can set; self can set own
    if (jobRole !== undefined) updates.jobRole = jobRole;
    if (department !== undefined) updates.department = department;
    if (jobDescription !== undefined) updates.jobDescription = jobDescription; // no char limit
    if (companyName !== undefined) updates.companyName = companyName;
    if (onboardingComplete !== undefined && (isAdmin || isManager || isSelf)) {
      updates.onboardingComplete = !!onboardingComplete;
    }

    updates.updatedAt = new Date().toISOString();

    if (Object.keys(updates).length === 1 && updates.updatedAt) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_NO_UPDATES', message: 'No valid updates provided' } });
    }

    const updatedUser = await UserStore.updateUser(userId, updates);
    await UserStore.logAuthEvent('profile_updated', userId, { updates: Object.keys(updates), updatedBy: req.user.userId, ipAddress: req.ip });

    // Priority 6: Role changed → auto-assign role-tagged modules (non-blocking)
    if (updates.jobRole && updates.jobRole !== user.jobRole) {
      (async () => {
        try {
          const { RoleLibrary } = await import('../services/DataStore.js');
          const db = await import('../db/store.js');
          const roleMatch = await RoleLibrary.findByName(updates.jobRole, updatedUser.companyId || 'default');
          if (!roleMatch) return;
          const allModules = await db.getModules();
          const roleModules = allModules.filter(m =>
            (m.targetRoles || []).some(r => r.toLowerCase() === updates.jobRole.toLowerCase())
          );
          for (const mod of roleModules) {
            try {
              await db.createAssignment({
                employeeId: userId, assignableId: mod.id, assignable_type: 'module',
                type: 'module', title: mod.title, module_name: mod.title,
                status: 'assigned', progress: 0,
                companyId: updatedUser.companyId || 'default',
                assignedBy: req.user.userId, assignedByRole: req.user.role,
                autoAssigned: true, autoAssignedReason: `Role: ${updates.jobRole}`,
              });
            } catch {}
          }
        } catch (e) { console.warn('[auto-assign modules] role change trigger:', e.message); }
      })();
    }

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Update user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to update user' } });
  }
});

/**
 * POST /api/users/:userId/jd-upload
 * Upload JD file (PDF, DOCX, TXT, etc.) — admin/manager or self
 * Replaces any previous JD for this user.
 * Extracts full text + skills from file, stores in DB, then deletes the file.
 */
router.post('/:userId/jd-upload', authenticate, jdUpload.single('jd'), async (req, res) => {
  const uploadedPath = req.file?.path;
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: admin/manager may only touch users in their own company.
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, data: null, error: { code: 'NO_FILE', message: 'No file uploaded' } });
    }

    // MIME magic-number check — blocks executables/scripts disguised as documents
    const mimeCheck = await checkFileMime(req.file.path);
    if (mimeCheck.blocked) {
      return res.status(400).json({ success: false, data: null, error: { code: 'FILE_TYPE_BLOCKED', message: 'File type not allowed' } });
    }

    // Extract full text from the uploaded file — no character limit
    const { parseJDFile, extractSkillsFromJDText } = await import('../utils/parseJDFile.js');
    const extractedText = await parseJDFile(req.file.path, req.file.originalname);

    if (!extractedText || extractedText.length < 20) {
      return res.status(422).json({ success: false, data: null, error: { code: 'JD_EMPTY', message: 'Could not extract text from this file. Try PDF, DOCX, or TXT.' } });
    }

    const skills = extractSkillsFromJDText(extractedText);

    // Persist extracted text + skills; keep metadata (name/size) but clear file path
    const updatedUser = await UserStore.updateUser(userId, {
      jobDescription: extractedText,          // canonical text used everywhere
      jobDescriptionFile: {                   // metadata only — path cleared
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        uploadedAt: new Date().toISOString(),
        path: null,                           // file is deleted below
      },
      jdSkills: skills,
      jdSourceType: 'file',
      jdSourceUrl: '',
      updatedAt: new Date().toISOString(),
    });

    await UserStore.logAuthEvent('jd_uploaded', userId, {
      uploadedBy: req.user.userId,
      fileName: req.file.originalname,
      extractedChars: extractedText.length,
      skillsFound: skills.length,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        extractedChars: extractedText.length,
        skillsFound: skills,
        jdSourceType: 'file',
        user: sanitizeUser(updatedUser),
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] JD upload error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'UPLOAD_ERROR', message: 'File upload failed. Please try again.' } });
  } finally {
    // Always delete the uploaded file — text is now stored in DB
    if (uploadedPath) { try { unlinkSync(uploadedPath); } catch {} }
  }
});

/**
 * POST /api/users/:userId/jd-url
 * Fetch JD from a public URL (Google Drive, OneDrive, Dropbox, direct link).
 * Extracts text + skills, stores in DB. No file is kept.
 */
router.post('/:userId/jd-url', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: admin/manager may only touch users in their own company.
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const { url } = req.body;
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, data: null, error: { code: 'NO_URL', message: 'URL is required' } });
    }

    // Basic URL validation
    let parsed;
    try { parsed = new URL(url.trim()); } catch {
      return res.status(400).json({ success: false, data: null, error: { code: 'INVALID_URL', message: 'Invalid URL format' } });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ success: false, data: null, error: { code: 'INVALID_URL', message: 'Only http/https URLs are supported' } });
    }

    const { fetchJDFromUrl } = await import('../utils/fetchJDUrl.js');
    const { extractSkillsFromJDText } = await import('../utils/parseJDFile.js');

    const { text: extractedText, source } = await fetchJDFromUrl(url.trim());
    const skills = extractSkillsFromJDText(extractedText);

    const updatedUser = await UserStore.updateUser(userId, {
      jobDescription: extractedText,
      jobDescriptionFile: null,               // no file — URL source
      jdSkills: skills,
      jdSourceUrl: url.trim(),
      jdSourceType: 'url',
      updatedAt: new Date().toISOString(),
    });

    await UserStore.logAuthEvent('jd_url_saved', userId, {
      savedBy: req.user.userId,
      sourceUrl: url.trim(),
      source,
      extractedChars: extractedText.length,
      skillsFound: skills.length,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        extractedChars: extractedText.length,
        skillsFound: skills,
        jdSourceType: 'url',
        jdSourceUrl: url.trim(),
        user: sanitizeUser(updatedUser),
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] JD URL error:', error.message);
    res.status(422).json({ success: false, data: null, error: { code: 'JD_URL_ERROR', message: error.message } });
  }
});

/**
 * GET /api/users/:userId/jd
 * Get the JD text + file info for a user (self, admin, or manager)
 */
router.get('/:userId/jd', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';

    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: admin/manager may only view JD info for users in their own company.
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
    }

    res.json({
      success: true,
      data: {
        jobRole: user.jobRole || '',
        jobDescription: user.jobDescription || '',
        jobDescriptionFile: user.jobDescriptionFile || null,
        hasJD: !!(user.jobDescription || user.jobDescriptionFile),
      },
      error: null,
    });
  } catch (error) {
    console.error('[User Routes] Get JD error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get JD' } });
  }
});

/**
 * POST /api/users/:userId/onboarding
 * Complete onboarding step 2 for employee self-signup
 * Accepts: name, jobRole, department, companyName
 */
router.post('/:userId/onboarding', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Can only complete own onboarding' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    if (user.onboardingComplete) {
      return res.json({ success: true, data: sanitizeUser(user), error: null }); // idempotent
    }

    const { name, jobRole, department, companyName } = req.body;
    if (!name || !jobRole) {
      return res.status(400).json({ success: false, data: null, error: { code: 'ONBOARDING_INVALID', message: 'Name and job role are required' } });
    }

    const updatedUser = await UserStore.updateUser(userId, {
      name: name.trim(),
      jobRole: jobRole.trim(),
      department: (department || '').trim(),
      companyName: (companyName || '').trim(),
      onboardingComplete: true,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Onboarding error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'ONBOARDING_ERROR', message: 'Failed to complete onboarding' } });
  }
});

/**
 * DELETE /api/users/:userId
 * Delete user (admin only)
 */
router.delete('/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId === userId) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_CANNOT_DELETE_SELF', message: 'You cannot delete your own account' } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: admin can only delete users in their own company
    if (req.user.role === 'admin' && req.user.companyId !== 'default' && (user.companyId || 'default') !== req.user.companyId) {
      return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Cannot delete users from other companies' } });
    }

    await UserStore.deleteUser(userId);
    await UserStore.logAuthEvent('user_deleted', userId, { deletedBy: req.user.userId, deletedUser: { email: user.email, role: user.role }, ipAddress: req.ip });

    res.json({ success: true, data: { message: 'User deleted successfully' }, error: null });
  } catch (error) {
    console.error('[User Routes] Delete user error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to delete user' } });
  }
});

/**
 * POST /api/users/:userId/resend-invite
 * Resend activation email to a user (admin/manager only)
 */
router.post('/:userId/resend-invite', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const user = await UserStore.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    // Company isolation: an admin/manager must not mint an activation token for
    // a user outside their own company (the token grants full account takeover).
    if (!canAccessUser(req.user, user)) return res.status(403).json({ success: false, error: 'Access denied' });

    const tokenId = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    await ActivationTokens.create({ id: tokenId, userId: user.userId, email: user.email, expiresAt, used: false });
    const frontendUrl = process.env.FRONTEND_URL || 'https://skillforge-swart-mu.vercel.app';
    const activationUrl = `${frontendUrl}/auth/activate?token=${tokenId}`;

    const timeout = new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'timeout' }), 25000));
    const result = await Promise.race([
      EmailService.sendInvitationEmail(user.email, {
        name: user.name,
        role: user.role,
        companyName: user.companyName || 'SkillForge AI',
        activationUrl,
        fromEmail: req.user.email,
        fromName: req.user.name || 'SkillForge AI',
      }),
      timeout,
    ]);

    const emailSent = result?.success === true;
    res.json({ success: true, data: { emailSent, emailError: emailSent ? null : result?.error, activationUrl } });
  } catch (e) {
    console.error('[resend-invite]', e.message);
    res.status(500).json({ success: false, error: 'Failed to resend invitation' });
  }
});

/**
 * PUT /api/users/:userId/role
 * Update user role (admin only)
 */
router.put('/:userId/role', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const validRoles = ['admin', 'manager', 'employee', 'trainer', 'leadership'];

    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ success: false, data: null, error: { code: 'USER_INVALID_ROLE', message: `Role must be one of: ${validRoles.join(', ')}` } });
    }

    const user = await UserStore.getUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, data: null, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    // Company isolation: an admin must not change the role of a user in another company.
    if (!canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const oldRole = user.role;
    const updatedUser = await UserStore.updateUserRole(userId, role);
    await UserStore.logAuthEvent('role_changed', userId, { changedBy: req.user.userId, oldRole, newRole: role, ipAddress: req.ip });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (error) {
    console.error('[User Routes] Update role error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to update role' } });
  }
});

/**
 * PUT /api/users/:userId/accesses
 * Grant/revoke additional platform accesses (admin only).
 * Body: { accesses: ['manager', 'trainer'] }
 */
router.put('/:userId/accesses', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { accesses } = req.body;
    // 'employee' must be explicitly grantable/revocable like the others —
    // it was previously excluded here, so once an admin granted ANY access
    // (e.g. 'trainer'), the implicit default employee-view access a
    // manager/admin gets when accesses is empty (see getEffectiveAccesses in
    // middleware/auth.js) was silently and permanently lost with no way to
    // restore it through this endpoint.
    const validAccesses = ['admin', 'manager', 'employee', 'trainer'];

    if (!Array.isArray(accesses)) {
      return res.status(400).json({ success: false, data: null, error: 'accesses must be an array' });
    }
    const filtered = accesses.filter(a => validAccesses.includes(a));

    const user = await UserStore.getUserById(userId);
    if (!user) return res.status(404).json({ success: false, data: null, error: 'User not found' });

    // Admins in the same company only
    const myCompany = req.user.companyId || 'default';
    if ((user.companyId || 'default') !== myCompany) {
      return res.status(403).json({ success: false, data: null, error: 'Cannot manage users from another company' });
    }

    const updatedUser = await UserStore.updateUser(userId, { accesses: filtered });
    await UserStore.logAuthEvent('accesses_changed', userId, { changedBy: req.user.userId, accesses: filtered, ipAddress: req.ip });

    res.json({ success: true, data: sanitizeUser(updatedUser), error: null });
  } catch (e) {
    console.error('[User Routes] Update accesses error:', e.message);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/users/:userId/assignments
 * Get user's assignments
 */
router.get('/:userId/assignments', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;

    if (!isSelf) {
      const target = await UserStore.getUserById(userId);
      if (!canAccessUser(req.user, target)) {
        // Managers outside the same company still allowed if they directly manage this user
        const managers = await UserStore.getEmployeeManagers(userId);
        const isThisManager = managers.some(m => m.userId === req.user.userId);
        if (!isThisManager) return res.status(403).json({ success: false, data: null, error: { code: 'AUTH_FORBIDDEN', message: 'Access denied' } });
      }
    }

    const assignments = await UserStore.getAssignments({ user_id: userId });
    res.json({ success: true, data: { assignments, count: assignments.length }, error: null });
  } catch (error) {
    console.error('[User Routes] Get assignments error:', error.message);
    res.status(500).json({ success: false, data: null, error: { code: 'USER_ERROR', message: 'Failed to get assignments' } });
  }
});

/**
 * GET /api/users/:userId/jd-file
 * Download the uploaded JD file for a user
 */
router.get('/:userId/jd-file', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const isSelf = req.user.userId === userId;
    const isAdmin = req.user.role === 'admin';
    const isManager = req.user.role === 'manager';
    if (!isSelf && !isAdmin && !isManager) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const user = await UserStore.getUserById(userId);
    // Company isolation: admin/manager may only download JD files for users in their own company.
    if (user && !canAccessUser(req.user, user)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (!user?.jobDescriptionFile) {
      return res.status(404).json({ success: false, error: 'No JD file uploaded' });
    }

    const filePath = user.jobDescriptionFile.path || user.jobDescriptionFile.storagePath;
    if (!filePath) return res.status(404).json({ success: false, error: 'File path not found' });

    if (!existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on disk' });
    }

    res.download(filePath, user.jobDescriptionFile.name || 'jd-file', (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ success: false, error: 'Download failed' });
      }
    });
  } catch (error) {
    console.error('[User Routes] JD file download error:', error.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Download failed' });
  }
});

/**
 * GET /api/users/bulk-import/template
 * A real .xlsx template with a second Instructions sheet. Replaces a raw CSV
 * blob whose `#` guidance lines parsed as data rows, and carries the
 * role-conditional mandatory-field rules where an admin will actually read
 * them. Reuses the same SheetJS path already proven by the credential export.
 */
router.get('/bulk-import/template', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const XLSX = await import('xlsx');
    const headers = [
      'name', 'email', 'system_role', 'employee_id', 'manager_name', 'manager_email',
      'job_role_1', 'job_role_2', 'job_role_3', 'job_role_4',
      'department', 'job_description', 'company_name', 'password', 'phone',
    ];
    // The manager row comes first so this sample file is itself a valid
    // import: the employee rows below reference a manager defined in it.
    const samples = [
      ['Sara Lee', 'sara@company.com', 'manager', 'MGR001', '', '', 'Engineering Manager', '', '', '', 'Engineering', 'Leads the frontend team', 'Acme Corp', '', ''],
      ['Jane Smith', 'jane@company.com', 'employee', 'EMP001', 'Sara Lee', 'sara@company.com', 'Frontend Developer', '', '', '', 'Engineering', 'Builds React UIs', 'Acme Corp', '', '+91-9876543210'],
      ['John Doe', 'john@company.com', 'employee', 'EMP002', 'Sara Lee', 'sara@company.com', 'Data Analyst', 'Reporting Specialist', '', '', 'Analytics', 'Analyzes business data', 'Acme Corp', '', '+91-9123456789'],
    ];

    const wb = XLSX.utils.book_new();
    const usersSheet = XLSX.utils.aoa_to_sheet([headers, ...samples]);
    usersSheet['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
    XLSX.utils.book_append_sheet(wb, usersSheet, 'Users');

    const instructions = [
      ['SkillForge AI — User Import Template'],
      [],
      ['REQUIRED for every row', 'name, email'],
      ['REQUIRED for employee rows', 'manager_name AND manager_email — an employee must have a manager'],
      ['Not required for manager/admin rows', 'manager_name, manager_email (they sit at the top of the chain)'],
      [],
      ['system_role', 'employee | manager | admin. Blank means employee.'],
      ['manager_email', 'Must match an existing manager/admin, OR a manager row inside this same file (any order).'],
      ['manager_name', 'For your readability. A mismatch against the record is a warning, not an error — the email is what links.'],
      ['email', 'Immutable. If the email already exists the user is UPDATED; if new, the user is CREATED.'],
      ['job_role_1', 'The primary job role.'],
      ['job_role_2/3/4', 'Additional job roles, applied in order. Each triggers its own auto-assessment, exactly as adding one manually does.'],
      ['password', 'Leave blank — a secure password is generated and returned to you in a credentials file.'],
      [],
      ['Note', 'Do not add comment or instruction rows to the Users sheet; every row there is treated as data.'],
    ];
    const insSheet = XLSX.utils.aoa_to_sheet(instructions);
    insSheet['!cols'] = [{ wch: 36 }, { wch: 100 }];
    XLSX.utils.book_append_sheet(wb, insSheet, 'Instructions');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="skillforge-user-import-template.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('[bulk-import/template]', e.message);
    return res.status(500).json({ success: false, error: 'Failed to build template' });
  }
});

/**
 * POST /api/users/bulk-import/preview
 * Parse an import file and return preview rows with validation — no DB writes.
 */
router.post('/bulk-import/preview', authenticate, requireRole('admin', 'manager'),
  importUpload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Supported: CSV, XLS, XLSX' });
    }

    // MIME magic-number check — blocks executables/scripts disguised as spreadsheets
    const mimeCheck = await checkFileMime(filePath);
    if (mimeCheck.blocked) {
      if (filePath) { try { unlinkSync(filePath); } catch {} }
      return res.status(400).json({ success: false, error: 'File type not allowed' });
    }

    const rawRows = await parseImportFile(filePath);
    if (!rawRows.length) {
      return res.status(400).json({ success: false, error: 'File is empty or has no data rows' });
    }

    const ctx = await buildImportContext(rawRows);
    const dataRows = rawRows.filter(raw => !isCommentRow(raw));

    const preview = dataRows.map((raw, idx) => {
      const row = normaliseRow(raw);
      const { errors, warnings, isExisting } = validateImportRow(row, ctx);
      return {
        rowNum: idx + 2, // +2 because row 1 = header
        ...row,
        role: row.role?.toLowerCase() || 'employee',
        status: errors.length ? 'error' : (isExisting ? 'update' : 'valid'),
        errors,
        warnings,
        _isUpdate: isExisting,
        _existingUserId: isExisting ? ctx.managerIndex.get(row.email.toLowerCase())?.userId : undefined,
      };
    });

    const valid   = preview.filter(r => r.status === 'valid').length;
    const updates = preview.filter(r => r.status === 'update').length;
    const invalid = preview.filter(r => r.status === 'error').length;
    res.json({ success: true, data: { preview, summary: { total: preview.length, valid, updates, invalid } } });
  } catch (e) {
    console.error('[bulk-import/preview]', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (filePath) { try { unlinkSync(filePath); } catch {} }
  }
});

/**
 * POST /api/users/bulk-import
 * Accept validated rows (JSON array) and create users in DB.
 */
router.post('/bulk-import', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { rows } = req.body; // array of normalised row objects from preview
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, error: 'rows array required' });
    }

    const companyId  = req.user.companyId || 'default';
    // Re-validate server-side with the SAME validator the preview used, so a
    // hand-crafted or stale client payload cannot bypass the rules and so
    // "valid in preview" can never turn into a silent skip on import.
    const ctx = await buildImportContext(rows);
    const allUsers = ctx.allUsers;
    const existingEmails = ctx.existingEmails;

    const created = [], updated = [], skipped = [], failed = [];

    for (const row of rows) {
      const { errors } = validateImportRow(row, ctx);
      if (errors.length > 0) {
        failed.push({ row: { name: row.name, email: row.email }, reason: errors.join('; ') });
        continue;
      }

      const existingUser = allUsers.find(u => u.email?.toLowerCase() === row.email.toLowerCase());

      if (existingUser) {
        // UPDATE path - only update non-empty fields
        try {
          const updateFields = {};
          if (row.name) updateFields.name = row.name.trim();
          if (row.jobRole) updateFields.jobRole = row.jobRole;
          if (row.department) updateFields.department = row.department;
          if (row.jobDescription) updateFields.jobDescription = row.jobDescription;
          if (row.phone) updateFields.phone = row.phone;
          if (row.employeeId) updateFields.employeeId = row.employeeId;
          if (row.status && ['active','inactive','blocked'].includes(row.status)) updateFields.status = row.status;
          // role update only if admin
          if (row.role && req.user.role === 'admin') {
            const r = row.role.toLowerCase();
            if (['employee','manager','admin'].includes(r)) updateFields.role = r;
          }
          if (Object.keys(updateFields).length > 0) {
            await UserStore.updateUser(existingUser.userId || existingUser.id, updateFields);
          }

          // Additional job roles (job_role_2/3/4) — same behavior as manually
          // adding a role: appended in order, each triggers its own assessment.
          const extraRoleNames = [row.jobRole2, row.jobRole3, row.jobRole4].filter(Boolean);
          const addedExtraRoles = [];
          for (const roleName of extraRoleNames) {
            const { role } = await addAdditionalJobRole(existingUser, { roleName }, req.user.userId);
            if (role) addedExtraRoles.push(role.roleName);
          }

          // managerEmail carried forward so the manager-linking pass below
          // applies to updated users too — it previously ran only over
          // `created`, so re-importing an existing employee with a manager
          // column silently left their manager unset.
          updated.push({ userId: existingUser.userId || existingUser.id, email: existingUser.email, name: existingUser.name, managerEmail: row.managerEmail || '', updated: Object.keys(updateFields), additionalRolesAdded: addedExtraRoles });
          continue;
        } catch (e) {
          failed.push({ row, reason: e.message });
          continue;
        }
      }

      try {
        const ALLOWED_IMPORT_ROLES = ['employee', 'manager', 'trainer', 'leadership'];
        const requestedRole = (row.role || 'employee').toLowerCase();
        const assignedRole = req.user.role === 'manager'
          ? (['employee', 'trainer'].includes(requestedRole) ? requestedRole : 'employee')
          : (ALLOWED_IMPORT_ROLES.includes(requestedRole) ? requestedRole : 'employee');
        // Generate a real unique password — admin gets it in the credential Excel
        const tempPassword = generatePassword();
        const passwordHash = await AuthService.hashPassword(tempPassword);

        const user = await UserStore.createUser({
          email: row.email.trim(),
          passwordHash,
          name: row.name.trim(),
          role: assignedRole,
          emailVerified: true,       // usable immediately with the generated password
          onboardingComplete: false,
          jobRole:        row.jobRole || '',
          department:     row.department || '',
          jobDescription: row.jobDescription || '',
          companyName:    row.companyName || req.user.companyName || '',
          companyId,
          employeeId:     row.employeeId || '',
          phone:          row.phone || '',
          status:         row.status && ['active','inactive','blocked'].includes(row.status) ? row.status : 'active',
        });

        existingEmails.add(row.email.toLowerCase());
        UserStore.updateUser(user.userId, { mustChangePassword: true }).catch(() => {});

        // Additional job roles (job_role_2/3/4) — order preserved, primary
        // (job_role_1) is already set above via createUser's jobRole field.
        const extraRoleNames = [row.jobRole2, row.jobRole3, row.jobRole4].filter(Boolean);
        for (const roleName of extraRoleNames) {
          await addAdditionalJobRole(user, { roleName }, req.user.userId).catch(() => {});
        }

        // Activation link — an alternate path to the same outcome as the temp
        // password: either credential lets the user log in and set a real password.
        let activationUrl = '';
        try {
          const tokenId = uuidv4();
          const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
          await ActivationTokens.create({ id: tokenId, userId: user.userId, email: user.email, expiresAt, used: false });
          const frontendUrl = process.env.FRONTEND_URL || 'https://skillforge-swart-mu.vercel.app';
          activationUrl = `${frontendUrl}/auth/activate?token=${tokenId}`;
        } catch (e) {
          console.warn('[bulk-import] Activation token creation failed:', e.message);
        }

        created.push({
          userId:       user.userId,
          name:         user.name,
          email:        user.email,
          tempPassword,                // plaintext — included in Excel, never stored
          activationUrl,
          managerEmail: row.managerEmail || '',
          _userObj:     user,
          _emailPayload: {
            name:        user.name,
            role:        assignedRole,
            companyName: user.companyName || req.user.companyName || 'SkillForge AI',
            fromEmail:   req.user.email,
          },
        });
      } catch (e) {
        failed.push({ row, reason: e.message });
      }
    }

    // Build credential Excel (xlsx) — base64 so frontend can trigger download
    let credentialExcelB64 = null;
    if (created.length > 0) {
      try {
        const XLSX = await import('xlsx');
        const wsData = [
          ['Employee Name', 'Employee Email', 'Temporary Password', 'Login/Activation Link'],
          ...created.map(u => [u.name, u.email, u.tempPassword, u.activationUrl || '']),
        ];
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{ wch: 30 }, { wch: 35 }, { wch: 20 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Credentials');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        credentialExcelB64 = buf.toString('base64');
      } catch (xlsxErr) {
        console.warn('[bulk-import] Excel generation failed:', xlsxErr.message);
      }
    }

    // ── Manager linking pass ──────────────────────────────────────────────────
    // Re-fetch all users so newly created ones are visible
    const managerLinked = [], managerFailed = [];
    // Covers BOTH created and updated users. Running over `created` alone was
    // why re-importing an existing employee never applied their manager.
    // Re-fetched after the create loop so a manager created earlier in this
    // same file is resolvable by the employees that report to them.
    const needsManager = [...created, ...updated].filter(u => u.managerEmail);
    if (needsManager.length > 0) {
      const freshUsers = await UserStore.getAllUsers({});
      const byEmail = Object.fromEntries(freshUsers.map(u => [u.email?.toLowerCase(), u]));

      for (const emp of needsManager) {
        const manager = byEmail[emp.managerEmail.toLowerCase()];
        if (!manager || !canActAsManager(manager)) {
          managerFailed.push({ email: emp.email, reason: `Manager "${emp.managerEmail}" not found or lacks manager capability` });
          continue;
        }
        // Shared helper: writes the durable managerId and maintains the
        // group/file mirror, identically to every other manager-link path.
        const { ok, reason } = await linkEmployeeToManager({
          employeeUserId: emp.userId,
          managerUserId: manager.userId,
          actorUserId: req.user.userId,
        });
        if (ok) managerLinked.push({ email: emp.email, manager: manager.email });
        else managerFailed.push({ email: emp.email, reason });
      }
    }

    // ── Send invitation emails + auto-assign assessments (fire-and-forget) ──────
    const emailResults = {};
    setImmediate(async () => {
      for (const u of created) {
        // Email
        if (u._emailPayload) {
          try {
            const result = await Promise.race([
              EmailService.sendInvitationEmail(u.email, u._emailPayload),
              new Promise(resolve => setTimeout(() => resolve({ success: false, error: 'timeout' }), 25000)),
            ]);
            emailResults[u.email] = result?.success ? 'sent' : (result?.error || 'failed');
            if (!result?.success) console.warn(`[bulk-import] Email to ${u.email}: ${result?.error}`);
          } catch (e) {
            emailResults[u.email] = e.message;
            console.warn(`[bulk-import] Email to ${u.email} failed:`, e.message);
          }
        }
        // Auto pre-assessment
        if (u._userObj?.jobRole) {
          await autoAssignPreAssessment(u._userObj).catch(e =>
            console.error(`[bulk-import] Auto-assessment failed for ${u.email}:`, e.message)
          );
        }
      }
      console.log('[bulk-import] Email results:', emailResults);
    });

    res.status(201).json({
      success: true,
      data: {
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
        failed:  failed.length,
        managerLinked: managerLinked.length,
        // Surfaced at the top level so a failed manager link is visible in the
        // summary, not only buried in results.managerFailed.
        managerFailed: managerFailed.length,
        credentialExcel: credentialExcelB64,   // base64 xlsx — frontend triggers download
        results: {
          created: created.map(({ managerEmail: _m, _emailPayload: _ep, _userObj: _u, ...u }) => u),
          updated,
          skipped,
          failed,
          managerLinked,
          managerFailed,
        },
      },
    });
  } catch (e) {
    console.error('[bulk-import]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/users/bulk-manager-mapping
 * CSV/JSON array of { employeeEmail, managerEmail } — updates managerId and group membership.
 */
router.post('/bulk-manager-mapping', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, error: 'rows array required. Each row: { employeeEmail, managerEmail }' });
    }
    const allUsers = await UserStore.getAllUsers({});
    const byEmail = Object.fromEntries(allUsers.map(u => [u.email?.toLowerCase(), u]));
    const allGroups = await Groups.getAll();
    const companyId = req.user.companyId || 'default';

    const mapped = [], skipped = [], errors = [];

    for (const row of rows) {
      const empEmail = (row.employeeEmail || row.employee_email || '').toLowerCase().trim();
      const mgrEmail = (row.managerEmail || row.manager_email || '').toLowerCase().trim();
      if (!empEmail || !mgrEmail) { skipped.push({ row, reason: 'Missing email' }); continue; }

      const employee = byEmail[empEmail];
      const manager  = byEmail[mgrEmail];
      if (!employee) { errors.push({ row, reason: `Employee "${empEmail}" not found` }); continue; }
      if (!manager)  { errors.push({ row, reason: `Manager "${mgrEmail}" not found` }); continue; }
      if (!['manager','admin'].includes(manager.role)) { errors.push({ row, reason: `"${mgrEmail}" is not a manager/admin role` }); continue; }

      try {
        await UserStore.updateUser(employee.userId, { managerId: manager.userId });

        // Add employee to manager's group
        let managerGroup = allGroups.find(g =>
          g.managerId === manager.userId &&
          (g.companyId || 'default') === (manager.companyId || 'default')
        );
        if (managerGroup) {
          const ids = new Set(managerGroup.employeeIds || []);
          ids.add(employee.userId);
          await Groups.update(managerGroup.id, { employeeIds: [...ids] });
          managerGroup.employeeIds = [...ids];
        } else {
          const newGroup = {
            id: `group_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
            name: `${manager.name || mgrEmail} Team`,
            managerId: manager.userId,
            employeeIds: [employee.userId],
            companyId: manager.companyId || companyId,
            createdBy: req.user.userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'active',
          };
          await Groups.create(newGroup);
          allGroups.push(newGroup);
        }
        mapped.push({ employee: empEmail, manager: mgrEmail });
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }

    res.json({ success: true, data: { mapped: mapped.length, skipped: skipped.length, errors: errors.length, results: { mapped, skipped, errors } } });
  } catch (e) {
    console.error('[bulk-manager-mapping]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/users/bulk-update
 * CSV/JSON array of { email, jobRole?, department?, managerEmail?, group?, accessRights? }
 */
router.post('/bulk-update', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ success: false, error: 'rows array required' });
    }
    const allUsers = await UserStore.getAllUsers({});
    const byEmail  = Object.fromEntries(allUsers.map(u => [u.email?.toLowerCase(), u]));
    const allGroups = await Groups.getAll();
    const companyId = req.user.companyId || 'default';
    const VALID_ACCESSES = ['admin', 'manager', 'trainer'];

    const updated = [], skipped = [], errors = [];

    for (const row of rows) {
      const email = (row.email || '').toLowerCase().trim();
      if (!email) { skipped.push({ row, reason: 'No email' }); continue; }

      const user = byEmail[email];
      if (!user) { errors.push({ row, reason: `User "${email}" not found` }); continue; }

      try {
        const patch = {};
        if (row.jobRole || row.job_role)     patch.jobRole    = (row.jobRole || row.job_role).trim();
        if (row.department)                   patch.department = row.department.trim();
        if (row.accessRights || row.access_rights) {
          const incoming = (row.accessRights || row.access_rights).split(/[,;|\s]+/).map(s => s.trim().toLowerCase()).filter(s => VALID_ACCESSES.includes(s));
          if (incoming.length) patch.accesses = incoming;
        }

        if (row.managerEmail || row.manager_email) {
          const mgrEmail = (row.managerEmail || row.manager_email).toLowerCase().trim();
          const mgr = byEmail[mgrEmail];
          if (mgr && ['manager','admin'].includes(mgr.role)) patch.managerId = mgr.userId;
        }

        if (Object.keys(patch).length) await UserStore.updateUser(user.userId, patch);

        // Group assignment
        if (row.group) {
          const groupName = row.group.trim();
          let grp = allGroups.find(g =>
            (g.name || '').toLowerCase() === groupName.toLowerCase() &&
            (g.companyId || 'default') === (user.companyId || 'default')
          );
          if (grp) {
            const ids = new Set(grp.employeeIds || []);
            ids.add(user.userId);
            await Groups.update(grp.id, { employeeIds: [...ids] });
            grp.employeeIds = [...ids];
          }
        }

        updated.push({ email });
        byEmail[email] = { ...user, ...patch };
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }

    res.json({ success: true, data: { updated: updated.length, skipped: skipped.length, errors: errors.length, results: { updated, skipped, errors } } });
  } catch (e) {
    console.error('[bulk-update]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/users/:userId/skills-gap
 * Compare role's required skills vs employee's demonstrated skills
 */
router.get('/:userId/skills-gap', authenticate, async (req, res) => {
  try {
    const user = await UserStore.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (!canAccessUser(req.user, user)) return res.status(403).json({ success: false, error: 'Access denied' });
    const { RoleLibrary } = await import('../services/DataStore.js');
    const role = user.jobRole ? await RoleLibrary.findByName(user.jobRole, user.companyId || 'default') : null;
    const required    = role?.skills || [];
    const demonstrated = user.jdSkills || [];
    const missing = required.filter(s => !demonstrated.some(d => d.toLowerCase() === s.toLowerCase()));
    const matched = required.filter(s =>  demonstrated.some(d => d.toLowerCase() === s.toLowerCase()));
    const coverage = required.length ? Math.round((matched.length / required.length) * 100) : null;
    res.json({ success: true, data: {
      roleName: user.jobRole || null,
      roleFound: !!role,
      required, demonstrated, missing, matched,
      coverage, // null if role has no skills defined
    }});
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/users/:userId/checklist
 * Get onboarding checklist for employee
 */
router.get('/:userId/checklist', authenticate, async (req, res) => {
  try {
    const target = await UserStore.getUserById(req.params.userId);
    if (target && !canAccessUser(req.user, target)) return res.status(403).json({ success: false, error: 'Access denied' });
    const { EmployeeChecklists } = await import('../services/DataStore.js');
    const checklist = await EmployeeChecklists.getByUserId(req.params.userId);
    res.json({ success: true, data: checklist });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/users/:userId/job-roles
 * Get all job roles (primary + additional) for a user
 */
router.get('/:userId/job-roles', authenticate, async (req, res) => {
  try {
    const user = await UserStore.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (!canAccessUser(req.user, user)) return res.status(403).json({ success: false, error: 'Access denied' });
    const primary = user.jobRole ? [{
      roleName: user.jobRole, department: user.department || '',
      jobDescription: user.jobDescription || '', jdSkills: user.jdSkills || [],
      isPrimary: true,
    }] : [];
    const additional = (user.additionalJobRoles || []).map(r => ({ ...r, isPrimary: false }));
    res.json({ success: true, data: { roles: [...primary, ...additional] } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/users/:userId/job-roles
 * Add an additional job role and trigger assessment workflow
 */
// Shared by the manual "Add Job Role" endpoint and bulk import (job_role_2/3/4
// columns) — behaves identically either way, per the "must work exactly like
// manual assignment" requirement. Returns the new role, or null if it was a
// no-op (missing name / duplicate) — callers decide whether that's an error.
async function addAdditionalJobRole(user, { roleName, department, jobDescription, jdSkills }, actorUserId) {
  if (!roleName?.trim()) return { role: null, reason: 'roleName is required' };

  // Re-fetch immediately before the read-modify-write to shrink the race window
  // against a concurrent add/remove for the same user (additionalJobRoles is a
  // single array field with no per-item locking — two near-simultaneous adds
  // built from a stale `user` snapshot would otherwise silently drop one of them).
  const fresh = await UserStore.getUserById(user.userId).catch(() => null);
  const existing = (fresh || user).additionalJobRoles || [];
  if (existing.some(r => r.roleName?.toLowerCase() === roleName.toLowerCase())
      || (user.jobRole || '').toLowerCase() === roleName.toLowerCase()) {
    return { role: null, reason: 'duplicate' };
  }

  const newRole = {
    id: `role_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roleName: roleName.trim(),
    department: department || '',
    jobDescription: jobDescription || '',
    jdSkills: Array.isArray(jdSkills) ? jdSkills : [],
    addedAt: new Date().toISOString(),
    addedBy: actorUserId,
  };

  const updatedRoles = [...existing, newRole];
  await UserStore.updateUser(user.userId, { additionalJobRoles: updatedRoles });
  user.additionalJobRoles = updatedRoles; // keep in-memory copy in sync for subsequent calls in the same request

  // Fire-and-forget: trigger assessment workflow for this new role
  if (jobDescription?.trim()) {
    (async () => {
      try {
        const { generateQuestionsFromJD } = await import('../services/AssessmentGenerator.js');
        const { Assessments } = await import('../services/DataStore.js');
        const { randomUUID } = await import('crypto');

        const questions = await generateQuestionsFromJD({
          jobRole: roleName,
          jobDescription,
          jdSkills: newRole.jdSkills,
          questionCount: 20,
          // Full-length sequence, not a flat 3-element array — the latter
          // made the generator round-robin to ~33/33/33.
          questionTypes: buildTypeSequence(20),
          employeeSeed: user.userId.slice(-6),
        });

        const assessmentId = randomUUID();
        const assessment = {
          id: assessmentId,
          title: `${roleName} Assessment`,
          companyId: user.companyId || 'default',
          createdBy: actorUserId,
          createdAt: new Date().toISOString(),
          status: 'active',
          jobRole: roleName,
          targetRole: roleName,
          questionCount: questions.length,
          duration: 30,
          employeeAssignments: [{
            userId: user.userId,
            jobRole: roleName,
            status: 'assigned',
            questions,
            assignedAt: new Date().toISOString(),
            additionalRoleId: newRole.id,
          }],
        };
        await Assessments.create(assessment);
        console.log(`[job-roles] Auto-assessment created for user=${user.userId} role=${roleName}`);
      } catch (e) {
        console.error('[job-roles] Auto-assessment failed:', e.message);
      }
    })();
  }

  return { role: newRole, reason: null };
}

router.post('/:userId/job-roles', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { roleName, department, jobDescription, jdSkills } = req.body;
    if (!roleName?.trim()) return res.status(400).json({ success: false, error: 'roleName is required' });

    const user = await UserStore.getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const { role, reason } = await addAdditionalJobRole(user, { roleName, department, jobDescription, jdSkills }, req.user.userId);
    if (!role) {
      if (reason === 'duplicate') return res.status(409).json({ success: false, error: 'This job role is already assigned to the user' });
      return res.status(400).json({ success: false, error: reason || 'Failed to add job role' });
    }

    res.json({ success: true, data: { role, message: 'Job role added. Assessment workflow triggered.' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * DELETE /api/users/:userId/job-roles/:roleId
 * Remove an additional job role
 */
router.delete('/:userId/job-roles/:roleId', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { userId, roleId } = req.params;
    const user = await UserStore.getUserById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const existing = user.additionalJobRoles || [];
    const updated = existing.filter(r => r.id !== roleId);
    if (updated.length === existing.length) return res.status(404).json({ success: false, error: 'Role not found' });

    await UserStore.updateUser(userId, { additionalJobRoles: updated });
    res.json({ success: true, data: { message: 'Job role removed' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
