import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * ProtectedRoute Component
 * 
 * Protects routes by checking authentication status and required roles.
 * 
 * Features:
 * - Redirects unauthenticated users to login page
 * - Checks required role if specified
 * - Redirects users with insufficient permissions to dashboard
 * - Preserves intended destination for post-login redirect
 * - Handles loading state during auth check
 * 
 * @param {Object} props
 * @param {React.ReactElement} props.children - The component to render if authorized
 * @param {string|string[]} props.requiredRole - Required role(s) to access the route (optional)
 * @param {string} props.redirectTo - Custom redirect path for unauthorized access (default: '/dashboard')
 * 
 * @example
 * // Protect route with authentication only
 * <ProtectedRoute>
 *   <Dashboard />
 * </ProtectedRoute>
 * 
 * @example
 * // Protect route with specific role requirement
 * <ProtectedRoute requiredRole="admin">
 *   <AdminPanel />
 * </ProtectedRoute>
 * 
 * @example
 * // Protect route with multiple role requirements (OR logic)
 * <ProtectedRoute requiredRole={["admin", "manager"]}>
 *   <ManagementPanel />
 * </ProtectedRoute>
 */
const ProtectedRoute = ({ children, requiredRole = null, redirectTo = '/dashboard' }) => {
  const { isAuthenticated, isLoading, user, hasRole } = useAuth();
  const location = useLocation();

  // Show loading indicator while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Verifying authentication...</div>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  // Preserve the intended destination in state for post-login redirect
  if (!isAuthenticated) {
    return (
      <Navigate 
        to="/" 
        state={{ from: location.pathname, message: 'Please log in to access this page' }} 
        replace 
      />
    );
  }

  // superadmin bypasses all role requirements
  if (user?.role === 'superadmin') return <>{children}</>;

  // Check role requirements if specified
  if (requiredRole) {
    const hasRequiredRole = hasRole(requiredRole);
    
    if (!hasRequiredRole) {
      // User is authenticated but lacks required role
      // Redirect to dashboard with error message
      return (
        <Navigate 
          to={redirectTo} 
          state={{ 
            error: 'You do not have permission to access this page',
            attemptedPath: location.pathname 
          }} 
          replace 
        />
      );
    }
  }

  // User is authenticated and has required role (if specified)
  // Render the protected component
  return children;
};

export default ProtectedRoute;
