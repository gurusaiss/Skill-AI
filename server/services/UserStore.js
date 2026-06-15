import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { UserJDProfiles } from './DataStore.js';

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
    // Auth fields
    otp:                 row.otp || null,
    otpExpires:          row.otp_expires || null,
    resetToken:          row.reset_token || null,
    resetTokenExpires:   row.reset_token_expires || null,
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
  if (u.otp          !== undefined) row.otp                = u.otp;
  if (u.otpExpires   !== undefined) row.otp_expires        = u.otpExpires;
  if (u.resetToken   !== undefined) row.reset_token        = u.resetToken;
  if (u.resetTokenExpires !== undefined) row.reset_token_expires = u.resetTokenExpires;
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

  async readUsersFile() {
    try {
      const data = await fs.readFile(this.usersFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { users: [], nextUserId: 1 }; }
  }
  async writeUsersFile(data) {
    await fs.writeFile(this.usersFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  async readAssignmentsFile() {
    try {
      const data = await fs.readFile(this.assignmentsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { assignments: [], nextAssignmentId: 1 }; }
  }
  async writeAssignmentsFile(data) {
    await fs.writeFile(this.assignmentsFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  async readAuditFile() {
    try {
      const data = await fs.readFile(this.auditFilePath, 'utf-8');
      return JSON.parse(data);
    } catch { return { logs: [], nextLogId: 1 }; }
  }
  async writeAuditFile(data) {
    await fs.writeFile(this.auditFilePath, JSON.stringify(data, null, 2), 'utf-8');
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

  async getAllUsers(filters = {}) {
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
    if (manager.role !== 'manager') throw new Error('User must have manager role');

    const employees = await Promise.all(employeeIds.map(id => this.getUserById(id)));
    for (let i = 0; i < employees.length; i++) {
      if (!employees[i]) throw new Error(`Employee ${employeeIds[i]} not found`);
      if (employees[i].role !== 'employee') throw new Error(`User ${employeeIds[i]} must have employee role`);
    }

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
    const aData = await this.readAssignmentsFile();
    const initial = aData.assignments.length;
    aData.assignments = aData.assignments.filter(a => !(a.managerId === managerId && a.employeeId === employeeId));
    if (aData.assignments.length === initial) throw new Error('Assignment not found');
    await this.writeAssignmentsFile(aData);
    return true;
  }

  async getManagerEmployees(managerId) {
    const aData = await this.readAssignmentsFile();
    const ids = aData.assignments.filter(a => a.managerId === managerId).map(a => a.employeeId);
    const employees = await Promise.all(ids.map(id => this.getUserById(id)));
    return employees.filter(Boolean);
  }

  async getEmployeeManagers(employeeId) {
    const aData = await this.readAssignmentsFile();
    const ids = aData.assignments.filter(a => a.employeeId === employeeId).map(a => a.managerId);
    const managers = await Promise.all(ids.map(id => this.getUserById(id)));
    return managers.filter(Boolean);
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
    const sb = getSB();
    if (sb) {
      let q = sb.from('assignments').select('*');
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

    if (sb) {
      // Only send columns that exist in the Supabase schema
      const sbRow = {
        id:                  newA.id,
        type:                newA.type,
        assignable_id:       newA.assignable_id,
        assignable_type:     newA.assignable_type,
        assigned_by:         newA.assigned_by,
        assigned_to_user:    newA.assigned_to_user,
        assigned_to_group:   newA.assigned_to_group,
        assigned_by_manager: newA.assigned_by_manager,
        priority:            newA.priority,
        due_date:            newA.due_date,
        status:              newA.status,
        progress:            newA.progress,
      };
      // upsert (not insert): id retries must not fail silently
      const { data, error } = await sb.from('assignments')
        .upsert(sbRow, { onConflict: 'id' }).select().maybeSingle();
      if (error) {
        console.error('[UserStore] createAssignment:', error.message);
        // Don't lose the assignment — persist to the file fallback so the
        // self-healing layer can re-sync it later
        const fileData = await this.readAssignmentsFile();
        fileData.assignments.push(newA);
        fileData.nextAssignmentId = (fileData.nextAssignmentId || 1) + 1;
        await this.writeAssignmentsFile(fileData);
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
    const sb = getSB();
    if (sb) {
      const { data, error } = await sb.from('assignments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', assignmentId).select().single();
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
    await fs.writeFile(
      path.join(path.dirname(this.assignmentsFilePath), 'assignment_requests.json'),
      JSON.stringify(data, null, 2), 'utf-8'
    );
  }

  async createAssignmentRequest(reqData) {
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

  async logAuthEvent(eventType, userId, metadata = {}) {
    try {
      const auditData = await this.readAuditFile();
      const logEntry = {
        logId:     `log_${String(auditData.nextLogId).padStart(6, '0')}`,
        eventType, userId: userId || null,
        timestamp: new Date().toISOString(),
        metadata,
      };
      auditData.logs.push(logEntry);
      auditData.nextLogId += 1;
      await this.writeAuditFile(auditData);
      return logEntry;
    } catch { return {}; }
  }

  async getAuditLogs(filters = {}) {
    const auditData = await this.readAuditFile();
    let logs = auditData.logs;
    if (filters.userId)    logs = logs.filter(l => l.userId === filters.userId);
    if (filters.eventType) logs = logs.filter(l => l.eventType === filters.eventType);
    if (filters.startDate) logs = logs.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
    if (filters.endDate)   logs = logs.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return logs;
  }
}

export default new UserStore();
