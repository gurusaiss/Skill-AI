import React from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';

const FALLBACK_SKILLS = [
  { name: 'Fundamentals', score: 72, target: 90 },
  { name: 'Practice',     score: 58, target: 85 },
  { name: 'Theory',       score: 81, target: 90 },
  { name: 'Projects',     score: 45, target: 80 },
  { name: 'Debugging',    score: 63, target: 85 },
];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-2xl text-xs backdrop-blur-sm">
      <p className="font-black text-slate-100 mb-1.5">{d.name}</p>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: '#6366F1' }} />
          <span className="text-slate-400">Current</span>
          <span className="ml-auto font-black text-indigo-300">{d.score}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-violet-400" style={{ background: 'transparent' }} />
          <span className="text-slate-400">Target</span>
          <span className="ml-auto font-black text-violet-300">{d.target}%</span>
        </div>
      </div>
    </div>
  );
}

export default function SkillRadarChart({ skills }) {
  const data = (skills && skills.length > 0) ? skills : FALLBACK_SKILLS;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-5">
      {/* Title */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Skill Mastery Radar</p>
        {(!skills || skills.length === 0) && (
          <span className="text-xs text-slate-600 italic">sample data</span>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid
            stroke="#334155"
            strokeOpacity={0.6}
          />
          <PolarAngleAxis
            dataKey="name"
            tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }}
            tickLine={false}
          />

          {/* Target level — behind, dashed stroke, very low fill */}
          <Radar
            name="Target Level"
            dataKey="target"
            stroke="#8B5CF6"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            fill="#8B5CF6"
            fillOpacity={0.10}
            dot={false}
          />

          {/* Current mastery — on top, solid stroke */}
          <Radar
            name="Current Mastery"
            dataKey="score"
            stroke="#6366F1"
            strokeWidth={2}
            fill="#6366F1"
            fillOpacity={0.35}
            dot={{ fill: '#6366F1', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#818cf8' }}
          />

          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm" style={{ background: '#6366F1' }} />
          <span className="text-xs text-slate-400 font-semibold">Current Mastery</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm border border-violet-400" style={{ background: 'transparent' }} />
          <span className="text-xs text-slate-400 font-semibold">Target Level</span>
        </div>
      </div>
    </div>
  );
}
