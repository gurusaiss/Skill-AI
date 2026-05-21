import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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
  if (text) {
    try { data = JSON.parse(text); } catch { throw new Error(`Server returned non-JSON (${res.status})`); }
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export default function Session() {
  const { day } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!user) { navigate('/'); return; }
    loadChallenge();
  }, [user, navigate, day]);

  const loadChallenge = async () => {
    setLoading(true);
    try {
      const uid = user.userId || user.id;
      const data = await authFetch(`/api/session/challenge/${uid}/${day}`);
      setChallenge(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!response.trim()) return;
    setSubmitting(true);
    try {
      const uid = user.userId || user.id;
      const data = await authFetch('/api/session/submit', {
        method: 'POST',
        body: JSON.stringify({
          day: parseInt(day),
          skillId: challenge?.planDay?.skillId,
          challenge: challenge?.challenge,
          userResponse: response,
        }),
      });
      setResult(data);
    } catch (e) {
      alert(e.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <div className="text-slate-400 text-sm">Loading day {day}...</div>
        </div>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-center">
          <div className="text-4xl mb-4">📭</div>
          <p className="text-slate-400">Challenge not found for day {day}</p>
          <button onClick={() => navigate('/employee/dashboard')} className="mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm">Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white px-4 sm:px-6 py-8 max-w-4xl mx-auto">
      <button onClick={() => navigate('/employee/dashboard')} className="text-slate-400 hover:text-white text-sm mb-6 flex items-center gap-2">← Back to Dashboard</button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold">DAY {day}</span>
          <h1 className="text-3xl font-black text-white">{challenge.planDay?.skillName || 'Learning Session'}</h1>
        </div>
        <p className="text-slate-400">{challenge.planDay?.objective}</p>
      </div>

      {!result ? (
        <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60 p-8">
          <h3 className="text-lg font-bold text-white mb-4">Challenge</h3>
          <div className="prose prose-invert max-w-none mb-6 text-slate-300">
            <p>{challenge.challenge?.description || 'Complete the task below.'}</p>
          </div>

          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-bold text-slate-400 uppercase mb-2">Your Response</label>
            <textarea
              value={response}
              onChange={e => setResponse(e.target.value)}
              placeholder="Write your solution or answer here..."
              className="w-full h-48 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
              required
            />
            <div className="mt-4 flex gap-3">
              <button type="submit" disabled={submitting || !response.trim()} className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-sm font-bold disabled:opacity-50 transition-all">
                {submitting ? 'Submitting...' : 'Submit Response'}
              </button>
              <button type="button" onClick={() => navigate('/employee/dashboard')} className="px-6 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm font-semibold hover:bg-slate-700">Cancel</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-4xl">🎉</span>
            <div>
              <h2 className="text-2xl font-black text-white">Session Complete!</h2>
              <p className="text-emerald-400">Great work on Day {day}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="rounded-xl bg-slate-800/50 p-5 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Score</p>
              <p className="text-4xl font-black text-white">{result.evaluation?.score || 0}<span className="text-2xl text-emerald-400">%</span></p>
            </div>
            <div className="rounded-xl bg-slate-800/50 p-5 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Grade</p>
              <p className="text-4xl font-black text-white">{result.evaluation?.grade || '—'}</p>
            </div>
            <div className="rounded-xl bg-slate-800/50 p-5 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-bold uppercase tracking-widest mb-1">Next Day</p>
              <p className="text-4xl font-black text-white">{result.nextDay || '🎉'}</p>
            </div>
          </div>

          {result.evaluation?.feedback && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-emerald-400 uppercase tracking-widest mb-2">Feedback</h4>
              <p className="text-slate-300">{result.evaluation.feedback}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => navigate('/employee/dashboard')} className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-bold">Back to Dashboard</button>
            {result.nextDay && <button onClick={() => navigate(`/session/${result.nextDay}`)} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold">Continue to Day {result.nextDay}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
