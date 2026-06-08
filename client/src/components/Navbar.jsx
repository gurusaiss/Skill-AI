import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function useNotifications(isAuthenticated) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchNotifications = async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      const res = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data.notifications || []);
        setUnreadCount(json.data.unreadCount || 0);
      }
    } catch (_) {}
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30000);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  const markRead = async (notifId) => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch(`/api/notifications/${notifId}/read`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read: true } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (_) {}
  };

  const markAllRead = async () => {
    const token = localStorage.getItem('auth_token');
    try {
      await fetch('/api/notifications/read-all', { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  return { notifications, unreadCount, markRead, markAllRead };
}

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, getDashboardRoute, hasRole, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(isAuthenticated);

  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  const hideNavLinks = location.pathname === '/'
    || location.pathname === '/demo'
    || location.pathname.startsWith('/module/');

  const NAV_LINKS = [
    { to: '/admin/dashboard',   label: 'Dashboard',   icon: '📊', roles: ['admin'] },
    { to: '/admin/users',       label: 'Users',       icon: '👥', roles: ['admin'] },
    { to: '/admin/assessments', label: 'Assessment',  icon: '📝', roles: ['admin', 'manager'] },
    { to: '/admin/modules',     label: 'Modules',     icon: '📚', roles: ['admin', 'manager'] },
    { to: '/admin/assignments', label: 'Assignments', icon: '📋', roles: ['admin', 'manager'] },
    { to: '/report',            label: 'Reports',     icon: '📄', roles: ['admin', 'manager'] },
    { to: '/admin/approvals',   label: 'Approvals',   icon: '⏳', roles: ['admin'] },
  ];

  const ROLE_LINKS = {
    superadmin: [
      { to: '/superadmin/dashboard', label: 'Platform', icon: '🌐' },
      { to: '/superadmin/admins',    label: 'Admins',   icon: '👑' },
      { to: '/superadmin/reports',   label: 'Reports',  icon: '📄' },
    ],
    manager: [
      { to: '/manager/dashboard',  label: 'Dashboard',  icon: '📊' },
      { to: '/admin/assessments',  label: 'Assessment', icon: '📝' },
      { to: '/admin/modules',      label: 'Modules',    icon: '📚' },
      { to: '/admin/assignments',  label: 'Assign',     icon: '📋' },
      { to: '/report',             label: 'Reports',    icon: '📄' },
    ],
    employee: [
      { to: '/dashboard', label: 'My Learning', icon: '📚' },
    ],
  };

  const roleLinks = user?.role === 'superadmin'
    ? ROLE_LINKS.superadmin
    : user?.role === 'admin'
      ? NAV_LINKS.filter(l => l.roles?.includes('admin'))
      : (ROLE_LINKS[user?.role] || []);

  return (
    <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0F172A]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/20 text-lg">🧠</div>
          <div>
            <p className="font-bold text-white text-sm leading-tight tracking-wide">SKILL FORGE</p>
            <p className="text-xs text-slate-500">Autonomous Career AI</p>
          </div>
        </Link>

        {/* Spacer on landing page so brand stays left-aligned */}
        {!isAuthenticated && location.pathname === '/' && <div />}

        {/* Role nav links — hidden on landing, demo, and module pages */}
        {!hideNavLinks && (
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {roleLinks.map(({ to, label, icon }) => (
              <Link key={to} to={to}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap
                  ${location.pathname === to
                    || location.pathname === '/employee/dashboard' && to === '/dashboard'
                    || (to !== '/admin/dashboard' && to !== '/dashboard' && to !== '/manager/dashboard' && location.pathname.startsWith(to))
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                <span className="text-sm">{icon}</span>
                {label}
              </Link>
            ))}
          </nav>
        )}

        {/* Notification Bell + Profile — always shown when authenticated (except landing/demo) */}
        {isAuthenticated && (location.pathname !== '/' && location.pathname !== '/demo') && (
          <>
            {/* Notification Bell (Desktop) */}
            {isAuthenticated && (
              <div className="relative ml-1" ref={notifRef}>
                <button
                  onClick={() => setNotifOpen(!notifOpen)}
                  className="relative flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                >
                  🔔
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                      <span className="text-sm font-bold text-white">Notifications</span>
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs text-indigo-400 hover:text-indigo-300">
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-slate-500 text-sm">No notifications</div>
                      ) : (
                        notifications.slice(0, 20).map(n => (
                          <div
                            key={n.id}
                            onClick={() => markRead(n.id)}
                            className={`px-4 py-3 border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/40 transition-colors ${!n.read ? 'bg-indigo-900/10' : ''}`}
                          >
                            <div className="flex items-start gap-2">
                              {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />}
                              <div className={!n.read ? '' : 'ml-3.5'}>
                                <p className="text-sm font-semibold text-white leading-snug">{n.title}</p>
                                <p className="text-xs text-slate-400 mt-0.5 leading-snug">{n.message}</p>
                                <p className="text-xs text-slate-600 mt-1">
                                  {n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Profile Menu (Desktop) */}
            {isAuthenticated && user && (
              <div className="relative ml-2">
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
                >
                  <span className="text-sm">👤</span>
                  <span className="text-sm">{user.name}</span>
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50">
                    <div className="p-2">
                      <Link
                        to="/profile"
                        onClick={() => setProfileMenuOpen(false)}
                        className="block px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg"
                      >
                        👤 Profile Settings
                      </Link>
                      {hasRole('admin') && (
                        <Link
                          to="/settings"
                          onClick={() => setProfileMenuOpen(false)}
                          className="block px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg"
                        >
                          ⚙️ Settings
                        </Link>
                      )}
                      <div className="border-t border-slate-700 my-1"></div>
                      <button
                        onClick={() => {
                          setProfileMenuOpen(false);
                          logout();
                        }}
                        className="w-full text-left block px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-slate-700 rounded-lg"
                      >
                        🚪 Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile menu toggle */}
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden text-slate-400 hover:text-white p-2">
              {menuOpen ? '✕' : '☰'}
            </button>
          </>
        )}
      </div>

      {/* Mobile Menu */}
      {!hideNavLinks && menuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0F172A] px-6 py-4">
          <nav className="flex flex-col gap-2">
            {roleLinks.map(({ to, label, icon }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all
                  ${location.pathname === to || (location.pathname === '/employee/dashboard' && to === '/dashboard')
                    ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400'}`}>
                {icon} {label}
              </Link>
            ))}
            <button onClick={() => { logout(); setMenuOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium">
              🚪 Logout
            </button>
            <div className="border-t border-slate-700 my-2"></div>
            {isAuthenticated && user && (
              <>
                <Link
                  to="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400"
                >
                  👤 Profile Settings
                </Link>
                {hasRole('admin') && (
                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400"
                  >
                    ⚙️ Settings
                  </Link>
                )}
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

export default Navbar;
