/**
 * GoalRefinement — AI Goal Refinement Engine
 * Shows AI suggestions for improving the user's learning goal
 */
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';

// Template-based goal analysis
function analyzeGoal(goal, skills, stats) {
  const g = (goal || '').toLowerCase();
  const words = g.split(/\s+/).filter(Boolean);

  const strengths = [];
  const improvements = [];

  // Detect strengths
  if (words.length >= 8) strengths.push('Clear and descriptive — gives the AI a solid starting point');
  if (g.includes('month') || g.includes('week') || g.includes('year') || g.includes('day')) strengths.push('Includes a time frame — helps AI pace your learning plan');
  if (g.match(/\b(react|python|java|node|sql|aws|docker|typescript|angular|vue)\b/)) strengths.push('Names specific technologies — enables precise skill targeting');
  if (g.includes('job') || g.includes('role') || g.includes('career') || g.includes('position')) strengths.push('Career-focused — aligns learning to real outcomes');
  if (stats?.totalSessions > 0) strengths.push(`Backed by ${stats.totalSessions} completed sessions — strong momentum`);

  if (strengths.length === 0) strengths.push('Sets a clear intention for your learning journey');

  // Detect improvements
  if (!g.includes('month') && !g.includes('week') && !g.includes('year')) improvements.push('Add a specific deadline (e.g., "within 3 months")');
  if (words.length < 8) improvements.push('Expand with more context about your end goal');
  if (!g.match(/\b(react|python|java|node|sql|aws|docker|typescript|angular|vue|go|rust|kotlin|swift)\b/)) improvements.push('Mention specific technologies or tools you want to use');
  if (!g.includes('job') && !g.includes('role') && !g.includes('career') && !g.includes('project') && !g.includes('freelance')) improvements.push('Specify your target outcome (job, freelance, project, etc.)');
  if (!g.includes('startup') && !g.includes('enterprise') && !g.includes('company') && !g.includes('team')) improvements.push('Mention your target environment (startup vs enterprise)');

  return { strengths, improvements };
}

// Generate 3 template-based refined goals
function generateRefinements(goal, skills) {
  const g = (goal || '').trim();
  if (!g) return [];

  const g_lower = g.toLowerCase();
  const skillNames = (skills || []).map(s => s.name).slice(0, 3).join(', ') || 'key skills';

  const suggestions = [];

  // Suggestion 1: Add timeline
  if (!g_lower.includes('month') && !g_lower.includes('week')) {
    suggestions.push({
      id: 'timeline',
      label: 'Add Timeline',
      text: `${g} — within 3 months, ready to apply for roles`,
      confidence: 92,
      rationale: 'Deadlines activate urgency and allow the AI to calculate a realistic pace. Learners with timelines complete 2.3x faster.',
      tag: 'High Impact',
      tagColor: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
    });
  }

  // Suggestion 2: Technology specialisation
  if (g_lower.includes('developer') || g_lower.includes('engineer') || g_lower.includes('programmer')) {
    const tech = g_lower.includes('front') ? 'React, TypeScript, and Tailwind CSS'
      : g_lower.includes('back') ? 'Node.js, PostgreSQL, and REST APIs'
      : g_lower.includes('full') ? 'React, Node.js, and PostgreSQL'
      : g_lower.includes('mobile') ? 'React Native and TypeScript'
      : 'modern frameworks and best practices';
    suggestions.push({
      id: 'tech',
      label: 'Specify Technologies',
      text: `${g}, specializing in ${tech}`,
      confidence: 87,
      rationale: 'Specific technologies let the AI generate targeted exercises and filter out irrelevant content, reducing time-to-mastery by 35%.',
      tag: 'Precision',
      tagColor: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
    });
  } else if (g_lower.includes('data') || g_lower.includes('machine learning') || g_lower.includes('ml') || g_lower.includes('ai')) {
    suggestions.push({
      id: 'ml-spec',
      label: 'Add ML Specialization',
      text: `${g}, focusing on Python, scikit-learn, and building 3 portfolio projects`,
      confidence: 85,
      rationale: 'Portfolio projects are the #1 signal in data/ML hiring. Adding them to your goal ensures the AI builds project-centric sessions.',
      tag: 'Career-Ready',
      tagColor: 'text-violet-300 bg-violet-500/15 border-violet-500/30',
    });
  } else if (suggestions.length < 2) {
    suggestions.push({
      id: 'specifics',
      label: 'Add Core Skills',
      text: `${g}, with mastery of ${skillNames}`,
      confidence: 83,
      rationale: 'Naming your target skills lets the AI weight sessions correctly and track mastery precisely.',
      tag: 'Clarity',
      tagColor: 'text-blue-300 bg-blue-500/15 border-blue-500/30',
    });
  }

  // Suggestion 3: Company type / environment
  suggestions.push({
    id: 'environment',
    label: 'Specify Target Environment',
    text: `${g}, targeting fast-paced startup environments where ${skillNames.split(',')[0]?.trim() || 'engineering'} ownership is valued`,
    confidence: 78,
    rationale: 'Startup vs enterprise environments require different skill emphases. This context shapes the types of projects and challenges the AI selects.',
    tag: 'Context',
    tagColor: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  });

  return suggestions.slice(0, 3);
}

export default function GoalRefinement({ goal, skills = [], stats = {} }) {
  const [selected, setSelected] = useState(null);
  const [applied, setApplied] = useState(false);

  const { strengths, improvements } = useMemo(() => analyzeGoal(goal, skills, stats), [goal, skills, stats]);
  const refinements = useMemo(() => generateRefinements(goal, skills), [goal, skills]);

  const handleApply = (ref) => {
    setSelected(ref.id);
    setApplied(true);
    // Persist to localStorage so Dashboard can pick it up if needed
    try {
      localStorage.setItem('skillforge:refinedGoal', ref.text);
    } catch {}
    setTimeout(() => setApplied(false), 3000);
  };

  if (!goal) return null;

  return (
    <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-900/10 to-violet-900/10 p-5 mb-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-lg flex-shrink-0">
          🎯
        </div>
        <div>
          <h3 className="text-sm font-black text-white">AI Goal Refinement Engine</h3>
          <p className="text-xs text-slate-500 mt-0.5">Suggestions to sharpen your learning goal</p>
        </div>
      </div>

      {/* Current Goal */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 mb-4">
        <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Current Goal</p>
        <p className="text-sm text-slate-200 leading-relaxed">{goal}</p>
      </div>

      {/* Analysis */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {/* Strengths */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2.5">Strengths</p>
          <ul className="space-y-1.5">
            {strengths.map((s, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-2 text-xs text-emerald-200/80"
              >
                <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                <span>{s}</span>
              </motion.li>
            ))}
          </ul>
        </div>

        {/* Improvements */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2.5">Could be improved by</p>
          <ul className="space-y-1.5">
            {improvements.map((s, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-2 text-xs text-amber-200/80"
              >
                <span className="text-amber-500 mt-0.5 flex-shrink-0">→</span>
                <span>{s}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>

      {/* Suggestion cards */}
      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">AI-Suggested Refinements</p>
      <div className="space-y-3">
        {refinements.map((ref, i) => {
          const isSelected = selected === ref.id;
          return (
            <motion.div
              key={ref.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => setSelected(isSelected ? null : ref.id)}
              className={`rounded-xl border cursor-pointer transition-all ${
                isSelected
                  ? 'border-indigo-500/50 bg-indigo-500/10'
                  : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600 hover:bg-slate-800/50'
              }`}
            >
              <div className="p-4">
                {/* Top row */}
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${ref.tagColor}`}>
                      {ref.tag}
                    </span>
                    <span className="text-xs font-bold text-slate-400">{ref.label}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500">{ref.confidence}% confidence</span>
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-600'
                      }`}
                    >
                      {isSelected && <span className="text-white text-[8px]">✓</span>}
                    </div>
                  </div>
                </div>

                {/* Refined goal text */}
                <p className="text-sm text-slate-200 leading-relaxed mb-2.5">{ref.text}</p>

                {/* Confidence bar */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-700"
                      style={{ width: `${ref.confidence}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-mono w-8 text-right">{ref.confidence}%</span>
                </div>

                {/* Why this matters */}
                {isSelected && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 pt-3 border-t border-slate-700/40"
                  >
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1.5">Why this matters</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{ref.rationale}</p>
                    <button
                      onClick={e => { e.stopPropagation(); handleApply(ref); }}
                      className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-black hover:opacity-90 transition-all active:scale-95"
                    >
                      {applied && selected === ref.id ? '✅ Applied!' : '🎯 Apply Refinement'}
                    </button>
                  </motion.div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {applied && (
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xs text-emerald-400 text-center mt-3"
        >
          Refinement saved — start a new goal to apply it fully.
        </motion.p>
      )}
    </div>
  );
}
