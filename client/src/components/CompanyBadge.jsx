import React from 'react';
import { useAuth } from '../contexts/AuthContext';

// Shows the company name exactly as the super admin entered it.
// Renders nothing for the super admin (platform level) or when there is no company.
// Pass `name` / `code` to render a specific company (e.g. in super admin modals);
// the superadmin/empty-name guard then applies only to the auth-derived name.
export default function CompanyBadge({ name, code, className = '', maxWidthClass = 'max-w-[220px]' }) {
  const { user, company, companyName } = useAuth();
  const explicit = name !== undefined;
  if (!explicit && user?.role === 'superadmin') return null;

  const label = (explicit ? name : companyName) || '';
  if (!label.trim()) return null;
  const companyCode = explicit ? code : company?.companyCode;
  const title = companyCode ? `${label} (${companyCode})` : label;

  return (
    <div
      title={title}
      className={`flex items-center gap-1.5 min-w-0 rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 ${className}`}
    >
      <svg
        className="h-4 w-4 flex-shrink-0 text-indigo-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
        />
      </svg>
      <span className={`truncate text-xs font-semibold text-slate-200 ${maxWidthClass}`}>{label}</span>
    </div>
  );
}
