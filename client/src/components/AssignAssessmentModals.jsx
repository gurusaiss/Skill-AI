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
export const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const defaultStart = () => toLocalInput(new Date());
export const defaultEnd = () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(18, 0, 0, 0);
  return toLocalInput(d);
};
export const fmt = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export function validateWindow(startLocal, endLocal) {
  const start = startLocal ? new Date(startLocal) : new Date();
  const end = endLocal ? new Date(endLocal) : null;
  if (Number.isNaN(start.getTime())) return { error: 'Start date is not valid' };
  if (!end || Number.isNaN(end.getTime())) return { error: 'Choose an end date' };
  if (end.getTime() <= Date.now()) return { error: 'End date must be in the future' };
  if (end.getTime() <= start.getTime()) return { error: 'End date must be after the start date' };
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export function DateFields({ start, end, onStart, onEnd }) {
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

export function Shell({ title, subtitle, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-[#0F172A] border border-slate-700 rounded-2xl w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col`}>
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

const norm = (s) => String(s || '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();

// Does this assessment fit an employee's job role? Matches the roles already on
// its roster, or the role named in its title (e.g. "Pre-Assessment: QA Tester").
function fitsRole(a, role) {
  const r = norm(role);
  if (!r) return false;
  if ((a.employeeAssignments || []).some(ea => norm(ea.jobRole) === r)) return true;
  if (a.roleName && norm(a.roleName) === r) return true;
  return norm(a.title).includes(r);
}

export function AssignEmployeesModal({ assessments = [], assessment: fixedAssessment = null, employees = [], initialEmployeeIds = [], onClose, onDone, showToast }) {
  const [pickedIds, setPickedIds] = useState(() => new Set(fixedAssessment ? [fixedAssessment.id] : []));
  const [assessSearch, setAssessSearch] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set(initialEmployeeIds));
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [retake, setRetake] = useState(false);
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  const activeAssessments = useMemo(() => {
    const list = assessments.filter(a => a.isActive !== false);
    // A fixed assessment must always be present even if the list hasn't loaded it.
    if (fixedAssessment && !list.some(a => a.id === fixedAssessment.id)) list.push(fixedAssessment);
    return list;
  }, [assessments, fixedAssessment]);

  const byId = useMemo(() => new Map(activeAssessments.map(a => [a.id, a])), [activeAssessments]);
  const pickedList = useMemo(() => [...pickedIds].map(id => byId.get(id)).filter(Boolean), [pickedIds, byId]);
  const firstPicked = pickedList[0] || null;

  // Job roles of the chosen employees drive the "Recommended" group.
  const selectedRoles = useMemo(() => {
    const roles = new Set();
    for (const e of employees) if (selected.has(e.userId) && e.jobRole) roles.add(e.jobRole);
    return [...roles];
  }, [employees, selected]);

  const { recommended, others } = useMemo(() => {
    const q = assessSearch.trim().toLowerCase();
    const list = activeAssessments
      .filter(a => !q || (a.title || '').toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const rec = [];
    const rest = [];
    for (const a of list) (selectedRoles.some(r => fitsRole(a, r)) ? rec : rest).push(a);
    return { recommended: rec, others: rest };
  }, [activeAssessments, assessSearch, selectedRoles]);

  const statusFor = (userId) => {
    if (!firstPicked) return null;
    return (firstPicked.employeeAssignments || []).find(ea => ea.userId === userId) || null;
  };

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter(e => e.status !== 'inactive' && e.status !== 'blocked')
      .filter(e => !q || [e.name, e.employeeId, e.email, e.department, e.jobRole, e.phone]
        .some(v => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [employees, search]);

  const isSelectable = (e) => {
    if (pickedIds.size !== 1) return true;
    return !(statusFor(e.userId)?.status === 'submitted' && !retake);
  };

  const toggleEmployee = (e) => {
    const next = new Set(selected);
    if (next.has(e.userId)) { next.delete(e.userId); setSelected(next); return; }
    next.add(e.userId);
    setSelected(next);
    // Employee-first shortcut: nothing chosen yet, so tick the best-fitting
    // assessment for this job role. The admin can still change it.
    if (!fixedAssessment && pickedIds.size === 0 && e.jobRole) {
      const fit = activeAssessments
        .filter(a => fitsRole(a, e.jobRole))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      if (fit) setPickedIds(new Set([fit.id]));
    }
  };

  const toggleAssessment = (id) => {
    if (fixedAssessment) return;
    setPickedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
    if (pickedList.length === 0) { setError('Select at least one assessment'); return; }
    setSubmitting(true);
    const out = [];
    // One call per assessment, in order, so each assessment reports its own outcome.
    for (const a of pickedList) {
      try {
        const data = await authFetch(`/api/assessments/${a.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ userIds: [...selected], startDate: win.startDate, endDate: win.endDate, retake, notify }),
        });
        out.push({ id: a.id, title: a.title, ok: true, data });
      } catch (e) {
        out.push({ id: a.id, title: a.title, ok: false, error: e.message || 'Could not assign this assessment' });
      }
    }
    setSubmitting(false);
    setResults({ rows: out, startAt: win.startDate, dueAt: win.endDate });
    const done = out.filter(r => r.ok);
    const n = done.reduce((s, r) => s + (r.data?.added?.length || 0) + (r.data?.reassigned?.length || 0), 0);
    if (done.length) {
      showToast?.(`Assigned: ${n} assignment${n === 1 ? '' : 's'} saved`, 'success');
      for (const r of done) await onDone?.(r.id);
    } else {
      showToast?.('Nothing was assigned', 'error');
    }
  };

  const nameOf = (id) => employees.find(e => e.userId === id)?.name || id;

  // Result summary: one block per assessment
  if (results) {
    return (
      <Shell title="Assignment result" subtitle={`${selected.size} employee${selected.size === 1 ? '' : 's'} · ${results.rows.length} assessment${results.rows.length === 1 ? '' : 's'}`} onClose={onClose}>
        <div className="p-6 space-y-3">
          {results.rows.map(r => (
            <div key={r.id} className={`rounded-xl border p-3 ${r.ok ? 'border-slate-700/60 bg-slate-800/30' : 'border-red-500/30 bg-red-500/5'}`}>
              <p className="text-sm font-bold text-white break-words">{r.title}</p>
              {!r.ok ? <p className="text-xs text-red-300 mt-1">Not assigned: {r.error}</p> : (
                <div className="mt-1 space-y-1">
                  {r.data.added?.length > 0 && <p className="text-xs text-emerald-300 break-words">Added: {r.data.added.map(x => x.name || nameOf(x.userId)).join(', ')}</p>}
                  {r.data.reassigned?.length > 0 && <p className="text-xs text-indigo-300 break-words">Given again (new attempt): {r.data.reassigned.map(x => x.name || nameOf(x.userId)).join(', ')}</p>}
                  {r.data.skipped?.map((s, i) => <p key={i} className="text-xs text-amber-300 break-words">Skipped {s.name || nameOf(s.userId)}: {s.reason}</p>)}
                  {!r.data.added?.length && !r.data.reassigned?.length && !r.data.skipped?.length && <p className="text-xs text-slate-400">No changes.</p>}
                </div>
              )}
            </div>
          ))}
          <p className="text-xs text-slate-400">Window: {fmt(results.startAt)} to {fmt(results.dueAt)}{notify ? ' · employees were emailed where email is set up' : ''}</p>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white">Done</button>
          </div>
        </div>
      </Shell>
    );
  }

  const assessRow = (a, isRec) => {
    const on = pickedIds.has(a.id);
    return (
      <label key={a.id} className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer ${on ? 'bg-indigo-500/10' : 'hover:bg-slate-800/50'}`}>
        <input type="checkbox" checked={on} onChange={() => toggleAssessment(a.id)} className="accent-indigo-500 mt-1" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate" title={a.title}>{a.title}</p>
          <p className="text-xs text-slate-500 truncate">{(a.employeeAssignments || []).length} assigned · {a.questionCount ?? '-'} questions</p>
        </div>
        {isRec ? <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">Fits role</span> : null}
      </label>
    );
  };

  return (
    <Shell wide title={fixedAssessment ? 'Assign employees' : 'Assign an assessment'}
      subtitle={fixedAssessment ? fixedAssessment.title : 'Pick the employees on the left and the assessment(s) on the right'} onClose={onClose}>
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          {/* Employees */}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-2 gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">1. Employees</label>
              <div className="flex items-center gap-3 text-xs shrink-0">
                <button onClick={selectAllShown} className="font-semibold text-indigo-300 hover:text-indigo-200">Select all shown</button>
                <button onClick={() => setSelected(new Set())} className="font-semibold text-slate-400 hover:text-white">Clear</button>
              </div>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, employee ID, email, department, job role"
              className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
            <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-700/50 divide-y divide-slate-700/30">
              {candidates.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">No employees match.</p>
              ) : candidates.map(e => {
                const ea = statusFor(e.userId);
                const done = ea?.status === 'submitted';
                const disabled = !isSelectable(e);
                const sub = [e.employeeId, e.jobRole, e.department, e.email].filter(Boolean).join(' · ');
                return (
                  <label key={e.userId} className={`flex items-center gap-3 px-3 py-2 ${disabled ? 'opacity-50' : 'hover:bg-slate-800/50 cursor-pointer'}`}>
                    <input type="checkbox" checked={selected.has(e.userId)} disabled={disabled} onChange={() => toggleEmployee(e)} className="accent-indigo-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate" title={e.name}>{e.name}</p>
                      <p className="text-xs text-slate-500 truncate" title={sub}>{sub}</p>
                    </div>
                    {ea ? (
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${done ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'}`}>
                        {done ? 'Completed' : 'Assigned'}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{selected.size} selected</p>
          </div>

          {/* Assessments */}
          <div className="min-w-0">
            <div className="flex items-center justify-between mb-2 gap-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">2. Assessment{fixedAssessment ? '' : '(s)'}</label>
              {!fixedAssessment && pickedIds.size > 0 ? <button onClick={() => setPickedIds(new Set())} className="text-xs font-semibold text-slate-400 hover:text-white shrink-0">Clear</button> : null}
            </div>
            {fixedAssessment ? (
              <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3">
                <p className="text-sm font-bold text-white break-words">{fixedAssessment.title}</p>
                <p className="text-xs text-slate-400 mt-1">{(fixedAssessment.employeeAssignments || []).length} assigned · {fixedAssessment.questionCount ?? '-'} questions · same questions for everyone</p>
              </div>
            ) : (
              <>
                <input value={assessSearch} onChange={e => setAssessSearch(e.target.value)} placeholder="Search assessments by title"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
                <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-700/50">
                  {recommended.length + others.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center">No existing assessments found.</p>
                  ) : (
                    <>
                      {recommended.length > 0 && (
                        <div>
                          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/5 border-b border-slate-700/40 truncate" title={selectedRoles.join(', ')}>Recommended for this job role ({selectedRoles.join(', ')})</p>
                          <div className="divide-y divide-slate-700/30">{recommended.map(a => assessRow(a, true))}</div>
                        </div>
                      )}
                      {others.length > 0 && (
                        <div>
                          {recommended.length > 0 && <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-800/40 border-y border-slate-700/40">All assessments</p>}
                          <div className="divide-y divide-slate-700/30">{others.map(a => assessRow(a, false))}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1.5">{pickedIds.size} selected{pickedIds.size > 1 ? ' · each one is assigned in turn and reported separately' : ''}</p>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">3. Start and end</p>
          <DateFields start={start} end={end} onStart={setStart} onEnd={setEnd} />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={retake} onChange={e => { setRetake(e.target.checked); if (!e.target.checked && pickedIds.size === 1) setSelected(prev => new Set([...prev].filter(id => statusFor(id)?.status !== 'submitted'))); }} className="accent-indigo-500" />
            Let employees who already completed it take it again (their earlier result stays on record)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="accent-indigo-500" />
            Email the employees about this assignment
          </label>
          <p className="text-[11px] text-slate-500">Everyone gets the same questions as the rest of that assessment. Each attempt is timed at 60 minutes. An employee who was deleted from an assessment is added back only by assigning here.</p>
        </div>

        {error ? <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-slate-300">Cancel</button>
          <button onClick={submit} disabled={submitting || selected.size === 0 || pickedIds.size === 0}
            className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white">
            {submitting ? 'Assigning...' : `Assign ${selected.size} employee${selected.size === 1 ? '' : 's'} to ${pickedIds.size} assessment${pickedIds.size === 1 ? '' : 's'}`}
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
