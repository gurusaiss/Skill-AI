/**
 * ModuleDashboard.jsx
 * Inside-module learning environment.
 * Route: /module/:moduleId/learn?assignmentId=xxx
 * Shows Overview, Sessions (day-wise), Progress, Plan, Build tabs.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';

const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `Request failed (${res.status})`);
  return data?.data ?? data;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDifficultyColor = (d) => {
  const m = { beginner: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', intermediate: 'text-amber-400 bg-amber-500/10 border-amber-500/30', advanced: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
  return m[(d || '').toLowerCase()] || m.beginner;
};

const SessionStatusIcon = ({ status }) => {
  if (status === 'completed') return <span className="text-emerald-400 text-lg">✓</span>;
  if (status === 'in_progress') return <span className="text-indigo-400 text-lg animate-pulse">▶</span>;
  return <span className="text-slate-600 text-lg">○</span>;
};

// ─── SubViews ─────────────────────────────────────────────────────────────────

function OverviewTab({ module, assignment, sessionStatuses }) {
  const sessions = module?.sessions || module?.content?.sessions || [];
  const completed = sessions.filter((_, i) => sessionStatuses[i] === 'completed').length;
  const pct = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Hero card */}
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-600/10 to-purple-600/5 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-black text-white mb-2 leading-tight">{module?.title || 'Module'}</h2>
            <p className="text-slate-300 text-sm leading-relaxed line-clamp-3 mb-4">
              {module?.description || module?.content?.description || 'No description available.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {module?.difficulty && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getDifficultyColor(module.difficulty)}`}>
                  {module.difficulty}
                </span>
              )}
              {module?.duration && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700/40 border border-slate-600/40 text-slate-300">
                  ⏱ {module.duration} hrs
                </span>
              )}
              {sessions.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700/40 border border-slate-600/40 text-slate-300">
                  📚 {sessions.length} sessions
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" fill="none" stroke="#1e293b" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke="#6366f1" strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 32}`}
                  strokeDashoffset={`${2 * Math.PI * 32 * (1 - pct / 100)}`}
                  strokeLinecap="round" className="transition-all duration-700" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-white">{pct}%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Progress</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Sessions', value: sessions.length, icon: '📚', color: 'indigo' },
          { label: 'Completed', value: completed, icon: '✅', color: 'emerald' },
          { label: 'Remaining', value: sessions.length - completed, icon: '⏳', color: 'amber' },
          { label: 'Progress', value: `${pct}%`, icon: '📊', color: 'purple' },
        ].map(s => {
          const cls = { indigo: 'border-indigo-500/20 bg-indigo-500/5 text-indigo-400', emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400', amber: 'border-amber-500/20 bg-amber-500/5 text-amber-400', purple: 'border-purple-500/20 bg-purple-500/5 text-purple-400' }[s.color];
          return (
            <div key={s.label} className={`rounded-xl border p-4 ${cls}`}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-xs font-bold uppercase tracking-widest mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Skills */}
      {(module?.skills?.length > 0 || module?.content?.skills?.length > 0) && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Skills Covered</h3>
          <div className="flex flex-wrap gap-2">
            {(module.skills || module.content?.skills || []).map((skill, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600/15 border border-indigo-500/25 text-indigo-300">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionsTab({ module, moduleId, assignmentId, sessionStatuses, onRegenerate }) {
  const navigate = useNavigate();
  const sessions = module?.sessions || module?.content?.sessions || [];

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-30">📚</div>
        <p className="text-lg font-bold text-slate-400 mb-2">No Sessions Yet</p>
        <p className="text-sm text-slate-600 mb-6">Click below to generate AI-powered learning sessions for this module.</p>
        <button
          onClick={onRegenerate}
          className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-500/25"
        >
          🧠 Generate Learning Content
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-4">
        {sessions.length} Learning Sessions · Click to begin
      </p>
      {sessions.map((session, index) => {
        const status = sessionStatuses[index] || 'locked';
        const isUnlocked = index === 0 || sessionStatuses[index - 1] === 'completed';
        const isCompleted = status === 'completed';
        const isInProgress = status === 'in_progress';

        return (
          <button
            key={index}
            disabled={!isUnlocked && !isCompleted}
            onClick={() => {
              if (!isUnlocked && !isCompleted) return;
              navigate(`/module/${moduleId}/session/${index}${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
            }}
            className={`w-full text-left rounded-xl border p-4 transition-all group ${
              isCompleted
                ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer'
                : isUnlocked
                ? 'border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 cursor-pointer hover:border-indigo-500/50'
                : 'border-slate-700/40 bg-slate-800/20 opacity-50 cursor-not-allowed'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0 ${
                isCompleted ? 'bg-emerald-500/20 text-emerald-400' : isUnlocked ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700/40 text-slate-600'
              }`}>
                {isCompleted ? '✓' : index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold text-white truncate">
                    {session.title || session.topic || `Day ${index + 1}`}
                  </p>
                  {isInProgress && (
                    <span className="text-xs font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded-full">In Progress</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {session.description || session.objective || (session.topics ? `Topics: ${session.topics.join(', ')}` : 'Click to start learning')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {session.duration && (
                  <span className="text-xs text-slate-600 hidden sm:block">⏱ {session.duration}</span>
                )}
                {!isUnlocked && !isCompleted ? (
                  <span className="text-slate-600">🔒</span>
                ) : (
                  <span className={`text-lg group-hover:translate-x-1 transition-transform ${isCompleted ? 'text-emerald-400' : 'text-indigo-400'}`}>
                    {isCompleted ? '↺' : '→'}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProgressTab({ module, assignment, sessionStatuses }) {
  const sessions = module?.sessions || module?.content?.sessions || [];
  const completed = sessions.filter((_, i) => sessionStatuses[i] === 'completed').length;
  const pct = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;
  const sessionReports = assignment?.progress_data?.sessionReports || {};

  // Average score across completed sessions that have a report
  const reportValues = Object.values(sessionReports);
  const avgScore = reportValues.length > 0
    ? Math.round(reportValues.reduce((s, r) => s + (r.score || 0), 0) / reportValues.length)
    : null;

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Overall Progress</h3>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1 h-4 rounded-full bg-slate-700/60 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xl font-black text-white w-12 text-right">{pct}%</span>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-sm text-slate-400">{completed} of {sessions.length} sessions completed</p>
          {avgScore !== null && (
            <p className="text-sm text-slate-400">
              Avg quiz score: <span className={`font-bold ${avgScore >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>{avgScore}%</span>
            </p>
          )}
        </div>
      </div>

      {/* Per-session breakdown */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
        <div className="p-4 border-b border-slate-700/40">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Session Breakdown</h3>
        </div>
        <div className="divide-y divide-slate-700/30">
          {sessions.map((session, index) => {
            const status = sessionStatuses[index] || 'pending';
            const report = sessionReports[index];
            const quizScore = report?.score ?? null;
            return (
              <div key={index} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <SessionStatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{session.title || `Day ${index + 1}`}</p>
                    {report?.completedAt && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Completed {new Date(report.completedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {quizScore !== null && (
                      <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${
                        quizScore >= 90 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : quizScore >= 70 ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        {quizScore}%
                      </span>
                    )}
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
                      status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : status === 'in_progress' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                      : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                    }`}>
                      {status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                {/* Strengths / weaknesses summary if available */}
                {report && (report.strengths?.length > 0 || report.weaknesses?.length > 0) && (
                  <div className="mt-2 ml-9 flex gap-4">
                    {report.strengths?.length > 0 && (
                      <p className="text-xs text-emerald-500/70 truncate max-w-[200px]">
                        ✓ Strong: {report.strengths[0]?.slice(0, 50)}…
                      </p>
                    )}
                    {report.weaknesses?.length > 0 && (
                      <p className="text-xs text-rose-500/70 truncate max-w-[200px]">
                        ✗ Review: {report.weaknesses[0]?.slice(0, 50)}…
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanTab({ module, onRegenerate }) {
  const roadmap = module?.roadmap || module?.content?.roadmap || [];
  const plan = module?.plan || module?.content?.plan || module?.learningPlan || '';

  if (roadmap.length === 0 && !plan) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-30">🗺️</div>
        <p className="text-lg font-bold text-slate-400 mb-2">No Roadmap Available</p>
        <p className="text-sm text-slate-600 mb-6">Generate AI learning content to create a personalized roadmap.</p>
        <button
          onClick={onRegenerate}
          className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all"
        >
          🧠 Generate Roadmap
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {roadmap.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Learning Roadmap</h3>
          </div>
          <div className="p-4 space-y-3">
            {roadmap.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400">
                    {i + 1}
                  </div>
                  {i < roadmap.length - 1 && <div className="w-0.5 flex-1 bg-slate-700/50 mt-1" />}
                </div>
                <div className="pb-4 flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{typeof step === 'string' ? step : step.title || step.phase || step.step || JSON.stringify(step)}</p>
                  {step.description && <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>}
                  {step.duration && <p className="text-xs text-slate-600 mt-0.5">⏱ {step.duration}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan && typeof plan === 'string' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Learning Plan</h3>
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{plan}</div>
        </div>
      )}
    </div>
  );
}

function BuildTab({ module }) {
  const projects = module?.projects || module?.content?.projects || module?.challenges || module?.content?.challenges || [];
  const resources = module?.resources || module?.content?.resources || [];

  return (
    <div className="space-y-6">
      {projects.length > 0 ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Projects & Challenges</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {projects.map((p, i) => (
              <div key={i} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-sm flex-shrink-0">🔨</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">{typeof p === 'string' ? p : p.title || p.name || `Project ${i + 1}`}</p>
                    {p.description && <p className="text-xs text-slate-500 mt-0.5">{p.description}</p>}
                    {p.difficulty && (
                      <span className={`inline-block mt-1 text-xs font-bold px-2 py-0.5 rounded-full border ${getDifficultyColor(p.difficulty)}`}>
                        {p.difficulty}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-slate-500">
          <div className="text-5xl mb-4 opacity-30">🔨</div>
          <p className="text-lg font-bold text-slate-400 mb-2">No Projects Yet</p>
          <p className="text-sm text-slate-600">Build projects will appear here once configured.</p>
        </div>
      )}

      {resources.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Resources</h3>
          </div>
          <div className="divide-y divide-slate-700/30">
            {resources.map((r, i) => (
              <div key={i} className="p-4 flex items-center gap-3">
                <span className="text-lg">📎</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{typeof r === 'string' ? r : r.title || r.name || `Resource ${i + 1}`}</p>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-colors">
                      {r.url}
                    </a>
                  )}
                  {r.type && <span className="text-xs text-slate-600 block">{r.type}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Module Navbar (inside-module) ───────────────────────────────────────────

function ModuleNavbar({ moduleId, assignmentId, activeTab, onTabChange }) {
  const navigate = useNavigate();
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'sessions', label: 'Sessions', icon: '📚' },
    { id: 'progress', label: 'Progress', icon: '📈' },
    { id: 'plan', label: 'Plan', icon: '🗺️' },
    { id: 'build', label: 'Build', icon: '🔨' },
  ];

  // Pass moduleId + assignmentId so each tool page can load module context
  const q = new URLSearchParams();
  if (moduleId) q.set('moduleId', moduleId);
  if (assignmentId) q.set('assignmentId', assignmentId);
  const qs = q.toString() ? `?${q.toString()}` : '';

  const toolLinks = [
    { label: 'Digital Twin', icon: '🧬', path: `/career-twin${qs}` },
    { label: 'Simulator', icon: '🔮', path: `/simulation${qs}` },
    { label: 'AI Interview', icon: '🎙️', path: `/interview${qs}` },
    { label: 'Report', icon: '📄', path: `/report${qs}` },
  ];

  return (
    <div className="sticky top-[57px] z-20 bg-[#0F172A]/95 backdrop-blur border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                activeTab === t.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 pl-4 border-l border-slate-800 flex-shrink-0">
            {toolLinks.map(l => (
              <button
                key={l.label}
                onClick={() => navigate(l.path)}
                title={l.label}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-all whitespace-nowrap"
              >
                <span>{l.icon}</span>
                <span className="hidden sm:block">{l.label}</span>
              </button>
            ))}
            <button
              onClick={() => navigate('/dashboard')}
              className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all whitespace-nowrap"
            >
              ← Exit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ModuleDashboard ─────────────────────────────────────────────────────

export default function ModuleDashboard() {
  const { moduleId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const assignmentId = searchParams.get('assignmentId');

  const [module, setModule] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState('');
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('sessions');
  // sessionStatuses: { [index]: 'pending' | 'in_progress' | 'completed' }
  const [sessionStatuses, setSessionStatuses] = useState({});

  useEffect(() => {
    loadData();
  }, [moduleId, assignmentId]);

  const loadData = async (skipGenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      const [modRes, assignRes] = await Promise.allSettled([
        authFetch(`/api/modules/${moduleId}`),
        assignmentId ? authFetch(`/api/assignments/${assignmentId}`) : Promise.resolve(null),
      ]);

      let mod = null;
      if (modRes.status === 'fulfilled' && modRes.value) {
        mod = modRes.value;
        setModule(mod);
      } else {
        throw new Error('Module not found');
      }

      if (assignRes.status === 'fulfilled' && assignRes.value) {
        setAssignment(assignRes.value);
        const progress = assignRes.value?.sessionProgress || assignRes.value?.progress_data?.sessions || {};
        // Ensure session 0 always has at least a 'pending' status, without losing other progress
        const initialStatuses = progress[0] !== undefined ? progress : { ...progress, 0: 'pending' };
        setSessionStatuses(initialStatuses);
      } else {
        setSessionStatuses({ 0: 'pending' });
      }

      // Auto-generate content if no sessions exist
      const sessions = mod?.sessions || mod?.content?.sessions || [];
      if (sessions.length === 0 && !skipGenerate) {
        await generateContent(mod);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateContent = async (currentModule) => {
    setGenerating(true);
    setGenerateStatus('🧠 AI is building your learning curriculum…');
    try {
      const messages = [
        '🧠 AI is analyzing the module topics…',
        '📚 Generating day-by-day learning sessions…',
        '🗺️ Creating your personalized roadmap…',
        '✅ Finalizing content and quiz topics…',
      ];
      let msgIdx = 0;
      const msgInterval = setInterval(() => {
        msgIdx = (msgIdx + 1) % messages.length;
        setGenerateStatus(messages[msgIdx]);
      }, 2500);

      const result = await authFetch(`/api/modules/${moduleId}/generate-content`, { method: 'POST' });
      clearInterval(msgInterval);

      if (result) {
        setModule(result);
        setGenerateStatus('✅ Content ready!');
        setTimeout(() => setGenerateStatus(''), 1000);
      }
    } catch (err) {
      console.error('Content generation failed:', err);
      setGenerateStatus('');
    } finally {
      setGenerating(false);
    }
  };

  if (loading || generating) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-3xl">🧠</div>
          </div>
          <p className="text-white font-bold text-base mb-2">
            {generating ? 'Generating Learning Content' : 'Loading Module'}
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">
            {generateStatus || 'Setting up your learning environment…'}
          </p>
          {generating && (
            <div className="mt-4 space-y-1.5">
              {['Analyzing module skills', 'Building day sessions', 'Creating roadmap', 'Preparing quizzes'].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-4 h-4 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-xs">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error || !module) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-white mb-2">Module Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <ModuleNavbar
        moduleId={moduleId}
        assignmentId={assignmentId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Regenerate button — shown when module has no sessions */}
        {(module?.sessions || module?.content?.sessions || []).length === 0 && !generating && (
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-amber-300">No learning content generated yet</p>
              <p className="text-xs text-slate-500 mt-0.5">AI will generate sessions, roadmap, and projects tailored to this module's topics</p>
            </div>
            <button
              onClick={() => generateContent(module)}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm transition-all flex-shrink-0"
            >
              🧠 Generate Now
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewTab module={module} assignment={assignment} sessionStatuses={sessionStatuses} />
        )}
        {activeTab === 'sessions' && (
          <SessionsTab
            module={module}
            moduleId={moduleId}
            assignmentId={assignmentId}
            sessionStatuses={sessionStatuses}
            onRegenerate={() => generateContent(module)}
          />
        )}
        {activeTab === 'progress' && (
          <ProgressTab module={module} assignment={assignment} sessionStatuses={sessionStatuses} />
        )}
        {activeTab === 'plan' && (
          <PlanTab module={module} onRegenerate={() => generateContent(module)} />
        )}
        {activeTab === 'build' && (
          <BuildTab module={module} />
        )}
      </div>
    </div>
  );
}
