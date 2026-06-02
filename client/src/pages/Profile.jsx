import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

/**
 * Profile Page Component
 * 
 * Allows users to view and update their profile information.
 * 
 * Features:
 * - Display user email, name, role
 * - Edit name form
 * - Change email form (with OTP verification)
 * - Change password form (with current password verification)
 * - Display assigned manager for employees
 * - Display assigned employees count for managers
 */
export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  // Form states
  const [editingName, setEditingName] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);

  // Form values
  const [name, setName] = useState(user?.name || '');
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  // Manager/Employee data
  const [managerInfo, setManagerInfo] = useState(null);
  const [employeeCount, setEmployeeCount] = useState(null);
  const [loadingRelations, setLoadingRelations] = useState(true);

  // Extended profile (jobRole, department, JD)
  const [workProfile, setWorkProfile] = useState(null);
  const [showFullJD, setShowFullJD] = useState(false);

  // Fetch manager/employee relationships on mount
  React.useEffect(() => {
    const fetchRelationships = async () => {
      if (!user) return;

      try {
        const token = localStorage.getItem('auth_token');
        const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';

        if (user.role === 'employee') {
          // Fetch assigned manager
          const response = await fetch(`${baseUrl}/api/assignments/employee/${user.userId}/manager`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            setManagerInfo(data.data);
          }
        } else if (user.role === 'manager') {
          // Fetch assigned employees count
          const response = await fetch(`${baseUrl}/api/assignments/manager/${user.userId}/employees`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            setEmployeeCount(data.data?.length || 0);
          }
        }
      } catch (err) {
        console.error('Failed to fetch relationships:', err);
      } finally {
        setLoadingRelations(false);
      }
    };

    fetchRelationships();
  }, [user]);

  // Fetch full work profile (jobRole, department, JD)
  React.useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('auth_token');
    const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';
    fetch(`${baseUrl}/api/users/${user.userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data || d) setWorkProfile(d?.data ?? d); })
      .catch(() => {});
  }, [user]);

  // Handle name update
  const handleUpdateName = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!name.trim()) {
        throw new Error('Name cannot be empty');
      }

      await updateProfile({ name: name.trim() });
      setSuccess('Name updated successfully');
      setEditingName(false);
    } catch (err) {
      setError(err.message || 'Failed to update name');
    } finally {
      setLoading(false);
    }
  };

  // Handle email change - send OTP
  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!newEmail.trim()) {
        throw new Error('Email cannot be empty');
      }

      const token = localStorage.getItem('auth_token');
      const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';

      const response = await fetch(`${baseUrl}/api/users/${user.userId}/request-email-change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newEmail: newEmail.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to send OTP');
      }

      setOtpSent(true);
      setSuccess('OTP sent to your new email address');
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // Handle email change - verify OTP
  const handleVerifyEmailChange = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!otp.trim()) {
        throw new Error('OTP cannot be empty');
      }

      await updateProfile({ email: newEmail.trim(), otp: otp.trim() });
      setSuccess('Email updated successfully');
      setEditingEmail(false);
      setOtpSent(false);
      setNewEmail('');
      setOtp('');
    } catch (err) {
      setError(err.message || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  // Handle password change
  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (!currentPassword || !newPassword || !confirmPassword) {
        throw new Error('All password fields are required');
      }

      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match');
      }

      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      const token = localStorage.getItem('auth_token');
      const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';

      const response = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to change password');
      }

      setSuccess('Password changed successfully');
      setEditingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  // Cancel editing
  const handleCancelEdit = (type) => {
    if (type === 'name') {
      setEditingName(false);
      setName(user?.name || '');
    } else if (type === 'email') {
      setEditingEmail(false);
      setOtpSent(false);
      setNewEmail('');
      setOtp('');
    } else if (type === 'password') {
      setEditingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setError('');
    setSuccess('');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading profile...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060B14] py-8 px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-slate-400 hover:text-slate-300 text-sm mb-4 flex items-center gap-2 transition-colors"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-4xl font-black tracking-tight mb-2">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Profile Settings
            </span>
          </h1>
          <p className="text-slate-400">Manage your account information and preferences</p>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
            {success}
          </div>
        )}

        {/* Profile Information Card */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 mb-6">
          <h2 className="text-2xl font-bold text-white mb-6">Account Information</h2>

          {/* Email (Read-only display) */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-300 mb-2">Email</label>
            <div className="flex items-center justify-between">
              <span className="text-slate-100">{user.email}</span>
              {!editingEmail && (
                <button
                  onClick={() => setEditingEmail(true)}
                  className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
                >
                  Change Email
                </button>
              )}
            </div>
          </div>

          {/* Change Email Form */}
          {editingEmail && (
            <div className="mb-6 p-4 bg-[#060B14] border border-slate-700 rounded-xl">
              {!otpSent ? (
                <form onSubmit={handleRequestEmailChange}>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">
                    New Email Address
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors mb-4"
                    placeholder="Enter new email"
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      {loading ? 'Sending...' : 'Send OTP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelEdit('email')}
                      className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleVerifyEmailChange}>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">
                    Enter OTP sent to {newEmail}
                  </label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors mb-4"
                    placeholder="Enter 6-digit OTP"
                    maxLength={6}
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-4 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      {loading ? 'Verifying...' : 'Verify OTP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelEdit('email')}
                      className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Name */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-300 mb-2">Name</label>
            {!editingName ? (
              <div className="flex items-center justify-between">
                <span className="text-slate-100">{user.name}</span>
                <button
                  onClick={() => setEditingName(true)}
                  className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
                >
                  Edit
                </button>
              </div>
            ) : (
              <form onSubmit={handleUpdateName} className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                  placeholder="Enter your name"
                  required
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCancelEdit('name')}
                  className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all"
                >
                  Cancel
                </button>
              </form>
            )}
          </div>

          {/* Role */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-slate-300 mb-2">Role</label>
            <span className="inline-block px-3 py-1.5 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm font-bold capitalize">
              {user.role}
            </span>
          </div>

          {/* Work Profile — Job Role, Department, JD (employees only) */}
          {user.role === 'employee' && workProfile && (workProfile.jobRole || workProfile.department || workProfile.jobDescription || workProfile.jobDescriptionFile) && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">Work Profile</label>
              <div className="space-y-3">
                {/* Job Role + Department row */}
                {(workProfile.jobRole || workProfile.department) && (
                  <div className="grid grid-cols-2 gap-3">
                    {workProfile.jobRole && (
                      <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Job Role</p>
                        <p className="text-white font-semibold text-sm">{workProfile.jobRole}</p>
                      </div>
                    )}
                    {workProfile.department && (
                      <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Department</p>
                        <p className="text-white font-semibold text-sm">{workProfile.department}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* JD File */}
                {workProfile.jobDescriptionFile && (
                  <div className="flex items-center gap-3 p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                    <span className="text-2xl">📎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{workProfile.jobDescriptionFile.name}</p>
                      <p className="text-slate-500 text-xs">
                        {workProfile.jobDescriptionFile.size ? `${(workProfile.jobDescriptionFile.size / 1024).toFixed(1)} KB · ` : ''}
                        Uploaded JD
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">✓ JD</span>
                  </div>
                )}

                {/* JD Text */}
                {workProfile.jobDescription && (
                  <div className="p-3 bg-[#060B14] border border-slate-700 rounded-xl">
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Job Description</p>
                    <p className={`text-slate-300 text-sm leading-relaxed whitespace-pre-wrap ${!showFullJD && workProfile.jobDescription.length > 300 ? 'line-clamp-4' : ''}`}>
                      {workProfile.jobDescription}
                    </p>
                    {workProfile.jobDescription.length > 300 && (
                      <button onClick={() => setShowFullJD(v => !v)} className="text-indigo-400 text-xs mt-2 hover:text-indigo-300 transition-colors">
                        {showFullJD ? '▲ Show less' : '▼ View full job description'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manager Info (for employees) */}
          {user.role === 'employee' && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-2">
                Assigned Manager
              </label>
              {loadingRelations ? (
                <span className="text-slate-500">Loading...</span>
              ) : managerInfo ? (
                <div className="flex items-center gap-3 p-4 bg-[#060B14] border border-slate-700 rounded-xl">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-600/30 to-purple-600/30 border border-indigo-500/40 flex items-center justify-center text-xl">
                    👤
                  </div>
                  <div>
                    <p className="text-slate-100 font-bold">{managerInfo.name}</p>
                    <p className="text-slate-400 text-sm">{managerInfo.email}</p>
                  </div>
                </div>
              ) : (
                <span className="text-slate-500">No manager assigned</span>
              )}
            </div>
          )}

          {/* Employee Count (for managers) */}
          {user.role === 'manager' && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-2">
                Assigned Employees
              </label>
              {loadingRelations ? (
                <span className="text-slate-500">Loading...</span>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-[#060B14] border border-slate-700 rounded-xl">
                  <span className="text-4xl font-black bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                    {employeeCount || 0}
                  </span>
                  <span className="text-slate-400">employees assigned to you</span>
                </div>
              )}
            </div>
          )}

          {/* Change Password Button */}
          {!editingPassword && (
            <button
              onClick={() => setEditingPassword(true)}
              className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              Change Password
            </button>
          )}
        </div>

        {/* Change Password Form */}
        {editingPassword && (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 mb-6">
            <h2 className="text-2xl font-bold text-white mb-6">Change Password</h2>
            <form onSubmit={handleChangePassword}>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                  placeholder="Enter current password"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                  placeholder="Enter new password (min 8 characters)"
                  required
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                  placeholder="Confirm new password"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {loading ? 'Changing...' : 'Change Password'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCancelEdit('password')}
                  className="px-4 py-3 rounded-xl font-semibold text-sm border border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Logout Button */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          <h2 className="text-2xl font-bold text-white mb-4">Account Actions</h2>
          <button
            onClick={logout}
            className="px-6 py-3 rounded-xl font-bold text-sm bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30 hover:border-red-500/40 transition-all active:scale-[0.98]"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}
