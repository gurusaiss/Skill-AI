import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

const authFetch = async (path, options = {}) => {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { throw new Error(`Server error (${res.status})`); } }
  if (!res.ok) { throw new Error(data?.error?.message || `Request failed (${res.status})`); }
  return data?.data ?? data;
};

function KnowledgeQuiz() {
  const navigate = useNavigate();
  const { moduleId } = useParams();
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [score, setScore] = useState(0);
  const [moduleInfo, setModuleInfo] = useState(null);

  useEffect(() => {
    loadQuestions();
  }, [moduleId]);

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const data = await authFetch(`/api/diagnostic?moduleId=${moduleId || ''}&count=5`);
      if (data?.questions && data.questions.length > 0) {
        setQuestions(data.questions);
      } else {
        setQuestions([
          { id: 'q1', text: 'What is the primary function of this module?', options: ['A) Learn core concepts', 'B) Build advanced skills', 'C) Complete certification', 'D) Team collaboration'], correct: 0 },
          { id: 'q2', text: 'Which skill is most relevant to this topic?', options: ['A) Communication', 'B) Technical analysis', 'C) Problem solving', 'D) Project management'], correct: 1 },
          { id: 'q3', text: 'What is the first step in mastering this skill?', options: ['A) Practice daily', 'B) Understand fundamentals', 'C) Join a community', 'D) Find a mentor'], correct: 1 },
          { id: 'q4', text: 'Which tool is commonly used in this domain?', options: ['A) VS Code', 'B) Figma', 'C) Jupyter', 'D) Docker'], correct: 0 },
          { id: 'q5', text: 'How do you measure progress effectively?', options: ['A) Time spent', 'B) Projects completed', 'C) Quiz scores', 'D) Peer feedback'], correct: 2 },
        ]);
      }
      setAnswers(new Array(5).fill(-1));

      if (moduleId) {
        try {
          const mod = await authFetch(`/api/modules/${moduleId}`);
          setModuleInfo(mod);
        } catch {}
      }
    } catch (e) {
      setQuestions([
        { id: 'q1', text: 'What is the primary function of this module?', options: ['A) Learn core concepts', 'B) Build advanced skills', 'C) Complete certification', 'D) Team collaboration'], correct: 0 },
        { id: 'q2', text: 'Which skill is most relevant to this topic?', options: ['A) Communication', 'B) Technical analysis', 'C) Problem solving', 'D) Project management'], correct: 1 },
      ]);
      setAnswers(new Array(2).fill(-1));
    } finally { setLoading(false); }
  };

  const handleAnswer = (idx) => {
    const newAnswers = [...answers];
    newAnswers[currentQ] = idx;
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    let correct = 0;
    questions.forEach((q, i) => {
      if (answers[i] === q.correct) correct++;
    });
    const finalScore = Math.round((correct / questions.length) * 100);
    setScore(finalScore);
    setCompleted(true);

    try {
      await authFetch('/api/diagnostic/result', {
        method: 'POST',
        body: JSON.stringify({ moduleId, answers, score: finalScore, questions: questions.length }),
      });
    } catch {}
    setSubmitting(false);
  };

  const startModule = () => {
    if (moduleId) {
      navigate(`/module/${moduleId}/learn`);
    } else {
      navigate('/dashboard');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
        <p className="text-slate-400">Loading knowledge quiz...</p>
      </div>
    </div>
  );

  if (completed) return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8 text-center">
          <div className="text-6xl mb-4">{score >= 60 ? '🎉' : '💪'}</div>
          <h2 className="text-2xl font-black text-white mb-2">Knowledge Quiz Complete</h2>
          <div className="text-5xl font-black text-indigo-400 mb-2">{score}%</div>
          <p className="text-slate-400 mb-2">
            {score >= 80 ? 'Excellent! You have strong foundational knowledge.' :
             score >= 60 ? 'Good start! There is room for improvement.' :
             'This module will help build your knowledge from the ground up.'}
          </p>
          <p className="text-xs text-slate-500 mb-6">
            {score < 60 ? '9 AI agents are generating your personalized learning roadmap based on your quiz results.' :
             'Your personalized learning plan is being generated based on your current knowledge level.'}
          </p>
          <button onClick={startModule}
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transition-all">
            {moduleId ? 'Start Learning Module →' : 'Back to Dashboard →'}
          </button>
        </div>
      </div>
    </div>
  );

  const q = questions[currentQ];
  if (!q) return null;

  return (
    <div className="min-h-screen bg-[#0F172A] py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-white mb-2">KNOWLEDGE QUIZ</h1>
          <p className="text-slate-400 text-sm">Answer {questions.length} questions to assess your current knowledge</p>
          {moduleInfo && <p className="text-indigo-300 text-xs mt-2 font-semibold">{moduleInfo.title}</p>}
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {questions.map((_, i) => (
            <div key={i}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i === currentQ ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 ring-offset-2 ring-offset-slate-900' :
                answers[i] >= 0 ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30' :
                'bg-slate-700/50 text-slate-500 border border-slate-600/50'
              }`}
              onClick={() => setCurrentQ(i)}
            >{i + 1}</div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8">
          <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-1">Question {currentQ + 1} of {questions.length}</p>
          <h2 className="text-lg font-bold text-white mb-6">{q.text}</h2>

          <div className="space-y-3">
            {q.options.map((opt, idx) => (
              <button key={idx}
                onClick={() => handleAnswer(idx)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  answers[currentQ] === idx
                    ? 'bg-indigo-600/15 border-indigo-500/40 text-white'
                    : 'bg-slate-900/50 border-slate-700/40 text-slate-300 hover:border-slate-600 hover:bg-slate-800/50'
                }`}
              >
                <span className="text-sm">{opt}</span>
              </button>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            <button onClick={() => setCurrentQ(Math.max(0, currentQ - 1))}
              disabled={currentQ === 0}
              className="px-5 py-2.5 rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700 text-sm font-semibold disabled:opacity-30 transition-all">
              ← Previous
            </button>
            {currentQ < questions.length - 1 ? (
              <button onClick={() => setCurrentQ(currentQ + 1)}
                disabled={answers[currentQ] < 0}
                className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-30 transition-all">
                Next →
              </button>
            ) : (
              <button onClick={handleSubmit}
                disabled={answers.some(a => a < 0) || submitting}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold disabled:opacity-30 transition-all">
                {submitting ? '⏳ Submitting...' : '✅ Submit Quiz'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default KnowledgeQuiz;