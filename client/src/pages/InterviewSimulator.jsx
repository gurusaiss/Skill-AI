import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import AgentThinking from '../components/AgentThinking.jsx';

// ── Grade metadata ────────────────────────────────────────────────────────────
const GRADE_META = {
  A: { label: 'Outstanding', color: '#10B981', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', emoji: '🏆' },
  B: { label: 'Proficient',  color: '#6366F1', bg: 'bg-indigo-500/15',  border: 'border-indigo-500/30',  emoji: '⭐' },
  C: { label: 'Developing',  color: '#F59E0B', bg: 'bg-amber-500/15',   border: 'border-amber-500/30',   emoji: '📈' },
  D: { label: 'Needs Work',  color: '#F97316', bg: 'bg-orange-500/15',  border: 'border-orange-500/30',  emoji: '💪' },
  F: { label: 'Keep Going',  color: '#EF4444', bg: 'bg-red-500/15',     border: 'border-red-500/30',     emoji: '🔄' },
};

// ── Setup Phase ───────────────────────────────────────────────────────────────
function SetupPhase({ onStart }) {
  const [role, setRole] = useState('');
  const [skills, setSkills] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [questionCount, setQuestionCount] = useState(5);

  const handleStart = () => {
    if (!role.trim() || !skills.trim()) return;
    onStart({ role: role.trim(), skills: skills.trim(), difficulty, count: questionCount });
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      {/* Header */}
      <div className="text-center mb-4">
        <div className="text-5xl mb-3">🎤</div>
        <h1 className="text-3xl font-black text-slate-100">Interview Simulator</h1>
        <p className="text-sm text-slate-500 mt-2">AI-powered mock interviews to test your readiness</p>
      </div>

      {/* Setup form */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 space-y-5">
        <div>
          <label className="text-xs font-black text-slate-300 uppercase tracking-wider block mb-2">
            Target Role
          </label>
          <input
            type="text"
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-4 py-3 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
            placeholder="e.g. Frontend Developer, Chef, Fashion Designer, Lawyer"
          />
        </div>

        <div>
          <label className="text-xs font-black text-slate-300 uppercase tracking-wider block mb-2">
            Skills to Test
          </label>
          <input
            type="text"
            value={skills}
            onChange={e => setSkills(e.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-4 py-3 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
            placeholder="e.g. React, JavaScript, CSS, Responsive Design"
          />
          <p className="text-xs text-slate-600 mt-1.5">Separate multiple skills with commas</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-black text-slate-300 uppercase tracking-wider block mb-2">
              Difficulty
            </label>
            <select
              value={difficulty}
              onChange={e => setDifficulty(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-4 py-3 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-black text-slate-300 uppercase tracking-wider block mb-2">
              Questions
            </label>
            <select
              value={questionCount}
              onChange={e => setQuestionCount(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-[#060B14] px-4 py-3 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="3">3 Questions</option>
              <option value="5">5 Questions</option>
              <option value="7">7 Questions</option>
              <option value="10">10 Questions</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={!role.trim() || !skills.trim()}
          className="w-full py-4 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all hover:shadow-xl hover:shadow-indigo-500/20 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          🚀 Start Interview
        </button>
      </div>

      {/* Info cards */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-center">
          <div className="text-2xl mb-1">🤖</div>
          <p className="text-xs font-bold text-indigo-300">AI-Powered</p>
          <p className="text-[10px] text-slate-600 mt-1">Gemini evaluates your answers</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
          <div className="text-2xl mb-1">📊</div>
          <p className="text-xs font-bold text-emerald-300">Real-Time Feedback</p>
          <p className="text-[10px] text-slate-600 mt-1">Instant scoring & suggestions</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
          <div className="text-2xl mb-1">🎯</div>
          <p className="text-xs font-bold text-amber-300">Role-Specific</p>
          <p className="text-[10px] text-slate-600 mt-1">Questions match your target role</p>
        </div>
      </div>
    </div>
  );
}

// ── Interview Phase ───────────────────────────────────────────────────────────
function InterviewPhase({ questions, role, onComplete }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState('');

  const currentQuestion = questions[currentIndex];
  const progress = Math.round(((currentIndex + 1) / questions.length) * 100);

  const handleSubmit = async () => {
    if (answer.trim().length < 10) return;
    
    setEvaluating(true);
    setError('');
    
    try {
      const evaluation = await api.evaluateInterviewAnswer({
        question: currentQuestion,
        answer: answer.trim(),
        role
      });

      // Update question with answer and evaluation
      questions[currentIndex].answer = answer.trim();
      questions[currentIndex].score = evaluation.score;
      questions[currentIndex].feedback = evaluation;
      questions[currentIndex].answeredAt = new Date().toISOString();

      // Move to next question or complete
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setAnswer('');
      } else {
        onComplete(questions);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setEvaluating(false);
    }
  };

  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  if (evaluating) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-14">
        <AgentThinking 
          isVisible 
          messages={[
            'Evaluating your response…',
            'Analyzing key points…',
            'Checking technical accuracy…',
            'Generating feedback…'
          ]} 
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-5">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">
            Question {currentIndex + 1} of {questions.length}
          </p>
          <p className="text-base font-black text-slate-100">{role} Interview</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-600">Progress</p>
          <p className="text-lg font-black text-indigo-400">{progress}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question card */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold capitalize">
            {currentQuestion.type}
          </span>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold capitalize">
            {currentQuestion.difficulty}
          </span>
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
            {currentQuestion.skill}
          </span>
          {currentQuestion.timeLimit && (
            <span className="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              ⏱️ {Math.floor(currentQuestion.timeLimit / 60)}m
            </span>
          )}
        </div>

        <h2 className="text-xl font-black text-slate-100 leading-snug">
          {currentQuestion.question}
        </h2>

        {currentQuestion.expectedPoints && currentQuestion.expectedPoints.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
              💡 Key Points to Cover
            </p>
            <ul className="space-y-1">
              {currentQuestion.expectedPoints.map((point, i) => (
                <li key={i} className="text-xs text-slate-400 flex items-start gap-2">
                  <span className="text-indigo-500 mt-0.5">•</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Answer area */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-black text-slate-300 uppercase tracking-wider">
            Your Answer
          </label>
          <span className={`text-xs font-semibold ${
            wordCount >= 50 ? 'text-emerald-400' : 
            wordCount >= 20 ? 'text-amber-400' : 
            'text-slate-600'
          }`}>
            {wordCount} words {wordCount >= 50 ? '✓' : wordCount >= 20 ? '(aim for 50+)' : '(too short)'}
          </span>
        </div>
        
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          className="w-full min-h-[220px] rounded-xl border border-slate-700 bg-[#060B14] p-4 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none resize-y transition-colors"
          placeholder="Type your answer here. Be specific, provide examples, and explain your reasoning..."
        />

        <div className="flex items-center justify-between">
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="ml-auto flex gap-3">
            {currentIndex > 0 && (
              <button
                onClick={() => {
                  setCurrentIndex(currentIndex - 1);
                  setAnswer(questions[currentIndex - 1].answer || '');
                }}
                className="px-6 py-3 rounded-xl font-bold text-sm border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 transition-all"
              >
                ← Previous
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={wordCount < 10}
              className="px-8 py-3 rounded-xl font-black text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {currentIndex < questions.length - 1 ? 'Next Question →' : 'Finish Interview →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Results Phase ─────────────────────────────────────────────────────────────
function ResultsPhase({ questions, report, role }) {
  const [expandedQuestion, setExpandedQuestion] = useState(null);
  const navigate = useNavigate();

  const gradeMeta = GRADE_META[report.grade] || GRADE_META.F;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-5">
      {/* Overall score */}
      <div className={`rounded-2xl border p-6 text-center ${gradeMeta.bg} ${gradeMeta.border}`}>
        <div className="text-5xl mb-2">{gradeMeta.emoji}</div>
        <div className="text-7xl font-black font-mono mb-1" style={{ color: gradeMeta.color }}>
          {report.overallScore}
        </div>
        <div className="text-sm font-black uppercase tracking-widest" style={{ color: gradeMeta.color }}>
          Grade {report.grade} — {gradeMeta.label}
        </div>
        <p className="text-slate-400 text-sm mt-3 max-w-lg mx-auto leading-relaxed">
          {report.summary}
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs">
          <span className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            {report.answeredQuestions}/{report.totalQuestions} Answered
          </span>
          <span className={`px-3 py-1 rounded-full border font-semibold ${
            report.readiness === 'Ready' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
            report.readiness === 'Almost Ready' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' :
            report.readiness === 'Needs Practice' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
            'bg-red-500/20 text-red-300 border-red-500/30'
          }`}>
            {report.readiness}
          </span>
        </div>
      </div>

      {/* Strengths & Areas to Improve */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
          <h3 className="text-sm font-black text-emerald-400 mb-3 uppercase tracking-wide">
            ✅ Strengths
          </h3>
          <ul className="space-y-2">
            {(report.strengths || []).map((item, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-emerald-500 mt-0.5 flex-shrink-0">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <h3 className="text-sm font-black text-amber-400 mb-3 uppercase tracking-wide">
            📈 Areas to Improve
          </h3>
          <ul className="space-y-2">
            {(report.areasToImprove || []).map((item, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-amber-500 mt-0.5 flex-shrink-0">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Recommendations */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
        <h3 className="text-sm font-black text-indigo-400 mb-3 uppercase tracking-wide">
          💡 Recommendations
        </h3>
        <ul className="space-y-2">
          {(report.recommendations || []).map((item, i) => (
            <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
              <span className="text-indigo-500 mt-0.5 flex-shrink-0">{i + 1}.</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Next Steps */}
      {report.nextSteps && report.nextSteps.length > 0 && (
        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
          <h3 className="text-sm font-black text-purple-400 mb-3 uppercase tracking-wide">
            🎯 Next Steps
          </h3>
          <ul className="space-y-2">
            {report.nextSteps.map((item, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-purple-500 mt-0.5 flex-shrink-0">→</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Question-by-question breakdown */}
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
        <h3 className="text-sm font-black text-slate-300 mb-4 uppercase tracking-wide">
          📝 Question Breakdown
        </h3>
        <div className="space-y-2">
          {questions.filter(q => q.answer).map((q, i) => {
            const isExpanded = expandedQuestion === i;
            const qGrade = q.feedback?.grade || 'F';
            const qMeta = GRADE_META[qGrade] || GRADE_META.F;

            return (
              <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
                <button
                  onClick={() => setExpandedQuestion(isExpanded ? null : i)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-xs font-mono text-slate-600">Q{i + 1}</span>
                    <span className="text-sm text-slate-300 truncate flex-1">{q.question}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-bold ${qMeta.bg} ${qMeta.border}`}
                      style={{ color: qMeta.color }}>
                      {q.score}%
                    </span>
                    <span className="text-slate-600 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isExpanded && q.feedback && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-700/40">
                    <div className="pt-3">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Your Answer
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">{q.answer}</p>
                    </div>

                    <div>
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                        Feedback
                      </p>
                      <p className="text-xs text-slate-300 leading-relaxed">{q.feedback.feedback}</p>
                    </div>

                    {q.feedback.strengths && q.feedback.strengths.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">
                          Strengths
                        </p>
                        <ul className="space-y-1">
                          {q.feedback.strengths.map((s, si) => (
                            <li key={si} className="text-xs text-slate-400 flex items-start gap-2">
                              <span className="text-emerald-500">•</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {q.feedback.weaknesses && q.feedback.weaknesses.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">
                          Weaknesses
                        </p>
                        <ul className="space-y-1">
                          {q.feedback.weaknesses.map((w, wi) => (
                            <li key={wi} className="text-xs text-slate-400 flex items-start gap-2">
                              <span className="text-amber-500">•</span>
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="flex-1 py-3.5 rounded-xl font-black text-sm border border-indigo-700/50 bg-indigo-900/20 text-indigo-300 hover:text-indigo-200 hover:border-indigo-600 transition-all"
        >
          🔄 New Interview
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="flex-1 py-3.5 rounded-xl font-black text-sm border border-slate-700 bg-slate-900/60 text-slate-300 hover:text-white hover:border-slate-500 transition-all"
        >
          ← Dashboard
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function InterviewSimulator() {
  const [phase, setPhase] = useState('setup'); // setup | loading | interview | generating | results
  const [config, setConfig] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const handleStart = async (setupConfig) => {
    setConfig(setupConfig);
    setPhase('loading');
    setError('');

    try {
      const generatedQuestions = await api.generateInterviewQuestions(setupConfig);
      setQuestions(generatedQuestions);
      setPhase('interview');
    } catch (e) {
      setError(e.message);
      setPhase('setup');
    }
  };

  const handleComplete = async (answeredQuestions) => {
    setPhase('generating');
    setError('');

    try {
      const interviewReport = await api.generateInterviewReport({
        questions: answeredQuestions,
        role: config.role
      });
      setReport(interviewReport);
      setPhase('results');
    } catch (e) {
      setError(e.message);
      setPhase('interview');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-14">
        <AgentThinking 
          isVisible 
          messages={[
            'Generating interview questions…',
            'Analyzing role requirements…',
            'Calibrating difficulty…',
            'Preparing your interview…'
          ]} 
        />
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-14">
        <AgentThinking 
          isVisible 
          messages={[
            'Analyzing your performance…',
            'Calculating overall score…',
            'Generating recommendations…',
            'Preparing your report…'
          ]} 
        />
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <>
        <SetupPhase onStart={handleStart} />
        {error && (
          <div className="mx-auto max-w-2xl px-6">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}
      </>
    );
  }

  if (phase === 'interview') {
    return <InterviewPhase questions={questions} role={config.role} onComplete={handleComplete} />;
  }

  if (phase === 'results' && report) {
    return <ResultsPhase questions={questions} report={report} role={config.role} />;
  }

  return null;
}
