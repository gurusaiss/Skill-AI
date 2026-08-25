import React, { useState, useRef, useEffect, useMemo, useId } from 'react';

/**
 * SearchableSelect — a searchable, keyboard-navigable dropdown for filter bars.
 * Drop-in replacement for <select> when the option list can be long (job roles,
 * employees, groups, managers, etc.) — a plain <select> becomes unusable past a
 * few dozen options; this stays fast and usable with thousands.
 *
 * Props:
 *  - options: Array<string> | Array<{ value, label }>
 *  - value: current selected value (string)
 *  - onChange: (value) => void
 *  - placeholder: label shown when nothing is selected / "All X" option text
 *  - allLabel: label for the implicit "no filter" option (default "All")
 *  - includeAllOption: whether to show the "All" option (default true)
 *  - className: extra classes for the trigger button
 *  - disabled
 */
export default function SearchableSelect({
  options = [],
  value = 'all',
  onChange,
  placeholder = 'Select...',
  allLabel = 'All',
  includeAllOption = true,
  className = '',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const instanceId = useId();

  const normalized = useMemo(() => {
    const base = options.map(o => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? String(o.value) }));
    return includeAllOption ? [{ value: 'all', label: allLabel }, ...base] : base;
  }, [options, includeAllOption, allLabel]);

  const filtered = useMemo(() => {
    if (!query.trim()) return normalized;
    const q = query.trim().toLowerCase();
    return normalized.filter(o => o.label.toLowerCase().includes(q));
  }, [normalized, query]);

  const selected = normalized.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const commit = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className={`px-3 py-1.5 bg-slate-800 border border-slate-700/60 rounded-lg text-slate-300 text-xs font-semibold focus:outline-none focus:border-indigo-500 transition-colors flex items-center gap-2 disabled:opacity-50 ${className}`}
      >
        <span className="truncate max-w-[160px]">{selected?.label ?? placeholder}</span>
        <span className="text-slate-500 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="p-1.5 border-b border-slate-700/60">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">No matches</p>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={`${instanceId}-${opt.value}-${i}`}
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commit(opt)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                    opt.value === value ? 'bg-indigo-600/20 text-indigo-300 font-semibold' : i === highlight ? 'bg-slate-700/60 text-white' : 'text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
