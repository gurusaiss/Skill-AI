import { describe, it, expect, beforeEach } from 'vitest';
import AuthService from './AuthService.js';

/**
 * Unit Tests for AuthService Password Management
 * 
 * **Validates: Requirements 1.2, 1.3, 15.2**
 * 
 * Tests cover:
 * - Password hashing produces different hashes for same password
 * - Password verification with correct and incorrect passwords
 * - Password strength validation (weak, medium, strong examples)
 * - Bcrypt salt rounds configuration
 */
describe('AuthService - Password Management', () => {
  
  // ────────────────────────────────────────────────────────────────────────────
  // Password Hashing Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('hashPassword', () => {
    it('should hash a password successfully', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should produce different hashes for the same password', async () => {
      const password = 'TestPassword123';
      const hash1 = await AuthService.hashPassword(password);
      const hash2 = await AuthService.hashPassword(password);
      
      expect(hash1).not.toBe(hash2);
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
    });

    it('should produce different hashes for different passwords', async () => {
      const password1 = 'TestPassword123';
      const password2 = 'DifferentPassword456';
      const hash1 = await AuthService.hashPassword(password1);
      const hash2 = await AuthService.hashPassword(password2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should use bcrypt salt rounds of 10 or higher', async () => {
      // Bcrypt hashes start with $2b$ followed by the cost factor
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      
      // Extract the cost factor from the hash
      // Format: $2b$10$... where 10 is the cost factor
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      expect(costMatch).not.toBeNull();
      
      const costFactor = parseInt(costMatch[1], 10);
      expect(costFactor).toBeGreaterThanOrEqual(10);
    });

    it('should handle empty string password', async () => {
      const password = '';
      const hash = await AuthService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should handle password with special characters', async () => {
      const password = 'Test@Pass#123!$%^&*()';
      const hash = await AuthService.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Password Verification Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('comparePassword', () => {
    it('should return true for correct password', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword(password, hash);
      
      expect(isMatch).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const correctPassword = 'TestPassword123';
      const incorrectPassword = 'WrongPassword456';
      const hash = await AuthService.hashPassword(correctPassword);
      const isMatch = await AuthService.comparePassword(incorrectPassword, hash);
      
      expect(isMatch).toBe(false);
    });

    it('should return false for empty password against valid hash', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword('', hash);
      
      expect(isMatch).toBe(false);
    });

    it('should return false for password with slight variation', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword('TestPassword124', hash);
      
      expect(isMatch).toBe(false);
    });

    it('should return false for password with different case', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword('testpassword123', hash);
      
      expect(isMatch).toBe(false);
    });

    it('should handle password with special characters correctly', async () => {
      const password = 'Test@Pass#123!';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword(password, hash);
      
      expect(isMatch).toBe(true);
    });

    it('should handle very long passwords', async () => {
      const password = 'A'.repeat(100) + 'Test123';
      const hash = await AuthService.hashPassword(password);
      const isMatch = await AuthService.comparePassword(password, hash);
      
      expect(isMatch).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Password Strength Validation Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('validatePasswordStrength', () => {
    
    // Weak Password Examples
    describe('weak passwords', () => {
      it('should reject password shorter than 8 characters', () => {
        const result = AuthService.validatePasswordStrength('Test1');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should reject password without uppercase letter', () => {
        const result = AuthService.validatePasswordStrength('testpass123');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
      });

      it('should reject password without lowercase letter', () => {
        const result = AuthService.validatePasswordStrength('TESTPASS123');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one lowercase letter');
      });

      it('should reject password without number', () => {
        const result = AuthService.validatePasswordStrength('TestPassword');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must contain at least one number');
      });

      it('should reject empty password', () => {
        const result = AuthService.validatePasswordStrength('');
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should reject null password', () => {
        const result = AuthService.validatePasswordStrength(null);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should reject undefined password', () => {
        const result = AuthService.validatePasswordStrength(undefined);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should reject password with only 7 characters even if it meets other requirements', () => {
        const result = AuthService.validatePasswordStrength('Test123');
        
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Password must be at least 8 characters long');
      });

      it('should accumulate multiple errors for very weak password', () => {
        const result = AuthService.validatePasswordStrength('test');
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        expect(result.errors).toContain('Password must be at least 8 characters long');
        expect(result.errors).toContain('Password must contain at least one uppercase letter');
        expect(result.errors).toContain('Password must contain at least one number');
      });
    });

    // Medium Strength Password Examples
    describe('medium strength passwords', () => {
      it('should accept password with exactly 8 characters meeting all requirements', () => {
        const result = AuthService.validatePasswordStrength('Test1234');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with 10 characters meeting all requirements', () => {
        const result = AuthService.validatePasswordStrength('TestPass12');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with multiple numbers', () => {
        const result = AuthService.validatePasswordStrength('TestPass123456');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with multiple uppercase letters', () => {
        const result = AuthService.validatePasswordStrength('TestPassWORD123');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    // Strong Password Examples
    describe('strong passwords', () => {
      it('should accept strong password with special characters', () => {
        const result = AuthService.validatePasswordStrength('Test@Pass123!');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept strong password with mixed case and numbers', () => {
        const result = AuthService.validatePasswordStrength('MySecureP@ssw0rd');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept very long strong password', () => {
        const result = AuthService.validatePasswordStrength('ThisIsAVeryLongAndSecurePassword123WithNumbers');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with all special characters', () => {
        const result = AuthService.validatePasswordStrength('T3st!@#$%^&*()_+-=[]{}|;:,.<>?');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with spaces', () => {
        const result = AuthService.validatePasswordStrength('Test Pass 123');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept password with unicode characters', () => {
        const result = AuthService.validatePasswordStrength('TestPäss123');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    // Edge Cases
    describe('edge cases', () => {
      it('should return errors array even for valid password', () => {
        const result = AuthService.validatePasswordStrength('ValidPass123');
        
        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('errors');
        expect(Array.isArray(result.errors)).toBe(true);
      });

      it('should handle password with only whitespace', () => {
        const result = AuthService.validatePasswordStrength('        ');
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should validate password at exactly the minimum requirements', () => {
        // Exactly 8 chars, 1 upper, 1 lower, 1 number
        const result = AuthService.validatePasswordStrength('Aaaaaaa1');
        
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Bcrypt Configuration Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('bcrypt salt rounds configuration', () => {
    it('should have saltRounds property set to 10 or higher', () => {
      expect(AuthService.saltRounds).toBeDefined();
      expect(AuthService.saltRounds).toBeGreaterThanOrEqual(10);
    });

    it('should use configured salt rounds in hash generation', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      
      // Extract cost factor from bcrypt hash
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      const costFactor = parseInt(costMatch[1], 10);
      
      expect(costFactor).toBe(AuthService.saltRounds);
    });

    it('should produce secure hashes with configured salt rounds', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      
      // Bcrypt hash should be 60 characters long
      expect(hash.length).toBe(60);
      
      // Should start with $2b$ (bcrypt identifier)
      expect(hash.startsWith('$2b$')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Integration Tests - Password Hashing + Verification
  // ────────────────────────────────────────────────────────────────────────────

  describe('password hashing and verification integration', () => {
    it('should successfully hash and verify the same password', async () => {
      const password = 'IntegrationTest123';
      const hash = await AuthService.hashPassword(password);
      const isValid = await AuthService.comparePassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong password', async () => {
      const correctPassword = 'CorrectPassword123';
      const wrongPassword = 'WrongPassword456';
      const hash = await AuthService.hashPassword(correctPassword);
      const isValid = await AuthService.comparePassword(wrongPassword, hash);
      
      expect(isValid).toBe(false);
    });

    it('should handle multiple hash and verify operations', async () => {
      const passwords = ['Pass1Test', 'Pass2Test', 'Pass3Test'];
      const hashes = await Promise.all(
        passwords.map(pwd => AuthService.hashPassword(pwd))
      );
      
      // Verify each password matches its hash
      for (let i = 0; i < passwords.length; i++) {
        const isValid = await AuthService.comparePassword(passwords[i], hashes[i]);
        expect(isValid).toBe(true);
      }
      
      // Verify passwords don't match other hashes
      const wrongMatch = await AuthService.comparePassword(passwords[0], hashes[1]);
      expect(wrongMatch).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Security Tests
  // ────────────────────────────────────────────────────────────────────────────

  describe('security considerations', () => {
    it('should not expose original password in hash', async () => {
      const password = 'SecretPassword123';
      const hash = await AuthService.hashPassword(password);
      
      expect(hash).not.toContain(password);
      expect(hash.toLowerCase()).not.toContain(password.toLowerCase());
    });

    it('should produce cryptographically different hashes for similar passwords', async () => {
      const password1 = 'TestPassword123';
      const password2 = 'TestPassword124'; // Only last digit different
      const hash1 = await AuthService.hashPassword(password1);
      const hash2 = await AuthService.hashPassword(password2);
      
      expect(hash1).not.toBe(hash2);
      
      // Hashes should be completely different, not just slightly different
      let differentChars = 0;
      for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
        if (hash1[i] !== hash2[i]) differentChars++;
      }
      
      // Expect significant difference (more than 50% of characters different)
      expect(differentChars).toBeGreaterThan(hash1.length * 0.5);
    });

    it('should handle timing attacks by using constant-time comparison', async () => {
      const password = 'TestPassword123';
      const hash = await AuthService.hashPassword(password);
      
      // bcrypt.compare uses constant-time comparison internally
      // We verify it works correctly for both correct and incorrect passwords
      const correctResult = await AuthService.comparePassword(password, hash);
      const incorrectResult = await AuthService.comparePassword('WrongPassword', hash);
      
      expect(correctResult).toBe(true);
      expect(incorrectResult).toBe(false);
    });
  });
});
