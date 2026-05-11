import React, { useState } from 'react';

/**
 * SkillDetailModal - Deep view of a skill
 * Includes: what it is, why it matters, key concepts, learning points,
 * industry relevance, practical applications, and mastery progress
 */
export default function SkillDetailModal({ isOpen, onClose, skill }) {
  const [activeTab, setActiveTab] = useState('overview');

  if (!isOpen || !skill) return null;

  const masteryColor = skill.mastery >= 75 ? '#10b981' : skill.mastery >= 50 ? '#6366f1' : '#f59e0b';
  const masteryLabel = skill.mastery >= 75 ? 'Proficient' : skill.mastery >= 50 ? 'Developing' : skill.mastery >= 25 ? 'Beginner' : 'Not Started';

  const tabs = [
    { id: 'overview',   label: '📖 Overview' },
    { id: 'concepts',   label: '🔑 Concepts' },
    { id: 'industry',   label: '🏭 Industry' },
    { id: 'practice',   label: '⚔️ Practice' },
    { id: 'progress',   label: '📊 Progress' },
  ];

  // Industry relevance data derived from skill name/domain
  const getIndustryData = () => {
    const name = (skill.name || '').toLowerCase();
    const hasKeyword = (...kws) => kws.some(k => name.includes(k));

    if (hasKeyword('react', 'vue', 'angular', 'frontend', 'css', 'html', 'javascript')) {
      return {
        demand: 'Very High',
        avgSalary: '$85,000–$130,000',
        roles: ['Frontend Developer', 'UI Engineer', 'Full-Stack Developer'],
        companies: ['Google', 'Meta', 'Airbnb', 'Stripe', 'Vercel'],
        trend: 'Growing — React/Vue dominate the market with 70%+ adoption.',
      };
    }
    if (hasKeyword('node', 'express', 'backend', 'api', 'database', 'sql', 'mongo')) {
      return {
        demand: 'Very High',
        avgSalary: '$90,000–$140,000',
        roles: ['Backend Engineer', 'API Developer', 'Full-Stack Developer'],
        companies: ['Netflix', 'Uber', 'LinkedIn', 'PayPal'],
        trend: 'Growing — Node.js powers 30%+ of server-side applications worldwide.',
      };
    }
    if (hasKeyword('python', 'machine learning', 'ml', 'data science', 'ai', 'neural')) {
      return {
        demand: 'Extremely High',
        avgSalary: '$100,000–$160,000',
        roles: ['ML Engineer', 'Data Scientist', 'AI Researcher'],
        companies: ['OpenAI', 'DeepMind', 'Anthropic', 'Tesla', 'Google DeepMind'],
        trend: 'Explosive — AI/ML roles grew 75% in 2024; demand far outpaces supply.',
      };
    }
    if (hasKeyword('law', 'legal', 'contract', 'litigation', 'compliance')) {
      return {
        demand: 'High',
        avgSalary: '$70,000–$180,000',
        roles: ['Lawyer', 'Legal Counsel', 'Compliance Officer'],
        companies: ['Law Firms', 'Corporations', 'Government Agencies'],
        trend: 'Stable — growing in tech law, IP, and compliance due to AI regulations.',
      };
    }
    if (hasKeyword('cook', 'chef', 'culinary', 'baking', 'pastry', 'kitchen')) {
      return {
        demand: 'Moderate',
        avgSalary: '$35,000–$85,000',
        roles: ['Chef', 'Sous Chef', 'Pastry Chef', 'Food Consultant'],
        companies: ['Restaurants', 'Hotels', 'Food Brands', 'Catering'],
        trend: 'Steady — premium dining and food content creation are growing sectors.',
      };
    }
    return {
      demand: 'Moderate–High',
      avgSalary: 'Varies by role and experience',
      roles: ['Specialist', 'Consultant', 'Practitioner'],
      companies: ['Industry leaders in this domain'],
      trend: 'Consistent demand — practitioners with proven mastery are always valued.',
    };
  };

  const industry = getIndustryData();
  const demandColor = industry.demand.includes('Extremely') ? '#10b981' : industry.demand.includes('Very') ? '#6366f1' : '#f59e0b';

  const practicalApps = skill.applications || [
    `Apply ${skill.name} in real projects to build a portfolio`,
    `Use ${skill.name} to solve practical problems in your target role`,
    `Combine ${skill.name} with related skills to tackle complex challenges`,
    `Build a project demonstrating ${skill.name} from scratch`,
    `Contribute to open-source or freelance work using ${skill.name}`,
  ];

  const learningPoints = skill.topics || skill.keyConcepts || [
    'Core fundamentals and terminology',
    'Applied techniques and patterns',
    'Best practices and industry standards',
    'Common pitfalls and how to avoid them',
    'Advanced concepts and edge cases',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl my-8">

        {/* Header */}
        <div className="relative p-6 pb-4 bg-gradient-to-br from-indigo-600/15 to-purple-600/15 border-b border-slate-700/50">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all flex items-center justify-center text-sm"
          >
            ✕
          </button>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-2xl shadow-lg flex-shrink-0">
              🌳
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Skill Detail</p>
              <h2 className="text-xl font-black text-white leading-tight mt-0.5">{skill.name}</h2>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold border"
                  style={{ backgroundColor: `${masteryColor}15`, borderColor: `${masteryColor}30`, color: masteryColor }}
                >
                  {masteryLabel}
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800/60 text-slate-300 border border-slate-700">
                  {skill.mastery}% Mastery
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800/60 text-slate-400 border border-slate-700 capitalize">
                  {skill.status || 'active'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab nav */}
        <div className="px-4 pt-3 pb-0 flex gap-1.5 overflow-x-auto border-b border-slate-800">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 rounded-t-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === t.id
                  ? 'bg-slate-800 text-white border-b-2 border-indigo-500'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[55vh] overflow-y-auto">

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">What Is This Skill?</p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {skill.explanation || skill.description || `${skill.name} is a core skill in your learning path that practitioners apply regularly in professional settings. It forms the foundation for more advanced concepts and is essential for achieving your target goal.`}
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4">
                <p className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2">💡 Why It Matters</p>
                <p className="text-sm text-amber-200/80 leading-relaxed">
                  {skill.importance || `Mastering ${skill.name} unlocks the ability to tackle more complex challenges in your domain. Professionals who excel in this area are consistently in demand and are able to deliver higher-quality work with greater confidence and speed.`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Current Mastery', value: `${skill.mastery}%`, color: masteryColor },
                  { label: 'Status', value: skill.status || 'active', color: '#94a3b8' },
                  { label: 'Topics', value: skill.topics?.length || '—', color: '#6366f1' },
                  { label: 'Demand', value: industry.demand, color: demandColor },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-3">
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{label}</p>
                    <p className="text-base font-black capitalize" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KEY CONCEPTS */}
          {activeTab === 'concepts' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Key Concepts & Learning Points</p>
                <div className="space-y-2">
                  {learningPoints.map((concept, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl bg-slate-800/40 border border-slate-700/40 p-3">
                      <span className="w-6 h-6 rounded-md bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-300 font-medium leading-snug">{concept}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2">Mastery Signals</p>
                <p className="text-xs text-slate-400 mb-2">You've mastered {skill.name} when you can:</p>
                <ul className="space-y-1.5">
                  {[
                    `Apply ${skill.name} correctly in unfamiliar scenarios`,
                    `Explain the reasoning behind your approach clearly`,
                    `Identify common mistakes and know how to fix them`,
                    `Teach the fundamentals to someone else`,
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-emerald-300/80">
                      <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* INDUSTRY RELEVANCE */}
          {activeTab === 'industry' && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4" style={{ borderColor: `${demandColor}30`, backgroundColor: `${demandColor}08` }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-black uppercase tracking-widest" style={{ color: demandColor }}>Market Demand</p>
                  <span className="text-sm font-black" style={{ color: demandColor }}>{industry.demand}</span>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">{industry.trend}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Avg. Salary Range</p>
                  <p className="text-sm font-black text-emerald-400">{industry.avgSalary}</p>
                </div>
                <div className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-4">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Demand Level</p>
                  <p className="text-sm font-black" style={{ color: demandColor }}>{industry.demand}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Job Roles That Use This Skill</p>
                <div className="flex flex-wrap gap-2">
                  {industry.roles.map((role, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium">
                      {role}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Companies Hiring</p>
                <div className="flex flex-wrap gap-2">
                  {industry.companies.map((c, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PRACTICAL APPLICATIONS */}
          {activeTab === 'practice' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">How to Apply This Skill</p>
                <ul className="space-y-2">
                  {practicalApps.map((app, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-xl bg-slate-800/40 border border-slate-700/40 px-3 py-3">
                      <span className="w-6 h-6 rounded-md bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-xs font-black text-emerald-400 flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-300 leading-relaxed">{app}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-purple-500/25 bg-purple-500/8 p-4">
                <p className="text-xs font-black text-purple-400 uppercase tracking-widest mb-2">Practice Challenge</p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Build a mini-project that demonstrates {skill.name}. Focus on applying it in a real scenario, not just theoretical exercises. Share it publicly (GitHub, portfolio) to validate your skill.
                </p>
              </div>
            </div>
          )}

          {/* PROGRESS */}
          {activeTab === 'progress' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-slate-300">Current Mastery</p>
                  <span className="text-2xl font-black" style={{ color: masteryColor }}>{skill.mastery}%</span>
                </div>
                <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.max(skill.mastery, 2)}%`, backgroundColor: masteryColor }}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-600 mt-1">
                  <span>0%</span><span>Developing 50%</span><span>Proficient 75%</span><span>Expert 100%</span>
                </div>
              </div>

              <div className="rounded-xl bg-slate-800/40 border border-slate-700/50 p-4">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Mastery Assessment</p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {skill.mastery >= 75
                    ? `🏆 You have strong mastery of ${skill.name}. Focus on applying it in complex, real-world scenarios and consider tackling advanced topics.`
                    : skill.mastery >= 50
                    ? `📈 You're making solid progress on ${skill.name}. Keep practising with the daily sessions — you're on track for proficiency.`
                    : `📚 ${skill.name} needs more practice. Regular daily sessions and hands-on projects will accelerate your growth significantly.`}
                </p>
              </div>

              <div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Learning Path</p>
                <div className="space-y-2">
                  {[
                    { step: 'Learn core definitions and theory', done: skill.mastery > 5 },
                    { step: 'Complete foundational practice sessions', done: skill.mastery >= 25 },
                    { step: 'Apply in guided scenarios', done: skill.mastery >= 50 },
                    { step: 'Achieve proficiency (75%+)', done: skill.mastery >= 75 },
                    { step: 'Expert-level application', done: skill.mastery >= 90 },
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-all ${
                      item.done ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-slate-800/30 border-slate-700/40'
                    }`}>
                      <span className={`text-sm flex-shrink-0 ${item.done ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {item.done ? '✅' : '○'}
                      </span>
                      <span className={`text-sm ${item.done ? 'text-emerald-300' : 'text-slate-500'}`}>{item.step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/30 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm transition-all hover:shadow-lg hover:shadow-indigo-500/20"
          >
            Continue Learning
          </button>
        </div>
      </div>
    </div>
  );
}
