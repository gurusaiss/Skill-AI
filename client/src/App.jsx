import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AiTutorChat from './components/AiTutorChat.jsx';

const Landing              = lazy(() => import('./pages/Landing.jsx'));
const Profiling            = lazy(() => import('./pages/Profiling.jsx'));
const Diagnostic           = lazy(() => import('./pages/Diagnostic.jsx'));
const Dashboard            = lazy(() => import('./pages/Dashboard.jsx'));
const Employee             = lazy(() => import('./pages/Employee.jsx'));
const DashboardRedirect    = lazy(() => import('./components/DashboardRedirect.jsx'));
const Session              = lazy(() => import('./pages/Session.jsx'));
const Report               = lazy(() => import('./pages/Report.jsx'));
const SimulationLab        = lazy(() => import('./pages/SimulationLab.jsx'));
const CareerTwin           = lazy(() => import('./pages/CareerTwin.jsx'));
const ExplainabilityConsole = lazy(() => import('./pages/ExplainabilityConsole.jsx'));
const DemoMode             = lazy(() => import('./pages/DemoMode.jsx'));
const InterviewSimulator   = lazy(() => import('./pages/InterviewSimulator.jsx'));

// Auth Pages
const Login                = lazy(() => import('./pages/auth/Login.jsx'));
const Register             = lazy(() => import('./pages/auth/Register.jsx'));
const Onboarding           = lazy(() => import('./pages/auth/Onboarding.jsx'));
const VerifyOTP            = lazy(() => import('./pages/auth/VerifyOTP.jsx'));
const ForgotPassword       = lazy(() => import('./pages/auth/ForgotPassword.jsx'));
const ResetPassword        = lazy(() => import('./pages/auth/ResetPassword.jsx'));
const OAuthCallback        = lazy(() => import('./pages/auth/OAuthCallback.jsx'));

// Super Admin Pages
const SuperAdminDashboard  = lazy(() => import('./pages/superadmin/SuperAdminDashboard.jsx'));
const AdminManagement      = lazy(() => import('./pages/superadmin/AdminManagement.jsx'));
const SuperAdminReports    = lazy(() => import('./pages/superadmin/SuperAdminReports.jsx'));

// Profile & Admin Pages
const Profile              = lazy(() => import('./pages/Profile.jsx'));
const UserManagement       = lazy(() => import('./pages/admin/UserManagement.jsx'));
const AdminDashboard       = lazy(() => import('./pages/admin/AdminDashboard.jsx'));
const ManagerDashboard     = lazy(() => import('./pages/manager/ManagerDashboard.jsx'));
const AssessmentManagement = lazy(() => import('./pages/AssessmentManagement.jsx'));
const Assessment           = lazy(() => import('./pages/Assessment.jsx'));
const ModuleManagement     = lazy(() => import('./pages/admin/ModuleManagement.jsx'));
const AssignmentManagement = lazy(() => import('./pages/admin/AssignmentManagement.jsx'));
const Settings             = lazy(() => import('./pages/admin/Settings.jsx'));
const ModuleStart          = lazy(() => import('./pages/ModuleStart.jsx'));
const ModuleDashboard      = lazy(() => import('./pages/ModuleDashboard.jsx'));
const ModuleSession        = lazy(() => import('./pages/ModuleSession.jsx'));
const Certificate          = lazy(() => import('./pages/Certificate.jsx'));

const Loader = () => (
  <div className="mx-auto max-w-4xl px-6 py-14 text-slate-400 text-center">
    <div className="animate-spin text-indigo-400 text-3xl mb-3">⟳</div>
    <div className="text-sm">Loading...</div>
  </div>
);

const App = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
          <Navbar />
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/"             element={<Landing />} />
              <Route path="/profiling"    element={<Profiling />} />
              <Route path="/diagnostic"   element={<Diagnostic />} />
              <Route path="/settings"    element={
                <ProtectedRoute requiredRole="admin">
                  <Settings />
                </ProtectedRoute>
              } />

              {/* Super Admin Routes */}
              <Route path="/superadmin/dashboard" element={
                <ProtectedRoute requiredRole="superadmin">
                  <SuperAdminDashboard />
                </ProtectedRoute>
              } />
              <Route path="/superadmin/admins" element={
                <ProtectedRoute requiredRole="superadmin">
                  <AdminManagement />
                </ProtectedRoute>
              } />
              <Route path="/superadmin/reports" element={
                <ProtectedRoute requiredRole="superadmin">
                  <SuperAdminReports />
                </ProtectedRoute>
              } />

              {/* Protected Routes - Require Authentication */}
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <DashboardRedirect />
                </ProtectedRoute>
              } />
              <Route path="/admin/dashboard" element={
                <ProtectedRoute requiredRole="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              } />
              <Route path="/manager/dashboard" element={
                <ProtectedRoute requiredRole="manager">
                  <ManagerDashboard />
                </ProtectedRoute>
              } />
              <Route path="/employee/dashboard" element={
                <ProtectedRoute requiredRole="employee">
                  <Employee />
                </ProtectedRoute>
              } />
              <Route path="/session/:day" element={
                <ProtectedRoute>
                  <Session />
                </ProtectedRoute>
              } />
              <Route path="/report"       element={
                <ProtectedRoute>
                  <Report />
                </ProtectedRoute>
              } />
              
              {/* Frontier Pages - Protected */}
              <Route path="/simulation"   element={
                <ProtectedRoute>
                  <SimulationLab />
                </ProtectedRoute>
              } />
              <Route path="/career-twin"  element={
                <ProtectedRoute>
                  <CareerTwin />
                </ProtectedRoute>
              } />
              <Route path="/explain"      element={
                <ProtectedRoute>
                  <ExplainabilityConsole />
                </ProtectedRoute>
              } />
              <Route path="/demo"         element={<DemoMode />} />
              <Route path="/interview"    element={
                <ProtectedRoute>
                  <InterviewSimulator />
                </ProtectedRoute>
              } />
              
              {/* Auth Pages - Public */}
              <Route path="/auth/login"           element={<Login />} />
              <Route path="/auth/register"        element={<Register />} />
              <Route path="/auth/onboarding"      element={<Onboarding />} />
              <Route path="/auth/verify-otp"      element={<VerifyOTP />} />
              <Route path="/auth/forgot-password" element={<ForgotPassword />} />
              <Route path="/auth/reset-password"  element={<ResetPassword />} />
              <Route path="/oauth/callback"       element={<OAuthCallback />} />
              
              {/* Profile & Admin Pages - Protected with Role Requirements */}
              <Route path="/profile"              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              } />
              <Route path="/admin/users"          element={
                <ProtectedRoute requiredRole="admin">
                  <UserManagement />
                </ProtectedRoute>
              } />
               <Route path="/admin/assessments"    element={
                 <ProtectedRoute requiredRole={['admin', 'manager']}>
                   <AssessmentManagement />
                 </ProtectedRoute>
               } />
               <Route path="/admin/modules"        element={
                 <ProtectedRoute requiredRole={['admin', 'manager']}>
                   <ModuleManagement />
                 </ProtectedRoute>
               } />
               <Route path="/admin/assignments"    element={
                 <ProtectedRoute requiredRole={['admin', 'manager']}>
                   <AssignmentManagement />
                 </ProtectedRoute>
               } />
              <Route path="/assessment/:assessmentId" element={
                <ProtectedRoute>
                  <Assessment />
                </ProtectedRoute>
              } />
              <Route path="/module/:moduleId/start" element={
                <ProtectedRoute>
                  <ModuleStart />
                </ProtectedRoute>
              } />
              <Route path="/module/:moduleId/learn" element={
                <ProtectedRoute>
                  <ModuleDashboard />
                </ProtectedRoute>
              } />
              <Route path="/module/:moduleId/session/:sessionIndex" element={
                <ProtectedRoute>
                  <ModuleSession />
                </ProtectedRoute>
              } />
              <Route path="/certificate" element={
                <ProtectedRoute>
                  <Certificate />
                </ProtectedRoute>
              } />
            </Routes>
          </Suspense>
          <AiTutorChat />
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
