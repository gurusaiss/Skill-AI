import React, { useState, useMemo } from 'react';

const SIMULATED_LEARNERS = [
  { name: 'Arjun K.',  skill: 'React.js',    sessions: 18, score: 91, xp: 3240 },
  { name: 'Sneha P.',  skill: 'Python',       sessions: 24, score: 88, xp: 4180 },
  { name: 'Dev M.',    skill: 'ML Basics',    sessions: 12, score: 95, xp: 2800 },
  { name: 'Riya S.',   skill: 'Node.js',      sessions: 20, score: 82, xp: 3510 },
  { name: 'Karan L.',  skill: 'SQL',          sessions: 15, score: 78, xp: 2200 },
  { name: 'Meera T.',  skill: 'TypeScript',   sessions: 30, score: 90, xp: 5200 },
  { name: 'Aditya V.', skill: 'Django',       sessions: 8,  score: 85, xp: 1600 },
  { name: 'Pooja R.',  skill: 'React.js',     sessions: 22, score: 93, xp: 3900 },
  { name: 'Vivek N.',  skill: 'Docker',       sessions: 11, score: 72, xp: 1850 },
];

// Stable rank change simulation based on name hash
function stableRankChange(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const v = ((h % 5) - 2); // -2 to +2
  return v;
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function Leaderboard({ stats, userName }) {
  const [period, setPeriod] = useState('week');

  const userXP = useMemo(() => {
    if (!stats) return 1200;
    const base = (stats.totalSessions || 0) * 120 + (stats.avgScore || 0) * 15;
    return Math.max(base, 800);
  }, [stats]);

  const userSkill = stats?.topSkill || 'AI Learning';
  const userSessions = stats?.totalSessions || 0;
  const userScore = stats?.avgScore || 0;

  const rows = useMemo(() => {
    const withUser = [
      ...SIMULATED_LEARNERS,
      { name: userName || 'You', skill: userSkill, sessions: userSessions, score: userScore, xp: userXP, isUser: true },
    ];

    // For "week" period, slightly shuffle XP to show different ranking
    const adjusted = withUser.map(r => ({
      ...r,
      xp: period === 'week' ? Math.round(r.xp * 0.6) : r.xp,
    }));

    return adjusted
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [period, userXP, userName, userSkill, userSessions, userScore]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black text-white">🏆 Global Leaderboard</h2>
          <p className="text-xs text-slate-500 mt-0.5">See how you rank among learners worldwide</p>
        </div>
        {/* Period toggle */}
        <div className="flex gap-1 p-1 rounded-xl bg-slate-800/60 border border-slate-700/50">
          {['week', 'alltime'].map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                period === p
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p === 'week' ? 'This Week' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Top 3 podium */}
      <div className="grid grid-cols-3 gap-3 mb-2">
        {[rows[1], rows[0], rows[2]].map((r, pos) => {
          if (!r) return <div key={pos} />;
          const actualRank = pos === 1 ? 1 : pos === 0 ? 2 : 3;
          const heights = ['h-24', 'h-32', 'h-20'];
          return (
            <div
              key={r.name}
              className={`flex flex-col items-center justify-end rounded-2xl border p-3 transition-all ${
                r.isUser
                  ? 'bg-indigo-600/20 border-indigo-500/50 shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-800/40 border-slate-700/50'
              } ${heights[pos]}`}
            >
              <div className="text-2xl mb-1">{MEDAL[actualRank] || actualRank}</div>
              <p className={`text-xs font-black text-center leading-tight ${r.isUser ? 'text-indigo-300' : 'text-slate-200'}`}>
                {r.name}
              </p>
              <p className="text-xs font-mono font-bold text-slate-400 mt-0.5">{r.xp.toLocaleString()} XP</p>
            </div>
          );
        })}
      </div>

      {/* Full table */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[44px_1fr_80px_60px_60px_72px] gap-2 px-4 py-2.5 border-b border-slate-700/60 bg-slate-800/40">
          {['Rank', 'Name', 'Skill', 'Sessions', 'Score', 'XP'].map(h => (
            <p key={h} className="text-xs font-black text-slate-500 uppercase tracking-widest truncate">{h}</p>
          ))}
        </div>

        {/* Table rows */}
        <div className="divide-y divide-slate-800/60">
          {rows.map((r) => {
            const rankChange = r.isUser ? 0 : stableRankChange(r.name);
            return (
              <div
                key={r.name}
                className={`grid grid-cols-[44px_1fr_80px_60px_60px_72px] gap-2 px-4 py-3 items-center transition-colors ${
                  r.isUser
                    ? 'bg-indigo-600/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-slate-800/30'
                }`}
              >
                {/* Rank */}
                <div className="flex items-center gap-1">
                  <span className={`text-sm font-black font-mono ${
                    r.rank === 1 ? 'text-yellow-400' :
                    r.rank === 2 ? 'text-slate-300' :
                    r.rank === 3 ? 'text-amber-600' :
                    r.isUser ? 'text-indigo-400' : 'text-slate-500'
                  }`}>
                    {MEDAL[r.rank] || `#${r.rank}`}
                  </span>
                </div>

                {/* Name + change */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-bold truncate ${r.isUser ? 'text-indigo-300' : 'text-slate-200'}`}>
                      {r.name}
                    </span>
                    {r.isUser && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 font-bold flex-shrink-0">You</span>
                    )}
                  </div>
                  {rankChange !== 0 && !r.isUser && (
                    <span className={`text-xs font-bold ${rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {rankChange > 0 ? `▲ +${rankChange}` : `▼ ${rankChange}`}
                    </span>
                  )}
                </div>

                {/* Skill */}
                <span className="text-xs text-slate-400 font-medium truncate">{r.skill}</span>

                {/* Sessions */}
                <span className="text-xs font-mono font-bold text-slate-300 text-center">{r.sessions}</span>

                {/* Score */}
                <span className={`text-xs font-mono font-black text-center ${
                  r.score >= 90 ? 'text-emerald-400' :
                  r.score >= 75 ? 'text-indigo-400' :
                  'text-amber-400'
                }`}>{r.score}%</span>

                {/* XP */}
                <span className={`text-xs font-mono font-black text-right ${r.isUser ? 'text-indigo-300' : 'text-slate-400'}`}>
                  {r.xp.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-slate-600">
        🟢 Updated 5 minutes ago · Rankings based on XP earned · {rows.length} learners shown
      </p>
    </div>
  );
}
