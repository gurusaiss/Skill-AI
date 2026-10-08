import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authFetch } from '../utils/authFetch.js';

export default function ModuleLearn() {
  const { moduleId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const assignmentId = new URLSearchParams(location.search).get('assignmentId');
  const [module, setModule] = useState(null);
  const [sessionIdx, setSessionIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (moduleId) loadModule();
  }, [moduleId]);

  const loadModule = async () => {
    try {
      const mod = await authFetch(`/api/modules/${moduleId}`);
      setModule(mod);
      if (mod.content?.sessions?.length) setSessionIdx(0);
      if (mod.progress !== undefined) setProgress(mod.progress);
    } catch (e) {
      setLoadError(e?.message || 'Could not load this module.');
    } finally { setLoading(false); }
  };

  const markComplete = async (day) => {
    const newPct = Math.min(100, Math.round(((sessionIdx + 1) / (module?.content?.sessions?.length || 7)) * 100));
    setProgress(newPct);
    if (sessionIdx < (module?.content?.sessions?.length || 7) - 1) {
      setSessionIdx(sessionIdx + 1);
    }
    if (assignmentId) {
      try { await authFetch(`/api/assignments/${assignmentId}`, { method: 'PUT', body: JSON.stringify({ progress: newPct, status: newPct >= 100 ? 'completed' : 'in_progress' }) }); } catch (e) { setLoadError('Progress could not be saved: ' + (e?.message || 'network error')); }
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
    </div>
  );

  const sessions = module?.content?.sessions || [];
  const current = sessions[sessionIdx] || sessions[0];
  if (!current) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
      <div className="text-center text-slate-300 text-base">
        {loadError ? (<><p className="text-red-300 mb-3">{loadError}</p><button type="button" onClick={() => { setLoadError(''); setLoading(true); loadModule(); }} className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold">Retry</button></>) : 'No sessions available for this module.'}
      </div>
    </div>
  );

  const getTypeColor = (type) => {
    const map = { concept: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20', practice: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', assessment: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
    return map[type] || 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  };

  return (
    <div className="min-h-screen bg-[#0F172A] py-6 px-3 sm:px-5 lg:px-6 2xl:px-8">
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/dashboard')} className="text-slate-400 hover:text-white text-sm flex items-center gap-2">← Dashboard</button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">Progress: <span className="text-emerald-400 font-bold">{progress}%</span></span>
            <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        {module && (
          <div className="rounded-2xl border border-slate-700/30 bg-slate-900/60 p-6 mb-6">
            <div className="flex items-start gap-4">
              <div>
                <h1 className="text-2xl font-black text-white mb-1">{module.title}</h1>
                <p className="text-slate-400 text-sm mb-2">{module.description}</p>
                <div className="flex flex-wrap gap-2">
                  {module.difficulty && <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-300 border-blue-500/20 capitalize">{module.difficulty}</span>}
                  {module.estimated_duration && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">⏱ {module.estimated_duration}</span>}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">Session {sessionIdx + 1} of {sessions.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Learning Sessions</h3>
            {sessions.map((s, i) => (
              <button key={i}
                onClick={() => setSessionIdx(i)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  i === sessionIdx
                    ? 'bg-indigo-600/15 border-indigo-500/30 text-white'
                    : i < sessionIdx
                      ? 'bg-emerald-600/10 border-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800/30 border-slate-700/30 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2 justify-between">
                  <span className="text-xs font-bold">{i < sessionIdx ? '✅' : i === sessionIdx ? '▶' : '○'} Day {s.day || i + 1}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${getTypeColor(s.type)}`}>{s.type}</span>
                </div>
                <p className="text-xs font-semibold mt-1 truncate">{s.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.duration}</p>
              </button>
            ))}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-white">{current.title}</h2>
                <span className={`text-xs px-2 py-1 rounded-full border font-bold capitalize ${getTypeColor(current.type)}`}>{current.type} Session</span>
              </div>

              {current.concepts && current.concepts.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-2">Key Concepts</h3>
                  <div className="flex flex-wrap gap-2">
                    {current.concepts.map((c, i) => (
                      <span key={i} className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {current.activities && current.activities.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-2">Activities</h3>
                  <ul className="space-y-2">
                    {current.activities.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="text-cyan-400 mt-0.5">◇</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {current.practice && current.practice.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-2">Practice Tasks</h3>
                  <ul className="space-y-2">
                    {current.practice.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <span className="text-emerald-400 mt-0.5">▸</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center">
              <button onClick={() => setSessionIdx(Math.max(0, sessionIdx - 1))}
                disabled={sessionIdx === 0}
                className="px-5 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700 text-sm font-semibold disabled:opacity-30 transition-all">
                ← Previous Session
              </button>

              {sessionIdx < sessions.length - 1 ? (
                <button onClick={() => markComplete(sessionIdx)}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold transition-all">
                  Complete & Continue →
                </button>
              ) : (
                <button onClick={() => navigate('/report')}
                  className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-bold transition-all">
                  🎉 View Report
                </button>
              )}
            </div>

            {sessionIdx === 0 && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-indigo-300">
                💡 Based on your quiz results, 9 AI agents have tailored this learning path to focus on your knowledge gaps. Complete each session to build mastery.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}