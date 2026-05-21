import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';

const AuthModal = ({ isOpen, onClose }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    acceptedTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { login, register, getDashboardRoute } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      if (isLogin) {
        const result = await login(formData.email, formData.password);
        if (result && result.success) {
          onClose();
          const redirectPath = getDashboardRoute();
          navigate(redirectPath);
          setSuccessMsg('');
        } else {
          setError(result?.error?.message || 'Login failed. Please check your credentials.');
        }
      } else {
        if (!formData.acceptedTerms) {
          setError('Please accept the Terms of Service and Privacy Policy to continue.');
          setLoading(false);
          return;
        }
        const result = await register(formData.email, formData.password, formData.name);
        if (result && result.success) {
          setIsLogin(true);
          setSuccessMsg('Registration successful! Please log in.');
          setFormData({ ...formData, email: '', password: '', name: '' });
        } else {
          setError(result?.error?.message || 'Registration failed. Please try again.');
        }
      }
    } catch (err) {
      setError(err.message || (isLogin ? 'Login failed. Please check your credentials.' : 'Registration failed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    const baseUrl = import.meta.env.PROD ? '' : 'http://localhost:3001';
    window.location.href = `${baseUrl}/api/oauth/google`;
  };

  if (!isOpen) return null;

  return (
    <>
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 overflow-y-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 transition-opacity"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={(e) => e.stopPropagation()} />
          </motion.div>

          {/* Modal */}
          <motion.div
            className="relative inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glassmorphism card */}
            <div className="relative rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-xl p-8 shadow-2xl shadow-black/50">
              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black text-white">
                  {isLogin ? '🔐 Sign In' : '✨ Create Account'}
                </h3>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 transition-all flex items-center justify-center"
                >
                  ✕
                </button>
              </div>

              {/* Status messages - properly stringified */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm font-medium"
                  >
                    ⚠️ {typeof error === 'string' ? error : 'An error occurred'}
                  </motion.div>
                )}
                {successMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm font-medium"
                  >
                    ✅ {typeof successMsg === 'string' ? successMsg : 'Success!'}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                  >
                    <label htmlFor="name" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      required={!isLogin}
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none transition-all duration-200"
                      placeholder="Enter your full name"
                      disabled={loading}
                    />
                  </motion.div>
                )}

                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
                  <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none transition-all duration-200"
                    placeholder="you@example.com"
                    disabled={loading}
                  />
                </motion.div>

                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                  <label htmlFor="password" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    id="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-800/60 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none transition-all duration-200"
                    placeholder="••••••••"
                    disabled={loading}
                  />
                </motion.div>

                {!isLogin && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 }}
                  >
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.acceptedTerms}
                        onChange={(e) => setFormData({ ...formData, acceptedTerms: e.target.checked })}
                        className="mt-1 w-4 h-4 rounded border-slate-700 bg-slate-800/60 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                      />
                      <span className="text-xs text-slate-400">
                        I agree to the{' '}
                        <a href="#" className="text-indigo-400 hover:text-indigo-300 transition-colors">Terms of Service</a>{' '}
                        and{' '}
                        <a href="#" className="text-indigo-400 hover:text-indigo-300 transition-colors">Privacy Policy</a>
                      </span>
                    </label>
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  disabled={loading || (!isLogin && !formData.acceptedTerms)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] shadow-lg shadow-indigo-500/20"
                >
                  {loading
                    ? (isLogin ? '⏳ Signing in...' : '⏳ Creating account...')
                    : (isLogin ? '🔐 Sign In' : '✨ Create Account')}
                </motion.button>
              </form>

              {/* Toggle */}
              <motion.p
                className="mt-5 text-center text-sm text-slate-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
              >
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <button
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError('');
                    setSuccessMsg('');
                    setFormData({ email: '', password: '', name: '', acceptedTerms: false });
                  }}
                  className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {isLogin ? 'Sign up →' : 'Sign in →'}
                </button>
              </motion.p>

              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700/60" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-slate-900/80 text-slate-600">or continue with</span>
                </div>
              </div>

              {/* Google OAuth */}
              <motion.button
                type="button"
                onClick={handleGoogleLogin}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-2.5 rounded-xl border border-slate-700/60 bg-slate-800/60 hover:bg-slate-800/80 text-slate-300 font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2"
                disabled={loading}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google
              </motion.button>

            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
    </>
  );
};

export default AuthModal;