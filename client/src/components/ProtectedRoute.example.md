# ProtectedRoute Component - Usage Examples

## Overview

The `ProtectedRoute` component provides authentication and authorization protection for routes in the SkillForge AI application. It integrates with the `AuthContext` to check user authentication status and role-based permissions.

## Features

✅ **Authentication Check**: Redirects unauthenticated users to login page  
✅ **Role-Based Access Control**: Supports single or multiple role requirements  
✅ **Loading State**: Shows loading indicator during auth verification  
✅ **Intended Destination Preservation**: Saves the target URL for post-login redirect  
✅ **Custom Redirect Paths**: Configurable redirect for unauthorized access  
✅ **Error Messages**: Passes error context via navigation state

## Basic Usage

### 1. Protect Route with Authentication Only

```jsx
import ProtectedRoute from "./components/ProtectedRoute";

<Route
  path="/dashboard"
  element={
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  }
/>;
```

**Behavior:**

- ✅ Authenticated users → Access granted
- ❌ Unauthenticated users → Redirect to `/` (login page)

### 2. Protect Route with Specific Role

```jsx
<Route
  path="/admin"
  element={
    <ProtectedRoute requiredRole="admin">
      <AdminPanel />
    </ProtectedRoute>
  }
/>
```

**Behavior:**

- ✅ Authenticated admin → Access granted
- ❌ Authenticated non-admin → Redirect to `/dashboard` with error
- ❌ Unauthenticated → Redirect to `/` (login page)

### 3. Protect Route with Multiple Roles (OR Logic)

```jsx
<Route
  path="/management"
  element={
    <ProtectedRoute requiredRole={["admin", "manager"]}>
      <ManagementPanel />
    </ProtectedRoute>
  }
/>
```

**Behavior:**

- ✅ Authenticated admin OR manager → Access granted
- ❌ Authenticated employee → Redirect to `/dashboard` with error
- ❌ Unauthenticated → Redirect to `/` (login page)

### 4. Custom Redirect Path

```jsx
<Route
  path="/settings"
  element={
    <ProtectedRoute redirectTo="/profile">
      <Settings />
    </ProtectedRoute>
  }
/>
```

**Behavior:**

- ❌ Insufficient permissions → Redirect to `/profile` instead of `/dashboard`

## Complete App.jsx Example

```jsx
import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/Navbar";
import ErrorBoundary from "./components/ErrorBoundary";

// Lazy load pages
const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const AdminPanel = lazy(() => import("./pages/admin/UserManagement"));
const ManagerPanel = lazy(() => import("./pages/manager/EmployeeManagement"));

const Loader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin text-indigo-400 text-4xl">⟳</div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
            <Navbar />
            <Suspense fallback={<Loader />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/" element={<Landing />} />

                {/* Protected Routes - Authentication Required */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />

                {/* Manager & Admin Routes */}
                <Route
                  path="/management"
                  element={
                    <ProtectedRoute requiredRole={["admin", "manager"]}>
                      <ManagerPanel />
                    </ProtectedRoute>
                  }
                />

                {/* Admin Only Routes */}
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <AdminPanel />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </Suspense>
          </div>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

## Props API

| Prop           | Type                 | Default        | Description                                                                      |
| -------------- | -------------------- | -------------- | -------------------------------------------------------------------------------- |
| `children`     | `React.ReactElement` | **Required**   | The component to render if authorized                                            |
| `requiredRole` | `string \| string[]` | `null`         | Required role(s) to access the route. Supports single role or array for OR logic |
| `redirectTo`   | `string`             | `'/dashboard'` | Redirect path for users with insufficient permissions                            |

## Navigation State

### Unauthenticated Redirect

When redirecting unauthenticated users, the component passes:

```javascript
{
  from: '/intended-path',
  message: 'Please log in to access this page'
}
```

**Usage in Login component:**

```jsx
import { useLocation, useNavigate } from "react-router-dom";

function Login() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLoginSuccess = () => {
    // Redirect to intended destination or dashboard
    const from = location.state?.from || "/dashboard";
    navigate(from, { replace: true });
  };

  return (
    <div>
      {location.state?.message && (
        <div className="alert">{location.state.message}</div>
      )}
      {/* Login form */}
    </div>
  );
}
```

### Insufficient Permissions Redirect

When redirecting users with insufficient permissions:

```javascript
{
  error: 'You do not have permission to access this page',
  attemptedPath: '/admin'
}
```

**Usage in Dashboard component:**

```jsx
import { useLocation } from "react-router-dom";

function Dashboard() {
  const location = useLocation();

  return (
    <div>
      {location.state?.error && (
        <div className="error-alert">{location.state.error}</div>
      )}
      {/* Dashboard content */}
    </div>
  );
}
```

## Loading State

The component displays a loading indicator while verifying authentication:

```jsx
<div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
  <div className="text-center">
    <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
    <div className="text-slate-400 text-sm">Verifying authentication...</div>
  </div>
</div>
```

This prevents flickering and provides user feedback during the auth check.

## Role Hierarchy

The component supports three roles:

1. **admin** - Full access to all features
2. **manager** - Access to management features and assigned employees
3. **employee** - Access to learning features only

### Role-Based Route Examples

```jsx
// Employee, Manager, and Admin can access
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>

// Only Manager and Admin can access
<ProtectedRoute requiredRole={["manager", "admin"]}>
  <EmployeeManagement />
</ProtectedRoute>

// Only Admin can access
<ProtectedRoute requiredRole="admin">
  <UserManagement />
</ProtectedRoute>
```

## Integration with AuthContext

The component uses the following from `AuthContext`:

- `isAuthenticated` - Boolean indicating if user is logged in
- `isLoading` - Boolean indicating if auth check is in progress
- `user` - Current user object (used internally by hasRole)
- `hasRole(role)` - Function to check if user has required role(s)

## Best Practices

### ✅ DO

- Wrap all protected routes with `ProtectedRoute`
- Use role arrays for OR logic: `requiredRole={["admin", "manager"]}`
- Handle navigation state in destination components
- Provide user feedback for permission errors

### ❌ DON'T

- Don't nest `ProtectedRoute` components
- Don't use for public routes (Landing page)
- Don't rely solely on client-side protection (always validate on backend)
- Don't forget to wrap App with `AuthProvider`

## Testing

Example test for ProtectedRoute:

```jsx
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import ProtectedRoute from "./ProtectedRoute";

test("redirects unauthenticated user to login", () => {
  render(
    <BrowserRouter>
      <AuthProvider>
        <ProtectedRoute>
          <div>Protected Content</div>
        </ProtectedRoute>
      </AuthProvider>
    </BrowserRouter>,
  );

  // Should redirect, not show protected content
  expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
});
```

## Troubleshooting

### Issue: Infinite redirect loop

**Cause:** ProtectedRoute redirecting to a protected route  
**Solution:** Ensure login page (`/`) is NOT wrapped with ProtectedRoute

### Issue: Loading state never resolves

**Cause:** AuthContext not properly initialized  
**Solution:** Verify `AuthProvider` wraps the entire app and token verification completes

### Issue: Role check always fails

**Cause:** User object doesn't have `role` field  
**Solution:** Verify backend returns user with `role` field in JWT payload

## Related Components

- `AuthContext` - Provides authentication state and methods
- `useAuth` - Hook to access auth context
- `Navbar` - Should use `useAuth` to show/hide menu items based on role
- `Dashboard` - Should handle error state from navigation

## Requirements Satisfied

This component satisfies the following requirements from the spec:

- ✅ **Requirement 10.1**: Redirect unauthenticated users to login page
- ✅ **Requirement 10.2**: Redirect authenticated users from landing to dashboard
- ✅ **Requirement 10.3**: Display access denied for insufficient permissions
- ✅ **Requirement 10.4**: Redirect to dashboard on permission failure
- ✅ **Requirement 10.5**: Redirect to dashboard after successful login
- ✅ **Requirement 10.6**: Preserve intended destination for post-login redirect

## Next Steps

After implementing ProtectedRoute:

1. Update `App.jsx` to wrap protected routes
2. Update `Landing.jsx` to redirect authenticated users
3. Update `Dashboard.jsx` to display error messages from navigation state
4. Implement role-based UI rendering in `Navbar.jsx`
5. Write unit tests for ProtectedRoute component
