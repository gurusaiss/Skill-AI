import React, { useMemo, useState } from 'react';
import { authFetch } from '../utils/authFetch.js';

// Two dialogs for giving an EXISTING assessment to employees:
//   AssignEmployeesModal  add one or many employees (a new joiner, or anyone who
//                         needs it again) with their own start and end date.
//                         Pass `assessment` to assign inside an assessment, or
//                         leave it out to pick one of the company's existing
//                         assessments first ("Use existing").
//   ReassignModal         give one employee who has not completed it the same
//                         questions again with new dates.
// Both call POST endpoints on /api/assessments and then onDone(assessmentId).

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const defaultStart = () => toLocalInput(new Date());
const defaultEnd = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(18, 0, 0, 0);
  return toLocalInput(d);
};
const fmt = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function validateWindow(startLocal, endLocal) {
  const start = startLocal ? new Date(startLocal) : new Date();
  const end = endLocal ? new Date(endLocal) : null;
  if (Number.isNaN(start.getTime())) return { error: 'Start date is not valid' };
  if (!end || Number.isNaN(end.getTime())) return { error: 'Choose an end date' };
  if (end.getTime() <= Date.now()) return { error: 'End date must be in the future' };
  if (end.getTime() <= start.getTime()) return { error: 'End date must be after the start date' };
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function DateFields({ start, end, onStart, onEnd }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Start date &amp; time</span>
        <input type="datetime-local" value={start} onChange={e => onStart(e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500" />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">End date &amp; time</span>
        <input type="datetime-local" value={end} onChange={e => onEnd(e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-indigo-500" />
      </label>
    </div>
  );
}

function Shell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#0F172A] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-700/60 sticky top-0 bg-[#0F172A] z-10">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-white truncate">{title}</h3>
            {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl ml-3" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AssignEmployeesModal({ assessments = [], assessment: fixedAssessment = null, employees = [], onClose, onDone, showToast }) {
  const [picked, setPicked] = useState(fixedAssessment);
  const [assessSearch, setAssessSearch] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [retake, setRetake] = useState(false);
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const assessment = picked;

  const pickable = useMemo(() => {
    const q = assessSearch.trim().toLowerCase();
    return assessments
      .filter(a => a.isActive !== false)
      .filter(a => !q || (a.title || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [assessments, assessSearch]);

  const statusByUser = useMemo(() => {
    const m = new Map();
    for (const ea of assessment?.employeeAssignments || []) m.set(ea.userId, ea);
    return m;
  }, [assessment]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter(e => e.status !== 'inactive' && e.status !== 'blocked')
      .filter(e => {
        if (!q) return true;
        return [e.name, e.employeeId, e.email, e.department, e.jobRole, e.phone]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [employees, search]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const isSelectable = (e) => {
    const ea = statusByUser.get(e.userId);
    return !(ea?.status === 'submitted' && !retake);
  };

  const selectAllShown = () => setSelected(prev => {
    const next = new Set(prev);
    candidates.filter(isSelectable).forEach(e => next.add(e.userId));
    return next;
  });

  const submit = async () => {
    setError('');
    const win = validateWindow(start, end);
    if (win.error) { setError(win.error); return; }
    if (selected.size === 0) { setError('Select at least one employee'); return; }
    setSubmitting(true);
    try {
      const data = await authFetch(`/api/assessments/${assessment.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ userIds: [...selected], startDate: win.startDate, endDate: win.endDate, retake, notify }),
      });
      setResult(data);
      const n = (data?.added?.length || 0) + (data?.reassigned?.length || 0);
      showToast?.(`Assessment assigned to ${n} employee${n === 1 ? '' : 's'}`, 'success');
      onDone?.(assessment.id);
    } catch (e) {
      setError(e.message || 'Could not assign the assessment');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result summary ──
  if (result) {
    const nameOf = (id) => employees.find(e => e.userId === id)?.name || id;
    return (
      <Shell title="Assignment complete" subtitle={assessment?.title} onClose={onClose}>
        <div className="p-6 space-y-4">
          {result.added?.length > 0 && (
            <p className="text-sm text-emerald-300">✓ Added: {result.added.map(x => x.name || nameOf(x.userId)).join(', ')}</p>
          )}
          {result.reassigned?.length > 0 && (
            <p className="text-sm text-indigo-300">↻ Reassigned (new attempt): {result.reassigned.map(x => x.name || nameOf(x.userId)).join(', ')}</p>
          )}
          {result.skipped?.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-bold text-amber-300 mb-1">Skipped</p>
              {result.skipped.map((s, i) => (
                <p key={i} className="text-xs text-amber-200/80">{s.name || nameOf(s.userId)}: {s.reason}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">Window: {fmt(result.startAt)} to {fmt(result.dueAt)}{notify ? ` · ${result.notified || 0} email${result.notified === 1 ? '' : 's'} sent` : ''}</p>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white">Done</button>
          </div>
        </div>
      </Shell>
    );
  }

  // ── Step A: choose an existing assessment ──
  if (!assessment) {
    return (
      <Shell title="Use an existing assessment" subtitle="Pick an assessment, then choose the employees who should take it" onClose={onClose}>
        <div className="p-6 space-y-3">
          <input value={assessSearch} onChange={e => setAssessSearch(e.target.value)} placeholder="Search assessments by title"
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
          {pickable.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No existing assessments found.</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {pickable.map(a => (
                <button key={a.id} onClick={() => setPicked(a)}
                  className="w-full text-left px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-indigo-500/50 transition-colors">
                  <p className="text-sm font-bold text-white truncate">{a.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {(a.employeeAssignments || []).length} assigned · {a.questionCount ?? '—'} questions · created {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '—'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </Shell>
    );
  }

  // ── Step B: choose employees + dates ──
  return (
    <Shell title={fixedAssessment ? 'Assign employees' : 'Assign existing assessment'} subtitle={assessment.title} onClose={onClose}>
      <div className="p-6 space-y-5">
        {!fixedAssessment && (
          <button onClick={() => { setPicked(null); setSelected(new Set()); }} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">← Choose a different assessment</button>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Employees</label>
            <div className="flex items-center gap-3 text-xs">
              <button onClick={selectAllShown} className="font-semibold text-indigo-300 hover:text-indigo-200">Select all shown</button>
              <button onClick={() => setSelected(new Set())} className="font-semibold text-slate-400 hover:text-white">Clear</button>
            </div>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, employee ID, email, department or job role"
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
          <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-700/50 divide-y divide-slate-700/30">
            {candidates.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">No employees match.</p>
            ) : candidates.map(e => {
              const ea = statusByUser.get(e.userId);
              const done = ea?.status === 'submitted';
              const disabled = !isSelectable(e);
              return (
                <label key={e.userId} className={`flex items-center gap-3 px-3 py-2 ${disabled ? 'opacity-50' : 'hover:bg-slate-800/50 cursor-pointer'}`}>
                  <input type="checkbox" checked={selected.has(e.userId)} disabled={disabled} onChange={() => toggle(e.userId)} className="accent-indigo-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{e.name}</p>
                    <p className="text-xs text-slate-500 truncate">{[e.employeeId, e.jobRole, e.department, e.email].filter(Boolean).join(' · ')}</p>
                  </div>
                  {ea ? (
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${done ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'}`}>
                      {done ? 'Completed' : 'Already assigned'}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 mt-1.5">{selected.size} selected</p>
        </div>

        <DateFields start={start} end={end} onStart={setStart} onEnd={setEnd} />

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={retake} onChange={e => { setRetake(e.target.checked); if (!e.target.checked) setSelected(prev => new Set([...prev].filter(id => statusByUser.get(id)?.status !== 'submitted'))); }} className="accent-indigo-500" />
            Let employees who already completed it take it again (their earlier result stays on record)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-indigo-500" />
            Email the employees about this assignment
          </label>
          <p className="text-[11px] text-slate-500">Everyone gets the same questions as the rest of this assessment. Each attempt is timed at 60 minutes.</p>
        </div>

        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={submit} disabled={submitting || selected.size === 0}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white">
            {submitting ? 'Assigning…' : `Assign to ${selected.size || ''} ${selected.size === 1 ? 'employee' : 'employees'}`.replace('  ', ' ')}
          </button>
        </div>
      </div>
    </Shell>
  );
}

export function ReassignModal({ assessment, ea, employeeName, onClose, onDone, showToast }) {
  const completed = ea?.status === 'submitted';
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [notify, setNotify] = useState(true);
  const [retake, setRetake] = useState(completed);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const win = validateWindow(start, end);
    if (win.error) { setError(win.error); return; }
    setSubmitting(true);
    try {
      await authFetch(`/api/assessments/${assessment.id}/employees/${ea.userId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ startDate: win.startDate, endDate: win.endDate, retake, notify }),
      });
      showToast?.(`Assessment reassigned to ${employeeName}`, 'success');
      onDone?.(assessment.id);
      onClose();
    } catch (e) {
      setError(e.message || 'Could not reassign the assessment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell title="Reassign assessment" subtitle={`${employeeName} · ${assessment.title}`} onClose={onClose}>
      <div className="p-6 space-y-5">
        <p className="text-sm text-slate-300">
          {employeeName} {completed ? 'has completed' : 'has not completed'} this assessment
          {ea?.dueAt || assessment.deadline ? <> (due {fmt(ea?.dueAt || assessment.deadline)})</> : null}.
          They will get the <span className="font-semibold text-white">same questions</span> again with the new dates below.
        </p>
        <DateFields start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <div className="space-y-2">
          {completed && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={retake} onChange={e => setRetake(e.target.checked)} className="accent-indigo-500" />
              Start a new attempt (the earlier result stays on record)
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-indigo-500" />
            Email {employeeName} about the new dates
          </label>
        </div>
        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={submit} disabled={submitting || (completed && !retake)}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white">
            {submitting ? 'Reassigning…' : 'Reassign'}
          </button>
        </div>
      </div>
    </Shell>
  );
}
