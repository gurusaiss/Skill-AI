import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Level configuration
// ─────────────────────────────────────────────────────────────────────────────
const LEVELS = [
  { name: 'Rookie',  emoji: '🌱', minXP: 0,    maxXP: 499,  color: '#64748b', glow: '#64748b40' },
  { name: 'Learner', emoji: '📚', minXP: 500,  maxXP: 1499, color: '#6366f1', glow: '#6366f140' },
  { name: 'Skilled', emoji: '⚡', minXP: 1500, maxXP: 2999, color: '#8b5cf6', glow: '#8b5cf640' },
  { name: 'Expert',  emoji: '🧠', minXP: 3000, maxXP: 5999, color: '#f59e0b', glow: '#f59e0b40' },
  { name: 'Master',  emoji: '🏆', minXP: 6000, maxXP: Infinity, color: '#10b981', glow: '#10b98140' },
];

function getLevel(xp) {
  return LEVELS.find(l => xp >= l.minXP && xp <= l.maxXP) || LEVELS[0];
}

function getXpProgress(xp) {
  const level = getLevel(xp);
  if (level.maxXP === Infinity) return { pct: 100, toNext: 0 };
  const range = level.maxXP - level.minXP + 1;
  const progress = xp - level.minXP;
  return {
    pct: Math.round((progress / range) * 100),
    toNext: level.maxXP + 1 - xp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge definitions
// ─────────────────────────────────────────────────────────────────────────────
function buildBadges({ totalSessions, currentStreak, bestStreak, bestScore, perfectScore, planComplete, uniqueSkills, sessionsThisWeek }) {
  return [
    {
      id: 'first_launch',
      icon: '🚀',
      name: 'First Launch',
      desc: 'Complete your first session',
      unlocked: totalSessions >= 1,
      color: '#6366f1',
    },
    {
      id: 'on_fire',
      icon: '🔥',
      name: 'On Fire',
      desc: '3-day learning streak',
      unlocked: currentStreak >= 3,
      color: '#f97316',
    },
    {
      id: 'sharpshooter',
      icon: '🎯',
      name: 'Sharpshooter',
      desc: 'Score 90%+ on a quiz',
      unlocked: bestScore >= 90,
      color: '#ef4444',
    },
    {
      id: 'knowledge_seeker',
      icon: '📚',
      name: 'Knowledge Seeker',
      desc: 'Complete 5 sessions',
      unlocked: totalSessions >= 5,
      color: '#8b5cf6',
    },
    {
      id: 'speed_learner',
      icon: '⚡',
      name: 'Speed Learner',
      desc: 'Complete 3 sessions in one week',
      unlocked: sessionsThisWeek >= 3,
      color: '#f59e0b',
    },
    {
      id: 'star_student',
      icon: '🌟',
      name: 'Star Student',
      desc: 'Complete 10 sessions',
      unlocked: totalSessions >= 10,
      color: '#eab308',
    },
    {
      id: 'consistent',
      icon: '🔐',
      name: 'Consistent',
      desc: '7-day learning streak',
      unlocked: currentStreak >= 7 || bestStreak >= 7,
      color: '#14b8a6',
    },
    {
      id: 'diamond_mind',
      icon: '💎',
      name: 'Diamond Mind',
      desc: '30 total sessions',
      unlocked: totalSessions >= 30,
      color: '#06b6d4',
    },
    {
      id: 'graduate',
      icon: '🎓',
      name: 'Graduate',
      desc: 'Finish all days of a plan',
      unlocked: !!planComplete,
      color: '#10b981',
    },
    {
      id: 'champion',
      icon: '🏆',
      name: 'Champion',
      desc: 'Score 100% on any quiz',
      unlocked: !!perfectScore,
      color: '#f59e0b',
    },
    {
      id: 'explorer',
      icon: '🌍',
      name: 'Explorer',
      desc: 'Start 3 different skills',
      unlocked: uniqueSkills >= 3,
      color: '#3b82f6',
    },
    {
      id: 'ai_native',
      icon: '🤖',
      name: 'AI Native',
      desc: '??? Use all AI features',
      unlocked: false,
      mystery: true,
      color: '#6366f1',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity Heatmap
// ─────────────────────────────────────────────────────────────────────────────
function ActivityHeatmap({ sessions }) {
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const result = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = (sessions || []).filter(s => {
        const sd = new Date(s.createdAt || s.completedAt || 0);
        return sd.toISOString().slice(0, 10) === dateStr;
      }).length;
      result.push({ date: d, dateStr, count, dayNum: d.getDate() });
    }
    return result;
  }, [sessions]);

  const cellColor = (count) => {
    if (count === 0) return 'bg-slate-800';
    if (count === 1) return 'bg-indigo-900';
    if (count === 2) return 'bg-indigo-700';
    return 'bg-indigo-500';
  };

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-6">
      <h3 className="text-sm font-black text-white uppercase tracking-widest mb-5 flex items-center gap-2">
        <span className="text-indigo-400">📅</span>
        Learning Activity — Last 30 Days
      </h3>

      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
        {days.map((day, i) => (
          <div key={i} className="relative group">
            <div
              className={`aspect-square rounded-md ${cellColor(day.count)} transition-all duration-200 group-hover:scale-110 group-hover:brightness-125 cursor-default`}
              title={`${day.dateStr}: ${day.count} session${day.count !== 1 ? 's' : ''}`}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              <div className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-xl">
                {day.dateStr.slice(5)}: {day.count} session{day.count !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-4 text-xs text-slate-500">
        <span>None</span>
        <div className="w-4 h-4 rounded bg-slate-800 border border-slate-700/50" />
        <div className="w-4 h-4 rounded bg-indigo-900" />
        <div className="w-4 h-4 rounded bg-indigo-700" />
        <div className="w-4 h-4 rounded bg-indigo-500" />
        <span>Active</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge Card
// ─────────────────────────────────────────────────────────────────────────────
function BadgeCard({ badge, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.055, type: 'spring', stiffness: 280, damping: 22 }}
      className={`relative rounded-2xl border p-4 flex flex-col items-center gap-2 text-center transition-all duration-300
        ${badge.unlocked
          ? 'bg-gradient-to-b from-slate-800/80 to-slate-900/60 border-slate-600/60 hover:border-slate-500/80 hover:scale-105'
          : 'bg-slate-900/40 border-slate-700/30 grayscale opacity-60'
        }`}
      style={badge.unlocked ? { boxShadow: `0 0 20px ${badge.color}25` } : {}}
    >
      {/* Glow ring for unlocked */}
      {badge.unlocked && (
        <div
          className="absolute inset-0 rounded-2xl opacity-20 pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 0%, ${badge.color}60, transparent 70%)` }}
        />
      )}

      {/* Icon */}
      <div className="relative">
        <span
          className="text-3xl leading-none block"
          style={badge.unlocked ? { filter: `drop-shadow(0 0 8px ${badge.color}90)` } : {}}
        >
          {badge.unlocked || !badge.mystery ? badge.icon : '🔒'}
        </span>
        {!badge.unlocked && (
          <span className="absolute -bottom-1 -right-1 text-xs bg-slate-800 rounded-full px-1 border border-slate-700">
            🔒
          </span>
        )}
      </div>

      {/* Name */}
      <p className={`text-xs font-black leading-tight ${badge.unlocked ? 'text-white' : 'text-slate-500'}`}>
        {badge.name}
      </p>

      {/* Description */}
      <p className={`text-[10px] leading-snug ${badge.unlocked ? 'text-slate-400' : 'text-slate-600'}`}>
        {badge.mystery && !badge.unlocked ? '???' : badge.desc}
      </p>

      {/* Earned tag */}
      {badge.unlocked && (
        <span
          className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider border"
          style={{ backgroundColor: `${badge.color}20`, borderColor: `${badge.color}40`, color: badge.color }}
        >
          Earned!
        </span>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function AchievementSystem({ stats, sessions = [], plan }) {
  // ── Derive stats ──────────────────────────────────────────────────────────
  const totalSessions  = stats?.totalSessions  || sessions?.length || 0;
  const currentStreak  = stats?.currentStreak  || 0;
  const bestStreak     = stats?.bestStreak      || currentStreak;
  const avgScore       = stats?.avgScore        || 0;
  const bestScore      = useMemo(
    () => (sessions || []).reduce((max, s) => Math.max(max, s.score || 0), stats?.bestScore || 0),
    [sessions, stats]
  );
  const perfectScore   = bestScore >= 100;
  const planComplete   = plan?.completedDays >= plan?.totalDays && (plan?.totalDays || 0) > 0;

  const uniqueSkills = useMemo(() => {
    const names = new Set((sessions || []).map(s => s.skillName || s.skill).filter(Boolean));
    return names.size;
  }, [sessions]);

  const sessionsThisWeek = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return (sessions || []).filter(s => {
      const d = new Date(s.createdAt || s.completedAt || 0);
      return d >= weekAgo;
    }).length;
  }, [sessions]);

  // ── XP calculation ────────────────────────────────────────────────────────
  const badges       = useMemo(() => buildBadges({ totalSessions, currentStreak, bestStreak, bestScore, perfectScore, planComplete, uniqueSkills, sessionsThisWeek }), [totalSessions, currentStreak, bestStreak, bestScore, perfectScore, planComplete, uniqueSkills, sessionsThisWeek]);
  const badgesEarned = badges.filter(b => b.unlocked).length;
  const totalXP      = totalSessions * 150 + Math.round(avgScore * 2) + currentStreak * 50 + badgesEarned * 100;

  const level        = getLevel(totalXP);
  const { pct: xpPct, toNext } = getXpProgress(totalXP);

  // ── Stats row data ────────────────────────────────────────────────────────
  const statCards = [
    { label: 'Total Sessions', value: totalSessions, icon: '📚', color: '#6366f1' },
    { label: 'Current Streak', value: `${currentStreak}d`, icon: '🔥', color: '#f97316' },
    { label: 'Best Streak',    value: `${bestStreak}d`,    icon: '🏅', color: '#f59e0b' },
    { label: 'Total XP',       value: totalXP,             icon: '⚡', color: '#10b981' },
  ];

  return (
    <div className="space-y-6">

      {/* ── XP & Level Card ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-6 relative overflow-hidden"
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 10% 50%, ${level.color}80, transparent 60%)` }}
        />

        <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* Level badge */}
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="flex-shrink-0 w-24 h-24 rounded-3xl border-2 flex flex-col items-center justify-center gap-1 font-black shadow-2xl"
            style={{
              borderColor: level.color,
              backgroundColor: `${level.color}18`,
              boxShadow: `0 0 40px ${level.glow}`,
            }}
          >
            <span className="text-4xl leading-none">{level.emoji}</span>
            <span className="text-[10px] uppercase tracking-widest font-black" style={{ color: level.color }}>
              {level.name}
            </span>
          </motion.div>

          {/* XP details */}
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Current Level</p>
            <h2 className="text-3xl font-black text-white mb-1">
              {level.emoji} {level.name}
            </h2>
            <div className="flex items-center justify-center sm:justify-start gap-3 mb-4">
              <span className="text-xl font-black font-mono" style={{ color: level.color }}>
                {totalXP.toLocaleString()} XP
              </span>
              {toNext > 0 && (
                <span className="text-xs text-slate-500 font-semibold">
                  · {toNext.toLocaleString()} XP to next level
                </span>
              )}
              {toNext === 0 && (
                <span className="text-xs text-emerald-400 font-black">· MAX LEVEL 🏆</span>
              )}
            </div>

            {/* XP Progress bar */}
            <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpPct}%` }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
                className="h-full rounded-full relative overflow-hidden"
                style={{ backgroundColor: level.color }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </motion.div>
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-slate-600 font-semibold">
              <span>{level.minXP} XP</span>
              <span>{xpPct}%</span>
              <span>{level.maxXP === Infinity ? '∞' : `${level.maxXP + 1} XP`}</span>
            </div>
          </div>

          {/* Badges earned counter */}
          <div className="flex-shrink-0 text-center">
            <div
              className="text-4xl font-black font-mono"
              style={{ color: '#f59e0b' }}
            >
              {badgesEarned}
            </div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">
              Badges
            </div>
            <div className="text-[10px] text-slate-600">of {badges.length}</div>
          </div>
        </div>
      </motion.div>

      {/* ── Stats Row ────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      >
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 + i * 0.07 }}
            className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-5 flex flex-col items-center gap-2 text-center hover:border-slate-600/70 transition-all hover:scale-[1.02]"
          >
            <span className="text-2xl">{card.icon}</span>
            <span className="text-2xl font-black font-mono leading-none" style={{ color: card.color }}>
              {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
            </span>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{card.label}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Achievement Badges Grid ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
            <span>🏅</span> Achievements
          </h3>
          <span className="text-xs font-bold text-slate-500">
            {badgesEarned} / {badges.length} unlocked
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {badges.map((badge, i) => (
            <BadgeCard key={badge.id} badge={badge} index={i} />
          ))}
        </div>
      </div>

      {/* ── Activity Calendar ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <ActivityHeatmap sessions={sessions} />
      </motion.div>

      {/* ── XP Breakdown ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-5"
      >
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <span>⚡</span> XP Breakdown
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Sessions',     value: totalSessions * 150,               formula: `${totalSessions} × 150`,             color: '#6366f1' },
            { label: 'Avg Score',    value: Math.round(avgScore * 2),           formula: `${avgScore}% × 2`,                   color: '#8b5cf6' },
            { label: 'Streak',       value: currentStreak * 50,                 formula: `${currentStreak} × 50`,              color: '#f97316' },
            { label: 'Badges',       value: badgesEarned * 100,                 formula: `${badgesEarned} × 100`,              color: '#f59e0b' },
          ].map(row => (
            <div key={row.label} className="rounded-xl border border-slate-700/40 bg-slate-800/40 p-4 text-center">
              <div className="text-lg font-black font-mono" style={{ color: row.color }}>
                +{row.value.toLocaleString()}
              </div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">{row.label}</div>
              <div className="text-[10px] text-slate-600 mt-0.5 font-mono">{row.formula}</div>
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
