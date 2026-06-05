import express from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import UserStore from '../services/UserStore.js';
import AuthService from '../services/AuthService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const COMPANIES_FILE = join(DATA_DIR, 'companies.json');

if (!existsSync(COMPANIES_FILE)) writeFileSync(COMPANIES_FILE, JSON.stringify([], null, 2));

const readCompanies = () => {
  try { return JSON.parse(readFileSync(COMPANIES_FILE, 'utf-8')); } catch { return []; }
};
const writeCompanies = (d) => writeFileSync(COMPANIES_FILE, JSON.stringify(d, null, 2));

const router = express.Router();

// All routes require authentication + superadmin role
router.use(authenticate, requireSuperAdmin);

/**
 * GET /api/superadmin/stats
 * Platform-wide stats
 */
router.get('/stats', async (req, res) => {
  try {
    const companies = readCompanies();
    const allUsers = await UserStore.getAllUsers({});

    const stats = {
      totalCompanies: companies.length,
      activeCompanies: companies.filter(c => c.status === 'active').length,
      suspendedCompanies: companies.filter(c => c.status === 'suspended').length,
      totalAdmins: allUsers.filter(u => u.role === 'admin').length,
      totalManagers: allUsers.filter(u => u.role === 'manager').length,
      totalEmployees: allUsers.filter(u => u.role === 'employee').length,
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
    const companies = readCompanies();
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
 * Body: { name, domain, plan, adminName, adminEmail, adminPassword? }
 */
router.post('/companies', async (req, res) => {
  try {
    const { name, domain, plan = 'standard', adminName, adminEmail, adminPassword } = req.body;
    if (!name || !adminEmail || !adminName) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Company name, admin name and email are required',
      });
    }

    // Check duplicate company name
    const companies = readCompanies();
    if (companies.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, data: null, error: 'Company name already exists' });
    }

    // Check duplicate admin email
    const existingUser = await UserStore.getUserByEmail(adminEmail);
    if (existingUser) {
      return res.status(409).json({ success: false, data: null, error: 'Admin email already registered' });
    }

    // Create company first
    const companyId = `company_${randomUUID().slice(0, 8)}`;
    const company = {
      id: companyId,
      name: name.trim(),
      domain: domain || '',
      plan,
      status: 'active',
      primaryAdminId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.userId,
      settings: {},
    };

    // Create admin user for this company
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

    // Link admin to company
    company.primaryAdminId = adminUser.userId;
    companies.push(company);
    writeCompanies(companies);

    res.status(201).json({
      success: true,
      data: {
        company,
        admin: { userId: adminUser.userId, email: adminUser.email, name: adminUser.name },
        tempPassword: !adminPassword ? tempPassword : undefined,
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
    const companies = readCompanies();
    const idx = companies.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, data: null, error: 'Company not found' });
    }

    const { name, domain, plan, status } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name) updates.name = name.trim();
    if (domain !== undefined) updates.domain = domain;
    if (plan) updates.plan = plan;
    if (status) updates.status = status;

    companies[idx] = { ...companies[idx], ...updates };
    writeCompanies(companies);
    res.json({ success: true, data: companies[idx], error: null });
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
    const companies = readCompanies();
    const idx = companies.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, data: null, error: 'Company not found' });
    }

    const newStatus = companies[idx].status === 'active' ? 'suspended' : 'active';
    companies[idx] = { ...companies[idx], status: newStatus, updatedAt: new Date().toISOString() };
    writeCompanies(companies);
    res.json({ success: true, data: { status: newStatus }, error: null });
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
    const allUsers = await UserStore.getAllUsers({ role: 'admin' });
    const companies = readCompanies();

    const enriched = allUsers.map(u => {
      const company = companies.find(c => c.id === (u.companyId || 'default'));
      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        companyId: u.companyId || 'default',
        companyName: company?.name || 'Default',
        companyStatus: company?.status || 'active',
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
      };
    });

    res.json({ success: true, data: enriched, error: null });
  } catch (e) {
    res.status(500).json({ success: false, data: null, error: e.message });
  }
});

export default router;
