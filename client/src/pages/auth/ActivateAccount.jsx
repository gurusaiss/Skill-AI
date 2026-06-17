import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ActivateAccount() {
  const [params] = useSearchParams();
  const navigate  = useNavigate();
  const { login } = useAuth();
  const token     = params.get('token');

  const [status, setStatus]     = useState('loading'); // loading | valid | invalid | done
  const [info, setInfo]         = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    fetch(`/api/auth/validate-token/${token}`)
      .then(r => r.json())
      .then(res => {
        if (res?.data?.valid) { setInfo(res.data); setStatus('valid'); }
        else setStatus('invalid');
      })
      .catch(() => setStatus('invalid'));
  }, [token]);

  const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/auth/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Activation failed');
      // Auto-login
      localStorage.setItem('auth_token', data.data.token);
      await login(data.data.user.email, password);
      setStatus('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500';

  if (status === 'loading') return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <p className="text-slate-400">Verifying your invitation link…</p>
    </div>
  );

  if (status === 'invalid') return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
      <div className="bg-[#1E293B] border border-red-500/30 rounded-xl p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-white mb-2">Invalid or Expired Link</h2>
        <p className="text-sm text-slate-400 mb-6">This activation link is no longer valid. It may have already been used or expired after 72 hours. Ask your admin to resend the invitation.</p>
        <button onClick={() => navigate('/auth/login')} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
          Go to Login
        </button>
      </div>
    </div>
  );

  if (status === 'done') return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
      <div className="bg-[#1E293B] border border-emerald-500/30 rounded-xl p-8 max-w-sm w-full text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-lg font-bold text-white mb-2">Account Activated!</h2>
        <p className="text-sm text-slate-400 mb-6">Your password has been set and you're logged in. Redirecting to your dashboard…</p>
        <button onClick={() => navigate('/')} className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
          Go to Dashboard
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="p-6 border-b border-slate-700 text-center">
          <h1 className="text-xl font-bold text-white">Set Up Your Account</h1>
          {info?.name && <p className="text-sm text-slate-400 mt-1">Welcome, {info.name}</p>}
          {info?.email && <p className="text-xs text-indigo-400 mt-0.5">{info.email}</p>}
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-slate-400">Choose a password to complete your account setup. You won't be able to reuse this link after activating.</p>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="Min. 6 characters" required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Confirm Password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} placeholder="Repeat password" required />
          </div>
          {error && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{error}</p>}
          <button type="submit" disabled={saving} className="w-full py-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Activating…' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
