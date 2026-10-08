import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import CompanyChip from './CompanyChip';
import UserMenu from './UserMenu';
import NavIcon from './NavIcons';

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


// Canonical order (standardized platform-wide): Dashboard, Role Library, Users,
// Groups, Assessments, Modules, Assignments, Reports, AI Metrics, Permissions.
// `icon` is a key of NavIcons (heroicons outline). Labels are always shown in full.
const ADMIN_LINKS = [
  { to: '/admin/dashboard',   label: 'Dashboard',    icon: 'dashboard' },
  { to: '/admin/roles',       label: 'Role Library', icon: 'roles' },
  { to: '/admin/users',       label: 'Users',        icon: 'users' },
  { to: '/admin/groups',      label: 'Groups',       icon: 'groups' },
  { to: '/admin/assessments', label: 'Assessments',  icon: 'assessments' },
  { to: '/admin/modules',     label: 'Modules',      icon: 'modules' },
  { to: '/admin/assignments', label: 'Assignments',  icon: 'assignments' },
  { to: '/report',            label: 'Reports',      icon: 'reports' },
  { to: '/admin/metrics',     label: 'AI Metrics',   icon: 'metrics' },
  { to: '/admin/permissions', label: 'Permissions',  icon: 'permissions' },
];

const ROLE_LINKS = {
  superadmin: [
    { to: '/superadmin/dashboard', label: 'Platform', icon: 'platform' },
    { to: '/superadmin/admins',    label: 'Admins',   icon: 'permissions' },
    { to: '/superadmin/reports',   label: 'Reports',  icon: 'reports' },
  ],
  manager: [
    { to: '/manager/dashboard', label: 'Dashboard',    icon: 'dashboard' },
    { to: '/admin/roles',       label: 'Role Library', icon: 'roles' },
    { to: '/admin/users',       label: 'Users',        icon: 'users' },
    { to: '/admin/groups',      label: 'Groups',       icon: 'groups' },
    { to: '/admin/assessments', label: 'Assessments',  icon: 'assessments' },
    { to: '/admin/modules',     label: 'Modules',      icon: 'modules' },
    { to: '/admin/assignments', label: 'Assignments',  icon: 'assignments' },
    { to: '/report',            label: 'Reports',      icon: 'reports' },
  ],
  employee: [
    { to: '/dashboard', label: 'My Learning', icon: 'learning' },
  ],
};

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', employee: 'Employee', superadmin: 'Super Admin' };
const DASH_MAP    = { admin: '/admin/dashboard', manager: '/manager/dashboard', employee: '/dashboard' };

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, hasRole, logout, activeRole, switchRole, allRoles } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(isAuthenticated);

  // Close the notification dropdown on outside click / Escape.
  useEffect(() => {
    if (!notifOpen) return undefined;
    const onDown = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setNotifOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [notifOpen]);

  // Mobile drawer: Escape closes, close on route change.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const hideNavLinks = location.pathname === '/'
    || location.pathname === '/demo'
    || location.pathname.startsWith('/module/');
  const showRight = isAuthenticated && location.pathname !== '/' && location.pathname !== '/demo';

  // Nav links based on activeRole (what the user is currently acting as)
  const effectiveNavRole = activeRole || user?.role;
  const roleLinks = effectiveNavRole === 'superadmin'
    ? ROLE_LINKS.superadmin
    : effectiveNavRole === 'admin'
      ? ADMIN_LINKS
      : (ROLE_LINKS[effectiveNavRole] || []);

  // Deduplicated switch options: exclude current effective role, trainer, superadmin.
  // Primary role always listed first; no duplicates.
  const primaryRoleSwitch = user?.role && user.role !== effectiveNavRole ? [user.role] : [];
  const extraRoles = (allRoles || []).filter(r => r !== effectiveNavRole && r !== 'superadmin' && r !== 'trainer' && r !== user?.role);
  const deduplicatedSwitchRoles = [...new Set([...primaryRoleSwitch, ...extraRoles])];

  const isActive = (to) => location.pathname === to
    || (location.pathname === '/employee/dashboard' && to === '/dashboard')
    || (to !== '/admin/dashboard' && to !== '/dashboard' && to !== '/manager/dashboard' && location.pathname.startsWith(to));

  const handleSwitch = (r) => { switchRole(r); navigate(DASH_MAP[r] || '/dashboard'); };
  const iconBtn = 'relative flex h-[36px] w-[36px] items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
      {/* Tier 1: brand + company chip, then theme / bell / user menu */}
      <div className="flex h-[56px] items-center gap-3 pl-4 pr-4 sm:pr-6 lg:pl-6">
        {/* Mobile hamburger */}
        {showRight && !hideNavLinks && (
          <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen}
            className={`${iconBtn} lg:hidden -ml-1 flex-shrink-0`}>
            <NavIcon name="menu" />
          </button>
        )}

        <Link to="/" aria-label="Skill Forge home"
          className="flex flex-shrink-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
          <span className="flex h-[32px] w-[32px] items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-base shadow-lg shadow-indigo-900/40">
            <svg className="h-[20px] w-[20px] text-white" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
          </span>
          <span className="hidden whitespace-nowrap text-base font-bold tracking-tight text-white sm:inline">Skill Forge</span>
        </Link>

        {isAuthenticated && (
          <>
            <span className="hidden h-6 w-px flex-shrink-0 bg-slate-700 sm:block" aria-hidden="true" />
            <div className="hidden min-w-0 sm:flex"><CompanyChip className="max-w-[14rem] lg:max-w-[20rem]" /></div>
          </>
        )}

        <div className="flex-1" />

        {showRight && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button type="button" onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className={`${iconBtn} theme-toggle-btn`}>
              <NavIcon name={theme === 'dark' ? 'sun' : 'moon'} />
            </button>

            {/* Notification bell */}
            <div className="relative" ref={notifRef}>
              <button type="button" onClick={() => setNotifOpen(o => !o)}
                aria-haspopup="true" aria-expanded={notifOpen}
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                title="Notifications" className={iconBtn}>
                <NavIcon name="bell" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 px-1 text-xs font-bold text-white ring-2 ring-slate-900">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
                    <span className="text-sm font-bold text-white">Notifications</span>
                    {unreadCount > 0 && (
                      <button type="button" onClick={markAllRead} className="text-xs text-indigo-400 hover:text-indigo-300">
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-slate-500">No notifications</div>
                    ) : (
                      notifications.slice(0, 20).map(n => (
                        <button key={n.id} type="button" onClick={() => markRead(n.id)}
                          className={`w-full cursor-pointer border-b border-slate-700/50 px-4 py-3 text-left transition-colors hover:bg-slate-700/40 ${!n.read ? 'bg-indigo-900/10' : ''}`}>
                          <div className="flex items-start gap-2">
                            {!n.read && <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-indigo-500" />}
                            <div className={`min-w-0 ${!n.read ? '' : 'ml-3.5'}`}>
                              <p className="text-sm font-semibold leading-snug text-white">{n.title}</p>
                              <p className="mt-0.5 text-xs leading-snug text-slate-400">{n.message}</p>
                              <p className="mt-1 text-xs text-slate-600">
                                {n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {user && (
              <UserMenu user={user} roleLabel={ROLE_LABELS[effectiveNavRole] || effectiveNavRole}
                switchRoles={deduplicatedSwitchRoles} roleLabels={ROLE_LABELS}
                onSwitch={handleSwitch} onLogout={logout} />
            )}
          </div>
        )}
      </div>

      {/* Tier 2 (lg+): navigation. Full labels, wraps to a second row, never scrolls or truncates. */}
      {!hideNavLinks && roleLinks.length > 0 && isAuthenticated && (
        <nav aria-label="Main navigation" className="hidden border-t border-slate-800/70 px-4 py-1 lg:block lg:px-6">
          <ul className="m-0 flex list-none flex-wrap items-center gap-x-0.5 gap-y-1 p-0">
            {roleLinks.map(({ to, label, icon }) => {
              const active = isActive(to);
              return (
                <li key={to}>
                  <Link to={to} aria-current={active ? 'page' : undefined}
                    className={`relative flex h-[36px] items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm 2xl:gap-2 2xl:px-3 font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                      ${active ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                    <NavIcon name={icon} className={`h-[20px] w-[20px] ${active ? 'text-indigo-300' : ''}`} />
                    <span>{label}</span>
                    <span aria-hidden="true"
                      className={`pointer-events-none absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-indigo-400 to-violet-500 transition-opacity duration-150 ${active ? 'opacity-100' : 'opacity-0'}`} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* Mobile / tablet drawer (below lg): every item with its full name */}
      {/* Portaled to <body>: backdrop-blur on <header> would otherwise trap `fixed` inside the header box. */}
      {!hideNavLinks && menuOpen && createPortal(
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-slate-950/70" />
          <div className="relative flex h-full w-80 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex h-[56px] flex-shrink-0 items-center justify-between border-b border-slate-800 px-4">
              <span className="text-base font-bold text-white">Skill Forge</span>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className={iconBtn}>
                <NavIcon name="close" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              {isAuthenticated && <div className="mb-3 flex"><CompanyChip className="max-w-full" /></div>}
              <nav aria-label="Main navigation" className="flex flex-col gap-1">
                {roleLinks.map(({ to, label, icon }) => {
                  const active = isActive(to);
                  return (
                    <Link key={to} to={to} onClick={() => setMenuOpen(false)} aria-current={active ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
                        ${active ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                      <NavIcon name={icon} className={`h-[20px] w-[20px] ${active ? 'text-indigo-300' : ''}`} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
            {isAuthenticated && user && (
              <div className="flex flex-shrink-0 flex-col gap-1 border-t border-slate-800 px-3 py-3">
                <Link to="/profile" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
                  <NavIcon name="user" /> Profile
                </Link>
                {hasRole('admin') && (
                  <Link to="/settings" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
                    <NavIcon name="permissions" /> Settings
                  </Link>
                )}
                <button type="button" onClick={() => { setMenuOpen(false); logout(); }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-400 hover:bg-slate-800 hover:text-red-300">
                  <NavIcon name="logout" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      , document.body)}
    </header>
  );
}

export default Navbar;
