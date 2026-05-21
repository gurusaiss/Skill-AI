import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * AuthService - Handles authentication operations
 * - Password hashing and verification
 * - JWT token generation and validation
 * - OTP generation and verification
 * - Password reset token management
 */
class AuthService {
  constructor() {
    this.saltRounds = 10;
    this.jwtSecret = process.env.JWT_SECRET || 'default-secret-change-in-production';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    this.otpExpiration = 10 * 60 * 1000; // 10 minutes in milliseconds
    this.resetTokenExpiration = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Password Management
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Hash a password using bcrypt
   * @param {string} password - Plain text password
   * @returns {Promise<string>} Hashed password
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, this.saltRounds);
  }

  /**
   * Compare a plain text password with a hashed password
   * @param {string} plainPassword - Plain text password
   * @param {string} hashedPassword - Hashed password
   * @returns {Promise<boolean>} True if passwords match
   */
  async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Validate password strength
   * Requirements: 8+ characters, 1 uppercase, 1 lowercase, 1 number
   * @param {string} password - Password to validate
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validatePasswordStrength(password) {
    const errors = [];

    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // JWT Token Management
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a JWT token
   * @param {string} userId - User ID
   * @param {string} email - User email
   * @param {string} role - User role (admin, manager, employee)
   * @returns {string} JWT token
   */
  generateJWT(userId, email, role) {
    const payload = {
      userId,
      email,
      role
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn
    });
  }

  /**
   * Verify and decode a JWT token
   * @param {string} token - JWT token
   * @returns {Object|null} Decoded payload or null if invalid
   */
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      // Token is invalid, expired, or malformed
      return null;
    }
  }

  /**
   * Check if a JWT token is expired
   * @param {string} token - JWT token
   * @returns {boolean} True if token is expired
   */
  isTokenExpired(token) {
    const decoded = this.verifyJWT(token);
    if (!decoded) return true;

    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // OTP Management
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a 6-digit numeric OTP
   * @returns {string} 6-digit OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create OTP data with expiration
   * @param {string} otp - OTP code
   * @returns {Object} { otp, expiresAt }
   */
  createOTPData(otp) {
    return {
      otp,
      expiresAt: new Date(Date.now() + this.otpExpiration).toISOString()
    };
  }

  /**
   * Verify if an OTP is valid and not expired
   * @param {string} providedOTP - OTP provided by user
   * @param {string} storedOTP - OTP stored in database
   * @param {string} expiresAt - Expiration timestamp
   * @returns {Object} { valid: boolean, error: string|null }
   */
  verifyOTP(providedOTP, storedOTP, expiresAt) {
    if (!storedOTP) {
      return { valid: false, error: 'No OTP found for this user' };
    }

    if (providedOTP !== storedOTP) {
      return { valid: false, error: 'Invalid OTP code' };
    }

    const now = new Date();
    const expiration = new Date(expiresAt);

    if (now > expiration) {
      return { valid: false, error: 'OTP has expired' };
    }

    return { valid: true, error: null };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Password Reset Token Management
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a password reset token (UUID format)
   * @returns {string} Reset token
   */
  generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create reset token data with expiration
   * @param {string} token - Reset token
   * @returns {Object} { token, expiresAt }
   */
  createResetTokenData(token) {
    return {
      token,
      expiresAt: new Date(Date.now() + this.resetTokenExpiration).toISOString()
    };
  }

  /**
   * Verify if a reset token is valid and not expired
   * @param {string} providedToken - Token provided by user
   * @param {string} storedToken - Token stored in database
   * @param {string} expiresAt - Expiration timestamp
   * @returns {Object} { valid: boolean, error: string|null }
   */
  verifyResetToken(providedToken, storedToken, expiresAt) {
    if (!storedToken) {
      return { valid: false, error: 'No reset token found' };
    }

    if (providedToken !== storedToken) {
      return { valid: false, error: 'Invalid reset token' };
    }

    const now = new Date();
    const expiration = new Date(expiresAt);

    if (now > expiration) {
      return { valid: false, error: 'Reset token has expired' };
    }

    return { valid: true, error: null };
  }
}

export default new AuthService();
