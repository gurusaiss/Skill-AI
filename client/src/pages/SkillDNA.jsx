import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

// ─── Sample data for demo mode ───────────────────────────────────────────────
const SAMPLE_SESSIONS = [
  { score: 62, day: 1 }, { score: 71, day: 2 }, { score: 68, day: 3 },
  { score: 78, day: 4 }, { score: 75, day: 5 }, { score: 83, day: 6 },
  { score: 88, day: 7 }, { score: 85, day: 8 }, { score: 91, day: 9 },
];

const SAMPLE_MEMORY = {
  semantic: {
    avg_score: { value: 78, confidence: 0.9, learnedAt: new Date().toISOString() },
    total_sessions: { value: 9, confidence: 1.0, learnedAt: new Date().toISOString() },
    performance_trend: { value: 'improving', confidence: 0.85, learnedAt: new Date().toISOString() },
    learning_style: { value: 'visual', confidence: 0.7, learnedAt: new Date().toISOString() },
    preferred_time: { value: 'evening', confidence: 0.6, learnedAt: new Date().toISOString() },
  },
  procedural: {
    consistent_learner: { count: 3, evidence: ['9 sessions completed', '7 days streak', 'no gaps > 2 days'], lastSeen: new Date().toISOString() },
    high_performer: { count: 2, evidence: ['scored 88% avg', 'above mastery threshold'], lastSeen: new Date().toISOString() },
  },
  episodic: [
    { id: 1, type: 'session_analysis', content: 'Analyzed 9 sessions. Avg: 78%. Trend: +29pts.', context: 'performance_review', importance: 7, timestamp: new Date(Date.now() - 86400000).toISOString() },
    { id: 2, type: 'milestone', content: 'Crossed 80% mastery threshold for the first time on session 7.', context: 'achievement', importance: 9, timestamp: new Date(Date.now() - 172800000).toISOString() },
    { id: 3, type: 'streak', content: 'Completed 5 consecutive sessions without a break.', context: 'consistency', importance: 6, timestamp: new Date(Date.now() - 259200000).toISOString() },
  ],
};

// ─── DNA Type classification ─────────────────────────────────────────────────
function classifyLearnerDNA(sessions) {
  if (!sessions || sessions.length === 0) return null;

  const scores = sessions.map(s => s.score || 0);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Days span — use day field or index
  const days = sessions.map((s, i) => s.day || i + 1);
  const totalDays = Math.max(...days);
  const consistency = sessions.length / Math.max(totalDays, 1);

  const mean = avgScore;
  const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / scores.length;
  const scoreVariance = Math.sqrt(variance);

  let type, emoji, superpower, traits;

  if (avgScore > 80 && sessions.length < 10) {
    type = 'Eagle Learner';
    emoji = '🦅';
    superpower = 'You grasp concepts fast and retain them deeply with minimal repetition.';
    traits = { speed: 95, consistency: 65, depth: 85 };
  } else if (consistency > 0.8 && scoreVariance < 15) {
    type = 'Deep Diver';
    emoji = '🐢';
    superpower = 'Your consistent effort builds rock-solid mastery that lasts.';
    traits = { speed: 55, consistency: 98, depth: 92 };
  } else if (scoreVariance > 20) {
    type = 'Adaptive Learner';
    emoji = '🦊';
    superpower = 'You adapt rapidly to new topics and thrive under changing conditions.';
    traits = { speed: 80, consistency: 50, depth: 70 };
  } else {
    type = 'Sprint Learner';
    emoji = '🔥';
    superpower = 'You perform best in focused bursts — high energy, high output.';
    traits = { speed: 88, consistency: 45, depth: 75 };
  }

  // Study time badge — seeded from avg score
  const times = ['Morning', 'Afternoon', 'Evening', 'Flexible'];
  const optimalTime = times[Math.floor(avgScore * 13 % 4)];

  return { type, emoji, superpower, traits, optimalTime, avgScore: Math.round(avgScore), consistency: Math.round(consistency * 100), scoreVariance: Math.round(scoreVariance) };
}

// ─── Seeded pseudo-random heatmap ────────────────────────────────────────────
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateHeatmap(userId = 'demo') {
  const seed = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = seededRand(seed);
  const days = 7;
  const hours = 24;
  const grid = [];
  for (let d = 0; d < days; d++) {
    const row = [];
    for (let h = 0; h < hours; h++) {
      // Bias toward 6am-11am and 6pm-10pm
      let bias = 0;
      if (h >= 6 && h <= 11) bias = 0.4;
      if (h >= 18 && h <= 22) bias = 0.5;
      const val = Math.min(3, Math.floor((rand() + bias) * 2.5));
      row.push(val);
    }
    grid.push(row);
  }
  return grid;
}

// ─── Forgetting curve data ────────────────────────────────────────────────────
function forgettingCurveData(avgScore = 75) {
  const stability = Math.max(5, (avgScore / 100) * 20); // days of stability
  const data = [];
  for (let t = 0; t <= 30; t++) {
    const retention = Math.round(Math.exp(-t / stability) * 100);
    data.push({ day: t, retention, threshold: 60 });
  }
  return data;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TraitBar({ label, value, color }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className="text-white font-bold">{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </div>
    </div>
  );
}

function DNAProfileCard({ dna, isDemo }) {
  if (!dna) return (
    <div className="bg-[#1E293B] rounded-2xl p-6 border border-slate-700/50 flex items-center justify-center h-full min-h-[280px]">
      <p className="text-slate-500 text-sm">Not enough sessions to classify your DNA type yet.</p>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="bg-[#1E293B] rounded-2xl p-6 border border-violet-500/20 relative overflow-hidden"
    >
      {/* Glow blob */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative">
        <p className="text-xs text-violet-400 uppercase tracking-widest mb-1 font-semibold">Your Learning DNA</p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-5xl">{dna.emoji}</span>
          <div>
            <h2 className="text-2xl font-black bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent leading-tight">
              {dna.type}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded-full">
                ⏰ {dna.optimalTime} Learner
              </span>
              {isDemo && (
                <span className="text-xs bg-amber-900/30 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  Demo Mode
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-300 mb-5 leading-relaxed">
          <span className="text-violet-400 font-semibold">Superpower:</span> {dna.superpower}
        </p>

        <TraitBar label="Learning Speed" value={dna.traits.speed} color="bg-gradient-to-r from-violet-500 to-indigo-500" />
        <TraitBar label="Consistency" value={dna.traits.consistency} color="bg-gradient-to-r from-indigo-500 to-sky-500" />
        <TraitBar label="Depth of Knowledge" value={dna.traits.depth} color="bg-gradient-to-r from-sky-500 to-teal-500" />

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="bg-slate-800/60 rounded-xl p-3">
            <p className="text-xl font-black text-white">{dna.avgScore}%</p>
            <p className="text-xs text-slate-500 mt-0.5">Avg Score</p>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3">
            <p className="text-xl font-black text-violet-400">{dna.consistency}%</p>
            <p className="text-xs text-slate-500 mt-0.5">Consistency</p>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3">
            <p className="text-xl font-black text-indigo-400">{dna.scoreVariance}</p>
            <p className="text-xs text-slate-500 mt-0.5">Variance</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const CustomVelocityTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-violet-500/30 rounded-xl px-4 py-3 shadow-2xl">
        <p className="text-xs text-slate-400 mb-1">Session {label}</p>
        <p className="text-base font-bold text-white">{payload[0]?.value}% score</p>
      </div>
    );
  }
  return null;
};

function VelocityChart({ sessions }) {
  const data = useMemo(() => {
    const src = sessions.length >= 3 ? sessions : SAMPLE_SESSIONS;
    return src.map((s, i) => ({ session: s.day || i + 1, score: s.score || 0 }));
  }, [sessions]);

  const isPlaceholder = sessions.length < 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="bg-[#1E293B] rounded-2xl p-6 border border-slate-700/50 relative overflow-hidden"
    >
      <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-indigo-400 uppercase tracking-widest font-semibold">Learning Velocity</p>
            <h3 className="text-base font-bold text-white mt-0.5">Score Trajectory</h3>
          </div>
          {isPlaceholder && (
            <span className="text-xs bg-slate-700/60 text-slate-400 px-2 py-1 rounded-full border border-slate-600/50">
              Sample data
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="session" tick={{ fill: '#64748B', fontSize: 11 }} label={{ value: 'Session', position: 'insideBottom', offset: -3, fill: '#64748B', fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#64748B', fontSize: 11 }} />
            <Tooltip content={<CustomVelocityTooltip />} />
            <ReferenceLine y={70} stroke="#F59E0B" strokeDasharray="6 3" label={{ value: 'Mastery 70%', position: 'right', fill: '#F59E0B', fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="score"
              stroke="url(#velocityGrad)"
              strokeWidth={3}
              dot={{ fill: '#6366F1', strokeWidth: 2, r: 4, stroke: '#818CF8' }}
              activeDot={{ r: 6, fill: '#A78BFA', stroke: '#C4B5FD', strokeWidth: 2 }}
            />
            <defs>
              <linearGradient id="velocityGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6366F1" />
                <stop offset="100%" stopColor="#A78BFA" />
              </linearGradient>
            </defs>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOUR_LABELS = { 6: '6am', 9: '9am', 12: '12pm', 15: '3pm', 18: '6pm', 21: '9pm', 23: '12am' };

const INTENSITY_CLASSES = [
  'bg-slate-800',
  'bg-violet-900',
  'bg-violet-700',
  'bg-violet-500',
];

function PerformanceHeatmap({ userId }) {
  const grid = useMemo(() => generateHeatmap(userId || 'demo'), [userId]);

  // Find peak cell
  let peakD = 0, peakH = 0, peakVal = 0;
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > peakVal) { peakVal = v; peakD = d; peakH = h; } }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="bg-[#1E293B] rounded-2xl p-6 border border-slate-700/50"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Performance Heatmap</p>
          <h3 className="text-base font-bold text-white mt-0.5">Peak Performance Times</h3>
        </div>
        <div className="group relative">
          <span className="text-slate-500 cursor-help text-sm">ⓘ</span>
          <div className="absolute right-0 mt-1 w-52 bg-slate-700 text-xs text-slate-300 rounded-xl p-3 hidden group-hover:block z-10 shadow-xl border border-slate-600/50">
            Simulated based on your learning profile. Shows likely peak performance windows across the week.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {/* Hour labels */}
          <div className="flex mb-1 pl-9">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center">
                {HOUR_LABELS[h] ? <span className="text-[9px] text-slate-500">{HOUR_LABELS[h]}</span> : null}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {grid.map((row, d) => (
            <div key={d} className="flex items-center mb-0.5 gap-0.5">
              <span className="text-[10px] text-slate-500 w-8 flex-shrink-0 text-right pr-1">{DAY_LABELS[d]}</span>
              {row.map((val, h) => {
                const isPeak = d === peakD && h === peakH;
                return (
                  <div
                    key={h}
                    title={`${DAY_LABELS[d]} ${h}:00 — intensity ${val}`}
                    className={`flex-1 h-3 rounded-[2px] transition-all ${INTENSITY_CLASSES[val]} ${isPeak ? 'ring-1 ring-white/60 shadow-[0_0_6px_2px_rgba(167,139,250,0.5)]' : ''}`}
                  />
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 justify-end">
            <span className="text-[10px] text-slate-500">Low</span>
            {INTENSITY_CLASSES.map((cls, i) => (
              <div key={i} className={`w-4 h-3 rounded-sm ${cls}`} />
            ))}
            <span className="text-[10px] text-slate-500">High</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const CustomCurveTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-indigo-500/30 rounded-xl px-4 py-3 shadow-2xl">
        <p className="text-xs text-slate-400 mb-1">Day {label}</p>
        <p className="text-sm font-bold text-indigo-300">Retention: {payload[0]?.value}%</p>
      </div>
    );
  }
  return null;
};

const REVIEW_DAYS = [1, 3, 7, 14];

function ForgettingCurve({ avgScore }) {
  const data = useMemo(() => forgettingCurveData(avgScore), [avgScore]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-[#1E293B] rounded-2xl p-6 border border-slate-700/50 relative overflow-hidden"
    >
      <div className="absolute -top-8 right-0 w-48 h-48 bg-sky-600/5 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-xs text-sky-400 uppercase tracking-widest font-semibold">Ebbinghaus Model</p>
            <h3 className="text-base font-bold text-white mt-0.5">Forgetting Curve — When to Review</h3>
          </div>
          <div className="flex gap-3 items-center text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-indigo-400 rounded" /> Retention</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 border-t-2 border-dashed border-red-500 rounded" /> 60% threshold</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 mt-2">
          {REVIEW_DAYS.map(d => (
            <span key={d} className="text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              Review Day {d}
            </span>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id="retentionGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366F1" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
            <XAxis dataKey="day" tick={{ fill: '#64748B', fontSize: 11 }} label={{ value: 'Days since last session', position: 'insideBottom', offset: -3, fill: '#64748B', fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#64748B', fontSize: 11 }} />
            <Tooltip content={<CustomCurveTooltip />} />
            <ReferenceLine y={60} stroke="#EF4444" strokeDasharray="6 3" />
            {REVIEW_DAYS.map(d => (
              <ReferenceLine key={d} x={d} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1.5} />
            ))}
            <Area type="monotone" dataKey="retention" stroke="#6366F1" strokeWidth={2.5} fill="url(#retentionGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>

        <p className="text-xs text-slate-500 mt-3 text-center">
          Formula: R = e<sup>(-t/S)</sup> where stability S = {Math.max(5, Math.round((avgScore / 100) * 20))} days based on your avg score
        </p>
      </div>
    </motion.div>
  );
}

const MEMORY_TABS = ['Facts Learned', 'Patterns Detected', 'Recent Episodes'];

function MemoryBrowser({ memory, loading, error }) {
  const [activeTab, setActiveTab] = useState(0);

  const mem = memory || SAMPLE_MEMORY;
  const semanticEntries = Object.entries(mem.semantic || {});
  const proceduralEntries = Object.entries(mem.procedural || {});
  const episodes = (mem.episodic || []).slice().reverse().slice(0, 15);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="bg-[#1E293B] rounded-2xl p-6 border border-slate-700/50 relative overflow-hidden"
    >
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-teal-600/8 rounded-full blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-teal-400 uppercase tracking-widest font-semibold">Agent Memory</p>
            <h3 className="text-base font-bold text-white mt-0.5">What AI Knows About You</h3>
          </div>
          {loading && <span className="text-xs text-slate-500 animate-pulse">Loading memory...</span>}
          {error && <span className="text-xs text-amber-400">Using sample data</span>}
          {!loading && !error && memory && (
            <span className="text-xs bg-teal-900/30 text-teal-400 border border-teal-500/20 px-2 py-0.5 rounded-full">Live</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-800/60 rounded-xl mb-5 w-fit">
          {MEMORY_TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === i
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 0 && (
            <motion.div key="facts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {semanticEntries.length === 0 ? (
                <p className="text-slate-500 text-sm">No facts learned yet.</p>
              ) : (
                <div className="space-y-3">
                  {semanticEntries.map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-slate-300 capitalize">{key.replace(/_/g, ' ')}</span>
                          <span className="text-sm font-bold text-white ml-3">{String(val.value)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round((val.confidence || 0.5) * 100)}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                          />
                        </div>
                        <p className="text-[10px] text-slate-600 mt-0.5">{Math.round((val.confidence || 0.5) * 100)}% confidence</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 1 && (
            <motion.div key="patterns" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {proceduralEntries.length === 0 ? (
                <p className="text-slate-500 text-sm">No patterns detected yet. Keep learning!</p>
              ) : (
                <div className="space-y-3">
                  {proceduralEntries.map(([pattern, data]) => (
                    <div key={pattern} className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-white capitalize">{pattern.replace(/_/g, ' ')}</span>
                        <span className="text-xs bg-indigo-900/50 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-bold">
                          {data.count}x observed
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(data.evidence || []).slice(-3).map((e, i) => (
                          <span key={i} className="text-xs text-slate-400 bg-slate-700/40 px-2 py-0.5 rounded-full border border-slate-600/30">
                            {e}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 2 && (
            <motion.div key="episodes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {episodes.length === 0 ? (
                <p className="text-slate-500 text-sm">No episodes recorded yet.</p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {episodes.map((ep, i) => (
                    <div key={ep.id || i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0 mt-1.5" />
                        {i < episodes.length - 1 && <div className="w-px flex-1 bg-slate-700 mt-1" />}
                      </div>
                      <div className="pb-3 flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs text-violet-400 font-semibold capitalize">{(ep.type || 'event').replace(/_/g, ' ')}</span>
                          <span className="text-[10px] text-slate-600">
                            {ep.timestamp ? new Date(ep.timestamp).toLocaleDateString() : ''}
                          </span>
                          {ep.importance >= 8 && (
                            <span className="text-[10px] bg-amber-900/30 text-amber-400 px-1.5 rounded-full border border-amber-500/20">High</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">{ep.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Main SkillDNA Page ───────────────────────────────────────────────────────
export default function SkillDNA() {
  const [memory, setMemory] = useState(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState(null);

  const userId = localStorage.getItem('skillforge:userId');
  const storedData = useMemo(() => {
    if (!userId) return null;
    try { return JSON.parse(localStorage.getItem(`sf_data_${userId}`) || 'null'); } catch { return null; }
  }, [userId]);

  const sessions = useMemo(() => {
    if (!storedData) return [];
    if (Array.isArray(storedData.sessions)) return storedData.sessions;
    if (Array.isArray(storedData.agentDecisions)) {
      return storedData.agentDecisions.filter(d => d.type === 'session_complete');
    }
    return [];
  }, [storedData]);

  const isDemo = sessions.length === 0;
  const activeSessions = isDemo ? SAMPLE_SESSIONS : sessions;
  const dna = useMemo(() => classifyLearnerDNA(activeSessions), [activeSessions]);

  const avgScore = useMemo(() => {
    if (!activeSessions.length) return 75;
    return Math.round(activeSessions.reduce((a, s) => a + (s.score || 0), 0) / activeSessions.length);
  }, [activeSessions]);

  useEffect(() => {
    if (!userId) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    setMemoryLoading(true);
    const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
    fetch(`${API_BASE}/api/memory/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(j => {
        if (j.success) setMemory(j.data);
        else setMemoryError(j.error || 'Failed to load memory');
      })
      .catch(e => setMemoryError(e.message))
      .finally(() => setMemoryLoading(false));
  }, [userId]);

  return (
    <div className="min-h-screen bg-[#0F172A] px-4 py-10 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-10 text-center"
      >
        <div className="inline-flex items-center gap-2 bg-violet-900/20 border border-violet-500/20 px-4 py-1.5 rounded-full text-xs text-violet-400 font-semibold uppercase tracking-widest mb-4">
          <span>🧬</span> Skill DNA Analytics
        </div>
        <h1 className="text-4xl md:text-5xl font-black text-white mb-3">
          Your{' '}
          <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400 bg-clip-text text-transparent">
            Skill DNA
          </span>
        </h1>
        <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">
          A deep-learning analysis of how you learn, when you peak, and what the AI has discovered about your unique cognitive profile.
        </p>
        {isDemo && (
          <div className="mt-4 inline-flex items-center gap-2 bg-amber-900/20 border border-amber-500/20 px-4 py-2 rounded-xl text-xs text-amber-400">
            <span>⚠️</span> Showing sample data — complete sessions to see your real Skill DNA
          </div>
        )}
      </motion.div>

      {/* Row 1: DNA Profile + Velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <DNAProfileCard dna={dna} isDemo={isDemo} />
        <VelocityChart sessions={activeSessions} />
      </div>

      {/* Row 2: Performance Heatmap */}
      <div className="mb-6">
        <PerformanceHeatmap userId={userId || 'demo'} />
      </div>

      {/* Row 3: Forgetting Curve */}
      <div className="mb-6">
        <ForgettingCurve avgScore={avgScore} />
      </div>

      {/* Row 4: Memory Browser */}
      <div className="mb-6">
        <MemoryBrowser memory={memory} loading={memoryLoading} error={memoryError} />
      </div>
    </div>
  );
}
