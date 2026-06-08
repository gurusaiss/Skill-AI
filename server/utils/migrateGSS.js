/**
 * migrateGSS.js — One-time migration: assign all default/unassigned users to GSS company
 * Idempotent: safe to run on every startup (no-ops if already done)
 */
import UserStore from '../services/UserStore.js';
import { Assessments, Companies } from '../services/DataStore.js';

export const GSS_COMPANY_ID = 'company_gss';

const GSS_COMPANY_TEMPLATE = {
  id: GSS_COMPANY_ID,
  name: 'GSS',
  domain: 'gss.internal',
  plan: 'enterprise',
  status: 'active',
  primaryAdminId: null,
  createdAt: '2020-01-01T00:00:00.000Z',
  settings: {},
};

export async function migrateDefaultUsersToGSS() {
  try {
    console.log('[migrateGSS] Checking default-user migration...');

    // 1. Ensure GSS company exists
    let companies;
    try { companies = await Companies.getAll(); } catch { companies = []; }
    let gss = companies.find(c => c.id === GSS_COMPANY_ID);
    if (!gss) {
      gss = await Companies.create({ ...GSS_COMPANY_TEMPLATE, updatedAt: new Date().toISOString() });
      console.log('[migrateGSS] Created GSS company');
    }

    // 2. Find all users with no companyId or companyId === 'default'
    let allUsers;
    try { allUsers = await UserStore.getAllUsers({}); } catch { allUsers = []; }

    const unassigned = allUsers.filter(u =>
      u.role !== 'superadmin' && (!u.companyId || u.companyId === 'default')
    );

    if (unassigned.length === 0) {
      console.log('[migrateGSS] All users already assigned — skipping');
    } else {
      console.log(`[migrateGSS] Migrating ${unassigned.length} users to GSS...`);
      for (const u of unassigned) {
        const uid = u.userId || u.id;
        try { await UserStore.updateUser(uid, { companyId: GSS_COMPANY_ID }); } catch {}
      }

      // Set primary admin if not already set
      if (!gss.primaryAdminId) {
        const admin = unassigned.find(u => u.role === 'admin');
        if (admin) {
          const adminId = admin.userId || admin.id;
          try {
            await Companies.update(GSS_COMPANY_ID, {
              primaryAdminId: adminId,
              updatedAt: new Date().toISOString(),
            });
          } catch {}
        }
      }
      console.log(`[migrateGSS] Users migrated`);
    }

    // 3. Migrate orphaned assessments (no companyId)
    let assessments;
    try { assessments = await Assessments.getAll(); } catch { assessments = []; }
    const orphanAssessments = assessments.filter(a => !a.companyId);
    if (orphanAssessments.length > 0) {
      console.log(`[migrateGSS] Migrating ${orphanAssessments.length} assessments to GSS...`);
      for (const a of orphanAssessments) {
        try { await Assessments.update(a.id, { companyId: GSS_COMPANY_ID }); } catch {}
      }
    }

    // 4. Migrate orphaned modules (no companyId) — via db/store.js
    try {
      const db = await import('../db/store.js');
      const allModules = await db.getModules();
      const orphanModules = (Array.isArray(allModules) ? allModules : allModules?.modules || [])
        .filter(m => !m.companyId);
      if (orphanModules.length > 0) {
        console.log(`[migrateGSS] Migrating ${orphanModules.length} modules to GSS...`);
        for (const m of orphanModules) {
          try {
            // Use updateModule if available, otherwise direct Supabase
            if (typeof db.updateModule === 'function') {
              await db.updateModule(m.id, { companyId: GSS_COMPANY_ID });
            } else {
              // Direct Supabase update as fallback
              const sb = db.getSupabaseClient ? db.getSupabaseClient() : null;
              if (sb) {
                await sb.from('modules').update({ companyId: GSS_COMPANY_ID }).eq('id', m.id);
              }
              // File fallback: read/write modules file
              else {
                const { readFileSync, writeFileSync, existsSync } = await import('fs');
                const { join } = await import('path');
                const { fileURLToPath } = await import('url');
                const __dirname = (await import('path')).dirname(fileURLToPath(import.meta.url));
                const filePath = join(__dirname, '..', 'data', 'modules.json');
                if (existsSync(filePath)) {
                  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
                  const updated = (Array.isArray(data) ? data : data.modules || []).map(mod =>
                    mod.id === m.id ? { ...mod, companyId: GSS_COMPANY_ID } : mod
                  );
                  writeFileSync(filePath, JSON.stringify(Array.isArray(data) ? updated : { ...data, modules: updated }, null, 2));
                }
              }
            }
          } catch (modErr) {
            console.warn(`[migrateGSS] Could not migrate module ${m.id}:`, modErr.message);
          }
        }
      }
    } catch (modMigErr) {
      console.warn('[migrateGSS] Module migration skipped:', modMigErr.message);
    }

    console.log('[migrateGSS] Migration complete ✓');
  } catch (e) {
    console.error('[migrateGSS] Migration error:', e.message);
    // Non-fatal — server continues
  }
}
