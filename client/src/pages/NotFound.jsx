import React from 'react';
import { useNavigate } from 'react-router-dom';

// Catch-all for any unmatched route. Previously there was no `*` route at
// all, so an unmatched URL rendered a blank content area (nav chrome still
// showing) with zero explanation — no error, no console warning, nothing
// for the user to act on.
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-7xl font-black text-indigo-500/40 mb-4">404</p>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-slate-400 text-sm mb-8">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300 hover:text-white text-sm font-medium transition-all"
          >
            ← Go Back
          </button>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
