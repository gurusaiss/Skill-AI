import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// One labelled dropdown that replaces a row of many small buttons.
//   label   text on the trigger (e.g. "Actions", "More", "Download")
//   items   [{ label, onClick, icon, danger, disabled, hidden, divider }]
//           `divider: true` draws a separator before the item.
//   align   'right' (default) | 'left'
// Rendered through a portal with fixed positioning so tables and cards that clip
// their overflow never cut the menu off. Closes on outside click, Escape, scroll.
export default function ActionMenu({ label = 'Actions', items = [], align = 'right', size = 'md', icon = null, className = '', variant = 'secondary' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 200 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const visible = items.filter((i) => i && !i.hidden);

  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const menuW = Math.max(220, r.width);
    const vw = window.innerWidth;
    let left = align === 'right' ? r.right - menuW : r.left;
    left = Math.max(8, Math.min(left, vw - menuW - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const estH = visible.length * 40 + 12;
    const top = spaceBelow < estH + 12 && r.top > estH ? r.top - estH - 6 : r.bottom + 6;
    setPos({ top, left, minWidth: menuW });
  }, [align, visible.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (visible.length === 0) return null;

  const triggerSize = size === 'sm' ? 'h-9 px-3' : 'h-10 px-4';
  const triggerLook = variant === 'ghost'
    ? 'text-slate-300 hover:bg-slate-800 hover:text-white'
    : 'border border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-700';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${triggerSize} ${triggerLook} ${className}`}
      >
        {icon}
        {label}
        <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M5 7.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 400 }}
          className="rounded-xl border border-slate-600 bg-slate-900 p-1.5 shadow-2xl shadow-black/50"
        >
          {visible.map((item, idx) => (
            <React.Fragment key={`${item.label}-${idx}`}>
              {item.divider && idx > 0 ? <div className="my-1 h-px bg-slate-700" /> : null}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick?.(); }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${item.danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-100 hover:bg-slate-800'}`}
              >
                {item.icon ? <span className="shrink-0 text-slate-400">{item.icon}</span> : null}
                <span className="min-w-0 flex-1">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
