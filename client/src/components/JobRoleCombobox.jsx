import React, { useState, useRef, useEffect, useMemo } from 'react';

/**
 * A free-text input with a properly sized, scrollable suggestion dropdown —
 * replaces the native <input list="..."><datalist> pattern, whose popup is
 * tiny, non-resizable, and browser/OS-themed rather than matching this
 * app's UI (the direct complaint this was built to fix). Still fully free
 * text: any value can be typed and submitted even if it matches nothing
 * below, exactly like a datalist input, but the suggestion list itself is
 * generously sized (max-h-80, comfortable row height) and consistently
 * styled instead of a squint-to-read OS popup.
 */
export default function JobRoleCombobox({
  value,
  onChange,
  onSelect,
  options = [], // [{ name, dept }]
  placeholder = '',
  className = '',
  ariaLabel = 'Job Role',
  id,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = (value || '').trim().toLowerCase();
    const list = q ? options.filter(o => o.name.toLowerCase().includes(q)) : options;
    return list.slice(0, 100); // generous cap — list scrolls, this just bounds worst-case render size
  }, [options, value]);

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        id={id}
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        className={className}
      />
      {open && !disabled && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto">
          {filtered.map(o => (
            <button
              key={o.name}
              type="button"
              onMouseDown={() => {
                onChange(o.name);
                onSelect?.(o);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-700 transition-colors flex items-center justify-between gap-3"
            >
              <span className="truncate">{o.name}</span>
              {o.dept && <span className="text-sm text-slate-400 shrink-0">{o.dept}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
