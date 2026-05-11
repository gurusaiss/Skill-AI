import React from 'react';

function CompetencyBadge({ label }) {
  return (
    <span className="rounded-full bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 border border-emerald-500/30">
      {label}
    </span>
  );
}

export default CompetencyBadge;
