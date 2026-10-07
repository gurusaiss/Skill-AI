import React, { useState } from 'react';

// Shared metric card used by every dashboard.
//   label        short heading
//   value        the number / percentage / text to show
//   description  one line shown under the heading so the card explains itself
//   tooltip      longer text shown in a small popup on hover or keyboard focus
//                (use it for how the number is calculated)
//   icon         emoji or node shown on the right
//   borderClass / bgClass / textClass  Tailwind classes for the accent colours
//   sub          optional small line under the value (e.g. "of 12 assessments")
export default function StatCard({
  label,
  value,
  icon,
  description,
  tooltip,
  sub,
  borderClass = 'border-slate-700/50',
  bgClass = 'bg-slate-800/60',
  textClass = 'text-slate-400',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const popup = tooltip || description;

  return (
    <div
      className={`relative rounded-xl border ${borderClass} ${bgClass} p-4 ${className}`}
      tabIndex={popup ? 0 : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs font-bold ${textClass} uppercase tracking-widest mb-1`}>{label}</p>
          <p className="text-2xl font-black text-white">{value}</p>
          {sub ? <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p> : null}
          {description ? (
            <p className="text-[11px] leading-snug text-slate-500 mt-1.5">{description}</p>
          ) : null}
        </div>
        {icon ? <div className="text-3xl opacity-50 flex-shrink-0">{icon}</div> : null}
      </div>

      {popup && open ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-3 right-3 top-full z-30 mt-2 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs leading-snug text-slate-200 shadow-xl"
        >
          <p className="font-bold text-white mb-0.5">{label}</p>
          <p>{popup}</p>
        </div>
      ) : null}
    </div>
  );
}
