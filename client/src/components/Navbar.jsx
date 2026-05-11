import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/dashboard',   label: 'Dashboard',    icon: '📊' },
  { to: '/career-twin', label: 'Career Twin',  icon: '🧬' },
  { to: '/simulation',  label: 'Simulator',    icon: '🔮' },
  { to: '/explain',     label: 'Explain',      icon: '🧠' },
  { to: '/report',      label: 'Report',       icon: '📄' },
];

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const hideNavLinks = location.pathname === '/' || location.pathname === '/demo';

  return (
    <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0F172A]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/20 text-lg">🧠</div>
          <div>
            <p className="font-bold text-white text-sm leading-tight tracking-wide">SKILL FORGE</p>
            <p className="text-[10px] text-slate-500">Autonomous Career AI</p>
          </div>
        </Link>

        {!hideNavLinks && (
          <>
            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1 text-sm">
              {NAV_LINKS.map(({ to, label, icon }) => (
                <Link key={to} to={to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all
                    ${location.pathname === to
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  <span className="text-sm">{icon}</span>
                  {label}
                </Link>
              ))}
              <button onClick={() => navigate('/demo')}
                className="ml-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 rounded-lg text-emerald-400 hover:bg-emerald-600/30 transition-all text-sm font-medium">
                🚀 Demo
              </button>
            </nav>

            {/* Mobile toggle */}
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden text-slate-400 hover:text-white p-2">
              {menuOpen ? '✕' : '☰'}
            </button>
          </>
        )}

        {hideNavLinks && (
          <button onClick={() => navigate('/demo')}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-sm font-bold text-white transition-all shadow-lg shadow-emerald-500/20">
            🚀 Live Demo
          </button>
        )}
      </div>

      {/* Mobile Menu */}
      {!hideNavLinks && menuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0F172A] px-6 py-4">
          <nav className="flex flex-col gap-2">
            {NAV_LINKS.map(({ to, label, icon }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all
                  ${location.pathname === to ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400'}`}>
                {icon} {label}
              </Link>
            ))}
            <button onClick={() => { navigate('/demo'); setMenuOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm font-medium">
              🚀 Live Demo
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Navbar;
