import React from 'react';
import { motion } from 'framer-motion';

const STEP_CONFIG = {
  thought: {
    icon: '💭',
    label: 'Reasoning',
    bgClass: 'bg-violet-950/60',
    borderClass: 'border-l-violet-500',
    labelClass: 'text-violet-300',
    badgeClass: 'bg-violet-800/60 text-violet-200',
    textClass: 'text-violet-100 italic',
  },
  action: {
    icon: '⚡',
    label: 'Tool Call',
    bgClass: 'bg-indigo-950/60',
    borderClass: 'border-l-indigo-500',
    labelClass: 'text-indigo-300',
    badgeClass: 'bg-indigo-800/60 text-indigo-200',
    textClass: 'text-indigo-100',
  },
  observation: {
    icon: '👁️',
    label: 'Observation',
    bgClass: 'bg-cyan-950/60',
    borderClass: 'border-l-cyan-500',
    labelClass: 'text-cyan-300',
    badgeClass: 'bg-cyan-800/60 text-cyan-200',
    textClass: 'text-cyan-100',
  },
  answer: {
    icon: '✅',
    label: 'Final Decision',
    bgClass: 'bg-emerald-950/60',
    borderClass: 'border-l-emerald-500',
    labelClass: 'text-emerald-300',
    badgeClass: 'bg-emerald-800/60 text-emerald-200',
    textClass: 'text-emerald-100 font-semibold',
  },
};

function StepCard({ step, index }) {
  const config = STEP_CONFIG[step.type] || STEP_CONFIG.thought;

  // Try to parse JSON observations for prettier display
  let displayContent = step.content;
  if (step.type === 'observation') {
    try {
      const parsed = JSON.parse(step.content);
      displayContent = Object.entries(parsed)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' · ');
    } catch {
      // keep raw
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: index * 0.18, ease: 'easeOut' }}
      className={`relative flex gap-4 rounded-xl border-l-4 px-5 py-4 ${config.bgClass} ${config.borderClass} backdrop-blur-sm`}
    >
      {/* Step number connector line */}
      {index > 0 && (
        <div className="absolute -top-4 left-6 w-px h-4 bg-slate-700" />
      )}

      {/* Icon */}
      <div className="flex-shrink-0 text-xl mt-0.5 select-none">{config.icon}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs font-bold uppercase tracking-wider ${config.labelClass}`}>
            {config.label}
          </span>
          {step.type === 'action' && step.tool && (
            <code
              className={`text-xs px-2 py-0.5 rounded-md font-mono ${config.badgeClass} border border-indigo-700/40`}
            >
              {step.tool}()
            </code>
          )}
          <span className="ml-auto text-xs text-slate-600 font-mono">#{index + 1}</span>
        </div>

        <p className={`text-sm leading-relaxed break-words ${config.textClass}`}>
          {displayContent}
        </p>

        {/* For action steps, show the raw call in a code block */}
        {step.type === 'action' && step.content && (
          <div className="mt-2 rounded-lg bg-slate-900/70 border border-indigo-800/30 px-3 py-2">
            <code className="text-xs text-indigo-300 font-mono break-all">{step.content}</code>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ModelBadge({ model }) {
  const isGemini = model?.includes('gemini');
  const isGroq = model?.includes('groq');
  const isRuleBased = model === 'rule-based';

  const cls = isGemini
    ? 'bg-blue-900/60 text-blue-300 border-blue-700/40'
    : isGroq
    ? 'bg-purple-900/60 text-purple-300 border-purple-700/40'
    : 'bg-slate-800/60 text-slate-400 border-slate-600/40';

  const label = isGemini
    ? '✨ Gemini 2.0 Flash'
    : isGroq
    ? '🦙 Groq LLaMA 3.3'
    : '⚙️ Rule-based';

  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function ReactChainViewer({ chain }) {
  if (!chain) return null;

  const { goal, steps = [], duration, model } = chain;

  const thoughtCount = steps.filter(s => s.type === 'thought').length;
  const actionCount = steps.filter(s => s.type === 'action').length;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="text-xl font-bold text-white">
            🧠 ReAct Chain — Reasoning + Acting
          </h2>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <ModelBadge model={model} />
          {duration != null && (
            <span className="text-xs px-2.5 py-1 rounded-full border bg-slate-800/60 text-slate-400 border-slate-600/40">
              ⏱ {duration}ms
            </span>
          )}
          <span className="text-xs px-2.5 py-1 rounded-full border bg-slate-800/60 text-slate-400 border-slate-600/40">
            💭 {thoughtCount} thoughts · ⚡ {actionCount} tool calls
          </span>
        </div>

        {/* Goal chip */}
        <div className="flex items-start gap-2 rounded-xl bg-slate-800/50 border border-slate-700/50 px-4 py-3">
          <span className="text-slate-500 text-sm font-medium mt-0.5 flex-shrink-0">Goal:</span>
          <span className="text-slate-200 text-sm font-semibold">{goal}</span>
        </div>
      </motion.div>

      {/* Steps timeline */}
      <div className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <StepCard key={i} step={step} index={i} />
        ))}
      </div>

      {/* Footer */}
      {steps.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: steps.length * 0.18 + 0.2 }}
          className="mt-4 text-center text-xs text-slate-600"
        >
          {steps.length} reasoning steps completed
        </motion.div>
      )}
    </div>
  );
}
