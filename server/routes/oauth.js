import express from 'express';
import OAuthService from '../services/OAuthService.js';
import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';

const router = express.Router();

/**
 * GET /api/oauth/google
 * Redirect to Google OAuth authorization page
 */
router.get('/google', (req, res) => {
  try {
    if (!OAuthService.isGoogleConfigured()) {
      return res.status(503).json({
        success: false,
        data: null,
        error: {
          code: 'OAUTH_NOT_CONFIGURED',
          message: 'Google OAuth is not configured'
        }
      });
    }

    const authUrl = OAuthService.getGoogleAuthURL();
    res.redirect(authUrl);
  } catch (error) {
    console.error('[OAuth Routes] Google auth URL error:', error.message);
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'OAUTH_ERROR',
        message: 'Failed to initiate Google OAuth'
      }
    });
  }
});

/**
 * GET /api/oauth/google/callback
 * Handle Google OAuth callback
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;

    // Handle OAuth error from Google
    if (error) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=oauth_failed&message=${encodeURIComponent(error)}`);
    }

    if (!code) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=oauth_failed&message=No authorization code received`);
    }

    // Handle Google OAuth callback
    const result = await OAuthService.handleGoogleCallback(code);

    if (!result.success) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=oauth_failed&message=${encodeURIComponent(result.error)}`);
    }

    const { profile } = result;

    // Check if user exists by Google ID
    let user = await UserStore.getUserByGoogleId(profile.googleId);

    if (!user) {
      // Check if user exists by email
      user = await UserStore.getUserByEmail(profile.email);

      if (user) {
        // Link Google account to existing user
        await UserStore.updateUser(user.userId, {
          googleId: profile.googleId,
          emailVerified: true // Auto-verify email for Google users
        });

        // Log Google account linking
        await UserStore.logAuthEvent('google_account_linked', user.userId, {
          email: profile.email,
          googleId: profile.googleId,
          ipAddress: req.ip
        });
      } else {
        // Create new user with Google account
        user = await UserStore.createUser({
          email: profile.email,
          passwordHash: null, // No password for OAuth-only users
          name: profile.name,
          role: 'employee',
          emailVerified: true, // Auto-verify email for Google users
          googleId: profile.googleId
        });

        // Log new user registration via Google
        await UserStore.logAuthEvent('registration', user.userId, {
          email: profile.email,
          method: 'google_oauth',
          googleId: profile.googleId,
          ipAddress: req.ip
        });
      }
    }

    // Generate JWT token
    const token = AuthService.generateJWT(user.userId, user.email, user.role);

    // Update last login
    await UserStore.updateUser(user.userId, {
      lastLogin: new Date().toISOString()
    });

    // Log successful login
    await UserStore.logAuthEvent('login_success', user.userId, {
      email: user.email,
      method: 'google_oauth',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/oauth/callback?token=${token}`);
  } catch (error) {
    console.error('[OAuth Routes] Google callback error:', error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
  }
});

export default router;
