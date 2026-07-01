import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const fetchJSON = async (path) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/';
      return null;
    }
    const body = await res.text();
    let msg = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(body);
      msg = parsed.error?.message || parsed.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
};

const Toast = ({ message, type, onClose }) => {
  const colors = {
    success: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
    error: 'bg-red-500/20 border-red-500/40 text-red-300',
    info: 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300',
    warning: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
  };
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-xl border backdrop-blur-sm shadow-2xl animate-slide-in ${colors[type] || colors.info}`}>
      <span className="text-lg font-bold">{icons[type] || icons.info}</span>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 text-current opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
};

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed top-6 right-6 z-50 flex flex-col gap-3">
    {toasts.map((t) => (
      <Toast key={t.id} message={t.message} type={t.type} onClose={() => removeToast(t.id)} />
    ))}
  </div>
);

const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-lg bg-slate-700/40 ${className}`} />
);

const StatCard = ({ label, value, icon, accent }) => {
  const accentMap = {
    indigo: 'border-indigo-500/20 bg-indigo-500/5 text-indigo-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-400',
    red: 'border-red-500/20 bg-red-500/5 text-red-400',
    purple: 'border-purple-500/20 bg-purple-500/5 text-purple-400',
    sky: 'border-sky-500/20 bg-sky-500/5 text-sky-400',
  };
  const classes = accentMap[accent] || accentMap.indigo;
  return (
    <div className={`rounded-xl border p-5 transition-all hover:scale-[1.02] ${classes}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-xs font-bold uppercase tracking-widest mb-1.5 ${classes.split(' ').pop()}`}>{label}</p>
          <p className="text-3xl font-black text-white">{value}</p>
        </div>
        <div className="text-3xl opacity-40">{icon}</div>
      </div>
    </div>
  );
};

const ProgressBar = ({ value, max = 100, color = 'indigo', size = 'md' }) => {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const colorMap = {
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    sky: 'bg-sky-500',
  };
  const sizeMap = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' };
  return (
    <div className={`w-full rounded-full bg-slate-700/60 overflow-hidden ${sizeMap[size]}`}>
      <div
        className={`rounded-full transition-all duration-500 ease-out ${colorMap[color] || colorMap.indigo} ${sizeMap[size]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const map = {
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    active: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    in_progress: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    assigned: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    overdue: 'bg-red-500/15 text-red-400 border-red-500/30',
    pending: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  };
  const classes = map[status] || map.pending;
  const label = status ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border ${classes}`}>
      {label}
    </span>
  );
};

const EmptyState = ({ icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div className="text-5xl mb-4 opacity-40">{icon}</div>
    <h3 className="text-lg font-bold text-slate-300 mb-1">{title}</h3>
    <p className="text-sm text-slate-500 max-w-sm mb-4">{subtitle}</p>
    {action}
  </div>
);

const Avatar = ({ name, size = 'md' }) => {
  const initials = name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';
  const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' };
  return (
    <div className={`${sizeMap[size]} rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 border border-indigo-500/30 flex items-center justify-center font-bold text-indigo-300 shrink-0`}>
      {initials}
    </div>
  );
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) {
    return '—';
  }
};

const timeAgo = (dateStr) => {
  if (!dateStr) return 'Never';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Never';
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(dateStr);
  } catch (_) {
    return 'Never';
  }
};

const isOverdue = (dueDate, status) => {
  if (!dueDate || status === 'completed') return false;
  try {
    return new Date(dueDate) < new Date();
  } catch (_) {
    return false;
  }
};

export default function ManagerDashboard() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [assessmentReports, setAssessmentReports] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeDetailLoading, setEmployeeDetailLoading] = useState(false);
  const [employeeAssignments, setEmployeeAssignments] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [activeView, setActiveView] = useState('overview');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState({ actionType: 'assign_module', title: '', description: '', category: 'General', difficulty: 'beginner', targetId: '', targetTitle: '', employeeIds: [], priority: 'medium', dueDate: '', notes: '' });
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message, type = 'info') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (!hasRole('manager')) {
      navigate('/dashboard');
      return;
    }
    loadDashboard();
  }, [user, navigate]);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const [employeesRes, assignmentsRes, reportsRes] = await Promise.allSettled([
        user?.userId ? fetchJSON(`/api/assignments/manager/${user.userId}/employees`) : Promise.resolve(null),
        fetchJSON('/api/assignments'),
        fetchJSON('/api/assessments/reports/all'),
      ]);

      if (employeesRes.status === 'fulfilled' && employeesRes.value) {
        // Server wraps in { success, data: { employees: [...] } }
        const empData = employeesRes.value?.data?.employees
          || employeesRes.value?.employees
          || (Array.isArray(employeesRes.value) ? employeesRes.value : []);
        setEmployees(Array.isArray(empData) ? empData : []);
      } else {
        setEmployees([]);
      }

      if (assignmentsRes.status === 'fulfilled' && assignmentsRes.value) {
        // Server wraps in { success, data: { assignments: [...] } } or { success, data: [...] }
        const raw = assignmentsRes.value?.data;
        const assignData = raw?.assignments || (Array.isArray(raw) ? raw : null)
          || assignmentsRes.value?.assignments
          || (Array.isArray(assignmentsRes.value) ? assignmentsRes.value : []);
        setAssignments(Array.isArray(assignData) ? assignData : []);
      }

      if (reportsRes.status === 'fulfilled' && reportsRes.value) {
        const rd = reportsRes.value;
        setAssessmentReports(Array.isArray(rd) ? rd : rd?.data || []);
      }

      if (employeesRes.status === 'rejected' && assignmentsRes.status === 'rejected') {
        throw new Error('Failed to load dashboard data');
      }
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
      addToast(err.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployeeDetail = async (employee) => {
    setSelectedEmployee(employee);
    setEmployeeDetailLoading(true);
    setEmployeeAssignments([]);
    try {
      const data = await fetchJSON(`/api/assignments?userId=${employee.userId || employee.id}`);
      const raw = data?.data;
      const list = raw?.assignments || (Array.isArray(raw) ? raw : null) || data?.assignments || (Array.isArray(data) ? data : []);
      setEmployeeAssignments(Array.isArray(list) ? list : []);
    } catch (err) {
      addToast(`Failed to load assignments for ${employee.name}`, 'error');
      setEmployeeAssignments([]);
    } finally {
      setEmployeeDetailLoading(false);
    }
  };

  const closeEmployeeDetail = () => {
    setSelectedEmployee(null);
    setEmployeeAssignments([]);
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    setSubmittingRequest(true);
    try {
      const token = localStorage.getItem('auth_token');
      const payload = {};
      if (requestForm.actionType === 'assign_module' || requestForm.actionType === 'assign_assessment') {
        payload.targetId = requestForm.targetId;
        payload.targetTitle = requestForm.targetTitle;
        payload.targetType = requestForm.actionType === 'assign_module' ? 'module' : 'assessment';
        payload.employeeIds = requestForm.employeeIds;
        payload.priority = requestForm.priority;
        payload.dueDate = requestForm.dueDate || null;
      } else {
        payload.title = requestForm.title;
        payload.description = requestForm.description;
        payload.category = requestForm.category;
        payload.difficulty = requestForm.difficulty;
      }
      await fetch(`${BASE_URL}/api/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ actionType: requestForm.actionType, payload, notes: requestForm.notes }),
      });
      setShowRequestModal(false);
      setRequestForm({ actionType: 'assign_module', title: '', description: '', category: 'General', difficulty: 'beginner', targetId: '', targetTitle: '', employeeIds: [], priority: 'medium', dueDate: '', notes: '' });
      // Show a simple alert since we may not have addToast available
      alert('Request submitted! Admin will review and take action.');
    } catch (err) {
      alert('Failed to submit request: ' + err.message);
    } finally {
      setSubmittingRequest(false);
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (emp.name || '').toLowerCase().includes(q) ||
      (emp.email || '').toLowerCase().includes(q) ||
      (emp.role || '').toLowerCase().includes(q)
    );
  });

  const recentAssignments = [...assignments]
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || a.assignedDate || 0);
      const dateB = new Date(b.createdAt || b.assignedDate || 0);
      return dateB - dateA;
    })
    .slice(0, 8);

  // Always compute stats from the scoped assignments array (already filtered to manager's team by server)
  const totalEmployees = employees.length;
  const activeAssignments = assignments.filter((a) => a.status === 'in_progress' || a.status === 'active').length;
  const completedAssignments = assignments.filter((a) => a.status === 'completed').length;
  const avgProgress = assignments.length > 0
    ? Math.round(assignments.reduce((s, a) => s + (a.progress || 0), 0) / assignments.length)
    : 0;
  const overdueAssignments = assignments.filter((a) => isOverdue(a.dueDate, a.status)).length;

  // Assessment report stats
  const teamEmployeeIds = new Set(employees.map(e => e.userId || e.id));
  const teamReports = assessmentReports.filter(r => teamEmployeeIds.has(r.userId));
  const avgAssessmentScore = teamReports.length > 0
    ? Math.round(teamReports.reduce((s, r) => s + (r.score || 0), 0) / teamReports.length)
    : null;
  const passedReports = teamReports.filter(r => (r.score || 0) >= 60).length;
  const needsAttention = teamReports.filter(r => (r.score || 0) < 60);

  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] px-6 py-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <Skeleton className="h-10 w-72 mb-3" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-80 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error && !employees.length && !assignments.length) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-6">
        <div className="text-center bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Failed to Load Dashboard</h2>
          <p className="text-sm text-red-300/70 mb-6">{error}</p>
          <button
            onClick={loadDashboard}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {selectedEmployee && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={closeEmployeeDetail}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-700/60 bg-[#131C2E] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-slate-700/50 bg-[#131C2E]/95 backdrop-blur-sm rounded-t-2xl">
              <div className="flex items-center gap-4">
                <Avatar name={selectedEmployee.name} size="lg" />
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedEmployee.name}</h2>
                  <p className="text-sm text-slate-400">{selectedEmployee.email}</p>
                  <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                    {selectedEmployee.role || 'Employee'}
                  </span>
                </div>
              </div>
              <button
                onClick={closeEmployeeDetail}
                className="w-9 h-9 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-lg transition-all"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-4 text-center">
                  <p className="text-2xl font-black text-white">{selectedEmployee.assignedModules || employeeAssignments.length || 0}</p>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Modules</p>
                </div>
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-4 text-center">
                  <p className="text-2xl font-black text-emerald-400">
                    {employeeAssignments.length > 0
                      ? Math.round(employeeAssignments.filter((a) => a.status === 'completed').length / employeeAssignments.length * 100)
                      : 0}
                    %
                  </p>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Completion</p>
                </div>
                <div className="rounded-xl bg-slate-800/50 border border-slate-700/40 p-4 text-center">
                  <p className="text-2xl font-black text-amber-400">
                    {employeeAssignments.filter((a) => isOverdue(a.dueDate, a.status)).length}
                  </p>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Overdue</p>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Assignments</h3>
                {employeeDetailLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-20 rounded-lg" />
                    ))}
                  </div>
                ) : employeeAssignments.length === 0 ? (
                  <div className="text-center py-10 text-slate-500">
                    <div className="text-3xl mb-2 opacity-40">📋</div>
                    <p className="text-sm">No assignments found for this employee</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {employeeAssignments.map((a, idx) => (
                      <div
                        key={a.id || idx}
                        className={`rounded-xl border p-4 transition-all ${
                          isOverdue(a.dueDate, a.status)
                            ? 'border-red-500/20 bg-red-500/5'
                            : 'border-slate-700/40 bg-slate-800/30'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{a.title || a.name || `Assignment #${idx + 1}`}</p>
                            {isOverdue(a.dueDate, a.status) && (
                              <span className="shrink-0 text-xs font-bold text-red-400 bg-red-500/15 border border-red-500/30 px-2 py-0.5 rounded-full uppercase">
                                Overdue
                              </span>
                            )}
                          </div>
                          <StatusBadge status={a.status} />
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex-1 mr-4">
                            <ProgressBar
                              value={a.progress || 0}
                              color={
                                a.status === 'completed'
                                  ? 'emerald'
                                  : isOverdue(a.dueDate, a.status)
                                  ? 'red'
                                  : 'indigo'
                              }
                              size="sm"
                            />
                          </div>
                          <span className="text-xs font-bold text-slate-400 shrink-0">{a.progress || 0}%</span>
                        </div>
                        {a.dueDate && (
                          <p className={`text-xs mt-1.5 ${isOverdue(a.dueDate, a.status) ? 'text-red-400' : 'text-slate-500'}`}>
                            Due: {formatDate(a.dueDate)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-lg">
              👔
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-white">Manager Dashboard</h1>
              <p className="text-sm text-slate-400">
                Welcome back, {user.name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-medium transition-all"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setShowRequestModal(true)}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold transition-all flex items-center gap-2"
          >
            📋 Submit Request
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
        <StatCard label="Total Employees" value={totalEmployees} icon="👥" accent="indigo" />
        <StatCard label="Active" value={activeAssignments} icon="⚡" accent="sky" />
        <StatCard label="Completed" value={completedAssignments} icon="✅" accent="emerald" />
        <StatCard label="Avg Progress" value={`${avgProgress}%`} icon="📊" accent="purple" />
        <StatCard label="Overdue" value={overdueAssignments} icon="⚠️" accent="red" />
      </div>

      {/* ── Assessment Reports Summary ─────────────────────────────── */}
      {teamReports.length > 0 && (
        <div className="mb-6 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
              <span>📝</span> Team Assessment Reports
            </h3>
            <span className="text-xs text-slate-500">{teamReports.length} submission{teamReports.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-900/60 rounded-xl p-3 text-center">
              <p className={`text-2xl font-black ${avgAssessmentScore >= 80 ? 'text-emerald-400' : avgAssessmentScore >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                {avgAssessmentScore}%
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Team Avg Score</p>
            </div>
            <div className="bg-slate-900/60 rounded-xl p-3 text-center">
              <p className="text-2xl font-black text-emerald-400">{passedReports}</p>
              <p className="text-xs text-slate-500 mt-0.5">Passed (≥60%)</p>
            </div>
            <div className="bg-slate-900/60 rounded-xl p-3 text-center">
              <p className={`text-2xl font-black ${needsAttention.length > 0 ? 'text-red-400' : 'text-slate-400'}`}>{needsAttention.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">Needs Attention</p>
            </div>
          </div>

          {/* Per-employee report rows */}
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {teamReports.slice().sort((a, b) => (a.score || 0) - (b.score || 0)).map((r) => {
              const scoreColor = (r.score || 0) >= 80 ? 'text-emerald-400' : (r.score || 0) >= 60 ? 'text-amber-400' : 'text-red-400';
              const gradeBg = (r.score || 0) >= 80 ? 'bg-emerald-500/15 border-emerald-500/30' : (r.score || 0) >= 60 ? 'bg-amber-500/15 border-amber-500/30' : 'bg-red-500/15 border-red-500/30';
              return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 bg-slate-900/50 rounded-lg border border-slate-700/40">
                  <div className="w-7 h-7 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                    {(r.userName || '?')[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{r.userName || 'Employee'}</p>
                    <p className="text-slate-500 text-xs truncate">{r.assessmentTitle || 'Assessment'} · {r.jobRole || ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.weakAreas?.length > 0 && (
                      <span className="text-xs text-amber-400 hidden sm:block">⚠ {r.weakAreas.slice(0,2).join(', ')}</span>
                    )}
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${gradeBg}`}>
                      <span className={scoreColor}>{r.score || 0}%</span>
                      <span className="text-slate-500 ml-1">{r.grade}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {needsAttention.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <span>⚠</span>
              <span><strong>{needsAttention.length}</strong> employee{needsAttention.length !== 1 ? 's' : ''} scored below 60% — consider approving auto-generated training modules.</span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'employees', label: 'Employees' },
          { id: 'assignments', label: 'Assignments' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`px-4 py-2 rounded-lg font-semibold whitespace-nowrap text-sm transition-all ${
              activeView === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                : 'bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeView === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-slate-700/40">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recent Assignments</h3>
              <button
                onClick={() => setActiveView('assignments')}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View All →
              </button>
            </div>
            {recentAssignments.length === 0 ? (
              <EmptyState
                icon="📋"
                title="No Assignments Yet"
                subtitle="Assignments created for your team will appear here."
              />
            ) : (
              <div className="divide-y divide-slate-700/30">
                {recentAssignments.map((a, idx) => (
                  <div
                    key={a.id || idx}
                    className="flex items-center justify-between p-4 hover:bg-slate-700/10 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                          a.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : isOverdue(a.dueDate, a.status)
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-indigo-500/15 text-indigo-400'
                        }`}
                      >
                        {a.status === 'completed' ? '✓' : isOverdue(a.dueDate, a.status) ? '!' : '→'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {a.title || a.name || `Assignment #${idx + 1}`}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {a.assignedToName || a.assignedTo || 'Unassigned'} • {a.type || 'Module'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="hidden sm:block w-20">
                        <ProgressBar
                          value={a.progress || 0}
                          color={a.status === 'completed' ? 'emerald' : isOverdue(a.dueDate, a.status) ? 'red' : 'indigo'}
                          size="sm"
                        />
                      </div>
                      <StatusBadge status={isOverdue(a.dueDate, a.status) ? 'overdue' : a.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Quick Actions</h3>
              <div className="space-y-2.5">
                {[
                  { label: 'Create Module', icon: '📚', path: '/admin/modules', color: 'from-indigo-600/20 to-indigo-600/5 border-indigo-500/30 hover:border-indigo-500/50 text-indigo-300' },
                  { label: 'Assign Content', icon: '📋', path: '/admin/assignments', color: 'from-purple-600/20 to-purple-600/5 border-purple-500/30 hover:border-purple-500/50 text-purple-300' },
                  { label: 'View Reports', icon: '📊', path: '/report', color: 'from-emerald-600/20 to-emerald-600/5 border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300' },
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={() => navigate(action.path)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r border transition-all text-sm font-semibold ${action.color}`}
                  >
                    <span className="text-base">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Team Summary</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-400 font-medium">Overall Progress</span>
                    <span className="text-xs font-bold text-indigo-400">{avgProgress}%</span>
                  </div>
                  <ProgressBar value={avgProgress} color="indigo" size="md" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-900/50 p-3 text-center">
                    <p className="text-lg font-black text-emerald-400">{completedAssignments}</p>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Done</p>
                  </div>
                  <div className="rounded-lg bg-slate-900/50 p-3 text-center">
                    <p className="text-lg font-black text-amber-400">{overdueAssignments}</p>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Overdue</p>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-700/40">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Completion Rate</span>
                    <span className="font-bold text-white">
                      {totalEmployees > 0
                        ? Math.round((completedAssignments / (completedAssignments + activeAssignments || 1)) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeView === 'employees' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-5 border-b border-slate-700/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Team Members</h3>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-64 pl-9 pr-4 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/25 transition-all"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
              </div>
            </div>
          </div>
          {filteredEmployees.length === 0 ? (
            <EmptyState
              icon="👥"
              title={searchQuery ? 'No Matching Employees' : 'No Team Members'}
              subtitle={
                searchQuery
                  ? `No employees match "${searchQuery}". Try a different search.`
                  : 'Employees assigned to you will appear here.'
              }
              action={
                searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-sm font-semibold hover:bg-indigo-600/30 transition-all"
                  >
                    Clear Search
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="divide-y divide-slate-700/30">
              {filteredEmployees.map((emp, idx) => {
                const empProgress = emp.progress || (emp.assignedModules > 0 ? Math.round((emp.completedModules || 0) / emp.assignedModules * 100) : 0);
                return (
                  <div
                    key={emp.userId || emp.id || idx}
                    onClick={() => loadEmployeeDetail(emp)}
                    className="flex items-center justify-between p-4 hover:bg-slate-700/15 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={emp.name} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                          {emp.name || 'Unknown'}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{emp.email || '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center-center gap-4 sm:gap-6 shrink-0 ml-3">
                      <div className="hidden md:block text-center">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Role</p>
                        <p className="text-xs text-slate-300 font-medium mt-0.5">{emp.role || 'Employee'}</p>
                      </div>
                      <div className="hidden sm:block text-center">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Modules</p>
                        <p className="text-xs text-slate-300 font-medium mt-0.5">{emp.assignedModules || 0}</p>
                      </div>
                      <div className="w-24 hidden sm:block">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Progress</span>
                          <span className="text-xs font-bold text-indigo-400">{empProgress}%</span>
                        </div>
                        <ProgressBar value={empProgress} color="indigo" size="sm" />
                      </div>
                      <div className="hidden md:block text-right">
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Last Active</p>
                        <p className="text-xs text-slate-300 font-medium mt-0.5">{timeAgo(emp.lastActive)}</p>
                      </div>
                      <div className="w-9 h-7 rounded-lg bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 text-xs font-bold opacity-0 group-hover:opacity-100 transition-all">
                        →
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Submit Approval Request Modal */}
      {showRequestModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#1E293B]">
              <h2 className="text-lg font-bold text-white">📋 Submit Approval Request</h2>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <form onSubmit={handleSubmitRequest} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Request Type</label>
                <select
                  value={requestForm.actionType}
                  onChange={e => setRequestForm(f => ({ ...f, actionType: e.target.value }))}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
                >
                  <option value="assign_module">Assign Module to Employees</option>
                  <option value="assign_assessment">Assign Assessment to Employees</option>
                  <option value="create_module">Request New Module Creation</option>
                  <option value="create_assessment">Request New Assessment Creation</option>
                </select>
              </div>

              {(requestForm.actionType === 'assign_module' || requestForm.actionType === 'assign_assessment') ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      {requestForm.actionType === 'assign_module' ? 'Module' : 'Assessment'} Title / ID
                    </label>
                    <input
                      value={requestForm.targetTitle}
                      onChange={e => setRequestForm(f => ({ ...f, targetTitle: e.target.value, targetId: e.target.value }))}
                      placeholder={`Enter ${requestForm.actionType === 'assign_module' ? 'module' : 'assessment'} name or ID`}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Employees <span className="text-slate-500 font-normal">(select one or more)</span>
                    </label>
                    <div className="max-h-36 overflow-y-auto bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2 space-y-1">
                      {employees.length === 0 ? (
                        <p className="text-slate-500 text-xs py-1">No employees found</p>
                      ) : employees.map(emp => {
                        const id = emp.userId || emp.id;
                        const checked = requestForm.employeeIds.includes(id);
                        return (
                          <label key={id} className="flex items-center gap-2 cursor-pointer py-0.5 group">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setRequestForm(f => ({
                                ...f,
                                employeeIds: checked
                                  ? f.employeeIds.filter(eid => eid !== id)
                                  : [...f.employeeIds, id],
                              }))}
                              className="accent-violet-500"
                            />
                            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                              {emp.name || emp.email}
                              {emp.jobRole && <span className="text-slate-500 text-xs ml-1">· {emp.jobRole}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {requestForm.employeeIds.length > 0 && (
                      <p className="text-xs text-violet-400 mt-1">{requestForm.employeeIds.length} employee{requestForm.employeeIds.length > 1 ? 's' : ''} selected</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Priority</label>
                    <select
                      value={requestForm.priority}
                      onChange={e => setRequestForm(f => ({ ...f, priority: e.target.value }))}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Due Date (optional)</label>
                    <input
                      type="date"
                      value={requestForm.dueDate}
                      onChange={e => setRequestForm(f => ({ ...f, dueDate: e.target.value }))}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Title <span className="text-red-400">*</span></label>
                    <input
                      required
                      value={requestForm.title}
                      onChange={e => setRequestForm(f => ({ ...f, title: e.target.value }))}
                      placeholder={requestForm.actionType === 'create_module' ? 'Module title' : 'Assessment title'}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
                    <textarea
                      value={requestForm.description}
                      onChange={e => setRequestForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Brief description..."
                      rows={3}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
                      <input
                        value={requestForm.category}
                        onChange={e => setRequestForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Difficulty</label>
                      <select
                        value={requestForm.difficulty}
                        onChange={e => setRequestForm(f => ({ ...f, difficulty: e.target.value }))}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/60"
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Notes (optional)</label>
                <textarea
                  value={requestForm.notes}
                  onChange={e => setRequestForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any additional notes for the admin..."
                  rows={2}
                  className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500/60 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingRequest}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white font-bold text-sm transition-colors"
                >
                  {submittingRequest ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeView === 'assignments' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">All Assignments</h3>
            <span className="text-xs text-slate-500 font-medium">{assignments.length} total</span>
          </div>
          {assignments.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No Assignments"
              subtitle="Assignments for your team will appear here."
              action={
                <button
                  onClick={() => navigate('/admin/assignments')}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all"
                >
                  Create Assignment
                </button>
              }
            />
          ) : (
            <div className="divide-y divide-slate-700/30">
              {assignments.map((a, idx) => {
                const overdue = isOverdue(a.dueDate, a.status);
                return (
                  <div
                    key={a.id || idx}
                    className={`p-4 hover:bg-slate-700/10 transition-colors ${
                      overdue ? 'border-l-2 border-l-red-500' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {a.title || a.name || `Assignment #${idx + 1}`}
                        </p>
                        {overdue && (
                          <span className="shrink-0 text-xs font-bold text-red-400 bg-red-500/15 border border-red-500/30 px-2 py-0.5 rounded-full uppercase">
                            Overdue
                          </span>
                        )}
                      </div>
                      <StatusBadge status={overdue ? 'overdue' : a.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                      <span className="text-xs text-slate-500">
                        👤 {a.assignedToName || a.assignedTo || 'Unassigned'}
                      </span>
                      <span className="text-xs text-slate-500">
                        📁 {a.type || 'Module'}
                      </span>
                      {a.dueDate && (
                        <span className={`text-xs ${overdue ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
                          📅 Due: {formatDate(a.dueDate)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <ProgressBar
                          value={a.progress || 0}
                          color={a.status === 'completed' ? 'emerald' : overdue ? 'red' : 'indigo'}
                          size="sm"
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-400 shrink-0 w-10 text-right">{a.progress || 0}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
