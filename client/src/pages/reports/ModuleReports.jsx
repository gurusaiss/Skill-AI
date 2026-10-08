import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../../utils/authFetch.js';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import StatCard from '../../components/StatCard.jsx';
import TabBar from '../../components/TabBar.jsx';
import ActionMenu from '../../components/ActionMenu.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';

const BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');
const DASH = '—';
const TZ = 'Asia/Kolkata';

const RATING_STYLE = {
  Expert: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  Intermediate: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  Basic: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'No Rating': 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};
const RESULT_STYLE = {
  Correct: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  Wrong: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  'Not answered': 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};
const STATUS_CHIPS = [
  { key: 'completed', label: 'Completed' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'not_started', label: 'Not started' },
  { key: 'all', label: 'All' },
];

const fmtDate = (v, time = false) => {
  if (!v) return DASH;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}) });
};
const fmtSec = (s) => {
  if (s === null || s === undefined || !Number.isFinite(Number(s))) return DASH;
  const n = Number(s);
  if (n < 60) return `${Math.round(n)} sec`;
  const m = Math.round(n / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? DASH : `${Math.round(Number(v) * 10) / 10}%`);
const show = (v) => (v === null || v === undefined || v === '' ? DASH : v);

function RatingChip({ rating }) {
  if (!rating) return <span className="text-slate-500 text-sm">{DASH}</span>;
  return <span className={`inline-block max-w-full truncate px-2.5 py-1 rounded-full border text-xs font-bold ${RATING_STYLE[rating] || RATING_STYLE['No Rating']}`}>{rating}</span>;
}

async function downloadFile(path, fallbackName) {
  const token = localStorage.getItem('auth_token');
  const activeRole = localStorage.getItem('active_role');
  const res = await fetch(`${BASE_URL}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(activeRole ? { 'X-Active-Role': activeRole } : {}) } });
  if (!res.ok) {
    let msg = 'Download failed';
    try { const j = await res.json(); msg = j?.error?.message || (typeof j?.error === 'string' ? j.error : msg); } catch { /* keep default */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function FormatButtons({ onPick, busy, formats = ['xlsx', 'pdf', 'docx'], disabled, size = 'md', label: menuLabel = 'Download' }) {
  const label = { xlsx: 'Excel (.xlsx)', pdf: 'PDF (.pdf)', docx: 'Word (.docx)', zip: 'ZIP of all files (.zip)' };
  return (
    <ActionMenu
      label={busy ? 'Preparing…' : menuLabel}
      size={size}
      variant="secondary"
      items={formats.map(f => ({ label: label[f] || f, disabled: disabled || !!busy, onClick: () => onPick(f) }))}
    />
  );
}

// ─── Detail drawer ───────────────────────────────────────────────────────────
function DetailDrawer({ row, onClose, canDownload }) {
  const { notify } = useNotification();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('days');
  const [qFilter, setQFilter] = useState('all');
  const [latestOnly, setLatestOnly] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let live = true;
    setRecord(null); setError('');
    authFetch(`/api/reports/modules/${encodeURIComponent(row.assignmentId)}`)
      .then(d => { if (live) setRecord(d?.record || null); })
      .catch(e => { if (live) setError(e.message || 'Could not load this report'); });
    return () => { live = false; };
  }, [row.assignmentId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async (format) => {
    setBusy(format);
    try {
      await downloadFile(`/api/reports/modules/${encodeURIComponent(row.assignmentId)}/download?format=${format}`, `Module-Report.${format}`);
      notify('Report downloaded', 'success');
    } catch (e) { notify(e.message || 'Download failed', 'error'); } finally { setBusy(null); }
  };

  const r = record || row;
  const questions = useMemo(() => {
    const list = record?.questions || [];
    return list.filter(q => (qFilter === 'all' || q.result === qFilter) && (!latestOnly || q.isLatest));
  }, [record, qFilter, latestOnly]);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const q of questions) { if (!m.has(q.day)) m.set(q.day, { title: q.dayTitle, items: [] }); m.get(q.day).items.push(q); }
    return [...m.entries()];
  }, [questions]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Module engagement review">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-3xl h-full bg-[#0F172A] border-l border-slate-700 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-[#0F172A]/95 backdrop-blur border-b border-slate-800 px-5 py-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-black text-white truncate" title={r.name}>{show(r.name)} <span className="text-slate-400 font-semibold text-sm">{r.employeeId ? `(${r.employeeId})` : ''}</span></p>
            <p className="text-sm text-slate-300 truncate" title={r.moduleTitle}>{show(r.moduleTitle)}</p>
            <p className="text-sm text-slate-400 truncate">{[r.jobRole, r.department, r.managerName ? `Manager: ${r.managerName}` : ''].filter(Boolean).join('  |  ') || DASH}</p>
          </div>
          <RatingChip rating={r.rating} />
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-sm font-semibold">Close</button>
        </div>

        <div className="p-5 space-y-5">
          {error ? <p className="text-rose-300 text-sm">{error}</p> : null}
          {!record && !error ? <p className="text-slate-400 text-sm">Loading the full engagement record{DASH}</p> : null}

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <StatCard label="Score" value={fmtPct(r.scorePct)} description={r.questionsTotal ? `${r.correct} of ${r.questionsTotal} correct` : 'No quiz answers saved'} tooltip="Correct answers divided by all questions, using each day's latest quiz attempt." />
            <StatCard label="Days completed" value={`${show(r.daysCompleted)} / ${show(r.daysTotal)}`} description={`Progress ${fmtPct(r.progressPct)}`} tooltip="Days of the module whose quiz was submitted, out of all days in the module." />
            <StatCard label="Time spent" value={fmtSec(r.timeSpentSec)} description="Active time in the module" tooltip="Seconds the module page was open and visible. Shown as a dash for work done before time tracking existed." />
            <StatCard label="Questions" value={show(r.questionsTotal)} description={r.questionsTotal ? `${r.wrong} wrong, ${r.skipped} not answered` : 'None recorded'} tooltip="Questions in each day's latest attempt. Earlier attempts are listed in the review but not counted in the score." />
          </div>

          <div className="text-sm text-slate-400 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <span>Assigned: <b className="text-slate-200">{fmtDate(r.assignedAt, true)}</b></span>
            <span>Started: <b className="text-slate-200">{fmtDate(r.startedAt, true)}</b></span>
            <span>Completed: <b className="text-slate-200">{fmtDate(r.completedAt, true)}</b></span>
          </div>

          {canDownload ? <div><p className="text-sm uppercase tracking-wider text-slate-400 font-bold mb-2">Download this report</p><FormatButtons onPick={download} busy={busy} /></div> : null}

          {record && !record.hasDetail ? (
            <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">Answers for this module were not saved (it was completed before answer capture was added), so only progress and dates are available.</p>
          ) : null}

          {record ? (
            <>
              <TabBar variant="underline" active={tab} onChange={setTab} tabs={[
                { key: 'days', label: 'Day-wise' }, { key: 'questions', label: 'Questions', badge: record.questions.length || undefined },
                { key: 'skills', label: 'Skills' }, { key: 'timeline', label: 'Timeline' },
              ]} />

              {tab === 'days' ? (
                <div className="space-y-3">
                  {record.days.length === 0 ? <p className="text-slate-400 text-sm">No days recorded.</p> : record.days.map(d => (
                    <div key={d.index} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <p className="font-bold text-white min-w-0 break-words">Day {d.day}: {d.title}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${d.status === 'Completed' ? RESULT_STYLE.Correct : RESULT_STYLE['Not answered']}`}>{d.status}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-400">
                        <span>Started<br /><b className="text-slate-200">{fmtDate(d.startedAt, true)}</b></span>
                        <span>Completed<br /><b className="text-slate-200">{fmtDate(d.completedAt, true)}</b></span>
                        <span>Time<br /><b className="text-slate-200">{fmtSec(d.timeSpentSec)}</b></span>
                        <span>Score<br /><b className="text-slate-200">{fmtPct(d.scorePct)}{d.total ? ` (${d.correct}/${d.total})` : ''}</b></span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400 break-words">
                        <span className="text-slate-500">{d.sectionsTracked ? 'Sections opened: ' : 'Sections in this day: '}</span>
                        {d.sections.length ? d.sections.map(s => s.title).join('; ') : 'not recorded'}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">Quiz attempts: {show(d.attempts || null)}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === 'questions' ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {['all', 'Correct', 'Wrong', 'Not answered'].map(f => (
                      <button key={f} onClick={() => setQFilter(f)}
                        className={`px-4 py-2 rounded-full text-sm font-semibold border ${qFilter === f ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}>
                        {f === 'all' ? 'All' : f}
                      </button>
                    ))}
                    <label className="ml-auto flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={latestOnly} onChange={e => setLatestOnly(e.target.checked)} /> Latest attempt only
                    </label>
                  </div>
                  {byDay.length === 0 ? <p className="text-slate-400 text-sm">No questions to show.</p> : byDay.map(([day, g]) => (
                    <div key={day} className="space-y-2">
                      <p className="text-sm font-bold text-indigo-300 break-words">Day {day}: {g.title}</p>
                      {g.items.map((q, i) => (
                        <div key={`${day}-${q.attempt}-${q.no}-${i}`} className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <b className="text-slate-200">Q{q.no}</b>
                            {q.section ? <span className="truncate max-w-[50%]" title={q.section}>{q.section}</span> : null}
                            <span>Attempt {q.attempt}{q.isLatest ? '' : ' (earlier)'}</span>
                            <span>{q.answeredAt ? fmtDate(q.answeredAt, true) : ''}</span>
                            <span className={`ml-auto px-2 py-0.5 rounded-full border font-bold ${RESULT_STYLE[q.result]}`}>{q.result}</span>
                          </div>
                          <p className="mt-1.5 text-sm font-semibold text-white break-words">{q.question}</p>
                          <p className="mt-1 text-sm break-words"><span className="text-slate-500">Employee answer: </span><span className={q.result === 'Correct' ? 'text-emerald-300' : q.result === 'Wrong' ? 'text-rose-300' : 'text-slate-400'}>{q.userAnswer || 'Not answered'}</span></p>
                          <p className="text-sm break-words"><span className="text-slate-500">Correct answer: </span><span className="text-slate-200">{show(q.correctAnswer)}</span></p>
                          {q.explanation ? <p className="mt-1 text-xs text-slate-400 break-words">{q.explanation}</p> : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === 'skills' ? (
                <div className="space-y-3">
                  {record.skills.length === 0 ? <p className="text-slate-400 text-sm">No skill data (no answers saved).</p> : (
                    <div className="space-y-2">
                      {record.skills.map(s => (
                        <div key={s.skill} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center rounded-lg bg-slate-800/40 border border-slate-700/60 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm text-white truncate" title={s.skill}>{s.skill}</p>
                            <div className="h-1.5 rounded bg-slate-700 mt-1.5"><div className={`h-1.5 rounded ${s.pct >= 70 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, s.pct)}%` }} /></div>
                          </div>
                          <p className="text-sm font-bold text-slate-200">{fmtPct(s.pct)} <span className="text-sm text-slate-400 font-normal">({s.correct}/{s.total})</span></p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-emerald-300 break-words"><b>Strengths:</b> {record.strengths.join('; ') || 'none yet'}</p>
                  <p className="text-sm text-rose-300 break-words"><b>Needs improvement:</b> {record.needsImprovement.join('; ') || 'nothing flagged'}</p>
                  {record.missed.length ? <p className="text-xs text-slate-400 break-words"><b>Questions to revisit:</b> {record.missed.join('  /  ')}</p> : null}
                </div>
              ) : null}

              {tab === 'timeline' ? (
                <ol className="space-y-2">
                  {record.timeline.length === 0 ? <li className="text-slate-400 text-sm">No dated events recorded.</li> : record.timeline.map((t, i) => (
                    <li key={i} className="flex gap-3 text-sm"><span className="text-slate-400 w-44 flex-shrink-0">{fmtDate(t.at, true)}</span><span className="text-slate-200 min-w-0 break-words">{t.event}</span></li>
                  ))}
                </ol>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Main section ────────────────────────────────────────────────────────────
export default function ModuleReports() {
  const { hasFeaturePermission } = useAuth();
  const { notify } = useNotification();
  const canExport = !hasFeaturePermission || hasFeaturePermission('reports.export');
  const canDownload = !hasFeaturePermission || hasFeaturePermission('reports.download');

  const [status, setStatus] = useState('completed');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [employee, setEmployee] = useState('all');
  const [moduleId, setModuleId] = useState('all');
  const [jobRole, setJobRole] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState({ rows: [], total: 0, summary: null, options: { employees: [], modules: [], jobRoles: [] } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(null);
  const optionsRef = useRef(data.options);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setOffset(0); }, [status, debounced, employee, moduleId, jobRole, from, to, limit]);

  const query = useCallback((extra = {}) => {
    const p = new URLSearchParams({ status });
    if (debounced) p.set('q', debounced);
    if (employee !== 'all') p.set('userId', employee);
    if (moduleId !== 'all') p.set('moduleId', moduleId);
    if (jobRole !== 'all') p.set('jobRole', jobRole);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    Object.entries(extra).forEach(([k, v]) => p.set(k, String(v)));
    return p.toString();
  }, [status, debounced, employee, moduleId, jobRole, from, to]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    authFetch(`/api/reports/modules?${query({ limit, offset })}`)
      .then(d => { if (!live) return; setData(d); optionsRef.current = d.options; })
      .catch(e => { if (live) setError(e.message || 'Could not load module reports'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, limit, offset, reloadKey]);

  const exportAll = async (format) => {
    setBusy(format);
    try { await downloadFile(`/api/reports/modules/export?${query({ format })}`, `Module-Report.${format}`); notify('Report downloaded', 'success'); }
    catch (e) { notify(e.message || 'Export failed', 'error'); } finally { setBusy(null); }
  };
  const downloadRow = async (row, format) => {
    try { await downloadFile(`/api/reports/modules/${encodeURIComponent(row.assignmentId)}/download?format=${format}`, `Module-Report.${format}`); notify('Report downloaded', 'success'); }
    catch (e) { notify(e.message || 'Download failed', 'error'); }
  };

  const reset = () => { setStatus('completed'); setSearch(''); setEmployee('all'); setModuleId('all'); setJobRole('all'); setFrom(''); setTo(''); };
  const { rows, total, summary } = data;
  const opts = data.options || optionsRef.current || {};
  const ratings = summary?.ratings || {};
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  const COLS = 'minmax(0,1.6fr) minmax(0,1.7fr) minmax(0,1fr) minmax(0,.6fr) minmax(0,.9fr) minmax(0,.7fr) minmax(0,1fr)';
  const inputCls = 'w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-base text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500';

  return (
    <PageContainer className="min-h-screen bg-[#0F172A] text-white">
      <PageHeader title="Module Reports" subtitle="Every module an employee has worked on: day-wise, section-wise, with each question answered, right or wrong. Review it here or download it." />

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
        <StatCard label="Completed modules" value={show(summary?.completed)} description="Modules finished by the people listed" tooltip="Employee and module pairs where every day was completed, among the rows matching your filters." />
        <StatCard label="Employees" value={show(summary?.employees)} description="Distinct people in these results" tooltip="Number of different employees among the rows matching your filters." />
        <StatCard label="Average score" value={fmtPct(summary?.avgScore)} description="Across rows that have answers" tooltip="Mean of each row's score, where the score is correct answers divided by questions (latest attempt of each day)." />
        <StatCard label="Ratings" value={`${(ratings.Expert || 0) + (ratings.Intermediate || 0) + (ratings.Basic || 0) + (ratings['No Rating'] || 0)}`}
          sub={`Expert ${ratings.Expert || 0} | Intermediate ${ratings.Intermediate || 0} | Basic ${ratings.Basic || 0} | No Rating ${ratings['No Rating'] || 0}`}
          description="Rated rows by level" tooltip="Expert 90 and above, Intermediate 80 to 89.99, Basic 70 to 79.99, No Rating below 70. Based on the unrounded score." />
        <StatCard label="Total time" value={fmtSec(summary?.totalTimeSec)} description="Active learning time" tooltip="Sum of tracked time. Modules worked on before time tracking was added contribute nothing." />
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5 mb-5 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          {STATUS_CHIPS.map(c => (
            <button key={c.key} onClick={() => setStatus(c.key)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${status === c.key ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}>{c.label}</button>
          ))}
          <button onClick={reset} className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white border border-slate-700">Reset filters</button>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by employee, ID, email or module" className={inputCls} />
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
          <SearchableSelect value={employee} onChange={setEmployee} allLabel="All employees" placeholder="Employee" options={(opts.employees || []).map(e => ({ value: e.userId, label: `${e.name}${e.employeeId ? ` (${e.employeeId})` : ''}` }))} />
          <SearchableSelect value={moduleId} onChange={setModuleId} allLabel="All modules" placeholder="Module" options={(opts.modules || []).map(m => ({ value: m.id, label: m.title }))} />
          <SearchableSelect value={jobRole} onChange={setJobRole} allLabel="All job roles" placeholder="Job role" options={opts.jobRoles || []} />
          <label className="text-sm text-slate-400">Completed from<input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${inputCls} mt-1`} /></label>
          <label className="text-sm text-slate-400">Completed to<input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${inputCls} mt-1`} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <p className="text-sm text-slate-300 font-semibold">Export all {total} matching records:</p>
          <FormatButtons label="Export all" formats={['xlsx', 'pdf', 'docx', 'zip']} onPick={exportAll} busy={busy} disabled={!canExport || total === 0} />
          {!canExport ? <span className="text-sm text-slate-400">You do not have permission to export reports.</span> : null}
        </div>
      </div>

      {error ? <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"><span className="min-w-0 flex-1">{error}</span><button onClick={() => setReloadKey(k => k + 1)} className="px-4 py-2 rounded-lg border border-rose-500/40 font-semibold hover:bg-rose-500/20">Retry</button></div> : null}

      <div className="rounded-2xl border border-slate-700/40 bg-slate-900/60">
        <div className="hidden lg:grid gap-3 px-4 py-3 border-b border-slate-700/40 text-sm font-bold uppercase tracking-wider text-slate-400 grid-stack-lg" style={{ gridTemplateColumns: COLS }}>
          <span>Employee</span><span>Module</span><span>Completed</span><span>Days</span><span>Time</span><span>Score</span><span>Rating</span>
        </div>
        {loading && rows.length === 0 ? <p className="p-6 text-slate-400 text-sm">Loading{DASH}</p> : null}
        {!loading && rows.length === 0 && !error ? <p className="p-6 text-slate-400 text-sm">No module records match these filters. Try the "All" status chip or widen the date range.</p> : null}
        {rows.map(r => (
          <div key={r.assignmentId} role="button" tabIndex={0} onClick={() => setSelected(r)} onKeyDown={e => { if (e.key === 'Enter') setSelected(r); }}
            className="grid gap-x-3 gap-y-2 px-4 py-3 border-b border-slate-800/70 last:border-0 hover:bg-slate-800/50 cursor-pointer grid-stack-lg items-center"
            style={{ gridTemplateColumns: COLS }}>
            <div className="min-w-0">
              <p className="text-base font-semibold text-white truncate" title={r.name}>{show(r.name)}</p>
              <p className="text-sm text-slate-400 truncate" title={`${r.employeeId} ${r.jobRole}`}>{[r.employeeId, r.jobRole].filter(Boolean).join('  |  ') || DASH}</p>
            </div>
            <div className="min-w-0">
              <p className="text-base text-slate-200 truncate" title={r.moduleTitle}>{show(r.moduleTitle)}</p>
              <p className="text-sm text-slate-400 truncate" title={r.managerName}>{[r.department, r.managerName ? `Mgr: ${r.managerName}` : ''].filter(Boolean).join('  |  ') || r.status}</p>
            </div>
            <div className="min-w-0 text-sm text-slate-300"><span className="lg:hidden text-sm text-slate-400">Completed: </span>{fmtDate(r.completedAt)}</div>
            <div className="min-w-0 text-sm text-slate-300"><span className="lg:hidden text-sm text-slate-400">Days: </span>{show(r.daysCompleted)}/{show(r.daysTotal)}</div>
            <div className="min-w-0 text-sm text-slate-300 truncate"><span className="lg:hidden text-sm text-slate-400">Time: </span>{fmtSec(r.timeSpentSec)}</div>
            <div className="min-w-0 text-sm font-bold text-white"><span className="lg:hidden text-sm text-slate-400 font-normal">Score: </span>{fmtPct(r.scorePct)}</div>
            <div className="min-w-0"><RatingChip rating={r.rating} /></div>
            <div className="col-span-full flex flex-wrap items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={(e) => { e.stopPropagation(); setSelected(r); }} className="px-4 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/40 text-sm font-semibold">Review answers</button>
              {canDownload ? <FormatButtons size="sm" label="Download report" onPick={(f) => downloadRow(r, f)} /> : null}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-700/40 text-sm text-slate-400">
          <span>{total === 0 ? '0 records' : `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`}</span>
          <label className="flex items-center gap-2">Rows
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm">
              {[25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white disabled:opacity-40">Previous</button>
            <span>Page {page} of {pages}</span>
            <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {selected ? <DetailDrawer row={selected} onClose={() => setSelected(null)} canDownload={canDownload} /> : null}
    </PageContainer>
  );
}
