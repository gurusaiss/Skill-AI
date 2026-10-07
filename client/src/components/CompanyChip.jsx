import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import NavIcon from './NavIcons';

// Header company chip: building icon + company name ONLY (no id, no "Admin Panel").
// Renders nothing for the super admin (platform level) or when there is no company name.
export default function CompanyChip({ className = '' }) {
  const { user, companyName } = useAuth();
  if (user?.role === 'superadmin') return null;
  const name = (companyName || '').trim();
  if (!name) return null;
  return (
    <div title={name}
      className={`flex min-w-0 items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 ${className}`}>
      <NavIcon name="building" className="h-[16px] w-[16px] text-indigo-400" />
      <span className="truncate text-sm font-semibold text-slate-200">{name}</span>
    </div>
  );
}
