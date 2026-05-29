/**
 * PlanEvolution — Shows how the AI has evolved the learning plan over time
 * Displays before/after diffs of agent-driven adaptations
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';

const changeConfig = {
  added:    { border: 'border-emerald-500/30', bg: 'bg-emerald-500/8',  badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400', label: 'Added' },
  modified: { border: 'border-amber-500/30',   bg: 'bg-amber-500/8',    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',       dot: 'bg-amber-400',   label: 'Modified' },
  removed:  { border: 'border-red-500/30',     bg: 'bg-red-500/8',      badge: 'bg-red-500/20 text-red-300 border-red-500/30',             dot: 'bg-red-400',     label: 'Removed' },
};

function detectChangeType(decision) {
  const text = (decision.message || decision.description || decision.reasoning || '').toLowerCase();
  if (text.includes('remov') || text.includes('delet') || text.includes('skip')) return 'removed';
  if (text.includes('add') || text.includes('inject') || text.includes('insert') || text.includes('extra')) return 'added';
  return 'modified';
}

function formatTimestamp(ts) {
  if (!ts) return 'Unknown time';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Unknown time';
  }
}

function AdaptationCard({ decision, index }) {
  const [expanded, setExpanded] = useState(false);
  const changeType = decision.changeType || detectChangeType(decision);
  const cfg = changeConfig[changeType] || changeConfig.modified;

  const title = decision.message || decision.description || decision.summary || 'Plan adjustment';
  const reasoning = decision.reasoning || decision.details || decision.reason || '';
  const daysBefore = decision.daysBefore ?? decision.prevDays ?? null;
  const daysAfter = decision.daysAfter ?? decision.newDays ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
      className={`relative rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        {/* Timeline dot */}
        <div className="flex flex-col items-center flex-shrink-0 mt-1">
          <div className={`w-3 h-3 rounded-full ${cfg.dot} shadow-lg`} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${cfg.badge}`}>
              {cfg.label}
            </span>
            <span className="text-xs text-slate-500">{formatTimestamp(decision.timestamp || decision.createdAt)}</span>
            {decision.agent && (
              <span className="text-xs text-indigo-400/70">by {decision.agent}</span>
            )}
          </div>

          {/* Title */}
          <p className="text-sm font-semibold text-slate-100 leading-snug">{title}</p>

          {/* Before/After */}
          {(daysBefore !== null || daysAfter !== null) && (
            <div className="flex items-center gap-3 mt-2">
              {daysBefore !== null && (
                <span className="text-xs font-mono bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-slate-400">
                  Before: {daysBefore} days
                </span>
              )}
              {daysBefore !== null && daysAfter !== null && (
                <span className="text-slate-600 text-xs">→</span>
              )}
              {daysAfter !== null && (
                <span className="text-xs font-mono bg-slate-800 border border-emerald-500/30 px-2 py-0.5 rounded text-emerald-400">
                  After: {daysAfter} days
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expand toggle */}
        {reasoning && (
          <span className={`text-slate-600 text-xs flex-shrink-0 transition-transform duration-200 mt-1 ${expanded ? 'rotate-180' : ''}`}>▼</span>
        )}
      </button>

      {/* Expanded reasoning */}
      {expanded && reasoning && (
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          className="overflow-hidden"
        >
          <div className="px-4 pb-4 pt-0 border-t border-slate-700/30">
            <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 pt-3">AI Reasoning</p>
            <p className="text-xs text-slate-400 leading-relaxed">{reasoning}</p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

export default function PlanEvolution({ learningPlan = [], agentDecisions = [] }) {
  const adaptations = agentDecisions.filter(d =>
    d.type === 'adaptation' || d.type === 'adapt' ||
    d.agent === 'AdaptorAgent' || d.action === 'adapt'
  );

  const totalDays = learningPlan.length;
  const addedByAgent = learningPlan.filter(d => d.addedByAgent).length;
  const savedDays = Math.max(0, Math.round(addedByAgent * 0.7)); // rough estimate

  return (
    <div className="mt-6 pt-6 border-t border-slate-800">
      {/* Section header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-black text-white">Plan Evolution</h3>
          <p className="text-xs text-slate-500 mt-0.5">How AI adapted your journey over time</p>
        </div>
        {adaptations.length > 0 && (
          <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full">
            {adaptations.length} adaptations
          </span>
        )}
      </div>

      {adaptations.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center"
        >
          <div className="text-3xl mb-3">✅</div>
          <p className="text-sm font-bold text-emerald-300">No adaptations needed yet</p>
          <p className="text-xs text-slate-500 mt-1">Your performance has been consistent — the AI has not needed to adjust your plan.</p>
        </motion.div>
      ) : (
        <>
          {/* Timeline */}
          <div className="relative">
            {/* Connecting line */}
            <div className="absolute left-[1.4rem] top-4 bottom-4 w-px bg-gradient-to-b from-indigo-500/40 via-violet-500/20 to-transparent" />

            <div className="space-y-3">
              {adaptations.map((d, i) => (
                <AdaptationCard key={d.id || i} decision={d} index={i} />
              ))}
            </div>
          </div>

          {/* Bottom stats */}
          <div className="mt-5 rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">AI made</span>
                <span className="font-black text-indigo-300">{adaptations.length} plan adjustments</span>
              </div>
              {addedByAgent > 0 && (
                <>
                  <span className="text-slate-700">•</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Added</span>
                    <span className="font-black text-amber-300">{addedByAgent} sessions</span>
                    <span className="text-slate-500">to reinforce weak areas</span>
                  </div>
                </>
              )}
              {savedDays > 0 && (
                <>
                  <span className="text-slate-700">•</span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Estimated</span>
                    <span className="font-black text-emerald-300">~{savedDays} days saved</span>
                    <span className="text-slate-500">by optimizing path</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
