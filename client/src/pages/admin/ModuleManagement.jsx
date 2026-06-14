import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';

const AGENT_STEPS = [
  { agent: 'GoalAgent', icon: '🎯', color: '#6366F1', text: 'Analyzing learning goal...' },
  { agent: 'DecomposeAgent', icon: '🌳', color: '#8B5CF6', text: 'Decomposing into skills...' },
  { agent: 'DiagnosticAgent', icon: '📋', color: '#06B6D4', text: 'Creating knowledge assessment...' },
  { agent: 'ScoringAgent', icon: '📊', color: '#0EA5E9', text: 'Mapping skill gaps...' },
  { agent: 'CurriculumAgent', icon: '📅', color: '#14B8A6', text: 'Building learning roadmap...' },
  { agent: 'EvaluatorAgent', icon: '✅', color: '#10B981', text: 'Designing evaluation criteria...' },
  { agent: 'AdaptorAgent', icon: '⚡', color: '#F59E0B', text: 'Personalizing the plan...' },
  { agent: 'MarketAgent', icon: '💼', color: '#EC4899', text: 'Analyzing market demand...' },
  { agent: 'InterviewAgent', icon: '🎤', color: '#14B8A6', text: 'Preparing interview scenarios...' },
];

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = { success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', error: 'bg-red-500/15 border-red-500/30 text-red-300', info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300' };
  return (
    <div className={`fixed top-6 right-6 z-[100] flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 text-current/50 hover:text-current text-lg leading-none">&times;</button>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 animate-pulse">
    <div className="flex items-center gap-3 mb-4">
      <div className="w-10 h-10 rounded-xl bg-slate-700/50" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-700/50 rounded w-3/4" />
        <div className="h-3 bg-slate-700/30 rounded w-1/2" />
      </div>
    </div>
    <div className="h-2 bg-slate-700/40 rounded-full mb-3" />
    <div className="flex gap-2 flex-wrap">
      <div className="h-7 bg-slate-700/40 rounded w-24" />
      <div className="h-7 bg-slate-700/40 rounded w-20" />
    </div>
  </div>
);

function AnimatedDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(t);
  }, []);
  return <span className="text-slate-400">{dots}</span>;
}

export default function ModuleManagement() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [filterJobRole, setFilterJobRole] = useState('all');
  const [filterAssignType, setFilterAssignType] = useState('all'); // 'all' | 'auto' | 'manual'
  const [search, setSearch] = useState('');

  // Pending approvals state
  const [pendingModules, setPendingModules] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // New creation flow state
  const [showCreate, setShowCreate] = useState(false);
  const [generateInput, setGenerateInput] = useState('');
  const [inputMode, setInputMode] = useState('text'); // 'text' | 'file'
  const [selectedFileName, setSelectedFileName] = useState('');
  const [showAgentUI, setShowAgentUI] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [agentStep, setAgentStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [form, setForm] = useState({
    title: '', description: '', category: 'Web Development', difficulty: 'beginner',
    estimatedDuration: '7 days', skills: [''], tasks: [''], resources: [''],
    completionCriteria: 'Complete all tasks', roadmap: [], sessions: [], quizzes: [],
    milestones: [], timeline: 14,
  });

  const isManagerOrAdmin = hasRole('admin') || hasRole('manager');

  useEffect(() => {
    if (!user || !isManagerOrAdmin) { navigate('/dashboard'); return; }
    loadModules();
    loadPendingCount();
  }, [user, navigate, isManagerOrAdmin]);

  const loadPendingCount = async () => {
    try {
      const res = await authFetch('/api/modules/pending');
      const list = Array.isArray(res) ? res : (res?.modules || []);
      setPendingCount(list.length);
    } catch {
      // silently ignore — count stays 0
    }
  };

  const loadPendingModules = async () => {
    setPendingLoading(true);
    try {
      const res = await authFetch('/api/modules/pending');
      const list = Array.isArray(res) ? res : (res?.modules || []);
      setPendingModules(list);
      setPendingCount(list.length);
    } catch (e) {
      setToast({ message: e.message || 'Failed to load pending modules', type: 'error' });
    } finally {
      setPendingLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      await authFetch(`/api/modules/pending/${id}/approve`, { method: 'POST' });
      setToast({ message: '✅ Module approved successfully', type: 'success' });
      const updated = pendingModules.filter(m => (m.id || m._id) !== id);
      setPendingModules(updated);
      setPendingCount(updated.length);
    } catch (e) {
      setToast({ message: e.message || 'Failed to approve', type: 'error' });
    }
  };

  const handleReject = async (id) => {
    if (!rejectReason.trim()) {
      setToast({ message: 'Please enter a rejection reason', type: 'error' });
      return;
    }
    try {
      await authFetch(`/api/modules/pending/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      });
      setToast({ message: '✕ Module rejected', type: 'info' });
      const updated = pendingModules.filter(m => (m.id || m._id) !== id);
      setPendingModules(updated);
      setPendingCount(updated.length);
      setRejectingId(null);
      setRejectReason('');
    } catch (e) {
      setToast({ message: e.message || 'Failed to reject', type: 'error' });
    }
  };

  const loadModules = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/modules');
      setModules(Array.isArray(res) ? res : (res.modules || []));
    } catch (e) {
      setToast({ message: e.message || 'Failed to load modules', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Load pending modules when the pending tab is first activated
  useEffect(() => {
    if (activeTab === 'pending') {
      loadPendingModules();
    }
  }, [activeTab]);

  const filtered = useMemo(() => {
    return modules.filter(m => {
      const q = search.toLowerCase();
      const matchesSearch = !q || m.title?.toLowerCase().includes(q) || m.description?.toLowerCase().includes(q);
      const matchesTab = activeTab === 'all' || m.category === activeTab;
      const matchesJobRole = filterJobRole === 'all' ||
        (m.content?.jobRole || m.jobRole || m.category) === filterJobRole;
      const matchesAssignType = filterAssignType === 'all' ? true
        : filterAssignType === 'auto' ? (m.content?.isMandatory === true || m.content?.assessmentSource)
        : !(m.content?.isMandatory === true || m.content?.assessmentSource);
      return matchesSearch && matchesTab && matchesJobRole && matchesAssignType;
    });
  }, [modules, activeTab, filterJobRole, filterAssignType, search]);

  const categories = [...new Set(modules.map(m => m.category).filter(Boolean))];
  const jobRoles = [...new Set(modules.map(m => m.content?.jobRole || m.jobRole || m.category).filter(Boolean))];

  const resetForm = () => setForm({
    title: '', description: '', category: 'Web Development', difficulty: 'beginner',
    estimatedDuration: '7 days', skills: [''], tasks: [''], resources: [''],
    completionCriteria: 'Complete all tasks', roadmap: [], sessions: [], quizzes: [],
    milestones: [], timeline: 14,
  });

  const closeCreate = () => {
    setShowCreate(false);
    setEditing(null);
    setShowAgentUI(false);
    setShowReviewForm(false);
    setGenerateInput('');
    setSelectedFileName('');
    setAgentStep(0);
    setGenerating(false);
    resetForm();
  };

  const openEdit = (mod) => {
    setEditing(mod);
    setForm({
      title: mod.title || '',
      description: mod.description || '',
      category: mod.category || 'Web Development',
      difficulty: mod.difficulty || 'beginner',
      estimatedDuration: mod.estimatedDuration || '7 days',
      skills: mod.skills?.length ? mod.skills : [''],
      tasks: mod.tasks?.length ? mod.tasks : [''],
      resources: mod.resources?.length ? mod.resources : [''],
      completionCriteria: mod.completionCriteria || 'Complete all tasks',
      roadmap: mod.roadmap || mod.sessions || [],
      sessions: mod.sessions || mod.roadmap || [],
      quizzes: mod.quizzes || [],
      milestones: mod.milestones || mod.skills || [],
      timeline: mod.timeline || mod.estimatedDuration || 14,
    });
    setShowCreate(true);
    setShowReviewForm(true); // go straight to review/edit form for existing modules
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this module?')) return;
    try {
      await authFetch(`/api/modules/${id}`, { method: 'DELETE' });
      setToast({ message: 'Module deleted', type: 'success' });
      loadModules();
    } catch (e) {
      setToast({ message: e.message || 'Failed to delete', type: 'error' });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanTitle = (form.title || '').trim();
    const cleanDesc  = (form.description || '').trim();
    if (!cleanTitle) { setToast({ message: 'Module title is required', type: 'error' }); return; }

    // Strip empty strings from list fields before sending
    const cleanSkills    = (form.skills    || []).map(s => (typeof s === 'string' ? s.trim() : s?.name || '')).filter(Boolean);
    const cleanTasks     = (form.tasks     || []).map(s => (typeof s === 'string' ? s.trim() : s)).filter(Boolean);
    const cleanResources = (form.resources || []).map(s => (typeof s === 'string' ? s.trim() : s)).filter(Boolean);

    const modulePayload = {
      title: cleanTitle,
      description: cleanDesc || `Learn ${cleanTitle} with AI-generated content`,
      category: form.category || 'General',
      difficulty: form.difficulty || 'beginner',
      estimatedDuration: form.estimatedDuration || '7 days',
      skills: cleanSkills.length ? cleanSkills : [cleanTitle],
      tasks: cleanTasks,
      resources: cleanResources,
      completionCriteria: form.completionCriteria || 'Complete all tasks',
      progressTracking: true,
      content: {
        roadmap: form.roadmap || form.sessions || [],
        sessions: form.sessions || form.roadmap || [],
        quizzes: form.quizzes || [],
        notes: [],
        milestones: form.milestones || cleanSkills || [],
        timeline: form.timeline || 14,
        completionCriteria: form.completionCriteria || 'Complete all tasks',
      },
    };

    try {
      if (editing) {
        await authFetch(`/api/modules/${editing.id}`, { method: 'PUT', body: JSON.stringify(modulePayload) });
        setToast({ message: '✅ Module updated successfully', type: 'success' });
      } else {
        const created = await authFetch('/api/modules', { method: 'POST', body: JSON.stringify(modulePayload) });
        setToast({ message: `✅ Module "${created?.title || cleanTitle}" created!`, type: 'success' });
      }
      closeCreate();
      loadModules();
    } catch (e) {
      console.error('[ModuleManagement] save error:', e);
      setToast({ message: e.message || 'Failed to save module — check console', type: 'error' });
    }
  };

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
  const updateList = (field, idx, value) => setForm(prev => { const arr = [...(prev[field] || [])]; arr[idx] = value; return { ...prev, [field]: arr }; });
  const addListItem = (field) => setForm(prev => ({ ...prev, [field]: [...(prev[field] || []), ''] }));
  const removeListItem = (field, idx) => setForm(prev => { const arr = [...(prev[field] || [])]; arr.splice(idx, 1); return { ...prev, [field]: arr }; });

  const readFileText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const handleFileSelect = async (file) => {
    if (!file) return;
    setSelectedFileName(file.name);
    try {
      const text = await readFileText(file);
      setGenerateInput(text.slice(0, 4000)); // cap to avoid huge payloads
    } catch (e) {
      setToast({ message: 'Could not read file', type: 'error' });
    }
  };

  const runGeneration = async () => {
    if (!generateInput.trim()) {
      setToast({ message: 'Please enter a skill/role or upload a file first', type: 'error' });
      return;
    }
    setShowAgentUI(true);
    setAgentStep(0);
    setGenerating(true);

    for (let i = 0; i < AGENT_STEPS.length; i++) {
      setAgentStep(i + 1);
      await new Promise(r => setTimeout(r, 350));
    }

    try {
      const res = await authFetch('/api/goal', {
        method: 'POST',
        body: JSON.stringify({ goalText: generateInput }),
      });
      setForm({
        title: res.skillTree?.domainName || generateInput,
        description: `Master ${res.skillTree?.domainName || generateInput} with AI-personalized learning`,
        category: res.skillTree?.domainName || 'General',
        difficulty: res.skillTree?.profile?.learnerLevel || 'intermediate',
        estimatedDuration: `${res.skillTree?.totalEstimatedDays || 30} days`,
        skills: res.skillTree?.skills?.map(s => s.name) || [''],
        tasks: res.learningPlan?.slice(0, 5).map(d => d.topic) || [''],
        resources: ['https://developer.mozilla.org'],
        completionCriteria: 'Complete all skills with 75%+ mastery',
        roadmap: res.learningPlan || [],
        sessions: res.learningPlan || [],
        quizzes: res.diagnosticQuestions || [],
        milestones: res.skillTree?.skills || [],
        timeline: res.learningPlan?.length || 14,
      });
      setShowAgentUI(false);
      setShowReviewForm(true);
    } catch (e) {
      setToast({ message: e.message || 'Generation failed', type: 'error' });
      setShowAgentUI(false);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Module List ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <button onClick={() => navigate(user?.role === 'manager' ? '/manager/dashboard' : '/admin/dashboard')} className="text-slate-400 hover:text-white text-sm mb-2 flex items-center gap-2">← Back to Dashboard</button>
            <h1 className="text-3xl font-black text-white">
              {user?.role === 'manager' ? 'Create Learning Module' : 'Module Management'}
            </h1>
            <p className="text-slate-400 text-sm">
              {user?.role === 'manager'
                ? 'Define a learning module for your team — skills, sessions, quizzes, milestones, and timeline.'
                : 'Create and manage AI-generated learning modules for the entire organization.'}
            </p>
          </div>
          <button
            onClick={() => { setShowCreate(true); setEditing(null); setShowReviewForm(false); setShowAgentUI(false); }}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all"
          >
            + New Module
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Category dropdown */}
          <select
            value={activeTab}
            onChange={e => setActiveTab(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="all">All Types</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Job Role dropdown */}
          <select
            value={filterJobRole}
            onChange={e => setFilterJobRole(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Job Roles</option>
            {jobRoles.map(jr => (
              <option key={jr} value={jr}>{jr}</option>
            ))}
          </select>

          {/* Assign Type dropdown */}
          <select
            value={filterAssignType}
            onChange={e => setFilterAssignType(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700/60 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="all">All Modules</option>
            <option value="auto">Auto Assigned</option>
            <option value="manual">Manual Assigned</option>
          </select>

          {/* Pending Approvals button (kept as special tab) */}
          <button
            onClick={() => setActiveTab('pending')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold whitespace-nowrap transition-all ${activeTab === 'pending' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-white'}`}
          >
            ⏳ Pending Approvals
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-black">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
        </div>

        <div className="mb-4">
          <input type="text" placeholder="Search modules..." value={search} onChange={e => setSearch(e.target.value)} className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </div>

        {/* ── Pending Approvals Tab ── */}
        {activeTab === 'pending' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-widest">
                {pendingCount} module{pendingCount !== 1 ? 's' : ''} awaiting review
              </p>
              <button
                onClick={loadPendingModules}
                disabled={pendingLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-xs font-bold transition-all disabled:opacity-50"
              >
                {pendingLoading ? (
                  <span className="w-3 h-3 border-2 border-slate-500 border-t-white rounded-full animate-spin" />
                ) : '↻'} Refresh
              </button>
            </div>

            {pendingLoading ? (
              <div className="space-y-4">
                {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
              </div>
            ) : pendingModules.length === 0 ? (
              <div className="rounded-2xl border border-slate-700/40 bg-[#111827] py-20 text-center">
                <div className="text-5xl mb-4 opacity-20">✅</div>
                <p className="text-lg font-bold text-slate-400 mb-1">No Pending Approvals</p>
                <p className="text-sm text-slate-600">All auto-generated modules have been reviewed.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingModules.map((mod) => {
                  const id = mod.id || mod._id;
                  const weakAreas = mod.weakAreas || mod.weak_areas || mod.skills || [];
                  const isRejecting = rejectingId === id;
                  const skillColors = [
                    'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
                    'bg-purple-500/15 text-purple-300 border-purple-500/30',
                    'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
                    'bg-amber-500/15 text-amber-300 border-amber-500/30',
                    'bg-pink-500/15 text-pink-300 border-pink-500/30',
                  ];
                  return (
                    <div key={id} className="rounded-2xl border border-amber-500/20 bg-[#111827] p-5 shadow-lg">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <p className="text-sm font-bold text-white">{mod.employeeName || mod.employee_name || 'Employee'}</p>
                            {(mod.jobRole || mod.job_role) && (
                              <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-bold">
                                {mod.jobRole || mod.job_role}
                              </span>
                            )}
                          </div>
                          {(mod.assessmentTitle || mod.assessment_title) && (
                            <p className="text-xs text-slate-500 mb-3">
                              Triggered by: <span className="text-slate-300">{mod.assessmentTitle || mod.assessment_title}</span>
                            </p>
                          )}

                          {weakAreas.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {weakAreas.map((area, ai) => (
                                <span
                                  key={ai}
                                  className={`px-2 py-0.5 rounded-md border text-xs font-semibold ${skillColors[ai % skillColors.length]}`}
                                >
                                  {typeof area === 'string' ? area : area.name || area.area || String(area)}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h3 className="text-base font-black text-white">{mod.title}</h3>
                            {mod.mandatory && (
                              <span className="px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-black uppercase">
                                Mandatory
                              </span>
                            )}
                          </div>
                          {mod.description && (
                            <p className="text-xs text-slate-400 leading-relaxed">{mod.description}</p>
                          )}
                        </div>
                      </div>

                      {/* Reject reason textarea */}
                      {isRejecting && (
                        <div className="mb-4">
                          <textarea
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Enter rejection reason..."
                            rows={3}
                            className="w-full px-3 py-2.5 bg-slate-800 border border-red-500/30 rounded-xl text-white text-sm placeholder-slate-500 focus:border-red-500 focus:outline-none resize-none transition-all"
                          />
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-700/30">
                        <button
                          onClick={() => handleApprove(id)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 text-xs font-bold transition-all"
                        >
                          ✓ Approve
                        </button>
                        {isRejecting ? (
                          <>
                            <button
                              onClick={() => handleReject(id)}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 text-xs font-bold transition-all"
                            >
                              Confirm Reject
                            </button>
                            <button
                              onClick={() => { setRejectingId(null); setRejectReason(''); }}
                              className="px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-700 text-slate-400 hover:text-white text-xs font-bold transition-all"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setRejectingId(id)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 text-xs font-bold transition-all"
                          >
                            ✕ Reject
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Module List (all other tabs) ── */}
        {activeTab !== 'pending' && loading ? (
          <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden">
            <div className="divide-y divide-slate-700/20">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          </div>
        ) : activeTab !== 'pending' && filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/40 bg-[#111827] py-20 text-center">
            <div className="text-6xl mb-4 opacity-20">📚</div>
            <p className="text-lg font-bold text-slate-400 mb-1">No Modules Found</p>
            <p className="text-sm text-slate-600">Create your first module to get started.</p>
          </div>
        ) : activeTab !== 'pending' ? (
          <div className="rounded-2xl border border-slate-700/40 bg-[#111827] overflow-hidden shadow-xl">
            {/* Table header */}
            <div className="hidden lg:grid px-6 py-3 border-b border-slate-700/40 bg-slate-800/30 text-xs font-bold text-slate-500 uppercase tracking-widest"
              style={{ gridTemplateColumns: '3fr 1.2fr 1fr 1fr 1.5fr 120px' }}>
              <span>Module</span>
              <span>Category</span>
              <span>Difficulty</span>
              <span>Duration</span>
              <span>Skills</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-slate-700/20">
              {filtered.map((mod, idx) => {
                const diffColor = mod.difficulty === 'beginner'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : mod.difficulty === 'intermediate'
                  ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                  : 'bg-purple-500/15 text-purple-400 border-purple-500/30';
                const skills = (mod.skills || []).filter(Boolean);
                return (
                  <div key={mod.id || idx}
                    className="group px-6 py-4 hover:bg-slate-800/30 transition-all"
                    style={{ display: 'grid', gridTemplateColumns: '3fr 1.2fr 1fr 1fr 1.5fr 120px', alignItems: 'center', gap: '12px' }}>
                    {/* Module info */}
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate leading-tight">{mod.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{mod.description}</p>
                    </div>
                    {/* Category */}
                    <div>
                      <span className="text-xs font-semibold text-slate-400 bg-slate-700/40 px-2.5 py-1 rounded-lg">
                        {mod.category || '—'}
                      </span>
                    </div>
                    {/* Difficulty */}
                    <div>
                      <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold border capitalize ${diffColor}`}>
                        {mod.difficulty || 'beginner'}
                      </span>
                    </div>
                    {/* Duration */}
                    <div>
                      <span className="text-xs text-slate-400">⏱ {mod.estimatedDuration || '—'}</span>
                    </div>
                    {/* Skills */}
                    <div className="min-w-0">
                      {skills.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {skills.slice(0, 2).map((s, si) => (
                            <span key={si} className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-md truncate max-w-[100px]">{s}</span>
                          ))}
                          {skills.length > 2 && <span className="text-xs text-slate-500">+{skills.length - 2}</span>}
                        </div>
                      ) : <span className="text-xs text-slate-600">—</span>}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(mod)}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-bold transition-all">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(mod.id)}
                        className="w-7 h-7 rounded-lg bg-slate-700/50 hover:bg-red-500/20 border border-transparent hover:border-red-500/30 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-all">
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Footer */}
            <div className="px-6 py-3 border-t border-slate-700/30 bg-slate-800/10 flex items-center justify-between">
              <p className="text-xs text-slate-600">
                Showing <span className="text-slate-400 font-semibold">{filtered.length}</span> of <span className="text-slate-400 font-semibold">{modules.length}</span> modules
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Full-Page Creation Overlay ── */}
      {showCreate && !showAgentUI && !showReviewForm && (
        <div className="fixed inset-0 z-50 bg-[#0F172A] flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-sm">✦</div>
              <span className="text-lg font-black text-white">New Module</span>
            </div>
            <button onClick={closeCreate} className="text-slate-500 hover:text-white text-2xl leading-none transition-colors">✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-2xl mx-auto w-full">
            <h2 className="text-3xl font-black text-white text-center mb-2">What do you want to learn?</h2>
            <p className="text-slate-400 text-center mb-10">Describe a skill, role, or job — or upload a document — and our AI agents will build a complete learning module.</p>

            {/* Mode Toggle */}
            <div className="flex gap-1 p-1 bg-slate-800 rounded-xl mb-8 w-full max-w-xs">
              <button
                onClick={() => setInputMode('text')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${inputMode === 'text' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Text
              </button>
              <button
                onClick={() => setInputMode('file')}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${inputMode === 'file' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                File Upload
              </button>
            </div>

            {/* Mode 1 – Text */}
            {inputMode === 'text' && (
              <div className="w-full">
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">Enter skill, role, or job description</label>
                <textarea
                  value={generateInput}
                  onChange={e => setGenerateInput(e.target.value)}
                  placeholder="e.g. AI Engineer, Full Stack Developer, Data Scientist"
                  rows={4}
                  className="w-full px-5 py-4 rounded-2xl bg-slate-800 border border-slate-700 text-white text-base placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none text-center"
                  style={{ textAlign: generateInput ? 'left' : 'center' }}
                />
              </div>
            )}

            {/* Mode 2 – File Upload */}
            {inputMode === 'file' && (
              <div className="w-full">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={e => handleFileSelect(e.target.files[0])}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0]); }}
                  className={`w-full border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer transition-all ${dragOver ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'}`}
                >
                  {selectedFileName ? (
                    <>
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-2xl mb-3">📄</div>
                      <p className="text-white font-bold text-sm mb-1">{selectedFileName}</p>
                      <p className="text-slate-400 text-xs">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 rounded-2xl bg-slate-700 flex items-center justify-center text-2xl mb-3">📂</div>
                      <p className="text-white font-semibold mb-1">Drag & drop or click to upload</p>
                      <p className="text-slate-500 text-xs">Any file type accepted</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* OR divider */}
            {inputMode === 'text' && (
              <div className="flex items-center gap-4 my-6 w-full">
                <div className="flex-1 h-px bg-slate-700" />
                <span className="text-slate-500 text-xs font-bold uppercase tracking-widest">OR</span>
                <div className="flex-1 h-px bg-slate-700" />
              </div>
            )}
            {inputMode === 'text' && (
              <p className="text-slate-500 text-xs text-center -mt-2 mb-4">Switch to "File Upload" tab to upload a document instead</p>
            )}

            {/* Generate Button */}
            {generateInput.trim() && (
              <button
                onClick={runGeneration}
                disabled={generating}
                className="mt-4 w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-lg transition-all shadow-2xl shadow-indigo-500/30 disabled:opacity-60"
              >
                Generate Module with AI →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Agent Animation Overlay ── */}
      {showCreate && showAgentUI && (
        <div className="fixed inset-0 z-50 bg-[#0A0F1E] flex flex-col items-center justify-center px-6">
          {/* Subtle radial glow */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />

          <div className="relative z-10 w-full max-w-xl">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-widest mb-4">
                ✦ AI Agent Pipeline
              </div>
              <h2 className="text-2xl font-black text-white mb-2">Building your module</h2>
              <p className="text-slate-400 text-sm">9 specialized agents are collaborating to craft your personalized learning path</p>
            </div>

            <div className="space-y-3">
              {AGENT_STEPS.map((step, i) => {
                const isDone = agentStep > i + 1;
                const isActive = agentStep === i + 1;
                const isPending = agentStep <= i;
                return (
                  <div
                    key={step.agent}
                    className={`flex items-center gap-4 px-5 py-3.5 rounded-xl border transition-all duration-500 ${
                      isDone
                        ? 'bg-emerald-500/10 border-emerald-500/20'
                        : isActive
                        ? 'bg-slate-800/80 border-slate-600 shadow-lg'
                        : 'bg-slate-900/40 border-slate-800/50 opacity-40'
                    }`}
                    style={{ transitionDelay: `${i * 30}ms` }}
                  >
                    {/* Icon */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: isPending ? 'rgba(100,116,139,0.2)' : `${step.color}22`, border: `1px solid ${isPending ? '#334155' : step.color}44` }}
                    >
                      {step.icon}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${isDone ? 'text-emerald-300' : isActive ? 'text-white' : 'text-slate-500'}`}>{step.agent}</span>
                        {isActive && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">Running</span>
                        )}
                      </div>
                      <p className={`text-xs truncate ${isDone ? 'text-emerald-400/70' : isActive ? 'text-slate-400' : 'text-slate-600'}`}>
                        {step.text}{isActive && <AnimatedDots />}
                      </p>
                    </div>

                    {/* Status */}
                    <div className="flex-shrink-0">
                      {isDone && (
                        <div className="w-6 h-6 rounded-full bg-emerald-500/30 border border-emerald-500/50 flex items-center justify-center text-emerald-400 text-xs">✓</div>
                      )}
                      {isActive && (
                        <div className="w-6 h-6 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                      )}
                      {isPending && (
                        <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8">
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                  style={{ width: `${(agentStep / AGENT_STEPS.length) * 100}%` }}
                />
              </div>
              <p className="text-center text-slate-500 text-xs mt-2">{agentStep} / {AGENT_STEPS.length} agents complete</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Review & Edit Form Overlay ── */}
      {showCreate && showReviewForm && (
        <div className="fixed inset-0 z-50 bg-[#0F172A] flex flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b border-slate-800 sticky top-0 bg-[#0F172A] z-10">
            <div>
              <div className="flex items-center gap-3 mb-0.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-sm">✓</div>
                <span className="text-lg font-black text-white">{editing ? 'Edit Module' : 'Review Generated Module'}</span>
              </div>
              {!editing && <p className="text-slate-500 text-xs ml-10">AI has pre-filled the fields — review and save</p>}
            </div>
            <button onClick={closeCreate} className="text-slate-500 hover:text-white text-2xl leading-none transition-colors">✕</button>
          </div>

          {/* Form */}
          <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Title *</label>
                <input
                  type="text" value={form.title} onChange={e => updateField('title', e.target.value)}
                  placeholder="Module title"
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Description *</label>
                <textarea
                  value={form.description} onChange={e => updateField('description', e.target.value)}
                  placeholder="What does this module cover?"
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-none"
                  rows={3} required
                />
              </div>

              {/* Category / Difficulty / Duration */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Category</label>
                  <select value={form.category} onChange={e => updateField('category', e.target.value)} className="w-full px-3 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none">
                    {['Web Development', 'Data Science', 'Mobile Development', 'DevOps', 'Cloud Architecture', 'Machine Learning', 'Cybersecurity', 'UI/UX Design', 'Backend Development', 'Frontend Development', 'General'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Difficulty</label>
                  <select value={form.difficulty} onChange={e => updateField('difficulty', e.target.value)} className="w-full px-3 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Duration</label>
                  <select value={form.estimatedDuration} onChange={e => updateField('estimatedDuration', e.target.value)} className="w-full px-3 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none">
                    {['3 days', '7 days', '14 days', '21 days', '30 days', '60 days'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* Skills, Tasks, Resources */}
              {['skills', 'tasks', 'resources'].map(field => (
                <div key={field} className="space-y-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                  {(form[field] || ['']).map((item, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text" value={item} onChange={e => updateList(field, idx, e.target.value)}
                        placeholder={`Enter ${field.slice(0, -1)}...`}
                        className="flex-1 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:border-indigo-500 focus:outline-none"
                      />
                      <button type="button" onClick={() => removeListItem(field, idx)} className="px-2.5 py-1 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 text-sm">✕</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addListItem(field)} className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold">+ Add {field.slice(0, -1)}</button>
                </div>
              ))}

              {/* Completion Criteria */}
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Completion Criteria</label>
                <input
                  type="text" value={form.completionCriteria} onChange={e => updateField('completionCriteria', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Generated content summary (read-only info) */}
              {!editing && (form.roadmap?.length > 0 || form.quizzes?.length > 0) && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">AI Generated Content</p>
                  <div className="flex flex-wrap gap-3">
                    {form.roadmap?.length > 0 && <div className="flex items-center gap-2 text-xs text-slate-300"><span className="w-6 h-6 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">📅</span>{form.roadmap.length} learning sessions</div>}
                    {form.quizzes?.length > 0 && <div className="flex items-center gap-2 text-xs text-slate-300"><span className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">📋</span>{form.quizzes.length} quiz questions</div>}
                    {form.milestones?.length > 0 && <div className="flex items-center gap-2 text-xs text-slate-300"><span className="w-6 h-6 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">🏆</span>{form.milestones.length} skill milestones</div>}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2 pb-8">
                <button
                  type="submit"
                  className="flex-1 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl font-black text-white transition-all shadow-lg shadow-indigo-500/20"
                >
                  {editing ? 'Update Module' : 'Save Module'}
                </button>
                <button
                  type="button"
                  onClick={closeCreate}
                  className="py-4 px-6 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
