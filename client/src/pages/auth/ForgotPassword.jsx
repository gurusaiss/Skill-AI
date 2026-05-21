import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { requestPasswordReset, isAuthenticated } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const validateForm = () => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!validateForm()) return;

    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
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
          </div>

          {/* Success Card */}
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8 text-center">
            {/* Success Icon */}
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-slate-100 mb-2">Check your email</h2>
            <p className="text-slate-400 mb-6">
              We've sent a password reset link to
              <br />
              <span className="text-indigo-400 font-semibold">{email}</span>
            </p>

            <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 text-left mb-6">
              <p className="text-sm text-slate-300 mb-2">📧 What to do next:</p>
              <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside">
                <li>Check your inbox for the reset link</li>
                <li>Click the link to reset your password</li>
                <li>The link expires in 1 hour</li>
              </ul>
            </div>

            <button
              onClick={() => navigate('/auth/login')}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all active:scale-[0.98]"
            >
              Back to Login
            </button>

            <div className="mt-4">
              <button
                onClick={() => setSuccess(false)}
                className="text-sm text-slate-500 hover:text-slate-400 transition-colors"
              >
                Didn't receive the email? Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          <p className="text-slate-400 text-sm mt-2">Reset your password</p>
        </div>

        {/* Forgot Password Card */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Instructions */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-100 mb-2">Forgot your password?</h2>
            <p className="text-sm text-slate-400">
              No worries! Enter your email address and we'll send you a link to reset your password.
            </p>
          </div>

          {/* Form */}
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
                className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                disabled={loading}
                autoFocus
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? '⏳ Sending...' : 'Send Reset Link'}
            </button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 text-center">
            <Link
              to="/auth/login"
              className="text-sm text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
            >
              ← Back to login
            </Link>
          </div>
        </div>

        {/* Additional Help */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500">
            Need help?{' '}
            <a href="#" className="text-slate-400 hover:text-slate-300 transition-colors">
              Contact support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
