import React from 'react';

/**
 * MetricModal - Explains dashboard metrics in detail
 * Shows what the metric means, how it's calculated, and why it matters
 */
export default function MetricModal({ isOpen, onClose, metric }) {
  if (!isOpen || !metric) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header with gradient */}
        <div className="relative p-6 pb-4 bg-gradient-to-br from-indigo-600/20 to-purple-600/20 border-b border-slate-700/50">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all flex items-center justify-center"
          >
            ✕
          </button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-2xl shadow-lg">
              {metric.icon}
            </div>
            <div>
              <h2 className="text-xl font-black text-white">{metric.label}</h2>
              <p className="text-sm text-indigo-300 font-semibold">{metric.value}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* What it means */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              What This Means
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {metric.description}
            </p>
          </div>

          {/* How it's calculated */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              How It's Calculated
            </h3>
            <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
              <p className="text-sm text-slate-300 leading-relaxed font-mono">
                {metric.calculation}
              </p>
            </div>
          </div>

          {/* Why it matters */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Why It Matters
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {metric.importance}
            </p>
          </div>

          {/* Recommendations */}
          {metric.recommendations && metric.recommendations.length > 0 && (
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                Recommendations
              </h3>
              <ul className="space-y-2">
                {metric.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-indigo-400 flex-shrink-0">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/30 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm transition-all hover:shadow-lg hover:shadow-indigo-500/20"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}
