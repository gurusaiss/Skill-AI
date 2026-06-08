/**
 * autoSeed.js — Runs on server startup
 * Seeds demo accounts into Supabase (or JSON files) if no users exist yet.
 * Safe to call every restart — checks for existing users first.
 */

import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';
import { v4 as uuidv4 } from 'uuid';

const SUPERADMIN = {
  email: 'superadmin@skillforge.ai',
  password: 'SuperAdmin@2024',
  name: 'Super Admin',
  role: 'superadmin',
};

const ADMIN = {
  email: 'admin@gmail.com',
  password: 'Admin@123456',
  name: 'Admin User',
  role: 'admin',
};

const MANAGERS = [
  { email: 'manager1@gmail.com', password: 'Manager@123456', name: 'Manager - Group A', role: 'manager' },
  { email: 'manager2@gmail.com', password: 'Manager@123456', name: 'Manager - Group B', role: 'manager' },
  { email: 'manager3@gmail.com', password: 'Manager@123456', name: 'Manager - Group C', role: 'manager' },
];

const EMPLOYEES = [
  { email: 'employee1@gmail.com',  password: 'Employee@123456', name: 'Employee 1 - Full Stack', role: 'employee' },
  { email: 'employee2@gmail.com',  password: 'Employee@123456', name: 'Employee 2 - Backend',    role: 'employee' },
  { email: 'employee3@gmail.com',  password: 'Employee@123456', name: 'Employee 3 - Frontend',   role: 'employee' },
  { email: 'employee4@gmail.com',  password: 'Employee@123456', name: 'Employee 4 - DevOps',     role: 'employee' },
  { email: 'employee5@gmail.com',  password: 'Employee@123456', name: 'Employee 5 - Data',       role: 'employee' },
  { email: 'employee6@gmail.com',  password: 'Employee@123456', name: 'Employee 6 - QA',         role: 'employee' },
  { email: 'employee7@gmail.com',  password: 'Employee@123456', name: 'Employee 7 - Security',   role: 'employee' },
  { email: 'employee8@gmail.com',  password: 'Employee@123456', name: 'Employee 8 - ML',         role: 'employee' },
  { email: 'employee9@gmail.com',  password: 'Employee@123456', name: 'Employee 9 - Cloud',      role: 'employee' },
  { email: 'employee10@gmail.com', password: 'Employee@123456', name: 'Employee 10 - Architect', role: 'employee' },
  { email: 'employee11@gmail.com', password: 'Employee@123456', name: 'Employee 11 - PM',        role: 'employee' },
  { email: 'employee12@gmail.com', password: 'Employee@123456', name: 'Employee 12 - UI/UX',     role: 'employee' },
  { email: 'employee13@gmail.com', password: 'Employee@123456', name: 'Employee 13 - Mobile',    role: 'employee' },
  { email: 'employee14@gmail.com', password: 'Employee@123456', name: 'Employee 14 - DevTools',  role: 'employee' },
  { email: 'employee15@gmail.com', password: 'Employee@123456', name: 'Employee 15 - Integration', role: 'employee' },
];

async function seedAccount(account) {
  try {
    const existing = await UserStore.getUserByEmail(account.email);
    if (existing) return; // already exists — skip

    const passwordHash = await AuthService.hashPassword(account.password);
    await UserStore.createUser({
      email:              account.email,
      passwordHash,
      name:               account.name,
      role:               account.role,
      emailVerified:      true,
      onboardingComplete: true,
      learningUUID:       uuidv4(),
      companyId:          'company_gss',
    });
    console.log(`[autoSeed] ✅ Created: ${account.email} (${account.role})`);
  } catch (err) {
    if (err.message?.includes('already registered')) {
      // fine — another process seeded first
    } else {
      console.warn(`[autoSeed] ⚠️  ${account.email}: ${err.message}`);
    }
  }
}

export async function autoSeed() {
  try {
    // Ensure GSS company exists before seeding users
    try {
      const { Companies } = await import('../services/DataStore.js');
      const { GSS_COMPANY_ID } = await import('./migrateGSS.js');
      const companies = await Companies.getAll();
      if (!companies.find(c => c.id === GSS_COMPANY_ID)) {
        await Companies.create({
          id: GSS_COMPANY_ID,
          name: 'GSS',
          domain: 'gss.internal',
          plan: 'enterprise',
          status: 'active',
          primaryAdminId: null,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: new Date().toISOString(),
          settings: {},
        });
        console.log('[autoSeed] Created GSS company');
      }
    } catch {}

    console.log('[autoSeed] Checking if seed is needed...');

    // Check if any users exist already
    const existing = await UserStore.getAllUsers();
    if (existing.length > 0) {
      console.log(`[autoSeed] ${existing.length} users already exist — skipping seed.`);
      return;
    }

    console.log('[autoSeed] No users found — seeding demo accounts...');

    const all = [SUPERADMIN, ADMIN, ...MANAGERS, ...EMPLOYEES];
    // Seed sequentially to avoid race conditions
    for (const account of all) {
      await seedAccount(account);
    }

    console.log('[autoSeed] ✅ Seed complete — 20 accounts created.');
    console.log('[autoSeed]    superadmin@skillforge.ai / SuperAdmin@2024');
    console.log('[autoSeed]    admin@gmail.com          / Admin@123456');
    console.log('[autoSeed]    manager1@gmail.com       / Manager@123456');
    console.log('[autoSeed]    employee1@gmail.com      / Employee@123456');
  } catch (err) {
    console.error('[autoSeed] ❌ Seed failed:', err.message);
    // Never crash the server — seed failure is non-fatal
  }
}
