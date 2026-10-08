import React from 'react';

/**
 * TabBar - shared tab strip that ALWAYS fits its container (never scrolls sideways).
 *
 * - Tabs share the width (flex-1 min-w-0); labels truncate with a title tooltip.
 * - Font size / padding step down by breakpoint; icons stay visible.
 * - If there are too many tabs for the width (narrow phones) the strip wraps to
 *   another row instead of scrolling.
 *
 * Props:
 *   tabs:     [{ key, label, icon, badge, disabled, title }]
 *   active:   key of the active tab
 *   onChange: (key) => void
 *   size:     'md' | 'sm'            (default 'md')
 *   variant:  'pill' | 'underline'   (default 'pill')
 *   className: extra classes for the wrapper
 */
export default function TabBar({
  tabs = [],
  active,
  onChange,
  size = 'md',
  className = '',
  variant = 'pill',
}) {
  const sizeCls = size === 'sm'
    ? 'px-1.5 sm:px-2 py-1 text-xs gap-1'
    : 'px-2 sm:px-2.5 xl:px-3.5 py-1.5 xl:py-2 text-xs sm:text-xs xl:text-sm gap-1 xl:gap-1.5';

  const wrapCls = variant === 'underline'
    ? 'flex flex-wrap gap-x-1 gap-y-0 border-b border-slate-800 w-full max-w-full min-w-0'
    : 'flex flex-wrap gap-1 w-full max-w-full min-w-0';

  const tabCls = (isActive, disabled) => {
    const base = `tab-fit flex-1 min-w-0 basis-[5rem] inline-flex items-center justify-center font-semibold transition-all ${sizeCls}`;
    if (disabled) return `${base} opacity-40 cursor-not-allowed text-slate-500`;
    if (variant === 'underline') {
      return `${base} border-b-2 -mb-px ${isActive
        ? 'border-indigo-500 text-indigo-300'
        : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'}`;
    }
    return `${base} rounded-xl border ${isActive
      ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/30'
      : 'bg-slate-800/60 border-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-800'}`;
  };

  return (
    <div className={`${wrapCls} ${className}`} role="tablist">
      {tabs.map((t) => {
        const isActive = t.key === active;
        const text = typeof t.label === 'string' ? t.label : undefined;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            title={t.title || text}
            onClick={() => !t.disabled && onChange && onChange(t.key)}
            className={tabCls(isActive, t.disabled)}
          >
            {t.icon != null && t.icon !== '' && (
              <span className="flex-shrink-0 leading-none">{t.icon}</span>
            )}
            <span className="truncate min-w-0">{t.label}</span>
            {t.badge != null && t.badge !== false && t.badge !== '' && (
              <span className="flex-shrink-0 ml-0.5 rounded-full bg-slate-700/80 px-1.5 text-xs leading-4 font-bold text-slate-200">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
