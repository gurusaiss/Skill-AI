import React from 'react';

// Standard page title block: icon + title + subtitle on the left, actions on the
// right. Actions wrap onto a new line instead of shrinking. Keep it to ONE
// primary action plus an ActionMenu for the rest, so buttons never get tiny.
export default function PageHeader({ title, subtitle, icon, actions, className = '' }) {
  return (
    <div className={`mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-800/70 text-2xl">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-black leading-tight text-white sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-slate-400 sm:text-base">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
