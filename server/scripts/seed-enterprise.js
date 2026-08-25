import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dummy accounts data
const DUMMY_ACCOUNTS = {
  admin: {
    email: 'admin@gmail.com',
    password: 'Admin@123',
    name: 'System Administrator',
    role: 'admin'
  },
  managers: [
    {
      email: 'manager1@gmail.com',
      password: 'Manager@123',
      name: 'John Smith',
      role: 'manager'
    },
    {
      email: 'manager2@gmail.com',
      password: 'Manager@123',
      name: 'Sarah Johnson',
      role: 'manager'
    }
  ],
  employees: [
    // Frontend Team
    {
      email: 'employee1@gmail.com',
      password: 'Employee@123',
      name: 'Alice Chen',
      role: 'employee',
      team: 'frontend'
    },
    {
      email: 'employee2@gmail.com',
      password: 'Employee@123',
      name: 'Bob Wilson',
      role: 'employee',
      team: 'frontend'
    },
    {
      email: 'employee3@gmail.com',
      password: 'Employee@123',
      name: 'Carol Davis',
      role: 'employee',
      team: 'frontend'
    },
    // Backend Team
    {
      email: 'employee4@gmail.com',
      password: 'Employee@123',
      name: 'David Brown',
      role: 'employee',
      team: 'backend'
    },
    {
      email: 'employee5@gmail.com',
      password: 'Employee@123',
      name: 'Eva Martinez',
      role: 'employee',
      team: 'backend'
    },
    {
      email: 'employee6@gmail.com',
      password: 'Employee@123',
      name: 'Frank Garcia',
      role: 'employee',
      team: 'backend'
    }
  ]
};

// Groups/Hierarchy data
const GROUPS = {
  frontend: {
    name: 'Frontend Development Team',
    managerId: 'manager1@gmail.com', // Will be replaced with actual userId
    employees: ['employee1@gmail.com', 'employee2@gmail.com', 'employee3@gmail.com']
  },
  backend: {
    name: 'Backend Development Team',
    managerId: 'manager2@gmail.com', // Will be replaced with actual userId
    employees: ['employee4@gmail.com', 'employee5@gmail.com', 'employee6@gmail.com']
  }
};

// Generate UUID-like ID
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Hash password
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Create user object
async function createUser(account, index = null) {
  const userId = `auth_user_${Date.now()}_${index || Math.random().toString(36).substr(2, 9)}`;
  const passwordHash = await hashPassword(account.password);

  return {
    userId,
    email: account.email,
    passwordHash,
    name: account.name,
    role: account.role,
    team: account.team || null,
    managerId: null, // Will be set later
    learningUUID: generateId(),
    emailVerified: true,
    otp: null,
    otpExpires: null,
    resetToken: null,
    resetTokenExpires: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLogin: null,
    googleId: null
  };
}

// Main seeding function
async function seedEnterpriseData() {
  console.log('🌱 Seeding enterprise data...');

  try {
    // Create users array
    const users = [];

    // Create admin
    console.log('Creating admin account...');
    const admin = await createUser(DUMMY_ACCOUNTS.admin);
    users.push(admin);

    // Create managers
    console.log('Creating manager accounts...');
    for (let i = 0; i < DUMMY_ACCOUNTS.managers.length; i++) {
      const manager = await createUser(DUMMY_ACCOUNTS.managers[i], `manager_${i + 1}`);
      users.push(manager);
    }

    // Create employees
    console.log('Creating employee accounts...');
    for (let i = 0; i < DUMMY_ACCOUNTS.employees.length; i++) {
      const employee = await createUser(DUMMY_ACCOUNTS.employees[i], `employee_${i + 1}`);
      users.push(employee);
    }

    // Set up hierarchy (assign managers to employees)
    console.log('Setting up team hierarchy...');

    // Find manager userIds
    const manager1 = users.find(u => u.email === 'manager1@gmail.com');
    const manager2 = users.find(u => u.email === 'manager2@gmail.com');

    // Assign managers to frontend team employees
    users.forEach(user => {
      if (GROUPS.frontend.employees.includes(user.email)) {
        user.managerId = manager1.userId;
      } else if (GROUPS.backend.employees.includes(user.email)) {
        user.managerId = manager2.userId;
      }
    });

    // Create groups data
    const groups = [
      {
        groupId: generateId(),
        name: GROUPS.frontend.name,
        managerId: manager1.userId,
        employeeIds: users.filter(u => GROUPS.frontend.employees.includes(u.email)).map(u => u.userId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        groupId: generateId(),
        name: GROUPS.backend.name,
        managerId: manager2.userId,
        employeeIds: users.filter(u => GROUPS.backend.employees.includes(u.email)).map(u => u.userId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    // Save to files
    const usersFile = path.join(__dirname, '..', 'data', 'users.json');
    const groupsFile = path.join(__dirname, '..', 'data', 'groups.json');

    // Ensure data directory exists
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write users data
    fs.writeFileSync(usersFile, JSON.stringify({ users }, null, 2));
    console.log(`✅ Created ${users.length} user accounts`);

    // Write groups data
    fs.writeFileSync(groupsFile, JSON.stringify({ groups }, null, 2));
    console.log(`✅ Created ${groups.length} groups`);

    // Print login credentials
    console.log('\n🎯 LOGIN CREDENTIALS:');
    console.log('===================');
    console.log(`Admin: ${DUMMY_ACCOUNTS.admin.email} / ${DUMMY_ACCOUNTS.admin.password}`);
    console.log(`Manager 1: ${DUMMY_ACCOUNTS.managers[0].email} / ${DUMMY_ACCOUNTS.managers[0].password}`);
    console.log(`Manager 2: ${DUMMY_ACCOUNTS.managers[1].email} / ${DUMMY_ACCOUNTS.managers[1].password}`);
    console.log(`Employees: employee1-6@gmail.com / ${DUMMY_ACCOUNTS.employees[0].password}`);
    console.log('\n📋 TEAM STRUCTURE:');
    console.log('==================');
    console.log('Frontend Team (Manager: John Smith):');
    console.log('  - Alice Chen, Bob Wilson, Carol Davis');
    console.log('Backend Team (Manager: Sarah Johnson):');
    console.log('  - David Brown, Eva Martinez, Frank Garcia');

    console.log('\n✅ Enterprise data seeding completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding enterprise data:', error);
    process.exit(1);
  }
}

// Run the seeding
seedEnterpriseData();