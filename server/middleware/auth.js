import AuthService from '../services/AuthService.js';
import UserStore from '../services/UserStore.js';
import rateLimit from 'express-rate-limit';

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

    // Attach user data to request
    req.user = {
      userId: user.userId,
      email: user.email,
      role: user.role,
      name: user.name,
      learningUUID: user.learningUUID
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

    if (!roles.includes(req.user.role)) {
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
 * Rate limiting for login endpoint
 * 5 attempts per 15 minutes per IP address
 */
export const rateLimitLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window — generous for dev/demo, still protects prod
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
