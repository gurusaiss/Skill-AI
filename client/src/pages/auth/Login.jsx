import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const RATE_LIMIT_KEY = 'skillforge:login_locked_until';
const RATE_LIMIT_MS = 2 * 60 * 1000; // 2 minutes (reduced from 15)

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, getDashboardRoute } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(() => {
    const stored = localStorage.getItem(RATE_LIMIT_KEY);
    if (stored) {
      const until = parseInt(stored, 10);
      return until > Date.now() ? until : null;
    }
    return null;
  });
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef(null);

  // Manage countdown timer when locked
  useEffect(() => {
    if (!lockedUntil) { setCountdown(0); return; }
    const tick = () => {
      const remaining = Math.max(0, lockedUntil - Date.now());
      setCountdown(remaining);
      if (remaining === 0) {
        setLockedUntil(null);
        localStorage.removeItem(RATE_LIMIT_KEY);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => clearInterval(countdownRef.current);
  }, [lockedUntil]);

  const formatCountdown = (ms) => {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const triggerLockout = () => {
    const until = Date.now() + RATE_LIMIT_MS;
    localStorage.setItem(RATE_LIMIT_KEY, String(until));
    setLockedUntil(until);
    setFailedAttempts(0);
  };

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const redirectPath = getDashboardRoute();
      navigate(redirectPath, { replace: true });
    }
  }, [isAuthenticated, navigate, getDashboardRoute]);

  // Check for success messages from registration/reset
  useEffect(() => {
    if (location.state?.message) {
      setSuccessMessage(location.state.message);
    }
    if (location.state?.error) {
      setError(location.state.error);
    }
    
    // Check for OAuth errors in URL params
    const params = new URLSearchParams(location.search);
    const oauthError = params.get('error');
    const oauthMessage = params.get('message');
    
    if (oauthError) {
      setError(oauthMessage ? decodeURIComponent(oauthMessage) : 'OAuth authentication failed');
    }
  }, [location]);

  const validateForm = () => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!password) {
      setError('Password is required');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    // Client-side lockout check
    if (lockedUntil && lockedUntil > Date.now()) return;

    if (!validateForm()) return;

    setLoading(true);
    try {
      await login(email, password);
      // Clear any lockout state on successful login
      setFailedAttempts(0);
      localStorage.removeItem(RATE_LIMIT_KEY);
      const redirectPath = location.state?.from || getDashboardRoute();
      navigate(redirectPath, { replace: true });
    } catch (err) {
      const msg = err.message || 'Login failed. Please check your credentials.';
      const isRateLimited = msg.toLowerCase().includes('too many') || msg.includes('rate limit');

      if (isRateLimited) {
        triggerLockout();
        setError('');
      } else {
        const newAttempts = failedAttempts + 1;
        setFailedAttempts(newAttempts);
        // Client-side: lock after 10 consecutive failures
        if (newAttempts >= 10) {
          triggerLockout();
          setError('');
        } else {
          setError(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // Redirect to Google OAuth endpoint
    window.location.href = `${import.meta.env.PROD ? '' : 'http://localhost:3001'}/api/oauth/google`;
  };

  return (
    <div className="min-h-screen bg-[#060B14] flex items-center justify-center px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <Link to="/" className="inline-block">
            <h1 className="text-4xl font-black tracking-tight">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                SKILL FORGE
              </span>
            </h1>
          </Link>
          <p className="text-slate-400 text-sm mt-2">Sign in to your account</p>
        </div>

        {/* Login Card */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          {/* Success Message */}
          {successMessage && (
            <div className="mb-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
              {successMessage}
            </div>
          )}

          {/* Rate-limit lockout banner */}
          {lockedUntil && countdown > 0 && (
            <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/8 p-5 text-center">
              <div className="text-2xl mb-2">🔒</div>
              <p className="text-amber-300 font-bold text-sm mb-1">Too many failed attempts</p>
              <p className="text-amber-400/70 text-xs mb-3">Please wait before trying again</p>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <span className="text-amber-300 font-black text-xl tabular-nums">{formatCountdown(countdown)}</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && !lockedUntil && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Failed attempts warning (before lockout) */}
          {failedAttempts > 0 && failedAttempts < 10 && !lockedUntil && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-amber-400 text-xs text-center">
              {10 - failedAttempts} attempt{10 - failedAttempts !== 1 ? 's' : ''} remaining before temporary lockout
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-slate-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-40"
                disabled={loading || (lockedUntil && countdown > 0)}
              />
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-300 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors disabled:opacity-40"
                disabled={loading || (lockedUntil && countdown > 0)}
              />
            </div>

            {/* Forgot Password Link */}
            <div className="text-right">
              <Link
                to="/auth/forgot-password"
                className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || (lockedUntil && countdown > 0)}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? '⏳ Signing in…'
                : (lockedUntil && countdown > 0) ? `🔒 Locked — ${formatCountdown(countdown)}`
                : 'Sign In'}
            </button>
          </form>

          {/* Divider - REMOVED FOR DEVELOPMENT */}
          {/* Google OAuth button removed - requires billing setup */}
          {/* TODO: Re-enable Google OAuth in production */}

          {/* Register Link */}
          <div className="mt-6 text-center text-sm text-slate-400">
            Don't have an account?{' '}
            <Link to="/auth/register" className="text-indigo-400 hover:text-indigo-300 font-semibold transition-colors">
              Sign up
            </Link>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-400 transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
