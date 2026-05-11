import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine
} from 'recharts';

function PerformanceChart({ sessions }) {
  const data = sessions.map((session, index) => ({
    session: index + 1,
    day: session.day,
    score: session.score,
    skill: session.skillName
  }));

  return (
    <div className="bg-[#1E293B] rounded-2xl p-6 border border-[#334155] shadow-xl">
      <h3 className="text-lg font-semibold text-white">Performance Trend</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="session" stroke="#94A3B8" />
            <YAxis domain={[0, 100]} stroke="#94A3B8" />
            <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px' }} />
            <ReferenceLine y={75} stroke="#F59E0B" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="score" stroke="#34D399" strokeWidth={3} dot={{ fill: '#34D399' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default PerformanceChart;
