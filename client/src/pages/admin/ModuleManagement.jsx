import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../utils/authFetch.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';

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

function SessionsEditor({ sessions = [], onChange }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  const update = (idx, field, value) => {
    const next = sessions.map((s, i) => i === idx ? { ...s, [field]: value } : s);
    onChange(next);
  };

  const updateQuiz = (sIdx, qIdx, field, value) => {
    const next = sessions.map((s, i) => {
      if (i !== sIdx) return s;
      const quiz = (s.quiz || []).map((q, qi) => qi === qIdx ? { ...q, [field]: value } : q);
      return { ...s, quiz };
    });
    onChange(next);
  };

  const updateQuizOption = (sIdx, qIdx, oIdx, value) => {
    const next = sessions.map((s, i) => {
      if (i !== sIdx) return s;
      const quiz = (s.quiz || []).map((q, qi) => {
        if (qi !== qIdx) return q;
        const options = (q.options || []).map((o, oi) => oi === oIdx ? value : o);
        return { ...q, options };
      });
      return { ...s, quiz };
    });
    onChange(next);
  };

  const addQuestion = (sIdx) => {
    const next = sessions.map((s, i) => {
      if (i !== sIdx) return s;
      const newQ = { question: '', options: ['A) ', 'B) ', 'C) ', 'D) '], answer: 'A', explanation: '' };
      return { ...s, quiz: [...(s.quiz || []), newQ] };
    });
    onChange(next);
  };

  const removeQuestion = (sIdx, qIdx) => {
    const next = sessions.map((s, i) => {
      if (i !== sIdx) return s;
      return { ...s, quiz: (s.quiz || []).filter((_, qi) => qi !== qIdx) };
    });
    onChange(next);
  };

  if (!sessions.length) return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center">
      <p className="text-xs text-slate-500">No sessions yet — sessions are generated automatically after saving with AI content.</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Sessions & Quizzes ({sessions.length})</label>
      {sessions.map((session, sIdx) => {
        const isOpen = expandedIdx === sIdx;
        const quizCount = session.quiz?.length || 0;
        return (
          <div key={sIdx} className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden">
            {/* Session header - click to expand */}
            <button
              type="button"
              onClick={() => setExpandedIdx(isOpen ? null : sIdx)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-700/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300">
                  {session.dayNumber || sIdx + 1}
                </span>
                <span className="text-sm font-semibold text-white truncate">
                  {session.title || `Day ${sIdx + 1}`}
                </span>
                <span className="text-xs text-slate-500">{quizCount} question{quizCount !== 1 ? 's' : ''}</span>
              </div>
              <span className="text-slate-500 text-sm">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-slate-700/40 p-4 space-y-4">
                {/* Session title */}
                <div>
                  <label className="block text-xs text-slate-500 font-semibold mb-1">Session Title</label>
                  <input
                    type="text"
                    value={session.title || ''}
                    onChange={e => update(sIdx, 'title', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Topics */}
                <div>
                  <label className="block text-xs text-slate-500 font-semibold mb-1">Topics (comma-separated)</label>
                  <input
                    type="text"
                    value={(session.topics || []).join(', ')}
                    onChange={e => update(sIdx, 'topics', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Key Points */}
                <div>
                  <label className="block text-xs text-slate-500 font-semibold mb-1">Key Points (one per line)</label>
                  <textarea
                    rows={3}
                    value={(session.keyPoints || []).join('\n')}
                    onChange={e => update(sIdx, 'keyPoints', e.target.value.split('\n').map(t => t.trim()).filter(Boolean))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-none"
                  />
                </div>

                {/* Quiz questions */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-500 font-semibold">Quiz Questions</label>
                    <button
                      type="button"
                      onClick={() => addQuestion(sIdx)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-bold px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all"
                    >
                      + Add Question
                    </button>
                  </div>

                  {(session.quiz || []).length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-2">No questions — click "Add Question"</p>
                  ) : (session.quiz || []).map((q, qIdx) => (
                    <div key={qIdx} className="rounded-lg border border-slate-700/50 bg-slate-900/60 p-3 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-black text-slate-500 mt-1">Q{qIdx + 1}</span>
                        <textarea
                          rows={2}
                          value={q.question || ''}
                          onChange={e => updateQuiz(sIdx, qIdx, 'question', e.target.value)}
                          placeholder="Question text..."
                          className="flex-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none resize-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeQuestion(sIdx, qIdx)}
                          className="w-6 h-6 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center justify-center text-xs flex-shrink-0"
                        >✕</button>
                      </div>

                      {/* Options A-D */}
                      <div className="space-y-1.5 ml-6">
                        {(q.options || ['A) ', 'B) ', 'C) ', 'D) ']).map((opt, oIdx) => {
                          const letter = String.fromCharCode(65 + oIdx);
                          const isCorrect = (q.answer || 'A') === letter;
                          return (
                            <div key={oIdx} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateQuiz(sIdx, qIdx, 'answer', letter)}
                                className={`w-5 h-5 rounded-full border flex-shrink-0 flex items-center justify-center text-xs font-black transition-all ${isCorrect ? 'bg-emerald-500/30 border-emerald-500/60 text-emerald-300' : 'border-slate-600 text-slate-500 hover:border-indigo-500/50'}`}
                                title="Mark as correct answer"
                              >
                                {isCorrect ? '✓' : letter}
                              </button>
                              <input
                                type="text"
                                value={opt}
                                onChange={e => updateQuizOption(sIdx, qIdx, oIdx, e.target.value)}
                                className="flex-1 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:border-indigo-500 focus:outline-none"
                              />
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation */}
                      <div className="ml-6">
                        <input
                          type="text"
                          value={q.explanation || ''}
                          onChange={e => updateQuiz(sIdx, qIdx, 'explanation', e.target.value)}
                          placeholder="Explanation for correct answer..."
                          className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Module Detail Panel ──────────────────────────────────────────────────────
function ModuleDetailPanel({ mod, onClose, onEdit, onDelete }) {
  const [detailTab, setDetailTab] = useState('overview');
  const [assignments, setAssignments] = useState([]);
  const [assignLoading, setAssignLoading] = useState(false);

  useEffect(() => {
    if (!mod) return;
    setAssignLoading(true);
    authFetch(`/api/assignments?moduleId=${mod.id}`)
      .then(res => setAssignments(Array.isArray(res) ? res : (res?.assignments || [])))
      .catch(() => setAssignments([]))
      .finally(() => setAssignLoading(false));
  }, [mod]);

  if (!mod) return null;

  const sessions = mod.content?.sessions || mod.sessions || mod.roadmap || [];
  const skills = (mod.skills || []).filter(Boolean);
  const resources = (mod.resources || []).filter(r => typeof r === 'object' && r !== null);
  const isAutoGenerated = !!(mod.content?.isMandatory || mod.content?.assessmentSource);

  // Analytics computations
  const assignedCount = assignments.length;
  const activeCount = assignments.filter(a => {
    const d = a.data || a;
    return d.status === 'active' || d.status === 'in_progress' || (typeof d.progress === 'number' && d.progress > 0 && d.progress < 100);
  }).length;
  const completedCount = assignments.filter(a => {
    const d = a.data || a;
    return d.status === 'completed' || d.progress === 100 || d.completedAt;
  }).length;
  const completionPct = assignedCount > 0 ? Math.round((completedCount / assignedCount) * 100) : 0;
  const avgProgress = assignedCount > 0
    ? Math.round(assignments.reduce((sum, a) => {
        const d = a.data || a;
        return sum + (typeof d.progress === 'number' ? d.progress : (d.status === 'completed' ? 100 : 0));
      }, 0) / assignedCount)
    : 0;

  const DETAIL_TABS = ['overview', 'sessions', 'employees', 'analytics'];

  const StatCard = ({ label, value, sub, color = 'indigo' }) => {
    const colors = {
      indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
      emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      cyan: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
      purple: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
    };
    return (
      <div className={`rounded-xl border p-4 ${colors[color]}`}>
        <p className="text-2xl font-black">{value}</p>
        <p className="text-xs font-bold mt-0.5 opacity-80">{label}</p>
        {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-[#0F172A] border-l border-slate-700/60 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-700/40">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-black text-white truncate">{mod.title}</h2>
              {isAutoGenerated && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-300 font-bold flex-shrink-0">Mandatory</span>
              )}
            </div>
            <p className="text-xs text-slate-400 line-clamp-2">{mod.description}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onEdit(mod)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-bold transition-all"
            >
              Edit
            </button>
            <button
              onClick={() => { onDelete(mod.id); onClose(); }}
              className="w-7 h-7 rounded-lg bg-slate-700/50 hover:bg-red-500/20 border border-transparent hover:border-red-500/30 text-slate-400 hover:text-red-300 flex items-center justify-center text-xs transition-all"
            >
              ✕
            </button>
            <button onClick={onClose} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-sm transition-all ml-1">
              ←
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700/40 px-6">
          {DETAIL_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-3 text-xs font-bold capitalize transition-colors border-b-2 -mb-px ${
                detailTab === tab
                  ? 'border-indigo-500 text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* OVERVIEW TAB */}
          {detailTab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Category</p>
                  <p className="text-sm font-bold text-white">{mod.category || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Difficulty</p>
                  <p className="text-sm font-bold text-white capitalize">{mod.difficulty || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Duration</p>
                  <p className="text-sm font-bold text-white">{mod.estimatedDuration || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                  <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Type</p>
                  <p className="text-sm font-bold text-white">{isAutoGenerated ? 'Mandatory / Auto' : 'Manual'}</p>
                </div>
              </div>

              {skills.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {skills.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {(mod.targetRoles || []).length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Target Roles</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(mod.targetRoles || []).map((r, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-slate-700/40 border border-slate-600/30 text-slate-300 text-xs font-semibold">{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {resources.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">External Resources</p>
                  <div className="space-y-1.5">
                    {resources.map((r, i) => (
                      <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 text-xs font-medium transition-colors">
                        🔗 {r.title || r.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Completion Criteria</p>
                <p className="text-sm text-slate-300">{mod.completionCriteria || 'Complete all tasks'}</p>
              </div>
            </div>
          )}

          {/* SESSIONS TAB */}
          {detailTab === 'sessions' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</p>
              {sessions.length === 0 ? (
                <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-8 text-center">
                  <p className="text-slate-500 text-sm">No sessions defined for this module.</p>
                </div>
              ) : sessions.map((s, i) => {
                const quizCount = s.quiz?.length || 0;
                return (
                  <div key={i} className="rounded-xl border border-slate-700/40 bg-slate-800/30 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-300 flex-shrink-0">
                        {s.dayNumber || i + 1}
                      </span>
                      <p className="text-sm font-bold text-white flex-1">{s.title || `Day ${i + 1}`}</p>
                      {quizCount > 0 && (
                        <span className="text-xs text-slate-500">{quizCount} Q{quizCount !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    {(s.topics || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {s.topics.map((t, ti) => (
                          <span key={ti} className="text-xs text-slate-400 bg-slate-700/30 px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* EMPLOYEES TAB */}
          {detailTab === 'employees' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{assignedCount} employee{assignedCount !== 1 ? 's' : ''} assigned</p>
              {assignLoading ? (
                <div className="space-y-2">
                  {[0,1,2].map(i => (
                    <div key={i} className="rounded-xl border border-slate-700/40 bg-slate-800/30 h-14 animate-pulse" />
                  ))}
                </div>
              ) : assignments.length === 0 ? (
                <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-8 text-center">
                  <p className="text-slate-500 text-sm">No employees assigned to this module yet.</p>
                </div>
              ) : assignments.map((a, i) => {
                const d = a.data || a;
                const name = d.employeeName || d.employee_name || d.userId || 'Employee';
                const progress = typeof d.progress === 'number' ? d.progress : (d.status === 'completed' ? 100 : 0);
                const status = d.status || (progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'assigned');
                const statusColors = {
                  completed: 'text-emerald-400',
                  in_progress: 'text-indigo-400',
                  active: 'text-indigo-400',
                  assigned: 'text-slate-400',
                };
                return (
                  <div key={a.id || i} className="rounded-xl border border-slate-700/40 bg-slate-800/30 px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-semibold text-white">{name}</p>
                      <span className={`text-xs font-bold capitalize ${statusColors[status] || 'text-slate-400'}`}>{status.replace('_', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 font-semibold w-8 text-right">{progress}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ANALYTICS TAB */}
          {detailTab === 'analytics' && (
            <div className="space-y-5">
              {assignLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[0,1,2,3,4].map(i => (
                    <div key={i} className="rounded-xl border border-slate-700/40 h-20 animate-pulse bg-slate-800/30" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard label="Assigned Users" value={assignedCount} color="indigo" />
                    <StatCard label="Active Users" value={activeCount} sub="Progress 1–99%" color="cyan" />
                    <StatCard label="Completed Users" value={completedCount} color="emerald" />
                    <StatCard label="Completion %" value={`${completionPct}%`} sub={`${completedCount} of ${assignedCount}`} color="amber" />
                    <StatCard label="Average Progress" value={`${avgProgress}%`} sub="Across all assignees" color="purple" />
                  </div>

                  {/* Progress distribution bar */}
                  {assignedCount > 0 && (
                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 p-4">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-3">Distribution</p>
                      <div className="space-y-2.5">
                        {[
                          { label: 'Not Started', count: assignments.filter(a => { const d = a.data||a; return !d.progress && d.status !== 'completed'; }).length, color: 'bg-slate-600' },
                          { label: 'In Progress', count: activeCount, color: 'bg-indigo-500' },
                          { label: 'Completed', count: completedCount, color: 'bg-emerald-500' },
                        ].map(({ label, count, color }) => (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-400">{label}</span>
                              <span className="text-xs text-slate-400 font-semibold">{count} ({assignedCount > 0 ? Math.round(count / assignedCount * 100) : 0}%)</span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-700">
                              <div
                                className={`h-full rounded-full ${color} transition-all`}
                                style={{ width: assignedCount > 0 ? `${(count / assignedCount) * 100}%` : '0%' }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {assignedCount === 0 && (
                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-8 text-center">
                      <p className="text-slate-500 text-sm">No assignments found for analytics.</p>
                      <p className="text-xs text-slate-600 mt-1">Assign this module to employees to see analytics.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

  // Module detail panel state
  const [selectedModule, setSelectedModule] = useState(null);

  // Pending approvals state
  const [pendingModules, setPendingModules] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);

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
  const [extResources, setExtResources] = useState([]);

  const [form, setForm] = useState({
    title: '', description: '', category: 'Web Development', difficulty: 'beginner',
    estimatedDuration: '7 days', skills: [''], tasks: [''], resources: [''],
    completionCriteria: 'Complete all tasks', roadmap: [], sessions: [], quizzes: [],
    milestones: [], timeline: 14, targetRoles: '',
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
    milestones: [], timeline: 14, targetRoles: '',
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
    setExtResources([]);
    resetForm();
  };

  const openEdit = (mod) => {
    setEditing(mod);
    // Load structured external resources (objects with title/url/type)
    const existingExtResources = (mod.resources || []).filter(r => typeof r === 'object' && r !== null);
    setExtResources(existingExtResources);
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
      targetRoles: (mod.targetRoles || []).join(', '),
      roadmap: mod.roadmap || mod.sessions || [],
      sessions: mod.content?.sessions || mod.sessions || mod.roadmap || [],
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
    // External resources: only include entries with at least a URL
    const cleanExtResources = extResources.filter(r => r.url && r.url.trim());

    const modulePayload = {
      title: cleanTitle,
      description: cleanDesc || `Learn ${cleanTitle} with AI-generated content`,
      category: form.category || 'General',
      difficulty: form.difficulty || 'beginner',
      estimatedDuration: form.estimatedDuration || '7 days',
      skills: cleanSkills.length ? cleanSkills : [cleanTitle],
      tasks: cleanTasks,
      resources: cleanExtResources,
      completionCriteria: form.completionCriteria || 'Complete all tasks',
      targetRoles: (form.targetRoles || '').split(/[,;|]/).map(r => r.trim()).filter(Boolean),
      progressTracking: true,
      content: {
        ...(editing?.content || {}),
        roadmap: form.sessions || form.roadmap || [],
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
          <div className="flex gap-2">
            {['admin','manager','trainer'].includes(user?.role) && (
              <button
                onClick={() => setShowImportModal(true)}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-sm font-bold transition-all"
              >
                ⬆ Import Module
              </button>
            )}
            <button
              onClick={() => { setShowCreate(true); setEditing(null); setShowReviewForm(false); setShowAgentUI(false); }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold transition-all"
            >
              + New Module
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Category dropdown */}
          <SearchableSelect value={activeTab} onChange={setActiveTab} allLabel="All Types" options={categories} />

          {/* Job Role dropdown */}
          <SearchableSelect value={filterJobRole} onChange={setFilterJobRole} allLabel="All Job Roles" options={jobRoles} />

          {/* Assign Type dropdown */}
          <SearchableSelect value={filterAssignType} onChange={setFilterAssignType} allLabel="All Modules"
            options={[{ value: 'auto', label: 'Auto Assigned' }, { value: 'manual', label: 'Manual Assigned' }]} />

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
              style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 120px' }}>
              <span>Module</span>
              <span>Target / Role</span>
              <span>Sessions</span>
              <span>Duration</span>
              <span>Type</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-slate-700/20">
              {filtered.map((mod, idx) => {
                const sessions = mod.content?.sessions || [];
                const sessionCount = sessions.length;
                const questionCount = sessions.reduce((sum, s) => sum + (s.quiz?.length || 0), 0);
                const isAutoGenerated = !!(mod.content?.isMandatory || mod.content?.assessmentSource);
                const targetRole = mod.content?.jobRole || mod.jobRole || mod.category || '—';
                const targetEmployee = mod.content?.employeeName || '';
                const skills = (mod.skills || []).filter(Boolean);
                const isSelected = selectedModule?.id === mod.id;
                return (
                  <div key={mod.id || idx}
                    onClick={() => setSelectedModule(isSelected ? null : mod)}
                    className={`group px-6 py-4 hover:bg-slate-800/30 transition-all cursor-pointer ${isSelected ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''}`}
                    style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 120px', alignItems: 'center', gap: '12px' }}>
                    {/* Module info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-white truncate leading-tight">{mod.title}</p>
                        {isAutoGenerated && (
                          <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">Auto</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{mod.description}</p>
                      {skills.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {skills.slice(0, 2).map((s, si) => <span key={si} className="text-xs text-slate-600 bg-slate-700/30 px-1.5 rounded">{s}</span>)}
                          {skills.length > 2 && <span className="text-xs text-slate-600">+{skills.length - 2}</span>}
                        </div>
                      )}
                      {(mod.resources || []).filter(r => typeof r === 'object' && r !== null).length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/40">
                          <div className="flex flex-wrap gap-1.5">
                            {(mod.resources || []).filter(r => typeof r === 'object' && r !== null).slice(0, 3).map((r, i) => (
                              <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors">
                                🔗 {r.title || 'Resource ' + (i+1)}
                              </a>
                            ))}
                            {(mod.resources || []).filter(r => typeof r === 'object' && r !== null).length > 3 && (
                              <span className="text-xs text-slate-500">+{(mod.resources || []).filter(r => typeof r === 'object' && r !== null).length - 3} more</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Target / Role */}
                    <div className="min-w-0">
                      {targetEmployee && <p className="text-xs font-semibold text-slate-300 truncate">{targetEmployee}</p>}
                      <p className="text-xs text-slate-500 truncate">{targetRole}</p>
                    </div>
                    {/* Sessions */}
                    <div>
                      <p className="text-sm font-bold text-white">{sessionCount || '—'}</p>
                      {questionCount > 0 && <p className="text-xs text-slate-500">{questionCount} Qs</p>}
                    </div>
                    {/* Duration */}
                    <div>
                      <span className="text-xs text-slate-400">{mod.estimatedDuration || '—'}</span>
                    </div>
                    {/* Type */}
                    <div>
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-bold border capitalize ${
                        isAutoGenerated
                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          : 'bg-slate-700/40 text-slate-400 border-slate-600/30'
                      }`}>
                        {isAutoGenerated ? 'Mandatory' : 'Manual'}
                      </span>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={e => { e.stopPropagation(); openEdit(mod); }}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30 text-xs font-bold transition-all">
                        Edit
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDelete(mod.id); }}
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

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Auto-Assign to Roles <span className="text-slate-600 normal-case font-normal">(comma-separated role names)</span></label>
                <input
                  type="text" value={form.targetRoles} onChange={e => updateField('targetRoles', e.target.value)}
                  placeholder="e.g. Frontend Developer, Backend Developer"
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Employees assigned these roles will automatically receive this module.</p>
              </div>

              {/* External Resources */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                    External Resources <span className="text-slate-600 font-normal normal-case">(optional)</span>
                  </label>
                  <button type="button" onClick={() => setExtResources(p => [...p, { title: '', url: '', type: 'link' }])}
                    className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40">
                    + Add Link
                  </button>
                </div>
                <p className="text-xs text-slate-500 mb-2">Add Google Drive, OneDrive, SharePoint, or any other external links</p>
                {extResources.map((r, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input value={r.title} onChange={e => { const n=[...extResources]; n[i]={...n[i],title:e.target.value}; setExtResources(n); }}
                      placeholder="Resource name (e.g. Training Slides)" className="flex-1 bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
                    <input value={r.url} onChange={e => { const n=[...extResources]; n[i]={...n[i],url:e.target.value}; setExtResources(n); }}
                      placeholder="https://drive.google.com/..." className="flex-[2] bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
                    <button type="button" onClick={() => setExtResources(p => p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300 px-2">✕</button>
                  </div>
                ))}
                {extResources.length === 0 && <p className="text-xs text-slate-600 py-1">No external resources added.</p>}
              </div>

              {/* Sessions + Quiz editor */}
              <SessionsEditor sessions={form.sessions} onChange={s => updateField('sessions', s)} />

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

      {/* Import Module Modal */}
      {showImportModal && (
        <ImportModuleModal
          onClose={() => setShowImportModal(false)}
          onSuccess={(mod) => {
            setModules(prev => [mod, ...prev]);
            setToast({ message: 'Module imported successfully', type: 'success' });
            setShowImportModal(false);
          }}
          showToast={(msg, type) => setToast({ message: msg, type: type || 'info' })}
        />
      )}
    </div>
  );
}

function ImportModuleModal({ onClose, onSuccess, showToast }) {
  const [tab, setTab] = useState('file'); // 'file' | 'link'
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [title, setTitle] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkType, setLinkType] = useState('url');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = React.useRef();
  const ACCEPTED = '.pdf,.ppt,.pptx,.doc,.docx,.xlsx,.xls,.txt,.csv,.zip';

  const handleFile = (f) => {
    if (f && f.size > 50 * 1024 * 1024) { showToast('File exceeds 50 MB limit', 'error'); return; }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };

  const handleSubmit = async () => {
    setImporting(true);
    setStatus('Uploading…');
    try {
      const token = localStorage.getItem('auth_token');
      const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
      let res;
      if (tab === 'file') {
        if (!file) { showToast('Please select a file', 'error'); setImporting(false); return; }
        const fd = new FormData();
        fd.append('file', file);
        if (title) fd.append('title', title);
        setStatus('Processing file content…');
        res = await fetch(`${BASE_URL}/api/modules/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      } else {
        if (!externalUrl) { showToast('Please enter a URL', 'error'); setImporting(false); return; }
        res = await fetch(`${BASE_URL}/api/modules/import`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ externalUrl, linkTitle: linkTitle || externalUrl, linkType, title: linkTitle || externalUrl }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setStatus(`✓ ${data.data?.sectionsExtracted || 0} sections extracted`);
      onSuccess(data.data?.module);
    } catch (e) {
      showToast(e.message || 'Import failed', 'error');
      setStatus('');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div>
            <h3 className="text-lg font-black text-white">Import Module</h3>
            <p className="text-xs text-slate-500 mt-0.5">Upload a file or add an external link</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-slate-800/60 p-1 rounded-xl">
            {[{v:'file',l:'Upload File'},{v:'link',l:'External Link'}].map(({v,l}) => (
              <button key={v} onClick={() => setTab(v)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tab===v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'file' ? (
            <>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 hover:border-amber-500/50 hover:bg-slate-800/50'}`}
              >
                <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden" onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); }} />
                <div className="text-3xl mb-2">📁</div>
                {file ? (
                  <p className="text-sm font-semibold text-amber-300">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-300">Click or drag file here</p>
                    <p className="text-xs text-slate-500 mt-1">PDF, PPT, PPTX, DOC, DOCX, XLSX, TXT, CSV, ZIP · Max 50 MB</p>
                  </>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Module Title (optional)</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Auto-detected from filename"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-amber-500 focus:outline-none" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Link Type</label>
                <select value={linkType} onChange={e => setLinkType(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-amber-500 focus:outline-none">
                  <option value="url">Public URL</option>
                  <option value="google_drive">Google Drive</option>
                  <option value="onedrive">OneDrive</option>
                  <option value="sharepoint">SharePoint</option>
                  <option value="dropbox">Dropbox</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">URL</label>
                <input value={externalUrl} onChange={e => setExternalUrl(e.target.value)} placeholder="https://..."
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-amber-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Title</label>
                <input value={linkTitle} onChange={e => setLinkTitle(e.target.value)} placeholder="Module title"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm focus:border-amber-500 focus:outline-none" />
              </div>
            </>
          )}

          {status && <p className="text-xs text-amber-300 font-semibold">{status}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-bold text-slate-300 hover:text-white">Cancel</button>
            <button onClick={handleSubmit} disabled={importing}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-sm font-bold text-white disabled:opacity-40 transition-all">
              {importing ? 'Importing…' : '⬆ Import Module'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
