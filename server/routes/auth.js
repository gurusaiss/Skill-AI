import express from 'express';
import { randomUUID } from 'crypto';
import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';
import EmailService from '../services/EmailService.js';
import { authenticate, rateLimitLogin, rateLimitOTP, rateLimitPasswordReset } from '../middleware/auth.js';
import { Companies, RoleLibrary, UserJDProfiles, Assessments, GeneratedContent, AccessCodes } from '../services/DataStore.js';

// Pick balanced questions from pre-generated bank (40% easy, 40% medium, 20% hard)
function pickFromBank(bank, target = 10) {
  if (!bank?.length) return [];
  const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
  const easy = shuffle(bank.filter(q => q.difficulty === 'easy'));
  const med  = shuffle(bank.filter(q => q.difficulty === 'medium'));
  const hard = shuffle(bank.filter(q => q.difficulty === 'hard'));
  const n = Math.min(target, bank.length);
  const eN = Math.round(n * 0.4), mN = Math.round(n * 0.4), hN = n - eN - mN;
  let picked = [...easy.slice(0, eN), ...med.slice(0, mN), ...hard.slice(0, hN)];
  if (picked.length < n) {
    const used = new Set(picked.map(q => q.id));
    picked = [...picked, ...shuffle(bank).filter(q => !used.has(q.id))].slice(0, n);
  }
  return picked;
}

// Helper to generate a UUID (simplified version)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const router = express.Router();

/**
 * GET /api/auth/validate-company-code?code=GSS-MGR-8X92
 * Public — validate an access code (manager or employee) and return company info + detected role
 */
router.get('/validate-company-code', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code?.trim()) return res.json({ success: false, error: 'Access code required' });

    const clean = code.trim().toUpperCase();
    const accessCode = await AccessCodes.findByCode(clean);
    if (!accessCode) {
      return res.json({ success: false, error: { message: 'Invalid access code' } });
    }
    if (!accessCode.isActive) {
      return res.json({ success: false, error: { message: 'This access code has been disabled' } });
    }
    if (accessCode.expiresAt && new Date(accessCode.expiresAt) < new Date()) {
      return res.json({ success: false, error: { message: 'This access code has expired' } });
    }
    if (accessCode.maxUsage != null && accessCode.usageCount >= accessCode.maxUsage) {
      return res.json({ success: false, error: { message: 'This access code has reached its usage limit' } });
    }

    const company = await Companies.getById(accessCode.companyId);
    if (!company || company.status !== 'active') {
      return res.json({ success: false, error: { message: 'Company not found or inactive' } });
    }

    const roles = await RoleLibrary.getByCompany(company.id);
    res.json({
      success: true,
      data: {
        companyId: company.id,
        companyName: company.name,
        detectedRole: accessCode.role,
        codeId: accessCode.id,
        roles: (roles || []).filter(r => r.status === 'active').map(r => ({ id: r.id, roleName: r.roleName, department: r.department })),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/auth/register
 * Register a new user — supports company-code self-onboarding
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, companyCode, jobRole, employeeId, phone } = req.body;

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

    // Access code validation (if provided)
    let linkedCompany = null;
    let linkedRole = null;
    let detectedRole = 'employee';
    let linkedAccessCode = null;
    if (companyCode?.trim()) {
      const clean = companyCode.trim().toUpperCase();
      linkedAccessCode = await AccessCodes.findByCode(clean);
      if (!linkedAccessCode) {
        return res.status(400).json({ success: false, data: null, error: { code: 'REG_INVALID_CODE', message: 'Invalid access code' } });
      }
      if (!linkedAccessCode.isActive) {
        return res.status(400).json({ success: false, data: null, error: { code: 'REG_CODE_DISABLED', message: 'This access code has been disabled' } });
      }
      if (linkedAccessCode.expiresAt && new Date(linkedAccessCode.expiresAt) < new Date()) {
        return res.status(400).json({ success: false, data: null, error: { code: 'REG_CODE_EXPIRED', message: 'This access code has expired' } });
      }
      if (linkedAccessCode.maxUsage != null && linkedAccessCode.usageCount >= linkedAccessCode.maxUsage) {
        return res.status(400).json({ success: false, data: null, error: { code: 'REG_CODE_LIMIT', message: 'This access code has reached its usage limit' } });
      }

      linkedCompany = await Companies.getById(linkedAccessCode.companyId);
      if (!linkedCompany || linkedCompany.status !== 'active') {
        return res.status(400).json({ success: false, data: null, error: { code: 'REG_INVALID_COMPANY', message: 'Company not found or inactive' } });
      }

      detectedRole = linkedAccessCode.role || 'employee';
      if (jobRole?.trim()) {
        linkedRole = await RoleLibrary.findByName(jobRole.trim(), linkedCompany.id);
      }
    }

    const user = await UserStore.createUser({
      email,
      passwordHash,
      name: name || '',
      role: detectedRole,
      emailVerified: true,
      learningUUID: generateUUID(),
      companyId: linkedCompany?.id || 'default',
      companyName: linkedCompany?.name || '',
      jobRole: linkedRole?.roleName || jobRole || '',
      department: linkedRole?.department || '',
      jobDescription: linkedRole?.jobDescription || '',
      jdSkills: linkedRole?.skills || [],
      employeeId: employeeId || '',
      phone: phone || '',
    });

    // Save JD profile if role resolved
    if (linkedRole) {
      await UserJDProfiles.upsert(user.userId, {
        jobDescription: linkedRole.jobDescription || '',
        jdSkills: linkedRole.skills || [],
        jdSourceType: 'role_library',
        roleId: linkedRole.id,
        roleName: linkedRole.roleName,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    // Increment access code usage count
    if (linkedAccessCode) {
      AccessCodes.update(linkedAccessCode.id, {
        usageCount: (linkedAccessCode.usageCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    await UserStore.logAuthEvent('registration', user.userId, { email, companyCode: companyCode || null, ipAddress: req.ip });

    // Auto-assign pre-assessment from Role Library question bank (non-blocking, no LLM calls)
    if (user.jobRole || linkedRole) {
      setImmediate(async () => {
        try {
          const role      = linkedRole?.roleName || user.jobRole || 'Employee';
          const companyId = user.companyId || 'default';
          const roleMatch = linkedRole || await RoleLibrary.findByName(role, companyId).catch(() => null);
          const bank      = roleMatch?.questionBank || [];

          if (bank.length < 5) {
            console.warn(`[auto-assessment] Role "${role}" has no question bank — skipping pre-assessment for ${user.email}`);
            return;
          }

          const questions = pickFromBank(bank, 10);
          const assessmentId = randomUUID();
          const assessment = {
            id: assessmentId,
            title: `Pre-Assessment: ${role}`,
            targetUsers: [user.userId],
            employeeAssignments: [{
              userId: user.userId, userName: user.name, userEmail: user.email,
              jobRole: role, questions, status: 'assigned',
              assignedAt: new Date().toISOString(), startedAt: null, submittedAt: null,
            }],
            questionCount: questions.length, questionTypes: ['mcq'], duration: 30,
            createdBy: 'system', companyId,
            isAutoGenerated: true, autoTrigger: 'self_registration',
            fromRoleId: roleMatch?.id || null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isActive: true,
          };

          await Assessments.create(assessment);
          console.log(`[auto-assessment] Pre-assessment created for ${user.email} (${role}) — ${questions.length} questions from bank`);
        } catch (e) {
          console.error(`[auto-assessment] Failed for ${user.email}:`, e.message);
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        userId: user.userId,
        email: user.email,
        companyName: linkedCompany?.name || null,
        jobRole: linkedRole?.roleName || jobRole || null,
        assessmentPending: !!(user.jobRole || linkedRole),
        message: 'Registration successful. You can now log in.',
      },
      error: null,
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

    const authToken = AuthService.generateJWT(user.userId, user.email, user.role);
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
