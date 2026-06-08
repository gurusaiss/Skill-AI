import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

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
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data?.data ?? data;
};

export default function Onboarding() {
  const navigate = useNavigate();
  const location = useLocation();

  const stateData = location.state || {};
  const { userId, email, name: stateName } = stateData;

  const [form, setForm] = useState({
    name: stateName || '',
    jobRole: '',
    department: '',
    companyName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      navigate('/auth/login');
    }
  }, [userId, navigate]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) { setError('Full name is required'); return; }
    if (!form.jobRole.trim()) { setError('Job role is required'); return; }
    if (!form.department.trim()) { setError('Department is required'); return; }

    setLoading(true);
    try {
      const result = await authFetch(`/api/users/${userId}/onboarding`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          jobRole: form.jobRole.trim(),
          department: form.department.trim(),
          companyName: form.companyName.trim(),
        }),
      });

      // Save user data to localStorage
      const userData = result?.user || result || {};
      localStorage.setItem('user_profile', JSON.stringify({
        id: userId,
        email,
        name: form.name.trim(),
        jobRole: form.jobRole.trim(),
        department: form.department.trim(),
        companyName: form.companyName.trim(),
        ...userData,
      }));

      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Failed to save profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null;

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4 py-12">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <h1 className="text-4xl font-black tracking-tight">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                SKILL FORGE
              </span>
            </h1>
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          {/* Header */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-white">Welcome to SkillForge! 👋</h2>
            <p className="text-slate-400 text-sm mt-2">
              Tell us about yourself to personalize your experience
            </p>
          </div>

          {/* Progress Indicator */}
          <div className="flex items-center justify-center gap-3 mb-8">
            {/* Step 1 — Done */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center">
                <span className="text-emerald-400 text-xs font-black">✓</span>
              </div>
              <span className="text-xs font-semibold text-emerald-400">Account</span>
            </div>

            {/* Connector */}
            <div className="w-10 h-px bg-slate-600" />

            {/* Step 2 — Active */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo-600 border border-indigo-500 flex items-center justify-center">
                <span className="text-white text-xs font-black">2</span>
              </div>
              <span className="text-xs font-semibold text-white">Profile</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                placeholder="John Doe"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#0F172A] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            {/* Job Role */}
            <div>
              <label htmlFor="jobRole" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Job Role <span className="text-red-400">*</span>
              </label>
              <input
                id="jobRole"
                name="jobRole"
                type="text"
                value={form.jobRole}
                onChange={handleChange}
                placeholder="e.g. Frontend Developer, Data Analyst…"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#0F172A] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            {/* Department */}
            <div>
              <label htmlFor="department" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Department <span className="text-red-400">*</span>
              </label>
              <input
                id="department"
                name="department"
                type="text"
                value={form.department}
                onChange={handleChange}
                placeholder="e.g. Engineering, Marketing, Sales…"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#0F172A] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            {/* Company Name (optional) */}
            <div>
              <label htmlFor="companyName" className="block text-sm font-semibold text-slate-300 mb-1.5">
                Company Name <span className="text-slate-500 font-normal text-xs">(optional)</span>
              </label>
              <input
                id="companyName"
                name="companyName"
                type="text"
                value={form.companyName}
                onChange={handleChange}
                placeholder="e.g. Acme Corp"
                disabled={loading}
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#0F172A] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 mt-2 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving profile…
                </>
              ) : (
                'Continue to Dashboard →'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
