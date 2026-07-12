import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { authFetch } from '../../utils/authFetch.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import { useNotification } from '../../contexts/NotificationContext.jsx';

const inputCls = 'w-full bg-[#1E293B] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-indigo-500';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

// ── TextPreview — renders a text snippet with optional search highlighting ─────
function TextPreview({ text, searchTerm, maxChars = 500 }) {
  if (!text) return <p className="text-xs text-slate-500 italic">No extracted text available.</p>;

  let display = text;
  let prefix = '';
  let suffix = '';

  if (searchTerm) {
    const lo = text.toLowerCase();
    const loTerm = searchTerm.toLowerCase();
    const idx = lo.indexOf(loTerm);
    if (idx === -1) {
      return (
        <div>
          <p className="text-xs text-amber-400 mb-1">"{searchTerm}" not found in this document.</p>
          <pre className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed font-mono max-h-40 overflow-y-auto">
            {text.slice(0, maxChars)}{text.length > maxChars ? '…' : ''}
          </pre>
        </div>
      );
    }
    const ctx = 180;
    const start = Math.max(0, idx - ctx);
    const end = Math.min(text.length, idx + searchTerm.length + ctx);
    display = text.slice(start, end);
    prefix = start > 0 ? '…' : '';
    suffix = end < text.length ? '…' : '';
  } else {
    display = text.slice(0, maxChars);
    suffix = text.length > maxChars ? '…' : '';
  }

  if (!searchTerm) {
    return (
      <pre className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed font-mono max-h-40 overflow-y-auto">
        {display}{suffix}
      </pre>
    );
  }

  const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = display.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <pre className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed font-mono max-h-40 overflow-y-auto">
      {prefix}{parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded px-0.5 not-italic">{part}</mark>
          : part
      )}{suffix}
    </pre>
  );
}

// ── FullTextModal — overlay for reading/searching a document's full text ───────
function FullTextModal({ title, text, accent = 'indigo', onClose }) {
  const [search, setSearch] = useState('');
  const accentText  = accent === 'emerald' ? 'text-emerald-400'    : 'text-indigo-400';
  const accentBdr   = accent === 'emerald' ? 'border-emerald-500/30' : 'border-indigo-500/30';

  const matchCount = useMemo(() => {
    if (!search || !text) return 0;
    try {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (text.match(new RegExp(escaped, 'gi')) || []).length;
    } catch { return 0; }
  }, [text, search]);

  const renderedText = useMemo(() => {
    if (!search || !text) return null;
    try {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
      return parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className="bg-yellow-400/30 text-yellow-200 rounded px-0.5">{part}</mark>
          : part
      );
    } catch { return text; }
  }, [text, search]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 p-4 border-b border-slate-700 shrink-0">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${accentText} truncate`}>📄 {title}</p>
            <p className="text-xs text-slate-500">{text.length.toLocaleString()} characters</p>
          </div>
          <button type="button" onClick={() => navigator.clipboard.writeText(text)}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 shrink-0">
            📋 Copy All
          </button>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl shrink-0">✕</button>
        </div>
        <div className="p-4 border-b border-slate-700 shrink-0">
          <input type="text" placeholder="Search within document…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#0F172A] border border-slate-700 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            autoFocus
          />
          {search && (
            <p className="text-xs mt-1">
              {matchCount > 0
                ? <span className="text-emerald-400">{matchCount} match{matchCount !== 1 ? 'es' : ''}</span>
                : <span className="text-amber-400">No matches</span>}
            </p>
          )}
        </div>
        <div className={`flex-1 overflow-y-auto p-4 border-l-2 ${accentBdr} mx-4 my-4`}>
          <pre className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-mono">
            {renderedText || text}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ── FileRow — enhanced file row with preview, search, copy, and text editing ───
function FileRow({ file, idx, onCountChange, onRemove, onTextEdit, onStakeholderChange, accent = 'indigo', isEditMode = false }) {
  const [expanded, setExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFull, setShowFull] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [copied, setCopied] = useState(false);

  const accentText = accent === 'emerald' ? 'text-emerald-400'    : 'text-indigo-400';
  const accentBg   = accent === 'emerald' ? 'bg-emerald-600/20'   : 'bg-indigo-600/20';
  const accentBdr  = accent === 'emerald' ? 'border-emerald-500/30' : 'border-indigo-500/30';
  const charCount  = file.chars || file.text?.length || 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(file.text || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const startEdit = () => {
    setEditText(file.text || '');
    setEditing(true);
    setExpanded(true);
  };

  const handleSaveText = () => {
    if (onTextEdit) onTextEdit(idx, editText);
    setEditing(false);
  };

  return (
    <div className={`bg-[#0F172A] rounded-lg border ${accentBdr} overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`text-xs shrink-0 ${accentText}`}>📄</span>
        <span className="text-xs text-slate-300 flex-1 truncate min-w-0" title={file.name}>{file.name}</span>
        <span className="text-xs text-slate-500 shrink-0">{charCount.toLocaleString()}c</span>
        <label className="text-xs text-slate-500 shrink-0">Q:</label>
        <input
          type="number" min="1" max="200" value={file.questionCount}
          onChange={e => onCountChange(idx, e.target.value)}
          className="w-14 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-xs text-center focus:outline-none focus:border-indigo-500"
        />
        {onStakeholderChange && (
          <button type="button"
            onClick={() => onStakeholderChange(idx, !file.stakeholder)}
            title={file.stakeholder ? 'Stakeholder questions enabled — click to disable' : 'Stakeholder questions disabled — click to enable'}
            className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium transition-colors border ${
              file.stakeholder
                ? 'bg-amber-600/25 text-amber-300 border-amber-500/50 hover:bg-amber-600/40'
                : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'
            }`}>
            Stakeholder: {file.stakeholder ? 'Yes' : 'No'}
          </button>
        )}
        <button type="button" onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Collapse' : 'Preview extracted text'}
          className={`text-xs px-1.5 py-0.5 rounded ${accentBg} ${accentText} shrink-0 transition-colors`}>
          {expanded ? '▲' : '▼'}
        </button>
        <button type="button" onClick={() => onRemove(idx)} className="text-slate-500 hover:text-red-400 text-xs shrink-0">✕</button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-slate-700/50 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Search within text…"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500 min-w-0"
            />
            <button type="button" onClick={handleCopy} title="Copy full text"
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 shrink-0 transition-colors">
              {copied ? '✓' : '📋'}
            </button>
            {(file.text?.length || 0) > 500 && !editing && (
              <button type="button" onClick={() => setShowFull(true)}
                className={`text-xs px-2 py-1 rounded ${accentBg} ${accentText} shrink-0 transition-colors`}>
                ↗ Full
              </button>
            )}
          </div>

          {editing ? (
            <div className="space-y-1.5">
              <textarea
                value={editText} onChange={e => setEditText(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-2 text-xs leading-relaxed font-mono focus:outline-none focus:border-indigo-500 resize-y"
                rows={10}
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleSaveText}
                  className="px-3 py-1 rounded bg-indigo-600 text-white text-xs hover:bg-indigo-700">
                  Save Text
                </button>
                <button type="button" onClick={() => setEditing(false)}
                  className="px-3 py-1 rounded bg-slate-700 text-slate-300 text-xs hover:bg-slate-600">
                  Cancel
                </button>
                <span className="text-xs text-slate-500 ml-1">{editText.length.toLocaleString()} chars</span>
              </div>
            </div>
          ) : (
            <div>
              <TextPreview text={file.text || ''} searchTerm={searchTerm} maxChars={500} />
              {isEditMode && onTextEdit && (
                <button type="button" onClick={startEdit}
                  className="mt-1.5 text-xs text-amber-400 hover:text-amber-300 underline">
                  ✏️ Edit text
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showFull && (
        <FullTextModal title={file.name} text={file.text || ''} accent={accent} onClose={() => setShowFull(false)} />
      )}
    </div>
  );
}

// ── CSV template ──────────────────────────────────────────────────────────────
const TEMPLATE_CSV = `role_name,department,job_description,skills,status
Frontend Developer,Engineering,"Responsible for building user interfaces using React and modern web technologies.","React,JavaScript,CSS,HTML",active
Backend Developer,Engineering,"Design and implement server-side APIs and database logic.","Node.js,PostgreSQL,REST API",active
Product Manager,Product,"Define product vision and work with cross-functional teams.","Roadmapping,Agile,Communication",active`;

// ── Role form modal ────────────────────────────────────────────────────────────
function RoleModal({ role, onClose, onSaved }) {
  const { notify: toast } = useNotification();
  const [form, setForm] = useState({
    roleName:   role?.roleName   || '',
    department: role?.department || '',
    // fallback textarea — shown only when no jdFiles are uploaded
    jobDescription: role?.jobDescription || '',
    skills: (role?.skills || []).join(', '),
    status: role?.status || 'active',
  });
  const [checklist, setChecklist] = useState(role?.onboardingChecklist || []);
  const [newItem, setNewItem] = useState({ title: '', description: '', dueDay: '' });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details');
  const [jdUploading, setJdUploading] = useState(false);
  const [supportingUploading, setSupportingUploading] = useState(false);
  // jdFiles: [{id, name, text, chars, questionCount, uploadedAt}]
  const [jdFiles, setJdFiles] = useState(role?.jdFiles || []);
  // supportingFiles: [{id, name, text, chars, questionCount, uploadedAt}]
  const [supportingFiles, setSupportingFiles] = useState(role?.supportingFiles || []);
  const jdFileRef = useRef();
  const supportingFileRef = useRef();
  const isEdit = !!role;

  const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ACCEPT_ALL = '.pdf,.doc,.docx,.pptx,.ppt,.txt,.rtf,.csv,.xls,.xlsx,.zip,.md';

  const handleJdFileUpload = async (file) => {
    if (!file) return;
    setJdUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/roles/parse-jd', { method: 'POST', body: fd });
      const data = res?.data ?? res;
      const text = data?.text ?? '';
      if (!text) throw new Error('No text extracted from file');
      setJdFiles(p => [...p, {
        id: genId(), name: file.name, text, chars: text.length, questionCount: 10,
        ext: data?.ext || file.name.split('.').pop()?.toLowerCase() || '',
        uploadedBy: data?.uploadedBy || '', uploadedAt: new Date().toISOString(),
        stakeholder: false,
      }]);
      toast(`JD added: ${file.name} (${text.length.toLocaleString()} chars)`);
    } catch (e) {
      toast(e.message || 'Failed to extract text', 'error');
    } finally {
      setJdUploading(false);
      if (jdFileRef.current) jdFileRef.current.value = '';
    }
  };

  const handleSupportingFileUpload = async (file) => {
    if (!file) return;
    setSupportingUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await authFetch('/api/roles/parse-jd', { method: 'POST', body: fd });
      const data = res?.data ?? res;
      const text = data?.text ?? '';
      if (!text) throw new Error('No text extracted from file');
      setSupportingFiles(p => [...p, {
        id: genId(), name: file.name, text, chars: text.length, questionCount: 5,
        ext: data?.ext || file.name.split('.').pop()?.toLowerCase() || '',
        uploadedBy: data?.uploadedBy || '', uploadedAt: new Date().toISOString(),
        stakeholder: false,
      }]);
      toast(`Supporting doc added: ${file.name} (${text.length.toLocaleString()} chars)`);
    } catch (e) {
      toast(e.message || 'Failed to extract text', 'error');
    } finally {
      setSupportingUploading(false);
      if (supportingFileRef.current) supportingFileRef.current.value = '';
    }
  };

  const updateJdCount = (idx, val) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: Math.max(1, parseInt(val) || 1) } : f));
  const updateSupportingCount = (idx, val) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: Math.max(1, parseInt(val) || 1) } : f));
  const removeJdFile = idx => setJdFiles(p => p.filter((_, i) => i !== idx));
  const removeSupportingFile = idx => setSupportingFiles(p => p.filter((_, i) => i !== idx));

  const updateJdText = async (idx, newText) => {
    const fileId = jdFiles[idx]?.id;
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, text: newText, chars: newText.length } : f));
    if (isEdit && role?.id && fileId) {
      try {
        await authFetch(`/api/roles/${role.id}/document-text`, {
          method: 'PUT', body: JSON.stringify({ fileId, text: newText, fileType: 'jd' }),
        });
        toast('Document text saved');
      } catch (e) { toast(e.message || 'Failed to save text', 'error'); }
    }
  };

  const updateSupportingText = async (idx, newText) => {
    const fileId = supportingFiles[idx]?.id;
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, text: newText, chars: newText.length } : f));
    if (isEdit && role?.id && fileId) {
      try {
        await authFetch(`/api/roles/${role.id}/document-text`, {
          method: 'PUT', body: JSON.stringify({ fileId, text: newText, fileType: 'supporting' }),
        });
        toast('Document text saved');
      } catch (e) { toast(e.message || 'Failed to save text', 'error'); }
    }
  };

  const updateJdStakeholder = (idx, val) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, stakeholder: !!val } : f));
  const updateSupportingStakeholder = (idx, val) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, stakeholder: !!val } : f));

  const totalQuestions = [...jdFiles, ...supportingFiles].reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0);

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
      // Derive combined JD text from uploaded files for backward compat; fall back to textarea
      const jobDescription = jdFiles.length > 0
        ? jdFiles.map(f => f.text).join('\n\n')
        : form.jobDescription.trim();
      const payload = {
        roleName:            form.roleName.trim(),
        department:          form.department.trim(),
        jobDescription,
        skills:              form.skills.split(/[,;|]/).map(s => s.trim()).filter(Boolean),
        status:              form.status,
        onboardingChecklist: checklist,
        jdFiles,
        supportingFiles,
        // backward-compat fields
        jdSources:    jdFiles.map(f => ({ name: f.name, chars: f.chars, uploadedAt: f.uploadedAt })),
        supportingDocs: supportingFiles.map(f => ({ name: f.name, text: f.text, uploadedAt: f.uploadedAt })),
      };
      const res = isEdit
        ? await authFetch(`/api/roles/${role.id}`, { method: 'PUT',  body: JSON.stringify(payload) })
        : await authFetch('/api/roles',              { method: 'POST', body: JSON.stringify(payload) });
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

          {/* ── Job Description Files ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls} style={{marginBottom:0}}>
                Job Description
                {jdFiles.length > 0 && <span className="ml-1.5 text-indigo-400 font-normal">({jdFiles.length} file{jdFiles.length > 1 ? 's' : ''})</span>}
              </label>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => jdFileRef.current?.click()} disabled={jdUploading}
                  className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40 disabled:opacity-50 transition-colors">
                  {jdUploading ? '⏳ Extracting…' : '📎 Upload JD File'}
                </button>
                <input ref={jdFileRef} type="file" accept={ACCEPT_ALL} className="hidden"
                  onChange={e => handleJdFileUpload(e.target.files[0])} />
              </div>
            </div>

            {jdFiles.length === 0 ? (
              <>
                <p className="text-xs text-slate-500 mb-1">Upload a JD file (PDF, DOCX, PPTX, TXT…) or paste text directly</p>
                <textarea className={inputCls} rows={6} value={form.jobDescription} onChange={f('jobDescription')}
                  placeholder="Paste the full job description here, or upload a file above…" />
              </>
            ) : (
              <div className="space-y-1.5">
                {jdFiles.map((file, i) => (
                  <FileRow key={file.id} file={file} idx={i} onCountChange={updateJdCount} onRemove={removeJdFile} onTextEdit={updateJdText} onStakeholderChange={updateJdStakeholder} accent="indigo" isEditMode={isEdit} />
                ))}
                <button type="button" onClick={() => jdFileRef.current?.click()} disabled={jdUploading}
                  className="text-xs text-indigo-400 hover:text-indigo-300 underline ml-1">
                  + Add another JD file
                </button>
              </div>
            )}
          </div>

          {/* ── Supporting Files ── */}
          <div className="border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-300">
                  Supporting Documents
                  {supportingFiles.length > 0 && <span className="ml-1.5 text-emerald-400">({supportingFiles.length})</span>}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">SOPs, process manuals, playbooks, policies, training materials</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => supportingFileRef.current?.click()} disabled={supportingUploading}
                  className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40 disabled:opacity-50 whitespace-nowrap transition-colors">
                  {supportingUploading ? '⏳ Uploading…' : '📂 Upload File'}
                </button>
                <input ref={supportingFileRef} type="file" accept={ACCEPT_ALL} className="hidden"
                  onChange={e => handleSupportingFileUpload(e.target.files[0])} />
              </div>
            </div>

            {supportingFiles.length === 0 ? (
              <p className="text-xs text-slate-600 py-1">No supporting documents yet.</p>
            ) : (
              <div className="space-y-1.5">
                {supportingFiles.map((file, i) => (
                  <FileRow key={file.id} file={file} idx={i} onCountChange={updateSupportingCount} onRemove={removeSupportingFile} onTextEdit={updateSupportingText} onStakeholderChange={updateSupportingStakeholder} accent="emerald" isEditMode={isEdit} />
                ))}
              </div>
            )}
          </div>

          {/* ── Total questions badge ── */}
          {totalQuestions > 0 && (
            <div className="flex items-center justify-between bg-indigo-900/20 border border-indigo-500/30 rounded-lg px-4 py-2.5">
              <div>
                <p className="text-xs text-slate-400">Total questions to generate</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {jdFiles.length > 0 && `${jdFiles.length} JD file${jdFiles.length > 1 ? 's' : ''}`}
                  {jdFiles.length > 0 && supportingFiles.length > 0 && ' + '}
                  {supportingFiles.length > 0 && `${supportingFiles.length} supporting doc${supportingFiles.length > 1 ? 's' : ''}`}
                </p>
              </div>
              <span className="text-xl font-bold text-indigo-300">{totalQuestions}</span>
            </div>
          )}
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

// ── ViewDocRow — read-only expandable document row used in ViewModal ──────────
function ViewDocRow({ file, accent = 'indigo' }) {
  const [expanded, setExpanded] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const accentText = accent === 'emerald' ? 'text-emerald-400'    : 'text-indigo-400';
  const accentBg   = accent === 'emerald' ? 'bg-emerald-600/20'   : 'bg-indigo-600/20';
  const accentBdr  = accent === 'emerald' ? 'border-emerald-500/30' : 'border-indigo-500/30';
  const charCount  = file.chars || file.text?.length || 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(file.text || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className={`bg-[#0F172A] rounded-lg border ${accentBdr} overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`text-xs shrink-0 ${accentText}`}>📄</span>
        <span className="text-xs text-slate-300 flex-1 truncate min-w-0" title={file.name}>{file.name}</span>
        <span className="text-xs text-slate-500 shrink-0">{charCount.toLocaleString()} chars</span>
        {file.questionCount && <span className={`text-xs font-semibold shrink-0 ${accentText}`}>{file.questionCount} Q</span>}
        {file.stakeholder && (
          <span className="text-xs px-2.5 py-1 rounded-md bg-amber-600/25 text-amber-300 border border-amber-500/50 font-medium shrink-0">Stakeholder: Yes</span>
        )}
        {file.text && (
          <button type="button" onClick={() => setExpanded(v => !v)}
            className={`text-xs px-1.5 py-0.5 rounded ${accentBg} ${accentText} shrink-0`}>
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
      {expanded && file.text && (
        <div className="border-t border-slate-700/50 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <input type="text" placeholder="Search within text…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500 min-w-0"
            />
            <button type="button" onClick={handleCopy}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 shrink-0">
              {copied ? '✓' : '📋'}
            </button>
            {file.text.length > 500 && (
              <button type="button" onClick={() => setShowFull(true)}
                className={`text-xs px-2 py-1 rounded ${accentBg} ${accentText} shrink-0`}>
                ↗ Full
              </button>
            )}
          </div>
          <TextPreview text={file.text} searchTerm={search} maxChars={500} />
        </div>
      )}
      {showFull && (
        <FullTextModal title={file.name} text={file.text || ''} accent={accent} onClose={() => setShowFull(false)} />
      )}
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
          {(role.jdFiles || []).length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">JD FILES ({role.jdFiles.length})</p>
              <div className="space-y-1.5">
                {role.jdFiles.map((f, i) => <ViewDocRow key={f.id || i} file={f} accent="indigo" />)}
              </div>
            </div>
          ) : role.jobDescription ? (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">JOB DESCRIPTION</p>
              <pre className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-[#0F172A] rounded-lg p-4 border border-slate-700">{role.jobDescription}</pre>
            </div>
          ) : null}
          {(role.supportingFiles?.length > 0 || role.supportingDocs?.length > 0) && (() => {
            const docs = role.supportingFiles?.length > 0 ? role.supportingFiles : (role.supportingDocs || []);
            return (
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">SUPPORTING DOCUMENTS ({docs.length})</p>
                <div className="space-y-1.5">
                  {docs.map((doc, i) => <ViewDocRow key={doc.id || i} file={doc} accent="emerald" />)}
                </div>
              </div>
            );
          })()}
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
  const { notify: toast } = useNotification();
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
  const { notify: toast } = useNotification();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  // Compute total from per-file configs when files are present
  const fileTotal = [...(role.jdFiles || []), ...(role.supportingFiles || [])].reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0);
  const hasFiles = (role.jdFiles?.length || 0) + (role.supportingFiles?.length || 0) > 0;
  const [regenCount, setRegenCount] = useState(fileTotal || role.questionBankCount || 50);
  const [regenMode, setRegenMode] = useState('all');
  const [localJdFiles, setLocalJdFiles] = useState(
    (role.jdFiles || []).map(f => ({ id: f.id, name: f.name, questionCount: parseInt(f.questionCount) || 5, stakeholder: !!f.stakeholder }))
  );
  const [localSupportingFiles, setLocalSupportingFiles] = useState(
    (role.supportingFiles || []).map(f => ({ id: f.id, name: f.name, questionCount: parseInt(f.questionCount) || 5, stakeholder: !!f.stakeholder }))
  );
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [qTypePicker, setQTypePicker] = useState(false);
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });
  const [diffFilter, setDiffFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    loadBank();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadBank = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/questions`);
      const qs = Array.isArray(res) ? res : (res?.data ?? []);
      setQuestions(qs);
      // If empty and role has JD/docs, background generation is in progress — poll
      if (qs.length === 0 && (hasFiles || role.jobDescription)) {
        setGenerating(true);
        let polls = 0;
        pollRef.current = setInterval(async () => {
          polls++;
          if (polls > 20) { clearInterval(pollRef.current); setGenerating(false); return; }
          try {
            const r = await authFetch(`/api/roles/${role.id}/questions`);
            const q2 = Array.isArray(r) ? r : (r?.data ?? []);
            if (q2.length > 0) {
              setQuestions(q2);
              setGenerating(false);
              clearInterval(pollRef.current);
            }
          } catch (_) {}
        }, 3000);
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleRegen = async () => {
    setRegen(true);
    try {
      const payload = { questionCount: regenCount, mode: regenMode };
      if (hasFiles) {
        payload.updatedJdFiles = localJdFiles;
        payload.updatedSupportingFiles = localSupportingFiles;
      }
      const res = await authFetch(`/api/roles/${role.id}/regenerate-questions`, { method: 'POST', body: JSON.stringify(payload) });
      const newQs = res?.data?.questions ?? res?.questions ?? [];
      setQuestions(newQs);
      toast(regenMode === 'ai-only' ? `AI questions regenerated — ${newQs.length} total (manual questions preserved)` : `Regenerated ${newQs.length} questions`);
      setRegenConfirm(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setRegen(false); }
  };

  const startEdit = (i) => { setEditIdx(i); setEditQ({ ...questions[i] }); };
  const cancelEdit = () => { setEditIdx(null); setEditQ(null); };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const updated = questions.map((q, i) => i === editIdx ? { ...editQ, isManual: true } : q);
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
      const res = await authFetch(`/api/roles/${role.id}/questions`, { method: 'POST', body: JSON.stringify({ ...newQ, isManual: true }) });
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
              {/* Live count summary */}
              {(() => {
                const totalRequested = hasFiles
                  ? [...localJdFiles, ...localSupportingFiles].reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0)
                  : (role.questionBankCount || regenCount);
                const manualCount = questions.filter(q => q.isManual).length;
                const remaining = Math.max(0, totalRequested - questions.length);
                return (
                  <div className="flex gap-3 text-xs mt-1 flex-wrap">
                    <span className="text-slate-500">Requested: <span className="text-indigo-300 font-semibold">{totalRequested}</span></span>
                    <span className="text-slate-500">Generated: <span className={questions.length >= totalRequested ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>{questions.length}</span></span>
                    {remaining > 0 && <span className="text-slate-500">Remaining: <span className="text-red-400 font-semibold">{remaining}</span></span>}
                    {manualCount > 0 && <span className="text-slate-500">Manual: <span className="text-violet-300 font-semibold">{manualCount}</span></span>}
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={() => { setRegenMode('all'); setRegenConfirm(true); }}
                disabled={regen || (!role.jobDescription && !hasFiles) || regenConfirm}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/40 disabled:opacity-40 transition-colors"
              >
                {regen && regenMode === 'all' ? '⏳ Generating…' : '✨ Regen All'}
              </button>
              <button
                onClick={() => { setRegenMode('ai-only'); setRegenConfirm(true); }}
                disabled={regen || (!role.jobDescription && !hasFiles) || regenConfirm}
                title="Regenerate only AI-generated questions; preserves manually added/edited ones"
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40 disabled:opacity-40 transition-colors"
              >
                {regen && regenMode === 'ai-only' ? '⏳ Generating…' : '🔄 Regen AI Only'}
              </button>
              <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2">✕</button>
            </div>
          </div>

          {/* Inline regenerate confirmation panel */}
          {regenConfirm && (() => {
            const manualCount = questions.filter(q => q.isManual).length;
            const localTotal = hasFiles
              ? [...localJdFiles, ...localSupportingFiles].reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0)
              : regenCount;
            return (
              <div className="mx-5 my-3 p-4 bg-amber-500/10 border border-amber-500/40 rounded-xl space-y-3">
                {/* Mode toggle tabs */}
                <div className="flex gap-1 bg-[#0F172A] p-1 rounded-lg w-fit">
                  <button
                    onClick={() => setRegenMode('all')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${regenMode === 'all' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >✨ Regenerate All</button>
                  <button
                    onClick={() => setRegenMode('ai-only')}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${regenMode === 'ai-only' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >🔄 AI Questions Only</button>
                </div>

                <p className="text-sm text-amber-300 font-medium">
                  {regenMode === 'all'
                    ? `This will replace all ${questions.length} existing questions. This cannot be undone.`
                    : manualCount > 0
                      ? `${manualCount} manually edited question${manualCount > 1 ? 's' : ''} will be preserved. Only AI-generated questions (${questions.length - manualCount}) will be replaced.`
                      : `No manually edited questions found — all ${questions.length} AI-generated questions will be replaced.`
                  }
                </p>

                {hasFiles ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">
                      {regenMode === 'ai-only' ? 'Questions per file (AI-generated portion):' : 'Questions per file — edit counts before generating:'}
                    </p>
                    {localJdFiles.map((f, i) => (
                      <div key={f.id || i} className="flex items-center gap-2 text-xs bg-[#0F172A] rounded px-3 py-1.5 border border-slate-700">
                        <span className="truncate flex-1 text-slate-300">{f.name}</span>
                        <span className="text-indigo-400 shrink-0">JD</span>
                        <input type="number" min="1" max="200" value={f.questionCount}
                          onChange={e => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                          className="w-14 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-center focus:outline-none focus:border-amber-500" />
                        <span className="text-slate-500 shrink-0">Q</span>
                        <button type="button"
                          onClick={() => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, stakeholder: !x.stakeholder } : x))}
                          title={f.stakeholder ? 'Stakeholder questions ON — click to disable' : 'Stakeholder questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors ${f.stakeholder ? 'bg-amber-600/25 text-amber-300 border-amber-500/50 hover:bg-amber-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Stakeholder: {f.stakeholder ? 'Yes' : 'No'}
                        </button>
                      </div>
                    ))}
                    {localSupportingFiles.map((f, i) => (
                      <div key={f.id || i} className="flex items-center gap-2 text-xs bg-[#0F172A] rounded px-3 py-1.5 border border-slate-700">
                        <span className="truncate flex-1 text-slate-300">{f.name}</span>
                        <span className="text-emerald-400 shrink-0">doc</span>
                        <input type="number" min="1" max="200" value={f.questionCount}
                          onChange={e => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                          className="w-14 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-center focus:outline-none focus:border-amber-500" />
                        <span className="text-slate-500 shrink-0">Q</span>
                        <button type="button"
                          onClick={() => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, stakeholder: !x.stakeholder } : x))}
                          title={f.stakeholder ? 'Stakeholder questions ON — click to disable' : 'Stakeholder questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors ${f.stakeholder ? 'bg-amber-600/25 text-amber-300 border-amber-500/50 hover:bg-amber-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Stakeholder: {f.stakeholder ? 'Yes' : 'No'}
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-indigo-300 font-semibold pt-1">Total: {localTotal} questions</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-400 whitespace-nowrap">Question count:</label>
                    <input
                      type="number" min={5} max={200} value={regenCount}
                      onChange={e => setRegenCount(Math.min(200, Math.max(5, parseInt(e.target.value) || 50)))}
                      className="w-24 bg-[#0F172A] border border-slate-600 text-slate-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-xs text-slate-500">(5–200)</span>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setRegenConfirm(false)} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-xs hover:border-slate-400 transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleRegen}
                    disabled={regen}
                    className={`px-4 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50 transition-colors ${regenMode === 'ai-only' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                  >
                    {regen ? '⏳ Generating…' : regenMode === 'ai-only' ? 'Regenerate AI Questions' : 'Confirm Regenerate All'}
                  </button>
                </div>
              </div>
            );
          })()}
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
          {!loading && generating && questions.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/30">
                <span className="text-indigo-400 text-sm">⏳</span>
                <p className="text-indigo-300 text-sm font-medium">Generating questions from your documents…</p>
              </div>
              <p className="text-slate-500 text-xs">This usually takes 15–45 seconds. This page will update automatically.</p>
            </div>
          )}
          {!loading && !generating && filtered.length === 0 && (
            <div className="text-center py-10">
              <p className="text-slate-400 text-sm">{questions.length === 0 ? 'No questions yet. Click "Regen All" to auto-generate from the JD.' : `No ${diffFilter} questions.`}</p>
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
                    {(editQ.type === 'mcq' || !editQ.type) && (
                      <>
                        {(editQ.options || ['A) ', 'B) ', 'C) ', 'D) ']).map((opt, oi) => (
                          <input key={oi} className={inputCls} value={opt} onChange={e => { const o = [...(editQ.options || ['A) ','B) ','C) ','D) '])]; o[oi] = e.target.value; setEditQ(p => ({ ...p, options: o })); }} placeholder={`Option ${['A','B','C','D'][oi]}`} />
                        ))}
                        <div>
                          <label className={labelCls}>Correct Answer</label>
                          <select className={inputCls} value={editQ.answer || 'A'} onChange={e => setEditQ(p => ({ ...p, answer: e.target.value }))}>
                            {['A','B','C','D'].map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                    {editQ.type === 'fill_blank' && (
                      <div>
                        <label className={labelCls}>Expected Answer <span className="text-slate-500 font-normal">(exact phrase)</span></label>
                        <input className={inputCls} value={editQ.answer || ''} onChange={e => setEditQ(p => ({ ...p, answer: e.target.value }))} placeholder="e.g. agile methodology" />
                      </div>
                    )}
                    {editQ.type === 'subjective' && (
                      <div>
                        <label className={labelCls}>Model Answer</label>
                        <textarea rows={3} className={inputCls} value={editQ.answer || ''} onChange={e => setEditQ(p => ({ ...p, answer: e.target.value }))} placeholder="Describe the ideal response…" />
                      </div>
                    )}
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
                      <div className="flex gap-1 flex-shrink-0 items-center">
                        {q.isManual && <span className="px-1.5 py-0.5 rounded text-xs bg-violet-900/40 text-violet-400 border border-violet-700/50">edited</span>}
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
  const { notify: toast } = useNotification();
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
      onClose(res?.roleApproval || true);
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
  const { notify: toast } = useNotification();
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
        <SearchableSelect
          value={deptFilter || 'all'}
          onChange={v => setDeptFilter(v === 'all' ? '' : v)}
          allLabel="All Departments"
          options={departments}
        />
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
                <tr key={role.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${role.approved ? 'bg-emerald-900/15 border-l-4 border-l-emerald-500' : (i % 2 === 0 ? '' : 'bg-slate-800/20')}`} title={role.approved && role.approvedAt ? `Approved ${new Date(role.approvedAt).toLocaleString()}` : undefined}>
                  <td className="px-4 py-3 font-medium text-white">
                    <span className="flex items-center gap-2">
                      {role.approved && <span className="text-emerald-400" title="Approved">✓</span>}
                      {role.roleName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{role.department || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold w-fit ${role.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border border-slate-600'}`}>
                      {role.status}
                    </span>
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
          onClose={(result) => {
            if (result) {
              const approval = typeof result === 'object' ? result : { approved: true, approvedAt: new Date().toISOString() };
              setRoles(prev => prev.map(r => r.id === approveRole.id ? { ...r, ...approval } : r));
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
