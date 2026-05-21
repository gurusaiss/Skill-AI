import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function VerifyOTP() {
  const navigate = useNavigate();
  const location = useLocation();
  const { verifyOTP, isAuthenticated } = useAuth();

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [email, setEmail] = useState('');

  const inputRefs = useRef([]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Get email from location state or session storage
  useEffect(() => {
    const emailFromState = location.state?.email;
    const emailFromSession = sessionStorage.getItem('pendingVerificationEmail');
    
    if (emailFromState) {
      setEmail(emailFromState);
      sessionStorage.setItem('pendingVerificationEmail', emailFromState);
    } else if (emailFromSession) {
      setEmail(emailFromSession);
    } else {
      // No email found, redirect to register
      navigate('/auth/register');
    }

    if (location.state?.message) {
      setSuccessMessage(location.state.message);
    }
  }, [location, navigate]);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleChange = (index, value) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    // Handle backspace
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    
    if (!/^\d+$/.test(pastedData)) return;

    const newOtp = [...otp];
    for (let i = 0; i < pastedData.length && i < 6; i++) {
      newOtp[i] = pastedData[i];
    }
    setOtp(newOtp);

    // Focus last filled input or next empty
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }

    setLoading(true);
    try {
      await verifyOTP(otpCode, email);
      
      // Clear session storage
      sessionStorage.removeItem('pendingVerificationEmail');
      
      // Redirect to login with success message
      navigate('/auth/login', {
        state: {
          message: 'Email verified successfully! You can now sign in.',
        },
      });
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP. Please try again.');
      // Clear OTP inputs on error
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0) return;

    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      // Call resend OTP API
      const response = await fetch(
        `${import.meta.env.PROD ? '' : 'http://localhost:3001'}/api/auth/resend-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Failed to resend OTP');
      }

      setSuccessMessage('A new verification code has been sent to your email.');
      setResendCooldown(60); // 60 second cooldown
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch (err) {
      setError(err.message || 'Failed to resend OTP. Please try again.');
    } finally {
      setLoading(false);
    }
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
          <p className="text-slate-400 text-sm mt-2">Verify your email address</p>
        </div>

        {/* OTP Card */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 backdrop-blur p-8">
          {/* Success Message */}
          {successMessage && (
            <div className="mb-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm">
              {successMessage}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Instructions */}
          <div className="mb-6 text-center">
            <p className="text-slate-300 text-sm">
              We've sent a 6-digit verification code to
            </p>
            <p className="text-indigo-400 font-semibold mt-1">{email}</p>
          </div>

          {/* OTP Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* OTP Input */}
            <div className="flex justify-center gap-2">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={handlePaste}
                  className="w-12 h-14 text-center text-2xl font-bold rounded-xl border border-slate-700 bg-[#060B14] text-slate-100 focus:border-indigo-500 focus:outline-none transition-colors"
                  disabled={loading}
                />
              ))}
            </div>

            {/* Expiration Notice */}
            <p className="text-xs text-slate-500 text-center">
              Code expires in 10 minutes
            </p>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || otp.join('').length !== 6}
              className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {loading ? '⏳ Verifying...' : 'Verify Email'}
            </button>
          </form>

          {/* Resend OTP */}
          <div className="mt-6 text-center">
            <p className="text-sm text-slate-400 mb-2">Didn't receive the code?</p>
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={loading || resendCooldown > 0}
              className="text-sm text-indigo-400 hover:text-indigo-300 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : 'Resend verification code'}
            </button>
          </div>
        </div>

        {/* Back to Login */}
        <div className="mt-6 text-center">
          <Link to="/auth/login" className="text-sm text-slate-500 hover:text-slate-400 transition-colors">
            ← Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
