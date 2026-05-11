import React, { useEffect, useState } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine
} from 'recharts';
import { api, scoreColor } from '../utils/api.js';
import AgentThinking from '../components/AgentThinking.jsx';

const DECISION_STYLES = {
  goal_analysis:       'border-indigo-400/40 bg-indigo-50',
  skill_tree:          'border-purple-400/40 bg-purple-50',
  diagnostic:          'border-blue-400/40 bg-blue-50',
  diagnostic_complete: 'border-cyan-400/40 bg-cyan-50',
  plan_built:          'border-teal-400/40 bg-teal-50',
  adaptation:          'border-amber-400/40 bg-amber-50',
  session_complete:    'border-emerald-400/40 bg-emerald-50',
};

function gradeColor(score) {
  if (score >= 90) return '#10b981';
  if (score >= 75) return '#6366f1';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

function Section({ title, icon, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">{icon}</span>
        <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">{title}</h2>
        <div className="flex-1 h-px bg-slate-200 ml-2" />
      </div>
      {children}
    </div>
  );
}

export default function Report() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const userId = localStorage.getItem('skillforge:userId');
    if (!userId) { setError('No session found.'); setLoading(false); return; }
    const load = async () => {
      try {
        setReport(await api.getReport(userId));
      } catch {
        try { setReport(await api.generateReport(userId)); }
        catch (e) { setError(e.message); }
      } finally { setLoading(false); }
    };
    load();
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <AgentThinking isVisible messages={['Compiling competency report…', 'Analysing performance data…', 'Generating insights…']} />
    </div>
  );
  if (error) return <div className="p-8 text-red-400 text-center">{error}</div>;
  if (!report) return null;

  const {
    summary, skills = [], sessions = [], agentDecisions = [],
    narrative, coachSummary, demonstratedSkills = [],
    domain, domainIcon, goalText, generatedAt,
    adaptations = [], diagnosticScores = {}, profile = {},
    capabilityStatement, nextMilestone, aiPowered
  } = report;

  const radarData = skills.map((s) => ({
    subject: s.name.split(' ')[0],
    fullName: s.name,
    mastery: s.mastery,
    target: 75,
  }));

  const trendData = sessions.map((s, i) => ({
    session: i + 1, day: s.day, score: s.score, skill: s.skillName,
  }));

  const masteredCount = skills.filter((s) => s.mastery >= 65).length;

  return (
    <div className="bg-slate-50 min-h-screen print:bg-white">
      <div className="max-w-4xl mx-auto px-6 py-10 print:px-8 print:py-6">

        {/* HEADER */}
        <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-slate-200">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">{domainIcon || '🚀'}</span>
              <div>
                <p className="text-xs font-black text-indigo-600 uppercase tracking-widest">SkillForge AI</p>
                <h1 className="text-2xl font-black text-slate-900">Competency Report</h1>
              </div>
            </div>
            <p className="text-sm text-slate-500 max-w-lg mt-2 italic leading-relaxed">"{goalText}"</p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 font-semibold border border-indigo-200">{domain || 'General'}</span>
              {profile.learnerLevel && (
                <span className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-600 font-semibold border border-slate-200 capitalize">{profile.learnerLevel}</span>
              )}
              <span className="text-xs text-slate-400">
                {new Date(generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
          >
            🖨️ Print / Export
          </button>
        </div>

        {/* EXECUTIVE SUMMARY */}
        <Section title="Executive Summary" icon="📊">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Avg Score',       value: `${summary.avgScore}%`,              color: gradeColor(summary.avgScore) },
              { label: 'Best Score',      value: `${summary.bestScore}%`,             color: gradeColor(summary.bestScore) },
              { label: 'Sessions Done',   value: summary.totalSessions,               color: '#6366f1' },
              { label: 'Skills Mastered', value: `${masteredCount}/${skills.length}`, color: '#10b981' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
                <div className="text-3xl font-black font-mono" style={{ color }}>{value}</div>
                <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wide">{label}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50 p-4">
            {aiPowered && (
              <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-2">
                🤖 AI-Generated Narrative (Gemini 2.0 Flash)
              </p>
            )}
            <p className="text-sm text-slate-700 leading-relaxed">{narrative}</p>
          </div>
          {capabilityStatement && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Capability Statement</p>
              <p className="text-sm text-emerald-800 font-semibold leading-relaxed">{capabilityStatement}</p>
            </div>
          )}
        </Section>

        {/* SKILL ANALYSIS */}
        <Section title="Skill Mastery Analysis" icon="🌳">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Mastery Radar</p>
              {radarData.length >= 3 ? (
                <ResponsiveContainer width="100%" height={230}>
                  <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} tickCount={4} />
                    <Radar name="Target" dataKey="target" stroke="#e2e8f0" fill="#f1f5f9" fillOpacity={0.5} />
                    <Radar name="Mastery" dataKey="mastery" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} />
                    <Tooltip
                      content={({ payload }) => payload?.[1] ? (
                        <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl">
                          <p className="font-bold">{payload[1].payload.fullName}</p>
                          <p>Mastery: <span className="text-indigo-300 font-mono font-bold">{payload[1].value}%</span></p>
                          <p>Target: <span className="text-slate-300">75%</span></p>
                        </div>
                      ) : null}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex items-center justify-center text-slate-400 text-xs text-center">
                  Complete more sessions to populate radar chart
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Skill Breakdown</p>
              <div className="space-y-3">
                {skills.map((skill) => {
                  const diag = diagnosticScores?.[skill.id] ?? null;
                  const barColor = skill.mastery >= 75 ? '#10b981' : skill.mastery >= 50 ? '#6366f1' : skill.mastery > 0 ? '#f59e0b' : '#94a3b8';
                  const statusCls = {
                    demonstrated: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    active: 'bg-indigo-100 text-indigo-700 border-indigo-200',
                    locked: 'bg-slate-100 text-slate-500 border-slate-200',
                  }[skill.status] || 'bg-slate-100 text-slate-500 border-slate-200';
                  return (
                    <div key={skill.id}>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-xs font-semibold text-slate-700 flex-1">{skill.name}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {diag !== null && <span className="text-xs text-slate-400">Diag {diag}%</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusCls}`}>{skill.status}</span>
                          <span className="text-xs font-black font-mono w-9 text-right" style={{ color: barColor }}>{skill.mastery}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(skill.mastery, 2)}%`, backgroundColor: barColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>

        {/* PERFORMANCE TREND */}
        {trendData.length >= 2 && (
          <Section title="Performance Trend" icon="📈">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ top: 5, right: 30, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="session" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Target 75%', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                  <Tooltip
                    content={({ active, payload }) => active && payload?.length ? (
                      <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl">
                        <p className="font-bold">Session {payload[0].payload.session} — Day {payload[0].payload.day}</p>
                        <p className="text-slate-300">{payload[0].payload.skill}</p>
                        <p>Score: <span className="font-mono font-bold" style={{ color: gradeColor(payload[0].value) }}>{payload[0].value}%</span></p>
                      </div>
                    ) : null}
                  />
                  <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}

        {/* LEARNING JOURNEY TABLE */}
        {sessions.length > 0 && (
          <Section title="Learning Journey" icon="🗓️">
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {['Day', 'Skill', 'Score', 'Grade', 'Key Strength', 'Date'].map((h) => (
                      <th key={h} className="text-left p-3 text-slate-500 font-semibold uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${i % 2 ? 'bg-slate-50/40' : 'bg-white'}`}>
                      <td className="p-3 font-mono font-bold text-slate-600">{s.day}</td>
                      <td className="p-3 text-slate-700 font-medium">{s.skillName}</td>
                      <td className="p-3 font-mono font-black" style={{ color: gradeColor(s.score) }}>{s.score}%</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded font-bold" style={{ backgroundColor: `${gradeColor(s.score)}20`, color: gradeColor(s.score) }}>
                          {s.grade}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400 truncate max-w-[160px]">{s.strengths?.[0] || '—'}</td>
                      <td className="p-3 text-slate-400">{new Date(s.completedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* AGENT DECISION LOG */}
        {agentDecisions.length > 0 && (
          <Section title="Agent Decision Log" icon="🧠">
            <div className="space-y-2">
              {agentDecisions.map((d, i) => (
                <div key={i} className={`rounded-lg border p-3 ${DECISION_STYLES[d.type] || 'border-slate-200 bg-white'}`}>
                  <div className="flex items-start gap-2">
                    <span className="text-base flex-shrink-0 mt-0.5">{d.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-xs font-bold text-slate-800">{d.title}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{d.detail}</p>
                      {d.reasoning && (
                        <p className="text-xs text-slate-400 italic mt-1 border-t border-slate-200/60 pt-1">
                          Reasoning: {d.reasoning}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* COMPETENCY BADGES */}
        {demonstratedSkills.length > 0 && (
          <Section title="Demonstrated Competencies" icon="🏆">
            <div className="flex flex-wrap gap-3">
              {demonstratedSkills.map((skill) => (
                <div key={skill} className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200 shadow-sm">
                  <span className="text-emerald-500 font-bold">✓</span>
                  <span className="text-sm font-semibold text-emerald-800">{skill}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* COACH ANALYSIS */}
        <Section title="Coach Analysis & Next Steps" icon="💡">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-700 leading-relaxed mb-4">{coachSummary}</p>
            {nextMilestone && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 mb-4">
                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest mb-1">Next Milestone</p>
                <p className="text-sm text-indigo-800">{nextMilestone}</p>
              </div>
            )}
            {adaptations.length > 0 && (
              <>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Plan Adaptations Made by Agent</p>
                <ul className="space-y-1">
                  {adaptations.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                      <span className="text-amber-500 mt-0.5 flex-shrink-0">⚡</span>
                      <span>{typeof a === 'object' ? (a.note || JSON.stringify(a)) : a}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Section>

        {/* FOOTER */}
        <div className="border-t border-slate-200 pt-6 flex items-center justify-between text-xs text-slate-400">
          <span>Generated by <span className="font-bold text-indigo-600">SkillForge AI</span> — Autonomous Skill Acquisition Agent</span>
          <span>{new Date(generatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
