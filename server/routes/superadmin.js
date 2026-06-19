/**
 * superadmin.js — Platform-level company management
 * Companies data is now persisted to Supabase via DataStore
 */
import express from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';
import AuthService from '../services/AuthService.js';
import { Companies, AccessCodes } from '../services/DataStore.js';

const router = express.Router();

// All routes require authentication + superadmin role
router.use(authenticate, requireSuperAdmin);

// ── Access code generator ─────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I/L)
function randSuffix(len = 4) {
  return Array.from({ length: len }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}
async function generateAccessCodes(initials, companyId, createdBy) {
  const pfx = (initials || 'CO').slice(0, 3).toUpperCase();
  const all = await AccessCodes.getAll();
  const usedCodes = new Set((all || []).map(c => c.code));

  let mgrCode, empCode;
  do { mgrCode = `${pfx}-MGR-${randSuffix()}`; } while (usedCodes.has(mgrCode));
  do { empCode = `${pfx}-EMP-${randSuffix()}`; } while (usedCodes.has(empCode) || empCode === mgrCode);

  const now = new Date().toISOString();
  const mgr = await AccessCodes.create({ id: randomUUID(), companyId, code: mgrCode, role: 'manager', isActive: true, usageCount: 0, maxUsage: null, expiresAt: null, label: 'Default Manager Code', createdBy, createdAt: now, updatedAt: now });
  const emp = await AccessCodes.create({ id: randomUUID(), companyId, code: empCode, role: 'employee', isActive: true, usageCount: 0, maxUsage: null, expiresAt: null, label: 'Default Employee Code', createdBy, createdAt: now, updatedAt: now });
  return { mgrCode, empCode, mgrId: mgr.id, empId: emp.id };
}

/**
 * GET /api/superadmin/stats
 * Platform-wide stats (company/admin level only)
 */
router.get('/stats', async (req, res) => {
  try {
    const companies = await Companies.getAll();
    const allUsers = await UserStore.getAllUsers({});

    const stats = {
      totalCompanies: companies.length,
      activeCompanies: companies.filter(c => c.status === 'active').length,
      suspendedCompanies: companies.filter(c => c.status === 'suspended').length,
      totalAdmins: allUsers.filter(u => u.role === 'admin').length,
      totalUsers: allUsers.filter(u => u.role !== 'superadmin').length,
      byPlan: {
        trial: companies.filter(c => c.plan === 'trial').length,
        standard: companies.filter(c => c.plan === 'standard').length,
        enterprise: companies.filter(c => c.plan === 'enterprise').length,
      },
    };
    res.json({ success: true, data: stats, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/superadmin/companies
 * List all companies with their admin info
 */
router.get('/companies', async (req, res) => {
  try {
    const companies = await Companies.getAll();
    const allUsers = await UserStore.getAllUsers({});

    const enriched = companies.map(c => {
      const admin = allUsers.find(u => u.userId === c.primaryAdminId);
      const companyUsers = allUsers.filter(
        u => (u.companyId || 'default') === c.id && u.role !== 'superadmin'
      );
      return {
        ...c,
        adminName: admin?.name || '—',
        adminEmail: admin?.email || '—',
        userCount: companyUsers.length,
        employeeCount: companyUsers.filter(u => u.role === 'employee').length,
      };
    });

    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/superadmin/companies
 * Create a new company + its primary admin account
 */
router.post('/companies', async (req, res) => {
  try {
    const { name: _name, companyName, domain, plan = 'standard', adminName, adminEmail, adminPassword } = req.body;
    const name = (_name || companyName || '').trim();
    if (!name || !adminEmail || !adminName) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Company name, admin name and email are required',
      });
    }

    const companies = await Companies.getAll();
    if (companies.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, data: null, error: 'Company name already exists' });
    }

    const existingUser = await UserStore.getUserByEmail(adminEmail);
    if (existingUser) {
      return res.status(409).json({ success: false, data: null, error: 'Admin email already registered' });
    }

    const companyId = `company_${randomUUID().slice(0, 8)}`;

    // Generate unique company code from initials + random digits (e.g. "GSS-7823")
    const initials = name.trim().split(/\s+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('');
    let companyCode = `${initials || 'CO'}-${Math.floor(1000 + Math.random() * 9000)}`;
    const allCompanies = await Companies.getAll();
    const usedCodes = new Set((allCompanies || []).map(c => c.companyCode));
    while (usedCodes.has(companyCode)) {
      companyCode = `${initials || 'CO'}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const company = {
      id: companyId,
      name: name.trim(),
      companyCode,
      domain: domain || '',
      plan,
      status: 'active',
      primaryAdminId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.userId,
      settings: {},
    };

    const tempPassword = adminPassword || `Admin@${randomUUID().slice(0, 6)}`;
    const passwordHash = await AuthService.hashPassword(tempPassword);
    const adminUser = await UserStore.createUser({
      email: adminEmail,
      passwordHash,
      name: adminName.trim(),
      role: 'admin',
      emailVerified: true,
      onboardingComplete: true,
      companyId,
    });

    company.primaryAdminId = adminUser.userId;
    const saved = await Companies.create(company);

    // Generate manager + employee access codes
    const codes = await generateAccessCodes(initials, companyId, req.user.userId);

    res.status(201).json({
      success: true,
      data: {
        company: saved || company,
        companyCode,
        admin: { userId: adminUser.userId, email: adminUser.email, name: adminUser.name },
        tempPassword: !adminPassword ? tempPassword : undefined,
        accessCodes: {
          managerCode: codes.mgrCode,
          employeeCode: codes.empCode,
        },
      },
      error: null,
    });
  } catch (e) {
    console.error('[superadmin/companies POST]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/superadmin/companies/:id
 * Update company (name, domain, plan, status)
 */
router.put('/companies/:id', async (req, res) => {
  try {
    const existing = await Companies.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, data: null, error: 'Company not found' });
    }

    const { name: _name, companyName, domain, plan, status } = req.body;
    const name = (_name || companyName || '').trim();
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name;
    if (domain !== undefined) updates.domain = domain;
    if (plan) updates.plan = plan;
    if (status) updates.status = status;

    const updated = await Companies.update(req.params.id, updates);
    res.json({ success: true, data: updated || { ...existing, ...updates }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/superadmin/companies/:id
 * Delete a company (users remain, unlinked)
 */
router.delete('/companies/:id', async (req, res) => {
  try {
    const existing = await Companies.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, data: null, error: 'Company not found' });
    }
    await Companies.delete(req.params.id);
    res.json({ success: true, data: { deleted: true, id: req.params.id }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/superadmin/companies/:id/users
 * Get all users under a company
 */
router.get('/companies/:id/users', async (req, res) => {
  try {
    const allUsers = await UserStore.getAllUsers({});
    const users = allUsers
      .filter(u => (u.companyId || 'default') === req.params.id && u.role !== 'superadmin')
      .map(u => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        jobRole: u.jobRole || '',
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
      }));
    res.json({ success: true, data: users, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/superadmin/companies/:id/suspend
 * Toggle suspend / reactivate a company
 */
router.post('/companies/:id/suspend', async (req, res) => {
  try {
    const existing = await Companies.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, data: null, error: 'Company not found' });
    }

    const newStatus = existing.status === 'active' ? 'suspended' : 'active';
    await Companies.update(req.params.id, { status: newStatus, updatedAt: new Date().toISOString() });
    res.json({ success: true, data: { status: newStatus }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

// ── Access Code Management ────────────────────────────────────────────────────

/**
 * GET /api/superadmin/companies/:id/codes
 * List all access codes for a company
 */
router.get('/companies/:id/codes', async (req, res) => {
  try {
    const codes = await AccessCodes.getByCompany(req.params.id);
    res.json({ success: true, data: codes || [], error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * POST /api/superadmin/companies/:id/codes
 * Create an additional access code for a company
 */
router.post('/companies/:id/codes', async (req, res) => {
  try {
    const company = await Companies.getById(req.params.id);
    if (!company) return res.status(404).json({ success: false, data: null, error: 'Company not found' });

    const { role = 'employee', label, maxUsage, expiresAt } = req.body;
    if (!['manager', 'employee'].includes(role)) {
      return res.status(400).json({ success: false, data: null, error: 'role must be manager or employee' });
    }

    const initials = company.name.trim().split(/\s+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('');
    const all = await AccessCodes.getAll();
    const usedCodes = new Set((all || []).map(c => c.code));
    const pfx = (initials || 'CO').slice(0, 3);
    const typeTag = role === 'manager' ? 'MGR' : 'EMP';
    let code;
    do { code = `${pfx}-${typeTag}-${randSuffix()}`; } while (usedCodes.has(code));

    const now = new Date().toISOString();
    const doc = { id: randomUUID(), companyId: req.params.id, code, role, isActive: true, usageCount: 0, maxUsage: maxUsage || null, expiresAt: expiresAt || null, label: label || `${role === 'manager' ? 'Manager' : 'Employee'} Code`, createdBy: req.user.userId, createdAt: now, updatedAt: now };
    const saved = await AccessCodes.create(doc);
    res.status(201).json({ success: true, data: saved || doc, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/superadmin/companies/:id/codes/:codeId
 * Update access code — disable, set expiry, update label, regenerate code string
 */
router.put('/companies/:id/codes/:codeId', async (req, res) => {
  try {
    const existing = await AccessCodes.getById(req.params.codeId);
    if (!existing || existing.companyId !== req.params.id) {
      return res.status(404).json({ success: false, data: null, error: 'Code not found' });
    }

    const { isActive, label, maxUsage, expiresAt, regenerate } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (label !== undefined) updates.label = label;
    if (maxUsage !== undefined) updates.maxUsage = maxUsage;
    if (expiresAt !== undefined) updates.expiresAt = expiresAt;

    if (regenerate) {
      // Generate a fresh code string, keeping same role prefix
      const all = await AccessCodes.getAll();
      const usedCodes = new Set((all || []).filter(c => c.id !== existing.id).map(c => c.code));
      const company = await Companies.getById(req.params.id);
      const initials = (company?.name || 'CO').trim().split(/\s+/).map(w => w[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('');
      const pfx = (initials || 'CO').slice(0, 3);
      const typeTag = existing.role === 'manager' ? 'MGR' : 'EMP';
      let newCode;
      do { newCode = `${pfx}-${typeTag}-${randSuffix()}`; } while (usedCodes.has(newCode));
      updates.code = newCode;
      updates.usageCount = 0;
    }

    const updated = await AccessCodes.update(req.params.codeId, updates);
    res.json({ success: true, data: updated || { ...existing, ...updates }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/superadmin/companies/:id/codes/:codeId
 * Delete an access code
 */
router.delete('/companies/:id/codes/:codeId', async (req, res) => {
  try {
    const existing = await AccessCodes.getById(req.params.codeId);
    if (!existing || existing.companyId !== req.params.id) {
      return res.status(404).json({ success: false, data: null, error: 'Code not found' });
    }
    await AccessCodes.delete(req.params.codeId);
    res.json({ success: true, data: { deleted: true }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/superadmin/admins
 * List all admin accounts across all companies
 */
router.get('/admins', async (req, res) => {
  try {
    const allUsers = await UserStore.getAllUsers({});
    const companies = await Companies.getAll();

    const admins = allUsers.filter(u => u.role === 'admin');
    const enriched = admins.map(u => {
      const company = companies.find(c => c.id === (u.companyId || 'default'));
      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        status: u.status || 'active',
        companyId: u.companyId || 'default',
        companyName: company?.name || 'Default',
        companyStatus: company?.status || 'active',
        plan: company?.plan || 'trial',
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
      };
    });

    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/superadmin/admins/:adminId/stats
 * Live stats for a specific admin's company
 */
router.get('/admins/:adminId/stats', async (req, res) => {
  try {
    const { adminId } = req.params;
    const allUsers = await UserStore.getAllUsers({});
    const companies = await Companies.getAll();

    const admin = allUsers.find(u => u.userId === adminId && u.role === 'admin');
    if (!admin) {
      return res.status(404).json({ success: false, data: null, error: 'Admin not found' });
    }

    const company = companies.find(c => c.id === (admin.companyId || 'default')) || {
      id: admin.companyId || 'default',
      name: 'Default',
      plan: 'standard',
      status: 'active',
      domain: '',
    };

    const companyUsers = allUsers.filter(u =>
      (u.companyId || 'default') === (admin.companyId || 'default') && u.role !== 'superadmin'
    );
    const employees = companyUsers.filter(u => u.role === 'employee');
    const managers = companyUsers.filter(u => u.role === 'manager');

    // Load assignments and modules
    const db = await import('../db/store.js');
    const [assignmentsRaw, modulesRaw] = await Promise.allSettled([
      db.getAssignments(),
      db.getModules(),
    ]);

    const allAssignments = assignmentsRaw.status === 'fulfilled' ? (assignmentsRaw.value || []) : [];
    const allModules = modulesRaw.status === 'fulfilled' ? (modulesRaw.value || []) : [];

    const companyUserIds = new Set(companyUsers.map(u => u.userId || u.id));
    const companyAssignments = allAssignments.filter(a =>
      companyUserIds.has(a.assigned_to_user || a.employee_id)
    );
    const companyModules = allModules.filter(m =>
      !m.companyId || m.companyId === (admin.companyId || 'default') || m.created_by === adminId
    );

    const completedAssignments = companyAssignments.filter(a => a.status === 'completed');
    const completionRate = companyAssignments.length > 0
      ? Math.round((completedAssignments.length / companyAssignments.length) * 100)
      : 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const activeUsers = companyUsers.filter(u => u.lastLogin && u.lastLogin > thirtyDaysAgo).length;

    res.json({
      success: true,
      data: {
        admin: {
          userId: admin.userId,
          name: admin.name,
          email: admin.email,
          status: admin.status || 'active',
          createdAt: admin.createdAt,
          lastLogin: admin.lastLogin,
        },
        company,
        stats: {
          totalUsers: companyUsers.length,
          employees: employees.length,
          managers: managers.length,
          totalModules: companyModules.length,
          totalAssignments: companyAssignments.length,
          completedAssignments: completedAssignments.length,
          completionRate,
          activeUsers,
        },
      },
      error: null,
    });
  } catch (e) {
    console.error('[superadmin/admins/:id/stats]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * PUT /api/superadmin/admins/:adminId
 * Update admin (name, email, status)
 */
router.put('/admins/:adminId', async (req, res) => {
  try {
    const { name, email, status } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (email) updates.email = email.trim().toLowerCase();
    if (status) updates.status = status;
    updates.updatedAt = new Date().toISOString();

    const updated = await UserStore.updateUser(req.params.adminId, updates);
    res.json({ success: true, data: updated, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * DELETE /api/superadmin/admins/:adminId
 * Delete an admin account
 */
router.delete('/admins/:adminId', async (req, res) => {
  try {
    const allUsers = await UserStore.getAllUsers({});
    const admin = allUsers.find(u => u.userId === req.params.adminId && u.role === 'admin');
    if (!admin) {
      return res.status(404).json({ success: false, data: null, error: 'Admin not found' });
    }
    await UserStore.deleteUser(req.params.adminId);
    res.json({ success: true, data: { deleted: true, userId: req.params.adminId }, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

/**
 * GET /api/superadmin/reports
 * Company-based aggregate reports
 */
router.get('/reports', async (req, res) => {
  try {
    const companies = await Companies.getAll();
    const allUsers = await UserStore.getAllUsers({});
    const db = await import('../db/store.js');

    const [assignmentsRaw, modulesRaw] = await Promise.allSettled([
      db.getAssignments(),
      db.getModules(),
    ]);
    const allAssignments = assignmentsRaw.status === 'fulfilled' ? (assignmentsRaw.value || []) : [];
    const allModules = modulesRaw.status === 'fulfilled' ? (modulesRaw.value || []) : [];

    const reports = companies.map(c => {
      const admin = allUsers.find(u => u.userId === c.primaryAdminId);
      const companyUsers = allUsers.filter(
        u => (u.companyId || 'default') === c.id && u.role !== 'superadmin'
      );
      const companyUserIds = new Set(companyUsers.map(u => u.userId || u.id));
      const companyAssignments = allAssignments.filter(a =>
        companyUserIds.has(a.assigned_to_user || a.employee_id)
      );
      const completed = companyAssignments.filter(a => a.status === 'completed');
      const completionRate = companyAssignments.length > 0
        ? Math.round((completed.length / companyAssignments.length) * 100)
        : 0;
      const companyModules = allModules.filter(m =>
        !m.companyId || m.companyId === c.id || m.created_by === c.primaryAdminId
      );
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const activeUsers = companyUsers.filter(u => u.lastLogin && u.lastLogin > thirtyDaysAgo).length;

      return {
        companyId: c.id,
        companyName: c.name,
        domain: c.domain || '',
        plan: c.plan,
        status: c.status,
        createdAt: c.createdAt,
        adminName: admin?.name || '—',
        adminEmail: admin?.email || '—',
        totalUsers: companyUsers.length,
        employees: companyUsers.filter(u => u.role === 'employee').length,
        managers: companyUsers.filter(u => u.role === 'manager').length,
        totalModules: companyModules.length,
        totalAssignments: companyAssignments.length,
        completedAssignments: completed.length,
        completionRate,
        activeUsers,
      };
    });

    res.json({ success: true, data: { reports, total: reports.length }, error: null });
  } catch (e) {
    console.error('[superadmin/reports]', e);
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
