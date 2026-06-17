import express from 'express';
import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';
import EmailService from '../services/EmailService.js';
import { authenticate, rateLimitLogin, rateLimitOTP, rateLimitPasswordReset } from '../middleware/auth.js';

// Helper to generate a UUID (simplified version)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user with email and password
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'REG_INVALID_INPUT',
          message: 'Email and password are required'
        }
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'REG_INVALID_EMAIL',
          message: 'Invalid email format'
        }
      });
    }

    // Validate password strength
    const passwordValidation = AuthService.validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'REG_WEAK_PASSWORD',
          message: 'Password does not meet requirements',
          details: passwordValidation.errors
        }
      });
    }

    // Check if email already exists
    const existingUser = await UserStore.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        data: null,
        error: {
          code: 'REG_EMAIL_EXISTS',
          message: 'Email already registered'
        }
      });
    }

    // Hash password
    const passwordHash = await AuthService.hashPassword(password);

    // Generate OTP (DISABLED FOR DEVELOPMENT - Auto-verify email)
    // TODO: Re-enable OTP in production
    // const otp = AuthService.generateOTP();
    // const otpData = AuthService.createOTPData(otp);

    // Create user with email already verified (skip OTP for development)
    const user = await UserStore.createUser({
      email,
      passwordHash,
      name: name || '',
      role: 'employee',
      emailVerified: true, // Auto-verify for development
      learningUUID: generateUUID(), // Generate learningUUID for user
      // otp: otpData.otp,
      // otpExpires: otpData.expiresAt
    });

    // Send OTP email (DISABLED FOR DEVELOPMENT)
    // await EmailService.sendOTP(email, otp, 10);

    // Log registration event
    await UserStore.logAuthEvent('registration', user.userId, {
      email,
      ipAddress: req.ip
    });

    res.status(201).json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        message: 'Registration successful. You can now log in.'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Registration error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'REG_ERROR',
        message: 'Registration failed'
      }
    });
  }
});

/**
 * POST /api/auth/verify-otp
 * Verify email with OTP code
 */
router.post('/verify-otp', rateLimitOTP, async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_INVALID_INPUT',
          message: 'Email and OTP are required'
        }
      });
    }

    // Get user
    const user = await UserStore.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Verify OTP
    const verification = AuthService.verifyOTP(otp, user.otp, user.otpExpires);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_INVALID',
          message: verification.error
        }
      });
    }

    // Mark email as verified and clear OTP
    await UserStore.updateUser(user.userId, {
      emailVerified: true,
      otp: null,
      otpExpires: null
    });

    // Log verification event
    await UserStore.logAuthEvent('email_verified', user.userId, {
      email,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        message: 'Email verified successfully. You can now log in.'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] OTP verification error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'OTP_ERROR',
        message: 'OTP verification failed'
      }
    });
  }
});

/**
 * POST /api/auth/resend-otp
 * Resend OTP verification code
 */
router.post('/resend-otp', rateLimitOTP, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_INVALID_INPUT',
          message: 'Email is required'
        }
      });
    }

    // Get user
    const user = await UserStore.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'OTP_ALREADY_VERIFIED',
          message: 'Email already verified'
        }
      });
    }

    // Generate new OTP
    const otp = AuthService.generateOTP();
    const otpData = AuthService.createOTPData(otp);

    // Update user with new OTP
    await UserStore.updateUser(user.userId, {
      otp: otpData.otp,
      otpExpires: otpData.expiresAt
    });

    // Send OTP email
    await EmailService.sendOTP(email, otp, 10);

    res.json({
      success: true,
      data: {
        message: 'New verification code sent to your email'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Resend OTP error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'OTP_ERROR',
        message: 'Failed to resend OTP'
      }
    });
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', rateLimitLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_INVALID_INPUT',
          message: 'Email and password are required'
        }
      });
    }

    // Get user
    const user = await UserStore.getUserByEmail(email);
    if (!user) {
      // Log failed login attempt
      await UserStore.logAuthEvent('login_failed', null, {
        email,
        reason: 'user_not_found',
        ipAddress: req.ip
      });

      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    // Verify password
    const isPasswordValid = await AuthService.comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      // Log failed login attempt
      await UserStore.logAuthEvent('login_failed', user.userId, {
        email,
        reason: 'invalid_password',
        ipAddress: req.ip
      });

      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    // Check if email is verified (DISABLED FOR DEVELOPMENT)
    // TODO: Re-enable email verification in production
    // if (!user.emailVerified) {
    //   return res.status(403).json({
    //     success: false,
    //     data: null,
    //     error: {
    //       code: 'AUTH_EMAIL_NOT_VERIFIED',
    //       message: 'Please verify your email before logging in'
    //     }
    //   });
    // }

    // Generate JWT token
    const token = AuthService.generateJWT(user.userId, user.email, user.role);

    // Update last login
    await UserStore.updateUser(user.userId, {
      lastLogin: new Date().toISOString()
    });

    // Log successful login
    await UserStore.logAuthEvent('login_success', user.userId, {
      email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          userId: user.userId,
          email: user.email,
          name: user.name,
          role: user.role,
          learningUUID: user.learningUUID
        }
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Login error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Login failed'
      }
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Log logout event
    await UserStore.logAuthEvent('logout', req.user.userId, {
      email: req.user.email,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        message: 'Logged out successfully'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Logout error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Logout failed'
      }
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await UserStore.getUserById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        role: user.role,
        learningUUID: user.learningUUID,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Get profile error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Failed to get profile'
      }
    });
  }
});

/**
 * POST /api/auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', rateLimitPasswordReset, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RESET_INVALID_INPUT',
          message: 'Email is required'
        }
      });
    }

    // Get user
    const user = await UserStore.getUserByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return res.json({
        success: true,
        data: {
          message: 'If the email exists, a password reset link has been sent'
        },
        error: null
      });
    }

    // Generate reset token
    const resetToken = AuthService.generateResetToken();
    const resetTokenData = AuthService.createResetTokenData(resetToken);

    // Update user with reset token
    await UserStore.updateUser(user.userId, {
      resetToken: resetTokenData.token,
      resetTokenExpires: resetTokenData.expiresAt
    });

    // Send password reset email
    await EmailService.sendPasswordReset(email, resetToken, 60);

    // Log password reset request
    await UserStore.logAuthEvent('password_reset_requested', user.userId, {
      email,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        message: 'If the email exists, a password reset link has been sent'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Forgot password error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'RESET_ERROR',
        message: 'Failed to process password reset request'
      }
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RESET_INVALID_INPUT',
          message: 'Token and new password are required'
        }
      });
    }

    // Validate password strength
    const passwordValidation = AuthService.validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RESET_WEAK_PASSWORD',
          message: 'Password does not meet requirements',
          details: passwordValidation.errors
        }
      });
    }

    // Find user with this reset token
    const allUsers = await UserStore.getAllUsers();
    const user = allUsers.find(u => u.resetToken === token);

    if (!user) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RESET_TOKEN_INVALID',
          message: 'Invalid or expired reset token'
        }
      });
    }

    // Verify reset token
    const verification = AuthService.verifyResetToken(token, user.resetToken, user.resetTokenExpires);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RESET_TOKEN_EXPIRED',
          message: verification.error
        }
      });
    }

    // Hash new password
    const passwordHash = await AuthService.hashPassword(newPassword);

    // Update user password and clear reset token
    await UserStore.updateUser(user.userId, {
      passwordHash,
      resetToken: null,
      resetTokenExpires: null
    });

    // Log password reset
    await UserStore.logAuthEvent('password_reset_completed', user.userId, {
      email: user.email,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        message: 'Password reset successfully. You can now log in with your new password.'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Reset password error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'RESET_ERROR',
        message: 'Failed to reset password'
      }
    });
  }
});

/**
 * POST /api/auth/change-password
 * Change password (authenticated)
 */
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'CHANGE_PASSWORD_INVALID_INPUT',
          message: 'Current password and new password are required'
        }
      });
    }

    // Get user
    const user = await UserStore.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Verify current password
    const isPasswordValid = await AuthService.comparePassword(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'CHANGE_PASSWORD_INVALID',
          message: 'Current password is incorrect'
        }
      });
    }

    // Validate new password strength
    const passwordValidation = AuthService.validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'CHANGE_PASSWORD_WEAK',
          message: 'New password does not meet requirements',
          details: passwordValidation.errors
        }
      });
    }

    // Hash new password
    const passwordHash = await AuthService.hashPassword(newPassword);

    // Update user password
    await UserStore.updateUser(user.userId, {
      passwordHash
    });

    // Log password change
    await UserStore.logAuthEvent('password_changed', user.userId, {
      email: user.email,
      ipAddress: req.ip
    });

    res.json({
      success: true,
      data: {
        message: 'Password changed successfully'
      },
      error: null
    });
  } catch (error) {
    console.error('[Auth Routes] Change password error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'CHANGE_PASSWORD_ERROR',
        message: 'Failed to change password'
      }
    });
  }
});

/**
 * POST /api/auth/activate
 * Validate activation token and set password — completes account setup from invitation email
 */
router.post('/activate', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, error: { message: 'Token and password required' } });
    if (password.length < 6) return res.status(400).json({ success: false, error: { message: 'Password must be at least 6 characters' } });

    const { ActivationTokens } = await import('../services/DataStore.js');
    const record = await ActivationTokens.getById(token);
    if (!record) return res.status(400).json({ success: false, error: { message: 'Invalid or expired activation link' } });
    if (record.used) return res.status(400).json({ success: false, error: { message: 'This activation link has already been used' } });
    if (new Date(record.expiresAt) < new Date()) return res.status(400).json({ success: false, error: { message: 'Activation link expired — ask your admin to resend the invite' } });

    const user = await UserStore.getUserById(record.userId);
    if (!user) return res.status(404).json({ success: false, error: { message: 'User account not found' } });

    const passwordHash = await AuthService.hashPassword(password);
    await UserStore.updateUser(record.userId, { passwordHash, emailVerified: true });
    await ActivationTokens.delete(token);

    const authToken = AuthService.generateToken({ userId: user.userId, email: user.email, role: user.role, companyId: user.companyId });
    res.json({ success: true, data: { token: authToken, user: { userId: user.userId, email: user.email, name: user.name, role: user.role } } });
  } catch (e) {
    console.error('[auth/activate]', e.message);
    res.status(500).json({ success: false, error: { message: 'Activation failed' } });
  }
});

/**
 * GET /api/auth/validate-token/:token
 * Check if an activation token is valid (for preflight on the activation page)
 */
router.get('/validate-token/:token', async (req, res) => {
  try {
    const { ActivationTokens } = await import('../services/DataStore.js');
    const record = await ActivationTokens.getById(req.params.token);
    if (!record || record.used || new Date(record.expiresAt) < new Date()) {
      return res.json({ success: true, data: { valid: false } });
    }
    const user = await UserStore.getUserById(record.userId);
    res.json({ success: true, data: { valid: true, email: record.email, name: user?.name, role: user?.role } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
