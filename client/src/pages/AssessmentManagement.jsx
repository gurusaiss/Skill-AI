import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) { throw new Error(typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`); }
  return data?.data ?? data;
};

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = {
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    error: 'bg-red-500/15 border-red-500/30 text-red-300',
    info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
  };
  return (
    <div className={`fixed top-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 text-lg">&times;</button>
    </div>
  );
};

const QUESTION_TYPE_OPTIONS = [
  { value: 'mcq', label: 'MCQ' },
  { value: 'subjective', label: 'Subjective' },
  { value: 'fill_blank', label: 'Fill in Blank' },
];

const STATUS_COLORS = {
  assigned: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  submitted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  pending: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

const EMPTY_MODAL = {
  step: 1,
  targetType: 'individual',
  selectedUsers: [],
  selectedGroup: '',
  questionCount: 10,
  questionTypes: ['mcq'],
  assessmentDate: '',
  duration: 30,
  deadline: '',
  title: '',
};

export default function AssessmentManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [assessments, setAssessments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all'); // 'all' | 'individual' | 'group'
  const [filterJobRole, setFilterJobRole] = useState('all');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modal, setModal] = useState(EMPTY_MODAL);
  const [creating, setCreating] = useState(false);

  // Detail view
  const [viewDetail, setViewDetail] = useState(null);
  const [viewReport, setViewReport] = useState(null);
  const [assigningModuleId, setAssigningModuleId] = useState(null);

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      navigate('/dashboard');
      return;
    }
    loadAll();
  }, [user, navigate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [assessRes, empRes, groupRes] = await Promise.allSettled([
        authFetch('/api/assessments'),
        authFetch('/api/users?role=employee'),
        authFetch('/api/content/groups'),
      ]);
      if (assessRes.status === 'fulfilled') {
        const v = assessRes.value;
        setAssessments(Array.isArray(v) ? v : []);
      }
      if (empRes.status === 'fulfilled') {
        const v = empRes.value;
        const list = Array.isArray(v) ? v : (v?.users || []);
        setEmployees(list);
      }
      if (groupRes.status === 'fulfilled') {
        const v = groupRes.value;
        setGroups(Array.isArray(v) ? v : []);
      }
    } catch (e) {
      showToast(e.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    const today = new Date().toISOString().split('T')[0];
    setModal({ ...EMPTY_MODAL, assessmentDate: today, title: `Assessment - ${today}` });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModal(EMPTY_MODAL);
    setCreating(false);
  };

  const updateModal = (patch) => setModal(prev => ({ ...prev, ...patch }));

  const toggleEmployee = (id) => {
    setModal(prev => ({
      ...prev,
      selectedUsers: prev.selectedUsers.includes(id)
        ? prev.selectedUsers.filter(u => u !== id)
        : [...prev.selectedUsers, id],
    }));
  };

  const toggleQuestionType = (type) => {
    setModal(prev => {
      const types = prev.questionTypes.includes(type)
        ? prev.questionTypes.filter(t => t !== type)
        : [...prev.questionTypes, type];
      return { ...prev, questionTypes: types.length > 0 ? types : [type] };
    });
  };

  const handleDateChange = (date) => {
    updateModal({
      assessmentDate: date,
      title: `Assessment - ${date}`,
    });
  };

  const canProceedStep1 = () => {
    if (modal.targetType === 'individual') return modal.selectedUsers.length > 0;
    return !!modal.selectedGroup;
  };

  const canProceedStep2 = () => {
    return modal.assessmentDate && modal.questionCount >= 5 && modal.questionCount <= 30 && modal.title.trim();
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const targetUsers = modal.targetType === 'individual'
        ? modal.selectedUsers
        : []; // group handled server-side via selectedGroup

      const payload = {
        title: modal.title.trim(),
        targetUsers,
        questionCount: modal.questionCount,
        questionTypes: modal.questionTypes,
        assessmentDate: modal.assessmentDate,
        duration: modal.duration,
        deadline: modal.deadline,
        ...(modal.targetType === 'group' && modal.selectedGroup ? { groupId: modal.selectedGroup } : {}),
      };

      const saved = await authFetch('/api/assessments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const newRecord = saved || { id: Date.now().toString(), ...payload, createdAt: new Date().toISOString() };
      setAssessments(prev => [newRecord, ...prev]);
      showToast(`Assessment created for ${modal.selectedUsers.length || 'group'} employee(s)`, 'success');
      closeModal();
    } catch (e) {
      showToast(e.message || 'Failed to create assessment', 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteAssessment = async (id) => {
    if (!window.confirm('Delete this assessment?')) return;
    try {
      await authFetch(`/api/assessments/${id}`, { method: 'DELETE' });
      setAssessments(prev => prev.filter(a => a.id !== id));
      showToast('Assessment deleted', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to delete', 'error');
    }
  };

  const jobRoles = useMemo(() => {
    const roles = new Set();
    assessments.forEach(a => {
      a.employeeAssignments?.forEach(ea => { if (ea.jobRole) roles.add(ea.jobRole); });
    });
    return [...roles];
  }, [assessments]);

  const filtered = useMemo(() => {
    return assessments.filter(a => {
      const q = (search || '').toLowerCase();
      const matchesSearch = !q || (a.title || '').toLowerCase().includes(q);

      const matchesStatus = filterStatus === 'all' ? true
        : filterStatus === 'completed' ? a.employeeAssignments?.every(ea => ea.status === 'submitted')
        : filterStatus === 'pending' ? a.employeeAssignments?.some(ea => ea.status === 'assigned')
        : filterStatus === 'active' ? a.employeeAssignments?.some(ea => ea.status !== 'submitted')
        : true;

      const matchesType = filterType === 'all' ? true
        : filterType === 'group' ? !!a.targetGroup
        : filterType === 'individual' ? !a.targetGroup
        : true;

      const matchesJobRole = filterJobRole === 'all' ? true
        : a.employeeAssignments?.some(ea => ea.jobRole === filterJobRole);

      return matchesSearch && matchesStatus && matchesType && matchesJobRole;
    });
  }, [assessments, search, filterStatus, filterType, filterJobRole]);

  const selectedEmployeeObjects = useMemo(
    () => employees.filter(e => modal.selectedUsers.includes(e.userId || e.id || e._id)),
    [employees, modal.selectedUsers]
  );

  const handleAutoAssignModule = async (assessment) => {
    setAssigningModuleId(assessment.id);
    try {
      const submitted = assessment.employeeAssignments?.filter(ea => ea.status === 'submitted') || [];
      for (const ea of submitted) {
        const weakAreas = ea.scoring?.weakAreas || [];
        const pending = await authFetch('/api/modules/auto-generate', {
          method: 'POST',
          body: JSON.stringify({
            userId: ea.userId,
            jobRole: ea.jobRole || '',
            weakAreas,
            assessmentTitle: assessment.title,
            assessmentReportId: ea.userId + '-' + assessment.id,
          }),
        });
        if (pending?.id) {
          await authFetch(`/api/modules/pending/${pending.id}/approve`, { method: 'POST' });
        }
      }
      showToast(`✅ Training module generated and assigned to ${submitted.length} employee(s)`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to assign module', 'error');
    } finally {
      setAssigningModuleId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <button
              onClick={() => navigate(user?.role === 'admin' ? '/admin/dashboard' : '/manager/dashboard')}
              className="text-slate-400 hover:text-white text-sm mb-2 flex items-center gap-2 transition-colors"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-black text-white">Assessment Management</h1>
            <p className="text-slate-400 text-sm mt-0.5">Create employee-specific assessments based on job roles and JDs</p>
          </div>
          <button
            onClick={openModal}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all shadow-lg shadow-indigo-500/20"
          >
            + Create Assessment
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Assessments', value: assessments.length, icon: '📝', borderCls: 'border-indigo-500/25', bgCls: 'bg-indigo-500/5', textCls: 'text-indigo-400', numCls: 'text-indigo-300' },
            { label: 'Total Employees Assigned', value: assessments.reduce((s, a) => s + (a.targetUsers?.length || 0), 0), icon: '👥', borderCls: 'border-purple-500/25', bgCls: 'bg-purple-500/5', textCls: 'text-purple-400', numCls: 'text-purple-300' },
            { label: 'Active Employees', value: employees.length, icon: '🧑‍💼', borderCls: 'border-emerald-500/25', bgCls: 'bg-emerald-500/5', textCls: 'text-emerald-400', numCls: 'text-emerald-300' },
          ].map((s, i) => (
            <div key={i} className={`rounded-2xl border ${s.borderCls} ${s.bgCls} p-5 flex flex-col gap-2`}>
              <div className="flex items-center justify-between">
                <p className={`text-xs font-bold ${s.textCls} uppercase tracking-widest`}>{s.label}</p>
                <span className="text-lg opacity-60">{s.icon}</span>
              </div>
              <p className={`text-4xl font-black ${s.numCls} leading-none`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 border-b border-slate-700/50 bg-slate-800/20">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Search assessments..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <button
              onClick={loadAll}
              className="px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-sm text-slate-400 hover:text-white hover:border-slate-600 font-semibold transition-all flex items-center gap-2"
            >
              <span>↻</span> Refresh
            </button>
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs font-semibold focus:outline-none focus:border-indigo-500 transition-colors">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs font-semibold focus:outline-none focus:border-indigo-500 transition-colors">
              <option value="all">All Types</option>
              <option value="individual">Individual</option>
              <option value="group">Group</option>
            </select>
            {jobRoles.length > 0 && (
              <select value={filterJobRole} onChange={e => setFilterJobRole(e.target.value)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs font-semibold focus:outline-none focus:border-indigo-500 transition-colors">
                <option value="all">All Job Roles</option>
                {jobRoles.map(jr => <option key={jr} value={jr}>{jr}</option>)}
              </select>
            )}
            {(filterStatus !== 'all' || filterType !== 'all' || filterJobRole !== 'all') && (
              <button onClick={() => { setFilterStatus('all'); setFilterType('all'); setFilterJobRole('all'); }}
                className="px-3 py-1.5 bg-slate-700/50 border border-slate-600/40 rounded-lg text-slate-400 text-xs font-semibold hover:text-white transition-colors">
                ✕ Clear
              </button>
            )}
          </div>

          {/* Table Header */}
          <div
            className="hidden md:grid px-5 py-3 border-b border-slate-700/40 bg-slate-800/30"
            style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 140px 150px' }}
          >
            {['Title', 'Employees', 'Date', 'Status', 'Report', 'Assign Module'].map(h => (
              <span key={h} className="text-xs font-bold text-slate-500 uppercase tracking-widest">{h}</span>
            ))}
          </div>

          {loading ? (
            <div className="divide-y divide-slate-700/20">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                  <div className="flex-1 h-4 bg-slate-700/50 rounded" />
                  <div className="w-24 h-4 bg-slate-700/40 rounded" />
                  <div className="w-20 h-4 bg-slate-700/50 rounded" />
                  <div className="w-12 h-4 bg-slate-700/40 rounded" />
                  <div className="w-16 h-6 bg-slate-700/50 rounded-lg" />
                  <div className="w-20 h-6 bg-slate-700/50 rounded-lg" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-6xl mb-4 opacity-20">📋</div>
              <p className="text-lg font-bold text-slate-400 mb-1">No Assessments Yet</p>
              <p className="text-sm text-slate-600">Click "Create Assessment" to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/20">
              {filtered.map(a => (
                <div
                  key={a.id}
                  className="group px-5 py-4 hover:bg-slate-800/30 transition-all"
                  style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 140px 150px', alignItems: 'center', gap: '12px' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{a.title}</p>
                    {a.description && <p className="text-xs text-slate-500 truncate mt-0.5">{a.description}</p>}
                  </div>
                  <div>
                    <span className="text-sm text-slate-300">
                      {a.targetUsers?.length || 0} {(a.targetUsers?.length || 0) === 1 ? 'employee' : 'employees'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400">
                      {a.assessmentDate
                        ? new Date(a.assessmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : a.createdAt
                        ? new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold border capitalize ${STATUS_COLORS[a.status] || STATUS_COLORS.pending}`}>
                      {a.status || 'assigned'}
                    </span>
                  </div>
                  <div>
                    {a.employeeAssignments?.some(ea => ea.status === 'submitted') ? (
                      <button
                        onClick={() => setViewReport(a)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-lg text-indigo-300 text-xs font-semibold transition-colors"
                      >
                        📄 View Report
                      </button>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </div>
                  <div>
                    {a.employeeAssignments?.some(ea => ea.status === 'submitted') ? (
                      <button
                        onClick={() => handleAutoAssignModule(a)}
                        disabled={assigningModuleId === a.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {assigningModuleId === a.id ? '⏳ Generating…' : '📦 Assign Module'}
                      </button>
                    ) : (
                      <button disabled className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/30 border border-slate-600/30 rounded-lg text-slate-600 text-xs font-semibold cursor-not-allowed">
                        📦 Assign Module
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-700/30 bg-slate-800/10 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{filtered.length}</span> of{' '}
                <span className="text-slate-400 font-semibold">{assessments.length}</span> assessments
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ===== CREATE ASSESSMENT MODAL ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#0F172A] z-10">
              <div>
                <h3 className="text-lg font-black text-white">Create Assessment</h3>
                <p className="text-xs text-slate-500 mt-0.5">Assign unique AI-generated assessments to employees</p>
              </div>
              <button onClick={closeModal} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-0 px-6 pt-5 pb-4">
              {[
                { num: 1, label: 'Select Target' },
                { num: 2, label: 'Settings' },
                { num: 3, label: 'Review' },
              ].map((s, i) => (
                <React.Fragment key={s.num}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black border transition-all ${
                      modal.step > s.num
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : modal.step === s.num
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}>
                      {modal.step > s.num ? '✓' : s.num}
                    </div>
                    <span className={`text-xs font-semibold transition-colors ${
                      modal.step === s.num ? 'text-white' : modal.step > s.num ? 'text-emerald-400' : 'text-slate-500'
                    }`}>{s.label}</span>
                  </div>
                  {i < 2 && <div className="flex-1 h-px bg-slate-700/60 mx-3" />}
                </React.Fragment>
              ))}
            </div>

            {/* ── STEP 1: Select Target ── */}
            {modal.step === 1 && (
              <div className="p-6 space-y-5 flex-1">
                {/* Target type radio */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block">Target</label>
                  <div className="flex gap-3">
                    {[
                      { value: 'individual', label: 'Individual Employees' },
                      { value: 'group', label: 'Group' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateModal({ targetType: opt.value, selectedUsers: [], selectedGroup: '' })}
                        className={`flex-1 py-2.5 px-4 rounded-xl border text-sm font-semibold transition-all ${
                          modal.targetType === opt.value
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                            : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Individual: employee list */}
                {modal.targetType === 'individual' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Select Employees
                      </label>
                      <span className="text-xs text-indigo-400 font-semibold">
                        {modal.selectedUsers.length} selected
                      </span>
                    </div>
                    {employees.length === 0 ? (
                      <div className="py-10 text-center text-slate-500 text-sm rounded-xl border border-slate-700/40 bg-slate-800/30">
                        No employees found
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {employees.map(emp => {
                          const id = emp.userId || emp.id || emp._id;
                          const checked = modal.selectedUsers.includes(id);
                          const hasJD = !!(emp.jobDescription || emp.jobDescriptionFile || emp.jdUrl || emp.hasJD);
                          return (
                            <div
                              key={id}
                              onClick={() => toggleEmployee(id)}
                              className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                                checked
                                  ? 'bg-indigo-600/10 border-indigo-500/40'
                                  : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {}}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 accent-indigo-500 pointer-events-none"
                              />
                              <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                                {(emp.name || emp.email || '?')[0].toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{emp.name || '—'}</p>
                                <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {emp.jobRole && (
                                  <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-700/60 border border-slate-600/50 text-slate-300 truncate max-w-[120px]">
                                    {emp.jobRole}
                                  </span>
                                )}
                                <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${
                                  hasJD
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                    : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                                }`}>
                                  {hasJD ? '✓ JD' : '⚠ No JD'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Group: dropdown */}
                {modal.targetType === 'group' && (
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Select Group</label>
                    {groups.length === 0 ? (
                      <div className="py-8 text-center text-slate-500 text-sm rounded-xl border border-slate-700/40 bg-slate-800/30">
                        No groups found. Create groups in the Groups section.
                      </div>
                    ) : (
                      <select
                        value={modal.selectedGroup}
                        onChange={e => updateModal({ selectedGroup: e.target.value })}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">— Select a group —</option>
                        {groups.map(g => (
                          <option key={g.id || g._id} value={g.id || g._id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => updateModal({ step: 2 })}
                    disabled={!canProceedStep1()}
                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next: Settings →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Assessment Settings ── */}
            {modal.step === 2 && (
              <div className="p-6 space-y-5 flex-1">
                {/* Assessment Date */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Assessment Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={modal.assessmentDate}
                    onChange={e => handleDateChange(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Title <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={modal.title}
                    onChange={e => updateModal({ title: e.target.value })}
                    placeholder="e.g. Assessment - 2024-06-15"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Question Count */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Question Count: <span className="text-indigo-400">{modal.questionCount}</span>
                    <span className="text-slate-600 font-normal ml-1">(5–30)</span>
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={modal.questionCount}
                    onChange={e => updateModal({ questionCount: Math.min(30, Math.max(5, parseInt(e.target.value) || 5)) })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Question Types */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Question Types</label>
                  <div className="flex flex-wrap gap-2">
                    {QUESTION_TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleQuestionType(opt.value)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-semibold transition-all ${
                          modal.questionTypes.includes(opt.value)
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                          modal.questionTypes.includes(opt.value)
                            ? 'bg-indigo-500 border-indigo-400'
                            : 'border-slate-600'
                        }`}>
                          {modal.questionTypes.includes(opt.value) && <span className="text-white text-[8px] font-black">✓</span>}
                        </span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Duration (minutes)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={modal.duration}
                    onChange={e => updateModal({ duration: Math.max(5, parseInt(e.target.value) || 30) })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Deadline */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Deadline <span className="text-slate-600 font-normal normal-case">(date + time)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={modal.deadline || ''}
                    onChange={e => updateModal({ deadline: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <p className="text-slate-600 text-xs mt-1">Employee cannot submit after this time</p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => updateModal({ step: 1 })}
                    className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white transition-all"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => updateModal({ step: 3 })}
                    disabled={!canProceedStep2()}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next: Review →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Review & Create ── */}
            {modal.step === 3 && (
              <div className="p-6 flex-1">
                {/* Summary Card */}
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 mb-5">
                  <h4 className="text-sm font-black text-white mb-3">Assessment Summary</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="text-white font-semibold truncate max-w-[140px] text-right">{modal.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Date</span>
                      <span className="text-white font-semibold">{modal.assessmentDate || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Employees</span>
                      <span className="text-indigo-300 font-bold">{modal.targetType === 'individual' ? modal.selectedUsers.length : 'Group'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Questions each</span>
                      <span className="text-white font-semibold">{modal.questionCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Duration</span>
                      <span className="text-white font-semibold">{modal.duration} min</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Question types</span>
                      <span className="text-white font-semibold">{modal.questionTypes.join(', ')}</span>
                    </div>
                  </div>
                </div>

                {/* Per-employee list */}
                {modal.targetType === 'individual' && selectedEmployeeObjects.length > 0 && (
                  <div className="mb-5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                      Selected Employees ({selectedEmployeeObjects.length})
                    </label>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {selectedEmployeeObjects.map(emp => {
                        const id = emp.userId || emp.id || emp._id;
                        const hasJD = !!(emp.jobDescription || emp.jobDescriptionFile || emp.jdUrl || emp.hasJD);
                        return (
                          <div key={id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                            hasJD ? 'bg-slate-800/30 border-slate-700/50' : 'bg-amber-500/5 border-amber-500/20'
                          }`}>
                            <div className="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                              {(emp.name || emp.email || '?')[0].toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{emp.name || '—'}</p>
                              {emp.jobRole && <p className="text-xs text-slate-500">{emp.jobRole}</p>}
                            </div>
                            {!hasJD ? (
                              <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 flex-shrink-0">
                                ⚠ No JD — using job role
                              </span>
                            ) : (
                              <span className="text-xs text-slate-500 italic flex-shrink-0">Will get unique questions from their JD</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Generating state */}
                {creating && (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 mb-4">
                    <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="text-sm text-indigo-300 font-semibold">
                      Generating unique questions for each employee…
                    </span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => updateModal({ step: 2 })}
                    disabled={creating}
                    className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white transition-all disabled:opacity-40"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold text-white transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                  >
                    {creating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating…
                      </>
                    ) : (
                      'Generate & Assign →'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== REPORT PREVIEW MODAL ===== */}
      {viewReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setViewReport(null)}
        >
          <div
            className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-[#0F172A]">
              <div>
                <h3 className="text-lg font-black text-white">{viewReport.title} — Report</h3>
                <p className="text-xs text-slate-500 mt-0.5">Submitted employee results</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/40 text-xs font-bold transition-colors"
                >
                  🖨 Download PDF
                </button>
                <button onClick={() => setViewReport(null)} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
              </div>
            </div>
            <div className="p-6 space-y-3">
              {(viewReport.employeeAssignments?.filter(ea => ea.status === 'submitted') || []).length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-10">No submitted results yet.</p>
              ) : (
                viewReport.employeeAssignments
                  .filter(ea => ea.status === 'submitted')
                  .map((ea, i) => {
                    const score = ea.scoring?.score ?? ea.score;
                    const grade = ea.scoring?.grade ?? ea.grade;
                    const strengths = ea.scoring?.strengths || [];
                    const weakAreas = ea.scoring?.weakAreas || [];
                    const emp = employees.find(e => (e.userId || e.id || e._id) === ea.userId);
                    return (
                      <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-bold text-white">{emp?.name || ea.userId}</p>
                          <div className="flex items-center gap-2">
                            {score !== undefined && (
                              <span className="text-xs font-black text-emerald-300">{score}%</span>
                            )}
                            {grade && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">{grade}</span>
                            )}
                          </div>
                        </div>
                        {strengths.length > 0 && (
                          <p className="text-xs text-slate-400 mb-1">
                            <span className="text-emerald-400 font-semibold">Strengths: </span>
                            {strengths.join(', ')}
                          </p>
                        )}
                        {weakAreas.length > 0 && (
                          <p className="text-xs text-slate-400">
                            <span className="text-amber-400 font-semibold">Weak Areas: </span>
                            {weakAreas.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== DETAIL MODAL ===== */}
      {viewDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setViewDetail(null)}
        >
          <div
            className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-[#0F172A]">
              <div>
                <h3 className="text-lg font-black text-white">{viewDetail.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {viewDetail.targetUsers?.length || 0} employees ·{' '}
                  {viewDetail.questionCount || viewDetail.questions?.length || 0} questions ·{' '}
                  {viewDetail.duration ? `${viewDetail.duration} min` : ''}
                </p>
              </div>
              <button onClick={() => setViewDetail(null)} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
            </div>

            <div className="p-6">
              {/* Assessment details */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {[
                  { label: 'Assessment Date', value: viewDetail.assessmentDate ? new Date(viewDetail.assessmentDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
                  { label: 'Duration', value: viewDetail.duration ? `${viewDetail.duration} minutes` : '—' },
                  { label: 'Questions per Employee', value: viewDetail.questionCount || viewDetail.questions?.length || '—' },
                  { label: 'Question Types', value: viewDetail.questionTypes?.join(', ') || '—' },
                ].map((item, i) => (
                  <div key={i} className="rounded-xl bg-slate-800/40 border border-slate-700/40 px-4 py-3">
                    <p className="text-xs text-slate-500 mb-0.5">{item.label}</p>
                    <p className="text-sm font-bold text-white">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Per-employee assignment status */}
              {viewDetail.targetUsers && viewDetail.targetUsers.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Employee Assignments ({viewDetail.targetUsers.length})
                  </h4>
                  <div className="space-y-2">
                    {viewDetail.targetUsers.map((uid, i) => {
                      const emp = employees.find(e => (e.id || e._id) === uid);
                      const assignment = viewDetail.assignments?.find(a => a.userId === uid) || {};
                      return (
                        <div
                          key={uid}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/30 border border-slate-700/40"
                        >
                          <div className="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                            {emp ? (emp.name || emp.email || '?')[0].toUpperCase() : (i + 1)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{emp?.name || uid}</p>
                            {emp?.jobRole && <p className="text-xs text-slate-500">{emp.jobRole}</p>}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {assignment.score !== undefined && (
                              <span className="text-xs font-bold text-emerald-300">
                                Score: {assignment.score}%
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border capitalize ${
                              STATUS_COLORS[assignment.status || 'assigned']
                            }`}>
                              {assignment.status || 'assigned'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(!viewDetail.targetUsers || viewDetail.targetUsers.length === 0) && (
                <div className="py-10 text-center text-slate-500 text-sm">
                  No employee assignments found for this assessment.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
