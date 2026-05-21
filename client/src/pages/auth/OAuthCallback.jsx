import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

/**
 * OAuth Callback Handler
 * Handles the OAuth redirect from Google with the JWT token
 */
export default function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuthFromToken } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    const handleCallback = async () => {
      const token = searchParams.get('token');
      const errorParam = searchParams.get('error');
      const message = searchParams.get('message');

      // Handle OAuth error
      if (errorParam) {
        const errorMessage = message || 'OAuth authentication failed';
        navigate('/auth/login', {
          state: { error: decodeURIComponent(errorMessage) },
        });
        return;
      }

      // Handle missing token
      if (!token) {
        navigate('/auth/login', {
          state: { error: 'No authentication token received' },
        });
        return;
      }

      try {
        // Store token and fetch user profile
        localStorage.setItem('auth_token', token);
        
        // Fetch user profile with the token
        const response = await fetch(
          `${import.meta.env.PROD ? '' : 'http://localhost:3001'}/api/auth/me`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch user profile');
        }

        const data = await response.json();
        
        if (data.success && data.data) {
          // Update auth context with token and user
          if (setAuthFromToken) {
            setAuthFromToken(token, data.data);
          }
          
          // Redirect to dashboard
          navigate('/dashboard', { replace: true });
        } else {
          throw new Error('Invalid response from server');
        }
      } catch (err) {
        console.error('OAuth callback error:', err);
        setError(err.message || 'Authentication failed');
        
        // Redirect to login with error after 2 seconds
        setTimeout(() => {
          navigate('/auth/login', {
            state: { error: err.message || 'Authentication failed' },
          });
        }, 2000);
      }
    };

    handleCallback();
  }, [searchParams, navigate, setAuthFromToken]);

  return (
    <div className="min-h-screen bg-[#060B14] flex items-center justify-center px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-purple-600/8 blur-[100px]" />
      </div>

      <div className="relative text-center">
        {error ? (
          <>
            <div className="text-red-400 text-4xl mb-4">✕</div>
            <h2 className="text-2xl font-bold text-white mb-2">Authentication Failed</h2>
            <p className="text-slate-400 mb-4">{error}</p>
            <p className="text-sm text-slate-500">Redirecting to login...</p>
          </>
        ) : (
          <>
            <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
            <h2 className="text-2xl font-bold text-white mb-2">Completing Sign In</h2>
            <p className="text-slate-400">Please wait while we authenticate you...</p>
          </>
        )}
      </div>
    </div>
  );
}
