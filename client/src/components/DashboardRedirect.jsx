import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardRedirect() {
  const { user, getDashboardRoute } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate('/');
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
