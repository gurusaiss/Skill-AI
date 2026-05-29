/**
 * DailyBrief — AI-generated morning brief card
 * Shown at the top of the Overview tab in Dashboard
 */
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Typewriter animation hook
function useTypewriter(text, speed = 28, enabled = true) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!enabled || !text) {
      setDisplayed(text || '');
      setDone(true);
      return;
    }
    setDisplayed('');
    setDone(false);
    let i = 0;
    const tick = () => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i < text.length) {
        timeoutRef.current = setTimeout(tick, speed);
      } else {
        setDone(true);
      }
    };
    timeoutRef.current = setTimeout(tick, speed);
    return () => clearTimeout(timeoutRef.current);
  }, [text, speed, enabled]);

  return { displayed, done };
}

// Skeleton loader
function BriefSkeleton() {
  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-900/20 to-violet-900/20 p-5 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20" />
          <div className="space-y-1.5">
            <div className="h-4 w-36 rounded bg-indigo-500/20" />
            <div className="h-3 w-48 rounded bg-slate-700/40" />
          </div>
        </div>
        <div className="w-7 h-7 rounded-lg bg-slate-700/40" />
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 w-full rounded bg-slate-700/40" />
        <div className="h-3 w-4/5 rounded bg-slate-700/40" />
      </div>
      <div className="flex gap-2">
        <div className="h-7 w-28 rounded-full bg-slate-700/40" />
        <div className="h-7 w-32 rounded-full bg-slate-700/40" />
      </div>
    </div>
  );
}

// Alert chip
function AlertChip({ alert }) {
  const config = {
    warning:     { bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',  icon: '⚠️' },
    review:      { bg: 'bg-orange-500/15 border-orange-500/30 text-orange-300', icon: '📚' },
    achievement: { bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300', icon: '🏆' },
  };
  const c = config[alert.type] || config.warning;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${c.bg}`}
    >
      <span>{c.icon}</span>
      <span>{alert.msg}</span>
    </motion.div>
  );
}

// Action button config
const actionConfig = {
  accelerate: { label: 'Take a Challenge',     color: 'from-emerald-600 to-teal-600',   icon: '⚡' },
  review:     { label: 'Start Review Session', color: 'from-amber-600 to-orange-600',    icon: '📚' },
  resume:     { label: 'Resume Streak Now',    color: 'from-red-600 to-pink-600',        icon: '🔥' },
  continue:   { label: 'Continue Learning',    color: 'from-indigo-600 to-violet-600',   icon: '🚀' },
  start:      { label: 'Start First Session',  color: 'from-indigo-600 to-violet-600',   icon: '🎯' },
};

export default function DailyBrief() {
  const [brief, setBrief]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [animate, setAnimate]     = useState(false);

  const userId = localStorage.getItem('skillforge:userId');

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    // Expand on first visit, collapse on return
    const seen = sessionStorage.getItem('brief:seen');
    setCollapsed(!!seen);

    fetch(`${API_BASE}/api/brief/${userId}`)
      .then(r => r.json())
      .then(data => {
        setBrief(data);
        setLoading(false);
        setAnimate(true);
        sessionStorage.setItem('brief:seen', '1');
      })
      .catch(() => setLoading(false));
  }, [userId]);

  const { displayed: insightText } = useTypewriter(
    brief?.insight || '',
    24,
    animate && !collapsed
  );

  if (!userId || (!loading && !brief)) return null;
  if (loading) return <BriefSkeleton />;

  const action = actionConfig[brief.recommendation?.action] || actionConfig.continue;

  const timeAgo = (() => {
    if (!brief.generatedAt) return 'just now';
    const diff = Date.now() - new Date(brief.generatedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-900/20 to-violet-900/20 overflow-hidden mb-5"
    >
      {/* Header row */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-lg flex-shrink-0">
            🤖
          </div>
          <div className="text-left">
            <p className="text-sm font-black text-white leading-tight">AI Daily Brief</p>
            <p className="text-xs text-indigo-400/70 mt-0.5">Generated by AutonomousAgent • {timeAgo}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Quick stats */}
          {brief.streak > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full">
              🔥 {brief.streak}-day streak
            </span>
          )}
          {brief.avgScore > 0 && (
            <span className="hidden sm:flex items-center gap-1 text-xs font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full">
              📊 {brief.avgScore}% avg
            </span>
          )}
          <span className={`text-slate-400 transition-transform duration-200 text-xs ${collapsed ? '' : 'rotate-180'}`}>
            ▼
          </span>
        </div>
      </button>

      {/* Expandable body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 border-t border-indigo-500/15">

              {/* AI Insight — typewriter */}
              <div className="pt-4">
                <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2">AI Insight</p>
                <p className="text-sm text-slate-200 leading-relaxed min-h-[2.5rem]">
                  {insightText}
                  {insightText && insightText.length < (brief.insight || '').length && (
                    <span className="inline-block w-0.5 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />
                  )}
                </p>
              </div>

              {/* Alerts */}
              {brief.alerts?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {brief.alerts.map((a, i) => <AlertChip key={i} alert={a} />)}
                </div>
              )}

              {/* Today's Mission */}
              {brief.nextDay && (
                <div className="rounded-xl border border-violet-500/25 bg-violet-500/8 p-4">
                  <p className="text-xs font-black text-violet-400 uppercase tracking-widest mb-2">Today's Mission</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center font-black text-violet-300 text-sm flex-shrink-0">
                      {brief.nextDay.day}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{brief.nextDay.skillName}</p>
                      {brief.nextDay.topic && (
                        <p className="text-xs text-violet-300/70 truncate mt-0.5">{brief.nextDay.topic}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Recommendation + CTA */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 leading-relaxed">{brief.recommendation?.msg}</p>
                </div>
                <button
                  className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r ${action.color} text-white text-sm font-black hover:opacity-90 hover:shadow-lg transition-all active:scale-95`}
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
