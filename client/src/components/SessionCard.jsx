import React from 'react';
import { scoreColor } from '../utils/api.js';

function SessionCard({ session }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-[#334155] bg-[#0F172A] p-4 text-base">
      <span className="text-slate-200">Day {session.day}</span>
      <span className="min-w-0 truncate text-slate-300" title={session.skillName}>{session.skillName}</span>
      <span className={`font-semibold ${scoreColor(session.score)}`}>{session.score}</span>
      <span className="text-slate-400">{new Date(session.completedAt).toLocaleDateString()}</span>
    </div>
  );
}

export default SessionCard;
