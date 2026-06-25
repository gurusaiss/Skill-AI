import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

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
  const { user, isAuthenticated, getDashboardRoute, hasRole, logout, activeRole, switchRole, allRoles } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
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
    { to: '/admin/roles',          label: 'Role Library',   icon: '🗂️', roles: ['admin'] },
    { to: '/admin/groups',      label: 'Groups',      icon: '👥', roles: ['admin'] },
    { to: '/admin/metrics',     label: 'AI Metrics',  icon: '📈', roles: ['admin'] },
  ];

  const ROLE_LINKS = {
    superadmin: [
      { to: '/superadmin/dashboard', label: 'Platform', icon: '🌐' },
      { to: '/superadmin/admins',    label: 'Admins',   icon: '👑' },
      { to: '/superadmin/reports',   label: 'Reports',  icon: '📄' },
    ],
    manager: [
      { to: '/manager/dashboard',  label: 'Dashboard',     icon: '📊' },
      { to: '/admin/users',        label: 'Users',         icon: '👥' },
      { to: '/admin/assessments',  label: 'Assessments',   icon: '📝' },
      { to: '/admin/modules',      label: 'Modules',       icon: '📚' },
      { to: '/admin/assignments',  label: 'Assignments',   icon: '📋' },
      { to: '/report',             label: 'Reports',       icon: '📄' },
      { to: '/admin/roles',        label: 'Role Library',  icon: '🎯' },
      { to: '/admin/groups',       label: 'Groups',        icon: '🗂️' },
    ],
    employee: [
      { to: '/dashboard',           label: 'My Learning', icon: '📚' },
    ],
  };

  // Nav links based on activeRole (what the user is currently acting as)
  const effectiveNavRole = activeRole || user?.role;
  const roleLinks = effectiveNavRole === 'superadmin'
    ? ROLE_LINKS.superadmin
    : effectiveNavRole === 'admin'
      ? NAV_LINKS.filter(l => l.roles?.includes('admin'))
      : (ROLE_LINKS[effectiveNavRole] || []);

  // Build "Switch To" options: all roles user can be except current
  const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', trainer: 'Trainer', employee: 'Employee' };
  const switchableRoles = (allRoles || []).filter(r => r !== effectiveNavRole && r !== 'superadmin');

  return (
    <header className="sticky top-0 z-30 border-b border-[#1E293B] bg-[#0F172A]/95 backdrop-blur">
      <div className="flex items-center w-full px-4 py-2 gap-1.5 min-w-0">

        {/* Brand — never shrinks, always single line */}
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 mr-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600/20 border border-indigo-500/20 text-base flex-shrink-0">🧠</div>
          <span className="font-bold text-white text-sm tracking-wide whitespace-nowrap">SKILL FORGE</span>
        </Link>

        {/* Role nav links — flex-1 fills remaining space; scrolls invisibly on mid screens */}
        {!hideNavLinks && (
          <nav className="hidden md:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
            {roleLinks.map(({ to, label, icon }) => (
              <Link key={to} to={to}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all whitespace-nowrap flex-shrink-0 text-[11px] xl:text-xs font-medium
                  ${location.pathname === to
                    || (location.pathname === '/employee/dashboard' && to === '/dashboard')
                    || (to !== '/admin/dashboard' && to !== '/dashboard' && to !== '/manager/dashboard' && location.pathname.startsWith(to))
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                <span className="text-[13px] leading-none">{icon}</span>
                {label}
              </Link>
            ))}
          </nav>
        )}

        {/* Spacer when no nav links (landing page) */}
        {hideNavLinks && <div className="flex-1" />}

        {/* Right section — fixed width icons: Theme toggle + Bell + Profile + Mobile toggle */}
        {isAuthenticated && (location.pathname !== '/' && location.pathname !== '/demo') && (
          <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">

            {/* Theme Toggle — icon only, no label */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="theme-toggle-btn flex items-center justify-center w-7 h-7 rounded-lg transition-all text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <span className="text-sm leading-none">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>

            {/* Notification Bell */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              >
                <span className="text-sm leading-none">🔔</span>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 flex items-center justify-center rounded-full bg-indigo-600 text-white text-[9px] font-bold px-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
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

            {/* Profile Menu */}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all whitespace-nowrap"
                >
                  <span className="text-sm leading-none">👤</span>
                  <span className="text-[11px] font-medium hidden sm:inline truncate max-w-[100px]">{user.name}</span>
                </button>

                {profileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50">
                    <div className="p-2">
                      {/* User info */}
                      <div className="px-3 py-2 mb-1 border-b border-slate-700/60">
                        <p className="text-xs font-bold text-white truncate">{user?.name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 capitalize">
                          {effectiveNavRole}
                        </span>
                      </div>

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

                      {/* Role switcher */}
                      {switchableRoles.length > 0 && (
                        <>
                          <div className="border-t border-slate-700 my-1" />
                          {switchableRoles.map(r => (
                            <button
                              key={r}
                              onClick={() => {
                                switchRole(r);
                                setProfileMenuOpen(false);
                                // Navigate to the role's dashboard
                                const dashMap = { admin: '/admin/dashboard', manager: '/manager/dashboard', trainer: '/dashboard', employee: '/dashboard' };
                                navigate(dashMap[r] || '/dashboard');
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg flex items-center gap-2"
                            >
                              <span className="text-xs opacity-60">⇄</span>
                              Switch to {ROLE_LABELS[r] || r} View
                            </button>
                          ))}
                        </>
                      )}

                      <div className="border-t border-slate-700 my-1" />
                      <button
                        onClick={() => { setProfileMenuOpen(false); logout(); }}
                        className="w-full text-left block px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-slate-700 rounded-lg"
                      >
                        🚪 Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden flex items-center justify-center w-7 h-7 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all text-sm">
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        )}
      </div>

      {/* Mobile Menu */}
      {!hideNavLinks && menuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0F172A] px-4 py-4">
          <nav className="flex flex-col gap-1">
            {roleLinks.map(({ to, label, icon }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-all
                  ${location.pathname === to || (location.pathname === '/employee/dashboard' && to === '/dashboard')
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                {icon} {label}
              </Link>
            ))}
            <div className="border-t border-slate-700 my-2" />
            {isAuthenticated && user && (
              <>
                <Link to="/profile" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800">
                  👤 Profile Settings
                </Link>
                {hasRole('admin') && (
                  <Link to="/settings" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800">
                    ⚙️ Settings
                  </Link>
                )}
              </>
            )}
            <button onClick={() => { logout(); setMenuOpen(false); }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-slate-800 transition-all">
              🚪 Logout
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}

export default Navbar;
