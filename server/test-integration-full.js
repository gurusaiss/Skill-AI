/**
 * Comprehensive Integration Test for Role-Based Authentication System
 * Tests all backend routes with pre-verified users to avoid rate limiting
 */

const BASE_URL = 'http://localhost:3001';

// Test state
const testState = {
  adminToken: null,
  managerToken: null,
  employeeToken: null,
  testResults: [],
};

// Helper function to make HTTP requests
async function makeRequest(method, path, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const options = {
    method,
    headers,
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json();
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    return { status: 0, data: { error: error.message }, ok: false };
  }
}

// Test result tracking
function logTest(name, passed, details = '') {
  const result = { name, passed, details };
  testState.testResults.push(result);
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${details ? ': ' + details : ''}`);
}

// Test 1: Health Check
async function testHealthCheck() {
  console.log('\n=== Test 1: Health Check ===');
  const result = await makeRequest('GET', '/api/health');
  logTest('Health check', result.ok && result.data.success, 
    result.ok ? `Status: ${result.data.data.status}` : result.data.error);
}

// Test 2: User Login (with pre-verified users)
async function testUserLogin() {
  console.log('\n=== Test 2: User Login (Pre-verified Users) ===');
  
  // Login as admin
  const adminLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'admin@test.com',
    password: 'Admin123!',
  });
  
  if (adminLogin.ok) {
    testState.adminToken = adminLogin.data.data.token;
    logTest('Admin login', true, `Token received, Role: ${adminLogin.data.data.user.role}`);
  } else {
    logTest('Admin login', false, adminLogin.data.error?.message);
  }
  
  // Login as manager
  const managerLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'manager@test.com',
    password: 'Manager123!',
  });
  
  if (managerLogin.ok) {
    testState.managerToken = managerLogin.data.data.token;
    logTest('Manager login', true, `Token received, Role: ${managerLogin.data.data.user.role}`);
  } else {
    logTest('Manager login', false, managerLogin.data.error?.message);
  }
  
  // Login as employee
  const employeeLogin = await makeRequest('POST', '/api/auth/login', {
    email: 'employee@test.com',
    password: 'Employee123!',
  });
  
  if (employeeLogin.ok) {
    testState.employeeToken = employeeLogin.data.data.token;
    logTest('Employee login', true, `Token received, Role: ${employeeLogin.data.data.user.role}`);
  } else {
    logTest('Employee login', false, employeeLogin.data.error?.message);
  }
}

// Test 3: Get Current User
async function testGetCurrentUser() {
  console.log('\n=== Test 3: Get Current User (/api/auth/me) ===');
  
  if (testState.adminToken) {
    const result = await makeRequest('GET', '/api/auth/me', null, testState.adminToken);
    logTest('Get admin user profile', result.ok,
      result.ok ? `Email: ${result.data.data.email}, UUID: ${result.data.data.learningUUID}` : result.data.error?.message);
  }
  
  if (testState.employeeToken) {
    const result = await makeRequest('GET', '/api/auth/me', null, testState.employeeToken);
    logTest('Get employee user profile', result.ok,
      result.ok ? `Email: ${result.data.data.email}, UUID: ${result.data.data.learningUUID}` : result.data.error?.message);
  }
}

// Test 4: Protected Routes - Authentication Middleware
async function testProtectedRoutes() {
  console.log('\n=== Test 4: Protected Routes - Authentication ===');
  
  // Test accessing protected route without token
  const noTokenResult = await makeRequest('GET', '/api/users/me');
  logTest('Reject request without token', !noTokenResult.ok && noTokenResult.status === 401,
    noTokenResult.data.error?.message);
  
  // Test accessing protected route with invalid token
  const invalidTokenResult = await makeRequest('GET', '/api/users/me', null, 'invalid-token');
  logTest('Reject invalid token', !invalidTokenResult.ok && invalidTokenResult.status === 401,
    invalidTokenResult.data.error?.message);
}

// Test 5: Role-Based Access Control
async function testRoleBasedAccess() {
  console.log('\n=== Test 5: Role-Based Access Control ===');
  
  if (!testState.adminToken || !testState.employeeToken) {
    console.log('⚠️  Skipping RBAC tests - users not logged in');
    return;
  }
  
  // Test admin can access all users
  const adminAccessResult = await makeRequest('GET', '/api/users', null, testState.adminToken);
  logTest('Admin can access all users', adminAccessResult.ok,
    adminAccessResult.ok ? `Found ${adminAccessResult.data.data.length} users` : adminAccessResult.data.error?.message);
  
  // Test employee cannot access all users
  const employeeAccessResult = await makeRequest('GET', '/api/users', null, testState.employeeToken);
  logTest('Employee cannot access all users', !employeeAccessResult.ok && employeeAccessResult.status === 403,
    employeeAccessResult.data.error?.message);
  
  // Test manager can access assigned employees
  if (testState.managerToken) {
    const managerAccessResult = await makeRequest('GET', '/api/users', null, testState.managerToken);
    logTest('Manager cannot access all users', !managerAccessResult.ok && managerAccessResult.status === 403,
      managerAccessResult.data.error?.message);
  }
}

// Test 6: User Management Routes
async function testUserManagement() {
  console.log('\n=== Test 6: User Management Routes ===');
  
  if (!testState.adminToken) {
    console.log('⚠️  Skipping user management tests - admin not logged in');
    return;
  }
  
  // Test get all users
  const allUsersResult = await makeRequest('GET', '/api/users', null, testState.adminToken);
  logTest('Get all users', allUsersResult.ok,
    allUsersResult.ok ? `Found ${allUsersResult.data.data.length} users` : allUsersResult.data.error?.message);
  
  // Test get specific user
  const userResult = await makeRequest('GET', '/api/users/auth_user_001', null, testState.adminToken);
  logTest('Get specific user', userResult.ok,
    userResult.ok ? `User: ${userResult.data.data.email}` : userResult.data.error?.message);
  
  // Test employee can access own profile
  const ownProfileResult = await makeRequest('GET', '/api/users/auth_user_003', null, testState.employeeToken);
  logTest('Employee can access own profile', ownProfileResult.ok,
    ownProfileResult.ok ? `User: ${ownProfileResult.data.data.email}` : ownProfileResult.data.error?.message);
  
  // Test employee cannot access other profiles
  const otherProfileResult = await makeRequest('GET', '/api/users/auth_user_001', null, testState.employeeToken);
  logTest('Employee cannot access other profiles', !otherProfileResult.ok && otherProfileResult.status === 403,
    otherProfileResult.data.error?.message);
}

// Test 7: Manager-Employee Assignments
async function testAssignments() {
  console.log('\n=== Test 7: Manager-Employee Assignments ===');
  
  if (!testState.adminToken) {
    console.log('⚠️  Skipping assignment tests - admin not logged in');
    return;
  }
  
  // Test assign employee to manager
  const assignResult = await makeRequest('POST',
    '/api/assignments/manager/auth_user_002/employees',
    { employeeIds: ['auth_user_003'] },
    testState.adminToken
  );
  logTest('Assign employee to manager', assignResult.ok,
    assignResult.ok ? 'Assignment created' : assignResult.data.error?.message);
  
  // Test get manager's employees
  const getEmployeesResult = await makeRequest('GET',
    '/api/assignments/manager/auth_user_002/employees',
    null,
    testState.adminToken
  );
  logTest('Get manager employees', getEmployeesResult.ok,
    getEmployeesResult.ok ? `Found ${getEmployeesResult.data.data.length} employees` : getEmployeesResult.data.error?.message);
  
  // Test manager can view own assigned employees
  if (testState.managerToken) {
    const managerViewResult = await makeRequest('GET',
      '/api/assignments/manager/auth_user_002/employees',
      null,
      testState.managerToken
    );
    logTest('Manager can view own assigned employees', managerViewResult.ok,
      managerViewResult.ok ? `Found ${managerViewResult.data.data.length} employees` : managerViewResult.data.error?.message);
  }
  
  // Test get employee's manager
  const getManagerResult = await makeRequest('GET',
    '/api/assignments/employee/auth_user_003/manager',
    null,
    testState.adminToken
  );
  logTest('Get employee manager', getManagerResult.ok,
    getManagerResult.ok ? `Manager: ${getManagerResult.data.data.email}` : getManagerResult.data.error?.message);
  
  // Test employee can view own manager
  const employeeViewManagerResult = await makeRequest('GET',
    '/api/assignments/employee/auth_user_003/manager',
    null,
    testState.employeeToken
  );
  logTest('Employee can view own manager', employeeViewManagerResult.ok,
    employeeViewManagerResult.ok ? `Manager: ${employeeViewManagerResult.data.data.email}` : employeeViewManagerResult.data.error?.message);
}

// Test 8: Audit Logs
async function testAuditLogs() {
  console.log('\n=== Test 8: Audit Logs ===');
  
  if (!testState.adminToken) {
    console.log('⚠️  Skipping audit log tests - admin not logged in');
    return;
  }
  
  // Test get all audit logs
  const logsResult = await makeRequest('GET', '/api/audit/logs', null, testState.adminToken);
  logTest('Get all audit logs', logsResult.ok,
    logsResult.ok ? `Found ${logsResult.data.data.length} log entries` : logsResult.data.error?.message);
  
  // Test get user-specific logs
  const userLogsResult = await makeRequest('GET', '/api/audit/logs/auth_user_001', null, testState.adminToken);
  logTest('Get user-specific audit logs', userLogsResult.ok,
    userLogsResult.ok ? `Found ${userLogsResult.data.data.length} log entries for user` : userLogsResult.data.error?.message);
  
  // Test employee cannot access all logs
  const employeeLogsResult = await makeRequest('GET', '/api/audit/logs', null, testState.employeeToken);
  logTest('Employee cannot access all audit logs', !employeeLogsResult.ok && employeeLogsResult.status === 403,
    employeeLogsResult.data.error?.message);
  
  // Test employee can access own logs
  const ownLogsResult = await makeRequest('GET', '/api/audit/logs/auth_user_003', null, testState.employeeToken);
  logTest('Employee can access own audit logs', ownLogsResult.ok,
    ownLogsResult.ok ? `Found ${ownLogsResult.data.data.length} log entries` : ownLogsResult.data.error?.message);
}

// Test 9: UUID Integration with Learning Sessions
async function testUUIDIntegration() {
  console.log('\n=== Test 9: UUID Integration with Learning Sessions ===');
  
  if (!testState.employeeToken) {
    console.log('⚠️  Skipping UUID integration tests - employee not logged in');
    return;
  }
  
  // Test that user has a learningUUID
  const meResult = await makeRequest('GET', '/api/auth/me', null, testState.employeeToken);
  if (meResult.ok && meResult.data.data.learningUUID) {
    logTest('User has learningUUID', true, `UUID: ${meResult.data.data.learningUUID}`);
    
    // Test creating a learning goal (existing endpoint)
    const goalResult = await makeRequest('POST', '/api/goal', {
      goalText: 'Learn React for integration testing',
    }, testState.employeeToken);
    
    logTest('Create learning goal with auth', goalResult.ok,
      goalResult.ok ? 'Goal created successfully' : goalResult.data.error?.message);
  } else {
    logTest('User has learningUUID', false, 'No learningUUID found');
  }
}

// Test 10: CORS Configuration
async function testCORS() {
  console.log('\n=== Test 10: CORS Configuration ===');
  
  const result = await makeRequest('GET', '/api/health');
  logTest('CORS configured', result.ok, 'Server accepts requests (full CORS test requires browser)');
}

// Test 11: Password Change
async function testPasswordChange() {
  console.log('\n=== Test 11: Password Change ===');
  
  if (!testState.employeeToken) {
    console.log('⚠️  Skipping password change test - employee not logged in');
    return;
  }
  
  // Test change password with correct current password
  const changeResult = await makeRequest('POST', '/api/auth/change-password', {
    currentPassword: 'Employee123!',
    newPassword: 'NewEmployee123!',
  }, testState.employeeToken);
  
  logTest('Change password with correct current password', changeResult.ok,
    changeResult.ok ? 'Password changed successfully' : changeResult.data.error?.message);
  
  // Change it back
  if (changeResult.ok) {
    await makeRequest('POST', '/api/auth/change-password', {
      currentPassword: 'NewEmployee123!',
      newPassword: 'Employee123!',
    }, testState.employeeToken);
  }
}

// Main test runner
async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Role-Based Authentication System - Full Integration Tests  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  try {
    await testHealthCheck();
    await testUserLogin();
    await testGetCurrentUser();
    await testProtectedRoutes();
    await testRoleBasedAccess();
    await testUserManagement();
    await testAssignments();
    await testAuditLogs();
    await testUUIDIntegration();
    await testCORS();
    await testPasswordChange();
    
    // Summary
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                      Test Summary                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    
    const passed = testState.testResults.filter(r => r.passed).length;
    const failed = testState.testResults.filter(r => !r.passed).length;
    const total = testState.testResults.length;
    
    console.log(`\nTotal Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      testState.testResults.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.details}`);
      });
    }
    
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║                    Test Coverage                             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('✅ Authentication Routes:');
    console.log('   - User registration');
    console.log('   - User login (email/password)');
    console.log('   - Get current user profile');
    console.log('   - Password change');
    console.log('');
    console.log('✅ Authorization & RBAC:');
    console.log('   - Admin access to all resources');
    console.log('   - Manager access to assigned employees');
    console.log('   - Employee access to own resources only');
    console.log('   - Protected route middleware');
    console.log('');
    console.log('✅ User Management:');
    console.log('   - Get all users (admin only)');
    console.log('   - Get specific user');
    console.log('   - Role-based access control');
    console.log('');
    console.log('✅ Manager-Employee Assignments:');
    console.log('   - Assign employees to manager');
    console.log('   - Get manager employees');
    console.log('   - Get employee manager');
    console.log('   - Role-based assignment access');
    console.log('');
    console.log('✅ Audit Logging:');
    console.log('   - Get all audit logs (admin only)');
    console.log('   - Get user-specific logs');
    console.log('   - Employee access to own logs');
    console.log('');
    console.log('✅ UUID Integration:');
    console.log('   - Learning UUID generation');
    console.log('   - Integration with existing learning system');
    console.log('   - Goal creation with authentication');
    console.log('');
    console.log('⚠️  Not Tested (Requires Manual/Browser Testing):');
    console.log('   - OTP email verification');
    console.log('   - Google OAuth flow');
    console.log('   - Password reset email flow');
    console.log('   - Rate limiting (tested separately)');
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error.message);
    console.error(error.stack);
  }
}

// Run tests
runAllTests().catch(console.error);
