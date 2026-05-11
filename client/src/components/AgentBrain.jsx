import React, { useEffect, useRef, useState } from 'react';

const AGENT_NAMES = {
  goal_analysis:       { name: 'GoalAgent',       color: '#6366F1', icon: '🎯' },
  skill_tree:          { name: 'DecomposeAgent',   color: '#8B5CF6', icon: '🌳' },
  diagnostic:          { name: 'DiagnosticAgent',  color: '#06B6D4', icon: '📋' },
  diagnostic_complete: { name: 'ScoringAgent',     color: '#0EA5E9', icon: '📊' },
  plan_built:          { name: 'CurriculumAgent',  color: '#14B8A6', icon: '📅' },
  adaptation:          { name: 'AdaptorAgent',     color: '#F59E0B', icon: '⚡' },
  session_complete:    { name: 'EvaluatorAgent',   color: '#10B981', icon: '✅' },
};

function TypewriterText({ text, speed = 18 }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    setDone(false);
    const timer = setInterval(() => {
      if (idx.current < text.length) {
        setDisplayed(text.slice(0, idx.current + 1));
        idx.current++;
      } else {
        setDone(true);
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span>
      {displayed}
      {!done && <span className="inline-block w-0.5 h-3 bg-current ml-0.5 animate-pulse" />}
    </span>
  );
}

function AgentBubble({ decision, index, isLatest }) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENT_NAMES[decision.type] || { name: 'Agent', color: '#6366F1', icon: '🤖' };
  const ts = new Date(decision.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="relative pl-9 mb-3" style={{ animationDelay: `${index * 80}ms` }}>
      {/* Timeline dot */}
      <div
        className="absolute left-2.5 top-4 w-3.5 h-3.5 rounded-full border-2 border-[#080E1A] z-10 flex-shrink-0"
        style={{ backgroundColor: meta.color }}
      />
      {/* Connecting line */}
      {index > 0 && (
        <div className="absolute left-[15px] top-0 w-px h-4"
          style={{ backgroundColor: meta.color, opacity: 0.25 }} />
      )}

      <div
        className="rounded-xl border p-4 cursor-pointer transition-all hover:brightness-110"
        style={{ borderColor: `${meta.color}30`, backgroundColor: `${meta.color}08` }}
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3">
          <span className="text-base flex-shrink-0 mt-0.5">{meta.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-black" style={{ color: meta.color }}>{meta.name}</span>
              <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{ts}</span>
            </div>

            <p className="text-sm text-slate-200 leading-relaxed font-semibold mb-1">
              {decision.title}
            </p>

            <p className="text-xs text-slate-400 leading-relaxed">
              {isLatest
                ? <TypewriterText text={decision.detail} />
                : decision.detail
              }
            </p>

            {expanded && decision.reasoning && (
              <div className="mt-3 pt-3 border-t border-slate-700/40">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Internal Reasoning</p>
                <p className="text-xs text-slate-400 italic leading-relaxed">
                  {isLatest
                    ? <TypewriterText text={`"${decision.reasoning}"`} speed={8} />
                    : `"${decision.reasoning}"`
                  }
                </p>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
                style={{ backgroundColor: `${meta.color}15`, color: meta.color }}
              >
                {decision.type.replace(/_/g, ' ')}
              </span>
              {decision.reasoning && (
                <button className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                  {expanded ? '▲ hide' : '▼ reasoning'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LivePulse() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-widest">Live</span>
    </div>
  );
}

export default function AgentBrain({ decisions = [], isThinking = false, thinkingMessage = '' }) {
  const scrollRef = useRef(null);
  const [activeAgents, setActiveAgents] = useState(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
    const active = new Set(decisions.slice(-3).map(d => d.type));
    setActiveAgents(active);
  }, [decisions]);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-[#080E1A] overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 flex items-center justify-center text-sm">🧠</div>
          <div>
            <p className="text-xs font-black text-slate-200 uppercase tracking-wider">Agent Brain</p>
            <p className="text-[9px] text-slate-500">Multi-Agent Reasoning System</p>
          </div>
        </div>
        <LivePulse />
      </div>

      {/* Decision stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ minHeight: 0, scrollBehavior: 'smooth' }}
      >
        {decisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <div className="text-4xl mb-3 opacity-20">🧠</div>
            <p className="text-sm text-slate-600 font-medium">No agent decisions yet.</p>
            <p className="text-xs text-slate-700 mt-1">Decisions appear here as agents process your goal and sessions.</p>
          </div>
        ) : (
          decisions.map((d, i) => (
            <AgentBubble
              key={d.id ?? i}
              decision={d}
              index={i}
              isLatest={i === decisions.length - 1}
            />
          ))
        )}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="flex items-center gap-2 pl-8 py-2">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                  style={{ animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}
                />
              ))}
            </div>
            <span className="text-xs text-slate-500 italic">
              {thinkingMessage || 'Agent is reasoning...'}
            </span>
          </div>
        )}
      </div>

      {/* Stats footer */}
      <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-semibold">{decisions.length} decisions logged</span>
          <span className="text-xs text-slate-600">{Object.values(AGENT_NAMES).length} agents · Click bubble for reasoning</span>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
