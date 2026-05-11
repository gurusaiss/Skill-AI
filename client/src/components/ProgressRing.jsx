import React from 'react';

function ProgressRing({ percentage, size = 120, label = 'Progress' }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#334155" strokeWidth="10" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#6366F1"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="-mt-[86px] text-center">
        <p className="text-3xl font-bold text-white">{percentage}%</p>
        <p className="text-sm text-slate-400">{label}</p>
      </div>
      <div className="h-6" />
    </div>
  );
}

export default ProgressRing;
