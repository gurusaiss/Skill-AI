import React, { createContext, useContext, useState, useEffect } from 'react';

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

// Auth Provider Component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function to make authenticated API requests
  const authRequest = async (path, options = {}) => {
    const fullUrl = `${API_BASE_URL}${path}`;
    
    try {
      const response = await fetch(fullUrl, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(options.headers || {}),
        },
        ...options,
      });

      const rawBody = await response.text();
      let payload = null;

      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch (error) {
          throw new Error(`Server returned a non-JSON response (${response.status})`);
        }
      }

      if (!response.ok) {
        // Handle token expiration
        if (response.status === 401 && token) {
          handleTokenExpiration();
        }

        const errorBody = payload?.error;
        const errorMessage = typeof errorBody === 'string'
          ? errorBody
          : (errorBody?.message || errorBody?.detail || `Request failed with status ${response.status}`);
        throw new Error(errorMessage);
      }

      return payload;
    } catch (error) {
      throw error;
    }
  };

  // Handle token expiration
  const handleTokenExpiration = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
    // Redirect to login page
    window.location.href = '/';
  };

  // Initialize auth state from localStorage on mount
  // Retries up to 4 times (covers Render ~30s cold-start) before giving up.
  // IMPORTANT: never clears the token on a network error — only on a 401/403.
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

          // 401 / 403 → token is genuinely invalid; clear it and stop retrying
          if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('auth_token');
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

  // Login with email and password
  const login = async (email, password) => {
    try {
      const response = await authRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (response.success && response.data) {
        const { token: newToken, user: userData } = response.data;
        
        // Store token and learning user ID in localStorage
        localStorage.setItem('auth_token', newToken);
        if (userData?.learningUUID) {
          localStorage.setItem('skillforge:userId', userData.learningUUID);
        } else if (userData?.userId) {
          localStorage.setItem('skillforge:userId', userData.userId);
        }
        setToken(newToken);
        setUser(userData);
        
        return { success: true, data: userData };
      } else {
        throw new Error(response.error?.message || 'Login failed');
      }
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
        const { token: newToken, user: userData } = response.data;
        
        // Store token and learning user ID in localStorage
        localStorage.setItem('auth_token', newToken);
        if (userData?.learningUUID) {
          localStorage.setItem('skillforge:userId', userData.learningUUID);
        } else if (userData?.userId) {
          localStorage.setItem('skillforge:userId', userData.userId);
        }
        setToken(newToken);
        setUser(userData);
        
        return { success: true, data: userData };
      } else {
        throw new Error(response.error?.message || 'Google login failed');
      }
    } catch (error) {
      throw error;
    }
  };

  // Logout
  const logout = () => {
    // Remove auth state from localStorage
    localStorage.removeItem('auth_token');
    localStorage.removeItem('skillforge:userId');
    setToken(null);
    setUser(null);
    
    // Redirect to landing page
    window.location.href = '/';
  };

  // Register new user
  const register = async (email, password, name) => {
    try {
      const response = await authRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
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

  // Verify OTP
  const verifyOTP = async (otp, email) => {
    try {
      // Get email from session storage if not provided
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

  // Set auth from token (for OAuth callback)
  const setAuthFromToken = (newToken, userData) => {
    localStorage.setItem('auth_token', newToken);
    if (userData?.learningUUID) {
      localStorage.setItem('skillforge:userId', userData.learningUUID);
    } else if (userData?.userId) {
      localStorage.setItem('skillforge:userId', userData.userId);
    }
    setToken(newToken);
    setUser(userData);
  };

  // Request password reset
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

  // Reset password with token
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

  // Update user profile
  const updateProfile = async (updates) => {
    try {
      if (!user) {
        throw new Error('User not authenticated');
      }

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

  // Check if user has a specific role
  const hasRole = (role) => {
    if (!user) return false;

    // superadmin has access to all roles
    if (user.role === 'superadmin' && (role === 'admin' || role === 'manager')) return true;

    // Support multiple role checks (array or single role)
    if (Array.isArray(role)) {
      return role.includes(user.role);
    }

    return user.role === role;
  };

  // Check if user has a specific permission
  const hasPermission = (permission) => {
    if (!user) return false;

    // Define role-based permissions
    const rolePermissions = {
      superadmin: [
        'manage_platform',
        'manage_companies',
        'manage_admins',
        'view_all',
        'create_companies',
        // inherits all admin permissions too
        'manage_users', 'create_content', 'assign_managers',
        'manage_employees', 'view_all_reports', 'manage_modules',
        // also inherits standard admin permissions
        'create_tasks',
        'create_plans',
        'view_all_users',
        'modify_roles',
        'view_all_data',
        'access_learning',
        'manage_assessments',
        'view_analytics',
      ],
      admin: [
        'create_content',
        'create_tasks',
        'create_plans',
        'assign_managers',
        'view_all_users',
        'modify_roles',
        'view_all_data',
        'manage_employees',
        'access_learning',
        'manage_assessments',
        'view_analytics',
      ],
      manager: [
        'view_assigned_employees',
        'create_content_for_employees',
        'view_employee_progress',
        'create_tasks_for_employees',
        'access_learning',
        'manage_assessments',
        'view_team_analytics',
      ],
      employee: [
        'access_learning',
        'view_own_progress',
        'submit_sessions',
        'view_own_reports',
        'view_own_skill_tree',
        'take_assessments',
      ],
    };

    const userPermissions = rolePermissions[user.role] || [];
    return userPermissions.includes(permission);
  };

  // Get dashboard route based on user role
  const getDashboardRoute = () => {
    if (!user) return '/';

    switch (user.role) {
      case 'superadmin':
        return '/superadmin/dashboard';
      case 'admin':
        return '/admin/dashboard';
      case 'manager':
        return '/manager/dashboard';
      case 'employee':
        return '/employee/dashboard';
      default:
        return '/';
    }
  };

  // Auto-redirect based on role after login
  const redirectToDashboard = () => {
    const route = getDashboardRoute();
    window.location.href = route;
  };

  const value = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    login,
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
