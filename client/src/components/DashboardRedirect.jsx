import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardRedirect() {
  const { user, getDashboardRoute } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      // replace (not push) — otherwise Back from the eventual dashboard route
      // has to skip through this bounce page, making Back feel like it jumps
      // two pages instead of returning to the page the user was actually on.
      navigate('/', { replace: true });
      return;
    }
    const route = getDashboardRoute();
    navigate(route, { replace: true });
  }, [user, getDashboardRoute, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
      <div className="text-center">
        <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
        <div className="text-slate-400 text-sm">Redirecting...</div>
      </div>
    </div>
  );
}
