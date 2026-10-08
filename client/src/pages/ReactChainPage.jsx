import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactChainViewer from '../components/ReactChainViewer.jsx';
import { api } from '../utils/api.js';
import PageContainer from '../components/PageContainer.jsx';
import PageHeader from '../components/PageHeader.jsx';

const TOOLS_INFO = [
  {
    name: 'analyze_performance',
    icon: '📊',
    desc: 'Computes average score and trend from recent sessions.',
    color: 'border-violet-700/40 bg-violet-950/30 text-violet-300',
  },
  {
    name: 'check_skill_gaps',
    icon: '🔍',
    desc: 'Identifies skills with mastery below 70% threshold.',
    color: 'border-indigo-700/40 bg-indigo-950/30 text-indigo-300',
  },
  {
    name: 'get_market_demand',
    icon: '📈',
    desc: 'Fetches market demand signals and job listing counts.',
    color: 'border-cyan-700/40 bg-cyan-950/30 text-cyan-300',
  },
  {
    name: 'schedule_review',
    icon: '📅',
    desc: 'Inserts a targeted review session into the learning plan.',
    color: 'border-emerald-700/40 bg-emerald-950/30 text-emerald-300',
  },
  {
    name: 'calculate_mastery',
    icon: '🧮',
    desc: 'Derives mastery level (Novice → Expert) from score history.',
    color: 'border-amber-700/40 bg-amber-950/30 text-amber-300',
  },
];

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
        <div className="absolute inset-0 rounded-full border-t-2 border-indigo-400 animate-spin" />
        <span className="absolute inset-0 flex items-center justify-center text-xl">🧠</span>
      </div>
      <div className="text-slate-300 text-base">Agent is reasoning...</div>
      <div className="flex gap-1.5">
        {['Thinking', 'Calling tools', 'Observing'].map((label, i) => (
          <motion.span
            key={label}
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, delay: i * 0.4, repeat: Infinity }}
            className="text-sm text-slate-300 px-2.5 py-0.5 rounded-full bg-slate-800/60 border border-slate-700/40"
          >
            {label}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

export default function ReactChainPage() {
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeSource, setActiveSource] = useState(null); // 'run' | 'demo'

  const getUserContext = () => {
    try {
      const goal = JSON.parse(localStorage.getItem('sf_goal') || 'null');
      const dashboard = JSON.parse(localStorage.getItem('sf_dashboard') || 'null');
      const sessions = dashboard?.sessions || dashboard?.recentSessions || [];
      const skills = goal?.skills || dashboard?.skills || [];
      const planDay = dashboard?.currentDay || goal?.planDay || 1;
      const goalText = goal?.goalText || goal?.title || 'Become a Software Engineer';
      return { goalText, sessions, skills, planDay };
    } catch {
      return { goalText: 'Become a Software Engineer', sessions: [], skills: [], planDay: 1 };
    }
  };

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    setActiveSource('run');
    try {
      const { goalText, sessions, skills, planDay } = getUserContext();
      const result = await api.runReactChain(goalText, sessions, skills, planDay);
      setChain(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setLoading(true);
    setError(null);
    setActiveSource('demo');
    try {
      const result = await api.getReactDemo();
      setChain(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      <PageContainer>
        <PageHeader
          icon="🧠"
          title="ReAct Agent Chain"
          subtitle="Watch AI reason step by step: thinking, calling tools, observing results and arriving at decisions transparently."
          actions={(
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 text-sm font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              Advanced AI Framework
            </span>
          )}
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
          {/* Main column (2/3) */}
          <div className="xl:col-span-2 min-w-0 space-y-5">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="rounded-2xl border border-indigo-700/30 bg-indigo-950/30 p-4 sm:p-5"
            >
              <h2 className="text-indigo-300 text-lg font-semibold mb-2 flex items-center gap-2">
                <span>ℹ️</span> What is ReAct?
              </h2>
              <p className="text-slate-300 text-base leading-relaxed">
                <strong className="text-slate-100">ReAct (Reason + Act)</strong> is a state-of-the-art AI framework where agents explicitly think through a problem,
                call tools to gather data, observe results, and iterate, making every decision <em>transparent and auditable</em>.
                Unlike black-box AI, every reasoning step is visible. This pattern is used in production AI systems at leading tech companies.
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={handleRun}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-all shadow-lg shadow-indigo-900/40 hover:shadow-indigo-700/40"
                >
                  {loading && activeSource === 'run' ? (
                    <>
                      <span className="animate-spin text-base">⟳</span>
                      Running Analysis...
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      Run ReAct Analysis
                    </>
                  )}
                </button>

                <button
                  onClick={handleDemo}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 font-semibold text-base transition-all border border-slate-700/60 hover:border-slate-600"
                >
                  {loading && activeSource === 'demo' ? (
                    <>
                      <span className="animate-spin text-base">⟳</span>
                      Loading Demo...
                    </>
                  ) : (
                    <>
                      <span>🎬</span>
                      Load Demo
                    </>
                  )}
                </button>
              </div>
            </motion.div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  role="alert"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl bg-red-950/40 border border-red-700/40 px-5 py-4 text-red-300 text-base flex flex-wrap items-center justify-between gap-3"
                >
                  <span><strong>Error:</strong> {error}</span>
                  <button
                    onClick={activeSource === 'demo' ? handleDemo : handleRun}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-sm font-semibold disabled:opacity-50"
                  >
                    Retry
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading */}
            <AnimatePresence>
              {loading && <Spinner />}
            </AnimatePresence>

            {/* Chain Viewer */}
            <AnimatePresence>
              {!loading && chain && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <ReactChainViewer chain={chain} />
                </motion.div>
              )}
            </AnimatePresence>

            {!loading && !chain && !error && (
              <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-800/20 p-8 text-center text-slate-400 text-base">
                No analysis yet. Press <strong className="text-slate-200">Run ReAct Analysis</strong> to reason over your own sessions, or <strong className="text-slate-200">Load Demo</strong> to see a sample chain.
              </div>
            )}
          </div>

          {/* Side column (1/3) */}
          <div className="min-w-0 space-y-5">
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5"
            >
              <h2 className="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <span>🛠️</span> Available Agent Tools
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                {TOOLS_INFO.map((tool, i) => (
                  <motion.div
                    key={tool.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 + i * 0.07 }}
                    className={`rounded-xl border px-4 py-3.5 ${tool.color}`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-lg">{tool.icon}</span>
                      <code className="text-sm font-mono font-semibold break-all">{tool.name}</code>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{tool.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5"
            >
              <h2 className="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <span>🔄</span> How ReAct Works
              </h2>
              <div className="grid grid-cols-2 gap-3 text-center">
                {[
                  { icon: '💭', step: '1. THOUGHT', desc: 'Agent reasons about the problem' },
                  { icon: '⚡', step: '2. ACTION', desc: 'Calls a tool with arguments' },
                  { icon: '👁️', step: '3. OBSERVATION', desc: 'Reads the tool result' },
                  { icon: '✅', step: '4. ANSWER', desc: 'Delivers a concrete decision' },
                ].map(item => (
                  <div key={item.step} className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-900/50">
                    <span className="text-2xl">{item.icon}</span>
                    <span className="text-sm font-bold text-slate-200">{item.step}</span>
                    <span className="text-sm text-slate-400 leading-snug">{item.desc}</span>
                  </div>
                ))}
              </div>
            </motion.section>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
