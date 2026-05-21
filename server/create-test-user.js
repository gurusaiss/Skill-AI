/**
 * Create Test User Script
 * Creates a test user for immediate login (no OTP needed)
 */

import AuthService from './services/AuthService.js';
import UserStore from './services/UserStore.js';

console.log('═══════════════════════════════════════════════════════════');
console.log('  Creating Test User');
console.log('═══════════════════════════════════════════════════════════\n');

async function createTestUser() {
  try {
    const testEmail = 'test@example.com';
    const testPassword = 'Test1234';
    const testName = 'Test User';

    // Check if user already exists
    const existingUser = await UserStore.getUserByEmail(testEmail);
    if (existingUser) {
      console.log('⚠️  User already exists!');
      console.log(`   Email: ${testEmail}`);
      console.log(`   User ID: ${existingUser.userId}`);
      console.log(`   Role: ${existingUser.role}`);
      console.log(`   Email Verified: ${existingUser.emailVerified ? '✅ YES' : '❌ NO'}`);
      console.log('\n✅ You can login with:');
      console.log(`   Email: ${testEmail}`);
      console.log(`   Password: ${testPassword}`);
      return;
    }

    // Hash password
    console.log('🔐 Hashing password...');
    const passwordHash = await AuthService.hashPassword(testPassword);

    // Create user with email already verified (no OTP needed)
    console.log('👤 Creating user...');
    const user = await UserStore.createUser({
      email: testEmail,
      passwordHash,
      name: testName,
      role: 'employee',
      emailVerified: true, // Auto-verified for development
    });

    console.log('\n✅ Test user created successfully!');
    console.log('─────────────────────────────────────');
    console.log(`User ID: ${user.userId}`);
    console.log(`Email: ${user.email}`);
    console.log(`Name: ${user.name}`);
    console.log(`Role: ${user.role}`);
    console.log(`Email Verified: ✅ YES (auto-verified)`);
    console.log(`Learning UUID: ${user.learningUUID}`);

    console.log('\n🚀 You can now login with:');
    console.log('─────────────────────────────────────');
    console.log(`Email: ${testEmail}`);
    console.log(`Password: ${testPassword}`);
    console.log('\n📍 Login URL: http://localhost:5173/auth/login');

    // Log registration event
    await UserStore.logAuthEvent('registration', user.userId, {
      email: testEmail,
      method: 'test_script',
      ipAddress: '127.0.0.1'
    });

    console.log('\n✅ Done! Start the servers and login.');

  } catch (error) {
    console.error('\n❌ Error creating test user:', error.message);
    console.error(error);
  }
}

createTestUser();
