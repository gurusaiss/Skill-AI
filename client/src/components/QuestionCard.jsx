import React from 'react';

const DIFF_COLORS = {
  easy: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  hard: 'bg-red-500/20 text-red-300 border-red-500/30',
};

/**
 * Question card used by the Role Library question bank. Shared by the live
 * (editable) list and the read-only quarter-archive view: with `readOnly` the
 * Edit / Lock / Delete controls are not rendered, and the lock badge simply
 * shows the state the question had when it was archived.
 */
export default function QuestionCard({
  q, index, readOnly = false, canEdit = true,
  lockingQid = null, onEdit, onToggleLock, onDelete,
}) {
  const noPerm = "You don't have permission to edit questions";
  return (
    <div className="bg-[#0F172A] border border-slate-700 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-white font-medium flex-1">{index + 1}. {q.question}</p>
        <div className="flex gap-1 flex-shrink-0 items-center">
          {q.isManual && <span className="px-1.5 py-0.5 rounded text-xs bg-violet-900/40 text-violet-400 border border-violet-700/50">edited</span>}
          {q.locked
            ? <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-900/40 text-emerald-400 border border-emerald-700/50" title={readOnly ? 'Was locked when this quarter was archived' : 'Locked — preserved exactly as-is on every regenerate, until unlocked'}>🔒 locked</span>
            : readOnly && <span className="px-1.5 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700" title="Was unlocked when this quarter was archived">🔓 unlocked</span>}
          {typeof q.qualityScore === 'number' && (
            <span
              className={`px-1.5 py-0.5 rounded text-xs border ${q.qualityScore >= 70 ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/50' : q.qualityScore >= 50 ? 'bg-amber-900/40 text-amber-400 border-amber-700/50' : 'bg-red-900/40 text-red-400 border-red-700/50'}`}
              title="Quality score — groundedness, specificity, non-generic phrasing, and answer completeness"
            >
              Q {q.qualityScore}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs border capitalize ${DIFF_COLORS[q.difficulty] || DIFF_COLORS.medium}`}>{q.difficulty || 'medium'}</span>
          {!readOnly && (
            <>
              <button
                onClick={onEdit}
                disabled={q.locked || !canEdit}
                title={!canEdit ? noPerm : q.locked ? 'Unlock to edit' : undefined}
                className="text-xs px-2 py-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >Edit</button>
              <button
                onClick={onToggleLock}
                disabled={lockingQid === q.id || !canEdit}
                title={!canEdit ? noPerm : q.locked ? 'Unlock — this question becomes regeneratable again' : 'Lock — preserve this question exactly as-is on every future regenerate'}
                className={`text-xs px-2 py-1 rounded disabled:opacity-40 ${q.locked ? 'bg-amber-600/20 text-amber-300 hover:bg-amber-600/40' : 'bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40'}`}
              >
                {lockingQid === q.id ? '…' : q.locked ? '🔓 Unlock' : '🔒 Lock'}
              </button>
              <button
                onClick={onDelete}
                disabled={q.locked || !canEdit}
                title={!canEdit ? noPerm : q.locked ? 'Unlock to delete' : undefined}
                className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 disabled:opacity-40 disabled:cursor-not-allowed"
              >Del</button>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        {q.skillArea && <p className="text-xs text-slate-500">Skill: {q.skillArea}</p>}
        <span className="text-xs text-slate-600 capitalize">{q.type === 'fill_blank' ? 'Fill in the Blank' : q.type === 'subjective' ? 'Subjective' : 'MCQ'}</span>
      </div>
      {q.type === 'mcq' && (
        <div className="mt-2 grid grid-cols-2 gap-1">
          {(q.options || []).map((opt, oi) => (
            <p key={oi} className={`text-xs px-2 py-1 rounded ${opt.startsWith(q.answer) ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400'}`}>{opt}</p>
          ))}
        </div>
      )}
      {(q.type === 'fill_blank' || q.type === 'subjective') && q.answer && (
        <p className="text-xs text-emerald-400/80 mt-2 bg-emerald-500/10 rounded px-2 py-1">
          <span className="text-slate-500">Answer: </span>{q.answer}
        </p>
      )}
      {q.explanation && <p className="text-xs text-slate-500 mt-2 italic">{q.explanation}</p>}
    </div>
  );
}
