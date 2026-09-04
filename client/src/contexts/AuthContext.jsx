import React, { createContext, useContext, useState, useEffect } from 'react';
import { sanitizeError } from '../utils/authFetch.js';

// Create the Auth Context
const AuthContext = createContext({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  login: async (email, password) => {},
  loginWithGoogle: async (code) => {},
  logout: () => {},
  register: async (email, password, name) => {},
  verifyOTP: async (otp, email) => {},
  requestPasswordReset: async (email) => {},
  resetPassword: async (token, newPassword) => {},
  updateProfile: async (updates) => {},
  hasRole: (role) => false,
  hasPermission: (permission) => false,
  setAuthFromToken: (token, userData) => {},
});

// Custom hook to use the Auth Context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Determine API base URL based on environment
// VITE_API_URL is set on Vercel to point to the Render backend
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.PROD) return '';
  return 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();

// Module-level dedup guard: prevents multiple concurrent 401s from each
// triggering an independent refresh call.
let _refreshPromise = null;

// Auth Provider Component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Refresh token helpers ────────────────────────────────────────────────────

  const storeTokens = (accessToken, refreshToken, userData) => {
    localStorage.setItem('auth_token', accessToken);
    if (refreshToken) localStorage.setItem('auth_refresh_token', refreshToken);
    if (userData?.learningUUID) {
      localStorage.setItem('skillforge:userId', userData.learningUUID);
    } else if (userData?.userId) {
      localStorage.setItem('skillforge:userId', userData.userId);
    }
    setToken(accessToken);
    if (userData) setUser(userData);
  };

  const clearTokens = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_refresh_token');
    localStorage.removeItem('skillforge:userId');
    localStorage.removeItem('active_role');
    setToken(null);
    setUser(null);
  };

  // Silently exchange the stored refresh token for a new access + refresh pair.
  // Deduplicates: concurrent callers get the same promise.
  // Returns the new access token string, or null on failure.
  const refreshAccessToken = () => {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async () => {
      try {
        const storedRefresh = localStorage.getItem('auth_refresh_token');
        if (!storedRefresh) {
          handleTokenExpiration();
          return null;
        }

        const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: storedRefresh }),
        });

        if (!res.ok) {
          handleTokenExpiration();
          return null;
        }

        const data = await res.json();
        if (!data?.success || !data?.data?.token) {
          handleTokenExpiration();
          return null;
        }

        const { token: newAccess, refreshToken: newRefresh } = data.data;
        localStorage.setItem('auth_token', newAccess);
        if (newRefresh) localStorage.setItem('auth_refresh_token', newRefresh);
        setToken(newAccess);
        return newAccess;
      } catch {
        handleTokenExpiration();
        return null;
      } finally {
        _refreshPromise = null;
      }
    })();

    return _refreshPromise;
  };

  // ── authRequest ──────────────────────────────────────────────────────────────

  // Helper function to make authenticated API requests.
  // On 401: silently tries refresh once; if that fails, clears session.
  const authRequest = async (path, options = {}) => {
    const fullUrl = `${API_BASE_URL}${path}`;
    const currentToken = localStorage.getItem('auth_token') || token;

    const makeRequest = async (bearerToken) => {
      const response = await fetch(fullUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(bearerToken && { Authorization: `Bearer ${bearerToken}` }),
          ...(options.headers || {}),
        },
        ...options,
      });

      const rawBody = await response.text();
      let payload = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          throw new Error(`Server returned a non-JSON response (${response.status})`);
        }
      }
      return { response, payload };
    };

    try {
      let { response, payload } = await makeRequest(currentToken);

      if (!response.ok) {
        // On 401: attempt a silent token refresh before giving up.
        // Skip for auth endpoints themselves to avoid infinite loops.
        const isAuthEndpoint =
          path.includes('/api/auth/refresh') ||
          path.includes('/api/auth/login') ||
          path.includes('/api/auth/logout');

        if (response.status === 401 && currentToken && !isAuthEndpoint) {
          const newToken = await refreshAccessToken();
          if (newToken) {
            // Retry the original request with the fresh access token
            const retry = await makeRequest(newToken);
            if (!retry.response.ok) {
              const retryErr = retry.payload?.error;
              const retryMsg =
                typeof retryErr === 'string'
                  ? retryErr
                  : retryErr?.message || `Request failed with status ${retry.response.status}`;
              throw new Error(sanitizeError(retryMsg));
            }
            return retry.payload;
          }
          // refreshAccessToken already called handleTokenExpiration
          throw new Error('Session expired. Please log in again.');
        }

        if (response.status === 401 && currentToken) {
          handleTokenExpiration();
        }

        const errorBody = payload?.error;
        const errorMessage =
          typeof errorBody === 'string'
            ? errorBody
            : errorBody?.message || errorBody?.detail || `Request failed with status ${response.status}`;
        throw new Error(sanitizeError(errorMessage));
      }

      return payload;
    } catch (error) {
      throw error;
    }
  };

  // Handle token expiration — clear all auth state and go to landing
  const handleTokenExpiration = () => {
    clearTokens();
    window.location.href = '/';
  };

  // ── Initialize auth state from localStorage on mount ────────────────────────
  // Retries up to 4 times (covers Render ~30s cold-start) before giving up.
  // IMPORTANT: never clears the token on a network error — only on a definitive 401/403.
  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('auth_token');

      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      setToken(storedToken);

      const MAX_TRIES = 4;
      const RETRY_MS  = [2000, 4000, 6000, 8000];

      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId  = setTimeout(() => controller.abort(), 15000);

          const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${storedToken}` },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const payload = await response.json();
            setUser(payload.data ?? payload);
            break;
          }

          // 401 / 403 → JWT is invalid or expired; try refresh before giving up
          if (response.status === 401 || response.status === 403) {
            const storedRefresh = localStorage.getItem('auth_refresh_token');
            if (storedRefresh) {
              const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: storedRefresh }),
              });
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                if (refreshData?.success && refreshData?.data?.token) {
                  const { token: newAccess, refreshToken: newRefresh } = refreshData.data;
                  localStorage.setItem('auth_token', newAccess);
                  if (newRefresh) localStorage.setItem('auth_refresh_token', newRefresh);
                  setToken(newAccess);
                  // Retry /me with the fresh token
                  const meRetry = await fetch(`${API_BASE_URL}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${newAccess}` },
                  });
                  if (meRetry.ok) {
                    const mePayload = await meRetry.json();
                    setUser(mePayload.data ?? mePayload);
                  }
                  break;
                }
              }
            }
            // No refresh token or refresh failed — clear everything
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_refresh_token');
            setToken(null);
            break;
          }

          // Any other HTTP error (5xx, etc.) → retry
        } catch (_err) {
          // Network error / timeout → backend is cold-starting; wait and retry
          if (attempt < MAX_TRIES - 1) {
            await new Promise(r => setTimeout(r, RETRY_MS[attempt]));
          }
          // On final attempt, keep the token — we'll try again on next navigation
        }
      }

      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  // ── Login ────────────────────────────────────────────────────────────────────

  const login = async (email, password) => {
    try {
      const response = await authRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (response.success && response.data) {
        // New/regenerated accounts must set a real password before a session is granted.
        if (response.data.requiresPasswordChange) {
          return { success: true, requiresPasswordChange: true, email: response.data.email };
        }

        const { token: newToken, refreshToken, user: userData } = response.data;
        storeTokens(newToken, refreshToken, userData);
        return { success: true, data: userData };
      } else {
        throw new Error(response.error?.message || 'Login failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // Completes the forced-password-change flow, then establishes a normal session.
  const completePasswordChange = async (email, currentPassword, newPassword) => {
    try {
      const response = await authRequest('/api/auth/complete-password-change', {
        method: 'POST',
        body: JSON.stringify({ email, currentPassword, newPassword }),
      });

      if (response.success && response.data) {
        const { token: newToken, refreshToken, user: userData } = response.data;
        storeTokens(newToken, refreshToken, userData);
        return { success: true, data: userData };
      }
      throw new Error(response.error?.message || 'Failed to update password');
    } catch (error) {
      throw error;
    }
  };

  // Login with Google OAuth
  const loginWithGoogle = async (code) => {
    try {
      const response = await authRequest('/api/oauth/google/callback', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      if (response.success && response.data) {
        const { token: newToken, refreshToken, user: userData } = response.data;
        storeTokens(newToken, refreshToken, userData);
        return { success: true, data: userData };
      } else {
        throw new Error(response.error?.message || 'Google login failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // ── Logout ───────────────────────────────────────────────────────────────────

  const logout = () => {
    const currentToken   = localStorage.getItem('auth_token');
    const currentRefresh = localStorage.getItem('auth_refresh_token');

    // Fire-and-forget: notify server to blocklist the JWT and revoke the refresh token.
    // Client-side cleanup always proceeds regardless of network outcome.
    if (currentToken) {
      fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ refreshToken: currentRefresh || '' }),
      }).catch(() => {});
    }

    clearTokens();
    window.location.href = '/';
  };

  // ── Register ─────────────────────────────────────────────────────────────────

  const register = async (email, password, name, extras = {}) => {
    try {
      const response = await authRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, ...extras }),
      });

      if (response.success) {
        return { success: true, data: response.data };
      } else {
        throw new Error(response.error?.message || 'Registration failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // ── OTP ──────────────────────────────────────────────────────────────────────

  const verifyOTP = async (otp, email) => {
    try {
      const verificationEmail = email || sessionStorage.getItem('pendingVerificationEmail');
      if (!verificationEmail) {
        throw new Error('Email address is required for verification');
      }

      const response = await authRequest('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ otp, email: verificationEmail }),
      });

      if (response.success) {
        return { success: true, data: response.data };
      } else {
        throw new Error(response.error?.message || 'OTP verification failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // ── Set auth from token (OAuth callback) ────────────────────────────────────

  const setAuthFromToken = (newToken, userData, newRefreshToken) => {
    storeTokens(newToken, newRefreshToken || null, userData);
  };

  // ── Password management ──────────────────────────────────────────────────────

  const requestPasswordReset = async (email) => {
    try {
      const response = await authRequest('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      if (response.success) {
        return { success: true, data: response.data };
      } else {
        throw new Error(response.error?.message || 'Password reset request failed');
      }
    } catch (error) {
      throw error;
    }
  };

  const resetPassword = async (resetToken, newPassword) => {
    try {
      const response = await authRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });

      if (response.success) {
        return { success: true, data: response.data };
      } else {
        throw new Error(response.error?.message || 'Password reset failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // ── Profile ──────────────────────────────────────────────────────────────────

  const updateProfile = async (updates) => {
    try {
      if (!user) throw new Error('User not authenticated');

      const response = await authRequest(`/api/users/${user.userId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });

      if (response.success && response.data) {
        setUser(response.data);
        return { success: true, data: response.data };
      } else {
        throw new Error(response.error?.message || 'Profile update failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // ── Active role ──────────────────────────────────────────────────────────────

  const [activeRole, setActiveRoleState] = useState(() => {
    return localStorage.getItem('active_role') || null;
  });

  const getEffectiveRole = () => {
    if (!user) return null;
    const all = [user.role, ...(user.accesses || [])];
    if (activeRole && all.includes(activeRole)) return activeRole;
    return user.role;
  };

  const switchRole = (role) => {
    if (!user) return;
    const all = [user.role, ...(user.accesses || [])];
    if (!all.includes(role)) return;
    localStorage.setItem('active_role', role);
    setActiveRoleState(role);
  };

  // ── Role / permission helpers ────────────────────────────────────────────────

  const hasRole = (role) => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const effectiveRole = getEffectiveRole();
    const all = [...new Set([user.role, effectiveRole, ...(user.accesses || [])].filter(Boolean))];
    if (Array.isArray(role)) return role.some(r => all.includes(r));
    return all.includes(role);
  };

  const hasPermission = (permission) => {
    if (!user) return false;

    const rolePermissions = {
      superadmin: [
        'manage_platform', 'manage_companies', 'manage_admins', 'view_all', 'create_companies',
        'manage_users', 'create_content', 'assign_managers',
        'manage_employees', 'view_all_reports', 'manage_modules',
        'create_tasks', 'create_plans', 'view_all_users', 'modify_roles', 'view_all_data',
        'access_learning', 'manage_assessments', 'view_analytics',
      ],
      admin: [
        'create_content', 'create_tasks', 'create_plans', 'assign_managers', 'view_all_users',
        'modify_roles', 'view_all_data', 'manage_employees', 'access_learning',
        'manage_assessments', 'view_analytics',
      ],
      manager: [
        'view_assigned_employees', 'create_content_for_employees', 'view_employee_progress',
        'create_tasks_for_employees', 'access_learning', 'manage_assessments', 'view_team_analytics',
      ],
      employee: [
        'access_learning', 'view_own_progress', 'submit_sessions', 'view_own_reports',
        'view_own_skill_tree', 'take_assessments',
      ],
    };

    // Use the switched (effective) role, not always the primary role — a user
    // who switches to "Employee View" via hasRole()-gated UI must also see
    // permission-gated UI change consistently, instead of still seeing
    // permissions for the role they switched away from.
    const userPermissions = rolePermissions[getEffectiveRole()] || [];
    return userPermissions.includes(permission);
  };

  const getDashboardRoute = () => {
    if (!user) return '/';
    const role = getEffectiveRole();
    switch (role) {
      case 'superadmin': return '/superadmin/dashboard';
      case 'admin':      return '/admin/dashboard';
      case 'manager':    return '/manager/dashboard';
      default:           return '/employee/dashboard';
    }
  };

  const redirectToDashboard = () => {
    const route = getDashboardRoute();
    window.location.href = route;
  };

  // ── Context value ────────────────────────────────────────────────────────────

  const value = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    login,
    completePasswordChange,
    loginWithGoogle,
    logout,
    register,
    verifyOTP,
    requestPasswordReset,
    resetPassword,
    updateProfile,
    hasRole,
    hasPermission,
    getDashboardRoute,
    redirectToDashboard,
    setAuthFromToken,
    activeRole: getEffectiveRole(),
    switchRole,
    accesses: user?.accesses || [],
    allRoles: user ? [user.role, ...(user.accesses || [])] : [],
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
