import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, scoreColor } from '../utils/api.js';
import AgentBrain from '../components/AgentBrain.jsx';
import SkillDigitalTwin from '../components/SkillDigitalTwin.jsx';
import PredictiveMasteryForecast from '../components/PredictiveMasteryForecast.jsx';
import AgentThinking from '../components/AgentThinking.jsx';
import MetricModal from '../components/MetricModal.jsx';
import ProjectModal from '../components/ProjectModal.jsx';
import SkillDetailModal from '../components/SkillDetailModal.jsx';
import HistoryDetailModal from '../components/HistoryDetailModal.jsx';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
function ProgressBar({ value, color = '#6366f1', thin = false }) {
  return (
    <div className={`w-full bg-slate-800 rounded-full overflow-hidden ${thin ? 'h-1.5' : 'h-2.5'}`}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.max(value, 2)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color = '#6366f1', sub, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 min-w-[90px] rounded-2xl border border-slate-700/60 bg-slate-800/50 hover:bg-slate-800/80 hover:border-slate-600 transition-all p-4 text-center group"
    >
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-2xl font-black font-mono leading-none mb-1" style={{ color }}>{value}</div>
      <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY'S MISSION CARD  (most prominent element)
// ─────────────────────────────────────────────────────────────────────────────
function MissionCard({ planDay, adaptations, onLaunch, loading }) {
  if (!planDay) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-8 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <p className="text-2xl font-black text-white">All Sessions Complete!</p>
        <p className="text-slate-400 mt-2">Generate your final competency report below.</p>
      </div>
    );
  }

  const typeConfig = {
    concept:  { bg: 'from-blue-600/20 to-indigo-600/10',  border: 'border-blue-500/30',   badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',   icon: '📖', dot: 'bg-blue-400' },
    practice: { bg: 'from-indigo-600/20 to-purple-600/10', border: 'border-indigo-500/30', badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', icon: '⚔️', dot: 'bg-indigo-400' },
    review:   { bg: 'from-amber-600/15 to-orange-600/5',  border: 'border-amber-500/30',  badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',  icon: '🔄', dot: 'bg-amber-400' },
  };
  const tc = typeConfig[planDay.sessionType] || typeConfig.practice;

  const durationMap = { concept: 25, practice: 35, review: 20 };
  const duration = durationMap[planDay.sessionType] || 30;

  return (
    <div className={`rounded-2xl border ${tc.border} bg-gradient-to-br ${tc.bg} p-6`}>
      {/* Top row: badges */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-600/30 border border-indigo-500/40 text-indigo-200 text-xs font-black uppercase tracking-wide">
          📅 Day {planDay.day}
        </span>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold capitalize ${tc.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tc.dot} animate-pulse`} />
          {planDay.sessionType}
        </span>
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-800/60 border border-slate-700 text-slate-400 text-xs font-semibold">
          ⏱ ~{duration} min
        </span>
        {planDay.addedByAgent && (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold">
            ⚡ AI Added
          </span>
        )}
      </div>

      {/* Skill + Topic */}
      <div className="mb-4">
        <h2 className="text-3xl font-black text-white leading-tight">{planDay.skillName}</h2>
        {planDay.topic && (
          <p className="text-base font-semibold text-indigo-300 mt-1.5">
            📌 {planDay.topic}
          </p>
        )}
        {planDay.objective && (
          <p className="text-sm text-slate-300 leading-relaxed mt-3 max-w-2xl">
            {planDay.objective}
          </p>
        )}
      </div>

      {/* Agent adaptation notice */}
      {adaptations.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3 mb-4">
          <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 flex-shrink-0 animate-pulse" />
          <p className="text-sm text-amber-300/90 leading-relaxed">{adaptations[adaptations.length - 1]}</p>
        </div>
      )}

      {/* Launch button */}
      <button
        onClick={onLaunch}
        disabled={loading}
        className="w-full py-4 rounded-xl font-black text-base text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 transition-all hover:shadow-2xl hover:shadow-indigo-500/30 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Loading Challenge…
          </>
        ) : (
          <>
            <span className="text-xl">🚀</span>
            Launch Practice Session
          </>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',    label: 'Overview',    icon: '🗺️' },
  { id: 'plan',        label: 'Plan',        icon: '📅' },
  { id: 'skills',      label: 'Skills',      icon: '🌳' },
  { id: 'performance', label: 'Performance', icon: '📈' },
  { id: 'agent',       label: 'Agent Brain', icon: '🧠' },
  { id: 'history',     label: 'History',     icon: '📝' },
];

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex-shrink-0 ${
            active === t.id
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN TIMELINE
// ─────────────────────────────────────────────────────────────────────────────
function PlanTimeline({ learningPlan, navigate }) {
  const [hoveredDay, setHoveredDay] = useState(null);

  const groups = learningPlan.reduce((acc, d) => {
    (acc[d.skillName] = acc[d.skillName] || []).push(d);
    return acc;
  }, {});

  const typeIcon  = { concept: '📖', practice: '⚔️', review: '🔄' };
  const typeColor = {
    concept:  { bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   text: 'text-blue-300' },
    practice: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-300' },
    review:   { bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  text: 'text-amber-300' },
  };

  return (
    <div className="space-y-8">
      {Object.entries(groups).map(([skill, days], gi) => {
        const doneCount = days.filter(d => d.completed).length;
        const pct = Math.round((doneCount / days.length) * 100);
        return (
          <div key={skill}>
            {/* Group header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center font-black text-indigo-300 text-lg flex-shrink-0">
                {gi + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-black text-white">{skill}</p>
                <p className="text-xs text-slate-500">{days.length} sessions · {doneCount} completed · {pct}%</p>
              </div>
              <div className="w-24 hidden sm:block">
                <ProgressBar value={pct} thin />
              </div>
            </div>

            {/* Day cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {days.map(d => {
                const tc = typeColor[d.sessionType] || typeColor.practice;
                return (
                  <button
                    key={d.day}
                    onClick={() => !d.completed && navigate(`/session/${d.day}`)}
                    onMouseEnter={() => setHoveredDay(d.day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    disabled={d.completed}
                    className={`relative rounded-xl border p-4 text-left transition-all duration-200
                      ${d.completed
                        ? 'bg-emerald-500/8 border-emerald-500/25 cursor-default opacity-70'
                        : d.addedByAgent
                        ? 'bg-amber-500/8 border-amber-500/25 hover:bg-amber-500/15 hover:border-amber-400/50 cursor-pointer'
                        : `${tc.bg} ${tc.border} hover:border-indigo-400/50 hover:brightness-110 cursor-pointer`
                      }`}
                  >
                    {/* Day + status */}
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                        d.completed ? 'bg-emerald-500/20 text-emerald-400'
                          : d.addedByAgent ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-800 ' + tc.text
                      }`}>
                        {d.completed ? '✓ Done' : `Day ${d.day}`}
                      </span>
                      <span className="text-sm">{d.completed ? '✅' : typeIcon[d.sessionType] || '📌'}</span>
                    </div>

                    {/* Topic */}
                    <p className={`text-sm font-bold leading-snug line-clamp-2 mb-2 ${
                      d.completed ? 'text-emerald-300/70' : 'text-slate-100'
                    }`}>
                      {d.topic || d.skillName}
                    </p>

                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold capitalize ${tc.text}`}>{d.sessionType}</span>
                      <span className="text-xs text-slate-600">{d.estimatedMinutes}m</span>
                    </div>

                    {d.addedByAgent && (
                      <span className="absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                        ⚡
                      </span>
                    )}

                    {/* Tooltip */}
                    {hoveredDay === d.day && d.objective && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 z-20 bg-slate-900 border border-slate-700 rounded-xl p-3 shadow-2xl pointer-events-none">
                        <p className="text-xs text-slate-300 leading-relaxed">{d.objective}</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-500">
        {[
          ['bg-emerald-500/10 border-emerald-500/25', '✅', 'Completed'],
          ['bg-indigo-500/10 border-indigo-500/30',   '⚔️', 'Practice'],
          ['bg-blue-500/10 border-blue-500/30',       '📖', 'Concept'],
          ['bg-amber-500/10 border-amber-500/25',     '⚡', 'AI Added'],
        ].map(([cls, icon, label]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded border text-xs flex items-center justify-center ${cls}`}>{icon}</div>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILL BARS
// ─────────────────────────────────────────────────────────────────────────────
function SkillBars({ skills, diagnosticScores, onSkillClick }) {
  const [expanded, setExpanded] = useState(null);
  if (!skills.length) return <p className="text-slate-500 text-center py-10">No skills loaded.</p>;

  const barColor = m => m >= 75 ? '#10b981' : m >= 50 ? '#6366f1' : m > 0 ? '#f59e0b' : '#475569';
  const statusBadge = {
    complete:     'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    active:       'bg-indigo-500/15  text-indigo-400  border-indigo-500/30',
    demonstrated: 'bg-teal-500/15    text-teal-400    border-teal-500/30',
    locked:       'bg-slate-800      text-slate-600   border-slate-700',
  };

  return (
    <div className="space-y-3">
      {skills.map(skill => {
        const color = barColor(skill.mastery);
        const isOpen = expanded === skill.id;
        const diag = diagnosticScores?.[skill.id];
        return (
          <div key={skill.id} className={`rounded-xl border transition-all overflow-hidden ${isOpen ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-700/50 bg-slate-800/30'}`}>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <button onClick={() => setExpanded(isOpen ? null : skill.id)}
                className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
                <span className={`text-sm inline-block transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>▶</span>
              </button>
              <button onClick={() => onSkillClick?.(skill)} className="flex-1 text-left min-w-0">
                <span className="text-sm font-semibold text-slate-200 hover:text-white transition-colors">{skill.name}</span>
              </button>
              <div className="flex items-center gap-2 flex-shrink-0">
                {diag != null && <span className="text-xs text-slate-500 hidden sm:block">Diag {diag}%</span>}
                <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold capitalize ${statusBadge[skill.status] || statusBadge.locked}`}>
                  {skill.status}
                </span>
                <span className="text-sm font-black font-mono w-12 text-right" style={{ color }}>{skill.mastery}%</span>
              </div>
            </div>
            <div className="px-4 pb-3">
              <ProgressBar value={skill.mastery} color={color} thin />
            </div>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-slate-700/40">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Topics</p>
                {skill.topics?.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {skill.topics.map((t, i) => (
                      <span key={i} className="text-xs px-3 py-1 rounded-lg border font-medium"
                        style={{ backgroundColor: `${color}10`, borderColor: `${color}25`, color }}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 italic">Complete sessions to populate topics.</p>
                )}
                {diag != null && (
                  <p className="text-xs text-slate-500 mt-3">
                    Diagnostic: <span className="font-bold text-slate-400">{diag}%</span>
                    {diag < 50 ? ' · extra practice added' : diag >= 75 ? ' · strong baseline' : ' · moderate baseline'}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-600 text-center pt-1">Click skill name for details · click ▶ to expand topics</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE CHART
// ─────────────────────────────────────────────────────────────────────────────
function ScoreChart({ sessions }) {
  if (sessions.length < 2) return (
    <div className="h-44 flex flex-col items-center justify-center text-slate-600 text-sm gap-2">
      <span className="text-3xl opacity-30">📈</span>
      Complete 2+ sessions to see your trend
    </div>
  );
  const data = sessions.map((s, i) => ({ n: i + 1, day: s.day, score: s.score, skill: s.skillName }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="n" tick={{ fontSize: 9, fill: '#475569' }} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#475569' }} tickLine={false} />
        <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" />
        <Tooltip
          content={({ active, payload }) => active && payload?.length ? (
            <div className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-xl">
              <p className="text-slate-400">Day {payload[0].payload.day} · {payload[0].payload.skill}</p>
              <p className="font-black text-indigo-300 text-base">{payload[0].value}%</p>
            </div>
          ) : null}
        />
        <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2.5} fill="url(#scoreGrad)"
          dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECENT SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
function RecentSessions({ sessions, onSessionClick }) {
  if (!sessions.length) return (
    <div className="text-center py-14">
      <div className="text-4xl mb-3 opacity-30">📝</div>
      <p className="text-slate-500">No sessions completed yet — start Day 1!</p>
    </div>
  );
  return (
    <div className="space-y-2">
      {[...sessions].reverse().slice(0, 10).map((s, i) => (
        <button key={i} onClick={() => onSessionClick?.(s)}
          className="w-full flex items-center gap-3 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:bg-slate-800/70 hover:border-slate-600 px-4 py-3.5 transition-all text-left">
          <span className="font-mono text-slate-500 font-bold w-10 flex-shrink-0 text-sm">D{s.day}</span>
          <span className="flex-1 text-slate-200 font-semibold text-sm truncate">{s.skillName}</span>
          <span className="text-xs text-slate-500 truncate max-w-[120px] hidden sm:block">{s.strengths?.[0]?.slice(0, 35) || '—'}</span>
          <span className={`font-black font-mono text-sm w-12 text-right ${scoreColor(s.score)}`}>{s.score}%</span>
          <span className="text-xs font-black px-2 py-1 rounded-lg font-mono" style={{
            backgroundColor: s.score >= 75 ? '#10b98118' : s.score >= 50 ? '#6366f118' : '#ef444418',
            color: s.score >= 75 ? '#10b981' : s.score >= 50 ? '#a5b4fc' : '#f87171',
          }}>{s.grade}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAREER OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────
function CareerOverview({ goal, sessions, onProjectClick }) {
  const profiling = (() => { try { return JSON.parse(localStorage.getItem('skillforge:profiling') || 'null'); } catch { return null; } })();
  const avgScore = sessions.length ? Math.round(sessions.reduce((s, r) => s + r.score, 0) / sessions.length) : null;
  const gapLevel = !avgScore ? 'Not assessed yet' : avgScore >= 80 ? 'Minimal — strong foundation' : avgScore >= 60 ? 'Moderate — key areas to strengthen' : 'Significant — structured practice needed';

  const getDomainResources = (domain) => {
    const m = {
      frontend_development: [
        { label: 'MDN Web Docs',       url: 'https://developer.mozilla.org/', icon: '📖' },
        { label: 'React Documentation',url: 'https://react.dev/',             icon: '⚛️' },
        { label: 'freeCodeCamp',       url: 'https://www.freecodecamp.org/',  icon: '🎓' },
        { label: 'Frontend Mentor',    url: 'https://www.frontendmentor.io/', icon: '💪' },
      ],
      backend_development: [
        { label: 'Node.js Docs',      url: 'https://nodejs.org/docs/',        icon: '📖' },
        { label: 'Express.js Guide',  url: 'https://expressjs.com/',          icon: '🚂' },
        { label: 'PostgreSQL',        url: 'https://www.postgresql.org/docs/',icon: '🐘' },
        { label: 'REST API Tutorial', url: 'https://restfulapi.net/',          icon: '🔌' },
      ],
      machine_learning: [
        { label: 'Fast.ai',        url: 'https://www.fast.ai/',               icon: '🤖' },
        { label: 'Kaggle Learn',   url: 'https://www.kaggle.com/learn',       icon: '📊' },
        { label: 'Hugging Face',   url: 'https://huggingface.co/learn',       icon: '🤗' },
        { label: 'Papers w/ Code', url: 'https://paperswithcode.com/',        icon: '📄' },
      ],
    };
    return m[domain] || [
      { label: 'Google Scholar', url: 'https://scholar.google.com/',    icon: '🔍' },
      { label: 'YouTube',        url: 'https://www.youtube.com/',        icon: '📺' },
      { label: 'Coursera',       url: 'https://www.coursera.org/',       icon: '🎓' },
      { label: 'Khan Academy',   url: 'https://www.khanacademy.org/',    icon: '📚' },
    ];
  };

  const resources = getDomainResources(goal?.domain);
  const projects = (goal?.skills || []).slice(0, 4).map((s, i) => ({
    title: `${['Beginner', 'Intermediate', 'Advanced', 'Portfolio'][i] || 'Project'}: ${s.name}`,
    desc: `Build a project applying your ${s.name} skills.`,
    level: ['🟢', '🟡', '🔴', '🏆'][i] || '🔵',
    skills: [s.name],
    learningOutcomes: [`Master ${s.name} through practical application`, 'Build portfolio-worthy project', 'Gain real-world experience'],
    steps: ['Plan architecture', 'Implement core features', 'Add advanced features', 'Test and refine', 'Deploy'],
    category: ['Beginner', 'Intermediate', 'Advanced', 'Portfolio'][i] || 'Project',
    whyRecommended: `Perfect for your current ${s.name} mastery level (${s.mastery}%).`,
  }));

  return (
    <div className="space-y-5">
      {/* Career info */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Target Role',   value: goal?.profile?.targetRole || goal?.domainLabel || '—' },
          { label: 'Domain',        value: goal?.domainLabel || '—' },
          { label: 'Learner Level', value: profiling?.experience || goal?.profile?.learnerLevel || '—' },
          { label: 'Intensity',     value: goal?.profile?.intensity || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
            <p className="text-sm font-bold text-slate-100 capitalize">{value}</p>
          </div>
        ))}
      </div>

      {/* Skill gap */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
        <h3 className="text-xs font-black text-amber-400 uppercase tracking-widest mb-3">Skill Gap Analysis</h3>
        <p className="text-sm text-amber-200/80 mb-4">{gapLevel}</p>
        <div className="space-y-3">
          {(goal?.skills || []).map(s => (
            <div key={s.id} className="flex items-center gap-3">
              <span className="text-sm text-slate-400 w-32 truncate flex-shrink-0 font-medium">{s.name}</span>
              <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(s.mastery, 2)}%`, backgroundColor: s.mastery >= 75 ? '#10b981' : s.mastery >= 50 ? '#6366f1' : '#f59e0b' }} />
              </div>
              <span className="w-10 text-right font-mono font-bold text-slate-300 text-sm">{s.mastery}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
        <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-4">Suggested Projects</h3>
        <div className="space-y-2">
          {projects.map((p, i) => (
            <button key={i} onClick={() => onProjectClick?.(p)}
              className="w-full flex items-center gap-3 rounded-xl bg-slate-800/40 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/70 px-4 py-3 transition-all text-left">
              <span className="text-xl flex-shrink-0">{p.level}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-200">{p.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{p.desc}</p>
              </div>
              <span className="text-slate-600 flex-shrink-0">→</span>
            </button>
          ))}
        </div>
      </div>

      {/* Resources */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Learning Resources</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {resources.map((r, i) => (
            <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 hover:border-slate-600 hover:bg-slate-800/70 px-4 py-3 transition-all group">
              <span className="text-lg">{r.icon}</span>
              <span className="text-sm font-semibold text-slate-300 group-hover:text-white transition-colors flex-1">{r.label}</span>
              <span className="text-slate-600 group-hover:text-slate-400 text-xs">↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [dashboard, setDashboard]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [launching, setLaunching]     = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [activeTab, setActiveTab]     = useState('overview');
  const [agentPopup, setAgentPopup]   = useState(null);

  const [metricModal,  setMetricModal]  = useState({ isOpen: false, metric: null });
  const [projectModal, setProjectModal] = useState({ isOpen: false, project: null });
  const [skillModal,   setSkillModal]   = useState({ isOpen: false, skill: null });
  const [historyModal, setHistoryModal] = useState({ isOpen: false, session: null });

  const navigate = useNavigate();
  const location = useLocation();

  const avgTrend = useMemo(() => {
    const s = dashboard?.sessions || [];
    if (s.length < 4) return null;
    const half = Math.floor(s.length / 2);
    const early = s.slice(0, half).reduce((sum, r) => sum + r.score, 0) / half;
    const late  = s.slice(-half).reduce((sum, r) => sum + r.score, 0) / half;
    return Math.round(late - early);
  }, [dashboard]);

  const getMetricData = (type, value) => ({
    avgScore:    { label: 'Average Score',      value: `${value}%`,                    icon: '📊', description: 'Your average performance across all completed sessions.', calculation: 'Sum of all session scores ÷ Total sessions', importance: 'Shows overall consistency and understanding.', recommendations: value >= 75 ? ['Maintain excellence', 'Try harder topics'] : ['Focus on weaker areas', 'Review concepts'] },
    bestScore:   { label: 'Best Score',         value: `${value}%`,                    icon: '🏆', description: 'Your highest score in any single session.', calculation: 'Maximum score from all sessions', importance: 'Shows your peak potential.', recommendations: ['Try to reach this consistently'] },
    sessions:    { label: 'Sessions Completed', value,                                 icon: '✅', description: 'Total sessions you\'ve completed.', calculation: 'Count of all finished sessions', importance: 'Consistency is key to learning.', recommendations: ['Keep a regular schedule'] },
    adaptations: { label: 'AI Adaptations',     value,                                 icon: '⚡', description: 'Times the AI adapted your learning plan.', calculation: 'Count of dynamic plan adjustments', importance: 'More adaptations = more personalisation.', recommendations: ['Trust the adaptive system'] },
    trend:       { label: 'Performance Trend',  value: `${value > 0 ? '+' : ''}${value}%`, icon: value >= 0 ? '📈' : '📉', description: 'Improvement comparing recent to early sessions.', calculation: 'Recent average − Early average', importance: 'Shows if you\'re improving over time.', recommendations: value >= 0 ? ['Keep it up!'] : ['Review recent topics'] },
  }[type]);

  useEffect(() => {
    const userId = localStorage.getItem('skillforge:userId');
    if (!userId) { navigate('/'); return; }

    // Always fetch fresh data when Dashboard mounts or location changes
    setLoading(true);
    api.getDashboard(userId)
      .then(d => { setDashboard(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [navigate, location]); // Refresh when location changes (e.g., returning from session)

  const handleLaunch = () => {
    if (!todaysMission) return;
    setLaunching(true);
    setTimeout(() => { setLaunching(false); navigate(`/session/${todaysMission.day}`); }, 600);
  };

  const handleReport = async () => {
    setGenerating(true);
    try {
      const userId = localStorage.getItem('skillforge:userId');
      await api.generateReport(userId);
      navigate('/report');
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <AgentThinking isVisible messages={['Loading dashboard…', 'Fetching your progress…', 'Syncing agent state…']} />
    </div>
  );
  if (error)     return <div className="p-8 text-red-400 text-center text-sm">{error}</div>;
  if (!dashboard) return null;

  const { goal, learningPlan, sessions, stats, adaptations, diagnosticScores, agentDecisions = [] } = dashboard;
  const completed     = learningPlan.filter(d => d.completed).length;
  const total         = learningPlan.length;
  const completionPct = total ? Math.round((completed / total) * 100) : 0;
  const todaysMission = learningPlan.find(d => !d.completed);

  return (
    <div className="min-h-screen px-4 py-6 max-w-5xl mx-auto space-y-5">

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <MetricModal   isOpen={metricModal.isOpen}  onClose={() => setMetricModal({ isOpen: false, metric: null })}   metric={metricModal.metric} />
      <ProjectModal  isOpen={projectModal.isOpen} onClose={() => setProjectModal({ isOpen: false, project: null })} project={projectModal.project} />
      <SkillDetailModal  isOpen={skillModal.isOpen}   onClose={() => setSkillModal({ isOpen: false, skill: null })}    skill={skillModal.skill} />
      <HistoryDetailModal isOpen={historyModal.isOpen} onClose={() => setHistoryModal({ isOpen: false, session: null })} session={historyModal.session} />

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 p-6">
        {/* Goal + progress */}
        <div className="flex items-start gap-4 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-3xl flex-shrink-0">
            {goal.domainIcon || '🎯'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-1">Active Goal</p>
            <h1 className="text-xl font-black text-white leading-tight">{goal.goalText}</h1>
            <p className="text-sm font-semibold text-indigo-300/80 mt-1">{goal.domainLabel}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-3xl font-black text-white font-mono">{completionPct}%</p>
            <p className="text-xs text-slate-500 mt-0.5">{completed}/{total} days</p>
          </div>
        </div>

        <ProgressBar value={completionPct} color="#6366f1" />

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
          <StatCard label="Avg Score"   value={`${stats.avgScore ?? 0}%`}   icon="📊" color={(stats.avgScore ?? 0)  >= 75 ? '#10b981' : (stats.avgScore ?? 0)  >= 50 ? '#6366f1' : '#f59e0b'} onClick={() => setMetricModal({ isOpen: true, metric: getMetricData('avgScore', stats.avgScore ?? 0) })} />
          <StatCard label="Best Score"  value={`${stats.bestScore ?? 0}%`}  icon="🏆" color={(stats.bestScore ?? 0) >= 75 ? '#10b981' : (stats.bestScore ?? 0) >= 50 ? '#6366f1' : '#f59e0b'} onClick={() => setMetricModal({ isOpen: true, metric: getMetricData('bestScore', stats.bestScore ?? 0) })} />
          <StatCard label="Sessions"    value={stats.totalSessions ?? 0}    icon="✅" color="#6366f1" onClick={() => setMetricModal({ isOpen: true, metric: getMetricData('sessions', stats.totalSessions ?? 0) })} />
          <StatCard label="AI Tweaks"   value={adaptations.length}     icon="⚡" color="#f59e0b" sub="adaptations" onClick={() => setMetricModal({ isOpen: true, metric: getMetricData('adaptations', adaptations.length) })} />
          {avgTrend !== null ? (
            <StatCard label="Trend" value={`${avgTrend > 0 ? '+' : ''}${avgTrend}%`} icon={avgTrend >= 0 ? '📈' : '📉'} color={avgTrend >= 0 ? '#10b981' : '#ef4444'} sub="vs early" onClick={() => setMetricModal({ isOpen: true, metric: getMetricData('trend', avgTrend) })} />
          ) : (
            <StatCard label="Trend" value="—" icon="📉" color="#475569" sub="need 4+ sessions" />
          )}
        </div>
      </div>

      {/* ── TODAY'S MISSION ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 px-1">📌 Today's Mission</p>
        <MissionCard
          planDay={todaysMission}
          adaptations={adaptations}
          onLaunch={handleLaunch}
          loading={launching}
        />
      </div>

      {/* ── TABBED SECTION ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/80 overflow-hidden">
        {/* Tab bar */}
        <div className="border-b border-slate-700/60 px-4 pt-4 pb-0">
          <TabBar active={activeTab} onChange={setActiveTab} />
        </div>

        {/* Tab content */}
        <div className="p-5">

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <CareerOverview goal={goal} sessions={sessions} onProjectClick={p => setProjectModal({ isOpen: true, project: p })} />
          )}

          {/* PLAN */}
          {activeTab === 'plan' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-base font-black text-white">Learning Roadmap</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{completed} of {total} sessions completed</p>
                </div>
                <span className="text-sm font-black text-indigo-400 font-mono">{completionPct}%</span>
              </div>
              <PlanTimeline learningPlan={learningPlan} navigate={navigate} />
            </div>
          )}

          {/* SKILLS */}
          {activeTab === 'skills' && (
            <div>
              <h3 className="text-base font-black text-white mb-4">Skill Mastery</h3>
              <SkillBars skills={goal.skills || []} diagnosticScores={diagnosticScores} onSkillClick={s => setSkillModal({ isOpen: true, skill: s })} />
              {sessions.length > 0 && (
                <div className="mt-6 pt-5 border-t border-slate-800">
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Digital Twin</p>
                  <SkillDigitalTwin skills={goal.skills} sessions={sessions} diagnosticScores={diagnosticScores} />
                </div>
              )}
            </div>
          )}

          {/* PERFORMANCE */}
          {activeTab === 'performance' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-black text-white mb-4">Score Trend</h3>
                <ScoreChart sessions={sessions} />
              </div>
              <div className="border-t border-slate-800 pt-5">
                <h3 className="text-base font-black text-white mb-4">Mastery Forecast</h3>
                <PredictiveMasteryForecast sessions={sessions} skills={goal.skills} />
              </div>
            </div>
          )}

          {/* AGENT BRAIN */}
          {activeTab === 'agent' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
                <h3 className="text-base font-black text-white mb-1">7-Agent Pipeline</h3>
                <p className="text-xs text-slate-500 mb-4">Click any agent to see its role and decisions</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { icon: '🎯', name: 'GoalAgent',       color: '#6366F1', role: 'Goal Analysis',      desc: 'Parses your goal text, detects the learning domain, identifies your learner level and intensity, and extracts detected tools or keywords.', trigger: 'Runs first — triggered by goal submission.' },
                    { icon: '🌳', name: 'DecomposeAgent',  color: '#8B5CF6', role: 'Skill Decomposition', desc: 'Breaks your goal into a structured skill tree. Generates 4–7 core skills with subtopics, difficulty levels, and estimated learning days.', trigger: 'Runs after GoalAgent succeeds.' },
                    { icon: '📋', name: 'DiagnosticAgent', color: '#06B6D4', role: 'Diagnostic Quiz',     desc: 'Generates 5 domain-specific MCQ questions to baseline your current proficiency. Uses Gemini for novel domains.', trigger: 'Runs after skill tree is built.' },
                    { icon: '📊', name: 'ScoringAgent',    color: '#0EA5E9', role: 'Diagnostic Scoring',  desc: 'Evaluates your quiz answers using keyword matching. Maps results to skill mastery percentages and determines your starting level.', trigger: 'Runs after diagnostic quiz is submitted.' },
                    { icon: '📅', name: 'CurriculumAgent', color: '#14B8A6', role: 'Plan Builder',        desc: 'Constructs your personalised day-by-day learning plan. Allocates concept, practice, and review sessions. Accounts for diagnostic score.', trigger: 'Runs after scoring to produce the full plan.' },
                    { icon: '✅', name: 'EvaluatorAgent',  color: '#10B981', role: 'Session Evaluator',   desc: 'Grades your quiz responses using Gemini 2.0 Flash. Returns score, grade, strengths, weaknesses, and model solution.', trigger: 'Runs on every session submission.' },
                    { icon: '⚡', name: 'AdaptorAgent',    color: '#F59E0B', role: 'Plan Adaptor',        desc: 'Monitors performance trends. If scores drop it injects review sessions. If they accelerate it may compress the plan.', trigger: 'Runs after each session evaluation.' },
                  ].map((a, i) => (
                    <div key={a.name} className="flex items-center gap-1">
                      <button
                        onClick={() => setAgentPopup(agentPopup?.name === a.name ? null : a)}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 border text-sm font-semibold transition-all"
                        style={{
                          backgroundColor: agentPopup?.name === a.name ? `${a.color}25` : `${a.color}10`,
                          borderColor:     agentPopup?.name === a.name ? `${a.color}60` : `${a.color}25`,
                          color: a.color,
                          boxShadow: agentPopup?.name === a.name ? `0 0 16px ${a.color}30` : 'none',
                        }}
                      >
                        <span>{a.icon}</span>
                        <span className="hidden sm:inline">{a.name}</span>
                      </button>
                      {i < 6 && <span className="text-slate-700 text-xs">→</span>}
                    </div>
                  ))}
                </div>

                {agentPopup && (
                  <div className="mt-4 rounded-xl border p-4 space-y-3 transition-all"
                    style={{ borderColor: `${agentPopup.color}30`, backgroundColor: `${agentPopup.color}08` }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{agentPopup.icon}</span>
                        <div>
                          <p className="text-base font-black" style={{ color: agentPopup.color }}>{agentPopup.name}</p>
                          <p className="text-xs text-slate-500 uppercase tracking-widest">{agentPopup.role}</p>
                        </div>
                      </div>
                      <button onClick={() => setAgentPopup(null)} className="text-slate-600 hover:text-slate-400 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800">✕</button>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{agentPopup.desc}</p>
                    <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-3 py-2.5">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">When it fires</p>
                      <p className="text-sm text-slate-400">{agentPopup.trigger}</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Decision Log</p>
                  <span className="text-xs text-slate-600">{agentDecisions.length} entries</span>
                </div>
                <div className="h-96 overflow-hidden rounded-xl border border-slate-700/50">
                  <AgentBrain decisions={agentDecisions} isThinking={false} />
                </div>
              </div>
            </div>
          )}

          {/* HISTORY */}
          {activeTab === 'history' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-white">Session History</h3>
                <span className="text-xs text-slate-500">{sessions.length} sessions · click for details</span>
              </div>
              <RecentSessions sessions={sessions} onSessionClick={s => setHistoryModal({ isOpen: true, session: s })} />
            </div>
          )}

        </div>
      </div>

      {/* ── FRONTIER MODULES ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/60 p-5">
        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">🔬 Frontier Intelligence</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: '🚀', label: 'Live Demo',      sub: 'Watch 7 agents run',        path: '/demo',        color: '#10B981' },
            { icon: '🧬', label: 'Career Twin',    sub: 'Your digital career model', path: '/career-twin', color: '#6366F1' },
            { icon: '🔮', label: 'Simulator',      sub: 'What-if scenarios',         path: '/simulation',  color: '#8B5CF6' },
            { icon: '🧠', label: 'Explainability', sub: 'Full reasoning chain',      path: '/explain',     color: '#F59E0B' },
          ].map(({ icon, label, sub, path, color }) => (
            <button key={path} onClick={() => navigate(path)}
              className="flex flex-col items-start gap-2 p-4 rounded-xl border border-slate-700/50 hover:border-slate-500 bg-slate-800/30 hover:bg-slate-800/60 transition-all text-left group">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                style={{ background: color + '15', border: `1px solid ${color}30` }}>
                {icon}
              </div>
              <div className="font-bold text-slate-200 text-sm group-hover:text-white transition-colors">{label}</div>
              <div className="text-xs text-slate-500 leading-snug">{sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── GENERATE REPORT ─────────────────────────────────────────────────── */}
      <button
        onClick={handleReport}
        disabled={generating || sessions.length === 0}
        className={`w-full py-4 rounded-2xl font-black text-base transition-all ${
          generating || sessions.length === 0
            ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
            : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white hover:shadow-2xl hover:shadow-emerald-500/20 active:scale-[0.99]'
        }`}
      >
        {generating ? '⏳ Generating Report…'
          : sessions.length === 0 ? '📜 Complete sessions to unlock report'
          : '📜 Generate Competency Report →'}
      </button>

    </div>
  );
}
