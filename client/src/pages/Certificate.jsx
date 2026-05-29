import React, { useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function Certificate() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const certRef = useRef(null);

  const skill = params.get('skill') || 'Full-Stack Development';
  const score = parseInt(params.get('score') || '88', 10);
  const days  = parseInt(params.get('days')  || '21', 10);
  const name  = params.get('name')  || 'Valued Learner';

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const sessions = Math.round(days * 1.2);

  const handleDownload = () => {
    window.print();
  };

  const handleShare = () => {
    const msg = `I just completed ${skill} with ${score}% mastery on SkillForge AI! 🎓`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(msg).then(() => {
        alert('Copied to clipboard! Share it anywhere 🎉');
      });
    } else {
      alert(msg);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1e1b4b 50%, #0F172A 100%)' }}
    >
      {/* Action buttons — outside certificate */}
      <div className="flex flex-wrap gap-3 mb-8 justify-center print:hidden">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-all text-sm font-semibold"
        >
          ← Back to Dashboard
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/30 transition-all text-sm font-semibold"
        >
          🔗 Share Achievement
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 transition-all text-sm font-bold shadow-lg shadow-indigo-500/30"
        >
          ⬇ Download PNG
        </button>
      </div>

      {/* ── CERTIFICATE CARD ──────────────────────────────────────── */}
      <div
        ref={certRef}
        className="relative bg-[#F8FAFC] text-slate-900 rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden"
        style={{
          border: '6px double #6366f1',
          boxShadow: '0 0 60px rgba(99,102,241,0.3), 0 25px 50px rgba(0,0,0,0.5)',
        }}
      >
        {/* Decorative corner accents */}
        <div className="absolute top-3 left-3 w-10 h-10 border-t-4 border-l-4 border-indigo-400 rounded-tl-xl opacity-60" />
        <div className="absolute top-3 right-3 w-10 h-10 border-t-4 border-r-4 border-violet-400 rounded-tr-xl opacity-60" />
        <div className="absolute bottom-3 left-3 w-10 h-10 border-b-4 border-l-4 border-indigo-400 rounded-bl-xl opacity-60" />
        <div className="absolute bottom-3 right-3 w-10 h-10 border-b-4 border-r-4 border-violet-400 rounded-br-xl opacity-60" />

        {/* Inner padding */}
        <div className="px-10 py-10 text-center">

          {/* Logo / Brand */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-lg"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
            >
              🧠
            </div>
            <div className="text-left">
              <p
                className="text-xl font-black tracking-widest"
                style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
              >
                SKILL FORGE AI
              </p>
              <p className="text-xs text-slate-500 tracking-widest uppercase font-semibold">Autonomous Career Intelligence</p>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
            <span className="text-indigo-400 text-lg">✦</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-400 to-transparent" />
          </div>

          {/* Certificate heading */}
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500 font-bold mb-2">
            Certificate of Completion
          </p>
          <h1
            className="text-4xl font-black mb-6 leading-tight"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              letterSpacing: '-0.01em',
              color: '#1e293b',
            }}
          >
            Certificate of<br />
            <span
              style={{
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Achievement
            </span>
          </h1>

          {/* Body text */}
          <p className="text-slate-500 text-base mb-2 tracking-wide">This certifies that</p>
          <p
            className="text-3xl font-black mb-2"
            style={{
              fontFamily: 'Georgia, serif',
              background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {name}
          </p>
          <p className="text-slate-500 text-base mb-3 tracking-wide">has successfully completed</p>

          {/* Skill name highlight */}
          <div
            className="inline-block px-8 py-3 rounded-2xl mb-4 shadow-sm"
            style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
              border: '2px solid rgba(99,102,241,0.25)',
            }}
          >
            <p className="text-2xl font-black text-slate-800 tracking-wide">{skill}</p>
          </div>

          {/* Score + Days */}
          <p className="text-slate-600 text-base mb-6">
            with a mastery score of{' '}
            <span className="font-black text-indigo-600">{score}%</span>
            {' '}over{' '}
            <span className="font-black text-violet-600">{days} days</span>
          </p>

          {/* Achievement icons */}
          <div className="flex justify-center gap-6 mb-7">
            {[
              { icon: '🎯', label: 'Goal Achieved' },
              { icon: '⚡', label: `${sessions} Sessions` },
              { icon: '🏆', label: `${score}% Mastery` },
            ].map(({ icon, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
                  style={{
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))',
                    border: '1.5px solid rgba(99,102,241,0.2)',
                  }}
                >
                  {icon}
                </div>
                <p className="text-xs font-bold text-slate-600 tracking-wide">{label}</p>
              </div>
            ))}
          </div>

          {/* Date */}
          <p className="text-slate-500 text-sm mb-6">
            Issued on <span className="font-semibold text-slate-700">{dateStr}</span>
          </p>

          {/* Divider with ✦ */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
            <span className="text-slate-400 text-base">✦</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
          </div>

          {/* Footer */}
          <p className="text-xs text-slate-400 tracking-widest uppercase font-semibold">
            Powered by SkillForge AI • 9 Specialized AI Agents
          </p>

          {/* Seal decoration */}
          <div className="flex justify-end mt-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl shadow-md opacity-80"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: '3px solid rgba(255,255,255,0.5)',
              }}
            >
              🏅
            </div>
          </div>
        </div>
      </div>

      <p className="mt-6 text-slate-600 text-xs print:hidden">
        Click "Download PNG" to save · "Share Achievement" to copy message
      </p>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
