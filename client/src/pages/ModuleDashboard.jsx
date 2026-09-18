/**
 * ModuleDashboard.jsx
 * Inside-module learning environment.
 * Route: /module/:moduleId/learn?assignmentId=xxx
 * Shows Overview, Sessions (day-wise), Progress, Plan, Build tabs.
 */

import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { authFetch } from '../utils/authFetch.js';
import { useAuth } from '../contexts/AuthContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDifficultyColor = (d) => {
  const m = { beginner: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', intermediate: 'text-amber-400 bg-amber-500/10 border-amber-500/30', advanced: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
  return m[(d || '').toLowerCase()] || m.beginner;
};

const SessionStatusIcon = ({ status }) => {
  if (status === 'completed') return <span className="text-emerald-400 text-lg">✓</span>;
  if (status === 'in_progress') return <span className="text-indigo-400 text-lg animate-pulse">▶</span>;
  return <span className="text-slate-600 text-lg">○</span>;
};

// ─── SubViews ─────────────────────────────────────────────────────────────────

function OverviewTab({ module, assignment, sessionStatuses }) {
  const sessions = module?.sessions || module?.content?.sessions || [];
  const completed = sessions.filter((_, i) => sessionStatuses[i] === 'completed').length;
  const pct = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;
  const content = module?.content || {};
  const pathType = content.pathType;
  const dailyMinutes = content.dailyMinutes;
  const totalMinutes = content.estimatedMinutesTotal;
  const expectedOutcomes = content.expectedOutcomes || [];
  const milestones = content.milestones || [];
  const customFields = (content.customFields || []).filter(f => f.label?.trim());

  return (
    <div className="space-y-6">
      {/* Hero card */}
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-600/10 to-purple-600/5 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-black text-white mb-2 leading-tight">{module?.title || 'Module'}</h2>
            <p className="text-slate-300 text-sm leading-relaxed line-clamp-3 mb-4">
              {module?.description || module?.content?.description || 'No description available.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {module?.difficulty && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getDifficultyColor(module.difficulty)}`}>
                  {module.difficulty}
                </span>
              )}
              {module?.duration && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700/40 border border-slate-600/40 text-slate-300">
                  ⏱ {module.duration} hrs
                </span>
              )}
              {sessions.length > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700/40 border border-slate-600/40 text-slate-300">
                  📚 {sessions.length} sessions
                </span>
              )}
              {pathType && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-600/15 border border-teal-500/25 text-teal-300">
                  🧭 {pathType}
                </span>
              )}
              {dailyMinutes && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700/40 border border-slate-600/40 text-slate-300">
                  ⏱ ~{dailyMinutes} min/day{totalMinutes ? ` · ${Math.round(totalMinutes / 60 * 10) / 10}h total` : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="32" fill="none" stroke="#1e293b" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke="#6366f1" strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 32}`}
                  strokeDashoffset={`${2 * Math.PI * 32 * (1 - pct / 100)}`}
                  strokeLinecap="round" className="transition-all duration-700" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-white">{pct}%</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Progress</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Sessions', value: sessions.length, icon: '📚', color: 'indigo' },
          { label: 'Completed', value: completed, icon: '✅', color: 'emerald' },
          { label: 'Remaining', value: sessions.length - completed, icon: '⏳', color: 'amber' },
          { label: 'Progress', value: `${pct}%`, icon: '📊', color: 'purple' },
        ].map(s => {
          const cls = { indigo: 'border-indigo-500/20 bg-indigo-500/5 text-indigo-400', emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400', amber: 'border-amber-500/20 bg-amber-500/5 text-amber-400', purple: 'border-purple-500/20 bg-purple-500/5 text-purple-400' }[s.color];
          return (
            <div key={s.label} className={`rounded-xl border p-4 ${cls}`}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="text-xs font-bold uppercase tracking-widest mt-0.5">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Learning Milestones */}
      {milestones.length > 0 && sessions.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Learning Milestones</h3>
          <div className="flex items-center gap-1">
            {milestones.map((m, i) => {
              const reached = completed >= m.at;
              return (
                <React.Fragment key={i}>
                  {i > 0 && <div className={`flex-1 h-0.5 ${reached ? 'bg-emerald-500/60' : 'bg-slate-700'}`} />}
                  <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 ${reached ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>
                      {reached ? '✓' : m.at}
                    </div>
                    <span className={`text-[10px] font-bold text-center max-w-[80px] leading-tight ${reached ? 'text-emerald-400' : 'text-slate-500'}`}>{m.label}</span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Expected Outcomes */}
      {expectedOutcomes.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3">Expected Outcomes After Completion</h3>
          <ul className="space-y-1.5">
            {expectedOutcomes.map((o, i) => (
              <li key={i} className="text-sm text-slate-200 flex gap-2">
                <span className="text-emerald-400 flex-shrink-0">▸</span>
                <span>{typeof o === 'string' ? o : JSON.stringify(o)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Additional Info (optional, admin-defined) */}
      {customFields.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Additional Info</h3>
          <dl className="space-y-2">
            {customFields.map((f, i) => (
              <div key={f.id || i} className="flex justify-between gap-4 text-sm">
                <dt className="text-slate-400">{f.label}</dt>
                <dd className="text-slate-200 font-medium text-right">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* Skills */}
      {(module?.skills?.length > 0 || module?.content?.skills?.length > 0) && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Skills Covered</h3>
          <div className="flex flex-wrap gap-2">
            {(module.skills || module.content?.skills || []).map((skill, i) => (
              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-600/15 border border-indigo-500/25 text-indigo-300">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionsTab({ module, moduleId, assignmentId, sessionStatuses, assignment, isObserver, onRegenerate }) {
  const navigate = useNavigate();
  const sessions = module?.sessions || module?.content?.sessions || [];

  // Day-lock: one session per calendar day starting from assignment date.
  // assignedAt = Day 1 start. Today = Day (daysSince+1). Only today's session is accessible.
  const assignedAt = assignment?.assignedAt || assignment?.assigned_at || assignment?.createdAt || assignment?.created_at || null;
  const todaySessionIndex = (() => {
    if (!assignedAt) return 0; // fallback: allow day 1 only
    const start = new Date(assignedAt);
    start.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.floor((now - start) / 86400000); // 0-indexed: Day 1 = 0, Day 2 = 1, ...
  })();

  if (sessions.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-30">📚</div>
        <p className="text-lg font-bold text-slate-400 mb-2">No Sessions Yet</p>
        {isObserver ? (
          <p className="text-sm text-slate-600 mb-6">This module has no learning content generated yet — generate it from Module Management.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-6">Click below to generate AI-powered learning sessions for this module.</p>
            <button
              onClick={onRegenerate}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all shadow-lg shadow-indigo-500/25"
            >
              🧠 Generate Learning Content
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-4">
        {sessions.length} Learning Sessions · Click to begin
      </p>
      {sessions.map((session, index) => {
        const status = sessionStatuses[index] || 'locked';
        const isCompleted = status === 'completed';
        const isInProgress = status === 'in_progress';
        // Day-lock: only today's session index is accessible; past = completed/view; future = locked
        const isToday = index === todaySessionIndex;
        const isPast  = index < todaySessionIndex;
        // An admin/manager reviewing this employee's module sees every day
        // unlocked — the drip schedule exists to pace the learner, not to stop
        // a reviewer from inspecting the material.
        const isUnlocked = isObserver || isToday || isPast || isCompleted;
        // Unlock date label for future sessions
        const unlockDateLabel = (() => {
          if (isUnlocked) return null;
          if (!assignedAt) return `Day ${index + 1}`;
          const unlockDay = new Date(assignedAt);
          unlockDay.setDate(unlockDay.getDate() + index);
          return unlockDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        })();

        return (
          <button
            key={index}
            disabled={!isUnlocked}
            onClick={() => {
              if (!isUnlocked) return;
              navigate(`/module/${moduleId}/session/${index}${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
            }}
            className={`w-full text-left rounded-xl border p-4 transition-all group ${
              isCompleted
                ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 cursor-pointer'
                : isToday && !isCompleted
                ? 'border-indigo-500/50 bg-indigo-500/8 hover:bg-indigo-500/12 cursor-pointer ring-1 ring-indigo-500/30'
                : !isUnlocked
                ? 'border-slate-700/40 bg-slate-800/20 opacity-50 cursor-not-allowed'
                : 'border-slate-600/30 bg-slate-800/10 hover:bg-slate-800/20 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black flex-shrink-0 ${
                isCompleted ? 'bg-emerald-500/20 text-emerald-400'
                : isToday ? 'bg-indigo-500/20 text-indigo-400'
                : !isUnlocked ? 'bg-slate-700/40 text-slate-600'
                : 'bg-slate-700/30 text-slate-400'
              }`}>
                {isCompleted ? '✓' : index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold text-white truncate">
                    {session.title || session.topic || `Day ${index + 1}`}
                  </p>
                  {isToday && !isCompleted && (
                    <span className="text-[10px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.5 rounded-full whitespace-nowrap">TODAY</span>
                  )}
                  {isInProgress && (
                    <span className="text-xs font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 rounded-full">In Progress</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate">
                  {session.description || session.objective || (session.topics ? `Topics: ${session.topics.join(', ')}` : 'Click to start learning')}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {session.duration && (
                  <span className="text-xs text-slate-600 hidden sm:block">⏱ {session.duration}</span>
                )}
                {!isUnlocked ? (
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-slate-600">🔒</span>
                    {unlockDateLabel && <span className="text-[10px] text-slate-600 whitespace-nowrap">Unlocks {unlockDateLabel}</span>}
                  </div>
                ) : (
                  <span className={`text-lg group-hover:translate-x-1 transition-transform ${isCompleted ? 'text-emerald-400' : 'text-indigo-400'}`}>
                    {isCompleted ? '↺' : '→'}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProgressTab({ module, assignment, sessionStatuses }) {
  const sessions = module?.sessions || module?.content?.sessions || [];
  const completed = sessions.filter((_, i) => sessionStatuses[i] === 'completed').length;
  const pct = sessions.length > 0 ? Math.round((completed / sessions.length) * 100) : 0;
  // The assignments API normalizes this field to camelCase `progressData`
  // (server/routes/assignments.js) — reading `progress_data` here always
  // returned undefined, so every employee's avg quiz score, per-day score
  // badge, completion date, and strengths/weaknesses silently never
  // rendered, even though ModuleSession.jsx was saving the data correctly.
  const sessionReports = assignment?.progressData?.sessionReports || assignment?.progress_data?.sessionReports || {};

  // Average score across completed sessions that have a report
  const reportValues = Object.values(sessionReports);
  const avgScore = reportValues.length > 0
    ? Math.round(reportValues.reduce((s, r) => s + (r.score || 0), 0) / reportValues.length)
    : null;

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Overall Progress</h3>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex-1 h-4 rounded-full bg-slate-700/60 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xl font-black text-white w-12 text-right">{pct}%</span>
        </div>
        <div className="flex items-center gap-6">
          <p className="text-sm text-slate-400">{completed} of {sessions.length} sessions completed</p>
          {avgScore !== null && (
            <p className="text-sm text-slate-400">
              Avg quiz score: <span className={`font-bold ${avgScore >= 70 ? 'text-emerald-400' : 'text-amber-400'}`}>{avgScore}%</span>
            </p>
          )}
        </div>
      </div>

      {/* Per-session breakdown */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
        <div className="p-4 border-b border-slate-700/40">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Session Breakdown</h3>
        </div>
        <div className="divide-y divide-slate-700/30">
          {sessions.map((session, index) => {
            const status = sessionStatuses[index] || 'pending';
            const report = sessionReports[index];
            const quizScore = report?.score ?? null;
            return (
              <div key={index} className="px-4 py-3">
                <div className="flex items-center gap-4">
                  <SessionStatusIcon status={status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{session.title || `Day ${index + 1}`}</p>
                    {report?.completedAt && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Completed {new Date(report.completedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {quizScore !== null && (
                      <span className={`text-xs font-black px-2 py-0.5 rounded-full border ${
                        quizScore >= 90 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : quizScore >= 70 ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      }`}>
                        {quizScore}%
                      </span>
                    )}
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
                      status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : status === 'in_progress' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                      : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                    }`}>
                      {status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                {/* Strengths / weaknesses summary if available */}
                {report && (report.strengths?.length > 0 || report.weaknesses?.length > 0) && (
                  <div className="mt-2 ml-9 flex gap-4">
                    {report.strengths?.length > 0 && (
                      <p className="text-xs text-emerald-500/70 truncate max-w-[200px]">
                        ✓ Strong: {report.strengths[0]?.slice(0, 50)}…
                      </p>
                    )}
                    {report.weaknesses?.length > 0 && (
                      <p className="text-xs text-rose-500/70 truncate max-w-[200px]">
                        ✗ Review: {report.weaknesses[0]?.slice(0, 50)}…
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlanTab({ module, isObserver, onRegenerate }) {
  const roadmap = module?.roadmap || module?.content?.roadmap || [];
  const plan = module?.plan || module?.content?.plan || module?.learningPlan || '';
  const objectives = module?.content?.objectives || module?.objectives || [];
  const expectedOutcomes = module?.content?.expectedOutcomes || module?.expectedOutcomes || [];
  const pathType = module?.content?.pathType;
  const dailyMinutes = module?.content?.dailyMinutes;
  const assessmentGaps = module?.content?.assessmentGaps || [];

  if (roadmap.length === 0 && !plan && objectives.length === 0 && expectedOutcomes.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-30">🗺️</div>
        <p className="text-lg font-bold text-slate-400 mb-2">No Roadmap Available</p>
        {isObserver ? (
          <p className="text-sm text-slate-600 mb-6">No roadmap has been generated for this module yet.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-6">Generate AI learning content to create a personalized roadmap.</p>
            <button
              onClick={onRegenerate}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all"
            >
              🧠 Generate Roadmap
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(pathType || dailyMinutes || assessmentGaps.length > 0) && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
          <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">This Plan, For You</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {pathType && <span className="text-xs font-bold px-3 py-1 rounded-full bg-indigo-600/20 border border-indigo-500/30 text-indigo-300">{pathType}</span>}
            {dailyMinutes && <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-700/40 border border-slate-600/40 text-slate-300">~{dailyMinutes} min/day</span>}
          </div>
          {assessmentGaps.length > 0 && (
            <p className="text-xs text-slate-400">Built around your assessment: <span className="text-slate-200">{assessmentGaps.join(', ')}</span></p>
          )}
        </div>
      )}

      {objectives.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3">🎯 What This Journey Covers</h3>
          <ul className="space-y-1.5">
            {objectives.map((o, i) => (
              <li key={i} className="text-sm text-slate-200 leading-relaxed flex gap-2"><span className="text-emerald-400 flex-shrink-0">▸</span><span>{typeof o === 'string' ? o : JSON.stringify(o)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {expectedOutcomes.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <h3 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-3">✅ Expected Outcomes</h3>
          <ul className="space-y-1.5">
            {expectedOutcomes.map((o, i) => (
              <li key={i} className="text-sm text-slate-200 leading-relaxed flex gap-2"><span className="text-amber-400 flex-shrink-0">▸</span><span>{typeof o === 'string' ? o : JSON.stringify(o)}</span></li>
            ))}
          </ul>
        </div>
      )}

      {roadmap.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Learning Roadmap</h3>
          </div>
          <div className="p-4 space-y-3">
            {roadmap.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400">
                    {i + 1}
                  </div>
                  {i < roadmap.length - 1 && <div className="w-0.5 flex-1 bg-slate-700/50 mt-1" />}
                </div>
                <div className="pb-4 flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">{typeof step === 'string' ? step : step.title || step.phase || step.step || JSON.stringify(step)}</p>
                  {step.description && <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>}
                  {step.duration && <p className="text-xs text-slate-600 mt-0.5">⏱ {step.duration}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan && typeof plan === 'string' && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 p-5">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Learning Plan</h3>
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{plan}</div>
        </div>
      )}
    </div>
  );
}


// ─── Module Navbar (inside-module) ───────────────────────────────────────────

function ModuleNavbar({ moduleId, assignmentId, activeTab, onTabChange }) {
  const navigate = useNavigate();
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'sessions', label: 'Sessions', icon: '📚' },
    { id: 'progress', label: 'Progress', icon: '📈' },
    { id: 'plan', label: 'Plan', icon: '🗺️' },
  ];

  // Pass moduleId + assignmentId so each tool page can load module context
  const q = new URLSearchParams();
  if (moduleId) q.set('moduleId', moduleId);
  if (assignmentId) q.set('assignmentId', assignmentId);
  const qs = q.toString() ? `?${q.toString()}` : '';

  const toolLinks = [
    { label: 'Report', icon: '📄', path: `/report${qs}` },
  ];

  return (
    <div className="sticky top-[57px] z-20 bg-[#0F172A]/95 backdrop-blur border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex-shrink-0 ${
                activeTab === t.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 pl-4 border-l border-slate-800 flex-shrink-0">
            {toolLinks.map(l => (
              <button
                key={l.label}
                onClick={() => navigate(l.path)}
                title={l.label}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-all whitespace-nowrap"
              >
                <span>{l.icon}</span>
                <span className="hidden sm:block">{l.label}</span>
              </button>
            ))}
            <button
              onClick={() => navigate('/dashboard')}
              className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all whitespace-nowrap"
            >
              ← Exit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ModuleDashboard ─────────────────────────────────────────────────────

export default function ModuleDashboard() {
  const { moduleId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const searchParams = new URLSearchParams(location.search);
  const assignmentId = searchParams.get('assignmentId');

  // Observer mode: an admin/manager opened someone else's assignment to review
  // it. The server already permits this read (canAccessAssignment), but this
  // screen must then never write to that employee's progress or silently
  // trigger content generation on the shared module template.
  const [isObserver, setIsObserver] = useState(false);
  const [observedName, setObservedName] = useState('');

  const [module, setModule] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState('');
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('sessions');
  // sessionStatuses: { [index]: 'pending' | 'in_progress' | 'completed' }
  const [sessionStatuses, setSessionStatuses] = useState({});

  useEffect(() => {
    loadData();
  }, [moduleId, assignmentId]);

  const loadData = async (skipGenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      const [modRes, assignRes] = await Promise.allSettled([
        authFetch(`/api/modules/${moduleId}`),
        assignmentId ? authFetch(`/api/assignments/${assignmentId}`) : Promise.resolve(null),
      ]);

      // ── Assignment (primary source of truth for progress + embedded module) ──
      let assignData = null;
      let observing = false;
      if (assignRes.status === 'fulfilled' && assignRes.value) {
        assignData = assignRes.value;
        setAssignment(assignData);

        const ownerId = assignData.assigned_to_user || assignData.assignedToUser || assignData.employeeId || assignData.userId;
        observing = !!ownerId && !!user?.userId && ownerId !== user.userId;
        setIsObserver(observing);
        setObservedName(assignData.employeeName || assignData.userName || 'this employee');

        // session_progress (Supabase snake_case) OR sessionProgress (camelCase).
        // The dead-code fallback here (progress_data?.sessions, wrong casing
        // AND wrong field name — session status lives under sessionProgress,
        // not inside progressData) is corrected to progressData for
        // consistency with the fix above, though normally shadowed by the
        // first two checks.
        const progress =
          assignData.sessionProgress ||
          assignData.session_progress ||
          assignData.progressData?.sessions ||
          {};
        const initialStatuses = progress[0] !== undefined ? progress : { ...progress, 0: 'pending' };
        setSessionStatuses(initialStatuses);
      } else {
        setSessionStatuses({ 0: 'pending' });
      }

      // ── Module data: try direct fetch first, fall back to assignment embed ──
      let mod = null;
      if (modRes.status === 'fulfilled' && modRes.value && modRes.value.id) {
        mod = modRes.value;
      } else if (assignData?.module?.id) {
        // Assignment GET /:id embeds module — use it as fallback
        mod = assignData.module;
      } else if (assignData?.module_name || assignData?.title) {
        // Bare minimum fallback — at least we have a title
        mod = {
          id: moduleId,
          title: assignData.module_name || assignData.title || 'Your Module',
          sessions: [],
          content: {},
        };
      }

      // Last-resort fallback: fetch from my-assignments list
      if (!mod) {
        try {
          const myAssignments = await authFetch('/api/modules/my-assignments');
          const found = (Array.isArray(myAssignments) ? myAssignments : [])
            .find(a => a.moduleId === moduleId || a.module?.id === moduleId);
          if (found?.module?.id) {
            mod = found.module;
          } else if (found) {
            mod = { id: moduleId, title: found.module?.title || 'Your Module', sessions: [], content: {} };
          }
        } catch { /* non-fatal */ }
      }

      if (!mod) {
        setError('Module not found. Please contact your admin.');
        return;
      }

      setModule(mod);

      // Refresh sessions from the latest module data (admin edits reflected
      // immediately). Never auto-generate while observing — that writes to the
      // shared module template, which must not happen as a side effect of an
      // admin merely opening an employee's module to look at it.
      const sessions = mod.sessions || mod.content?.sessions || [];
      if (sessions.length === 0 && !skipGenerate && !observing) {
        await generateContent(mod);
      }
    } catch (err) {
      setError(err.message || 'Failed to load module');
    } finally {
      setLoading(false);
    }
  };

  const generateContent = async (currentModule) => {
    setGenerating(true);
    setGenerateStatus('🧠 AI is building your learning curriculum…');
    try {
      const messages = [
        '🧠 AI is analyzing the module topics…',
        '📚 Generating day-by-day learning sessions…',
        '🗺️ Creating your personalized roadmap…',
        '✅ Finalizing content and quiz topics…',
      ];
      let msgIdx = 0;
      const msgInterval = setInterval(() => {
        msgIdx = (msgIdx + 1) % messages.length;
        setGenerateStatus(messages[msgIdx]);
      }, 2500);

      const result = await authFetch(`/api/modules/${moduleId}/generate-content`, {
        method: 'POST',
        body: JSON.stringify({
          title: currentModule?.title,
          description: currentModule?.description,
          difficulty: currentModule?.difficulty,
          estimatedDuration: currentModule?.estimatedDuration,
          skills: currentModule?.skills || [],
          category: currentModule?.category,
        }),
      });
      clearInterval(msgInterval);

      if (result) {
        setModule(result);
        setGenerateStatus('✅ Content ready!');
        setTimeout(() => setGenerateStatus(''), 1000);
      }
    } catch (err) {
      console.error('Content generation failed:', err);
      setGenerateStatus('');
    } finally {
      setGenerating(false);
    }
  };

  if (loading || generating) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-3xl">🧠</div>
          </div>
          <p className="text-white font-bold text-base mb-2">
            {generating ? 'Generating Learning Content' : 'Loading Module'}
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">
            {generateStatus || 'Setting up your learning environment…'}
          </p>
          {generating && (
            <div className="mt-4 space-y-1.5">
              {['Analyzing module skills', 'Building day sessions', 'Creating roadmap', 'Preparing quizzes'].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="w-4 h-4 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-xs">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error || !module) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-white mb-2">Module Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <ModuleNavbar
        moduleId={moduleId}
        assignmentId={assignmentId}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Regenerate button — shown when module has no sessions */}
        {isObserver && (
          <div className="mb-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold text-indigo-200">👁 Viewing {observedName}'s module</p>
              <p className="text-xs text-slate-400 mt-0.5">
                This is exactly what they see, with every day unlocked for review. Nothing you do here affects their progress or scores.
              </p>
            </div>
            <button
              onClick={() => navigate(`/admin/modules?edit=${moduleId}`)}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all flex-shrink-0"
            >
              ✎ Edit Module
            </button>
          </div>
        )}

        {(module?.sessions || module?.content?.sessions || []).length === 0 && !generating && !isObserver && (
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-amber-300">No learning content generated yet</p>
              <p className="text-xs text-slate-500 mt-0.5">AI will generate sessions, roadmap, and projects tailored to this module's topics</p>
            </div>
            <button
              onClick={() => generateContent(module)}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-sm transition-all flex-shrink-0"
            >
              🧠 Generate Now
            </button>
          </div>
        )}

        {activeTab === 'overview' && (
          <OverviewTab module={module} assignment={assignment} sessionStatuses={sessionStatuses} />
        )}
        {activeTab === 'sessions' && (
          <SessionsTab
            module={module}
            moduleId={moduleId}
            assignmentId={assignmentId}
            sessionStatuses={sessionStatuses}
            assignment={assignment}
            isObserver={isObserver}
            onRegenerate={() => generateContent(module)}
          />
        )}
        {activeTab === 'progress' && (
          <ProgressTab module={module} assignment={assignment} sessionStatuses={sessionStatuses} />
        )}
        {activeTab === 'plan' && (
          <PlanTab module={module} isObserver={isObserver} onRegenerate={() => generateContent(module)} />
        )}
      </div>
    </div>
  );
}
