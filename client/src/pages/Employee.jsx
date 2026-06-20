import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../utils/authFetch.js';

const SkeletonCard = () => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 animate-pulse">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-slate-700/50" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-700/50 rounded-lg w-3/4" />
        <div className="h-3 bg-slate-700/30 rounded-lg w-1/2" />
      </div>
    </div>
    <div className="h-2 bg-slate-700/40 rounded-full mb-3" />
    <div className="flex gap-2 flex-wrap">
      <div className="h-7 bg-slate-700/40 rounded-lg w-24" />
      <div className="h-7 bg-slate-700/40 rounded-lg w-20" />
      <div className="h-7 bg-slate-700/40 rounded-lg w-28" />
    </div>
  </div>
);

const SkeletonStat = () => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 animate-pulse">
    <div className="h-3 bg-slate-700/40 rounded w-16 mb-3" />
    <div className="h-8 bg-slate-700/50 rounded w-12" />
  </div>
);

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    error: 'bg-red-500/15 border-red-500/30 text-red-300',
    info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
  };
  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]} animate-[slideIn_0.3s_ease-out]`}>
      <span className="text-lg font-bold">{icons[type]}</span>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 text-current/50 hover:text-current transition-colors text-lg leading-none">&times;</button>
    </div>
  );
};

const ConfirmModal = ({ isOpen, title, message, confirmLabel, onConfirm, onCancel, loading }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-black text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-5 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2">
            {loading && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProgressBar = ({ value, color = '#6366f1', size = 'md' }) => {
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';
  return (
    <div className={`w-full bg-slate-800 rounded-full overflow-hidden ${h}`}>
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.max(value, 0)}%`, background: `linear-gradient(90deg, ${color}, ${color}dd)` }}
      />
    </div>
  );
};

const statusConfig = {
  assigned: { bg: 'bg-blue-500/15', text: 'text-blue-300', border: 'border-blue-500/30', dot: 'bg-blue-400', label: 'Assigned' },
  in_progress: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30', dot: 'bg-amber-400', label: 'In Progress' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30', dot: 'bg-emerald-400', label: 'Completed' },
  overdue: { bg: 'bg-red-500/15', text: 'text-red-300', border: 'border-red-500/30', dot: 'bg-red-400', label: 'Overdue' },
  cancelled: { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-500', label: 'Cancelled' },
};

const priorityConfig = {
  low: { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30', label: 'Low' },
  medium: { bg: 'bg-blue-500/15', text: 'text-blue-300', border: 'border-blue-500/30', label: 'Medium' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-300', border: 'border-orange-500/30', label: 'High' },
  urgent: { bg: 'bg-red-500/15', text: 'text-red-300', border: 'border-red-500/30', label: 'Urgent' },
};

const typeConfig = {
  package: { icon: '📦', label: 'Package', gradient: 'from-blue-500/20 to-cyan-500/10', border: 'border-blue-500/20' },
  skill_package: { icon: '🧩', label: 'Skill Pack', gradient: 'from-purple-500/20 to-pink-500/10', border: 'border-purple-500/20' },
  learning_track: { icon: '🗺️', label: 'Track', gradient: 'from-emerald-500/20 to-teal-500/10', border: 'border-emerald-500/20' },
  module: { icon: '📚', label: 'Module', gradient: 'from-indigo-500/20 to-violet-500/10', border: 'border-indigo-500/20' },
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] || statusConfig.assigned;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === 'in_progress' ? 'animate-pulse' : ''}`} />
      {cfg.label}
    </span>
  );
};

const PriorityBadge = ({ priority }) => {
  const cfg = priorityConfig[priority] || priorityConfig.medium;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-bold uppercase tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
};

const TypeIcon = ({ type }) => {
  const cfg = typeConfig[type] || typeConfig.module;
  return (
    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${cfg.gradient} border ${cfg.border} flex items-center justify-center text-xl flex-shrink-0`}>
      {cfg.icon}
    </div>
  );
};

const StatBox = ({ label, value, icon, gradient, delay }) => (
  <div
    className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 relative overflow-hidden group hover:border-slate-600/60 transition-all duration-300"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-3xl font-black text-white mb-1">{value}</p>
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label}</p>
    </div>
  </div>
);

export default function Employee() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [assignments, setAssignments] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [managerInfo, setManagerInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, assignmentId: null, newStatus: null, title: '', message: '' });
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Assessments
  const [myAssessments, setMyAssessments] = useState([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(true);
  const [moduleGenerating, setModuleGenerating] = useState(false);

  // Recommendations
  const [recommendations, setRecommendations] = useState([]);
  const [recsLoading, setRecsLoading] = useState(true);
  const [excludingSkill, setExcludingSkill] = useState(null);
  const [tooltipSkill, setTooltipSkill] = useState(null);

  // Close tooltip when clicking outside
  useEffect(() => {
    if (!tooltipSkill) return;
    const close = () => setTooltipSkill(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [tooltipSkill]);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type, id: Date.now() });
  }, []);

  const userId = useMemo(() => user?.userId || user?.id, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'employee') {
      navigate('/dashboard');
      return;
    }
    loadData();
  }, [user, navigate]);

  // Poll for module generation: if employee has a completed assessment but no assignments yet
  useEffect(() => {
    if (loading || assessmentsLoading) return;
    const hasCompletedAssessment = myAssessments.some(a => a.status === 'completed' || a.submittedAt || a.completedAt);
    const hasNoModules = assignments.length === 0;
    if (hasCompletedAssessment && hasNoModules) {
      setModuleGenerating(true);
      const poll = setInterval(async () => {
        try {
          const data = await authFetch(`/api/assignments?userId=${userId}`);
          const list = Array.isArray(data) ? data : (data?.assignments || data?.data || []);
          if (list.length > 0) {
            setAssignments(list);
            setModuleGenerating(false);
            clearInterval(poll);
            showToast('Your personalized module is ready!', 'success');
          }
        } catch { /* silent */ }
      }, 5000);
      return () => clearInterval(poll);
    } else {
      setModuleGenerating(false);
    }
  }, [loading, assessmentsLoading, myAssessments, assignments.length, userId]);

  const loadData = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [assignmentsData, statsData, mgrData] = await Promise.allSettled([
        authFetch(`/api/assignments?userId=${userId}`),
        authFetch('/api/assignments/dashboard'),
        authFetch(`/api/assignments/employee/${userId}/manager`),
      ]);
      loadAssessments();
      loadRecommendations();

      if (assignmentsData.status === 'fulfilled') {
        const data = assignmentsData.value;
        setAssignments(Array.isArray(data) ? data : (data?.assignments || data?.data || []));
      } else {
        throw assignmentsData.reason;
      }

      if (statsData.status === 'fulfilled') {
        setDashboardStats(statsData.value);
      }

      if (mgrData.status === 'fulfilled') {
        setManagerInfo(mgrData.value);
      }
    } catch (err) {
      showToast(err.message || 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendations = async () => {
    setRecsLoading(true);
    try {
      const res = await authFetch('/api/recommendations');
      const recs = res?.recommendations ?? res?.data?.recommendations ?? [];
      setRecommendations(Array.isArray(recs) ? recs : []);
    } catch {
      setRecommendations([]);
    } finally {
      setRecsLoading(false);
    }
  };

  const handleExcludeSkill = async (skillId) => {
    setExcludingSkill(skillId);
    try {
      await authFetch('/api/recommendations/exclude', {
        method: 'POST',
        body: JSON.stringify({ skillId }),
      });
      setRecommendations(prev => prev.filter(r => r.skill_id !== skillId));
      showToast('Skill hidden from recommendations', 'info');
    } catch {
      showToast('Could not update preferences', 'error');
    } finally {
      setExcludingSkill(null);
    }
  };

  const handleRecClick = async (skillId) => {
    try {
      await authFetch('/api/recommendations/interaction', {
        method: 'POST',
        body: JSON.stringify({ skillId, engagementScore: 0.7, interactionType: 'view' }),
      });
    } catch { /* non-fatal */ }
    // Navigate to profiling with the skill pre-filled so user can start a learning path
    navigate(`/profiling?goal=${encodeURIComponent(skillId)}`);
  };

  const loadAssessments = async () => {
    setAssessmentsLoading(true);
    try {
      const res = await authFetch('/api/assessments/my');
      const list = Array.isArray(res) ? res : (res?.assessments || []);
      setMyAssessments(list);
    } catch {
      // silently ignore — assessments card just shows empty
    } finally {
      setAssessmentsLoading(false);
    }
  };

  const handleStatusClick = (assignmentId, currentStatus) => {
    const flow = ['assigned', 'in_progress', 'completed'];
    const idx = flow.indexOf(currentStatus);
    if (idx === -1 || idx === flow.length - 1) {
      showToast('This assignment is already completed', 'info');
      return;
    }
    const nextStatus = flow[idx + 1];
    const labels = { in_progress: 'Start Progress', completed: 'Mark Complete' };
    setConfirmModal({
      isOpen: true,
      assignmentId,
      newStatus: nextStatus,
      title: `Update Status`,
      message: `Change status from "${statusConfig[currentStatus]?.label || currentStatus}" to "${statusConfig[nextStatus]?.label || nextStatus}"?`,
      confirmLabel: labels[nextStatus] || 'Update',
    });
  };

  const confirmStatusChange = async () => {
    const { assignmentId, newStatus } = confirmModal;
    if (!assignmentId || !newStatus) return;
    setUpdatingStatus(true);
    try {
      await authFetch(`/api/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, status: newStatus, progress: newStatus === 'completed' ? 100 : a.progress } : a));
      showToast(`Status updated to ${statusConfig[newStatus]?.label || newStatus}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
      setConfirmModal({ isOpen: false, assignmentId: null, newStatus: null, title: '', message: '' });
    }
  };

  const filteredAssignments = useMemo(() => {
    return assignments.filter(a => {
      const title = (a.module_name || a.name || a.title || a.assignable_type || 'Untitled').toLowerCase();
      const matchesSearch = !searchQuery || title.includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === 'all' || a.status === filterStatus;
      const matchesType = filterType === 'all' || a.type === filterType;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [assignments, searchQuery, filterStatus, filterType]);

  const stats = useMemo(() => {
    const active = assignments.filter(a => a.status !== 'completed' && a.status !== 'cancelled').length;
    const completed = assignments.filter(a => a.status === 'completed').length;
    const overdue = assignments.filter(a => a.status === 'overdue' || (a.due_date && new Date(a.due_date) < new Date() && a.status !== 'completed' && a.status !== 'cancelled')).length;
    const avgProgress = assignments.length > 0 ? Math.round(assignments.reduce((s, a) => s + (a.progress || 0), 0) / assignments.length) : 0;
    return { active, completed, overdue, avgProgress };
  }, [assignments]);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'No due date';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (diff < 0) return `${formatted} (${Math.abs(diff)}d overdue)`;
    if (diff === 0) return `${formatted} (today)`;
    if (diff === 1) return `${formatted} (tomorrow)`;
    return `${formatted} (${diff}d left)`;
  };

  const getProgressColor = (progress) => {
    if (progress >= 75) return '#10b981';
    if (progress >= 50) return '#6366f1';
    if (progress >= 25) return '#f59e0b';
    return '#ef4444';
  };

  const mgrName = managerInfo?.name || managerInfo?.full_name || 'Not assigned';
  const mgrEmail = managerInfo?.email || '';
  const mgrInitial = mgrName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeInUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .card-enter { animation: fadeInUp 0.4s ease-out both; }
      `}</style>

      {moduleGenerating && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border border-indigo-500/40 bg-indigo-900/80 backdrop-blur-xl shadow-2xl text-indigo-200">
          <span className="w-4 h-4 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm font-semibold">Generating your personalized learning module…</span>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmLabel={confirmModal.confirmLabel}
        onConfirm={confirmStatusChange}
        onCancel={() => setConfirmModal({ isOpen: false, assignmentId: null, newStatus: null, title: '', message: '' })}
        loading={updatingStatus}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-2xl">
              👨‍💼
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">My Learning</h1>
              <p className="text-slate-400 text-sm mt-0.5">Track your assigned modules and progress</p>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-400 hover:text-white hover:border-slate-600 text-xs font-bold transition-all"
          >
            🖨️ Export PDF
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[0, 1, 2, 3].map(i => <SkeletonStat key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatBox label="Active" value={stats.active} icon="⚡" gradient="from-indigo-500/10 to-blue-500/5" delay={0} />
            <StatBox label="Completed" value={stats.completed} icon="✅" gradient="from-emerald-500/10 to-teal-500/5" delay={100} />
            <StatBox label="Overdue" value={stats.overdue} icon="⚠️" gradient="from-red-500/10 to-orange-500/5" delay={200} />
            <StatBox label="Avg Progress" value={`${stats.avgProgress}%`} icon="📊" gradient="from-purple-500/10 to-pink-500/5" delay={300} />
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 mb-6 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-slate-700/50" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-slate-700/50 rounded w-32" />
                <div className="h-3 bg-slate-700/30 rounded w-48" />
              </div>
            </div>
          </div>
        ) : managerInfo ? (
          <div className="rounded-2xl border border-teal-500/20 bg-gradient-to-r from-teal-500/5 to-cyan-500/5 p-5 mb-6 card-enter">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-500/30 to-cyan-500/20 border border-teal-500/30 flex items-center justify-center text-lg font-black text-teal-300">
                {mgrInitial}
              </div>
              <div>
                <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-0.5">Your Manager</p>
                <p className="text-base font-bold text-white">{mgrName}</p>
                {mgrEmail && <p className="text-xs text-slate-400">{mgrEmail}</p>}
              </div>
            </div>
          </div>
        ) : null}

        {/* ── My Assessments ── */}
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm overflow-hidden mb-6 card-enter" style={{ animationDelay: '150ms' }}>
          <div className="border-b border-slate-700/40 px-5 py-4 flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">📝 My Assessments</h3>
            {myAssessments.length > 0 && (
              <span className="text-xs text-slate-500">{myAssessments.length} assigned</span>
            )}
          </div>
          <div className="p-4">
            {assessmentsLoading ? (
              <div className="space-y-2">
                {[0, 1].map(i => (
                  <div key={i} className="h-12 rounded-xl bg-slate-800/40 animate-pulse" />
                ))}
              </div>
            ) : myAssessments.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-slate-500">No assessments yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myAssessments.map((a) => {
                  const id = a.id || a._id;
                  const isSubmitted = a.status === 'submitted' || a.status === 'completed';
                  const isExpired = a.isExpired && !isSubmitted;
                  const isNotYet = a.isVisible === false;
                  const score = a.submission?.scoring?.score ?? a.scoring?.score ?? a.score ?? null;
                  const pctScore = score !== null ? Math.round(score) : null;
                  const scoreBg = pctScore !== null
                    ? pctScore >= 80 ? 'text-emerald-400' : pctScore >= 60 ? 'text-amber-400' : 'text-red-400'
                    : '';
                  const statusBadge = isSubmitted
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : isExpired
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : isNotYet
                        ? 'bg-slate-700/40 border-slate-600/30 text-slate-500'
                        : 'bg-blue-500/10 border-blue-500/20 text-blue-400';
                  const statusLabel = isSubmitted ? 'Submitted' : isExpired ? 'Expired' : isNotYet ? 'Scheduled' : 'Available';
                  return (
                    <div key={id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50 transition-all">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{a.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {a.assessmentDate && (
                            <span className="text-xs text-slate-500">
                              📅 {new Date(a.assessmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                          {a.deadline && !isSubmitted && (
                            <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-slate-500'}`}>
                              ⏰ {new Date(a.deadline).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${statusBadge}`}>{statusLabel}</span>
                          {pctScore !== null && <span className={`text-xs font-black ${scoreBg}`}>{pctScore}%</span>}
                        </div>
                      </div>
                      {!isSubmitted && !isExpired && !isNotYet && (
                        <button onClick={() => navigate(`/assessment/${id}`)}
                          className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-bold transition-all whitespace-nowrap">
                          Start →
                        </button>
                      )}
                      {isNotYet && a.assessmentDate && (
                        <span className="text-xs text-slate-600 shrink-0">
                          Opens {new Date(a.assessmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Recommended for You ── */}
        {(recsLoading || recommendations.length > 0) && (
          <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 overflow-hidden mb-6 card-enter" style={{ animationDelay: '200ms' }}>
            <div className="border-b border-violet-500/20 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">✨</span>
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Recommended for You</h3>
              </div>
              <span className="text-xs text-slate-600">AI-powered · updated 6h</span>
            </div>
            <div className="p-4">
              {recsLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-20 rounded-xl bg-slate-800/40 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recommendations.map((rec) => {
                    const matchPct = Math.round((rec.score ?? 0.5) * 100);
                    const barColor = matchPct >= 75 ? '#8b5cf6' : matchPct >= 50 ? '#6366f1' : '#94a3b8';
                    return (
                      <div
                        key={rec.skill_id}
                        className="relative group rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-violet-500/40 hover:bg-slate-800/60 transition-all duration-200 p-3.5 cursor-pointer"
                        onClick={() => handleRecClick(rec.skill_id)}
                      >
                        {/* Not Interested button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExcludeSkill(rec.skill_id); }}
                          disabled={excludingSkill === rec.skill_id}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full bg-slate-700/70 border border-slate-600/50 text-slate-500 hover:text-red-400 hover:border-red-500/40 flex items-center justify-center text-xs font-bold leading-none"
                          title="Not Interested"
                        >
                          {excludingSkill === rec.skill_id ? (
                            <span className="w-2.5 h-2.5 border border-slate-400/40 border-t-slate-300 rounded-full animate-spin block" />
                          ) : '×'}
                        </button>

                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-lg mt-0.5">🎯</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{rec.name || rec.skill_id}</p>
                            <p className="text-xs text-slate-500 capitalize">{rec.domain || 'skill'}</p>
                          </div>
                        </div>

                        {/* Match score bar */}
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${matchPct}%`, background: barColor }} />
                          </div>
                          <span className="text-xs font-black" style={{ color: barColor }}>{matchPct}%</span>
                        </div>

                        {/* Why recommended tooltip */}
                        {rec.reason && (
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setTooltipSkill(tooltipSkill === rec.skill_id ? null : rec.skill_id); }}
                              className="text-xs text-violet-400/60 hover:text-violet-400 transition-colors underline decoration-dotted"
                            >
                              Why?
                            </button>
                            {tooltipSkill === rec.skill_id && (
                              <div className="absolute left-0 bottom-6 z-20 w-52 bg-slate-900 border border-violet-500/30 rounded-lg px-3 py-2 shadow-2xl text-xs text-slate-300 leading-relaxed">
                                {rec.reason}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm overflow-hidden mb-6">
          <div className="border-b border-slate-700/40 px-5 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
                <input
                  type="text"
                  placeholder="Search modules..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                />
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300 font-semibold focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                >
                  <option value="all">All Status</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="overdue">Overdue</option>
                </select>
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                  className="px-3 py-2.5 rounded-xl bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300 font-semibold focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                >
                  <option value="all">All Types</option>
                  <option value="module">Module</option>
                  <option value="package">Package</option>
                  <option value="skill_package">Skill Pack</option>
                  <option value="learning_track">Track</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-5">
            {loading ? (
              <div className="space-y-4">
                {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : filteredAssignments.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4 opacity-40">📭</div>
                <p className="text-lg font-bold text-slate-400 mb-2">
                  {assignments.length === 0 ? 'No Modules Assigned Yet' : 'No Matching Modules'}
                </p>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  {assignments.length === 0
                    ? 'Your manager hasn\'t assigned any learning modules yet. Check back soon!'
                    : 'Try adjusting your search or filters to find what you\'re looking for.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredAssignments.map((a, idx) => {
                  const title = a.module_name || a.name || a.title || a.assignable_type || 'Untitled';
                  const type = a.type || 'module';
                  const progress = a.progress || 0;
                  const status = a.status || 'assigned';
                  const priority = a.priority || 'medium';
                  const dueDate = a.due_date;
                  const cfg = statusConfig[status] || statusConfig.assigned;
                  const isCompleted = status === 'completed';
                  const isCancelled = status === 'cancelled';
                  const flow = ['assigned', 'in_progress', 'completed'];
                  const canAdvance = flow.indexOf(status) >= 0 && flow.indexOf(status) < flow.length - 1;

                  return (
                    <div
                      key={a.id}
                      className="card-enter rounded-2xl border border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/50 hover:border-slate-600/50 transition-all duration-300 group"
                      style={{ animationDelay: `${idx * 60}ms` }}
                    >
                      <div className="p-5">
                        <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-4">
                          <TypeIcon type={type} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <h3 className="text-base font-bold text-white leading-tight group-hover:text-indigo-200 transition-colors">
                                {title}
                              </h3>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <StatusBadge status={status} />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                              <PriorityBadge priority={priority} />
                              <span className="text-xs text-slate-500 font-medium px-2 py-0.5 rounded-md bg-slate-800/60 border border-slate-700/30">
                                {typeConfig[type]?.label || type}
                              </span>
                              <span className="text-xs text-slate-500 font-medium">
                                📅 {formatDate(dueDate)}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <ProgressBar value={progress} color={getProgressColor(progress)} size="md" />
                              </div>
                              <span className="text-sm font-black font-mono w-12 text-right" style={{ color: getProgressColor(progress) }}>
                                {progress}%
                              </span>
                            </div>
                          </div>
                        </div>

                         <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-700/30">
                           <button
                             onClick={() => {
                               const moduleId = a.assignable_id || a.module_id;
                               if (!moduleId) { showToast('No module linked to this assignment', 'error'); return; }
                               // If already in progress or completed → go to module dashboard
                               if (status === 'in_progress' || status === 'completed') {
                                 navigate(`/module/${moduleId}/learn?assignmentId=${a.id}`);
                               } else {
                                 navigate(`/module/${moduleId}/start?assignmentId=${a.id}`);
                               }
                             }}
                             className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/15 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-600/25 hover:border-indigo-500/40 text-xs font-bold transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/10"
                           >
                             <span>{status === 'in_progress' ? '▶' : status === 'completed' ? '🔁' : '🚀'}</span>
                             {status === 'in_progress' ? 'Continue' : status === 'completed' ? 'Review' : 'Start Module'}
                           </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-6 animate-pulse">
            <div className="h-4 bg-slate-700/50 rounded w-40 mb-4" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="p-4 rounded-xl bg-slate-700/20 space-y-2">
                  <div className="h-3 bg-slate-700/40 rounded w-16" />
                  <div className="h-6 bg-slate-700/50 rounded w-12" />
                </div>
              ))}
            </div>
          </div>
        ) : dashboardStats ? (
          <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-sm p-6 card-enter" style={{ animationDelay: '400ms' }}>
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">📊 Learning Analytics</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Sessions', value: dashboardStats.totalSessions || 0, color: '#6366f1' },
                { label: 'Avg Score', value: `${dashboardStats.avgScore || 0}%`, color: dashboardStats.avgScore >= 75 ? '#10b981' : '#f59e0b' },
                { label: 'Best Score', value: `${dashboardStats.bestScore || 0}%`, color: '#10b981' },
                { label: 'Streak', value: `${dashboardStats.streak || 0}d`, color: '#f59e0b' },
              ].map((item, i) => (
                <div key={i} className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50 transition-all">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{item.label}</p>
                  <p className="text-xl font-black" style={{ color: item.color }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
