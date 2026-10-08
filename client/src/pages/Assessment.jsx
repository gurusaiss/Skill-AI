import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { authFetch } from '../utils/authFetch.js';
import { ratingForReport, ratingStyle, normalizeDuration } from '../utils/assessmentRules.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatMmSs(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function scoreColor(pct) {
  if (pct >= 80) return '#10b981';
  if (pct >= 60) return '#f59e0b';
  return '#ef4444';
}

// ── sub-components ────────────────────────────────────────────────────────────

const ConfirmDialog = ({ onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />
    <div className="relative w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <h3 className="text-lg font-black text-white mb-2">Submit Assessment?</h3>
      <p className="text-sm text-slate-400 mb-6">
        Once submitted you cannot change your answers. Are you sure?
      </p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-bold transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-all"
        >
          Yes, Submit
        </button>
      </div>
    </div>
  </div>
);

const ScoreRing = ({ pct, rating }) => {
  const color = ratingStyle(rating).hex;
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  return (
    <svg width="140" height="140" className="mx-auto mb-3">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#1e293b" strokeWidth="12" />
      <circle
        cx="70" cy="70" r={r}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
        style={{ transition: 'stroke-dasharray 1s ease' }}
      />
      <text x="70" y="65" textAnchor="middle" fill={color} fontSize="26" fontWeight="900" dy="0">{pct}%</text>
      <text x="70" y="84" textAnchor="middle" fill="#94a3b8" fontSize="13" fontWeight="700">{rating}</text>
    </svg>
  );
};

const MiniBar = ({ label, value, max }) => {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-slate-400 w-28 truncate flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: scoreColor(pct) }}
        />
      </div>
      <span className="text-slate-400 w-10 text-right">{value}/{max}</span>
    </div>
  );
};

// Papers longer than this are split into pages. Chosen so a page fits a
// normal screen without scrolling being the primary navigation.
const QUESTIONS_PER_PAGE = 10;

// ── main component ────────────────────────────────────────────────────────────

export default function Assessment() {
  const { assessmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // answers: { questionIndex: string }
  const [answers, setAnswers] = useState({});
  const [page, setPage] = useState(0);

  // submission state
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [report, setReport] = useState(null); // set after submit or if already submitted

  // timer
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);

  // ── load assessment ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) { navigate('/'); return; }
    loadAssessment();
  }, [user, assessmentId]);

  const loadAssessment = async () => {
    setLoading(true);
    setError('');
    try {
      const all = await authFetch('/api/assessments/my');
      const list = Array.isArray(all) ? all : (all?.assessments || []);

      let found = null;
      if (assessmentId) {
        found = list.find(a => String(a.id) === String(assessmentId) || String(a._id) === String(assessmentId));
      }
      if (!found) {
        found = list.find(a => a.status === 'assigned' || a.status === 'pending');
      }
      if (!found && list.length > 0) found = list[0];

      if (!found) {
        setAssessment(null);
        setLoading(false);
        return;
      }

      setAssessment(found);

      // If already submitted, surface the report directly
      const scoring = found.submission?.scoring || found.scoring;
      if ((found.status === 'submitted' || found.status === 'completed') && scoring) {
        setReport(scoring);
      }

      // Init timer — only if visible, not expired, not submitted
      if (!scoring && found.isVisible !== false && found.status !== 'expired') {
        setTimeLeft(normalizeDuration(found.duration) * 60);
        // Record when the attempt really began (powers "started" / "time taken" in
        // reports). Server side it is idempotent; a failure must never block the test.
        authFetch(`/api/assessments/${found.id || found._id}/start`, { method: 'POST' }).catch(() => {});
      }
    } catch (e) {
      setError(e.message || 'Failed to load assessment');
    } finally {
      setLoading(false);
    }
  };

  // ── timer ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (timeLeft === null || report) return;
    if (timeLeft <= 0) {
      handleSubmitFinal();
      return;
    }
    timerRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [timeLeft, report]);

  // ── answer handling ──────────────────────────────────────────────────────

  // A paper can now be hundreds of questions spread over many pages, so an
  // accidental refresh or closed tab must not discard the work. Kept local
  // (no server round-trip per keystroke); cleared once submitted.
  const draftKey = assessment?.id ? `assessment_draft_${assessment.id}` : null;

  useEffect(() => {
    if (!draftKey || report) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          setAnswers(prev => (Object.keys(prev).length > 0 ? prev : parsed));
        }
      }
    } catch { /* corrupt draft — start clean rather than blocking the page */ }
  }, [draftKey, report]);

  const handleAnswer = (idx, value) => {
    setAnswers(prev => {
      const next = { ...prev, [idx]: value };
      if (draftKey) {
        try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* quota/private mode */ }
      }
      return next;
    });
  };

  const allAnswered = () => {
    if (!assessment?.questions) return false;
    return assessment.questions.every((_, idx) => {
      const ans = answers[idx];
      return ans !== undefined && ans !== null && String(ans).trim() !== '';
    });
  };

  // ── submission ───────────────────────────────────────────────────────────

  const handleSubmitFinal = useCallback(async () => {
    if (!assessment) return;
    clearTimeout(timerRef.current);
    setShowConfirm(false);
    setSubmitting(true);
    try {
      // Build ordered answers array — include ALL questions (even unanswered ones)
      const questions = assessment.questions || [];
      const answersPayload = questions.map((_, idx) => ({
        questionIndex: idx,
        answer: answers[idx] ?? '',   // empty string for unanswered → shows "(no answer)" correctly
      }));

      const id = assessment.id || assessment._id;
      const result = await authFetch(`/api/assessments/${id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: answersPayload }),
      });

      // Backend returns { report, scoring } — try both paths
      const scoring = result?.scoring || result?.report || result;
      setReport(scoring);
      // Submitted successfully — the local draft has served its purpose.
      if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }

      // Module generation + assignment now happens automatically on the server after submit
    } catch (e) {
      setError(e.message || 'Failed to submit assessment');
      setSubmitting(false);
    }
  }, [assessment, answers, user]);

  // ── timer color ──────────────────────────────────────────────────────────

  const timerColor = () => {
    if (timeLeft === null) return 'text-slate-400';
    if (timeLeft <= 60) return 'text-red-400';
    if (timeLeft <= 300) return 'text-amber-400';
    return 'text-slate-300';
  };

  // ── render question ──────────────────────────────────────────────────────

  const renderQuestion = (q, idx) => {
    const val = answers[idx] ?? '';
    const optionLabels = ['A', 'B', 'C', 'D'];

    if (q.type === 'mcq' || q.type === 'multiple_choice') {
      const options = q.options || q.choices || [];
      if (options.length === 0) {
        // Fail visibly instead of silently rendering an empty answer area —
        // a malformed/legacy question with no options previously looked
        // identical to "this question has no answer choices to show," with
        // no indication to the employee or support that something is broken.
        return (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-300 text-sm">
            ⚠️ This question could not be loaded correctly (no answer options found). Please contact your admin — your progress on other questions is unaffected.
          </div>
        );
      }
      return (
        <div className="space-y-2.5">
          {options.map((opt, oi) => {
            const optVal = typeof opt === 'string' ? opt : opt.text || opt.value || String(opt);
            const selected = val === optVal || val === String(oi);
            return (
              <label
                key={oi}
                className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                  selected
                    ? 'bg-indigo-500/15 border-indigo-500/50 text-white'
                    : 'bg-slate-900/60 border-slate-700/50 text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name={`q_${idx}`}
                  value={optVal}
                  checked={selected}
                  onChange={() => handleAnswer(idx, optVal)}
                  className="sr-only"
                />
                <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border ${
                  selected ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  {optionLabels[oi] || oi + 1}
                </span>
                <span className="text-sm">{optVal}</span>
              </label>
            );
          })}
        </div>
      );
    }

    if (q.type === 'fill_blank' || q.type === 'fill_in_blank') {
      return (
        <input
          type="text"
          value={val}
          onChange={e => handleAnswer(idx, e.target.value)}
          placeholder="Type your answer..."
          className="w-full px-4 py-3 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white text-sm placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-all"
        />
      );
    }

    // default: subjective / text
    return (
      <textarea
        value={val}
        onChange={e => handleAnswer(idx, e.target.value)}
        placeholder="Write your answer..."
        rows={4}
        className="w-full px-4 py-3 bg-slate-900/60 border border-slate-700/50 rounded-xl text-white text-sm placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none transition-all"
      />
    );
  };

  // ── report card ──────────────────────────────────────────────────────────

  if (report) {
    const pct = Math.round(report.score ?? report.percentage ?? 0);
    // Rating (Expert / Intermediate / Basic / No Rating) from the exact score; old reports
    // that only carry a letter grade or pass flag are rated from their counts.
    const reportRating = ratingForReport(report);
    const ratingInfo = ratingStyle(reportRating);
    const correct = report.correct ?? report.correctCount ?? 0;
    const total = report.total ?? report.totalQuestions ?? (assessment?.questions?.length ?? 0);
    const strengths = report.strengths || report.strongAreas || [];
    const weakAreas = report.weakAreas || report.weaknesses || [];
    const missingCompetencies = report.missingCompetencies || [];
    const recommendedLearningAreas = report.recommendedLearningAreas || [];
    const skillBreakdown = report.skillBreakdown || [];

    return (
      <div className="min-h-screen bg-[#0F172A] text-white px-3 sm:px-5 lg:px-6 2xl:px-8 py-4 sm:py-6">
        <div className="w-full grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start">
          <div className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-5 sm:p-8 shadow-2xl min-w-0">
            <h2 className="text-center text-sm font-black text-slate-400 uppercase tracking-widest mb-6">Assessment Report</h2>
            <h1 className="text-center text-xl font-bold text-white mb-1">{assessment?.title || 'Assessment'}</h1>
            {assessment?.jobRole && (
              <p className="text-center text-sm text-indigo-300 mb-6">{assessment.jobRole}</p>
            )}

            <ScoreRing pct={pct} rating={reportRating} />

            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Rating', value: reportRating, color: ratingInfo.hex },
                { label: 'Score', value: `${pct}%` },
                { label: 'Correct', value: `${correct}/${total}` },
              ].map(item => (
                <div key={item.label} className="rounded-xl bg-slate-800/60 border border-slate-700/30 p-3 text-center">
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">{item.label}</p>
                  <p className="text-xl font-black" style={{ color: item.color || '#e2e8f0' }}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Rating band and what it means */}
            <div className={`rounded-xl px-4 py-3 mb-4 ${ratingInfo.chip}`} title={`Score range for ${reportRating}: ${ratingInfo.range}`}>
              <span className="text-xs font-black uppercase tracking-widest">{reportRating}</span>
              <p className="text-sm text-slate-400 mt-1">{ratingInfo.readiness} (score range {ratingInfo.range})</p>
            </div>

            {weakAreas.length > 0 && (
              <div className="rounded-xl px-4 py-2.5 mb-4 bg-indigo-500/8 border border-indigo-500/20">
                <p className="text-sm text-indigo-300 font-semibold">
                  A personalized training module has been assigned to you based on your assessment results.
                </p>
              </div>
            )}

            {strengths.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-2">Strengths</p>
                <ul className="space-y-1">
                  {strengths.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      {typeof s === 'string' ? s : s.area || s.name || String(s)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {weakAreas.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-black text-red-400 uppercase tracking-widest mb-2">Weak Areas</p>
                <ul className="space-y-1">
                  {weakAreas.map((w, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                      {typeof w === 'string' ? w : w.area || w.name || String(w)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {skillBreakdown.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Skill Breakdown</p>
                <div className="space-y-2.5">
                  {skillBreakdown.map((item, i) => (
                    <MiniBar
                      key={i}
                      label={item.skill || item.area || item.name || `Topic ${i + 1}`}
                      value={item.correct ?? item.score ?? 0}
                      max={item.total ?? item.max ?? 1}
                    />
                  ))}
                </div>
              </div>
            )}

            {missingCompetencies.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-black text-red-400 uppercase tracking-widest mb-2">Missing Competencies</p>
                <div className="flex flex-wrap gap-1.5">
                  {missingCompetencies.map((m, i) => (
                    <span key={i} className="text-sm px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300">{m}</span>
                  ))}
                </div>
              </div>
            )}

            {recommendedLearningAreas.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2">Recommended Learning</p>
                <div className="flex flex-wrap gap-1.5">
                  {recommendedLearningAreas.map((r, i) => (
                    <span key={i} className="text-sm px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">{r}</span>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => navigate('/dashboard')}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black transition-all shadow-lg shadow-indigo-500/20"
            >
              Back to Dashboard
            </button>
          </div>

          {/* ── Question-by-Question Review ── */}
          {(report.breakdown?.length > 0) && (
            <div className="rounded-2xl border border-slate-700/50 bg-[#1E293B] p-5 sm:p-6 shadow-xl min-w-0">
              <h3 className="text-base font-black text-slate-300 uppercase tracking-widest mb-5">📋 Answer Review</h3>
              <div className="space-y-4">
                {report.breakdown.map((b, i) => (
                  <div key={i} className={`rounded-xl border p-4 ${b.isCorrect ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                    {/* Question header */}
                    <div className="flex items-start gap-3 mb-3">
                      <span className={`w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black border ${b.isCorrect ? 'bg-emerald-600/30 border-emerald-500/40 text-emerald-300' : 'bg-red-600/30 border-red-500/40 text-red-300'}`}>
                        {b.isCorrect ? '✓' : '✗'}
                      </span>
                      <p className="text-white text-base font-semibold leading-snug">Q{i + 1}. {b.question}</p>
                    </div>

                    {/* Answers */}
                    <div className="ml-10 space-y-1.5">
                      {/* User's answer */}
                      <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                        b.isCorrect
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : b.userAnswer
                            ? 'bg-red-500/10 text-red-300'
                            : 'bg-slate-700/50 text-slate-400'
                      }`}>
                        <span className="font-bold shrink-0">Your answer:</span>
                        <span>{b.userAnswer || '(no answer)'}</span>
                      </div>

                      {/* Correct answer — always show when wrong */}
                      {!b.isCorrect && (
                        <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          <span className="font-bold shrink-0">✓ Correct:</span>
                          <span>{b.correctOptionText || b.correctAnswer}</span>
                        </div>
                      )}

                      {/* Explanation — why the correct answer is correct */}
                      {b.explanation && (
                        <div className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-indigo-500/10 text-indigo-200 border border-indigo-500/20">
                          <span className="shrink-0">💡</span>
                          <span>{b.explanation}</span>
                        </div>
                      )}

                      {/* Skill area tag */}
                      {b.skillArea && b.skillArea !== 'General' && (
                        <span className="inline-block text-xs px-2 py-0.5 rounded-md bg-slate-700/60 text-slate-400 border border-slate-600/40 mt-1">
                          {b.skillArea}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── loading / error / empty ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-slate-400 animate-pulse text-sm">Loading assessment...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <p className="text-red-400 font-semibold mb-4">{error}</p>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4 opacity-30">📋</div>
          <h2 className="text-xl font-black text-white mb-2">No Assessments Assigned</h2>
          <p className="text-slate-400 text-sm mb-6">There are no assessments assigned to you right now.</p>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Timing gate: not yet available ──────────────────────────────────────
  if (assessment.isVisible === false) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🕐</div>
          <h2 className="text-xl font-black text-white mb-2">Assessment Not Available Yet</h2>
          <p className="text-slate-400 text-sm mb-2">This assessment is scheduled for:</p>
          <div className="bg-slate-800 border border-slate-700 rounded-xl px-5 py-3 mb-6">
            <p className="text-indigo-300 font-bold text-lg">
              {assessment.assessmentDate
                ? new Date(assessment.assessmentDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                : 'TBD'}
            </p>
          </div>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition-all">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Timing gate: deadline expired ────────────────────────────────────────
  if (assessment.isExpired && assessment.status !== 'submitted') {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⏰</div>
          <h2 className="text-xl font-black text-white mb-2">Submission Deadline Passed</h2>
          <p className="text-slate-400 text-sm mb-2">The deadline for this assessment was:</p>
          <div className="bg-red-900/30 border border-red-500/30 rounded-xl px-5 py-3 mb-6">
            <p className="text-red-300 font-bold">
              {new Date(assessment.deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold transition-all">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const questions = assessment.questions || [];
  const answeredCount = questions.filter((_, idx) => {
    const a = answers[idx];
    return a !== undefined && a !== null && String(a).trim() !== '';
  }).length;
  const progressPct = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  // Now that an employee receives their role's ENTIRE approved bank, a paper
  // can legitimately be hundreds of questions. Rendering them all at once
  // (the previous behaviour) meant a single page with thousands of
  // interactive elements. Short papers stay on one page so nothing changes
  // for the common case.
  const totalPages = Math.max(1, Math.ceil(questions.length / QUESTIONS_PER_PAGE));
  const paginated = questions.length > QUESTIONS_PER_PAGE;
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = paginated ? safePage * QUESTIONS_PER_PAGE : 0;
  const pageEnd = paginated ? Math.min(pageStart + QUESTIONS_PER_PAGE, questions.length) : questions.length;
  const visibleQuestions = questions.slice(pageStart, pageEnd);
  const unansweredOnPage = visibleQuestions.filter((_, i) => {
    const a = answers[pageStart + i];
    return a === undefined || a === null || String(a).trim() === '';
  }).length;

  // ── assessment view ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0F172A] text-white pb-24">
      {showConfirm && (
        <ConfirmDialog
          onConfirm={handleSubmitFinal}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* Fixed timer */}
      {timeLeft !== null && (
        <div className={`fixed top-4 right-4 z-40 flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 shadow-xl font-mono font-black text-sm ${timerColor()}`}>
          ⏱ {formatMmSs(timeLeft)}
        </div>
      )}

      <div className="w-full px-3 sm:px-5 lg:px-6 2xl:px-8 py-4 sm:py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h1 className="text-2xl sm:text-3xl font-black text-white">{assessment.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {(assessment.jobRole || assessment.job_role) && (
              <span className="px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-sm font-bold">
                {assessment.jobRole || assessment.job_role}
              </span>
            )}
            <span className="px-3 py-1 rounded-full bg-slate-700/50 border border-slate-700 text-slate-400 text-sm font-bold">
              ⏱ {normalizeDuration(assessment.duration)} mins
            </span>
            {(assessment.scheduledDate || assessment.date) && (
              <span className="px-3 py-1 rounded-full bg-slate-700/50 border border-slate-700 text-slate-400 text-sm font-bold">
                📅 {new Date(assessment.scheduledDate || assessment.date).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {questions.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm text-slate-300 font-semibold mb-1.5">
              <span>Progress</span>
              <span>{answeredCount} / {questions.length} answered</span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div role="alert" className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Questions */}
        {questions.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/40 bg-[#1E293B] p-8 text-center">
            <p className="text-slate-400">This assessment has no questions.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
            {paginated && (
              <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/40 bg-[#1E293B] px-4 py-2.5 text-sm">
                <span className="text-slate-400">
                  Page <span className="text-white font-bold">{safePage + 1}</span> of {totalPages}
                  <span className="text-slate-400"> · </span>
                  questions <span className="text-white font-semibold">{pageStart + 1}–{pageEnd}</span> of {questions.length}
                </span>
                <span className={unansweredOnPage > 0 ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                  {unansweredOnPage > 0 ? `${unansweredOnPage} unanswered on this page` : 'page complete'}
                </span>
              </div>
            )}
            {visibleQuestions.map((q, i) => {
              const idx = pageStart + i;
              return (
              <div key={idx} className="min-w-0 rounded-2xl border border-slate-700/40 bg-[#1E293B] p-5 sm:p-6">
                <div className="flex items-start gap-3 mb-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-sm flex items-center justify-center font-black">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-slate-100 leading-relaxed">{q.question || q.text || q.prompt}</p>
                    {q.type && (
                      <span className="inline-block mt-1 text-sm text-slate-400 capitalize">
                        {q.type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {answers[idx] !== undefined && String(answers[idx]).trim() !== '' && (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/30 border border-emerald-500/50 flex items-center justify-center text-emerald-400 text-xs">✓</span>
                  )}
                </div>
                {renderQuestion(q, idx)}
              </div>
              );
            })}

            {paginated && (
              <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={safePage === 0}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Previous
                </button>
                <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
                  {Array.from({ length: totalPages }, (_, p) => {
                    const from = p * QUESTIONS_PER_PAGE;
                    const to = Math.min(from + QUESTIONS_PER_PAGE, questions.length);
                    let done = 0;
                    for (let k = from; k < to; k++) {
                      const a = answers[k];
                      if (a !== undefined && a !== null && String(a).trim() !== '') done++;
                    }
                    const complete = done === (to - from);
                    return (
                      <button
                        key={p}
                        onClick={() => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        title={`Questions ${from + 1}–${to} · ${done}/${to - from} answered`}
                        className={`w-9 h-9 rounded-lg text-sm font-black transition-all border ${
                          p === safePage
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : complete
                              ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        {p + 1}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  disabled={safePage >= totalPages - 1}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Submit */}
        {questions.length > 0 && (
          <div className="mt-8 text-center">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!allAnswered() || submitting}
              className="px-10 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-base transition-all shadow-2xl shadow-indigo-500/30"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : 'Submit Assessment'}
            </button>
            {!allAnswered() && (() => {
              const firstUnansweredIdx = questions.findIndex((_, idx) => {
                const ans = answers[idx];
                return ans === undefined || ans === null || String(ans).trim() === '';
              });
              const firstUnansweredPage = Math.floor(firstUnansweredIdx / QUESTIONS_PER_PAGE);
              const isOnAnotherPage = paginated && firstUnansweredPage !== safePage;
              return (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <p className="text-sm text-slate-400">Answer all questions to submit</p>
                  {isOnAnotherPage && (
                    <button
                      onClick={() => { setPage(firstUnansweredPage); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className="text-sm font-semibold text-amber-400 hover:text-amber-300 underline underline-offset-2"
                    >
                      Go to page {firstUnansweredPage + 1} — question {firstUnansweredIdx + 1} is unanswered
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
