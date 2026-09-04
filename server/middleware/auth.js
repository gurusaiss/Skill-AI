import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';
import rateLimit from 'express-rate-limit';
import { isBlocklisted } from '../security/tokenBlocklist.js';

// Shared by authenticate() below AND routes/auth.js's login/me/password-change
// responses — these MUST stay in sync. A manager/admin who has never had
// `accesses` explicitly set (the common case) implicitly gets the standard
// role-switch options (manager -> employee, admin -> manager+employee) so
// the "Switch to X View" UI has something to offer. Previously this default
// was applied only in routes/auth.js (to decide what the CLIENT shows in the
// switcher), while this middleware checked the raw, un-derived DB value (to
// decide what the SERVER actually authorizes) — so for any user who fell
// into the implicit-default case, the switcher showed options that silently
// did nothing: the client would send X-Active-Role, but the server would
// reject it (not in the raw accesses list) and keep authorizing as the
// primary role, with no error and no indication the switch didn't take.
export function getEffectiveAccesses(user) {
  const stored = user.accesses || [];
  if (stored.length > 0) return stored;
  if (user.role === 'manager') return ['employee'];
  if (user.role === 'admin') return ['manager', 'employee'];
  return stored;
}

/**
 * Authentication middleware - Verify JWT token
 * Extracts and verifies JWT from Authorization header
 * Attaches user data to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'No authentication token provided'
        }
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const decoded = AuthService.verifyJWT(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message: 'Invalid or expired authentication token'
        }
      });
    }

    // Reject tokens that were explicitly revoked on logout
    if (isBlocklisted(token)) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_TOKEN_REVOKED',
          message: 'Session has been invalidated. Please log in again.'
        }
      });
    }

    // Get full user data from store
    const user = await UserStore.getUserById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Determine effective role: X-Active-Role header if user has that access, else primary role
    const requestedRole = req.headers['x-active-role'];
    const userAccesses = getEffectiveAccesses(user);
    const allRoles = [user.role, ...userAccesses];
    const effectiveRole = (requestedRole && allRoles.includes(requestedRole))
      ? requestedRole
      : user.role;

    // Attach user data to request
    req.user = {
      userId: user.userId,
      email: user.email,
      role: effectiveRole,
      primaryRole: user.role,
      accesses: userAccesses,
      name: user.name,
      learningUUID: user.learningUUID,
      companyId: user.companyId || 'default',
    };

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error.message);
    return res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication error'
      }
    });
  }
};

/**
 * Role-based authorization middleware
 * Checks if user has required role(s)
 * @param {...string} roles - Required roles (OR logic)
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
    }

    // superadmin has access to everything
    if (req.user.primaryRole === 'superadmin' || req.user.role === 'superadmin') return next();

    // Check effective role OR primary role OR any granted access
    const allUserRoles = [req.user.role, req.user.primaryRole, ...(req.user.accesses || [])].filter(Boolean);
    if (!roles.some(r => allUserRoles.includes(r))) {
      return res.status(403).json({
        success: false,
        data: null,
        error: {
          code: 'AUTH_FORBIDDEN',
          message: 'Insufficient permissions'
        }
      });
    }

    next();
  };
};

/**
 * Super Admin only middleware
 * Rejects any request from a non-superadmin user
 */
export const requireSuperAdmin = (req, res, next) => {
  // Check primaryRole too, matching requireRole's pattern (line 142) — a
  // superadmin who has switched their active role via X-Active-Role must not
  // lock themselves out of /api/superadmin/* just because req.user.role is
  // temporarily something else. They're still genuinely the superadmin.
  if (!req.user || (req.user.role !== 'superadmin' && req.user.primaryRole !== 'superadmin')) {
    return res.status(403).json({
      success: false,
      data: null,
      error: { code: 'FORBIDDEN', message: 'Super Admin access required' }
    });
  }
  next();
};

/**
 * Rate limiting for login endpoint
 * 5 attempts per 15 minutes per IP address
 */
export const rateLimitLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per IP per window — brute-force protection
  message: {
    success: false,
    data: null,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiting for OTP endpoints
 * 3 requests per hour per user
 */
export const rateLimitOTP = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: {
    success: false,
    data: null,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many OTP requests. Please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiting for password reset endpoint
 * 3 requests per hour per email
 */
export const rateLimitPasswordReset = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: {
    success: false,
    data: null,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many password reset requests. Please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * CORS configuration middleware
 * Already handled by cors package in main server file
 * This is just documentation of the configuration
 */
export const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    process.env.FRONTEND_URL
  ].filter(Boolean), // Remove undefined values
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // 10 minutes
};
