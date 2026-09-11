import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { UserJDProfiles, Groups } from './DataStore.js';
import { canActAsManager } from './roleCapability.js';
import * as mysqlDb from '../db/mysql.js';

// MySQL is opt-in via DB_BACKEND=mysql — unset (the default) or any other
// value leaves every existing Supabase/file behavior completely untouched.
// This is deliberate: Supabase must keep working exactly as it does today
// for as long as needed: MySQL is a new, parallel, independently-working
// option, not a forced replacement.
function useMySQL() {
  return process.env.DB_BACKEND === 'mysql' && !!mysqlDb.getPool();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase client (lazy) ────────────────────────────────────────────────────
let _sb = null;
function getSB() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASESERVICE_ROLE_KEY
           || process.env.SUPABASE_SECRET_KEY
           || process.env.SUPABASE_KEY;
  if (url && key && url.startsWith('http') && key.length > 20) {
    _sb = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws },    // fixes Node.js 20 WebSocket error
    });
    console.log('[UserStore] Using Supabase');
  }
  return _sb;
}
const useSupabase = () => !!getSB();

// ── Row ↔ App field mapping ───────────────────────────────────────────────────
function rowToUser(row) {
  if (!row) return null;
  return {
    userId:              row.user_id,
    email:               row.email,
    passwordHash:        row.password_hash,
    name:                row.name || '',
    role:                row.role || 'employee',
    learningUUID:        row.learning_uuid || null,
    emailVerified:       row.email_verified || false,
    managerId:           row.manager_id || null,
    googleId:            row.google_id || null,
    createdAt:           row.created_at,
    updatedAt:           row.updated_at,
    lastLogin:           row.last_login || null,
    // Extended profile
    jobRole:             row.job_role || '',
    department:          row.department || '',
    jobDescription:      row.job_description || '',
    jobDescriptionFile:  row.job_description_file || null,
    onboardingComplete:  row.onboarding_complete || false,
    companyName:         row.company_name || '',
    companyId:           row.company_id || 'default',
    employeeId:          row.employee_id || '',
    phone:               row.phone || '',
    status:              row.status || 'active',
    jdSkills:            row.jd_skills || [],
    jdSourceUrl:         row.jd_source_url || '',
    jdSourceType:        row.jd_source_type || 'text',
    accesses:            row.accesses || [],
    additionalJobRoles:  row.additional_job_roles || [],
    // Auth fields
    otp:                 row.otp || null,
    otpExpires:          row.otp_expires || null,
    resetToken:          row.reset_token || null,
    resetTokenExpires:   row.reset_token_expires || null,
    mustChangePassword:  row.must_change_password || false,
  };
}

function userToRow(u) {
  const row = {};
  if (u.userId       !== undefined) row.user_id            = u.userId;
  if (u.email        !== undefined) row.email              = u.email;
  if (u.passwordHash !== undefined) row.password_hash      = u.passwordHash;
  if (u.name         !== undefined) row.name               = u.name;
  if (u.role         !== undefined) row.role               = u.role;
  if (u.learningUUID !== undefined) row.learning_uuid      = u.learningUUID;
  if (u.emailVerified!== undefined) row.email_verified     = u.emailVerified;
  if (u.managerId    !== undefined) row.manager_id         = u.managerId;
  if (u.googleId     !== undefined) row.google_id          = u.googleId;
  if (u.lastLogin    !== undefined) row.last_login         = u.lastLogin;
  if (u.jobRole      !== undefined) row.job_role           = u.jobRole;
  if (u.department   !== undefined) row.department         = u.department;
  if (u.jobDescription !== undefined) row.job_description  = u.jobDescription;
  if (u.jobDescriptionFile !== undefined) row.job_description_file = u.jobDescriptionFile;
  if (u.onboardingComplete !== undefined) row.onboarding_complete  = u.onboardingComplete;
  if (u.companyName  !== undefined) row.company_name       = u.companyName;
  if (u.companyId    !== undefined) row.company_id         = u.companyId;
  if (u.employeeId   !== undefined) row.employee_id        = u.employeeId;
  if (u.phone        !== undefined) row.phone              = u.phone;
  if (u.status       !== undefined) row.status             = u.status;
  if (u.jdSkills     !== undefined) row.jd_skills          = u.jdSkills;
  if (u.jdSourceUrl  !== undefined) row.jd_source_url      = u.jdSourceUrl;
  if (u.jdSourceType !== undefined) row.jd_source_type     = u.jdSourceType;
  if (u.accesses     !== undefined) row.accesses            = u.accesses;
  if (u.additionalJobRoles !== undefined) row.additional_job_roles = u.additionalJobRoles;
  if (u.otp          !== undefined) row.otp                = u.otp;
  if (u.otpExpires   !== undefined) row.otp_expires        = u.otpExpires;
  if (u.resetToken   !== undefined) row.reset_token        = u.resetToken;
  if (u.resetTokenExpires !== undefined) row.reset_token_expires = u.resetTokenExpires;
  if (u.mustChangePassword !== undefined) row.must_change_password = u.mustChangePassword;
  return row;
}

// JD fields stored in user_jd_profiles table (separate from users table schema)
const JD_FIELDS = ['jobDescription', 'jobDescriptionFile', 'jdSkills', 'jdSourceUrl', 'jdSourceType'];

function mergeJD(user, jdProfile) {
  if (!jdProfile) return user;
  return {
    ...user,
    jobDescription:     jdProfile.jobDescription     ?? user.jobDescription     ?? '',
    jobDescriptionFile: jdProfile.jobDescriptionFile ?? user.jobDescriptionFile ?? null,
    jdSkills:           jdProfile.jdSkills           ?? user.jdSkills           ?? [],
    jdSourceUrl:        jdProfile.jdSourceUrl        ?? user.jdSourceUrl        ?? '',
    jdSourceType:       jdProfile.jdSourceType       ?? user.jdSourceType       ?? 'text',
  };
}

class UserStore {
  constructor() {
    this.usersFilePath       = path.join(__dirname, '../data/users.json');
    this.assignmentsFilePath = path.join(__dirname, '../data/assignments.json');
    this.auditFilePath       = path.join(__dirname, '../data/audit.json');
    this.validRoles          = ['superadmin', 'admin', 'manager', 'employee'];
  }

  // ── File I/O helpers (fallback) ───────────────────────────────────────────

  // Write-to-temp-then-rename: no file locking exists in this fallback store,
  // so a concurrent reader could otherwise observe a partially-written file.
  // rename() is atomic on the same filesystem — readers see the old or the
  // complete new content, never a truncated intermediate state.
  async _writeJsonAtomic(filePath, data) {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async readUsersFile() {
    try {
      const data = await fs.readFile(this.usersFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { users: [], nextUserId: 1 }; }
  }
  async writeUsersFile(data) {
    await this._writeJsonAtomic(this.usersFilePath, data);
  }
  async readAssignmentsFile() {
    try {
      const data = await fs.readFile(this.assignmentsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { assignments: [], nextAssignmentId: 1 }; }
  }
  async writeAssignmentsFile(data) {
    await this._writeJsonAtomic(this.assignmentsFilePath, data);
  }
  async readAuditFile() {
    try {
      const data = await fs.readFile(this.auditFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { logs: [], nextLogId: 1 }; }
  }
  async writeAuditFile(data) {
    await this._writeJsonAtomic(this.auditFilePath, data);
  }

  // ── User CRUD ─────────────────────────────────────────────────────────────

  async createUser(userData) {
    const sb = getSB();
    const newUser = {
      userId:             `auth_user_${uuidv4().slice(0, 8)}`,
      email:              userData.email,
      passwordHash:       userData.passwordHash,
      name:               userData.name || '',
      role:               userData.role || 'employee',
      learningUUID:       userData.learningUUID || uuidv4(),
      emailVerified:      userData.emailVerified || false,
      otp:                null,
      otpExpires:         null,
      resetToken:         null,
      resetTokenExpires:  null,
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString(),
      lastLogin:          null,
      managerId:          null,
      googleId:           userData.googleId || null,
      jobRole:            userData.jobRole || '',
      department:         userData.department || '',
      jobDescription:     userData.jobDescription || '',
      jobDescriptionFile: userData.jobDescriptionFile || null,
      onboardingComplete: userData.onboardingComplete || false,
      companyName:        userData.companyName || '',
      companyId:          userData.companyId || 'default',
      employeeId:         userData.employeeId || '',
      phone:              userData.phone || '',
      status:             userData.status || 'active',
    };

    if (useMySQL()) {
      const existing = await this.getUserByEmail(userData.email);
      if (existing) throw new Error('Email already registered');
      const row = userToRow(newUser);
      await mysqlDb.insertRow('users', row);
      return newUser;
    }

    if (sb) {
      const existing = await this.getUserByEmail(userData.email);
      if (existing) throw new Error('Email already registered');
      // Only include columns that are guaranteed to exist in schema
      const row = {
        user_id:        newUser.userId,
        email:          newUser.email,
        password_hash:  newUser.passwordHash,
        name:           newUser.name,
        role:           newUser.role,
        learning_uuid:  newUser.learningUUID,
        email_verified: newUser.emailVerified,
        google_id:      newUser.googleId,
        created_at:     newUser.createdAt,
        updated_at:     newUser.updatedAt,
      };
      // Add extended columns only if they exist (won't error if missing)
      try { row.job_role = newUser.jobRole || ''; } catch {}
      try { row.department = newUser.department || ''; } catch {}
      try { row.job_description = newUser.jobDescription || ''; } catch {}
      try { row.onboarding_complete = newUser.onboardingComplete || false; } catch {}
      try { row.company_name = newUser.companyName || ''; } catch {}
      try { row.company_id = newUser.companyId || 'default'; } catch {}
      try { if (newUser.employeeId) row.employee_id = newUser.employeeId; } catch {}
      try { if (newUser.phone) row.phone = newUser.phone; } catch {}
      try { if (newUser.status) row.status = newUser.status; } catch {}

      const { data, error } = await sb.from('users').insert(row).select().maybeSingle();
      if (error) {
        console.error('[UserStore] createUser Supabase error:', error.message);
        throw new Error(error.message);
      }
      return data ? rowToUser(data) : newUser;
    }

    // File fallback
    const data = await this.readUsersFile();
    if (data.users.find(u => u.email === userData.email)) throw new Error('Email already registered');
    newUser.userId = `auth_user_${String(data.nextUserId).padStart(3, '0')}`;
    data.users.push(newUser);
    data.nextUserId += 1;
    await this.writeUsersFile(data);
    return newUser;
  }

  async getUserById(userId) {
    if (useMySQL()) {
      const row = await mysqlDb.selectById('users', userId, 'user_id');
      const user = rowToUser(row);
      if (!user) return null;
      try { return mergeJD(user, await UserJDProfiles.getById(userId)); } catch { return user; }
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('users').select('*').eq('user_id', userId).maybeSingle();
      if (error) { console.error('[UserStore] getUserById:', error.message); return null; }
      const user = rowToUser(data);
      if (!user) return null;
      try { return mergeJD(user, await UserJDProfiles.getById(userId)); } catch { return user; }
    }
    const data = await this.readUsersFile();
    return data.users.find(u => u.userId === userId) || null;
  }

  async getUserByEmail(email) {
    if (useMySQL()) {
      const rows = await mysqlDb.selectWhere('users', { email });
      const user = rowToUser(rows?.[0]);
      if (!user) return null;
      try { return mergeJD(user, await UserJDProfiles.getById(user.userId)); } catch { return user; }
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('users').select('*').eq('email', email).maybeSingle();
      if (error) { console.error('[UserStore] getUserByEmail:', error.message); return null; }
      const user = rowToUser(data);
      if (!user) return null;
      try { return mergeJD(user, await UserJDProfiles.getById(user.userId)); } catch { return user; }
    }
    const data = await this.readUsersFile();
    return data.users.find(u => u.email === email) || null;
  }

  async getUserByGoogleId(googleId) {
    if (useMySQL()) {
      const rows = await mysqlDb.selectWhere('users', { google_id: googleId });
      return rowToUser(rows?.[0]);
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('users').select('*').eq('google_id', googleId).maybeSingle();
      if (error) return null;
      return rowToUser(data);
    }
    const data = await this.readUsersFile();
    return data.users.find(u => u.googleId === googleId) || null;
  }

  async updateUser(userId, updates) {
    // Always persist JD fields to separate table — immune to users table schema gaps
    const jdUpdates = {};
    JD_FIELDS.forEach(f => { if (updates[f] !== undefined) jdUpdates[f] = updates[f]; });
    if (Object.keys(jdUpdates).length > 0) {
      try { await UserJDProfiles.upsert(userId, jdUpdates); } catch {}
    }

    if (useMySQL()) {
      try {
        const row = userToRow(updates);
        row.updated_at = new Date().toISOString();
        await mysqlDb.updateRow('users', userId, row, 'user_id');
        const user = await this.getUserById(userId);
        return user || { userId, ...updates };
      } catch (err) {
        console.error('[UserStore] updateUser MySQL exception:', err.message);
        return { userId, ...updates };
      }
    }

    const sb = getSB();
    if (sb) {
      try {
        const row = userToRow(updates);
        row.updated_at = new Date().toISOString();
        // Use maybeSingle() instead of single() — won't throw if 0 rows matched
        const { data, error } = await sb.from('users').update(row).eq('user_id', userId).select().maybeSingle();
        if (error) {
          console.error('[UserStore] updateUser Supabase error:', error.message);
          // Don't throw — fall through and return partial update
          return { userId, ...updates };
        }
        const user = data ? rowToUser(data) : { userId, ...updates };
        // Merge JD from separate table so the response always has JD data
        return mergeJD(user, jdUpdates.jobDescription !== undefined ? jdUpdates : null);
      } catch (err) {
        console.error('[UserStore] updateUser exception:', err.message);
        return { userId, ...updates };
      }
    }
    const data = await this.readUsersFile();
    const idx = data.users.findIndex(u => u.userId === userId);
    if (idx === -1) {
      console.warn('[UserStore] updateUser: user not found in file store:', userId);
      return { userId, ...updates };
    }
    const allowed = { ...updates };
    delete allowed.userId; delete allowed.createdAt;
    data.users[idx] = { ...data.users[idx], ...allowed, updatedAt: new Date().toISOString() };
    await this.writeUsersFile(data);
    return data.users[idx];
  }

  async deleteUser(userId) {
    // Cascade cleanup first — a hard delete of the user row with dangling
    // references left behind (assignments, group membership, JD profile)
    // breaks admin dashboards/exports that try to resolve a now-nonexistent
    // user_id. Historical records that exist for audit/compliance reasons
    // (assessment reports, submissions) are intentionally left untouched.
    await this._cleanupUserReferences(userId);

    if (useMySQL()) {
      const deleted = await mysqlDb.deleteRow('users', userId, 'user_id');
      if (!deleted) throw new Error('User not found');
      return true;
    }

    const sb = getSB();
    if (sb) {
      const { error } = await sb.from('users').delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
      return true;
    }
    const data = await this.readUsersFile();
    const initial = data.users.length;
    data.users = data.users.filter(u => u.userId !== userId);
    if (data.users.length === initial) throw new Error('User not found');
    const aData = await this.readAssignmentsFile();
    aData.assignments = aData.assignments.filter(a => a.managerId !== userId && a.employeeId !== userId);
    await this.writeAssignmentsFile(aData);
    await this.writeUsersFile(data);
    return true;
  }

  async _cleanupUserReferences(userId) {
    // Assignments — both directions (as the assignee, and as the assigner/manager).
    // MySQL's assigned_to_user FK (ON DELETE CASCADE) already handles the
    // assignee direction automatically once the user row itself is deleted
    // below, but assigned_by has no FK constraint (assigners aren't required
    // to still exist), so that direction still needs an explicit delete here
    // to match Supabase's behavior of removing assignments this user created.
    try {
      if (useMySQL()) {
        const pool = mysqlDb.getPool();
        await pool.query('DELETE FROM `assignments` WHERE `assigned_by` = ?', [userId]);
      } else {
        const sb = getSB();
        if (sb) {
          await sb.from('assignments').delete().eq('assigned_to_user', userId);
          await sb.from('assignments').delete().eq('assigned_by', userId);
        }
      }
    } catch (e) { console.warn('[deleteUser] assignment cleanup failed:', e.message); }

    // Group membership — remove from employeeIds, clear managerId if they managed it.
    // NOTE: Groups (DataStore.js) hasn't been wired for MySQL yet — this still
    // reads/writes wherever Groups itself is currently configured (Supabase
    // or file), independent of this file's DB_BACKEND setting, until
    // DataStore.js gets its own MySQL wiring in a later commit.
    try {
      const allGroups = await Groups.getAll();
      for (const g of allGroups || []) {
        const isMember = (g.employeeIds || []).includes(userId);
        const isManager = g.managerId === userId;
        if (!isMember && !isManager) continue;
        const updates = {};
        if (isMember) updates.employeeIds = (g.employeeIds || []).filter(id => id !== userId);
        if (isManager) { updates.managerId = null; updates.managerName = ''; }
        await Groups.update(g.id, updates);
      }
    } catch (e) { console.warn('[deleteUser] group membership cleanup failed:', e.message); }

    // JD profile
    try { await UserJDProfiles.delete(userId); } catch (e) { console.warn('[deleteUser] JD profile cleanup failed:', e.message); }
  }

  async getAllUsers(filters = {}) {
    if (useMySQL()) {
      let rows = await mysqlDb.selectAll('users');
      if (filters.role) rows = rows.filter(r => r.role === filters.role);
      if (filters.emailVerified !== undefined) rows = rows.filter(r => !!r.email_verified === filters.emailVerified);
      const users = rows.map(rowToUser);
      try {
        const jdProfiles = await UserJDProfiles.getAll();
        if (jdProfiles && jdProfiles.length > 0) {
          const jdMap = new Map(jdProfiles.map(p => [p.id, p]));
          return users.map(u => mergeJD(u, jdMap.get(u.userId)));
        }
      } catch {}
      return users;
    }
    const sb = getSB();
    if (sb) {
      let q = sb.from('users').select('*');
      if (filters.role) q = q.eq('role', filters.role);
      if (filters.emailVerified !== undefined) q = q.eq('email_verified', filters.emailVerified);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const users = (data || []).map(rowToUser);
      // Batch-merge JD profiles: one extra query, not N
      try {
        const jdProfiles = await UserJDProfiles.getAll();
        if (jdProfiles && jdProfiles.length > 0) {
          const jdMap = new Map(jdProfiles.map(p => [p.id, p]));
          return users.map(u => mergeJD(u, jdMap.get(u.userId)));
        }
      } catch {}
      return users;
    }
    const data = await this.readUsersFile();
    let users = data.users;
    if (filters.role) users = users.filter(u => u.role === filters.role);
    if (filters.emailVerified !== undefined) users = users.filter(u => u.emailVerified === filters.emailVerified);
    return users;
  }

  async getUsersByCompany(companyId) {
    if (useMySQL()) {
      const rows = await mysqlDb.selectWhere('users', { company_id: companyId });
      return (rows || []).map(rowToUser);
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('users').select('*').eq('company_id', companyId);
      if (error) throw new Error(error.message);
      return (data || []).map(rowToUser);
    }
    const data = await this.readUsersFile();
    return data.users.filter(u => u.companyId === companyId);
  }

  // ── Role helpers ──────────────────────────────────────────────────────────

  async updateUserRole(userId, newRole) {
    if (!this.validRoles.includes(newRole)) throw new Error(`Invalid role: ${newRole}`);
    return this.updateUser(userId, { role: newRole });
  }

  async getUsersByRole(role) {
    return this.getAllUsers({ role });
  }

  // ── Manager-Employee assignments ──────────────────────────────────────────

  async assignEmployeesToManager(managerId, employeeIds, assignedBy) {
    const manager = await this.getUserById(managerId);
    if (!manager) throw new Error('Manager not found');
    // Was `manager.role !== 'manager'`, which rejected admins outright AND
    // rejected anyone granted manager access via Manage Access (primary role
    // employee, accesses: ['manager']). That disagreed with bulk-import's own
    // ['manager','admin'] check and was why assigning such a user as a
    // manager failed silently from the dropdown and from bulk import.
    if (!canActAsManager(manager)) throw new Error('User must have manager capability');

    const employees = await Promise.all(employeeIds.map(id => this.getUserById(id)));
    for (let i = 0; i < employees.length; i++) {
      if (!employees[i]) throw new Error(`Employee ${employeeIds[i]} not found`);
      // Relaxed from `role !== 'employee'`: a manager can legitimately report
      // to another manager. Only reject targets that cannot sensibly report
      // (admins) and self-assignment.
      if (employees[i].role === 'admin') throw new Error(`User ${employeeIds[i]} is an admin and cannot be assigned a manager`);
      if ((employees[i].userId || employees[i].id) === managerId) throw new Error('A user cannot be their own manager');
    }

    // Persist on the employee's own user record (users.manager_id) FIRST —
    // this is a real Supabase column, durable across restarts. The local-file
    // mirror below (aData.assignments) previously was the ONLY place this
    // relationship was recorded, with no Supabase path at all — on an
    // ephemeral filesystem host, every manager-employee assignment made
    // through this endpoint was silently wiped on the next restart/redeploy,
    // which is why a manager's own dashboard could show zero direct reports
    // even after an admin had explicitly assigned them.
    await Promise.all(employeeIds.map(id => this.updateUser(id, { managerId })));

    const aData = await this.readAssignmentsFile();
    const created = [];
    for (const employeeId of employeeIds) {
      const exists = aData.assignments.find(a => a.managerId === managerId && a.employeeId === employeeId);
      if (!exists) {
        const a = {
          assignmentId: `assign_${String(aData.nextAssignmentId).padStart(3, '0')}`,
          managerId, employeeId,
          assignedAt: new Date().toISOString(),
          assignedBy,
        };
        aData.assignments.push(a);
        aData.nextAssignmentId += 1;
        created.push(a);
      }
    }
    await this.writeAssignmentsFile(aData);
    return created;
  }

  async removeEmployeeFromManager(managerId, employeeId) {
    const employee = await this.getUserById(employeeId);
    if (employee && employee.managerId === managerId) {
      await this.updateUser(employeeId, { managerId: null });
    }

    const aData = await this.readAssignmentsFile();
    const initial = aData.assignments.length;
    aData.assignments = aData.assignments.filter(a => !(a.managerId === managerId && a.employeeId === employeeId));
    // The durable users.manager_id link may exist even when this ephemeral
    // file has no matching row (e.g. it was wiped by a restart) — clearing
    // that field above is the real removal; don't fail the whole operation
    // just because the file-mirror had nothing to remove.
    await this.writeAssignmentsFile(aData);
    return true;
  }

  async getManagerEmployees(managerId) {
    // Union of the durable users.manager_id field (a real Supabase column —
    // set on every new assignment since the fix above, and by bulk-import)
    // with the ephemeral file-mirror, which may hold assignments made before
    // that fix or a Supabase outage. Without the durable source, a manager's
    // employee list could go to zero after any restart on an ephemeral
    // filesystem host even though the relationship was never actually removed.
    const allUsers = await this.getAllUsers({});
    const durableIds = allUsers.filter(u => u.managerId === managerId).map(u => u.userId || u.id);
    const aData = await this.readAssignmentsFile();
    const fileIds = aData.assignments.filter(a => a.managerId === managerId).map(a => a.employeeId);
    const ids = [...new Set([...durableIds, ...fileIds])];
    return this.getUsersByIds(ids);
  }

  async getEmployeeManagers(employeeId) {
    const employee = await this.getUserById(employeeId);
    const durableIds = employee?.managerId ? [employee.managerId] : [];
    const aData = await this.readAssignmentsFile();
    const fileIds = aData.assignments.filter(a => a.employeeId === employeeId).map(a => a.managerId);
    const ids = [...new Set([...durableIds, ...fileIds])];
    return this.getUsersByIds(ids);
  }

  // Batched lookup — replaces N individual getUserById() round-trips with one query.
  async getUsersByIds(ids) {
    if (!ids?.length) return [];
    if (useMySQL()) {
      const pool = mysqlDb.getPool();
      const placeholders = ids.map(() => '?').join(', ');
      const [rows] = await pool.query(`SELECT * FROM \`users\` WHERE \`user_id\` IN (${placeholders})`, ids);
      return (rows || []).map(rowToUser).filter(Boolean);
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('users').select('*').in('user_id', ids);
      if (!error) return (data || []).map(rowToUser).filter(Boolean);
    }
    const data = await this.readUsersFile();
    const idSet = new Set(ids);
    return (data.users || []).filter(u => idSet.has(u.userId || u.id));
  }

  async getEmployeesByManager(managerId) { return this.getManagerEmployees(managerId); }

  async getEmployeesByGroup(groupId) {
    const sb = getSB();
    if (sb) {
      // No groupId column in Supabase schema — fall through to file
    }
    const data = await this.readUsersFile();
    return data.users.filter(u => u.role === 'employee' && (u.groupId === groupId || u.group === groupId));
  }

  // ── Content assignments ───────────────────────────────────────────────────

  async getAssignments(filters = {}) {
    if (useMySQL()) {
      const pool = mysqlDb.getPool();
      const clauses = [];
      const values = [];
      if (filters.id)         { clauses.push('`id` = ?'); values.push(filters.id); }
      if (filters.user_id || filters.assigned_to_user) { clauses.push('`assigned_to_user` = ?'); values.push(filters.user_id || filters.assigned_to_user); }
      if (filters.group_id)  { clauses.push('`assigned_to_group` = ?'); values.push(filters.group_id); }
      if (filters.status)    { clauses.push('`status` = ?'); values.push(filters.status); }
      if (filters.assigned_by) { clauses.push('`assigned_by` = ?'); values.push(filters.assigned_by); }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await pool.query(`SELECT * FROM \`assignments\`${where}`, values);
      return rows || [];
    }
    const sb = getSB();
    if (sb) {
      let q = sb.from('assignments').select('*');
      if (filters.id)         q = q.eq('id', filters.id);
      if (filters.user_id || filters.assigned_to_user)
        q = q.eq('assigned_to_user', filters.user_id || filters.assigned_to_user);
      if (filters.group_id)  q = q.eq('assigned_to_group', filters.group_id);
      if (filters.status)    q = q.eq('status', filters.status);
      if (filters.assigned_by) q = q.eq('assigned_by', filters.assigned_by);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }
    const data = await this.readAssignmentsFile();
    let assignments = data.assignments || [];
    if (filters.id)          assignments = assignments.filter(a => a.id === filters.id);
    if (filters.user_id || filters.assigned_to_user)
      assignments = assignments.filter(a => a.assigned_to_user === (filters.user_id || filters.assigned_to_user));
    if (filters.group_id)   assignments = assignments.filter(a => a.assigned_to_group === filters.group_id);
    if (filters.status)     assignments = assignments.filter(a => a.status === filters.status);
    if (filters.type)       assignments = assignments.filter(a => a.assignable_type === filters.type || a.type === filters.type);
    if (filters.assigned_by) assignments = assignments.filter(a => a.assigned_by === filters.assigned_by);
    return assignments;
  }

  async createAssignment(assignmentData) {
    const sb = getSB();
    const newA = {
      id:                 `assign_${uuidv4().slice(0, 8)}`,
      type:               assignmentData.type || assignmentData.assignable_type || 'module',
      assignable_id:      assignmentData.assignable_id || assignmentData.assignableId,
      assignable_type:    assignmentData.assignable_type || assignmentData.type || 'module',
      assigned_by:        assignmentData.assigned_by || assignmentData.assignedBy || null,
      assigned_to_user:   assignmentData.assigned_to_user || assignmentData.assignedToUser || null,
      assigned_to_group:  assignmentData.assigned_to_group || assignmentData.assignedToGroup || null,
      assigned_by_manager:assignmentData.assigned_by_manager || null,
      priority:           assignmentData.priority || 'medium',
      due_date:           assignmentData.due_date || assignmentData.dueDate || null,
      status:             assignmentData.status || 'assigned',
      progress:           assignmentData.progress || 0,
      // Extra display fields (not in Supabase schema — stored for file fallback)
      title:              assignmentData.title || assignmentData.name || assignmentData.module_name || '',
      isMandatory:        assignmentData.isMandatory || false,
      created_at:         new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    };

    if (useMySQL()) {
      const mysqlRow = {
        id:                  newA.id,
        type:                newA.type,
        assignable_id:       newA.assignable_id,
        assignable_type:     newA.assignable_type,
        assigned_by:         newA.assigned_by || null,
        assigned_to_user:    newA.assigned_to_user,
        assigned_to_group:   newA.assigned_to_group,
        assigned_by_manager: newA.assigned_by_manager || null,
        priority:            newA.priority,
        due_date:            newA.due_date,
        status:              newA.status,
        progress:            newA.progress,
        module_name:         newA.title || null,
        created_at:          newA.created_at,
        updated_at:          newA.updated_at,
      };
      await mysqlDb.upsertRow('assignments', mysqlRow, Object.keys(mysqlRow).filter(k => k !== 'id'));
      return mysqlRow;
    }

    if (sb) {
      // Only send columns that exist in the Supabase schema
      // IMPORTANT: assigned_by/assigned_by_manager must be null or a valid user_id (FK constraint)
      const sbRow = {
        id:                  newA.id,
        type:                newA.type,
        assignable_id:       newA.assignable_id,
        assignable_type:     newA.assignable_type,
        assigned_by:         newA.assigned_by || null,
        assigned_to_user:    newA.assigned_to_user,
        assigned_to_group:   newA.assigned_to_group,
        assigned_by_manager: newA.assigned_by_manager || null,
        priority:            newA.priority,
        due_date:            newA.due_date,
        status:              newA.status,
        progress:            newA.progress,
        module_name:         newA.title || null,
      };
      let { data, error } = await sb.from('assignments')
        .upsert(sbRow, { onConflict: 'id' }).select().maybeSingle();
      if (error && (error.code === 'PGRST204' || (error.message && error.message.includes('module_name')))) {
        // module_name column not yet in DB schema — retry without it
        console.warn('[UserStore] createAssignment: module_name column missing, retrying without it');
        const { module_name: _mn, ...sbRowNoName } = sbRow;
        const retry = await sb.from('assignments').upsert(sbRowNoName, { onConflict: 'id' }).select().maybeSingle();
        error = retry.error;
        data = retry.data;
      }
      if (error) {
        console.error('[UserStore] createAssignment Supabase error:', error.message, '| code:', error.code);
        throw new Error(`[assignments] Supabase insert failed: ${error.message}`);
      }
      return data || newA;
    }

    const data = await this.readAssignmentsFile();
    newA.id = `assign_${String(data.nextAssignmentId || 1).padStart(4, '0')}`;
    data.assignments.push(newA);
    data.nextAssignmentId = (data.nextAssignmentId || 1) + 1;
    await this.writeAssignmentsFile(data);
    return newA;
  }

  async updateAssignment(assignmentId, updates) {
    if (useMySQL()) {
      const mysqlUpdates = { updated_at: new Date().toISOString() };
      if (updates.status !== undefined)           mysqlUpdates.status = updates.status;
      if (updates.progress !== undefined)         mysqlUpdates.progress = updates.progress;
      if (updates.due_date !== undefined)         mysqlUpdates.due_date = updates.due_date;
      if (updates.priority !== undefined)         mysqlUpdates.priority = updates.priority;
      if (updates.sessionProgress !== undefined)  mysqlUpdates.session_progress = updates.sessionProgress;
      if (updates.session_progress !== undefined) mysqlUpdates.session_progress = updates.session_progress;
      if (updates.progress_data !== undefined)    mysqlUpdates.progress_data = updates.progress_data;
      await mysqlDb.updateRow('assignments', assignmentId, mysqlUpdates, 'id');
      return await mysqlDb.selectById('assignments', assignmentId, 'id');
    }
    const sb = getSB();
    if (sb) {
      // Map camelCase to Supabase snake_case columns
      const sbUpdates = { updated_at: new Date().toISOString() };
      if (updates.status !== undefined)           sbUpdates.status = updates.status;
      if (updates.progress !== undefined)         sbUpdates.progress = updates.progress;
      if (updates.due_date !== undefined)         sbUpdates.due_date = updates.due_date;
      if (updates.priority !== undefined)         sbUpdates.priority = updates.priority;
      // Session progress stored in JSONB columns
      if (updates.sessionProgress !== undefined)  sbUpdates.session_progress = updates.sessionProgress;
      if (updates.session_progress !== undefined) sbUpdates.session_progress = updates.session_progress;
      if (updates.progress_data !== undefined)    sbUpdates.progress_data = updates.progress_data;
      let { data, error } = await sb.from('assignments')
        .update(sbUpdates)
        .eq('id', assignmentId).select().maybeSingle();
      // If session_progress/progress_data columns don't exist yet, retry without them
      if (error && (error.code === '42703' || error.message?.includes('session_progress') || error.message?.includes('progress_data'))) {
        const { session_progress: _sp, progress_data: _pd, ...sbUpdatesNoProgress } = sbUpdates;
        const retry = await sb.from('assignments').update(sbUpdatesNoProgress).eq('id', assignmentId).select().maybeSingle();
        error = retry.error;
        data  = retry.data;
      }
      if (error) throw new Error(error.message);
      return data;
    }
    const data = await this.readAssignmentsFile();
    const idx = data.assignments.findIndex(a => a.id === assignmentId);
    if (idx === -1) throw new Error('Assignment not found');
    const allowed = { ...updates }; delete allowed.id; delete allowed.created_at;
    data.assignments[idx] = { ...data.assignments[idx], ...allowed, updated_at: new Date().toISOString() };
    await this.writeAssignmentsFile(data);
    return data.assignments[idx];
  }

  async deleteAssignment(assignmentId) {
    if (useMySQL()) {
      const deleted = await mysqlDb.deleteRow('assignments', assignmentId, 'id');
      if (!deleted) throw new Error('Assignment not found');
      return true;
    }
    const sb = getSB();
    if (sb) {
      const { error } = await sb.from('assignments').delete().eq('id', assignmentId);
      if (error) throw new Error(error.message);
      return true;
    }
    const data = await this.readAssignmentsFile();
    const before = data.assignments.length;
    data.assignments = data.assignments.filter(a => a.id !== assignmentId);
    if (data.assignments.length === before) throw new Error('Assignment not found');
    await this.writeAssignmentsFile(data);
    return true;
  }

  // ── Assignment Requests ───────────────────────────────────────────────────

  async readRequestsFile() {
    try {
      const data = await fs.readFile(
        path.join(path.dirname(this.assignmentsFilePath), 'assignment_requests.json'), 'utf-8'
      );
      return JSON.parse(data);
    } catch { return { requests: [], nextId: 1 }; }
  }
  async writeRequestsFile(data) {
    await this._writeJsonAtomic(
      path.join(path.dirname(this.assignmentsFilePath), 'assignment_requests.json'),
      data
    );
  }

  async createAssignmentRequest(reqData) {
    if (useMySQL()) {
      const { randomUUID } = await import('crypto');
      const newReq = {
        id: `req_${randomUUID().slice(0, 8)}`,
        manager_id:   reqData.manager_id,
        employee_id:  reqData.employee_id || null,
        group_id:     reqData.group_id || null,
        module_id:    reqData.module_id,
        priority:     reqData.priority || 'medium',
        due_date:     reqData.due_date || null,
        status:       reqData.status || 'pending',
        requested_at: new Date().toISOString(),
        decided_by:   null,
        decided_at:   null,
      };
      await mysqlDb.insertRow('assignment_requests', newReq);
      return newReq;
    }
    const sb = getSB();
    if (sb) {
      const { randomUUID } = await import('crypto');
      const newReq = {
        id: `req_${randomUUID().slice(0, 8)}`,
        manager_id:   reqData.manager_id,
        employee_id:  reqData.employee_id || null,
        group_id:     reqData.group_id || null,
        module_id:    reqData.module_id,
        priority:     reqData.priority || 'medium',
        due_date:     reqData.due_date || null,
        status:       reqData.status || 'pending',
        requested_at: new Date().toISOString(),
        decided_by:   null,
        decided_at:   null,
      };
      const { data, error } = await sb.from('assignment_requests')
        .upsert(newReq, { onConflict: 'id' }).select().maybeSingle();
      if (error) {
        console.error('[UserStore] createAssignmentRequest:', error.message);
        // Persist to file fallback so the request isn't silently lost
        const fileData = await this.readRequestsFile();
        fileData.requests.push(newReq);
        fileData.nextId = (fileData.nextId || 1) + 1;
        await this.writeRequestsFile(fileData);
      }
      return data || newReq;
    }
    const fileData = await this.readRequestsFile();
    const id = `req_${String(fileData.nextId || 1).padStart(4, '0')}`;
    const newReq = {
      id,
      manager_id:   reqData.manager_id,
      employee_id:  reqData.employee_id || null,
      group_id:     reqData.group_id || null,
      module_id:    reqData.module_id,
      priority:     reqData.priority || 'medium',
      due_date:     reqData.due_date || null,
      status:       reqData.status || 'pending',
      requested_at: new Date().toISOString(),
      decided_by:   null,
      decided_at:   null,
    };
    fileData.requests.push(newReq);
    fileData.nextId = (fileData.nextId || 1) + 1;
    await this.writeRequestsFile(fileData);
    return newReq;
  }

  async getAssignmentRequests(filters = {}) {
    if (useMySQL()) {
      const where = {};
      if (filters.manager_id)  where.manager_id = filters.manager_id;
      if (filters.employee_id) where.employee_id = filters.employee_id;
      if (filters.status)      where.status = filters.status;
      return (await mysqlDb.selectWhere('assignment_requests', where)) || [];
    }
    const sb = getSB();
    if (sb) {
      let q = sb.from('assignment_requests').select('*');
      if (filters.manager_id)  q = q.eq('manager_id', filters.manager_id);
      if (filters.employee_id) q = q.eq('employee_id', filters.employee_id);
      if (filters.status)      q = q.eq('status', filters.status);
      const { data, error } = await q;
      if (error) { console.error('[UserStore] getAssignmentRequests:', error.message); return []; }
      return data || [];
    }
    const fileData = await this.readRequestsFile();
    let requests = fileData.requests || [];
    if (filters.manager_id)  requests = requests.filter(r => r.manager_id === filters.manager_id);
    if (filters.employee_id) requests = requests.filter(r => r.employee_id === filters.employee_id);
    if (filters.status)      requests = requests.filter(r => r.status === filters.status);
    return requests;
  }

  async updateAssignmentRequest(requestId, updates) {
    if (useMySQL()) {
      const mysqlUpdates = { ...updates, decided_at: new Date().toISOString() };
      await mysqlDb.updateRow('assignment_requests', requestId, mysqlUpdates, 'id');
      return (await mysqlDb.selectById('assignment_requests', requestId, 'id')) || { id: requestId, ...updates };
    }
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('assignment_requests')
        .update({ ...updates, decided_at: new Date().toISOString() })
        .eq('id', requestId).select().maybeSingle();
      if (error) { console.error('[UserStore] updateAssignmentRequest:', error.message); }
      return data || { id: requestId, ...updates };
    }
    const fileData = await this.readRequestsFile();
    const idx = fileData.requests.findIndex(r => r.id === requestId);
    if (idx === -1) throw new Error('Request not found');
    fileData.requests[idx] = { ...fileData.requests[idx], ...updates };
    await this.writeRequestsFile(fileData);
    return fileData.requests[idx];
  }

  // ── Audit logging ─────────────────────────────────────────────────────────

  // Audit logs previously wrote ONLY to a local JSON file, with no Supabase
  // path at all — on any ephemeral-filesystem host (the app's Render free
  // tier target, per the durability notes elsewhere in this file) the entire
  // security audit trail is silently wiped on every restart/redeploy, even
  // though Supabase is configured and used for everything else. Now tries
  // Supabase first (table defined in sql/supabase_schema.sql) and only falls
  // back to the file if that fails — e.g. the migration hasn't been run yet.
  async logAuthEvent(eventType, userId, metadata = {}) {
    const logId = `log_${uuidv4().slice(0, 12)}`;
    const timestamp = new Date().toISOString();
    const logEntry = { logId, eventType, userId: userId || null, timestamp, metadata };

    if (useMySQL()) {
      try {
        await mysqlDb.insertRow('audit_logs', {
          log_id: logId, event_type: eventType, user_id: userId || null, metadata, timestamp,
        });
        return logEntry;
      } catch (e) {
        console.warn('[UserStore] logAuthEvent MySQL insert failed, falling back to file:', e.message);
      }
    }

    const sb = getSB();
    if (sb) {
      try {
        const { error } = await sb.from('audit_logs').insert({
          log_id: logId, event_type: eventType, user_id: userId || null, metadata, timestamp,
        });
        if (!error) return logEntry;
      } catch { /* fall through to file */ }
    }

    try {
      const auditData = await this.readAuditFile();
      auditData.logs.push(logEntry);
      auditData.nextLogId = (auditData.nextLogId || 1) + 1;
      await this.writeAuditFile(auditData);
      return logEntry;
    } catch { return {}; }
  }

  async getAuditLogs(filters = {}) {
    let logs = null;
    if (useMySQL()) {
      try {
        const pool = mysqlDb.getPool();
        const clauses = [];
        const values = [];
        if (filters.userId)    { clauses.push('`user_id` = ?'); values.push(filters.userId); }
        if (filters.eventType) { clauses.push('`event_type` = ?'); values.push(filters.eventType); }
        if (filters.startDate) { clauses.push('`timestamp` >= ?'); values.push(filters.startDate); }
        if (filters.endDate)   { clauses.push('`timestamp` <= ?'); values.push(filters.endDate); }
        const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
        const [rows] = await pool.query(`SELECT * FROM \`audit_logs\`${where} ORDER BY \`timestamp\` DESC`, values);
        logs = rows.map(r => ({ logId: r.log_id, eventType: r.event_type, userId: r.user_id, timestamp: r.timestamp, metadata: r.metadata || {} }));
      } catch (e) {
        console.warn('[UserStore] getAuditLogs MySQL query failed, falling back:', e.message);
      }
    }

    const sb = !logs ? getSB() : null;
    if (sb) {
      try {
        let q = sb.from('audit_logs').select('*').order('timestamp', { ascending: false });
        if (filters.userId)    q = q.eq('user_id', filters.userId);
        if (filters.eventType) q = q.eq('event_type', filters.eventType);
        if (filters.startDate) q = q.gte('timestamp', filters.startDate);
        if (filters.endDate)   q = q.lte('timestamp', filters.endDate);
        const { data, error } = await q;
        if (!error && data) {
          logs = data.map(r => ({ logId: r.log_id, eventType: r.event_type, userId: r.user_id, timestamp: r.timestamp, metadata: r.metadata || {} }));
        }
      } catch { /* fall through to file */ }
    }

    if (!logs) {
      const auditData = await this.readAuditFile();
      logs = auditData.logs;
      if (filters.userId)    logs = logs.filter(l => l.userId === filters.userId);
      if (filters.eventType) logs = logs.filter(l => l.eventType === filters.eventType);
      if (filters.startDate) logs = logs.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
      if (filters.endDate)   logs = logs.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    // roleId lives inside metadata (every assessment-engine audit event —
    // assessment_locked/unlocked/regenerated/modification_blocked,
    // question_locked/unlocked — logs { roleId, ... }), not a top-level
    // column, so this filters on the nested field rather than l.roleId.
    if (filters.roleId) logs = logs.filter(l => l.metadata?.roleId === filters.roleId);
    return logs;
  }
}

export default new UserStore();
