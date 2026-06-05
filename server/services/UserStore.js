import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * UserStore - Manages user data persistence
 * - User CRUD operations
 * - Role management
 * - Manager-Employee assignments
 * - Audit logging
 */
class UserStore {
  constructor() {
    this.usersFilePath = path.join(__dirname, '../data/users.json');
    this.assignmentsFilePath = path.join(__dirname, '../data/assignments.json');
    this.auditFilePath = path.join(__dirname, '../data/audit.json');
    this.validRoles = ['superadmin', 'admin', 'manager', 'employee'];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // File I/O Helpers
  // ────────────────────────────────────────────────────────────────────────────

  async readUsersFile() {
    try {
      const data = await fs.readFile(this.usersFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // If file doesn't exist, return default structure
      return { users: [], nextUserId: 1 };
    }
  }

  async writeUsersFile(data) {
    await fs.writeFile(this.usersFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async readAssignmentsFile() {
    try {
      const data = await fs.readFile(this.assignmentsFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return { assignments: [], nextAssignmentId: 1 };
    }
  }

  async writeAssignmentsFile(data) {
    await fs.writeFile(this.assignmentsFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async readAuditFile() {
    try {
      const data = await fs.readFile(this.auditFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return { logs: [], nextLogId: 1 };
    }
  }

  async writeAuditFile(data) {
    await fs.writeFile(this.auditFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // User CRUD Operations
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  async createUser(userData) {
    const data = await this.readUsersFile();

    // Check if email already exists
    const existingUser = data.users.find(u => u.email === userData.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    const newUser = {
      userId: `auth_user_${String(data.nextUserId).padStart(3, '0')}`,
      email: userData.email,
      passwordHash: userData.passwordHash,
      name: userData.name || '',
      role: userData.role || 'employee',
      learningUUID: userData.learningUUID || uuidv4(),
      emailVerified: userData.emailVerified || false,
      otp: null,
      otpExpires: null,
      resetToken: null,
      resetTokenExpires: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: null,
      managerId: null,
      googleId: userData.googleId || null,
      // Extended profile fields
      jobRole: userData.jobRole || '',
      department: userData.department || '',
      jobDescription: userData.jobDescription || '',      // plain text JD
      jobDescriptionFile: userData.jobDescriptionFile || null, // { name, path, type, size }
      onboardingComplete: userData.onboardingComplete || false,
      companyName: userData.companyName || '',
      companyId: userData.companyId || 'default',
    };

    data.users.push(newUser);
    data.nextUserId += 1;

    await this.writeUsersFile(data);
    return newUser;
  }

  /**
   * Get user by ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} User or null
   */
  async getUserById(userId) {
    const data = await this.readUsersFile();
    return data.users.find(u => u.userId === userId) || null;
  }

  /**
   * Get user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User or null
   */
  async getUserByEmail(email) {
    const data = await this.readUsersFile();
    return data.users.find(u => u.email === email) || null;
  }

  /**
   * Get user by Google ID
   * @param {string} googleId - Google OAuth ID
   * @returns {Promise<Object|null>} User or null
   */
  async getUserByGoogleId(googleId) {
    const data = await this.readUsersFile();
    return data.users.find(u => u.googleId === googleId) || null;
  }

  /**
   * Update user
   * @param {string} userId - User ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated user
   */
  async updateUser(userId, updates) {
    const data = await this.readUsersFile();
    const userIndex = data.users.findIndex(u => u.userId === userId);

    if (userIndex === -1) {
      throw new Error('User not found');
    }

    // Prevent updating certain fields
    const allowedUpdates = { ...updates };
    delete allowedUpdates.userId;
    delete allowedUpdates.createdAt;

    data.users[userIndex] = {
      ...data.users[userIndex],
      ...allowedUpdates,
      updatedAt: new Date().toISOString()
    };

    await this.writeUsersFile(data);
    return data.users[userIndex];
  }

  /**
   * Delete user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async deleteUser(userId) {
    const data = await this.readUsersFile();
    const initialLength = data.users.length;
    data.users = data.users.filter(u => u.userId !== userId);

    if (data.users.length === initialLength) {
      throw new Error('User not found');
    }

    // Also remove any manager-employee assignments
    const assignmentsData = await this.readAssignmentsFile();
    assignmentsData.assignments = assignmentsData.assignments.filter(
      a => a.managerId !== userId && a.employeeId !== userId
    );
    await this.writeAssignmentsFile(assignmentsData);

    await this.writeUsersFile(data);
    return true;
  }

  /**
   * Get all users
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} Array of users
   */
  async getAllUsers(filters = {}) {
    const data = await this.readUsersFile();
    let users = data.users;

    if (filters.role) {
      users = users.filter(u => u.role === filters.role);
    }

    if (filters.emailVerified !== undefined) {
      users = users.filter(u => u.emailVerified === filters.emailVerified);
    }

    return users;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Role Management
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Update user role
   * @param {string} userId - User ID
   * @param {string} newRole - New role (admin, manager, employee)
   * @returns {Promise<Object>} Updated user
   */
  async updateUserRole(userId, newRole) {
    if (!this.validRoles.includes(newRole)) {
      throw new Error(`Invalid role. Must be one of: ${this.validRoles.join(', ')}`);
    }

    return await this.updateUser(userId, { role: newRole });
  }

  /**
   * Get users by role
   * @param {string} role - Role to filter by
   * @returns {Promise<Array>} Array of users
   */
  async getUsersByRole(role) {
    if (!this.validRoles.includes(role)) {
      throw new Error(`Invalid role. Must be one of: ${this.validRoles.join(', ')}`);
    }

    return await this.getAllUsers({ role });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Manager-Employee Assignments
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Assign employees to a manager
   * @param {string} managerId - Manager user ID
   * @param {Array<string>} employeeIds - Array of employee user IDs
   * @param {string} assignedBy - Admin user ID who made the assignment
   * @returns {Promise<Array>} Created assignments
   */
  async assignEmployeesToManager(managerId, employeeIds, assignedBy) {
    // Validate manager has manager role
    const manager = await this.getUserById(managerId);
    if (!manager) {
      throw new Error('Manager not found');
    }
    if (manager.role !== 'manager') {
      throw new Error('User must have manager role');
    }

    // Validate all employees have employee role
    const employees = await Promise.all(
      employeeIds.map(id => this.getUserById(id))
    );

    for (let i = 0; i < employees.length; i++) {
      if (!employees[i]) {
        throw new Error(`Employee ${employeeIds[i]} not found`);
      }
      if (employees[i].role !== 'employee') {
        throw new Error(`User ${employeeIds[i]} must have employee role`);
      }
    }

    const assignmentsData = await this.readAssignmentsFile();
    const createdAssignments = [];

    for (const employeeId of employeeIds) {
      // Check if assignment already exists
      const existingAssignment = assignmentsData.assignments.find(
        a => a.managerId === managerId && a.employeeId === employeeId
      );

      if (!existingAssignment) {
        const newAssignment = {
          assignmentId: `assign_${String(assignmentsData.nextAssignmentId).padStart(3, '0')}`,
          managerId,
          employeeId,
          assignedAt: new Date().toISOString(),
          assignedBy
        };

        assignmentsData.assignments.push(newAssignment);
        assignmentsData.nextAssignmentId += 1;
        createdAssignments.push(newAssignment);
      }
    }

    await this.writeAssignmentsFile(assignmentsData);
    return createdAssignments;
  }

  /**
   * Remove employee from manager
   * @param {string} managerId - Manager user ID
   * @param {string} employeeId - Employee user ID
   * @returns {Promise<boolean>} Success
   */
  async removeEmployeeFromManager(managerId, employeeId) {
    const assignmentsData = await this.readAssignmentsFile();
    const initialLength = assignmentsData.assignments.length;

    assignmentsData.assignments = assignmentsData.assignments.filter(
      a => !(a.managerId === managerId && a.employeeId === employeeId)
    );

    if (assignmentsData.assignments.length === initialLength) {
      throw new Error('Assignment not found');
    }

    await this.writeAssignmentsFile(assignmentsData);
    return true;
  }

  /**
   * Get manager's assigned employees
   * @param {string} managerId - Manager user ID
   * @returns {Promise<Array>} Array of employee user objects
   */
  async getManagerEmployees(managerId) {
    const assignmentsData = await this.readAssignmentsFile();
    const assignments = assignmentsData.assignments.filter(
      a => a.managerId === managerId
    );

    const employeeIds = assignments.map(a => a.employeeId);
    const employees = await Promise.all(
      employeeIds.map(id => this.getUserById(id))
    );

    return employees.filter(e => e !== null);
  }

  /**
   * Get employee's assigned manager(s)
   * @param {string} employeeId - Employee user ID
   * @returns {Promise<Array>} Array of manager user objects
   */
  async getEmployeeManagers(employeeId) {
    const assignmentsData = await this.readAssignmentsFile();
    const assignments = assignmentsData.assignments.filter(
      a => a.employeeId === employeeId
    );

    const managerIds = assignments.map(a => a.managerId);
    const managers = await Promise.all(
      managerIds.map(id => this.getUserById(id))
    );

    return managers.filter(m => m !== null);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Audit Logging
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Log an authentication event
   * @param {string} eventType - Type of event
   * @param {string} userId - User ID (optional)
   * @param {Object} metadata - Additional event data
   * @returns {Promise<Object>} Created log entry
   */
  async logAuthEvent(eventType, userId, metadata = {}) {
    const auditData = await this.readAuditFile();

    const logEntry = {
      logId: `log_${String(auditData.nextLogId).padStart(6, '0')}`,
      eventType,
      userId: userId || null,
      timestamp: new Date().toISOString(),
      metadata
    };

    auditData.logs.push(logEntry);
    auditData.nextLogId += 1;

    await this.writeAuditFile(auditData);
    return logEntry;
  }

  /**
   * Get audit logs with optional filters
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Array of log entries
   */
  async getAuditLogs(filters = {}) {
    const auditData = await this.readAuditFile();
    let logs = auditData.logs;

    if (filters.userId) {
      logs = logs.filter(l => l.userId === filters.userId);
    }

    if (filters.eventType) {
      logs = logs.filter(l => l.eventType === filters.eventType);
    }

    if (filters.startDate) {
      logs = logs.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
    }

    if (filters.endDate) {
      logs = logs.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
    }

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return logs;
  }

  /**
   * Get employees by manager ID (alias for getManagerEmployees)
   * @param {string} managerId - Manager user ID
   * @returns {Promise<Array>} Array of employee user objects
   */
  async getEmployeesByManager(managerId) {
    return this.getManagerEmployees(managerId);
  }

  /**
   * Get employees by group ID
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} Array of employee user objects
   */
  async getEmployeesByGroup(groupId) {
    const data = await this.readUsersFile();
    const employees = data.users.filter(u => 
      u.role === 'employee' && (u.groupId === groupId || u.group === groupId)
    );
    return employees;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Content Assignment CRUD
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Get content assignments with optional filters
   * @param {Object} filters - Filter options (user_id, group_id, status, type, assigned_to_user, assigned_by)
   * @returns {Promise<Array>} Array of assignment objects
   */
  async getAssignments(filters = {}) {
    const data = await this.readAssignmentsFile();
    let assignments = data.assignments || [];

    if (filters.user_id) {
      assignments = assignments.filter(a => a.assigned_to_user === filters.user_id);
    }
    if (filters.assigned_to_user) {
      assignments = assignments.filter(a => a.assigned_to_user === filters.assigned_to_user);
    }
    if (filters.group_id) {
      assignments = assignments.filter(a => a.assigned_to_group === filters.group_id);
    }
    if (filters.status) {
      assignments = assignments.filter(a => a.status === filters.status);
    }
    if (filters.type) {
      assignments = assignments.filter(a => a.assignable_type === filters.type || a.type === filters.type);
    }
    if (filters.assigned_by) {
      assignments = assignments.filter(a => a.assigned_by === filters.assigned_by);
    }

    return assignments;
  }

  /**
   * Create a new content assignment
   * @param {Object} assignmentData - Assignment data
   * @returns {Promise<Object>} Created assignment
   */
  async createAssignment(assignmentData) {
    const data = await this.readAssignmentsFile();

    const newAssignment = {
      id: `assign_${String(data.nextAssignmentId || 1).padStart(4, '0')}`,
      type: assignmentData.type || assignmentData.assignable_type || 'module',
      assignable_id: assignmentData.assignable_id || assignmentData.assignableId,
      assignable_type: assignmentData.assignable_type || assignmentData.type || 'module',
      assigned_by: assignmentData.assigned_by || assignmentData.assignedBy,
      assigned_to_user: assignmentData.assigned_to_user || assignmentData.assignedToUser || null,
      assigned_to_group: assignmentData.assigned_to_group || assignmentData.assignedToGroup || null,
      assigned_by_manager: assignmentData.assigned_by_manager || null,
      priority: assignmentData.priority || 'medium',
      due_date: assignmentData.due_date || assignmentData.dueDate || null,
      status: assignmentData.status || 'assigned',
      progress: assignmentData.progress || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    data.assignments.push(newAssignment);
    data.nextAssignmentId = (data.nextAssignmentId || 1) + 1;

    await this.writeAssignmentsFile(data);
    return newAssignment;
  }

  /**
   * Update an existing assignment
   * @param {string} assignmentId - Assignment ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated assignment
   */
  async updateAssignment(assignmentId, updates) {
    const data = await this.readAssignmentsFile();
    const index = data.assignments.findIndex(a => a.id === assignmentId);

    if (index === -1) {
      throw new Error('Assignment not found');
    }

    const allowedUpdates = { ...updates };
    delete allowedUpdates.id;
    delete allowedUpdates.created_at;

    data.assignments[index] = {
      ...data.assignments[index],
      ...allowedUpdates,
      updated_at: new Date().toISOString(),
    };

    await this.writeAssignmentsFile(data);
    return data.assignments[index];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Assignment Requests (Manager → Admin approval workflow)
  // ────────────────────────────────────────────────────────────────────────────

  async readRequestsFile() {
    try {
      const data = await fs.readFile(
        path.join(path.dirname(this.assignmentsFilePath), 'assignment_requests.json'), 'utf-8'
      );
      return JSON.parse(data);
    } catch {
      return { requests: [], nextId: 1 };
    }
  }

  async writeRequestsFile(data) {
    await fs.writeFile(
      path.join(path.dirname(this.assignmentsFilePath), 'assignment_requests.json'),
      JSON.stringify(data, null, 2), 'utf-8'
    );
  }

  async createAssignmentRequest(reqData) {
    const data = await this.readRequestsFile();
    const id = `req_${String(data.nextId || 1).padStart(4, '0')}`;
    const newReq = {
      id,
      manager_id: reqData.manager_id,
      employee_id: reqData.employee_id,
      module_id: reqData.module_id,
      status: reqData.status || 'pending',
      requested_at: new Date().toISOString(),
      decided_by: null,
      decided_at: null,
    };
    data.requests.push(newReq);
    data.nextId = (data.nextId || 1) + 1;
    await this.writeRequestsFile(data);
    return newReq;
  }

  async getAssignmentRequests(filters = {}) {
    const data = await this.readRequestsFile();
    let reqs = data.requests || [];
    if (filters.status) reqs = reqs.filter(r => r.status === filters.status);
    if (filters.manager_id) reqs = reqs.filter(r => r.manager_id === filters.manager_id);
    return reqs.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
  }

  async updateAssignmentRequest(id, updates) {
    const data = await this.readRequestsFile();
    const idx = data.requests.findIndex(r => r.id === id);
    if (idx === -1) throw new Error('Assignment request not found');
    data.requests[idx] = {
      ...data.requests[idx],
      ...updates,
      decided_at: new Date().toISOString(),
    };
    await this.writeRequestsFile(data);
    return data.requests[idx];
  }

  /**
   * Delete an assignment
   * @param {string} assignmentId - Assignment ID
   * @returns {Promise<boolean>} Success
   */
  async deleteAssignment(assignmentId) {
    const data = await this.readAssignmentsFile();
    const initialLength = data.assignments.length;
    data.assignments = data.assignments.filter(a => a.id !== assignmentId);

    if (data.assignments.length === initialLength) {
      throw new Error('Assignment not found');
    }

    await this.writeAssignmentsFile(data);
    return true;
  }

  /**
   * Get all users belonging to a specific company
   * @param {string} companyId - Company ID
   * @returns {Promise<Array>} Array of users in that company
   */
  async getUsersByCompany(companyId) {
    const data = await this.readUsersFile();
    return data.users.filter(u => (u.companyId || 'default') === companyId);
  }
}

export default new UserStore();
