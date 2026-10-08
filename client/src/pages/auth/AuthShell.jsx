import React from 'react';
import { Link } from 'react-router-dom';
import NavIcon from '../../components/NavIcons';

const BENEFITS = [
  { icon: 'learning', title: 'AI-built learning paths', text: 'Personalised plans generated from your role and skill gaps.' },
  { icon: 'reports', title: 'Clear skill ratings', text: 'Expert, Intermediate and Basic ratings with progress you can track.' },
  { icon: 'permissions', title: 'Built for your company', text: 'Assessments, approvals and reports in one secure workspace.' },
];

// Two-panel auth layout: brand/value panel (lg and up) + form panel that fills the
// remaining space. Below lg only the form panel is shown.
export default function AuthShell({ children, width = 'md' }) {
  const formWidth = width === 'lg' ? 'max-w-lg xl:max-w-xl' : 'max-w-md xl:max-w-lg';
  return (
    <div className="min-h-screen w-full bg-[#060B14] lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="hidden lg:flex relative overflow-hidden flex-col justify-between p-10 xl:p-14 2xl:p-20 bg-gradient-to-br from-indigo-950 via-slate-900 to-[#060B14] border-r border-slate-800">
        <div className="absolute -top-24 -left-24 w-[480px] h-[480px] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[360px] h-[360px] rounded-full bg-purple-600/15 blur-[100px] pointer-events-none" />
        <Link to="/" className="relative inline-block" aria-label="SkillForge home">
          <span className="text-3xl xl:text-4xl font-black tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            SKILL FORGE
          </span>
        </Link>
        <div className="relative space-y-8">
          <div>
            <h2 className="text-3xl xl:text-4xl 2xl:text-5xl font-black text-white leading-tight">
              Grow every skill your team needs.
            </h2>
            <p className="mt-4 text-base xl:text-lg text-slate-300">
              Assess, learn and prove progress, all in one place.
            </p>
          </div>
          <ul className="space-y-5">
            {BENEFITS.map(({ icon, title, text }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="shrink-0 w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
                  <NavIcon name={icon} className="w-6 h-6" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold text-white">{title}</span>
                  <span className="block text-sm xl:text-base text-slate-400">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-slate-400">Trusted learning and assessment platform</p>
      </aside>

      {/* Form panel */}
      <main className="relative flex items-center justify-center px-4 sm:px-8 xl:px-12 py-10 min-w-0">
        <div className="fixed inset-0 pointer-events-none lg:hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] max-w-full h-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        </div>
        <div className={`relative w-full ${formWidth}`}>{children}</div>
      </main>
    </div>
  );
}
