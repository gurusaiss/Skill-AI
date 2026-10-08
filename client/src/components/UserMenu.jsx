import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import NavIcon from './NavIcons';

const initials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
};

// Avatar + first name + role badge, with Profile / switch role / Sign out dropdown.
// The trigger is shrink-0 and the first name truncates (with tooltip) so the chip is never clipped.
export default function UserMenu({ user, roleLabel, switchRoles = [], roleLabels = {}, onSwitch, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const first = user?.name?.split(' ')[0] || 'Account';
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition-colors duration-150 hover:bg-slate-700/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${user?.name || 'user'}`}
        className="flex items-center gap-2 rounded-xl border border-transparent py-1 pl-1 pr-2 transition-colors duration-150 hover:border-slate-700 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
        <span className="flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white">
          {initials(user?.name)}
        </span>
        <span title={user?.name} className="hidden max-w-[7rem] truncate text-sm font-medium text-slate-200 sm:inline xl:max-w-[10rem]">{first}</span>
        {roleLabel && (
          <span className="hidden rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-xs font-semibold capitalize text-indigo-300 md:inline">{roleLabel}</span>
        )}
        <NavIcon name="chevron" className="hidden h-[16px] w-[16px] text-slate-500 sm:block" />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-700/60 bg-slate-800 shadow-2xl">
          <div className="flex items-center gap-3 bg-slate-800/60 px-4 py-3">
            <span className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white">{initials(user?.name)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white" title={user?.name}>{user?.name}</p>
              <p className="truncate text-xs text-slate-400" title={user?.email}>{user?.email}</p>
              {roleLabel && <span className="mt-0.5 inline-block rounded-full border border-indigo-500/30 bg-indigo-500/20 px-2 py-0.5 text-xs font-bold capitalize text-indigo-300">{roleLabel}</span>}
            </div>
          </div>
          <div className="p-1.5">
            <Link to="/profile" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <NavIcon name="user" className="h-[20px] w-[20px]" /> Profile
            </Link>
            {switchRoles.length > 0 && <div className="my-1 border-t border-slate-700/60" />}
            {switchRoles.map(r => (
              <button key={r} type="button" role="menuitem" onClick={() => { setOpen(false); onSwitch(r); }} className={item}>
                <NavIcon name="switch" className="h-[20px] w-[20px]" /> Switch to {roleLabels[r] || r} View
              </button>
            ))}
            <div className="my-1 border-t border-slate-700/60" />
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout(); }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-400 transition-colors duration-150 hover:bg-red-900/20 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
              <NavIcon name="logout" className="h-[20px] w-[20px]" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
