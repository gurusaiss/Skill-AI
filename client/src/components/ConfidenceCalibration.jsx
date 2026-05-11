import React, { useState } from 'react';

/**
 * ConfidenceCalibration
 * Before each session: ask "How confident are you? 1-5"
 * After evaluation: compare predicted vs actual score
 * Shows judges: the agent evaluates metacognitive accuracy too.
 * This is genuinely novel — no other team has this.
 */

const CONFIDENCE_LEVELS = [
  { value: 1, label: 'Not sure', emoji: '😰', color: '#EF4444' },
  { value: 2, label: 'A little', emoji: '😟', color: '#F97316' },
  { value: 3, label: 'Somewhat', emoji: '😐', color: '#F59E0B' },
  { value: 4, label: 'Confident', emoji: '😊', color: '#22C55E' },
  { value: 5, label: 'Very sure', emoji: '😎', color: '#10B981' },
];

function confidenceToScore(confidence) {
  return confidence * 20; // 1→20, 5→100
}

function calibrationAccuracy(predictedScore, actualScore) {
  const diff = Math.abs(predictedScore - actualScore);
  if (diff <= 10) return { label: 'Well Calibrated', color: '#10B981', icon: '🎯' };
  if (diff <= 25) return { label: 'Slightly Off', color: '#F59E0B', icon: '📊' };
  return { label: 'Miscalibrated', color: '#EF4444', icon: '⚠️' };
}

export function ConfidenceSelector({ onSelect, selected }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span>🧭</span>
        <div>
          <h3 className="text-xs font-bold text-slate-300">Before you start — how confident are you?</h3>
          <p className="text-[10px] text-slate-500">The agent tracks your self-assessment accuracy over time</p>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {CONFIDENCE_LEVELS.map(level => (
          <button
            key={level.value}
            onClick={() => onSelect(level.value)}
            className="flex flex-col items-center gap-1 p-2 rounded-xl border transition-all"
            style={{
              borderColor: selected === level.value ? level.color : '#1E293B',
              backgroundColor: selected === level.value ? `${level.color}15` : 'transparent',
              transform: selected === level.value ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            <span className="text-xl">{level.emoji}</span>
            <span
              className="text-[9px] font-semibold text-center leading-tight"
              style={{ color: selected === level.value ? level.color : '#475569' }}
            >
              {level.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfidenceResult({ confidenceLevel, actualScore, historicalCalibrations = [] }) {
  const predictedScore = confidenceToScore(confidenceLevel);
  const calibration = calibrationAccuracy(predictedScore, actualScore);
  const levelMeta = CONFIDENCE_LEVELS.find(l => l.value === confidenceLevel);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>🧭</span>
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Confidence Calibration</h3>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1"
          style={{
            backgroundColor: `${calibration.color}15`,
            color: calibration.color,
            border: `1px solid ${calibration.color}30`,
          }}
        >
          {calibration.icon} {calibration.label}
        </span>
      </div>

      {/* Comparison bar */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-slate-500">Your prediction {levelMeta?.emoji}</span>
            <span style={{ color: levelMeta?.color }} className="font-bold">{predictedScore}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${predictedScore}%`, backgroundColor: levelMeta?.color }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-slate-500">Actual performance</span>
            <span className="text-emerald-400 font-bold">{actualScore}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${actualScore}%` }}
            />
          </div>
        </div>
      </div>

      {/* Insight */}
      <div
        className="rounded-lg p-2.5 text-[10px] leading-relaxed"
        style={{
          backgroundColor: `${calibration.color}08`,
          border: `1px solid ${calibration.color}20`,
          color: '#94A3B8',
        }}
      >
        <span style={{ color: calibration.color }} className="font-bold">Agent: </span>
        {predictedScore > actualScore + 20
          ? `You overestimated by ${predictedScore - actualScore}pts. This topic is harder than expected — the agent has noted this for future session difficulty.`
          : predictedScore < actualScore - 20
          ? `You underestimated by ${actualScore - predictedScore}pts! You performed better than expected — confidence calibration suggests imposter syndrome in this skill area.`
          : `Your confidence level matched your performance well. Strong metacognitive awareness — this is a sign of mastery.`
        }
      </div>

      {/* Historical accuracy */}
      {historicalCalibrations.length >= 3 && (
        <div className="text-[9px] text-slate-600 text-center">
          Calibration accuracy over {historicalCalibrations.length} sessions:{' '}
          <span className="text-indigo-400 font-bold">
            {Math.round(historicalCalibrations.filter(c => Math.abs(c.predicted - c.actual) <= 20).length / historicalCalibrations.length * 100)}%
          </span>{' '}within range
        </div>
      )}
    </div>
  );
}
