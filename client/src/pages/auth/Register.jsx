import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_BADGE = {
  manager: { label: 'Manager', bg: 'bg-amber-500/15 border-amber-500/40 text-amber-300' },
  employee: { label: 'Employee', bg: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' },
};

// Fuzzy match a typed role against the server-side role list (client preview only)
function fuzzyMatch(typed, roles) {
  if (!typed?.trim() || !roles?.length) return null;
  const q = typed.toLowerCase().trim().replace(/[-_/]+/g, ' ');
  // exact
  const exact = roles.find(r => r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ').trim() === q);
  if (exact) return exact;
  // contains
  const contains = roles.find(r => {
    const rn = r.roleName?.toLowerCase().replace(/[-_/]+/g, ' ').trim();
    return rn && (rn.includes(q) || q.includes(rn));
  });
  if (contains) return contains;
  // word overlap ≥ 50%
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

export default function Register() {
  const navigate = useNavigate();
  const { register, isAuthenticated } = useAuth();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyCode: '',
    jobRole: '',
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, label: '', color: '' });

  // Access code state
  const [companyLookup, setCompanyLookup] = useState(null);
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
  const [companyLookupError, setCompanyLookupError] = useState('');
  const lookupTimer = useRef(null);

  // Job role suggestion state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const jobRoleRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  // Password strength
  useEffect(() => {
    const p = formData.password;
    if (!p) { setPasswordStrength({ score: 0, label: '', color: '' }); return; }
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^a-zA-Z0-9]/.test(p)) score++;
    const s = [
      { score: 0, label: 'Very Weak', color: 'bg-red-500' },
      { score: 1, label: 'Weak', color: 'bg-orange-500' },
      { score: 2, label: 'Fair', color: 'bg-yellow-500' },
      { score: 3, label: 'Good', color: 'bg-lime-500' },
      { score: 4, label: 'Strong', color: 'bg-green-500' },
      { score: 5, label: 'Very Strong', color: 'bg-emerald-500' },
    ];
    setPasswordStrength(s[score]);
  }, [formData.password]);

  // Access code lookup
  const lookupCompanyCode = useCallback(async (code) => {
    const clean = code?.trim().toUpperCase();
    if (!clean || clean.length < 6) {
      setCompanyLookup(null);
      setCompanyLookupError('');
      return;
    }
    setCompanyLookupLoading(true);
    setCompanyLookupError('');
    setCompanyLookup(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/validate-company-code?code=${encodeURIComponent(clean)}`);
      const json = await res.json();
      if (json.success && json.data) {
        setCompanyLookup(json.data);
      } else {
        setCompanyLookupError(json.error?.message || 'Invalid access code');
      }
    } catch {
      setCompanyLookupError('Could not verify access code');
    } finally {
      setCompanyLookupLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    if (name === 'companyCode') {
      setCompanyLookup(null);
      setCompanyLookupError('');
      clearTimeout(lookupTimer.current);
      lookupTimer.current = setTimeout(() => lookupCompanyCode(value), 600);
    }
    if (name === 'jobRole') {
      setShowSuggestions(true);
    }
  };

  const validateForm = () => {
    if (!formData.name.trim()) { setError('Full name is required'); return false; }
    if (!formData.email.trim()) { setError('Email is required'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) { setError('Enter a valid email address'); return false; }
    if (!formData.password) { setError('Password is required'); return false; }
    if (formData.password.length < 8) { setError('Password must be at least 8 characters'); return false; }
    if (!/[A-Z]/.test(formData.password)) { setError('Password must have at least one uppercase letter'); return false; }
    if (!/[a-z]/.test(formData.password)) { setError('Password must have at least one lowercase letter'); return false; }
    if (!/\d/.test(formData.password)) { setError('Password must have at least one number'); return false; }
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return false; }
    if (!formData.companyCode.trim()) { setError('Access code is required'); return false; }
    if (!companyLookup) { setError('Enter a valid access code'); return false; }
    if (!formData.jobRole.trim()) { setError('Job role is required'); return false; }
    if (!acceptedTerms) { setError('You must accept the terms and conditions'); return false; }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;
    setLoading(true);
    try {
      await register(formData.email, formData.password, formData.name, {
        companyCode: formData.companyCode.trim().toUpperCase(),
        jobRole: formData.jobRole.trim(),
      });
      navigate('/auth/onboarding', {
        state: { email: formData.email, name: formData.name, assessmentPending: true },
      });
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const hasCode = formData.companyCode.trim().length > 0;
  const detectedRoleBadge = companyLookup?.detectedRole ? ROLE_BADGE[companyLookup.detectedRole] : null;

  // Suggestions: filter roles by what's typed
  const allRoles = companyLookup?.roles || [];
  const typedRole = formData.jobRole.trim().toLowerCase();
  const suggestions = typedRole.length >= 1
    ? allRoles.filter(r => r.roleName?.toLowerCase().includes(typedRole)).slice(0, 6)
    : allRoles.slice(0, 6);

  // Live JD match preview
  const matchedRole = companyLookup ? fuzzyMatch(formData.jobRole, allRoles) : null;

  return (
    <div className="min-h-screen bg-[#060B14] flex items-center justify-center px-4 py-12">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <h1 className="text-4xl font-black tracking-tight">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                SKILL FORGE
              </span>
            </h1>
          </Link>
          <p className="text-slate-400 text-sm mt-2">Create your account</p>
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">

            {/* ── Access Code — FIRST and prominent ── */}
            <div>
              <label htmlFor="companyCode" className="block text-sm font-semibold text-slate-300 mb-2">
                Access Code <span className="text-red-400">*</span>
                <span className="ml-2 text-xs font-normal text-slate-500">provided by your company admin</span>
              </label>
              <div className="relative">
                <input
                  id="companyCode" name="companyCode" type="text"
                  value={formData.companyCode} onChange={handleChange}
                  placeholder="e.g. GSS-MGR-8X92" disabled={loading}
                  autoComplete="off" spellCheck={false}
                  className={`w-full px-4 py-3 rounded-xl border bg-[#060B14] text-slate-100 placeholder-slate-500 focus:outline-none transition-colors uppercase tracking-widest font-mono ${
                    companyLookup ? 'border-emerald-500' : companyLookupError ? 'border-red-500' : 'border-slate-700 focus:border-indigo-500'
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {companyLookupLoading && <span className="text-slate-400 text-sm animate-spin inline-block">⟳</span>}
                  {!companyLookupLoading && companyLookup && <span className="text-emerald-400">✓</span>}
                  {!companyLookupLoading && companyLookupError && hasCode && <span className="text-red-400">✗</span>}
                </div>
              </div>

              {companyLookup && (
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-emerald-400 font-medium">✓ {companyLookup.companyName}</p>
                  {detectedRoleBadge && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${detectedRoleBadge.bg}`}>
                      {detectedRoleBadge.label}
                    </span>
                  )}
                </div>
              )}
              {companyLookupError && hasCode && (
                <p className="mt-1.5 text-xs text-red-400">{companyLookupError}</p>
              )}
            </div>

            {/* ── Job Role — free text with suggestions ── */}
            <div className="relative" ref={jobRoleRef}>
              <label htmlFor="jobRole" className="block text-sm font-semibold text-slate-300 mb-2">
                Your Job Role <span className="text-red-400">*</span>
              </label>
              <input
                id="jobRole" name="jobRole" type="text"
                value={formData.jobRole} onChange={handleChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="e.g. Frontend Developer, HR Manager…"
                disabled={loading}
                autoComplete="off"
                className={`w-full px-4 py-3 rounded-xl border bg-[#060B14] text-slate-100 placeholder-slate-500 focus:outline-none transition-colors ${
                  matchedRole ? 'border-emerald-500' : 'border-slate-700 focus:border-indigo-500'
                }`}
              />

              {/* Autocomplete suggestions dropdown */}
              {showSuggestions && companyLookup && suggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                  {suggestions.map(r => (
                    <button
                      key={r.id || r.roleName}
                      type="button"
                      onMouseDown={() => {
                        setFormData(prev => ({ ...prev, jobRole: r.roleName }));
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700 transition-colors flex items-center justify-between"
                    >
                      <span>{r.roleName}</span>
                      {r.department && <span className="text-xs text-slate-500">{r.department}</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* JD match indicator */}
              {formData.jobRole.trim() && companyLookup && (
                <p className={`mt-1.5 text-xs font-medium ${matchedRole ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {matchedRole
                    ? `✓ Matched "${matchedRole.roleName}" — JD & assessment will be auto-assigned`
                    : 'Role will be registered as entered (no JD match yet)'}
                </p>
              )}

              {!companyLookup && (
                <p className="mt-1.5 text-xs text-slate-600">Enter your access code first to see role suggestions</p>
              )}
            </div>

            {/* ── Full Name ── */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-slate-300 mb-2">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input id="name" name="name" type="text" value={formData.name} onChange={handleChange}
                placeholder="John Doe" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors" />
            </div>

            {/* ── Email ── */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300 mb-2">
                Email Address <span className="text-red-400">*</span>
              </label>
              <input id="email" name="email" type="email" value={formData.email} onChange={handleChange}
                placeholder="you@example.com" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors" />
            </div>

            {/* ── Password ── */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300 mb-2">
                Password <span className="text-red-400">*</span>
              </label>
              <input id="password" name="password" type="password" value={formData.password} onChange={handleChange}
                placeholder="••••••••" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors" />
              {formData.password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-400">{passwordStrength.label}</span>
                  </div>
                  <p className="text-xs text-slate-500">8+ chars with uppercase, lowercase, and numbers</p>
                </div>
              )}
            </div>

            {/* ── Confirm Password ── */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-300 mb-2">
                Confirm Password <span className="text-red-400">*</span>
              </label>
              <input id="confirmPassword" name="confirmPassword" type="password"
                value={formData.confirmPassword} onChange={handleChange}
                placeholder="••••••••" disabled={loading}
                className={`w-full px-4 py-3 rounded-xl border bg-[#060B14] text-slate-100 placeholder-slate-500 focus:outline-none transition-colors ${
                  formData.confirmPassword && formData.password !== formData.confirmPassword
                    ? 'border-red-500'
                    : formData.confirmPassword && formData.password === formData.confirmPassword
                    ? 'border-emerald-500'
                    : 'border-slate-700 focus:border-indigo-500'
                }`} />
            </div>

            {/* ── Terms ── */}
            <div className="flex items-start gap-3">
              <input id="terms" type="checkbox" checked={acceptedTerms}
                onChange={e => setAcceptedTerms(e.target.checked)} disabled={loading}
                className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-900" />
              <label htmlFor="terms" className="text-sm text-slate-400">
                I agree to the{' '}
                <a href="#" className="text-indigo-400 hover:text-indigo-300 transition-colors">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="text-indigo-400 hover:text-indigo-300 transition-colors">Privacy Policy</a>
              </label>
            </div>

            <button type="submit" disabled={loading || companyLookupLoading}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
              {loading ? '⏳ Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link to="/auth/login" className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-400 transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
