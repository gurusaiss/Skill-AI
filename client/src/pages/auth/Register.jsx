import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

const ROLE_BADGE = {
  manager: { label: 'Manager', bg: 'bg-amber-500/15 border-amber-500/40 text-amber-300' },
  employee: { label: 'Employee', bg: 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' },
};

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

  // Access code validation state
  const [companyLookup, setCompanyLookup] = useState(null); // { companyId, companyName, detectedRole, roles[] }
  const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
  const [companyLookupError, setCompanyLookupError] = useState('');
  const lookupTimer = useRef(null);

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

  // Debounced access code lookup
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
  };

  const validateForm = () => {
    if (!formData.name.trim()) { setError('Name is required'); return false; }
    if (!formData.email.trim()) { setError('Email is required'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) { setError('Please enter a valid email address'); return false; }
    if (!formData.password) { setError('Password is required'); return false; }
    if (formData.password.length < 8) { setError('Password must be at least 8 characters long'); return false; }
    if (!/[A-Z]/.test(formData.password)) { setError('Password must contain at least one uppercase letter'); return false; }
    if (!/[a-z]/.test(formData.password)) { setError('Password must contain at least one lowercase letter'); return false; }
    if (!/\d/.test(formData.password)) { setError('Password must contain at least one number'); return false; }
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return false; }
    if (formData.companyCode.trim() && !companyLookup) { setError('Enter a valid access code or leave it blank'); return false; }
    if (!acceptedTerms) { setError('You must accept the terms and conditions'); return false; }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!validateForm()) return;
    setLoading(true);
    try {
      const extras = {};
      if (companyLookup) {
        extras.companyCode = formData.companyCode.trim().toUpperCase();
        if (formData.jobRole) extras.jobRole = formData.jobRole;
      }
      await register(formData.email, formData.password, formData.name, extras);
      navigate('/auth/onboarding', {
        state: { email: formData.email, name: formData.name, assessmentPending: !!companyLookup },
      });
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const hasCompanyCode = formData.companyCode.trim().length > 0;
  const detectedRoleBadge = companyLookup?.detectedRole ? ROLE_BADGE[companyLookup.detectedRole] : null;

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
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-slate-300 mb-2">Full Name</label>
              <input id="name" name="name" type="text" value={formData.name} onChange={handleChange}
                placeholder="John Doe" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors" />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300 mb-2">Email Address</label>
              <input id="email" name="email" type="email" value={formData.email} onChange={handleChange}
                placeholder="you@example.com" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors" />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300 mb-2">Password</label>
              <input id="password" name="password" type="password" value={formData.password} onChange={handleChange}
                placeholder="••••••••" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors" />
              {formData.password && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-400">{passwordStrength.label}</span>
                  </div>
                  <p className="text-xs text-slate-500">Use 8+ characters with uppercase, lowercase, and numbers</p>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-300 mb-2">Confirm Password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" value={formData.confirmPassword}
                onChange={handleChange} placeholder="••••••••" disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors" />
            </div>

            {/* Divider */}
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/60" />
              </div>
              <div className="relative text-center">
                <span className="bg-slate-900/70 px-3 text-xs text-slate-500">Joining a company? (optional)</span>
              </div>
            </div>

            {/* Access Code */}
            <div>
              <label htmlFor="companyCode" className="block text-sm font-semibold text-slate-300 mb-2">
                Access Code
                <span className="ml-2 text-xs font-normal text-slate-500">e.g. GSS-MGR-8X92</span>
              </label>
              <div className="relative">
                <input id="companyCode" name="companyCode" type="text" value={formData.companyCode}
                  onChange={handleChange} placeholder="Enter your access code" disabled={loading}
                  className={`w-full px-4 py-3 rounded-xl border bg-[#060B14] text-slate-100 placeholder-slate-600 focus:outline-none transition-colors uppercase tracking-widest ${
                    companyLookup ? 'border-emerald-500' : companyLookupError ? 'border-red-500' : 'border-slate-700 focus:border-indigo-500'
                  }`} />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {companyLookupLoading && <span className="text-slate-400 text-xs animate-spin inline-block">⟳</span>}
                  {!companyLookupLoading && companyLookup && <span className="text-emerald-400 text-sm">✓</span>}
                  {!companyLookupLoading && companyLookupError && hasCompanyCode && <span className="text-red-400 text-sm">✗</span>}
                </div>
              </div>

              {/* Validated: show company + role badge */}
              {companyLookup && (
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-emerald-400 font-medium">✓ {companyLookup.companyName}</p>
                  {detectedRoleBadge && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${detectedRoleBadge.bg}`}>
                      {detectedRoleBadge.label}
                    </span>
                  )}
                </div>
              )}
              {companyLookupError && hasCompanyCode && (
                <p className="mt-1.5 text-xs text-red-400">{companyLookupError}</p>
              )}
            </div>

            {/* Job Role — only shown when access code is validated */}
            {companyLookup && (
              <div>
                <label htmlFor="jobRole" className="block text-sm font-semibold text-slate-300 mb-2">
                  Job Title <span className="text-slate-500 font-normal text-xs ml-1">(optional)</span>
                </label>
                <select id="jobRole" name="jobRole" value={formData.jobRole}
                  onChange={handleChange} disabled={loading}
                  className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 focus:border-indigo-500 focus:outline-none transition-colors">
                  <option value="">Select your job title...</option>
                  {(companyLookup.roles || []).map(r => (
                    <option key={r.id || r.roleName} value={r.roleName}>{r.roleName}{r.department ? ` — ${r.department}` : ''}</option>
                  ))}
                  <option value="__other">Other / Not listed</option>
                </select>
                <p className="mt-1.5 text-xs text-slate-500">
                  A skill assessment will be auto-generated based on your job title
                </p>
              </div>
            )}

            {/* Terms */}
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

            <button type="submit" disabled={loading}
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
