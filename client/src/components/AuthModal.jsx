import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

function fuzzyMatch(typed, roles) {
  if (!typed?.trim() || !roles?.length) return null;
  const q = typed.toLowerCase().trim().replace(/[-_/]+/g, ' ');
  const exact = roles.find(r => r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ').trim() === q);
  if (exact) return exact;
  const contains = roles.find(r => {
    const rn = r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ').trim();
    return rn && (rn.includes(q) || q.includes(rn));
  });
  if (contains) return contains;
  const qw = q.split(/\s+/).filter(Boolean);
  let best = null, bestScore = 0;
  for (const r of roles) {
    const rw = (r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ') || '').split(/\s+/).filter(Boolean);
    const overlap = qw.filter(w => rw.includes(w)).length;
    const score = overlap / Math.max(qw.length, rw.length, 1);
    if (score > bestScore && score >= 0.5) { best = r; bestScore = score; }
  }
  return best;
}

const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none transition-all duration-200 text-sm';
const labelCls = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';

const AuthModal = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [formData, setFormData] = useState({
    email: '', password: '', name: '', companyCode: '', jobRole: '', acceptedTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Code validation state
  const [codeStatus, setCodeStatus] = useState(null); // null | 'checking' | {ok, companyName, detectedRole} | {error}
  const codeTimer = useRef(null);

  // Job role suggestions state
  const [roleOptions, setRoleOptions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [matchedRole, setMatchedRole] = useState(null);

  const { login, register, getDashboardRoute } = useAuth();
  const navigate = useNavigate();

  // Reset when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setMode('login');
      setFormData({ email: '', password: '', name: '', companyCode: '', jobRole: '', acceptedTerms: false });
      setError('');
      setSuccessMsg('');
      setCodeStatus(null);
      setRoleOptions([]);
      setMatchedRole(null);
    }
  }, [isOpen]);

  // Debounced code validation
  useEffect(() => {
    if (mode !== 'signup') return;
    const code = formData.companyCode.trim();
    if (!code) { setCodeStatus(null); setRoleOptions([]); return; }
    clearTimeout(codeTimer.current);
    setCodeStatus('checking');
    codeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/auth/validate-company-code?code=${encodeURIComponent(code)}`);
        const json = await res.json();
        if (json.success && json.data) {
          setCodeStatus({ ok: true, companyName: json.data.companyName, detectedRole: json.data.detectedRole, companyId: json.data.companyId });
          // Fetch role library for suggestions
          try {
            const rr = await fetch(`${API}/api/roles?companyId=${json.data.companyId}`);
            const rj = await rr.json();
            setRoleOptions(rj.data || []);
          } catch { setRoleOptions([]); }
        } else {
          setCodeStatus({ ok: false, error: json.error || 'Invalid code' });
          setRoleOptions([]);
        }
      } catch {
        setCodeStatus({ ok: false, error: 'Could not verify code' });
      }
    }, 600);
    return () => clearTimeout(codeTimer.current);
  }, [formData.companyCode, mode]);

  // Live JD match
  useEffect(() => {
    setMatchedRole(fuzzyMatch(formData.jobRole, roleOptions));
  }, [formData.jobRole, roleOptions]);

  const set = (k, v) => setFormData(f => ({ ...f, [k]: v }));

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const result = await login(formData.email, formData.password);
      if (result?.success) { onClose(); navigate(getDashboardRoute()); }
      else setError(result?.error?.message || 'Invalid email or password.');
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (!formData.companyCode.trim()) return setError('Company Access Code is required.');
    if (!formData.jobRole.trim()) return setError('Job Role is required.');
    if (!codeStatus?.ok) return setError('Enter a valid Company Access Code first.');
    if (!formData.acceptedTerms) return setError('Please accept the Terms of Service.');
    setLoading(true);
    try {
      const result = await register(
        formData.email, formData.password, formData.name,
        { companyCode: formData.companyCode.trim(), jobRole: formData.jobRole.trim() }
      );
      if (result?.success) {
        onClose();
        navigate(getDashboardRoute());
      } else {
        setError(result?.error?.message || 'Registration failed.');
      }
    } catch (err) {
      setError(err.message || 'Registration failed.');
    } finally { setLoading(false); }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${API}/api/oauth/google`;
  };

  if (!isOpen) return null;

  const isSignup = mode === 'signup';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

        {/* Modal */}
        <motion.div
          className="relative w-full max-w-md max-h-[90vh] overflow-y-auto"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={e => e.stopPropagation()}
        >
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/95 backdrop-blur-xl p-7 shadow-2xl shadow-black/60">

            {/* Header */}
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-lg font-black text-white">
                {isSignup ? '✨ Create Account' : '🔐 Sign In'}
              </h3>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center"
              >✕</button>
            </div>

            {/* Error / Success */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                ⚠️ {error}
              </div>
            )}
            {successMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
                ✅ {successMsg}
              </div>
            )}

            {/* ── LOGIN FORM ── */}
            {!isSignup && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className={labelCls}>Email Address</label>
                  <input type="email" required value={formData.email} onChange={e => set('email', e.target.value)}
                    className={inputCls} placeholder="you@company.com" disabled={loading} />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <input type="password" required value={formData.password} onChange={e => set('password', e.target.value)}
                    className={inputCls} placeholder="••••••••" disabled={loading} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                  {loading ? '⏳ Signing in...' : '🔐 Sign In'}
                </button>
              </form>
            )}

            {/* ── SIGNUP FORM ── */}
            {isSignup && (
              <form onSubmit={handleSignup} className="space-y-3">

                {/* Company Access Code */}
                <div>
                  <label className={labelCls}>
                    Company Access Code <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.companyCode}
                    onChange={e => set('companyCode', e.target.value.toUpperCase())}
                    className={`${inputCls} font-mono tracking-widest`}
                    placeholder="e.g. GSS-EMP-8X92"
                    disabled={loading}
                    autoComplete="off"
                  />
                  {codeStatus === 'checking' && (
                    <p className="mt-1 text-xs text-slate-400">Verifying...</p>
                  )}
                  {codeStatus?.ok && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-emerald-400">✓ {codeStatus.companyName}</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        codeStatus.detectedRole === 'manager'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      }`}>
                        {codeStatus.detectedRole === 'manager' ? 'Manager' : 'Employee'}
                      </span>
                    </div>
                  )}
                  {codeStatus?.ok === false && (
                    <p className="mt-1 text-xs text-red-400">✗ {codeStatus.error}</p>
                  )}
                </div>

                {/* Job Role */}
                <div className="relative">
                  <label className={labelCls}>
                    Job Role <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.jobRole}
                    onChange={e => { set('jobRole', e.target.value); setShowSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    className={inputCls}
                    placeholder="e.g. Frontend Developer"
                    disabled={loading}
                    autoComplete="off"
                  />
                  {showSuggestions && formData.jobRole && roleOptions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 rounded-xl border border-slate-700 bg-slate-800 shadow-xl max-h-40 overflow-y-auto">
                      {roleOptions
                        .filter(r => r.roleName?.toLowerCase().includes(formData.jobRole.toLowerCase()))
                        .slice(0, 6)
                        .map(r => (
                          <button key={r.id} type="button"
                            onMouseDown={() => { set('jobRole', r.roleName); setShowSuggestions(false); }}
                            className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors">
                            {r.roleName}
                          </button>
                        ))}
                    </div>
                  )}
                  {matchedRole && formData.jobRole && (
                    <p className="mt-1 text-xs text-emerald-400">
                      ✓ Matched "{matchedRole.roleName}" — JD & assessment will be auto-assigned
                    </p>
                  )}
                </div>

                {/* Full Name */}
                <div>
                  <label className={labelCls}>Full Name <span className="text-red-400">*</span></label>
                  <input type="text" required value={formData.name} onChange={e => set('name', e.target.value)}
                    className={inputCls} placeholder="Your full name" disabled={loading} />
                </div>

                {/* Email */}
                <div>
                  <label className={labelCls}>Email Address <span className="text-red-400">*</span></label>
                  <input type="email" required value={formData.email} onChange={e => set('email', e.target.value)}
                    className={inputCls} placeholder="you@company.com" disabled={loading} />
                </div>

                {/* Password */}
                <div>
                  <label className={labelCls}>Password <span className="text-red-400">*</span></label>
                  <input type="password" required value={formData.password} onChange={e => set('password', e.target.value)}
                    className={inputCls} placeholder="Min 8 characters" disabled={loading} />
                </div>

                {/* Terms */}
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={formData.acceptedTerms}
                    onChange={e => set('acceptedTerms', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                  <span className="text-xs text-slate-400">
                    I agree to the{' '}
                    <a href="#" className="text-indigo-400 hover:text-indigo-300">Terms of Service</a>{' '}
                    and{' '}
                    <a href="#" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</a>
                  </span>
                </label>

                <button type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20">
                  {loading ? '⏳ Creating account...' : '✨ Create Account'}
                </button>
              </form>
            )}

            {/* Toggle */}
            <p className="mt-4 text-center text-sm text-slate-500">
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <button
                onClick={() => { setMode(isSignup ? 'login' : 'signup'); setError(''); }}
                className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                {isSignup ? 'Sign in →' : 'Sign up →'}
              </button>
            </p>

            {/* Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/60" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-slate-900/95 text-slate-600">or continue with</span>
              </div>
            </div>

            {/* Google OAuth */}
            <button type="button" onClick={handleGoogleLogin} disabled={loading}
              className="w-full py-2.5 rounded-xl border border-slate-700/60 bg-slate-800/60 hover:bg-slate-800/80 text-slate-300 font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Google
            </button>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AuthModal;
