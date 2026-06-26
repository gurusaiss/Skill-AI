import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { authFetch } from '../utils/authFetch.js';

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

const EXPORT_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

function ExportReportsModal({ assessment, token, onClose, showToast }) {
  const [format, setFormat] = React.useState('xlsx');
  const [mode, setMode] = React.useState('consolidated');
  const [exporting, setExporting] = React.useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ format, mode });
      if (format === 'zip') params.set('subformat', 'pdf');
      const res = await fetch(`${EXPORT_BASE_URL}/api/assessments/${assessment.id}/export-reports?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'zip' ? 'zip' : format;
      a.download = `${(assessment.title || 'Assessment').replace(/[^a-zA-Z0-9-_ ]/g,'_')}-Reports.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Export downloaded successfully', 'success');
      onClose();
    } catch (e) {
      showToast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const formatOptions = [
    { v: 'xlsx', l: 'Excel' },
    { v: 'pdf', l: 'PDF' },
    { v: 'docx', l: 'Word' },
    { v: 'zip', l: 'ZIP Bundle' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div>
            <h3 className="text-lg font-black text-white">Export Reports</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{assessment.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Format</label>
            <div className="grid grid-cols-4 gap-2">
              {formatOptions.map(({v,l}) => (
                <button key={v} onClick={() => setFormat(v)}
                  className={`py-2 rounded-xl border text-xs font-semibold transition-colors ${format===v ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {format !== 'zip' && (
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Mode</label>
              <div className="flex gap-2">
                {[{v:'consolidated',l:'Consolidated'},{v:'individual',l:'Individual Sheets'}].map(({v,l}) => (
                  <button key={v} onClick={() => setMode(v)}
                    className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${mode===v ? 'bg-purple-600 border-purple-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {format === 'zip' && (
            <p className="text-xs text-slate-400 bg-slate-800/60 rounded-xl px-3 py-2">
              ZIP bundle: one PDF per employee, all in a single download.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Includes: Name, Email, ID, Job Role, Score, %, Grade, Classification, Status, Completion Date, Strengths, Improvement Areas, Recommendations.
          </p>
          <button onClick={handleExport} disabled={exporting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-sm font-bold text-white disabled:opacity-40 transition-all">
            {exporting ? 'Exporting…' : `⬇ Download ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  assigned: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  submitted: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  pending: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

const ASSESSMENT_TYPES = [
  'Pre Assessment',
  'Skill Assessment',
  'Technical Assessment',
  'Functional Assessment',
  'Compliance Assessment',
  'Training Assessment',
  'Custom Assessment',
];

const DEFAULT_SETTINGS = {
  questionOrder: 'same',
  markingScheme: { easy: { correct: 1, wrong: 0 }, medium: { correct: 2, wrong: 0 }, hard: { correct: 3, wrong: 0 } },
  passPercentage: 80,
  reattempts: 0,
  allowReattemptToBeatScore: false,
  timing: { type: 'timed', totalMinutes: 30 },
  navigation: { forwardOnly: false },
  results: { hideFromParticipants: false, revealOnSubmission: false, revealAfterEachQuestion: false, revealCorrectOption: false },
  completion: { mandatory: false, markCompleteOnlyIfPassed: false, allowSubmitWithoutAnsweringAll: false },
};

const EMPTY_MODAL = {
  step: 1,
  targetType: 'individual',
  selectedUsers: [],
  selectedGroup: '',
  department: '',
  questionCount: 10,
  questionTypes: ['mcq'],
  difficulty: '',
  easyPct: 34,
  mediumPct: 33,
  hardPct: 33,
  assessmentDate: '',
  duration: 30,
  deadline: '',
  title: '',
  assessmentType: 'Skill Assessment',
  settings: { ...DEFAULT_SETTINGS },
};

export default function AssessmentManagement() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

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
  const [showManualModal, setShowManualModal] = useState(false);
  const [creating, setCreating] = useState(false);

  // Detail view
  const [viewDetail, setViewDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [viewReport, setViewReport] = useState(null);
  const [assigningModuleId, setAssigningModuleId] = useState(null);

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Question editor modal
  const [qEditTarget, setQEditTarget] = useState(null); // the assessment being edited
  const [qEmpIdx, setQEmpIdx] = useState(0);            // which employeeAssignment index
  const [qDraft, setQDraft] = useState([]);             // editable questions array
  const [qSaving, setQSaving] = useState(false);

  // Export reports modal
  const [exportTarget, setExportTarget] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [showExportFormatModal, setShowExportFormatModal] = useState(false);

  const showToast = useCallback((message, type = 'info') => setToast({ message, type }), []);

  const downloadAllReports = async (format = 'xlsx') => {
    setDownloadingAll(true);
    setShowExportFormatModal(false);
    try {
      const token = localStorage.getItem('auth_token');
      const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
      const res = await fetch(`${BASE}/api/assessments/export-all-reports?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'pdf' ? 'pdf' : format === 'doc' ? 'docx' : 'xlsx';
      a.download = `All-Assessment-Reports.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('All reports downloaded', 'success');
    } catch (e) {
      showToast(e.message || 'Export failed', 'error');
    } finally {
      setDownloadingAll(false);
    }
  };

  useEffect(() => {
    if (!user || !hasRole(['admin', 'manager'])) {
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
        setGroups(Array.isArray(v) ? v : (v?.groups || []));
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
    if (modal.targetType === 'group') return !!modal.selectedGroup;
    if (modal.targetType === 'all') return true;
    if (modal.targetType === 'department') return !!modal.department.trim();
    return false;
  };

  const canProceedStep2 = () => {
    return modal.assessmentDate && modal.questionCount >= 1 && modal.title.trim();
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
        targetType: modal.targetType,
        questionCount: modal.questionCount,
        questionTypes: modal.questionTypes,
        difficulty: modal.difficulty || undefined,
        easyPct: modal.easyPct,
        mediumPct: modal.mediumPct,
        hardPct: modal.hardPct,
        assessmentDate: modal.assessmentDate,
        duration: modal.duration,
        deadline: modal.deadline,
        assessmentType: modal.assessmentType || 'Skill Assessment',
        settings: modal.settings || DEFAULT_SETTINGS,
        ...(modal.targetType === 'group' && modal.selectedGroup ? { targetGroup: modal.selectedGroup } : {}),
        ...(modal.targetType === 'department' ? { department: modal.department } : {}),
      };

      const saved = await authFetch('/api/assessments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!saved) throw new Error('Assessment creation failed — no record returned');
      await loadAll();
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

  const openEdit = (a) => {
    setEditTarget(a);
    setEditForm({
      title: a.title || '',
      assessmentDate: a.assessmentDate ? a.assessmentDate.split('T')[0] : '',
      duration: a.duration || 30,
      deadline: a.deadline ? a.deadline.replace('Z', '') : '',
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSaving(true);
    try {
      await authFetch(`/api/assessments/${editTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      setAssessments(prev => prev.map(a => a.id === editTarget.id ? { ...a, ...editForm } : a));
      showToast('Assessment updated', 'success');
      setEditTarget(null);
    } catch (e) {
      showToast(e.message || 'Failed to update', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Question editor ──────────────────────────────────────────────────────
  const openQuestions = (a) => {
    setQEditTarget(a);
    const idx = (a.employeeAssignments || []).findIndex(ea => Array.isArray(ea.questions) && ea.questions.length > 0);
    const safeIdx = idx >= 0 ? idx : 0;
    setQEmpIdx(safeIdx);
    const qs = a.employeeAssignments?.[safeIdx]?.questions || [];
    setQDraft(JSON.parse(JSON.stringify(qs)));
  };

  const selectQEmployee = (idx) => {
    setQEmpIdx(idx);
    const qs = qEditTarget?.employeeAssignments?.[idx]?.questions || [];
    setQDraft(JSON.parse(JSON.stringify(qs)));
  };

  const updateQuestion = (qi, field, value) => {
    setQDraft(prev => prev.map((q, i) => i === qi ? { ...q, [field]: value } : q));
  };

  const updateQuestionOption = (qi, oi, value) => {
    setQDraft(prev => prev.map((q, i) => {
      if (i !== qi) return q;
      const options = [...(q.options || [])];
      options[oi] = value;
      return { ...q, options };
    }));
  };

  const addQuestion = () => {
    setQDraft(prev => [...prev, {
      type: 'mcq',
      question: '',
      difficulty: 'medium',
      options: ['A) ', 'B) ', 'C) ', 'D) '],
      answer: 'A',
      explanation: '',
      skillArea: '',
    }]);
  };

  const removeQuestion = (qi) => {
    setQDraft(prev => prev.filter((_, i) => i !== qi));
  };

  const saveQuestions = async () => {
    if (!qEditTarget) return;
    setQSaving(true);
    try {
      const newAssignments = (qEditTarget.employeeAssignments || []).map((ea, i) =>
        i === qEmpIdx ? { ...ea, questions: qDraft } : ea
      );
      await authFetch(`/api/assessments/${qEditTarget.id}`, {
        method: 'PUT',
        body: JSON.stringify({ employeeAssignments: newAssignments, questionCount: qDraft.length }),
      });
      setAssessments(prev => prev.map(a => a.id === qEditTarget.id
        ? { ...a, employeeAssignments: newAssignments, questionCount: qDraft.length }
        : a));
      showToast('Questions updated', 'success');
      setQEditTarget(null);
    } catch (e) {
      showToast(e.message || 'Failed to save questions', 'error');
    } finally {
      setQSaving(false);
    }
  };

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
          <div className="flex gap-3">
            <button
              onClick={() => setShowExportFormatModal(true)}
              disabled={downloadingAll}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-sm font-bold transition-all shadow-lg shadow-teal-500/20 disabled:opacity-40"
            >
              {downloadingAll ? 'Downloading…' : 'Download All Reports'}
            </button>
            <button
              onClick={() => setShowManualModal(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm font-bold transition-all shadow-lg shadow-emerald-500/20"
            >
              ✏ Manual Assessment
            </button>
            <button
              onClick={openModal}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all shadow-lg shadow-indigo-500/20"
            >
              + AI Assessment
            </button>
          </div>
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
            style={{ gridTemplateColumns: '3fr 1.5fr 0.8fr 0.8fr 0.8fr 0.9fr 160px' }}
          >
            {['Assessment Title', 'Type / Role', 'Assigned', 'Completed', 'Pending', 'Avg Score', 'Actions'].map(h => (
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
              {filtered.map(a => {
                const empAssignments = a.employeeAssignments || [];
                const submittedCount = empAssignments.filter(ea => ea.status === 'submitted').length;
                const totalAssigned = empAssignments.length || a.targetUsers?.length || 0;
                const pendingCount = totalAssigned - submittedCount;
                const passThreshold = a.settings?.passPercentage ?? 80;
                const scores = empAssignments.filter(ea => ea.status === 'submitted').map(ea => ea.score ?? ea.percentage ?? 0).filter(s => s > 0);
                const avgScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
                // Determine primary job role for this assessment
                const jobRoles = [...new Set(empAssignments.map(ea => ea.jobRole).filter(Boolean))];
                return (
                <div
                  key={a.id}
                  className="group px-5 py-4 hover:bg-slate-800/30 transition-all"
                  style={{ display: 'grid', gridTemplateColumns: '3fr 1.5fr 0.8fr 0.8fr 0.8fr 0.9fr 160px', alignItems: 'center', gap: '12px' }}
                >
                  {/* Title */}
                  <div className="min-w-0">
                    <button
                      onClick={() => { setViewDetail(a); setDetailTab('overview'); }}
                      className="text-sm font-bold text-white hover:text-indigo-300 transition-colors text-left block truncate max-w-full"
                    >
                      {a.title}
                    </button>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.questionCount ? `${a.questionCount} Qs` : ''}
                      {a.duration ? ` · ${a.duration} min` : ''}
                      {a.assessmentDate ? ` · ${new Date(a.assessmentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}` : ''}
                    </p>
                  </div>
                  {/* Type / Role */}
                  <div className="min-w-0">
                    {a.assessmentType && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25 whitespace-nowrap block w-fit mb-0.5">{a.assessmentType}</span>}
                    {jobRoles.length > 0 && <span className="text-[10px] text-slate-500 truncate block">{jobRoles.slice(0,2).join(', ')}{jobRoles.length>2?` +${jobRoles.length-2}`:''}</span>}
                  </div>
                  {/* Assigned */}
                  <div><span className="text-sm font-black text-indigo-300">{totalAssigned}</span></div>
                  {/* Completed */}
                  <div><span className="text-sm font-black text-emerald-300">{submittedCount}</span></div>
                  {/* Pending */}
                  <div><span className={`text-sm font-black ${pendingCount > 0 ? 'text-amber-300' : 'text-slate-500'}`}>{pendingCount}</span></div>
                  {/* Avg Score */}
                  <div>
                    {avgScore !== null
                      ? <span className={`text-sm font-black ${avgScore >= passThreshold ? 'text-emerald-300' : 'text-red-300'}`}>{avgScore}%</span>
                      : <span className="text-xs text-slate-600">—</span>}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setViewDetail(a); setDetailTab('overview'); }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 rounded-lg text-indigo-300 text-xs font-semibold transition-colors"
                      title="View Assessment Details"
                    >
                      View
                    </button>
                    <button
                      onClick={() => openEdit(a)}
                      className="px-2.5 py-1.5 bg-slate-700/60 hover:bg-slate-700 border border-slate-600/40 rounded-lg text-slate-300 text-xs font-semibold transition-colors"
                      title="Edit"
                    >✏️</button>
                    <button
                      onClick={() => deleteAssessment(a.id)}
                      className="px-2.5 py-1.5 bg-slate-700/60 hover:bg-red-900/40 border border-slate-600/40 hover:border-red-500/30 rounded-lg text-slate-400 hover:text-red-400 text-xs font-semibold transition-colors"
                      title="Delete"
                    >🗑️</button>
                  </div>
                </div>
                );
              })}
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
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'individual', label: 'Individual Employees', icon: '👤' },
                      { value: 'group', label: 'By Group', icon: '👥' },
                      { value: 'department', label: 'By Department', icon: '🏢' },
                      { value: 'all', label: 'All Employees', icon: '🌐' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => updateModal({ targetType: opt.value, selectedUsers: [], selectedGroup: '', department: '' })}
                        className={`py-2.5 px-3 rounded-xl border text-xs font-semibold transition-all flex items-center gap-2 ${
                          modal.targetType === opt.value
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                            : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span>{opt.icon}</span>{opt.label}
                      </button>
                    ))}
                  </div>
                  {modal.targetType === 'all' && (
                    <div className="mt-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                      Assessment will be assigned to <strong>all active employees</strong> in your company.
                    </div>
                  )}
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

                {/* Department: text input */}
                {modal.targetType === 'department' && (
                  <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Department Name</label>
                    <input
                      type="text"
                      value={modal.department}
                      onChange={e => updateModal({ department: e.target.value })}
                      placeholder="e.g. Engineering, Marketing, HR"
                      className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500 mt-1">All employees with this department will be assigned</p>
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
                {/* Assessment Type */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Assessment Type</label>
                  <select
                    value={modal.assessmentType}
                    onChange={e => updateModal({ assessmentType: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

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
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={modal.questionCount}
                    onChange={e => updateModal({ questionCount: Math.max(1, parseInt(e.target.value) || 1) })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <p className="text-xs text-slate-500 mt-1">Questions pulled from role's approved question bank. If fewer questions available, all available questions will be used.</p>
                </div>

                {/* Difficulty Distribution */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Difficulty Distribution <span className="text-slate-600 font-normal normal-case">(% each — used when pulling from question bank)</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: 'easyPct', label: 'Easy %', color: 'text-emerald-400' },
                      { key: 'mediumPct', label: 'Medium %', color: 'text-amber-400' },
                      { key: 'hardPct', label: 'Hard %', color: 'text-red-400' },
                    ].map(({ key, label, color }) => (
                      <div key={key}>
                        <label className={`text-xs font-semibold ${color} mb-1 block`}>{label}</label>
                        <input
                          type="number" min={0} max={100}
                          value={modal[key]}
                          onChange={e => updateModal({ [key]: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                          className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    With {modal.questionCount} questions: ~{Math.round(modal.questionCount * modal.easyPct / 100)} easy,
                    ~{Math.round(modal.questionCount * modal.mediumPct / 100)} medium,
                    ~{modal.questionCount - Math.round(modal.questionCount * modal.easyPct / 100) - Math.round(modal.questionCount * modal.mediumPct / 100)} hard
                  </p>
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

                {/* Difficulty Filter */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Difficulty Filter <span className="text-slate-600 font-normal normal-case">(pulls from role's question bank)</span>
                  </label>
                  <select
                    value={modal.difficulty || ''}
                    onChange={e => updateModal({ difficulty: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">No filter — AI generates fresh questions</option>
                    <option value="easy">Easy — pulls easy questions from role bank</option>
                    <option value="medium">Medium — pulls medium questions from role bank</option>
                    <option value="hard">Hard — pulls hard questions from role bank</option>
                  </select>
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

                {/* Advanced Settings (collapsible) */}
                <AssessmentSettingsPanel
                  settings={modal.settings || DEFAULT_SETTINGS}
                  onChange={s => updateModal({ settings: s })}
                />

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

      {/* ===== EDIT ASSESSMENT MODAL ===== */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setEditTarget(null)}>
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <h3 className="text-lg font-black text-white">Edit Assessment</h3>
              <button onClick={() => setEditTarget(null)} className="text-slate-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Assessment Date</label>
                <input
                  type="date"
                  value={editForm.assessmentDate}
                  onChange={e => setEditForm(f => ({ ...f, assessmentDate: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Duration (minutes)</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={editForm.duration}
                  onChange={e => setEditForm(f => ({ ...f, duration: parseInt(e.target.value) || 30 }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Deadline</label>
                <input
                  type="datetime-local"
                  value={editForm.deadline}
                  onChange={e => setEditForm(f => ({ ...f, deadline: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white transition-all">Cancel</button>
                <button
                  onClick={saveEdit}
                  disabled={saving || !editForm.title.trim()}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : '✓ Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== QUESTION EDITOR MODAL ===== */}
      {qEditTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setQEditTarget(null)}>
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-[#0F172A] z-10">
              <div>
                <h3 className="text-lg font-black text-white">Edit Questions</h3>
                <p className="text-xs text-slate-500 mt-0.5">{qEditTarget.title} · {qDraft.length} question{qDraft.length === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => setQEditTarget(null)} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
            </div>

            {/* Employee selector (questions are per-employee) */}
            {(qEditTarget.employeeAssignments?.length || 0) > 1 && (
              <div className="px-6 pt-4">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Employee (questions are unique per employee)</label>
                <select
                  value={qEmpIdx}
                  onChange={e => selectQEmployee(parseInt(e.target.value))}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                >
                  {qEditTarget.employeeAssignments.map((ea, i) => (
                    <option key={i} value={i}>
                      {(ea.userName || ea.userId)}{ea.jobRole ? ` — ${ea.jobRole}` : ''}{ea.status === 'submitted' ? ' (submitted)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {qEditTarget.employeeAssignments?.[qEmpIdx]?.status === 'submitted' && (
              <div className="mx-6 mt-4 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                ⚠ This employee already submitted. Editing questions will not change their existing score.
              </div>
            )}

            {/* Question list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {qDraft.length === 0 ? (
                <div className="py-10 text-center text-slate-500 text-sm">No questions for this employee. Add one below.</div>
              ) : qDraft.map((q, qi) => (
                <div key={qi} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-indigo-300">Q{qi + 1}</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={q.type || 'mcq'}
                        onChange={e => updateQuestion(qi, 'type', e.target.value)}
                        className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs focus:border-indigo-500 focus:outline-none"
                      >
                        {QUESTION_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select
                        value={q.difficulty || 'medium'}
                        onChange={e => updateQuestion(qi, 'difficulty', e.target.value)}
                        className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                      </select>
                      <button
                        onClick={() => removeQuestion(qi)}
                        className="px-2 py-1 rounded-lg bg-slate-700/60 hover:bg-red-900/40 border border-slate-600/40 hover:border-red-500/30 text-slate-400 hover:text-red-400 text-xs transition-colors"
                        title="Remove question"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Question text */}
                  <textarea
                    value={q.question || ''}
                    onChange={e => updateQuestion(qi, 'question', e.target.value)}
                    placeholder="Question text"
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-y"
                  />

                  {/* Options (mcq only) */}
                  {q.type === 'mcq' && (
                    <div className="space-y-1.5">
                      {(q.options || []).map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 w-4 flex-shrink-0">{String.fromCharCode(65 + oi)}</span>
                          <input
                            type="text"
                            value={opt}
                            onChange={e => updateQuestionOption(qi, oi, e.target.value)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Answer + explanation */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1 block">Answer</label>
                      <input
                        type="text"
                        value={q.answer || ''}
                        onChange={e => updateQuestion(qi, 'answer', e.target.value)}
                        placeholder={q.type === 'mcq' ? 'A / B / C / D' : 'Model answer'}
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1 block">Skill Area</label>
                      <input
                        type="text"
                        value={q.skillArea || ''}
                        onChange={e => updateQuestion(qi, 'skillArea', e.target.value)}
                        placeholder="Skill / competency tested"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">Explanation</label>
                    <input
                      type="text"
                      value={q.explanation || ''}
                      onChange={e => updateQuestion(qi, 'explanation', e.target.value)}
                      placeholder="Why this question matters"
                      className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
              ))}

              <button
                onClick={addQuestion}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-indigo-500/50 text-sm font-semibold transition-colors"
              >
                + Add Question
              </button>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-slate-700 bg-[#0F172A]">
              <button onClick={() => setQEditTarget(null)} className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white transition-all">Cancel</button>
              <button
                onClick={saveQuestions}
                disabled={qSaving}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {qSaving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : '✓ Save Questions'}
              </button>
            </div>
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
                  onClick={async () => {
                    const tok = localStorage.getItem('auth_token');
                    try {
                      const res = await fetch(`${EXPORT_BASE_URL}/api/assessments/${viewReport.id}/export-reports?format=pdf&mode=consolidated`, {
                        headers: { Authorization: `Bearer ${tok}` },
                      });
                      if (!res.ok) throw new Error('Export failed');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${(viewReport.title || 'Assessment').replace(/[^a-zA-Z0-9-_ ]/g,'_')}-Reports.pdf`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      alert('PDF download failed: ' + e.message);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/40 text-xs font-bold transition-colors"
                >
                  ⬇ Download PDF
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
                    const sc = ea.scoring || {};
                    const score = sc.score ?? ea.score;
                    const grade = sc.grade ?? ea.grade;
                    const strengths = sc.strengths || [];
                    const weakAreas = sc.weakAreas || [];
                    const missing = sc.missingCompetencies || [];
                    const recommended = sc.recommendedLearningAreas || [];
                    const classification = sc.performanceClassification;
                    const readiness = sc.readinessLevel;
                    const skillBreakdown = sc.skillBreakdown || [];
                    const emp = employees.find(e => (e.userId || e.id || e._id) === ea.userId);
                    return (
                      <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/30 px-5 py-4 space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-white">{emp?.name || ea.userName || ea.userId}</p>
                            {ea.jobRole && <p className="text-xs text-slate-500">{ea.jobRole}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            {score !== undefined && (
                              <span className="text-lg font-black" style={{ color: classification?.color || '#10B981' }}>{score}%</span>
                            )}
                            {grade && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-indigo-500/15 border border-indigo-500/30 text-indigo-300">Grade {grade}</span>
                            )}
                          </div>
                        </div>

                        {/* Performance Classification */}
                        {classification && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: classification.color + '40', backgroundColor: classification.color + '15' }}>
                            <span className="text-xs font-black" style={{ color: classification.color }}>{classification.label}</span>
                            {readiness && <span className="text-xs text-slate-400 ml-auto">{readiness}</span>}
                          </div>
                        )}

                        {/* Skill breakdown */}
                        {skillBreakdown.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skill Scores</p>
                            {skillBreakdown.map((sb, si) => (
                              <div key={si} className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 w-28 truncate flex-shrink-0">{sb.skill}</span>
                                <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${sb.pct}%`, backgroundColor: sb.pct >= 70 ? '#10B981' : sb.pct >= 40 ? '#F59E0B' : '#EF4444' }} />
                                </div>
                                <span className="text-xs font-bold w-9 text-right" style={{ color: sb.pct >= 70 ? '#10B981' : sb.pct >= 40 ? '#F59E0B' : '#EF4444' }}>{sb.pct}%</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Strengths & Weak Areas */}
                        <div className="grid grid-cols-2 gap-2">
                          {strengths.length > 0 && (
                            <div>
                              <p className="text-xs font-bold text-emerald-400 mb-1">Strengths</p>
                              <div className="flex flex-wrap gap-1">{strengths.map((s, si) => <span key={si} className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{s}</span>)}</div>
                            </div>
                          )}
                          {weakAreas.length > 0 && (
                            <div>
                              <p className="text-xs font-bold text-amber-400 mb-1">Weak Areas</p>
                              <div className="flex flex-wrap gap-1">{weakAreas.map((w, wi) => <span key={wi} className="text-xs px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300">{w}</span>)}</div>
                            </div>
                          )}
                        </div>

                        {/* Missing Competencies */}
                        {missing.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-red-400 mb-1">Missing Competencies</p>
                            <div className="flex flex-wrap gap-1">{missing.map((m, mi) => <span key={mi} className="text-xs px-2 py-0.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-300">{m}</span>)}</div>
                          </div>
                        )}

                        {/* Recommended Learning */}
                        {recommended.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-indigo-400 mb-1">Recommended Learning Areas</p>
                            <div className="flex flex-wrap gap-1">{recommended.map((r, ri) => <span key={ri} className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">{r}</span>)}</div>
                          </div>
                        )}

                        {/* Auto-module notice */}
                        {weakAreas.length > 0 && (
                          <p className="text-xs text-slate-500 border-t border-slate-700/40 pt-2">
                            Training module auto-generated and assigned based on weak areas.
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

      {/* ===== ASSESSMENT DETAIL FULL-SCREEN PAGE ===== */}
      {viewDetail && (() => {
        const empAssignments = viewDetail.employeeAssignments || [];
        const submitted = empAssignments.filter(ea => ea.status === 'submitted');
        const passThreshold = viewDetail.settings?.passPercentage ?? 80;
        const scores = submitted.map(ea => ea.score ?? ea.percentage ?? 0).filter(s => s > 0);
        const passCount = submitted.filter(ea => (ea.score ?? ea.percentage ?? 0) >= passThreshold).length;
        const failCount = submitted.length - passCount;
        const passRate = submitted.length ? Math.round(passCount / submitted.length * 100) : 0;
        const failRate = submitted.length ? Math.round(failCount / submitted.length * 100) : 0;
        const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        const highScore = scores.length ? Math.max(...scores) : 0;
        const lowScore = scores.length ? Math.min(...scores) : 0;
        const jobRoles = [...new Set(empAssignments.map(ea => ea.jobRole).filter(Boolean))];

        const doDetailExport = (fmt) => {
          const EXPORT_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
          const params = new URLSearchParams({ format: fmt, mode: 'consolidated' });
          if (fmt === 'zip') params.set('subformat', 'pdf');
          const token = localStorage.getItem('auth_token');
          fetch(`${EXPORT_BASE}/api/assessments/${viewDetail.id}/export-reports?${params}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => { if (!r.ok) throw new Error('Export failed'); return r.blob(); })
            .then(blob => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${(viewDetail.title || 'Assessment').replace(/[^a-zA-Z0-9-_ ]/g,'_')}-Reports.${fmt === 'zip' ? 'zip' : fmt}`;
              a.click(); URL.revokeObjectURL(url);
              showToast('Report downloaded', 'success');
            }).catch(e => showToast(e.message || 'Export failed', 'error'));
        };

        return (
          <div className="fixed inset-0 z-50 bg-[#0F172A] overflow-y-auto">
            {/* Top bar */}
            <div className="sticky top-0 z-10 bg-[#0F172A]/95 backdrop-blur border-b border-slate-700/60 px-6 py-3 flex items-center justify-between">
              <button onClick={() => setViewDetail(null)} className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-semibold transition-colors">
                ← Back to Assessments
              </button>
              <div className="flex items-center gap-2">
                {[['xlsx','📊 Excel'],['pdf','📄 PDF'],['docx','📝 Word']].map(([fmt,lbl]) => (
                  <button key={fmt} onClick={() => doDetailExport(fmt)}
                    className="px-3 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600/40 border border-teal-500/30 text-teal-300 text-xs font-bold transition-colors">
                    ⬇ {lbl}
                  </button>
                ))}
                <button onClick={() => doDetailExport('zip')}
                  className="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 text-xs font-bold transition-colors">
                  ⬇ ZIP Bundle
                </button>
              </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
              {/* Header */}
              <div>
                <div className="flex items-start gap-3 flex-wrap">
                  <h2 className="text-2xl font-black text-white">{viewDetail.title}</h2>
                  {viewDetail.assessmentType && (
                    <span className="px-2 py-1 rounded-lg text-xs font-bold bg-violet-500/15 text-violet-300 border border-violet-500/25 mt-0.5">{viewDetail.assessmentType}</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-400">
                  {jobRoles.length > 0 && <span>Job Role: <span className="text-white font-semibold">{jobRoles.join(', ')}</span></span>}
                  {viewDetail.createdAt && <span>Created: <span className="text-white font-semibold">{new Date(viewDetail.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}</span></span>}
                  {viewDetail.assessmentDate && <span>Assessment Date: <span className="text-white font-semibold">{new Date(viewDetail.assessmentDate).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}</span></span>}
                  {viewDetail.deadline && <span>Deadline: <span className="text-amber-300 font-semibold">{new Date(viewDetail.deadline).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}</span></span>}
                  {viewDetail.questionCount && <span>Questions: <span className="text-white font-semibold">{viewDetail.questionCount} per employee</span></span>}
                  {viewDetail.duration && <span>Duration: <span className="text-white font-semibold">{viewDetail.duration} min</span></span>}
                </div>
              </div>

              {/* Stats cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {[
                  { label: 'Total Assigned', value: empAssignments.length, color: 'text-indigo-300', bg: 'bg-indigo-500/5 border-indigo-500/25' },
                  { label: 'Completed', value: submitted.length, color: 'text-emerald-300', bg: 'bg-emerald-500/5 border-emerald-500/25' },
                  { label: 'Pending', value: empAssignments.length - submitted.length, color: 'text-amber-300', bg: 'bg-amber-500/5 border-amber-500/25' },
                  { label: 'Avg Score', value: scores.length ? `${avgScore}%` : '—', color: 'text-cyan-300', bg: 'bg-cyan-500/5 border-cyan-500/25' },
                  { label: 'Pass %', value: submitted.length ? `${passRate}%` : '—', color: 'text-teal-300', bg: 'bg-teal-500/5 border-teal-500/25' },
                  { label: 'Fail %', value: submitted.length ? `${failRate}%` : '—', color: 'text-red-300', bg: 'bg-red-500/5 border-red-500/25' },
                  { label: 'Pass Threshold', value: `${passThreshold}%`, color: 'text-slate-300', bg: 'bg-slate-500/5 border-slate-500/25' },
                ].map((m, i) => (
                  <div key={i} className={`rounded-xl border ${m.bg} px-4 py-3 text-center`}>
                    <p className={`text-xl font-black ${m.color}`}>{m.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{m.label}</p>
                  </div>
                ))}
              </div>

              {/* Analytics row */}
              {scores.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[['Highest Score', `${highScore}%`, 'text-emerald-300'],['Average Score', `${avgScore}%`, 'text-indigo-300'],['Lowest Score', `${lowScore}%`, 'text-red-300']].map(([l,v,c], i) => (
                    <div key={i} className="rounded-xl bg-slate-800/40 border border-slate-700/40 px-4 py-4 text-center">
                      <p className={`text-2xl font-black ${c}`}>{v}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{l}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Employee Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Employees Assigned to this Assessment
                    <span className="ml-2 px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs font-bold">{empAssignments.length}</span>
                  </h3>
                </div>
                <div className="rounded-2xl border border-slate-700/40 overflow-hidden">
                  {/* Table header */}
                  <div className="hidden lg:grid px-4 py-3 bg-slate-800/50 border-b border-slate-700/40 text-xs font-bold text-slate-500 uppercase tracking-wider"
                    style={{ gridTemplateColumns: '1.8fr 1fr 1.5fr 1fr 1fr 0.8fr 0.8fr 0.7fr 0.7fr 1fr 1.2fr' }}>
                    {['Name','Emp ID','Email','Group','Manager','Status','Score','%','Grade','Duration','Download'].map(h => (
                      <span key={h}>{h}</span>
                    ))}
                  </div>
                  {empAssignments.length === 0 ? (
                    <div className="py-12 text-center text-slate-500">No employees assigned to this assessment.</div>
                  ) : (
                    <div className="divide-y divide-slate-700/20">
                      {empAssignments.map((ea, i) => {
                        const emp = employees.find(e => e.userId === ea.userId);
                        const group = groups.find(g => (g.employeeIds || []).includes(ea.userId));
                        const managerEmp = group ? employees.find(e => e.userId === group.managerId) : (emp?.managerId ? employees.find(e => e.userId === emp.managerId) : null);
                        const sc = ea.scoring || {};
                        const scorePct = ea.score ?? ea.percentage ?? sc.score ?? null;
                        const grade = ea.grade ?? sc.grade ?? null;
                        const completionMs = ea.startedAt && ea.submittedAt ? new Date(ea.submittedAt) - new Date(ea.startedAt) : null;
                        const durationStr = completionMs ? `${Math.round(completionMs / 60000)} min` : (viewDetail.duration ? `${viewDetail.duration} min` : '—');
                        return (
                          <div key={i} className="px-4 py-3 hover:bg-slate-800/20 transition-colors"
                            style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1.5fr 1fr 1fr 0.8fr 0.8fr 0.7fr 0.7fr 1fr 1.2fr', alignItems: 'center', gap: '8px' }}>
                            {/* Name */}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{ea.userName || emp?.name || ea.userId}</p>
                              {ea.jobRole && <p className="text-xs text-slate-500 truncate">{ea.jobRole}</p>}
                            </div>
                            {/* Emp ID */}
                            <span className="text-xs text-slate-400 truncate">{emp?.employeeId || ea.userId?.slice(-8) || '—'}</span>
                            {/* Email */}
                            <span className="text-xs text-slate-400 truncate">{ea.userEmail || emp?.email || '—'}</span>
                            {/* Group */}
                            <span className="text-xs text-slate-400 truncate">{group?.name || '—'}</span>
                            {/* Manager */}
                            <span className="text-xs text-slate-400 truncate">{managerEmp?.name || '—'}</span>
                            {/* Status */}
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border capitalize w-fit ${STATUS_COLORS[ea.status || 'assigned']}`}>{ea.status || 'assigned'}</span>
                            {/* Score */}
                            <span className="text-xs font-bold text-white">
                              {ea.status === 'submitted' && sc.correct != null ? `${sc.correct}/${sc.total ?? ea.questions?.length ?? 0}` : '—'}
                            </span>
                            {/* % */}
                            <span className={`text-xs font-bold ${scorePct != null ? (scorePct >= passThreshold ? 'text-emerald-300' : 'text-red-300') : 'text-slate-500'}`}>
                              {scorePct != null ? `${scorePct}%` : '—'}
                            </span>
                            {/* Grade */}
                            <span className="text-xs font-bold text-white">{grade || '—'}</span>
                            {/* Duration */}
                            <span className="text-xs text-slate-400">{durationStr}</span>
                            {/* Download */}
                            <div className="flex gap-1">
                              {ea.status === 'submitted' ? (
                                [['pdf','PDF'],['xlsx','XLS'],['docx','DOC']].map(([fmt,lbl]) => (
                                  <button key={fmt} onClick={() => {
                                    const EXPORT_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
                                    const token = localStorage.getItem('auth_token');
                                    fetch(`${EXPORT_BASE}/api/assessments/${viewDetail.id}/export-reports?format=${fmt}&mode=individual&userId=${ea.userId}`, { headers: { Authorization: `Bearer ${token}` } })
                                      .then(r => { if (!r.ok) throw new Error('Export failed'); return r.blob(); })
                                      .then(blob => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${(ea.userName||ea.userId).replace(/[^a-zA-Z0-9-_ ]/g,'_')}-Report.${fmt}`; a.click(); URL.revokeObjectURL(url); })
                                      .catch(e => showToast(e.message || 'Export failed', 'error'));
                                  }} className="px-1.5 py-1 rounded bg-slate-700 hover:bg-indigo-600/40 text-[10px] font-bold text-slate-300 hover:text-indigo-300 transition-colors">
                                    {lbl}
                                  </button>
                                ))
                              ) : <span className="text-xs text-slate-600">Pending</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Assessment Settings */}
              {viewDetail.settings && (
                <div className="rounded-2xl border border-slate-700/40 bg-slate-800/20 p-5">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4">Assessment Settings</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    {[
                      ['Question Types', viewDetail.questionTypes?.join(', ') || '—'],
                      ['Question Order', viewDetail.settings.questionOrder || 'Same'],
                      ['Timing', viewDetail.settings.timing?.type === 'timed' ? `${viewDetail.settings.timing.totalMinutes} min` : 'Untimed'],
                      ['Reattempts', viewDetail.settings.reattempts === -1 ? 'Unlimited' : viewDetail.settings.reattempts === 0 ? 'None' : String(viewDetail.settings.reattempts ?? '—')],
                      ['Pass Threshold', `${passThreshold}%`],
                      ['Mandatory', viewDetail.settings.completion?.mandatory ? 'Yes' : 'No'],
                    ].map(([k,v], i) => (
                      <div key={i} className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-3 py-2">
                        <p className="text-slate-500 mb-0.5">{k}</p>
                        <p className="font-semibold text-white capitalize">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showManualModal && (
        <ManualAssessmentModal
          employees={employees}
          onClose={() => setShowManualModal(false)}
          onCreated={() => { setShowManualModal(false); loadAll(); showToast('Manual assessment created', 'success'); }}
        />
      )}

      {showExportFormatModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[200] p-4" onClick={e => e.target === e.currentTarget && setShowExportFormatModal(false)}>
          <div className="bg-[#1E293B] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-1">Download All Reports</h3>
            <p className="text-slate-400 text-sm mb-5">Choose export format</p>
            <div className="space-y-3">
              {[
                { fmt: 'xlsx', label: 'Excel (.xlsx)', icon: '📊', desc: 'Spreadsheet with all data columns' },
                { fmt: 'pdf',  label: 'PDF (.pdf)',   icon: '📄', desc: 'Formatted printable report' },
                { fmt: 'doc',  label: 'Word (.docx)', icon: '📝', desc: 'Editable document format' },
              ].map(({ fmt, label, icon, desc }) => (
                <button key={fmt} onClick={() => downloadAllReports(fmt)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 transition-all text-left">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{label}</p>
                    <p className="text-xs text-slate-400">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowExportFormatModal(false)} className="mt-4 w-full py-2 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assessment Settings Panel ──────────────────────────────────────────────────
function AssessmentSettingsPanel({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const s = settings;
  const upd = (path, value) => {
    const parts = path.split('.');
    const next = JSON.parse(JSON.stringify(s));
    let cur = next;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
    onChange(next);
  };
  const chk = (path, val) => <input type="checkbox" checked={!!val} onChange={e => upd(path, e.target.checked)} className="w-4 h-4 accent-indigo-500 cursor-pointer" />;
  const lbl = (text) => <span className="text-sm text-slate-300">{text}</span>;
  return (
    <div className="border border-slate-700/50 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/40 hover:bg-slate-800/70 transition-colors">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">⚙ Advanced Settings</span>
        <span className="text-slate-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-4 space-y-5 bg-slate-900/40">
          {/* Question Order */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Question Display</p>
            {[['same','All users see same questions in same order'],['shuffled','All users see same questions in different order']].map(([v,l]) => (
              <label key={v} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                <input type="radio" checked={s.questionOrder===v} onChange={() => upd('questionOrder',v)} className="accent-indigo-500" />
                <span className="text-sm text-slate-300">{l}</span>
              </label>
            ))}
          </div>
          {/* Marking Scheme */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Marking Scheme</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[['easy','Easy','text-emerald-400'],['medium','Medium','text-amber-400'],['hard','Hard','text-red-400']].map(([diff,label,cls]) => (
                <div key={diff} className="bg-slate-800/60 rounded-xl p-3 space-y-1.5">
                  <p className={`font-bold ${cls}`}>{label}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 w-14">Correct:</span>
                    <input type="number" min={0} max={10} value={s.markingScheme[diff].correct}
                      onChange={e => upd(`markingScheme.${diff}.correct`, parseInt(e.target.value)||0)}
                      className="w-12 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-white text-center focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 w-14">Wrong:</span>
                    <input type="number" min={-5} max={0} value={s.markingScheme[diff].wrong}
                      onChange={e => upd(`markingScheme.${diff}.wrong`, parseInt(e.target.value)||0)}
                      className="w-12 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-white text-center focus:outline-none focus:border-indigo-500" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Pass % */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Pass Percentage</p>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={100} value={s.passPercentage}
                  onChange={e => upd('passPercentage', Math.min(100, Math.max(1, parseInt(e.target.value)||80)))}
                  className="w-20 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:border-indigo-500" />
                <span className="text-slate-400 text-sm">%</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Reattempts</p>
              <div className="flex items-center gap-2">
                <input type="number" min={-1} value={s.reattempts}
                  onChange={e => upd('reattempts', parseInt(e.target.value))}
                  className="w-20 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:border-indigo-500" />
                <span className="text-slate-500 text-xs">{s.reattempts===-1?'Unlimited':s.reattempts===0?'None':`Attempts`}</span>
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">{chk('allowReattemptToBeatScore',s.allowReattemptToBeatScore)}{lbl('Allow reattempts to beat previous score')}</label>
          {/* Timing */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Quiz Timing</p>
            <div className="flex gap-3 mb-2">
              {[['untimed','Untimed'],['timed','Overall Time Limit']].map(([v,l]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={s.timing.type===v} onChange={() => upd('timing.type',v)} className="accent-indigo-500" />
                  <span className="text-sm text-slate-300">{l}</span>
                </label>
              ))}
            </div>
            {s.timing.type==='timed' && (
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={300} value={s.timing.totalMinutes}
                  onChange={e => upd('timing.totalMinutes', parseInt(e.target.value)||30)}
                  className="w-20 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm text-center focus:outline-none focus:border-indigo-500" />
                <span className="text-slate-400 text-sm">Minutes</span>
              </div>
            )}
          </div>
          {/* Navigation */}
          <label className="flex items-center gap-2 cursor-pointer">{chk('navigation.forwardOnly',s.navigation.forwardOnly)}{lbl('Allow only forward navigation')}</label>
          {/* Results */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Result Visibility</p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">{chk('results.hideFromParticipants',s.results.hideFromParticipants)}{lbl('Hide results from participants')}</label>
              <label className="flex items-center gap-2 cursor-pointer">{chk('results.revealOnSubmission',s.results.revealOnSubmission)}{lbl('Reveal answers on submission')}</label>
              <label className="flex items-center gap-2 cursor-pointer">{chk('results.revealAfterEachQuestion',s.results.revealAfterEachQuestion)}{lbl('Reveal answers after each question')}</label>
              <label className="flex items-center gap-2 cursor-pointer">{chk('results.revealCorrectOption',s.results.revealCorrectOption)}{lbl('Reveal correct option')}</label>
            </div>
          </div>
          {/* Completion */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Completion Rules</p>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">{chk('completion.mandatory',s.completion.mandatory)}{lbl('Assessment mandatory')}</label>
              <label className="flex items-center gap-2 cursor-pointer">{chk('completion.markCompleteOnlyIfPassed',s.completion.markCompleteOnlyIfPassed)}{lbl('Mark complete only if passed')}</label>
              <label className="flex items-center gap-2 cursor-pointer">{chk('completion.allowSubmitWithoutAnsweringAll',s.completion.allowSubmitWithoutAnsweringAll)}{lbl('Allow submission without answering all questions')}</label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CSV questionnaire parser ───────────────────────────────────────────────────
function parseQuestionnaireCSV(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/[\r\n"]/g, '').trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.replace(/[\r\n"]/g, '').trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ''; });
    return {
      type: 'mcq',
      question: row['question'] || '',
      options: [
        'A) ' + (row['option a'] || row['optiona'] || row['a'] || ''),
        'B) ' + (row['option b'] || row['optionb'] || row['b'] || ''),
        'C) ' + (row['option c'] || row['optionc'] || row['c'] || ''),
        'D) ' + (row['option d'] || row['optiond'] || row['d'] || ''),
      ],
      answer: (row['correct answer'] || row['answer'] || row['correct'] || 'A').replace(/[^A-D]/gi, '').toUpperCase() || 'A',
      difficulty: (['easy', 'medium', 'hard'].includes(row['difficulty']?.toLowerCase()) ? row['difficulty'].toLowerCase() : 'medium'),
      skillArea: row['category'] || row['skill area'] || row['skillarea'] || '',
      explanation: row['explanation'] || '',
    };
  }).filter(q => q.question.trim());
}

const EMPTY_Q_MANUAL = { type: 'mcq', question: '', difficulty: 'medium', options: ['A) ', 'B) ', 'C) ', 'D) '], answer: 'A', explanation: '', skillArea: '' };

function ManualAssessmentModal({ employees, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [qSource, setQSource] = useState('manual'); // 'manual' | 'upload'
  const [questions, setQuestions] = useState([]);
  const [newQ, setNewQ] = useState({ ...EMPTY_Q_MANUAL });
  const [addMode, setAddMode] = useState(true);
  const [title, setTitle] = useState('');
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [assessmentType, setAssessmentType] = useState('Skill Assessment');
  const [duration, setDuration] = useState(30);
  const [deadline, setDeadline] = useState('');
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [creating, setCreating] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileRef = React.useRef();

  const toggleEmp = (id) => setSelectedUsers(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const addQuestion = () => {
    if (!newQ.question.trim()) return;
    setQuestions(p => [...p, { ...newQ, id: Math.random().toString(36).slice(2) }]);
    setNewQ({ ...EMPTY_Q_MANUAL });
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploadStatus('Parsing...');
    try {
      if (file.name.endsWith('.csv')) {
        const text = await file.text();
        const parsed = parseQuestionnaireCSV(text);
        setQuestions(parsed);
        setUploadStatus(`Parsed ${parsed.length} questions from CSV`);
      } else {
        // XLSX: send to backend
        const fd = new FormData();
        fd.append('file', file);
        const res = await authFetch('/api/assessments/parse-questionnaire', { method: 'POST', body: fd });
        const qs = res?.data?.questions || res?.questions || [];
        setQuestions(qs);
        setUploadStatus(`Parsed ${qs.length} questions from file`);
      }
    } catch (e) {
      setUploadStatus('Parse error: ' + (e.message || 'unknown error'));
    }
  };

  const handleSubmit = async () => {
    if (!selectedUsers.length) return;
    if (!questions.length) return;
    setCreating(true);
    try {
      await authFetch('/api/assessments/manual', {
        method: 'POST',
        body: JSON.stringify({
          title: title || `Manual Assessment - ${assessmentDate}`,
          targetUsers: selectedUsers,
          questions,
          questionCount: questions.length,
          assessmentDate,
          assessmentType,
          duration,
          deadline,
          settings,
        }),
      });
      onCreated();
    } catch (e) {
      alert(e.message || 'Failed to create assessment');
    } finally {
      setCreating(false);
    }
  };

  const diffCounts = { easy: questions.filter(q => q.difficulty === 'easy').length, medium: questions.filter(q => q.difficulty === 'medium').length, hard: questions.filter(q => q.difficulty === 'hard').length };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-black text-white">Create Manual Assessment</h2>
            <p className="text-xs text-slate-500 mt-0.5">Step {step} of 3 — {['Select Employees', 'Add Questions', 'Review & Create'][step-1]}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Step 1: Select Employees */}
          {step === 1 && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Select Employees</label>
                <span className="text-xs text-indigo-400 font-semibold">{selectedUsers.length} selected</span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {employees.map(emp => {
                  const id = emp.userId || emp.id;
                  const checked = selectedUsers.includes(id);
                  return (
                    <div key={id} onClick={() => toggleEmp(id)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${checked ? 'bg-emerald-600/10 border-emerald-500/40' : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600'}`}>
                      <input type="checkbox" checked={checked} onChange={() => {}} className="pointer-events-none accent-emerald-500" />
                      <div className="w-8 h-8 rounded-full bg-emerald-600/30 border border-emerald-500/30 flex items-center justify-center text-xs font-black text-emerald-300 flex-shrink-0">
                        {(emp.name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{emp.name || '—'}</p>
                        <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                      </div>
                      {emp.jobRole && <span className="text-xs px-2 py-0.5 rounded-md bg-slate-700 text-slate-300">{emp.jobRole}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={() => setStep(2)} disabled={!selectedUsers.length}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-bold text-white transition-all disabled:opacity-40">
                  Next: Add Questions →
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Questions */}
          {step === 2 && (
            <div className="p-6 space-y-4">
              {/* Source tabs */}
              <div className="flex gap-2 border-b border-slate-700/60 pb-3">
                {[{ v: 'manual', l: '✏ Manual Entry' }, { v: 'upload', l: '📤 Upload File' }].map(t => (
                  <button key={t.v} onClick={() => setQSource(t.v)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${qSource === t.v ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
                    {t.l}
                  </button>
                ))}
                <span className="ml-auto text-xs text-slate-500 my-auto">{questions.length} questions added</span>
              </div>

              {qSource === 'upload' && (
                <div className="space-y-3">
                  <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 text-xs text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-300">Required CSV columns:</p>
                    <p>Question, Option A, Option B, Option C, Option D, Correct Answer, Difficulty, Category</p>
                    <p className="text-slate-500">Correct Answer should be A, B, C, or D. Difficulty: easy/medium/hard</p>
                  </div>
                  <div onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-500 transition-colors">
                    <p className="text-slate-400 text-sm">Click to upload CSV or XLSX questionnaire</p>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={e => handleFileUpload(e.target.files[0])} />
                  </div>
                  {uploadStatus && <p className={`text-xs font-semibold ${uploadStatus.includes('error') ? 'text-red-400' : 'text-emerald-400'}`}>{uploadStatus}</p>}
                </div>
              )}

              {qSource === 'manual' && (
                <div className="space-y-3">
                  {/* Add question form */}
                  <div className="bg-[#1E293B] border border-emerald-500/30 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-emerald-300">New Question</p>
                    <textarea rows={2} value={newQ.question} onChange={e => setNewQ(p => ({ ...p, question: e.target.value }))}
                      placeholder="Question text…"
                      className="w-full bg-[#0F172A] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Difficulty</label>
                        <select value={newQ.difficulty} onChange={e => setNewQ(p => ({ ...p, difficulty: e.target.value }))}
                          className="w-full bg-[#0F172A] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                          <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-400 mb-1 block">Category</label>
                        <input value={newQ.skillArea} onChange={e => setNewQ(p => ({ ...p, skillArea: e.target.value }))} placeholder="e.g. Leadership"
                          className="w-full bg-[#0F172A] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none" />
                      </div>
                    </div>
                    {['A','B','C','D'].map((l, oi) => (
                      <input key={l} value={newQ.options[oi]} onChange={e => { const o = [...newQ.options]; o[oi] = e.target.value; setNewQ(p => ({ ...p, options: o })); }}
                        placeholder={`Option ${l}`}
                        className="w-full bg-[#0F172A] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    ))}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="text-xs text-slate-400 mb-1 block">Correct Answer</label>
                        <select value={newQ.answer} onChange={e => setNewQ(p => ({ ...p, answer: e.target.value }))}
                          className="w-full bg-[#0F172A] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none">
                          {['A','B','C','D'].map(l => <option key={l}>{l}</option>)}
                        </select>
                      </div>
                      <button onClick={addQuestion} disabled={!newQ.question.trim()}
                        className="mt-4 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-40">
                        + Add
                      </button>
                    </div>
                  </div>

                  {/* Questions list */}
                  {questions.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {questions.map((q, i) => (
                        <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40">
                          <span className="text-xs font-bold text-slate-500 mt-0.5 w-5 flex-shrink-0">{i+1}.</span>
                          <p className="text-sm text-slate-300 flex-1 line-clamp-2">{q.question}</p>
                          <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${q.difficulty === 'easy' ? 'bg-emerald-500/20 text-emerald-300' : q.difficulty === 'hard' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>{q.difficulty}</span>
                          <button onClick={() => setQuestions(p => p.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 text-xs flex-shrink-0">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white">← Back</button>
                <button onClick={() => setStep(3)} disabled={!questions.length}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-bold text-white disabled:opacity-40">
                  Next: Review →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <h4 className="text-sm font-black text-white">Assessment Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-500">Employees</span><span className="text-white font-bold">{selectedUsers.length}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total Questions</span><span className="text-white font-bold">{questions.length}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Easy</span><span className="text-emerald-300 font-bold">{diffCounts.easy}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Medium</span><span className="text-amber-300 font-bold">{diffCounts.medium}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Hard</span><span className="text-red-300 font-bold">{diffCounts.hard}</span></div>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Title</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={`Manual Assessment - ${assessmentDate}`}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-emerald-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Assessment Type</label>
                <select value={assessmentType} onChange={e => setAssessmentType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-emerald-500 focus:outline-none">
                  {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Date</label>
                  <input type="date" value={assessmentDate} onChange={e => setAssessmentDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-emerald-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Duration (min)</label>
                  <input type="number" min={5} max={180} value={duration} onChange={e => setDuration(parseInt(e.target.value) || 30)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-emerald-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Deadline (optional)</label>
                <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-emerald-500 focus:outline-none" />
              </div>
              <AssessmentSettingsPanel
                settings={settings}
                onChange={s => setSettings(s)}
              />
              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white">← Back</button>
                <button onClick={handleSubmit} disabled={creating}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-sm font-bold text-white disabled:opacity-40">
                  {creating ? 'Creating…' : 'Create Manual Assessment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Export Reports Modal */}
      {exportTarget && (
        <ExportReportsModal
          assessment={exportTarget}
          token={localStorage.getItem('auth_token')}
          onClose={() => setExportTarget(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
