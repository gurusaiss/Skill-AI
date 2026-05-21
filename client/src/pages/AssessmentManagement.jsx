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
  const colors = { success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', error: 'bg-red-500/15 border-red-500/30 text-red-300', info: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300' };
  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl ${colors[type]}`}>
      <span className="text-sm font-semibold">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100 text-lg">&times;</button>
    </div>
  );
};

const GENERATION_STEPS = [
  { icon: '🧠', label: 'Analyzing module content...', color: '#6366F1' },
  { icon: '📋', label: 'Generating questions with AI...', color: '#8B5CF6' },
  { icon: '✅', label: 'Formatting and validating...', color: '#10B981' },
];

const QUESTION_TYPE_OPTIONS = [
  { value: 'mcq', label: 'Multiple Choice (MCQ)', icon: '🔘' },
  { value: 'subjective', label: 'Subjective / Open-Ended', icon: '✍️' },
  { value: 'fill_blank', label: 'Fill in the Blanks', icon: '🔲' },
];

const SCHEDULE_OPTIONS = [
  { value: 'manual', label: 'Manual (assign later)' },
  { value: 'after_session', label: 'After N Sessions' },
  { value: 'scheduled', label: 'On Specific Date' },
];

const DIFFICULTY_COLORS = {
  easy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  hard: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const TYPE_LABELS = { mcq: 'MCQ', subjective: 'Subjective', fill_blank: 'Fill Blank' };

const EMPTY_FORM = {
  moduleId: '', title: '', description: '',
  numQuestions: 5,
  questionTypes: ['mcq'],
  scheduleType: 'manual',
  sessionNumber: '',
  scheduledDate: '',
};

export default function AssessmentManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [assessments, setAssessments] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [genStep, setGenStep] = useState(-1); // -1 = idle, 0/1/2 = step
  const [generatedQuestions, setGeneratedQuestions] = useState(null);
  const [editingQuestions, setEditingQuestions] = useState(null); // for review
  const [saving, setSaving] = useState(false);
  const [viewDetail, setViewDetail] = useState(null); // assessment to view/edit
  const [search, setSearch] = useState('');

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
      const [assessRes, modRes] = await Promise.allSettled([
        authFetch('/api/assessments'),
        authFetch('/api/modules'),
      ]);
      if (assessRes.status === 'fulfilled') {
        const v = assessRes.value;
        setAssessments(Array.isArray(v) ? v : []);
      }
      if (modRes.status === 'fulfilled') {
        const v = modRes.value;
        setModules(Array.isArray(v) ? v : (v?.modules || []));
      }
    } catch (e) {
      showToast(e.message || 'Failed to load', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleModuleSelect = (moduleId) => {
    const mod = modules.find(m => m.id === moduleId);
    setForm(prev => ({
      ...prev,
      moduleId,
      title: mod ? `${mod.title} Assessment` : prev.title,
      description: mod ? `Assessment for ${mod.title} — tests understanding of ${(mod.skills || []).slice(0, 3).join(', ')}` : prev.description,
    }));
  };

  const toggleQuestionType = (type) => {
    setForm(prev => {
      const types = prev.questionTypes.includes(type)
        ? prev.questionTypes.filter(t => t !== type)
        : [...prev.questionTypes, type];
      return { ...prev, questionTypes: types.length > 0 ? types : [type] };
    });
  };

  const runGeneration = async () => {
    const mod = modules.find(m => m.id === form.moduleId);
    setGenStep(0);
    await new Promise(r => setTimeout(r, 1200));
    setGenStep(1);

    try {
      const questions = await authFetch('/api/assessments/generate', {
        method: 'POST',
        body: JSON.stringify({
          moduleTitle: mod?.title || form.title,
          moduleDescription: mod?.description || form.description,
          skills: mod?.skills || [],
          numQuestions: form.numQuestions,
          questionTypes: form.questionTypes,
        }),
      });
      setGenStep(2);
      await new Promise(r => setTimeout(r, 800));
      setGeneratedQuestions(Array.isArray(questions) ? questions : []);
      setEditingQuestions(Array.isArray(questions) ? questions.map(q => ({ ...q })) : []);
      setGenStep(-1);
    } catch (e) {
      showToast(e.message || 'Generation failed', 'error');
      setGenStep(-1);
    }
  };

  const updateQuestion = (idx, field, value) => {
    setEditingQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q));
  };

  const updateOption = (qIdx, optIdx, value) => {
    setEditingQuestions(prev => prev.map((q, i) => {
      if (i !== qIdx) return q;
      const opts = [...(q.options || ['A) ', 'B) ', 'C) ', 'D) '])];
      opts[optIdx] = value;
      return { ...q, options: opts };
    }));
  };

  const removeQuestion = (idx) => {
    setEditingQuestions(prev => prev.filter((_, i) => i !== idx));
  };

  const saveAssessment = async () => {
    if (!form.title) { showToast('Please add a title', 'error'); return; }
    if (!editingQuestions || editingQuestions.length === 0) { showToast('No questions to save', 'error'); return; }
    setSaving(true);
    try {
      const schedule = form.scheduleType === 'after_session'
        ? { type: 'after_session', sessionNumber: parseInt(form.sessionNumber) || 1 }
        : form.scheduleType === 'scheduled'
        ? { type: 'scheduled', date: form.scheduledDate }
        : { type: 'manual' };

      const payload = {
        title: form.title,
        description: form.description,
        moduleId: form.moduleId || null,
        questions: editingQuestions,
        schedule,
        targetUsers: ['all'],
      };

      const saved = await authFetch('/api/assessments', { method: 'POST', body: JSON.stringify(payload) });
      setAssessments(prev => [saved, ...prev]);
      showToast('Assessment saved successfully', 'success');
      closeGenerate();
    } catch (e) {
      showToast(e.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
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

  const closeGenerate = () => {
    setShowGenerate(false);
    setForm(EMPTY_FORM);
    setGenStep(-1);
    setGeneratedQuestions(null);
    setEditingQuestions(null);
  };

  const filtered = useMemo(() => {
    if (!search) return assessments;
    return assessments.filter(a => (a.title || '').toLowerCase().includes(search.toLowerCase()));
  }, [assessments, search]);

  const getModuleName = (moduleId) => {
    if (!moduleId) return '—';
    return modules.find(m => m.id === moduleId)?.title || moduleId;
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <button onClick={() => navigate(user?.role === 'admin' ? '/admin/dashboard' : '/manager/dashboard')}
              className="text-slate-400 hover:text-white text-sm mb-2 flex items-center gap-2">
              ← Back to Dashboard
            </button>
            <h1 className="text-3xl font-black text-white">Assessment Management</h1>
            <p className="text-slate-400 text-sm mt-0.5">AI-powered knowledge assessments for your training modules</p>
          </div>
          <button
            onClick={() => setShowGenerate(true)}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all shadow-lg shadow-indigo-500/20"
          >
            ✦ Generate with AI
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Assessments', value: assessments.length, color: '#6366f1' },
            { label: 'Total Questions', value: assessments.reduce((s, a) => s + (a.questions?.length || 0), 0), color: '#8b5cf6' },
            { label: 'Modules Covered', value: new Set(assessments.map(a => a.moduleId).filter(Boolean)).size, color: '#10b981' },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{s.label}</p>
              <p className="text-3xl font-black" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-700/40">
            <input type="text" placeholder="Search assessments..." value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
            <button onClick={loadAll} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-400 hover:text-white font-semibold transition-all">↻</button>
          </div>

          {/* Table header */}
          <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_1fr_auto] px-5 py-2 border-b border-slate-700/30 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <span>Title</span><span>Module</span><span>Questions</span><span>Schedule</span><span>Created</span><span></span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-slate-500">
              <div className="animate-spin text-3xl mb-2">⟳</div>
              <p className="text-sm">Loading assessments...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-5xl mb-4 opacity-20">📝</div>
              <p className="text-lg font-bold text-slate-400 mb-1">No Assessments Yet</p>
              <p className="text-sm text-slate-600">Click "Generate with AI" to create your first assessment.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/30">
              {filtered.map((a) => (
                <div key={a.id} className="px-5 py-4 grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr_1fr_1fr_auto] items-center gap-3 hover:bg-slate-800/20 transition-all">
                  <div>
                    <p className="text-sm font-bold text-white">{a.title}</p>
                    {a.description && <p className="text-xs text-slate-500 truncate mt-0.5">{a.description}</p>}
                  </div>
                  <div><span className="text-sm text-slate-300">{getModuleName(a.moduleId)}</span></div>
                  <div><span className="text-sm font-bold text-indigo-400">{a.questions?.length || 0}</span></div>
                  <div><span className="text-xs text-slate-400 capitalize">{a.schedule?.type || 'manual'}</span></div>
                  <div><span className="text-xs text-slate-500">{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}</span></div>
                  <div className="flex gap-2">
                    <button onClick={() => setViewDetail(a)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-semibold transition-all">
                      View
                    </button>
                    <button onClick={() => deleteAssessment(a.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-xs font-semibold transition-all">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* === Generate Modal === */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-slate-900 z-10">
              <div>
                <h3 className="text-lg font-black text-white">✦ Generate Assessment with AI</h3>
                <p className="text-xs text-slate-500 mt-0.5">Configure your assessment — AI will generate the questions</p>
              </div>
              <button onClick={closeGenerate} className="text-slate-500 hover:text-white text-xl transition-colors">✕</button>
            </div>

            {/* Step: Config Form */}
            {genStep === -1 && !editingQuestions && (
              <div className="p-6 space-y-5">
                {/* Module Select */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Module</label>
                  <select value={form.moduleId} onChange={e => handleModuleSelect(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none">
                    <option value="">— Select a module —</option>
                    {modules.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </div>

                {/* Title */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Assessment Title *</label>
                  <input type="text" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. JavaScript Fundamentals Assessment"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none" />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Description</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="What does this assessment test?"
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-none" />
                </div>

                {/* Number of Questions */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                    Number of Questions: <span className="text-indigo-400">{form.numQuestions}</span>
                  </label>
                  <input type="range" min="2" max="20" value={form.numQuestions}
                    onChange={e => setForm(f => ({ ...f, numQuestions: parseInt(e.target.value) }))}
                    className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-xs text-slate-600 mt-1"><span>2</span><span>20</span></div>
                </div>

                {/* Question Types */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Question Types</label>
                  <div className="flex flex-wrap gap-2">
                    {QUESTION_TYPE_OPTIONS.map(opt => (
                      <button key={opt.value} type="button"
                        onClick={() => toggleQuestionType(opt.value)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                          form.questionTypes.includes(opt.value)
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                        }`}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Schedule Type */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Schedule</label>
                  <select value={form.scheduleType} onChange={e => setForm(f => ({ ...f, scheduleType: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none">
                    {SCHEDULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {form.scheduleType === 'after_session' && (
                    <input type="number" min="1" max="50" value={form.sessionNumber}
                      onChange={e => setForm(f => ({ ...f, sessionNumber: e.target.value }))}
                      placeholder="Session number (e.g. 5)"
                      className="w-full mt-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none" />
                  )}
                  {form.scheduleType === 'scheduled' && (
                    <input type="date" value={form.scheduledDate}
                      onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full mt-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none" />
                  )}
                </div>

                <button onClick={runGeneration} disabled={!form.title}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                  ✦ Generate {form.numQuestions} Questions with AI →
                </button>
              </div>
            )}

            {/* Step: AI Generation Animation */}
            {genStep >= 0 && !editingQuestions && (
              <div className="p-8 flex flex-col items-center justify-center min-h-64">
                <div className="text-center mb-8">
                  <div className="text-4xl mb-3 animate-pulse">{GENERATION_STEPS[Math.min(genStep, 2)]?.icon}</div>
                  <h4 className="text-lg font-black text-white mb-1">{GENERATION_STEPS[Math.min(genStep, 2)]?.label}</h4>
                  <p className="text-sm text-slate-500">Generating {form.numQuestions} questions...</p>
                </div>
                <div className="w-full max-w-xs space-y-3">
                  {GENERATION_STEPS.map((step, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      genStep > i ? 'border-emerald-500/30 bg-emerald-500/5' :
                      genStep === i ? 'border-indigo-500/40 bg-indigo-500/10' :
                      'border-slate-700/40 bg-slate-800/30 opacity-40'
                    }`}>
                      <span className="text-lg">{step.icon}</span>
                      <span className={`text-xs font-semibold ${genStep > i ? 'text-emerald-400' : genStep === i ? 'text-white' : 'text-slate-500'}`}>{step.label}</span>
                      {genStep > i && <span className="ml-auto text-emerald-400 text-xs">✓</span>}
                      {genStep === i && <div className="ml-auto w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step: Review & Edit Questions */}
            {editingQuestions && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-base font-black text-white">Review Generated Questions</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{editingQuestions.length} questions — edit if needed before saving</p>
                  </div>
                  <button onClick={() => { setEditingQuestions(null); setGeneratedQuestions(null); }}
                    className="text-xs text-slate-400 hover:text-white border border-slate-700 px-3 py-1.5 rounded-lg transition-all">
                    ← Regenerate
                  </button>
                </div>

                <div className="space-y-4 mb-6">
                  {editingQuestions.map((q, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-500">Q{idx + 1}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold border uppercase ${DIFFICULTY_COLORS[q.difficulty] || DIFFICULTY_COLORS.medium}`}>{q.difficulty}</span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold border border-slate-600/50 bg-slate-700/40 text-slate-400 uppercase">{TYPE_LABELS[q.type] || q.type}</span>
                        </div>
                        <button onClick={() => removeQuestion(idx)} className="text-slate-600 hover:text-red-400 text-sm transition-colors">✕</button>
                      </div>

                      <textarea value={q.question} onChange={e => updateQuestion(idx, 'question', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-white text-sm resize-none focus:border-indigo-500/50 focus:outline-none mb-3"
                        rows={2} />

                      {q.type === 'mcq' && (
                        <div className="space-y-1.5 mb-3">
                          {(q.options || ['A) ', 'B) ', 'C) ', 'D) ']).map((opt, oIdx) => (
                            <input key={oIdx} value={opt} onChange={e => updateOption(idx, oIdx, e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-slate-300 focus:border-indigo-500/50 focus:outline-none" />
                          ))}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-slate-500">Correct:</span>
                            {['A', 'B', 'C', 'D'].map(l => (
                              <button key={l} onClick={() => updateQuestion(idx, 'answer', l)}
                                className={`w-7 h-7 rounded-lg text-xs font-black border transition-all ${q.answer === l ? 'bg-emerald-500/30 border-emerald-500/50 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-white'}`}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {(q.type === 'fill_blank' || q.type === 'subjective') && (
                        <div className="mb-3">
                          <label className="text-xs text-slate-500 mb-1 block">Expected Answer</label>
                          <input value={q.answer || ''} onChange={e => updateQuestion(idx, 'answer', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-slate-300 focus:border-indigo-500/50 focus:outline-none" />
                        </div>
                      )}

                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Explanation</label>
                        <input value={q.explanation || ''} onChange={e => updateQuestion(idx, 'explanation', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/50 text-sm text-slate-500 focus:border-indigo-500/50 focus:outline-none" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button onClick={saveAssessment} disabled={saving}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all disabled:opacity-50 shadow-lg shadow-indigo-500/20">
                    {saving ? 'Saving...' : `Save Assessment (${editingQuestions.length} questions)`}
                  </button>
                  <button onClick={closeGenerate} className="px-5 py-3 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-400 hover:text-white transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === Detail Modal === */}
      {viewDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setViewDetail(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 sticky top-0 bg-slate-900">
              <div>
                <h3 className="text-lg font-black text-white">{viewDetail.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{viewDetail.questions?.length || 0} questions · {getModuleName(viewDetail.moduleId)}</p>
              </div>
              <button onClick={() => setViewDetail(null)} className="text-slate-500 hover:text-white text-xl">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {(viewDetail.questions || []).map((q, i) => (
                <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-black text-slate-500">Q{i + 1}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold border uppercase ${DIFFICULTY_COLORS[q.difficulty] || DIFFICULTY_COLORS.medium}`}>{q.difficulty}</span>
                    <span className="text-xs font-bold text-slate-500 uppercase">{TYPE_LABELS[q.type] || q.type}</span>
                  </div>
                  <p className="text-sm text-white mb-3">{q.question}</p>
                  {q.options && (
                    <div className="space-y-1 mb-3">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={`px-3 py-1.5 rounded-lg text-xs ${q.answer === String.fromCharCode(65 + oi) ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold' : 'text-slate-400'}`}>{opt}</div>
                      ))}
                    </div>
                  )}
                  {!q.options && q.answer && (
                    <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 mb-2">
                      Answer: {q.answer}
                    </div>
                  )}
                  {q.explanation && <p className="text-xs text-slate-500 italic">{q.explanation}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
