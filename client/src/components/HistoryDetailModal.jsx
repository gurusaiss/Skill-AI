import React, { useState } from 'react';

/**
 * HistoryDetailModal - Deep view of a completed session
 * Shows topics covered, quiz score, progress made, knowledge gained, notes summary
 */
export default function HistoryDetailModal({ isOpen, onClose, session }) {
  const [activeSection, setActiveSection] = useState('overview');

  if (!isOpen || !session) return null;

  const gradeConfig = {
    'A+': { color: '#10b981', label: 'Excellent', icon: '🏆', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
    'A':  { color: '#10b981', label: 'Great',     icon: '⭐', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
    'B+': { color: '#6366f1', label: 'Good',      icon: '👍', bg: 'bg-indigo-500/15',  border: 'border-indigo-500/30' },
    'B':  { color: '#6366f1', label: 'Solid',     icon: '✓',  bg: 'bg-indigo-500/15',  border: 'border-indigo-500/30' },
    'C+': { color: '#f59e0b', label: 'Fair',      icon: '📝', bg: 'bg-amber-500/15',   border: 'border-amber-500/30' },
    'C':  { color: '#f59e0b', label: 'Needs Work',icon: '📚', bg: 'bg-amber-500/15',   border: 'border-amber-500/30' },
    'D':  { color: '#ef4444', label: 'Struggling',icon: '⚠️', bg: 'bg-red-500/15',     border: 'border-red-500/30' },
    'F':  { color: '#ef4444', label: 'Keep Going',icon: '🔄', bg: 'bg-red-500/15',     border: 'border-red-500/30' },
  };
  const gradeInfo = gradeConfig[session.grade] || gradeConfig['B'];

  // Derive knowledge gained from score
  const knowledgeGained = session.score >= 90
    ? 'Deep understanding achieved — ready for advanced topics'
    : session.score >= 75
    ? 'Strong grasp of fundamentals — solid foundation built'
    : session.score >= 60
    ? 'Core concepts understood — some areas need reinforcement'
    : session.score >= 45
    ? 'Basic exposure — review recommended before next session'
    : 'Initial exposure — focused review will strengthen this';

  // Derived progress impact
  const masteryImpact = session.score >= 75 ? `+${Math.round(session.score / 10)}%` : `+${Math.max(1, Math.round(session.score / 15))}%`;

  const sections = ['overview', 'concepts', 'performance', 'knowledge', 'next'];
  const sectionLabels = { overview: '📊 Overview', concepts: '📚 Concepts', performance: '💪 Performance', knowledge: '🧠 Knowledge', next: '🚀 Next Steps' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl my-8">

        {/* Header */}
        <div className="relative p-6 pb-4 bg-gradient-to-br from-indigo-600/15 to-purple-600/15 border-b border-slate-700/50">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all flex items-center justify-center text-sm"
          >
            ✕
          </button>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-2xl shadow-lg flex-shrink-0">
              📝
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Day {session.day} · Session Complete</p>
              <h2 className="text-xl font-black text-white leading-tight mt-0.5">{session.skillName}</h2>
              {(session.topic || session.objective) && (
                <p className="text-sm text-indigo-300/80 font-medium mt-0.5">{session.topic || session.objective}</p>
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${gradeInfo.bg} ${gradeInfo.border}`}
                  style={{ color: gradeInfo.color }}
                >
                  {gradeInfo.icon} Grade {session.grade}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800/60 text-slate-300 border border-slate-700">
                  {session.score}% Score
                </span>
                {session.quizScore != null && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                    Quiz: {session.quizScore}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Section nav */}
        <div className="px-4 pt-3 pb-0 flex gap-1.5 overflow-x-auto border-b border-slate-800">
          {sections.map(sec => (
            <button
              key={sec}
              onClick={() => setActiveSection(sec)}
              className={`px-3 py-2 rounded-t-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeSection === sec
                  ? 'bg-slate-800 text-white border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {sectionLabels[sec]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[55vh] overflow-y-auto">

          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Final Score',   value: `${session.score}%`,    color: gradeInfo.color },
                  { label: 'Grade',         value: session.grade,          color: gradeInfo.color },
                  { label: 'Time Spent',    value: `${session.timeSpent || session.estimatedMinutes || 30}m`, color: '#94a3b8' },
                  { label: 'Day',           value: `Day ${session.day}`,   color: '#94a3b8' },
                  { label: 'Mastery +',     value: masteryImpact,          color: '#10b981' },
                  { label: 'Quiz Score',    value: session.quizScore != null ? `${session.quizScore}%` : '—', color: '#6366f1' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-4">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-2xl font-black" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Session Progress</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${session.score}%`, backgroundColor: gradeInfo.color }} />
                  </div>
                  <span className="text-sm font-black" style={{ color: gradeInfo.color }}>{session.score}%</span>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">{knowledgeGained}</p>
              </div>
            </div>
          )}

          {/* CONCEPTS COVERED */}
          {activeSection === 'concepts' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-4">
                <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2">Topic Covered</p>
                <p className="text-sm text-slate-200 font-semibold leading-relaxed">
                  {session.topic || session.objective || `Core concepts of ${session.skillName}`}
                </p>
              </div>

              {/* Session type concepts */}
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Session Concepts</p>
                <div className="space-y-2">
                  {(session.sessionConcepts || [
                    { title: `Core Definition`, desc: `Foundational understanding of ${session.skillName} concepts covered in this session.` },
                    { title: `Practical Application`, desc: `How to apply ${session.topic || session.skillName} in real-world scenarios.` },
                    { title: `Common Patterns`, desc: `Patterns and best practices for ${session.skillName} at this level.` },
                    { title: `Key Techniques`, desc: `Specific techniques practised and evaluated in this session.` },
                  ]).map((c, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                      <span className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0">{i + 1}</span>
                      <div>
                        <p className="text-sm font-bold text-slate-200">{c.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{c.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Evaluation criteria */}
              {session.evaluationCriteria?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Evaluation Criteria</p>
                  <div className="flex flex-wrap gap-2">
                    {session.evaluationCriteria.map((c, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PERFORMANCE */}
          {activeSection === 'performance' && (
            <div className="space-y-4">
              {/* Strengths */}
              {session.strengths?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2">✅ Strengths</p>
                  <ul className="space-y-2">
                    {session.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2.5 text-sm text-slate-300">
                        <span className="text-emerald-400 flex-shrink-0 mt-0.5">✓</span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses */}
              {session.weaknesses?.length > 0 && (
                <div>
                  <p className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2">📈 Areas to Improve</p>
                  <ul className="space-y-2">
                    {session.weaknesses.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2.5 text-sm text-slate-300">
                        <span className="text-amber-400 flex-shrink-0 mt-0.5">→</span>
                        <span className="leading-relaxed">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Quiz breakdown if available */}
              {session.quizCorrect != null && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Quiz Performance</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Correct', value: session.quizCorrect, color: '#10b981' },
                      { label: 'Wrong',   value: session.quizWrong,   color: '#ef4444' },
                      { label: 'Score',   value: `${session.quizScore}%`, color: '#6366f1' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center">
                        <div className="text-xl font-black" style={{ color }}>{value}</div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Achievements */}
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Achievements</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: '✅', label: 'Session Completed', achieved: true },
                    { icon: '🎯', label: 'Passed Threshold',  achieved: session.score >= 50 },
                    { icon: '⭐', label: 'High Score',        achieved: session.score >= 75 },
                    { icon: '🏆', label: 'Perfect Score',     achieved: session.score >= 90 },
                  ].map((a, i) => (
                    <div key={i} className={`flex items-center gap-2 rounded-lg border p-3 ${
                      a.achieved ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-slate-800/20 border-slate-700/50 opacity-40'
                    }`}>
                      <span className="text-lg">{a.icon}</span>
                      <span className={`text-sm font-semibold ${a.achieved ? 'text-emerald-300' : 'text-slate-500'}`}>{a.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* KNOWLEDGE GAINED */}
          {activeSection === 'knowledge' && (
            <div className="space-y-4">
              <div className={`rounded-xl border p-4 ${gradeInfo.bg} ${gradeInfo.border}`}>
                <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: gradeInfo.color }}>Knowledge Gained</p>
                <p className="text-sm text-slate-200 leading-relaxed font-medium">{knowledgeGained}</p>
              </div>

              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">What You Learned</p>
                <div className="space-y-2">
                  {(session.learnedConcepts || [
                    `Core principles of ${session.topic || session.skillName}`,
                    `How ${session.topic || session.skillName} applies in real-world practice`,
                    `Common patterns and techniques in ${session.skillName}`,
                    `Error patterns and how to avoid them in ${session.skillName}`,
                  ]).map((item, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl bg-indigo-500/8 border border-indigo-500/20 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-md bg-indigo-600/30 flex items-center justify-center text-[10px] font-black text-indigo-400 flex-shrink-0 mt-0.5">{i + 1}</span>
                      <p className="text-sm text-slate-300 leading-relaxed">{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes summary */}
              {(session.notesSummary || session.feedback) && (
                <div className="rounded-xl border border-purple-500/25 bg-purple-500/8 p-4">
                  <p className="text-xs font-black text-purple-400 uppercase tracking-widest mb-2">Session Notes Summary</p>
                  <p className="text-sm text-slate-300 leading-relaxed">{session.notesSummary || session.feedback}</p>
                </div>
              )}

              {/* Skill mastery impact */}
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Mastery Impact</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-700"
                      style={{ width: `${Math.min(100, session.score)}%` }} />
                  </div>
                  <span className="text-sm font-black text-indigo-400">{masteryImpact}</span>
                </div>
                <p className="text-xs text-slate-600 mt-2">
                  {session.score >= 75
                    ? 'This session significantly boosted your mastery of this skill.'
                    : session.score >= 50
                    ? 'Good progress — keep practising to solidify this area.'
                    : 'Every session builds on the last — review and try again.'}
                </p>
              </div>
            </div>
          )}

          {/* NEXT STEPS */}
          {activeSection === 'next' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Recommended Actions</p>
                <div className="space-y-2">
                  {(session.recommendations || (session.score >= 75 ? [
                    'Move on to the next session — you\'re ready',
                    'Review your journal entry for this session',
                    'Try applying this concept in a personal project',
                    'Explore advanced topics related to this skill',
                  ] : session.score >= 50 ? [
                    'Review the concepts you found difficult',
                    'Re-read the study notes for this topic',
                    'Practice similar problems before the next session',
                    'Focus on the areas flagged in your quiz results',
                  ] : [
                    'Revisit the study material for this topic',
                    'Focus on the basic definitions and examples',
                    'Take the session again after reviewing',
                    'Ask for help or seek additional resources',
                  ])).map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-800/40 border border-slate-700/40 px-3 py-2.5">
                      <span className="w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[10px] font-black text-indigo-400 flex-shrink-0">{i + 1}</span>
                      <p className="text-sm text-slate-300 leading-relaxed">{rec}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resources for weak areas */}
              {session.weaknesses?.length > 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4">
                  <p className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2">Focus Areas for Next Session</p>
                  <div className="flex flex-wrap gap-2">
                    {session.weaknesses.slice(0, 4).map((w, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300">{w.slice(0, 50)}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/30 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm transition-all hover:shadow-lg hover:shadow-indigo-500/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
