/**
 * seed-demo-accounts.js
 * Creates comprehensive demo accounts with proper roles and grouping
 * Run with: node seed-demo-accounts.js
 */

import AuthService from './services/AuthService.js';
import UserStore from './services/UserStore.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// DEMO ACCOUNT DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = {
  ADMIN: [
    {
      email: 'admin@gmail.com',
      password: 'Admin@123456',
      name: 'Admin User',
      role: 'admin',
    },
  ],
  MANAGERS: [
    {
      email: 'manager1@gmail.com',
      password: 'Manager@123456',
      name: 'Manager - Group A',
      role: 'manager',
      groupId: 'group_a',
    },
    {
      email: 'manager2@gmail.com',
      password: 'Manager@123456',
      name: 'Manager - Group B',
      role: 'manager',
      groupId: 'group_b',
    },
    {
      email: 'manager3@gmail.com',
      password: 'Manager@123456',
      name: 'Manager - Group C',
      role: 'manager',
      groupId: 'group_c',
    },
  ],
  EMPLOYEES: [
    // Group A (5 employees)
    { email: 'employee1@gmail.com', password: 'Employee@123456', name: 'Employee 1 - Full Stack', role: 'employee', groupId: 'group_a' },
    { email: 'employee2@gmail.com', password: 'Employee@123456', name: 'Employee 2 - Backend', role: 'employee', groupId: 'group_a' },
    { email: 'employee3@gmail.com', password: 'Employee@123456', name: 'Employee 3 - Frontend', role: 'employee', groupId: 'group_a' },
    { email: 'employee4@gmail.com', password: 'Employee@123456', name: 'Employee 4 - DevOps', role: 'employee', groupId: 'group_a' },
    { email: 'employee5@gmail.com', password: 'Employee@123456', name: 'Employee 5 - Data', role: 'employee', groupId: 'group_a' },
    
    // Group B (5 employees)
    { email: 'employee6@gmail.com', password: 'Employee@123456', name: 'Employee 6 - QA', role: 'employee', groupId: 'group_b' },
    { email: 'employee7@gmail.com', password: 'Employee@123456', name: 'Employee 7 - Security', role: 'employee', groupId: 'group_b' },
    { email: 'employee8@gmail.com', password: 'Employee@123456', name: 'Employee 8 - ML', role: 'employee', groupId: 'group_b' },
    { email: 'employee9@gmail.com', password: 'Employee@123456', name: 'Employee 9 - Cloud', role: 'employee', groupId: 'group_b' },
    { email: 'employee10@gmail.com', password: 'Employee@123456', name: 'Employee 10 - Architect', role: 'employee', groupId: 'group_b' },
    
    // Group C (5 employees)
    { email: 'employee11@gmail.com', password: 'Employee@123456', name: 'Employee 11 - PM', role: 'employee', groupId: 'group_c' },
    { email: 'employee12@gmail.com', password: 'Employee@123456', name: 'Employee 12 - UI/UX', role: 'employee', groupId: 'group_c' },
    { email: 'employee13@gmail.com', password: 'Employee@123456', name: 'Employee 13 - Mobile', role: 'employee', groupId: 'group_c' },
    { email: 'employee14@gmail.com', password: 'Employee@123456', name: 'Employee 14 - DevTools', role: 'employee', groupId: 'group_c' },
    { email: 'employee15@gmail.com', password: 'Employee@123456', name: 'Employee 15 - Integration', role: 'employee', groupId: 'group_c' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PREBUILT MODULES
// ─────────────────────────────────────────────────────────────────────────────

const PREBUILT_MODULES = [
  {
    id: 'module_001',
    title: 'Full Stack Web Development Mastery',
    description: 'Complete path to becoming a production-ready full stack developer with React, Node.js, and PostgreSQL.',
    category: 'Web Development',
    difficulty: 'intermediate',
    estimatedDuration: '14 days',
    skills: ['React', 'Node.js', 'PostgreSQL', 'REST APIs', 'Deployment'],
    tasks: [
      { id: 'task_001', title: 'Setup development environment', type: 'setup' },
      { id: 'task_002', title: 'Build responsive UI with React', type: 'project' },
      { id: 'task_003', title: 'Create RESTful APIs with Node.js', type: 'project' },
      { id: 'task_004', title: 'Database design and optimization', type: 'concept' },
      { id: 'task_005', title: 'Deploy to production', type: 'project' },
    ],
    resources: [
      { type: 'course', url: 'https://react.dev', title: 'React Official Docs' },
      { type: 'docs', url: 'https://nodejs.org', title: 'Node.js Documentation' },
      { type: 'tutorial', url: 'https://postgresql.org', title: 'PostgreSQL Guide' },
    ],
    completionCriteria: '80% average across all tasks',
    progressTracking: true,
  },
  {
    id: 'module_002',
    title: 'Python Data Science & Machine Learning',
    description: 'Master data analysis, visualization, and machine learning with Python.',
    category: 'Data Science',
    difficulty: 'advanced',
    estimatedDuration: '21 days',
    skills: ['Python', 'Pandas', 'NumPy', 'Scikit-learn', 'TensorFlow'],
    tasks: [
      { id: 'task_101', title: 'Python fundamentals and libraries', type: 'concept' },
      { id: 'task_102', title: 'Data cleaning and transformation', type: 'project' },
      { id: 'task_103', title: 'Exploratory data analysis', type: 'project' },
      { id: 'task_104', title: 'Build ML models', type: 'project' },
      { id: 'task_105', title: 'Model evaluation and optimization', type: 'project' },
    ],
    resources: [
      { type: 'course', url: 'https://pandas.pydata.org', title: 'Pandas Documentation' },
      { type: 'docs', url: 'https://scikit-learn.org', title: 'Scikit-learn Guide' },
      { type: 'tutorial', url: 'https://tensorflow.org', title: 'TensorFlow Tutorials' },
    ],
    completionCriteria: '75% accuracy on final ML project',
    progressTracking: true,
  },
  {
    id: 'module_003',
    title: 'Cloud Architecture & DevOps on AWS',
    description: 'Learn to architect and deploy scalable applications on AWS.',
    category: 'Cloud & DevOps',
    difficulty: 'advanced',
    estimatedDuration: '18 days',
    skills: ['AWS', 'Docker', 'Kubernetes', 'CI/CD', 'Infrastructure as Code'],
    tasks: [
      { id: 'task_201', title: 'AWS fundamentals', type: 'concept' },
      { id: 'task_202', title: 'Containerization with Docker', type: 'project' },
      { id: 'task_203', title: 'Kubernetes orchestration', type: 'project' },
      { id: 'task_204', title: 'Setup CI/CD pipeline', type: 'project' },
      { id: 'task_205', title: 'Infrastructure as Code', type: 'project' },
    ],
    resources: [
      { type: 'course', url: 'https://aws.amazon.com', title: 'AWS Training' },
      { type: 'docs', url: 'https://docker.com', title: 'Docker Documentation' },
      { type: 'tutorial', url: 'https://kubernetes.io', title: 'Kubernetes Official Guide' },
    ],
    completionCriteria: 'Deploy working application on AWS',
    progressTracking: true,
  },
  {
    id: 'module_004',
    title: 'Mobile App Development with React Native',
    description: 'Build cross-platform mobile applications using React Native.',
    category: 'Mobile Development',
    difficulty: 'intermediate',
    estimatedDuration: '16 days',
    skills: ['React Native', 'JavaScript', 'Mobile UI/UX', 'API Integration'],
    tasks: [
      { id: 'task_301', title: 'React Native setup and basics', type: 'concept' },
      { id: 'task_302', title: 'Build mobile UI components', type: 'project' },
      { id: 'task_303', title: 'State management', type: 'project' },
      { id: 'task_304', title: 'Backend integration', type: 'project' },
      { id: 'task_305', title: 'Deploy to app stores', type: 'project' },
    ],
    resources: [
      { type: 'course', url: 'https://reactnative.dev', title: 'React Native Docs' },
      { type: 'docs', url: 'https://expo.dev', title: 'Expo Documentation' },
      { type: 'tutorial', url: 'https://react.dev', title: 'React Concepts' },
    ],
    completionCriteria: 'Submit working app with 4+ features',
    progressTracking: true,
  },
  {
    id: 'module_005',
    title: 'Advanced JavaScript & TypeScript',
    description: 'Master modern JavaScript and TypeScript for professional development.',
    category: 'Web Development',
    difficulty: 'intermediate',
    estimatedDuration: '14 days',
    skills: ['JavaScript ES6+', 'TypeScript', 'Async Programming', 'Testing'],
    tasks: [
      { id: 'task_401', title: 'ES6+ features and syntax', type: 'concept' },
      { id: 'task_402', title: 'TypeScript type system', type: 'project' },
      { id: 'task_403', title: 'Async patterns and promises', type: 'project' },
      { id: 'task_404', title: 'Testing frameworks', type: 'project' },
      { id: 'task_405', title: 'Build production app', type: 'project' },
    ],
    resources: [
      { type: 'course', url: 'https://javascript.info', title: 'JavaScript Guide' },
      { type: 'docs', url: 'https://typescriptlang.org', title: 'TypeScript Handbook' },
      { type: 'tutorial', url: 'https://jest.io', title: 'Jest Testing Framework' },
    ],
    completionCriteria: 'Build and test a production application',
    progressTracking: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SEEDING FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

async function seedDemoAccounts() {
  console.log('\n' + '='.repeat(80));
  console.log('🌱 DEMO ACCOUNT SEEDING');
  console.log('='.repeat(80));

  const userStore = UserStore;
  let adminUserId = null;
  const managerUserIds = {};
  const employeeUserIds = [];

  try {
    // Clear existing demo accounts
    console.log('\n📋 Creating Demo Accounts...\n');

    // Create admin account
    for (const admin of DEMO_ACCOUNTS.ADMIN) {
      try {
        const passwordHash = await AuthService.hashPassword(admin.password);
        const user = await userStore.createUser({
          email: admin.email,
          passwordHash,
          name: admin.name,
          role: admin.role,
          emailVerified: true,
        });
        adminUserId = user.userId;
        console.log(`✅ Admin created: ${admin.email} (${user.userId})`);
      } catch (err) {
        if (err.message.includes('already registered')) {
          console.log(`⚠️  Admin already exists: ${admin.email}`);
          const existing = await userStore.getUserByEmail(admin.email);
          if (existing) adminUserId = existing.userId;
        } else {
          throw err;
        }
      }
    }

    // Create manager accounts
    for (const manager of DEMO_ACCOUNTS.MANAGERS) {
      try {
        const passwordHash = await AuthService.hashPassword(manager.password);
        const user = await userStore.createUser({
          email: manager.email,
          passwordHash,
          name: manager.name,
          role: manager.role,
          emailVerified: true,
        });
        managerUserIds[manager.groupId] = user.userId;
        console.log(`✅ Manager created: ${manager.email} (${user.userId}) - Group: ${manager.groupId}`);
      } catch (err) {
        if (err.message.includes('already registered')) {
          console.log(`⚠️  Manager already exists: ${manager.email}`);
          const existing = await userStore.getUserByEmail(manager.email);
          if (existing) managerUserIds[manager.groupId] = existing.userId;
        } else {
          throw err;
        }
      }
    }

    // Create employee accounts
    for (const employee of DEMO_ACCOUNTS.EMPLOYEES) {
      try {
        const passwordHash = await AuthService.hashPassword(employee.password);
        const managerId = managerUserIds[employee.groupId];
        const user = await userStore.createUser({
          email: employee.email,
          passwordHash,
          name: employee.name,
          role: employee.role,
          emailVerified: true,
          managerId: managerId || null,
        });
        employeeUserIds.push({
          userId: user.userId,
          email: employee.email,
          groupId: employee.groupId,
          managerId,
        });
        console.log(`✅ Employee created: ${employee.email} (${user.userId}) - Group: ${employee.groupId}`);
      } catch (err) {
        if (err.message.includes('already registered')) {
          console.log(`⚠️  Employee already exists: ${employee.email}`);
          const existing = await userStore.getUserByEmail(employee.email);
          if (existing) {
            employeeUserIds.push({
              userId: existing.userId,
              email: employee.email,
              groupId: employee.groupId,
              managerId: managerUserIds[employee.groupId],
            });
          }
        } else {
          throw err;
        }
      }
    }

    // Create modules file
    console.log('\n📚 Creating Prebuilt Modules...\n');
    const modulesPath = path.join(__dirname, 'data', 'modules.json');
    const modulesData = {
      modules: PREBUILT_MODULES,
      nextModuleId: PREBUILT_MODULES.length + 1,
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(modulesPath, JSON.stringify(modulesData, null, 2), 'utf-8');
    console.log(`✅ Created ${PREBUILT_MODULES.length} prebuilt modules`);

    // Create assignments data
    console.log('\n📋 Creating Assignments...\n');
    const assignments = [];
    let assignmentId = 1;

    // Assign modules to employee groups
    for (const groupKey in managerUserIds) {
      const managerId = managerUserIds[groupKey];
      const groupEmployees = employeeUserIds.filter(e => e.groupId === groupKey);
      
      // Assign modules to each employee in the group
      for (let i = 0; i < PREBUILT_MODULES.length; i++) {
        const module = PREBUILT_MODULES[i];
        for (const employee of groupEmployees) {
          assignments.push({
            assignmentId: `assign_${String(assignmentId++).padStart(4, '0')}`,
            moduleId: module.id,
            moduleName: module.title,
            assignedToUserId: employee.userId,
            assignedByUserId: managerId,
            assignedAt: new Date().toISOString(),
            status: 'assigned',
            startedAt: null,
            completedAt: null,
            progress: 0,
          });
        }
      }
    }

    const assignmentsPath = path.join(__dirname, 'data', 'assignments.json');
    const assignmentsData = {
      assignments,
      nextAssignmentId: assignmentId,
    };
    await fs.writeFile(assignmentsPath, JSON.stringify(assignmentsData, null, 2), 'utf-8');
    console.log(`✅ Created ${assignments.length} module assignments`);

    // Create activity logs
    console.log('\n📊 Seeding Activity History...\n');
    const activityLogs = [];
    let activityId = 1;

    // Create some realistic activity for employees
    const now = new Date();
    const activities = ['module_started', 'task_completed', 'quiz_passed', 'quiz_failed', 'session_completed', 'progress_updated'];

    for (const employee of employeeUserIds) {
      // Generate 3-7 activities per employee
      const activityCount = Math.floor(Math.random() * 5) + 3;
      for (let i = 0; i < activityCount; i++) {
        const daysAgo = Math.floor(Math.random() * 14) + 1;
        const activityDate = new Date(now);
        activityDate.setDate(activityDate.getDate() - daysAgo);

        const activity = activities[Math.floor(Math.random() * activities.length)];
        const score = activity.includes('passed') ? Math.floor(Math.random() * 40) + 60 : 
                     activity.includes('failed') ? Math.floor(Math.random() * 50) : null;

        activityLogs.push({
          activityId: `activity_${String(activityId++).padStart(6, '0')}`,
          userId: employee.userId,
          activityType: activity,
          moduleId: PREBUILT_MODULES[Math.floor(Math.random() * PREBUILT_MODULES.length)].id,
          taskId: `task_${String(Math.floor(Math.random() * 5) + 1).padStart(3, '0')}`,
          score,
          duration: Math.floor(Math.random() * 120) + 15,
          timestamp: activityDate.toISOString(),
          details: `Activity logged for tracking`,
        });
      }
    }

    const activityPath = path.join(__dirname, 'data', 'activity_logs.json');
    const activityData = {
      logs: activityLogs,
      nextActivityId: activityId,
    };
    await fs.writeFile(activityPath, JSON.stringify(activityData, null, 2), 'utf-8');
    console.log(`✅ Created ${activityLogs.length} activity log entries`);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ SEEDING COMPLETE');
    console.log('='.repeat(80));
    console.log('\nDEMO ACCOUNT SUMMARY:\n');
    console.log(`📌 Admin Accounts: ${DEMO_ACCOUNTS.ADMIN.length}`);
    console.log(`  - admin@gmail.com (password: Admin@123456)\n`);
    console.log(`👔 Manager Accounts: ${DEMO_ACCOUNTS.MANAGERS.length}`);
    DEMO_ACCOUNTS.MANAGERS.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.email} (password: Manager@123456) - ${m.groupId}`);
    });
    console.log(`\n👨‍💼 Employee Accounts: ${DEMO_ACCOUNTS.EMPLOYEES.length}`);
    console.log(`  Group A: employee1-5@gmail.com (Manager: manager1@gmail.com)`);
    console.log(`  Group B: employee6-10@gmail.com (Manager: manager2@gmail.com)`);
    console.log(`  Group C: employee11-15@gmail.com (Manager: manager3@gmail.com)`);
    console.log(`  (All employees use password: Employee@123456)\n`);
    console.log(`📚 Prebuilt Modules: ${PREBUILT_MODULES.length}`);
    console.log(`📋 Module Assignments: ${assignments.length}`);
    console.log(`📊 Activity Logs: ${activityLogs.length}`);
    console.log('\n✨ All demo accounts are ready to use!\n');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    process.exit(1);
  }
}

// Run seeding
seedDemoAccounts().catch(console.error);
