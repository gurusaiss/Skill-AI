import React from 'react';

const statusTone = {
  locked: 'bg-slate-700 text-slate-300',
  active: 'bg-indigo-600/20 text-indigo-300',
  complete: 'bg-emerald-600/20 text-emerald-300'
};

function SkillTree({ skills, compact = false }) {
  return (
    <div className="space-y-3">
      {skills.map((skill) => (
        <div
          key={skill.id}
          className={`bg-[#1E293B] rounded-2xl border border-[#334155] ${compact ? 'p-4' : 'p-5'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{skill.name}</p>
              {!compact && <p className="mt-1 text-sm text-slate-400">{skill.description}</p>}
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusTone[skill.status] || statusTone.locked}`}>
              {skill.status}
            </span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-[#0F172A]">
            <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(6, skill.mastery || 0)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-400">
            <span>{skill.level}</span>
            <span>{skill.mastery || 0}% mastery</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default SkillTree;
