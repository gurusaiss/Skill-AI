import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { authFetch } from '../utils/authFetch.js';
import { ratingForReport, ratingStyle } from '../utils/assessmentRules.js';
import { Shell, DateFields, validateWindow, fmt, toLocalInput, defaultEnd } from './AssignAssessmentModals.jsx';

// Per-employee actions inside an assessment:
//   ManageMenu            labelled "Manage" dropdown for one employee row
//   EditDatesModal        change start/end (and a note) without resetting the attempt
//   DeleteAssignmentModal permanent delete of one or many assignments, with a clear warning
//   BulkReassignModal     new dates for several employees at once
//   ResultModal           one employee's result (score, rating, skills)

// ---------------------------------------------------------------- Manage menu
export function ManageMenu({ items, label = 'Manage' }) {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = (menuRef.current?.offsetHeight) || (items.length * 40 + 16);
    const width = 240;
    const top = r.bottom + 6 + menuH > window.innerHeight ? Math.max(8, r.top - menuH - 6) : r.bottom + 6;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ top, left });
  };

  useLayoutEffect(() => { if (open) place(); });
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 border border-slate-600/60 text-xs font-bold text-white transition-colors">
        {label}
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240 }}
          className="z-[300] rounded-xl border border-slate-600 bg-[#1E293B] shadow-2xl py-1.5">
          {items.filter(Boolean).map((it, i) => it.divider ? (
            <div key={`d${i}`} className="my-1 border-t border-slate-700" />
          ) : (
            <button key={it.label} role="menuitem" type="button" disabled={it.disabled} title={it.title}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              className={`w-full text-left px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${it.danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-200 hover:bg-slate-700/70'}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- Edit dates
export function EditDatesModal({ assessment, ea, employeeName, onClose, onDone, showToast }) {
  const initialStart = ea?.startAt ? toLocalInput(new Date(ea.startAt)) : toLocalInput(new Date());
  const initialEnd = ea?.dueAt && new Date(ea.dueAt) > new Date() ? toLocalInput(new Date(ea.dueAt)) : defaultEnd();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [notes, setNotes] = useState(ea?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    const win = validateWindow(start, end);
    if (win.error) { setError(win.error); return; }
    setSaving(true);
    try {
      await authFetch(`/api/assessments/${assessment.id}/employees/${ea.userId}`, {
        method: 'PUT',
        body: JSON.stringify({ startDate: win.startDate, endDate: win.endDate, notes }),
      });
      showToast?.(`Dates updated for ${employeeName}`, 'success');
      await onDone?.(assessment.id);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not update the dates');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Shell title="Edit dates" subtitle={`${employeeName} · ${assessment.title}`} onClose={onClose}>
      <div className="p-6 space-y-5">
        <p className="text-sm text-slate-300">
          Change when {employeeName} can start and when it closes. Their progress and answers are not reset.
          {ea?.dueAt ? <> Currently due {fmt(ea.dueAt)}.</> : null}
        </p>
        <DateFields start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <label className="block">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Note (optional)</span>
          <input value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="e.g. extended after leave"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </label>
        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-bold text-white">
            {saving ? 'Saving...' : 'Save dates'}
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------- Delete assignment
// targets: [{ ea, name, employeeId }]
export function DeleteAssignmentModal({ assessment, targets, onClose, onDone, showToast }) {
  const completed = targets.filter(t => t.ea.status === 'submitted');
  const single = targets.length === 1 ? targets[0] : null;
  const needsTyping = completed.length > 0;
  const expected = single ? [single.name, single.employeeId].filter(Boolean).map(s => String(s).trim().toLowerCase()) : ['delete'];
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const typedOk = !needsTyping || expected.includes(typed.trim().toLowerCase());

  const run = async () => {
    setError('');
    setBusy(true);
    const failed = [];
    let removed = 0;
    for (const t of targets) {
      try {
        await authFetch(`/api/assessments/${assessment.id}/employees/${t.ea.userId}`, { method: 'DELETE' });
        removed += 1;
      } catch (e) {
        failed.push(`${t.name}: ${e.message || 'failed'}`);
      }
    }
    setBusy(false);
    // Always refresh: some rows may be gone even if others failed.
    await onDone?.(assessment.id, removed);
    if (failed.length === 0) {
      showToast?.(removed === 1 ? `Assignment deleted for ${targets[0].name}` : `${removed} assignments deleted`, 'success');
      onClose();
    } else {
      setError(`${removed} deleted, ${failed.length} failed. ${failed.join('; ')}`);
    }
  };

  return (
    <Shell title={single ? 'Delete this assignment?' : `Delete ${targets.length} assignments?`} subtitle={assessment.title} onClose={busy ? () => {} : onClose}>
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2 text-sm text-slate-200">
          <p className="font-bold text-red-300">This cannot be undone.</p>
          <p>
            {single ? <><span className="font-semibold text-white">{single.name}</span> will lose</> : 'These employees will lose'} this assessment
            immediately. It is removed from the assessment, from the database, and from their own login.
            Their reminder history for it is deleted too.
          </p>
          {completed.length > 0 && (
            <p className="text-red-200">
              {single
                ? <>{single.name} already submitted. Their <span className="font-semibold">result, report and answers will be permanently deleted</span> and cannot be recovered.</>
                : <>{completed.length} of them already submitted. Those <span className="font-semibold">results, reports and answers will be permanently deleted</span> and cannot be recovered.</>}
            </p>
          )}
          <p className="text-xs text-slate-400">The system will not give it back automatically. You can assign it again later on purpose.</p>
        </div>

        {!single && (
          <ul className="max-h-32 overflow-y-auto rounded-lg border border-slate-700/50 divide-y divide-slate-700/30 text-sm">
            {targets.map(t => (
              <li key={t.ea.userId} className="px-3 py-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-white" title={t.name}>{t.name}</span>
                {t.ea.status === 'submitted' ? <span className="text-[10px] font-bold text-red-300 shrink-0">has a result</span> : <span className="text-[10px] text-slate-500 shrink-0">no result</span>}
              </li>
            ))}
          </ul>
        )}

        {needsTyping && (
          <label className="block">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {single ? `Type the employee's name${single.employeeId ? ' or ID' : ''} to confirm` : 'Type DELETE to confirm'}
            </span>
            <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off"
              placeholder={single ? (single.employeeId ? `${single.name} or ${single.employeeId}` : single.name) : 'DELETE'}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500" />
          </label>
        )}

        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={run} disabled={busy || !typedOk}
            className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white">
            {busy ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------ Bulk reassign
export function BulkReassignModal({ assessment, targets, onClose, onDone, showToast }) {
  const eligible = targets.filter(t => t.ea.status !== 'submitted');
  const skippedDone = targets.length - eligible.length;
  const [start, setStart] = useState(() => toLocalInput(new Date()));
  const [end, setEnd] = useState(defaultEnd);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setError('');
    const win = validateWindow(start, end);
    if (win.error) { setError(win.error); return; }
    setBusy(true);
    const failed = [];
    let ok = 0;
    for (const t of eligible) {
      try {
        await authFetch(`/api/assessments/${assessment.id}/employees/${t.ea.userId}/reassign`, {
          method: 'POST', body: JSON.stringify({ startDate: win.startDate, endDate: win.endDate, retake: false, notify }),
        });
        ok += 1;
      } catch (e) { failed.push(`${t.name}: ${e.message || 'failed'}`); }
    }
    setBusy(false);
    await onDone?.(assessment.id);
    if (failed.length === 0) { showToast?.(`${ok} employee${ok === 1 ? '' : 's'} reassigned`, 'success'); onClose(); }
    else setError(`${ok} reassigned, ${failed.length} failed. ${failed.join('; ')}`);
  };

  return (
    <Shell title={`Reassign ${eligible.length} employee${eligible.length === 1 ? '' : 's'}`} subtitle={assessment.title} onClose={busy ? () => {} : onClose}>
      <div className="p-6 space-y-5">
        <p className="text-sm text-slate-300">They get the same questions again with the new dates. Their current attempt starts over.</p>
        {skippedDone > 0 && <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">{skippedDone} selected employee{skippedDone === 1 ? ' has' : 's have'} already completed it and will be skipped. Use Reassign on a single row to give a completed employee a retake.</p>}
        <DateFields start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-indigo-500" />
          Email the employees about the new dates
        </label>
        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={run} disabled={busy || eligible.length === 0}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-bold text-white">
            {busy ? 'Reassigning...' : 'Reassign'}
          </button>
        </div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------ Result viewer
export function ResultModal({ assessment, ea, employeeName, onClose }) {
  const [report, setReport] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await authFetch(`/api/assessments/${assessment.id}/report`);
        const mine = (Array.isArray(rows) ? rows : []).filter(r => r.userId === ea.userId)
          .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0];
        if (alive) { setReport(mine || null); setState('done'); }
      } catch { if (alive) setState('error'); }
    })();
    return () => { alive = false; };
  }, [assessment.id, ea.userId]);

  const src = report || ea.scoring || {};
  const rating = ratingForReport(src);
  const st = ratingStyle(rating);
  const score = src.score ?? src.rawScore ?? ea.score;
  const skills = src.skillBreakdown || [];

  return (
    <Shell title={`${employeeName} · result`} subtitle={assessment.title} onClose={onClose}>
      <div className="p-6 space-y-4">
        {state === 'loading' && <p className="text-sm text-slate-400">Loading result...</p>}
        {state === 'error' && <p className="text-sm text-amber-300">Could not load the full report. Showing what is on record.</p>}
        <div className="flex items-center gap-3 flex-wrap">
          {score != null && <span className="text-3xl font-black text-white">{Math.round(Number(score))}%</span>}
          <span className={`px-3 py-1 rounded-lg text-sm font-bold ${st.chip}`}>{rating}</span>
          {src.correct != null && <span className="text-sm text-slate-400">{src.correct} of {src.total ?? '-'} correct</span>}
        </div>
        <p className="text-xs text-slate-500">Submitted {ea.submittedAt ? new Date(ea.submittedAt).toLocaleString() : '-'}</p>
        {skills.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skill scores</p>
            {skills.map((sb, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-32 truncate shrink-0" title={sb.skill}>{sb.skill}</span>
                <div className="flex-1 min-w-0 h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, sb.pct || 0)}%` }} /></div>
                <span className="text-xs font-bold text-slate-300 w-10 text-right">{sb.pct}%</span>
              </div>
            ))}
          </div>
        )}
        {(src.strengths?.length > 0 || src.weakAreas?.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {src.strengths?.length > 0 && <div><p className="text-xs font-bold text-emerald-400 mb-1">Strengths</p><div className="flex flex-wrap gap-1">{src.strengths.map((s, i) => <span key={i} className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">{s}</span>)}</div></div>}
            {src.weakAreas?.length > 0 && <div><p className="text-xs font-bold text-amber-400 mb-1">Weak areas</p><div className="flex flex-wrap gap-1">{src.weakAreas.map((s, i) => <span key={i} className="text-xs px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-300">{s}</span>)}</div></div>}
          </div>
        )}
        <div className="flex justify-end"><button onClick={onClose} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white">Close</button></div>
      </div>
    </Shell>
  );
}

// ------------------------------------------------- Delete a whole assessment
export function DeleteAssessmentModal({ assessment, onClose, onDone, showToast }) {
  const roster = assessment.employeeAssignments || [];
  const completed = roster.filter(ea => ea.status === 'submitted').length;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const typedOk = completed === 0 || typed.trim().toLowerCase() === String(assessment.title || '').trim().toLowerCase();

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await authFetch(`/api/assessments/${assessment.id}?confirm=true`, { method: 'DELETE' });
      showToast?.('Assessment deleted everywhere', 'success');
      await onDone?.(assessment.id);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not delete the assessment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Delete this assessment?" subtitle={assessment.title} onClose={busy ? () => {} : onClose}>
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2 text-sm text-slate-200">
          <p className="font-bold text-red-300">This cannot be undone.</p>
          <p>The assessment and its {roster.length} assignment{roster.length === 1 ? '' : 's'} are removed from the database and from every employee's login, together with reminder history.</p>
          {completed > 0 && <p className="text-red-200"><span className="font-semibold">{completed} submitted result{completed === 1 ? '' : 's'}</span>, reports and answers are permanently deleted.</p>}
        </div>
        {completed > 0 && (
          <label className="block">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Type the assessment title to confirm</span>
            <input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" placeholder={assessment.title}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500" />
          </label>
        )}
        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={run} disabled={busy || !typedOk}
            className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white">
            {busy ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
