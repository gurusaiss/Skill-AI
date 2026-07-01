import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { authFetch } from '../../utils/authFetch.js';

// ── tiny helpers ──────────────────────────────────────────────────────────────
const toast = (msg, type = 'success') => {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;color:#fff;background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};box-shadow:0 4px 12px rgba(0,0,0,.3);`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

const inputCls = 'w-full bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

// ── CSV template ──────────────────────────────────────────────────────────────
const TEMPLATE_CSV = `role_name,department,job_description,skills,status
Frontend Developer,Engineering,"Responsible for building user interfaces using React and modern web technologies.","React,JavaScript,CSS,HTML",active
Backend Developer,Engineering,"Design and implement server-side APIs and database logic.","Node.js,PostgreSQL,REST API",active
Product Manager,Product,"Define product vision and work with cross-functional teams.","Roadmapping,Agile,Communication",active`;

// ── Role form modal ────────────────────────────────────────────────────────────
function RoleModal({ role, onClose, onSaved }) {
  const [form, setForm] = useState({
    roleName:       role?.roleName       || '',
    department:     role?.department     || '',
    jobDescription: role?.jobDescription || '',
    skills:         (role?.skills || []).join(', '),
    status:         role?.status         || 'active',
  });
  const [checklist, setChecklist] = useState(role?.onboardingChecklist || []);
  const [newItem, setNewItem] = useState({ title: '', description: '', dueDay: '' });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details'); // 'details' | 'checklist'
  const [jdUploading, setJdUploading] = useState(false);
  const jdFileRef = useRef();
  const isEdit = !!role;

  const handleJdFileUpload = async (file) => {
    if (!file) return;
    setJdUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/roles/parse-jd', { method: 'POST', body: fd });
      const extracted = res?.data?.text ?? res?.text ?? '';
      if (!extracted) throw new Error('No text extracted from file');
      setForm(p => ({ ...p, jobDescription: extracted }));
      toast(`Extracted ${extracted.length.toLocaleString()} chars from ${file.name}`);
    } catch (e) {
      toast(e.message || 'Failed to extract text', 'error');
    } finally {
      setJdUploading(false);
      if (jdFileRef.current) jdFileRef.current.value = '';
    }
  };

  const f = key => e => setForm(p => ({ ...p, [key]: e.target.value }));

  const addChecklistItem = () => {
    if (!newItem.title.trim()) return;
    setChecklist(p => [...p, { title: newItem.title.trim(), description: newItem.description.trim(), dueDay: newItem.dueDay ? parseInt(newItem.dueDay) : null }]);
    setNewItem({ title: '', description: '', dueDay: '' });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.roleName.trim()) return toast('Role name is required', 'error');
    setSaving(true);
    try {
      const payload = {
        roleName:            form.roleName.trim(),
        department:          form.department.trim(),
        jobDescription:      form.jobDescription.trim(),
        skills:              form.skills.split(/[,;|]/).map(s => s.trim()).filter(Boolean),
        status:              form.status,
        onboardingChecklist: checklist,
      };
      const res = isEdit
        ? await authFetch(`/api/roles/${role.id}`, { method: 'PUT',    body: JSON.stringify(payload) })
        : await authFetch('/api/roles',              { method: 'POST',   body: JSON.stringify(payload) });
      toast(isEdit ? 'Role updated' : 'Role created');
      onSaved(res?.data ?? res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">{isEdit ? 'Edit Role' : 'Add New Role'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-700 pb-3">
            {['details', 'checklist'].map(t => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded text-xs font-semibold capitalize ${tab === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {t === 'checklist' ? `Onboarding Checklist (${checklist.length})` : 'Role Details'}
              </button>
            ))}
          </div>

          {tab === 'details' && (<>
          <div>
            <label className={labelCls}>Role Name *</label>
            <input className={inputCls} value={form.roleName} onChange={f('roleName')} placeholder="e.g. Senior Frontend Developer" required />
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <input className={inputCls} value={form.department} onChange={f('department')} placeholder="e.g. Engineering" />
          </div>
          <div>
            <label className={labelCls}>Skills <span className="text-slate-500">(comma-separated)</span></label>
            <input className={inputCls} value={form.skills} onChange={f('skills')} placeholder="React, JavaScript, REST APIs" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={inputCls} value={form.status} onChange={f('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls} style={{marginBottom:0}}>Job Description</label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{form.jobDescription.length.toLocaleString()} chars</span>
                <button
                  type="button"
                  onClick={() => jdFileRef.current?.click()}
                  disabled={jdUploading}
                  className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40 disabled:opacity-50 transition-colors"
                >
                  {jdUploading ? '⏳ Extracting…' : '📎 Upload JD File'}
                </button>
                <input
                  ref={jdFileRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.rtf"
                  className="hidden"
                  onChange={e => handleJdFileUpload(e.target.files[0])}
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mb-1">Upload PDF, DOC, DOCX, TXT or paste text directly below</p>
            <textarea className={inputCls} rows={7} value={form.jobDescription} onChange={f('jobDescription')} placeholder="Paste the full job description here, or upload a file above..." />
          </div>
          </>)}

          {tab === 'checklist' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">Define onboarding tasks for new employees assigned this role. When an employee is assigned this role, these tasks are automatically created for them.</p>
              {checklist.length === 0 && <p className="text-xs text-slate-600 py-2">No checklist items yet.</p>}
              {checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-2 bg-[#0F172A] rounded-lg p-3 border border-slate-700">
                  <div className="flex-1">
                    <p className="text-sm text-white font-medium">{item.title}</p>
                    {item.description && <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>}
                    {item.dueDay && <p className="text-xs text-indigo-400 mt-0.5">Due: Day {item.dueDay}</p>}
                  </div>
                  <button type="button" onClick={() => setChecklist(p => p.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 text-xs mt-0.5">✕</button>
                </div>
              ))}
              <div className="bg-[#0F172A] rounded-lg p-3 border border-slate-700 space-y-2">
                <p className="text-xs text-slate-400 font-medium">Add Task</p>
                <input className={inputCls} value={newItem.title} onChange={e => setNewItem(p => ({ ...p, title: e.target.value }))} placeholder="Task title (e.g. Complete security training)" />
                <input className={inputCls} value={newItem.description} onChange={e => setNewItem(p => ({ ...p, description: e.target.value }))} placeholder="Description (optional)" />
                <input className={`${inputCls} w-32`} type="number" min="1" value={newItem.dueDay} onChange={e => setNewItem(p => ({ ...p, dueDay: e.target.value }))} placeholder="Due day #" />
                <button type="button" onClick={addChecklistItem} className="px-3 py-1.5 rounded bg-indigo-600/30 text-indigo-300 text-xs hover:bg-indigo-600/50">+ Add Item</button>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── View modal ────────────────────────────────────────────────────────────────
function ViewModal({ role, onClose, onEdit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">{role.roleName}</h2>
            {role.department && <p className="text-sm text-slate-400">{role.department}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {(role.skills || []).length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">SKILLS</p>
              <div className="flex flex-wrap gap-2">
                {role.skills.map(s => <span key={s} className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">{s}</span>)}
              </div>
            </div>
          )}
          {role.jobDescription && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">JOB DESCRIPTION</p>
              <pre className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-[#0F172A] rounded-lg p-4 border border-slate-700">{role.jobDescription}</pre>
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${role.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border border-slate-600'}`}>{role.status}</span>
            {role.updatedAt && <span className="text-xs text-slate-500 my-auto">Updated {new Date(role.updatedAt).toLocaleDateString()}</span>}
          </div>
          <button onClick={onEdit} className="w-full px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Edit Role</button>
        </div>
      </div>
    </div>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  const handleImport = async () => {
    if (!file) return toast('Select a file first', 'error');
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/roles/import', { method: 'POST', body: fd });
      const r = res?.data ?? res;
      toast(`Imported ${r?.created ?? 0} roles. Skipped ${r?.skipped ?? 0} duplicates.`);
      if ((r?.errors || []).length) console.warn('Import errors:', r.errors);
      onImported();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'role_import_template.csv'; a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Import Roles</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-400">Upload a CSV, XLS, or XLSX file. Duplicate role names are skipped automatically.</p>
          <button onClick={downloadTemplate} className="text-xs text-indigo-400 hover:text-indigo-300 underline">Download CSV template</button>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
          >
            {file ? <p className="text-sm text-emerald-400">{file.name}</p> : <p className="text-sm text-slate-400">Click to select file (CSV / XLS / XLSX)</p>}
            <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={e => setFile(e.target.files[0])} />
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">Cancel</button>
            <button onClick={handleImport} disabled={importing || !file} className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Question Bank Modal ───────────────────────────────────────────────────────
const DIFF_COLORS = { easy: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30', hard: 'bg-red-500/20 text-red-300 border-red-500/30' };
const EMPTY_Q = { type: 'mcq', question: '', difficulty: 'medium', options: ['A) ', 'B) ', 'C) ', 'D) '], answer: 'A', explanation: '', skillArea: '' };
const Q_TYPES = [
  { value: 'mcq',        label: 'Multiple Choice',    icon: '☑️', desc: '4 options, one correct answer' },
  { value: 'fill_blank', label: 'Fill in the Blank',  icon: '✏️', desc: 'One-word or short phrase answer' },
  { value: 'subjective', label: 'Subjective',          icon: '📝', desc: 'Open-ended model answer' },
];

function QuestionBankModal({ role, onClose }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [regenCount, setRegenCount] = useState(50);
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [qTypePicker, setQTypePicker] = useState(false);
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });
  const [diffFilter, setDiffFilter] = useState('all');

  useEffect(() => { loadBank(); }, []);

  const loadBank = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/questions`);
      setQuestions(Array.isArray(res) ? res : (res?.data ?? []));
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleRegen = async () => {
    setRegen(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/regenerate-questions`, { method: 'POST', body: JSON.stringify({ questionCount: regenCount }) });
      setQuestions(res?.data?.questions ?? res?.questions ?? []);
      toast(`Regenerated ${(res?.data?.questions ?? res?.questions ?? []).length} questions`);
      setRegenConfirm(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setRegen(false); }
  };

  const startEdit = (i) => { setEditIdx(i); setEditQ({ ...questions[i] }); };
  const cancelEdit = () => { setEditIdx(null); setEditQ(null); };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const updated = questions.map((q, i) => i === editIdx ? { ...editQ } : q);
      await authFetch(`/api/roles/${role.id}/questions`, { method: 'PUT', body: JSON.stringify({ questions: updated }) });
      setQuestions(updated);
      cancelEdit();
      toast('Question updated');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const deleteQ = async (i) => {
    if (!window.confirm('Delete this question?')) return;
    try {
      const q = questions[i];
      if (q.id) await authFetch(`/api/roles/${role.id}/questions/${q.id}`, { method: 'DELETE' });
      setQuestions(p => p.filter((_, j) => j !== i));
      toast('Question deleted');
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveNewQ = async () => {
    if (!newQ.question.trim()) return toast('Question text required', 'error');
    setSaving(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/questions`, { method: 'POST', body: JSON.stringify(newQ) });
      setQuestions(p => [...p, res?.data ?? res]);
      setNewQ({ ...EMPTY_Q });
      setAddMode(false);
      toast('Question added');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const filtered = diffFilter === 'all' ? questions : questions.filter(q => q.difficulty === diffFilter);
  const counts = useMemo(() => ({ easy: questions.filter(q => q.difficulty === 'easy').length, medium: questions.filter(q => q.difficulty === 'medium').length, hard: questions.filter(q => q.difficulty === 'hard').length }), [questions]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between p-5 border-b border-slate-700">
            <div>
              <h2 className="text-lg font-semibold text-white">Question Bank — {role.roleName}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{questions.length} questions · Easy: {counts.easy} · Medium: {counts.medium} · Hard: {counts.hard}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRegenConfirm(true)}
                disabled={regen || !role.jobDescription || regenConfirm}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/40 disabled:opacity-40 transition-colors"
              >
                {regen ? '⏳ Generating…' : '✨ Regenerate All'}
              </button>
              <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2">✕</button>
            </div>
          </div>

          {/* Inline regenerate confirmation panel */}
          {regenConfirm && (
            <div className="mx-5 my-3 p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl space-y-3">
              <p className="text-sm text-amber-300 font-medium">
                This will replace all {questions.length} existing questions. This cannot be undone.
              </p>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400 whitespace-nowrap">Question count:</label>
                <input
                  type="number"
                  min={20}
                  max={100}
                  value={regenCount}
                  onChange={e => setRegenCount(Math.min(100, Math.max(20, parseInt(e.target.value) || 50)))}
                  className="w-24 bg-[#0F172A] border border-slate-600 text-slate-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                />
                <span className="text-xs text-slate-500">(20–100)</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRegenConfirm(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:border-slate-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegen}
                  disabled={regen}
                  className="px-4 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {regen ? '⏳ Generating…' : 'Confirm Regenerate'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-5 py-3 border-b border-slate-700 flex-shrink-0">
          {['all', 'easy', 'medium', 'hard'].map(d => (
            <button key={d} onClick={() => setDiffFilter(d)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${diffFilter === d ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}>
              {d === 'all' ? `All (${questions.length})` : `${d} (${counts[d] ?? 0})`}
            </button>
          ))}
          <div className="ml-auto relative">
            <button onClick={() => { setQTypePicker(v => !v); setAddMode(false); }} className="text-xs px-3 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40 transition-colors">
              + Add Question
            </button>
            {qTypePicker && (
              <div className="absolute right-0 top-8 z-20 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-56 p-1">
                {Q_TYPES.map(qt => (
                  <button key={qt.value} onClick={() => {
                    const empty = qt.value === 'mcq'
                      ? { ...EMPTY_Q, type: 'mcq' }
                      : qt.value === 'fill_blank'
                      ? { type: 'fill_blank', question: '', difficulty: 'medium', options: [], answer: '', explanation: '', skillArea: '' }
                      : { type: 'subjective', question: '', difficulty: 'medium', options: [], answer: '', explanation: '', skillArea: '' };
                    setNewQ(empty);
                    setAddMode(true);
                    setEditIdx(null);
                    setQTypePicker(false);
                  }} className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-700 transition-colors group">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{qt.icon}</span>
                      <div>
                        <p className="text-sm text-white font-medium">{qt.label}</p>
                        <p className="text-xs text-slate-400">{qt.desc}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {loading && <p className="text-slate-400 text-sm text-center py-8">Loading question bank…</p>}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-10">
              <p className="text-slate-400 text-sm">{questions.length === 0 ? 'No questions yet. Click "Regenerate All" to auto-generate from the JD.' : `No ${diffFilter} questions.`}</p>
            </div>
          )}

          {/* Add new question form */}
          {addMode && (
            <div className="bg-[#0F172A] border border-indigo-500/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">{Q_TYPES.find(t => t.value === newQ.type)?.icon}</span>
                <p className="text-xs font-semibold text-indigo-300">New {Q_TYPES.find(t => t.value === newQ.type)?.label} Question</p>
              </div>
              <textarea rows={3} className={inputCls} value={newQ.question} onChange={e => setNewQ(p => ({ ...p, question: e.target.value }))} placeholder="Question text…" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Difficulty</label>
                  <select className={inputCls} value={newQ.difficulty} onChange={e => setNewQ(p => ({ ...p, difficulty: e.target.value }))}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Skill Area</label>
                  <input className={inputCls} value={newQ.skillArea} onChange={e => setNewQ(p => ({ ...p, skillArea: e.target.value }))} placeholder="e.g. Recruitment" />
                </div>
              </div>
              {newQ.type === 'mcq' && (
                <>
                  {(newQ.options || ['A) ', 'B) ', 'C) ', 'D) ']).map((opt, oi) => (
                    <input key={oi} className={inputCls} value={opt} onChange={e => { const o = [...(newQ.options || ['A) ','B) ','C) ','D) '])]; o[oi] = e.target.value; setNewQ(p => ({ ...p, options: o })); }} placeholder={`Option ${['A','B','C','D'][oi]}`} />
                  ))}
                  <div>
                    <label className={labelCls}>Correct Answer</label>
                    <select className={inputCls} value={newQ.answer || 'A'} onChange={e => setNewQ(p => ({ ...p, answer: e.target.value }))}>
                      {['A','B','C','D'].map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                </>
              )}
              {newQ.type === 'fill_blank' && (
                <div>
                  <label className={labelCls}>Expected Answer <span className="text-slate-500 font-normal">(exact phrase)</span></label>
                  <input className={inputCls} value={newQ.answer || ''} onChange={e => setNewQ(p => ({ ...p, answer: e.target.value }))} placeholder="e.g. agile methodology" />
                </div>
              )}
              {newQ.type === 'subjective' && (
                <div>
                  <label className={labelCls}>Model Answer</label>
                  <textarea rows={3} className={inputCls} value={newQ.answer || ''} onChange={e => setNewQ(p => ({ ...p, answer: e.target.value }))} placeholder="Describe the ideal response…" />
                </div>
              )}
              <textarea rows={2} className={inputCls} value={newQ.explanation} onChange={e => setNewQ(p => ({ ...p, explanation: e.target.value }))} placeholder="Explanation (optional)" />
              <div className="flex gap-2">
                <button onClick={() => { setAddMode(false); setNewQ({ ...EMPTY_Q }); }} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs">Cancel</button>
                <button onClick={saveNewQ} disabled={saving} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">Save</button>
              </div>
            </div>
          )}

          {filtered.map((q, i) => {
            const realIdx = questions.indexOf(q);
            const isEditing = editIdx === realIdx;
            return (
              <div key={q.id || i} className="bg-[#0F172A] border border-slate-700 rounded-xl p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <textarea rows={3} className={inputCls} value={editQ.question} onChange={e => setEditQ(p => ({ ...p, question: e.target.value }))} />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Difficulty</label>
                        <select className={inputCls} value={editQ.difficulty} onChange={e => setEditQ(p => ({ ...p, difficulty: e.target.value }))}>
                          <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>Skill Area</label>
                        <input className={inputCls} value={editQ.skillArea || ''} onChange={e => setEditQ(p => ({ ...p, skillArea: e.target.value }))} />
                      </div>
                    </div>
                    {(editQ.options || []).map((opt, oi) => (
                      <input key={oi} className={inputCls} value={opt} onChange={e => { const o = [...(editQ.options || [])]; o[oi] = e.target.value; setEditQ(p => ({ ...p, options: o })); }} placeholder={`Option ${['A','B','C','D'][oi]}`} />
                    ))}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Correct Answer</label>
                        <select className={inputCls} value={editQ.answer || 'A'} onChange={e => setEditQ(p => ({ ...p, answer: e.target.value }))}>
                          {['A','B','C','D'].map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    <textarea rows={2} className={inputCls} value={editQ.explanation || ''} onChange={e => setEditQ(p => ({ ...p, explanation: e.target.value }))} placeholder="Explanation" />
                    <div className="flex gap-2">
                      <button onClick={cancelEdit} className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 text-xs">Cancel</button>
                      <button onClick={saveEdit} disabled={saving} className="px-4 py-1.5 rounded bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50">Save</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-white font-medium flex-1">{i + 1}. {q.question}</p>
                      <div className="flex gap-1 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded-full text-xs border capitalize ${DIFF_COLORS[q.difficulty] || DIFF_COLORS.medium}`}>{q.difficulty || 'medium'}</span>
                        <button onClick={() => startEdit(realIdx)} className="text-xs px-2 py-1 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40">Edit</button>
                        <button onClick={() => deleteQ(realIdx)} className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40">Del</button>
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
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Approve Assessment Modal ──────────────────────────────────────────────────
function ApproveModal({ role, onClose }) {
  const [questionCount, setQuestionCount] = useState(10);
  const [assessmentDate, setAssessmentDate] = useState('');
  const [approving, setApproving] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    try {
      const payload = { questionCount: parseInt(questionCount) || 10 };
      if (assessmentDate) payload.assessmentDate = new Date(assessmentDate).toISOString();
      const res = await authFetch(`/api/roles/${role.id}/approve-assessment`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const count = res?.employeeCount ?? res?.data?.employeeAssignments?.length ?? 0;
      toast(`Assessment approved & assigned to ${count} employee${count !== 1 ? 's' : ''}`);
      onClose(true);
    } catch (e) {
      toast(e.message || 'Failed to approve assessment', 'error');
    } finally {
      setApproving(false);
    }
  };

  const maxQ = role.questionBankCount || 50;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">Approve & Auto-Assign</h2>
            <p className="text-sm text-slate-400 mt-0.5">{role.roleName}</p>
          </div>
          <button onClick={() => onClose(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <p className="text-xs text-emerald-300">
              This will create an assessment from the <strong>{maxQ}-question bank</strong> and auto-assign it to all employees with the role <strong>"{role.roleName}"</strong>.
            </p>
          </div>
          <div>
            <label className={labelCls}>Questions per employee <span className="text-slate-500">(max {maxQ})</span></label>
            <input
              type="number" min={5} max={maxQ}
              className={inputCls}
              value={questionCount}
              onChange={e => setQuestionCount(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Assessment date <span className="text-slate-500">(optional)</span></label>
            <input
              type="datetime-local"
              className={inputCls}
              value={assessmentDate}
              onChange={e => setAssessmentDate(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => onClose(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">
              Cancel
            </button>
            <button onClick={handleApprove} disabled={approving} className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {approving ? 'Assigning…' : '✓ Approve & Assign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoleLibrary() {
  const [roles, setRoles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [modal, setModal]         = useState(null); // null | {type:'add'|'edit'|'view'|'import', role?}
  const [delId, setDelId]         = useState(null);
  const [qBankRole, setQBankRole] = useState(null); // role to view question bank for
  const [approveRole, setApproveRole] = useState(null); // role to approve assessment for

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/roles');
      setRoles(Array.isArray(res) ? res : res?.data ?? []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async id => {
    try {
      await authFetch(`/api/roles/${id}`, { method: 'DELETE' });
      toast('Role deleted');
      setRoles(p => p.filter(r => r.id !== id));
    } catch (e) { toast(e.message, 'error'); }
    finally { setDelId(null); }
  };

  const filtered = roles.filter(r => {
    if (deptFilter && r.department?.toLowerCase() !== deptFilter.toLowerCase()) return false;
    if (search && !r.roleName?.toLowerCase().includes(search.toLowerCase()) && !r.department?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const departments = [...new Set(roles.map(r => r.department).filter(Boolean))].sort();

  const thCls = 'px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider';

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Role Library</h1>
          <p className="text-sm text-slate-400 mt-0.5">Manage job roles, descriptions, and skills for your company</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal({ type: 'import' })} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-indigo-500 hover:text-indigo-300 transition-colors">
            Import
          </button>
          <button onClick={() => setModal({ type: 'add' })} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
            + Add Role
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search roles…"
          className="flex-1 bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <select
          value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="bg-[#1E293B] border border-slate-700 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Roles', value: roles.length, color: 'text-indigo-400' },
          { label: 'Active', value: roles.filter(r => r.status === 'active').length, color: 'text-emerald-400' },
          { label: 'Departments', value: departments.length, color: 'text-amber-400' },
          { label: 'With JD', value: roles.filter(r => r.jobDescription).length, color: 'text-sky-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#1E293B] border border-slate-700 rounded-lg p-4">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading roles…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            {search || deptFilter ? 'No roles match your filters.' : 'No roles yet. Add your first role or import from CSV.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700">
              <tr>
                <th className={thCls}>Role Name</th>
                <th className={thCls}>Department</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((role, i) => (
                <tr key={role.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${role.assessmentTemplateId ? 'bg-emerald-900/10 border-l-2 border-l-emerald-500/50' : (i % 2 === 0 ? '' : 'bg-slate-800/20')}`}>
                  <td className="px-4 py-3 font-medium text-white">{role.roleName}</td>
                  <td className="px-4 py-3 text-slate-400">{role.department || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold w-fit ${role.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border border-slate-600'}`}>
                        {role.status}
                      </span>
                      {role.assessmentTemplateId && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold w-fit bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          ✓ Assessment Ready
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      <button onClick={() => setModal({ type: 'view', role })} className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600">View</button>
                      <button onClick={() => setModal({ type: 'edit', role })} className="text-xs px-2 py-1 rounded bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50">Edit</button>
                      <button onClick={() => setQBankRole(role)} className="text-xs px-2 py-1 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 whitespace-nowrap">
                        📚 Questions{role.questionBankCount ? ` (${role.questionBankCount})` : ''}
                      </button>
                      {role.questionBankCount > 0 && (
                        <button onClick={() => setApproveRole(role)} className="text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 whitespace-nowrap border border-emerald-500/30">
                          ✓ Approve
                        </button>
                      )}
                      <button onClick={() => setDelId(role.id)} className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <RoleModal
          role={modal.type === 'edit' ? modal.role : null}
          onClose={() => setModal(null)}
          onSaved={saved => {
            setRoles(prev => {
              const idx = prev.findIndex(r => r.id === saved?.id);
              return idx >= 0 ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved];
            });
            setModal(null);
          }}
        />
      )}
      {modal?.type === 'view' && (
        <ViewModal
          role={modal.role}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: 'edit', role: modal.role })}
        />
      )}
      {modal?.type === 'import' && (
        <ImportModal onClose={() => setModal(null)} onImported={() => { setModal(null); load(); }} />
      )}

      {/* Question Bank Modal */}
      {qBankRole && (
        <QuestionBankModal role={qBankRole} onClose={() => setQBankRole(null)} />
      )}

      {/* Approve Assessment Modal */}
      {approveRole && (
        <ApproveModal
          role={approveRole}
          onClose={(approved) => {
            if (approved) {
              setRoles(prev => prev.map(r => r.id === approveRole.id ? { ...r, assessmentTemplateId: 'approved' } : r));
            }
            setApproveRole(null);
          }}
        />
      )}

      {/* Delete confirmation */}
      {delId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[#1E293B] border border-slate-700 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Role?</h3>
            <p className="text-sm text-slate-400 mb-5">This will permanently delete the role and its JD. Existing employees with this role will not be affected.</p>
            <div className="flex gap-3">
              <button onClick={() => setDelId(null)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm">Cancel</button>
              <button onClick={() => handleDelete(delId)} className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
