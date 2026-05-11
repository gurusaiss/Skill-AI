import React, { useState } from 'react';

/**
 * ProjectModal - Shows detailed project intelligence
 * Includes overview, learning outcomes, development steps, and AI prompt generation
 */
export default function ProjectModal({ isOpen, onClose, project }) {
  const [showPrompt, setShowPrompt] = useState(false);

  if (!isOpen || !project) return null;

  const generateAIPrompt = () => {
    return `Build a ${project.title} project that demonstrates mastery of ${project.skills?.join(', ') || 'key skills'}.

Requirements:
${project.requirements?.map((req, i) => `${i + 1}. ${req}`).join('\n') || '- Implement core functionality\n- Follow best practices\n- Include error handling'}

Learning Outcomes:
${project.learningOutcomes?.map((outcome, i) => `${i + 1}. ${outcome}`).join('\n') || '- Practical application of concepts\n- Real-world problem solving'}

Development Steps:
${project.steps?.map((step, i) => `Step ${i + 1}: ${step}`).join('\n') || 'Step 1: Plan architecture\nStep 2: Implement core features\nStep 3: Test and refine'}

Tech Stack: ${project.techStack?.join(', ') || 'Choose appropriate technologies'}

Please provide a detailed implementation guide with code examples.`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 shadow-2xl my-8">
        {/* Header */}
        <div className="relative p-6 pb-4 bg-gradient-to-br from-emerald-600/20 to-teal-600/20 border-b border-slate-700/50">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all flex items-center justify-center"
          >
            ✕
          </button>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center text-2xl shadow-lg flex-shrink-0">
              {project.level || '🚀'}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-white leading-tight">{project.title}</h2>
              <p className="text-sm text-emerald-300 font-semibold mt-1">{project.category || 'Project'}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Overview */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Project Overview
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              {project.desc || project.description || 'A hands-on project to apply your skills in a real-world context.'}
            </p>
          </div>

          {/* Why Recommended */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Why Recommended
            </h3>
            <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/30 p-3">
              <p className="text-sm text-indigo-200 leading-relaxed">
                {project.whyRecommended || 'This project aligns with your current skill level and learning goals, providing practical experience with the concepts you\'ve been studying.'}
              </p>
            </div>
          </div>

          {/* Learning Outcomes */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Learning Outcomes
            </h3>
            <ul className="space-y-2">
              {(project.learningOutcomes || [
                'Apply theoretical concepts in practice',
                'Build problem-solving skills',
                'Gain portfolio-worthy experience'
              ]).map((outcome, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="text-emerald-400 flex-shrink-0">✓</span>
                  <span>{outcome}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Development Steps */}
          <div>
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
              Development Steps
            </h3>
            <div className="space-y-2">
              {(project.steps || [
                'Plan your architecture and data models',
                'Implement core functionality',
                'Add user interface and interactions',
                'Test thoroughly and refine',
                'Deploy and document'
              ]).map((step, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg bg-slate-800/40 border border-slate-700/50 p-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-300 flex-shrink-0">
                    {i + 1}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tech Stack */}
          {project.techStack && project.techStack.length > 0 && (
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                Suggested Tech Stack
              </h3>
              <div className="flex flex-wrap gap-2">
                {project.techStack.map((tech, i) => (
                  <span
                    key={i}
                    className="px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50 text-xs font-semibold text-slate-300"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Live References */}
          {project.references && project.references.length > 0 && (
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                Live Project References
              </h3>
              <div className="space-y-2">
                {project.references.map((ref, i) => (
                  <a
                    key={i}
                    href={ref.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/60 p-3 transition-all group"
                  >
                    <span className="text-lg">{ref.icon || '🔗'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-200 group-hover:text-white truncate">
                        {ref.name}
                      </p>
                      <p className="text-xs text-slate-500">{ref.type || 'Reference'}</p>
                    </div>
                    <span className="text-slate-600 group-hover:text-slate-400">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* AI Prompt Section */}
          {showPrompt && (
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">
                AI Development Prompt
              </h3>
              <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-4">
                <pre className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap font-mono">
                  {generateAIPrompt()}
                </pre>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generateAIPrompt());
                  alert('Prompt copied to clipboard!');
                }}
                className="mt-2 w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-all"
              >
                📋 Copy to Clipboard
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/30 border-t border-slate-700/50 flex gap-3">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-all"
          >
            {showPrompt ? '📝 Hide Prompt' : '✨ Generate Build Prompt'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm transition-all hover:shadow-lg hover:shadow-emerald-500/20"
          >
            Start Building
          </button>
        </div>
      </div>
    </div>
  );
}
