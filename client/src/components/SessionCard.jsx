import React from 'react';
import { scoreColor } from '../utils/api.js';

function SessionCard({ session }) {
  return (
    <div className="grid grid-cols-4 gap-3 rounded-xl border border-[#334155] bg-[#0F172A] p-4 text-sm">
      <span>Day {session.day}</span>
      <span className="text-slate-300">{session.skillName}</span>
      <span className={`font-semibold ${scoreColor(session.score)}`}>{session.score}</span>
      <span className="text-slate-400">{new Date(session.completedAt).toLocaleDateString()}</span>
    </div>
  );
}

export default SessionCard;
