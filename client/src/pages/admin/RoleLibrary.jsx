import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { authFetch } from '../../utils/authFetch.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import QuestionCard from '../../components/QuestionCard.jsx';

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
function FileRow({ file, idx, onCountChange, onCountBlur, onRemove, onTextEdit, onLabelChange, onStakeholderChange, onProcessDeliveryChange, accent = 'indigo', isEditMode = false }) {
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
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${accentBg} ${accentText} border ${accentBdr}`}>
          File {idx + 1}
        </span>
        {onLabelChange ? (
          <input
            value={file.label || ''}
            onChange={e => onLabelChange(idx, e.target.value)}
            placeholder="Name this file (optional)"
            title={`Original filename: ${file.name}`}
            className="w-36 shrink-0 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-indigo-500 placeholder:text-slate-600"
          />
        ) : file.label ? (
          <span className="text-xs text-slate-200 font-medium shrink-0">{file.label}</span>
        ) : null}
        <span className="text-xs text-slate-400 flex-1 truncate min-w-0" title={file.name}>{file.name}</span>
        <span className={`text-xs shrink-0 ${charCount > 0 && charCount < 400 ? 'text-amber-400' : 'text-slate-500'}`}
          title={charCount > 0 && charCount < 400 ? 'Very little text extracted — too thin to generate specific questions from' : undefined}>
          {charCount.toLocaleString()}c{charCount > 0 && charCount < 400 ? ' ⚠' : ''}
        </span>
        <label className="text-xs text-slate-500 shrink-0">Q:</label>
        <input
          type="number" min="1" max="200" value={file.questionCount}
          onChange={e => onCountChange(idx, e.target.value)}
          onBlur={() => onCountBlur && onCountBlur(idx)}
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
        {onProcessDeliveryChange && (
          <button type="button"
            onClick={() => onProcessDeliveryChange(idx, !file.processDelivery)}
            title={file.processDelivery ? 'Process Delivery questions enabled — click to disable' : 'Process Delivery questions disabled — click to enable'}
            className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium transition-colors border ${
              file.processDelivery
                ? 'bg-cyan-600/25 text-cyan-300 border-cyan-500/50 hover:bg-cyan-600/40'
                : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'
            }`}>
            Process Delivery: {file.processDelivery ? 'Yes' : 'No'}
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
      const res = await authFetch('/api/roles/parse-jd?type=jd', { method: 'POST', body: fd });
      const data = res?.data ?? res;
      const text = data?.text ?? '';
      if (!text) throw new Error('No text extracted from file');
      setJdFiles(p => [...p, {
        id: genId(), name: file.name, label: '', text, chars: text.length, questionCount: 10,
        ext: data?.ext || file.name.split('.').pop()?.toLowerCase() || '',
        uploadedBy: data?.uploadedBy || '', uploadedAt: new Date().toISOString(),
        stakeholder: false, processDelivery: false,
      }]);
      if (data?.warning) toast(data.warning, 'error');
      else toast(`JD added: ${file.name} (${text.length.toLocaleString()} chars)`);
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
        id: genId(), name: file.name, label: '', text, chars: text.length, questionCount: 5,
        ext: data?.ext || file.name.split('.').pop()?.toLowerCase() || '',
        uploadedBy: data?.uploadedBy || '', uploadedAt: new Date().toISOString(),
        stakeholder: false, processDelivery: false,
      }]);
      if (data?.warning) toast(data.warning, 'error');
      else toast(`Supporting doc added: ${file.name} (${text.length.toLocaleString()} chars)`);
    } catch (e) {
      toast(e.message || 'Failed to extract text', 'error');
    } finally {
      setSupportingUploading(false);
      if (supportingFileRef.current) supportingFileRef.current.value = '';
    }
  };

  // Allow raw string while typing; validation happens on blur
  const updateJdCount = (idx, val) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: val } : f));
  const updateJdCountBlur = (idx) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: Math.max(1, parseInt(f.questionCount) || 1) } : f));
  const updateSupportingCount = (idx, val) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: val } : f));
  const updateSupportingCountBlur = (idx) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, questionCount: Math.max(1, parseInt(f.questionCount) || 1) } : f));
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
  const updateJdProcessDelivery = (idx, val) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, processDelivery: !!val } : f));
  const updateSupportingProcessDelivery = (idx, val) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, processDelivery: !!val } : f));
  // Optional friendly name per file — shown instead of the raw filename and
  // cited as the source on every question generated from that file.
  const updateJdLabel = (idx, val) =>
    setJdFiles(p => p.map((f, i) => i === idx ? { ...f, label: val } : f));
  const updateSupportingLabel = (idx, val) =>
    setSupportingFiles(p => p.map((f, i) => i === idx ? { ...f, label: val } : f));

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
                  <FileRow key={file.id} file={file} idx={i} onCountChange={updateJdCount} onCountBlur={updateJdCountBlur} onRemove={removeJdFile} onTextEdit={updateJdText} onLabelChange={updateJdLabel} onStakeholderChange={updateJdStakeholder} onProcessDeliveryChange={updateJdProcessDelivery} accent="indigo" isEditMode={isEdit} />
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
                  <FileRow key={file.id} file={file} idx={i} onCountChange={updateSupportingCount} onCountBlur={updateSupportingCountBlur} onRemove={removeSupportingFile} onTextEdit={updateSupportingText} onLabelChange={updateSupportingLabel} onStakeholderChange={updateSupportingStakeholder} onProcessDeliveryChange={updateSupportingProcessDelivery} accent="emerald" isEditMode={isEdit} />
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
function ViewDocRow({ file, accent = 'indigo', onDelete }) {
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
        {onDelete && (
          <button type="button" onClick={() => onDelete(file)}
            title="Delete this document"
            className="text-slate-500 hover:text-red-400 text-xs shrink-0 transition-colors">✕</button>
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
function ViewModal({ role: initialRole, onClose, onEdit, onRoleUpdated }) {
  const { notify: toast } = useNotification();
  const [role, setRole] = useState(initialRole);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const generateOverview = async (force = false) => {
    setOverviewLoading(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/generate-overview`, {
        method: 'POST',
        body: JSON.stringify({ force }),
      });
      const overview = res?.data ?? res;
      const updated = { ...role, structuredOverview: overview };
      setRole(updated);
      if (onRoleUpdated) onRoleUpdated(updated);
    } catch (e) {
      toast(e.message || 'Failed to generate role overview', 'error');
    } finally {
      setOverviewLoading(false);
    }
  };

  const handleDeleteDoc = async (file) => {
    if (!file?.id) return toast('This document has no id — remove it via Edit Role instead', 'error');
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      const res = await authFetch(`/api/roles/${role.id}/documents/${file.id}`, { method: 'DELETE' });
      const updated = res?.data ?? res;
      setRole(updated);
      if (onRoleUpdated) onRoleUpdated(updated);
      toast(`Deleted: ${file.name}`);
    } catch (e) {
      toast(e.message || 'Failed to delete document', 'error');
    }
  };

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
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-slate-400">ROLE OVERVIEW</p>
                {role.structuredOverview && (
                  <button
                    onClick={() => generateOverview(true)}
                    disabled={overviewLoading}
                    className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  >
                    {overviewLoading ? 'Regenerating…' : '↻ Regenerate'}
                  </button>
                )}
              </div>
              {role.structuredOverview ? (
                <div className="space-y-3 bg-[#0F172A] rounded-lg p-4 border border-slate-700">
                  <p className="text-sm text-slate-200 leading-relaxed">{role.structuredOverview.summary}</p>
                  {role.structuredOverview.keyResponsibilities?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Key Responsibilities</p>
                      <ul className="space-y-1">
                        {role.structuredOverview.keyResponsibilities.map((r, i) => (
                          <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-indigo-400 shrink-0">•</span><span>{r}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {role.structuredOverview.requiredSkills?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Required Skills</p>
                      <div className="flex flex-wrap gap-1.5">
                        {role.structuredOverview.requiredSkills.map((s, i) => <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">{s}</span>)}
                      </div>
                    </div>
                  )}
                  {role.structuredOverview.niceToHaveSkills?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nice to Have</p>
                      <div className="flex flex-wrap gap-1.5">
                        {role.structuredOverview.niceToHaveSkills.map((s, i) => <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-slate-700/50 text-slate-300 border border-slate-600/40">{s}</span>)}
                      </div>
                    </div>
                  )}
                  {role.structuredOverview.dayInTheLife && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">A Day in This Role</p>
                      <p className="text-sm text-slate-300 leading-relaxed">{role.structuredOverview.dayInTheLife}</p>
                    </div>
                  )}
                  {role.structuredOverview.careerGrowthPath?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Career Growth Path</p>
                      <p className="text-sm text-slate-300">{role.structuredOverview.careerGrowthPath.join(' → ')}</p>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => generateOverview(false)}
                  disabled={overviewLoading}
                  className="w-full py-3 rounded-lg border border-dashed border-indigo-500/40 text-indigo-300 text-sm font-semibold hover:bg-indigo-500/10 transition-all disabled:opacity-50"
                >
                  {overviewLoading ? '⏳ Generating overview…' : '✨ Generate AI Overview'}
                </button>
              )}
            </div>
          )}
          {(role.jdFiles || []).length > 0 ? (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">JD FILES ({role.jdFiles.length})</p>
              <div className="space-y-1.5">
                {role.jdFiles.map((f, i) => <ViewDocRow key={f.id || i} file={f} accent="indigo" onDelete={handleDeleteDoc} />)}
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
                  {docs.map((doc, i) => <ViewDocRow key={doc.id || i} file={doc} accent="emerald" onDelete={handleDeleteDoc} />)}
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

function QuestionBankModal({ role, onClose, onGenerated, onApprove }) {
  const { notify: toast } = useNotification();
  const { hasFeaturePermission } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState(false);
  const [regenConfirm, setRegenConfirm] = useState(false);
  const [lockingQid, setLockingQid] = useState(null);
  // Compute total from per-file configs when files are present
  const fileTotal = [...(role.jdFiles || []), ...(role.supportingFiles || [])].reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0);
  const hasFiles = (role.jdFiles?.length || 0) + (role.supportingFiles?.length || 0) > 0;
  // questionBankTargetCount (not questionBankCount) is the admin's intended
  // bank size — questionBankCount tracks the LIVE count and legitimately
  // shrinks when a question is deleted, which used to silently retarget
  // every future regeneration at the smaller post-deletion number instead of
  // refilling back up to what was actually approved/generated. Falls back to
  // questionBankCount for older roles that predate this field.
  const [regenCount, setRegenCount] = useState(fileTotal || role.questionBankTargetCount || role.questionBankCount || 50);
  const [regenMode, setRegenMode] = useState('all');
  const [localJdFiles, setLocalJdFiles] = useState(
    (role.jdFiles || []).map(f => ({ id: f.id, name: f.name, questionCount: parseInt(f.questionCount) || 5, stakeholder: !!f.stakeholder, processDelivery: !!f.processDelivery }))
  );
  const [localSupportingFiles, setLocalSupportingFiles] = useState(
    (role.supportingFiles || []).map(f => ({ id: f.id, name: f.name, questionCount: parseInt(f.questionCount) || 5, stakeholder: !!f.stakeholder, processDelivery: !!f.processDelivery }))
  );
  // Which uploaded file(s) actually feed the NEXT generation run — separate
  // from localJdFiles/localSupportingFiles (which hold each file's saved
  // per-file config) so toggling a file in/out of this run never dirties
  // that config. Defaults to only the first uploaded file (oldest by upload
  // order, i.e. index 0 of whichever list has one) — fully changeable via
  // the checkboxes below or "Select all".
  const [selectedFileIds, setSelectedFileIds] = useState(() => {
    const first = (role.jdFiles || [])[0] || (role.supportingFiles || [])[0];
    return first ? new Set([first.id]) : new Set();
  });
  const toggleFileSelected = (id) => setSelectedFileIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFileIds = [...localJdFiles, ...localSupportingFiles].map(f => f.id);
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [editQ, setEditQ] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [qTypePicker, setQTypePicker] = useState(false);
  const [newQ, setNewQ] = useState({ ...EMPTY_Q });
  const [diffFilter, setDiffFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(null);
  // Post-generation source breakdown: how much text each file contributed and
  // how many questions were templated filler rather than drawn from documents.
  const [genDiagnostics, setGenDiagnostics] = useState(null);
  const pollRef = useRef(null);
  // Quarterly archives: immutable snapshots made by 'New Generation'.
  const [archives, setArchives] = useState([]);
  const [nextLabel, setNextLabel] = useState('Q1');
  const [viewArchive, setViewArchive] = useState(null); // full snapshot being viewed read-only
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [newGenConfirm, setNewGenConfirm] = useState(false);

  const loadArchives = async () => {
    try {
      const r = await authFetch(`/api/roles/${role.id}/archives`);
      setArchives(Array.isArray(r?.data) ? r.data : []);
      if (r?.meta?.nextLabel) setNextLabel(r.meta.nextLabel);
    } catch (_) { /* strip is optional — fail quietly */ }
  };

  const openArchive = async (a) => {
    if (viewArchive?.id === a.id) { setViewArchive(null); return; }
    setArchiveLoading(true);
    try {
      const r = await authFetch(`/api/roles/${role.id}/archives/${a.id}`);
      setViewArchive(r?.data ?? null);
      setDiffFilter('all');
    } catch (e) { toast(e.message, 'error'); }
    finally { setArchiveLoading(false); }
  };

  useEffect(() => {
    loadBank();
    loadArchives();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Poll the server's generation-status endpoint until the background run
  // finishes, then load the resulting bank. Generation legitimately takes
  // MINUTES on the free LLM tier (rate-limited to ~8,000 tokens/min), so the
  // old 20-poll / 60-second cap gave up long before a real bank could finish —
  // which is exactly why the UI kept showing an empty list and asking the user
  // to "Regenerate All" over and over. Polls for up to 15 minutes and reports
  // live progress instead of guessing from an empty question list.
  const pollGenerationStatus = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setGenerating(true);
    let polls = 0;
    // Multi-file/large-document generation on the free LLM tier is
    // documented elsewhere in this codebase as legitimately taking
    // 15-40+ minutes under heavy rate-limiting — the old 15-minute cap
    // abandoned the poll (with the server-side job still running) well
    // within that normal range, which is exactly what made a healthy,
    // still-working generation look "stuck at 0" to the admin.
    const MAX_POLLS = 900; // 900 x 3s = 45 minutes
    pollRef.current = setInterval(async () => {
      polls++;
      if (polls > MAX_POLLS) {
        clearInterval(pollRef.current);
        setGenerating(false);
        setGenProgress(null);
        toast('Generation is taking unusually long — reopen this window to check again.', 'error');
        return;
      }
      try {
        const s = await authFetch(`/api/roles/${role.id}/generation-status`);
        const st = s?.data ?? s ?? {};
        setGenProgress({ done: st.done || 0, total: st.total || 0, phase: st.phase, throttleMs: st.throttleMs || 0 });

        if (st.status === 'done' || st.status === 'idle') {
          clearInterval(pollRef.current);
          const r = await authFetch(`/api/roles/${role.id}/questions`);
          const q2 = Array.isArray(r) ? r : (r?.data ?? []);
          setQuestions(q2);
          setGenerating(false);
          setGenProgress(null);
          setGenDiagnostics(st.diagnostics || null);
          if (q2.length > 0) {
            toast(`${q2.length} questions ready`);
            // Tell the parent so the table row's questionBankCount/Approve
            // button update immediately — previously this modal only ever
            // updated its own local `questions` state, so the admin could
            // watch generation finish right here and still not see the
            // Approve button on the role row until a full page reload.
            onGenerated?.(role.id, q2.length);
          }
        } else if (st.status === 'failed') {
          clearInterval(pollRef.current);
          setGenerating(false);
          setGenProgress(null);
          toast(st.error || 'Generation failed — please try Regenerate again.', 'error');
        }
      } catch (_) { /* transient network error — keep polling */ }
    }, 3000);
  };

  const loadBank = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/roles/${role.id}/questions`);
      const qs = Array.isArray(res) ? res : (res?.data ?? []);
      setQuestions(qs);
      if (qs.length > 0 && qs.length !== (role.questionBankCount || 0)) onGenerated?.(role.id, qs.length);
      // Empty bank + a JD/docs present means a background generation is
      // probably still running (or was interrupted) — ask the server rather
      // than assuming, and keep polling until it actually resolves.
      if (qs.length === 0 && (hasFiles || role.jobDescription)) {
        pollGenerationStatus();
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const handleRegen = async (isNewGeneration = false) => {
    setRegen(true);
    try {
      // Partial regeneration: locked questions are preserved verbatim by the
      // server (never regenerated), unlocked ones are replaced — unlimited
      // times, no confirmation/unlock step needed anymore.
      const payload = { questionCount: regenCount, mode: regenMode };
      if (hasFiles) {
        payload.updatedJdFiles = localJdFiles;
        payload.updatedSupportingFiles = localSupportingFiles;
        // null (nothing selected — treated as "all", same default as before
        // this feature existed) only if literally every file is selected;
        // otherwise the explicit subset, so an unselected file's text never
        // reaches generation.
        payload.selectedFileIds = selectedFileIds.size === allFileIds.length ? null : [...selectedFileIds];
      }
      // Returns 202 immediately with a job handle — generation continues
      // server-side. Blocking on the full generation here used to guarantee a
      // 30s client abort (plus 2 automatic retries that each kicked off ANOTHER
      // competing generation), so the click appeared to do nothing.
      const res = await authFetch(`/api/roles/${role.id}/${isNewGeneration ? 'new-generation' : 'regenerate-questions'}`, { method: 'POST', body: JSON.stringify(payload) });
      const noOp = res?.noOp || res?.data?.noOp;
      if (noOp) {
        toast(res?.message || 'All questions are locked — nothing to regenerate.');
        setRegenConfirm(false);
        return;
      }
      setRegenConfirm(false);
      setNewGenConfirm(false);
      if (isNewGeneration) { setViewArchive(null); loadArchives(); }
      toast(res?.data?.alreadyRunning
        ? 'Generation already in progress — tracking it now.'
        : 'Generation started — this can take a few minutes on the free AI tier.');
      pollGenerationStatus();
    } catch (e) { toast(e.message, 'error'); }
    finally { setRegen(false); }
  };

  const toggleQuestionLock = async (q) => {
    if (!q.id) return;
    setLockingQid(q.id);
    try {
      const action = q.locked ? 'unlock' : 'lock';
      const res = await authFetch(`/api/roles/${role.id}/questions/${q.id}/${action}`, { method: 'POST' });
      const updatedQ = res?.data ?? res;
      setQuestions(prev => prev.map(x => x.id === q.id ? updatedQ : x));
      toast(q.locked ? 'Question unlocked' : 'Question locked');
    } catch (e) { toast(e.message, 'error'); }
    finally { setLockingQid(null); }
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
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-[92vw] h-[92vh] max-w-none flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0">
          <div className="flex items-center justify-between p-5 border-b border-slate-700">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                Question Bank — {role.roleName}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {questions.length} questions · Easy: {counts.easy} · Medium: {counts.medium} · Hard: {counts.hard}
                {questions.some(q => q.locked) && <> · <span className="text-emerald-400 font-semibold">🔒 {questions.filter(q => q.locked).length} locked</span></>}
              </p>
              {/* Live count summary */}
              {(() => {
                // Same target-over-live-count priority as regenCount's init —
                // role.questionBankCount alone would show a "Requested" total
                // that had already shrunk from any prior deletion, making the
                // "Remaining" indicator read 0 (nothing missing) right after
                // deleting questions, instead of correctly showing the gap
                // that Regenerate is supposed to fill back in.
                const totalRequested = hasFiles
                  ? [...localJdFiles, ...localSupportingFiles].filter(f => selectedFileIds.has(f.id)).reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0)
                  : (role.questionBankTargetCount || regenCount || role.questionBankCount);
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
                disabled={regen || (!role.jobDescription && !hasFiles) || regenConfirm || !hasFeaturePermission('questions.generate')}
                title={!hasFeaturePermission('questions.generate') ? "You don't have permission to generate questions" : "Unlimited — locked questions are always preserved, only unlocked ones are replaced"}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/40 disabled:opacity-40 transition-colors"
              >
                {regen && regenMode === 'all' ? '⏳ Generating…' : '✨ Regen All'}
              </button>
              <button
                onClick={() => { setRegenMode('ai-only'); setRegenConfirm(true); }}
                disabled={regen || (!role.jobDescription && !hasFiles) || regenConfirm || !hasFeaturePermission('questions.generate')}
                title={!hasFeaturePermission('questions.generate') ? "You don't have permission to generate questions" : "Regenerates only unlocked AI-generated questions; locked and manually-edited questions are preserved"}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/40 disabled:opacity-40 transition-colors"
              >
                {regen && regenMode === 'ai-only' ? '⏳ Generating…' : '🔄 Regen AI Only'}
              </button>
              {hasFeaturePermission('questions.generate') && questions.length > 0 && (
                <button
                  onClick={() => setNewGenConfirm(true)}
                  disabled={regen || generating || (!role.jobDescription && !hasFiles)}
                  title="Quarterly refresh — saves the current questions as a quarter snapshot, then regenerates ALL questions (locked ones too)"
                  className="text-xs px-3 py-1.5 rounded-lg bg-sky-600/20 text-sky-300 border border-sky-500/30 hover:bg-sky-600/40 disabled:opacity-40 transition-colors"
                >
                  🗓 New Generation
                </button>
              )}
              {onApprove && questions.length > 0 && (
                <button
                  onClick={() => onApprove(role)}
                  title="Review stays right here — this only opens the small scheduling confirmation"
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40 transition-colors"
                >
                  ✓ Approve
                </button>
              )}
              <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2">✕</button>
            </div>
          </div>

          {/* Quarters strip — archived quarterly snapshots (read-only) */}
          {archives.length > 0 && (
            <div className="px-5 py-2 border-b border-slate-700 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 mr-1">Quarters:</span>
              <button
                onClick={() => setViewArchive(null)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${!viewArchive ? 'bg-indigo-600 text-white border-indigo-500' : 'text-slate-300 border-slate-600 hover:border-slate-400'}`}
                title="Show the current (live) questions"
              >Current</button>
              {archives.map(a => (
                <button
                  key={a.id}
                  onClick={() => openArchive(a)}
                  disabled={archiveLoading}
                  title={`${a.label} — archived ${a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ''} · ${a.questionCount} questions`}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${viewArchive?.id === a.id ? 'bg-sky-600 text-white border-sky-500' : 'text-sky-300 border-sky-700/60 hover:bg-sky-600/20'}`}
                >{a.label}</button>
              ))}
            </div>
          )}

          {/* New Generation confirmation pop-up */}
          {newGenConfirm && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
              <div className="bg-[#1E293B] border border-slate-600 rounded-xl max-w-md w-full p-5 shadow-2xl">
                <h3 className="text-base font-semibold text-white">Start a new generation?</h3>
                <p className="text-sm text-slate-300 mt-2">
                  Start a new generation for the next quarter? ALL questions, locked and unlocked, will be regenerated.
                  The current approved questions will be saved as <strong className="text-sky-300">{nextLabel}</strong> and stay available to view.
                </p>
                <div className="flex gap-2 justify-end mt-5">
                  <button onClick={() => setNewGenConfirm(false)} disabled={regen} className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">Cancel</button>
                  <button onClick={() => handleRegen(true)} disabled={regen} className="px-4 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-50">
                    {regen ? 'Starting…' : 'Start new generation'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Inline regenerate confirmation panel */}
          {regenConfirm && (() => {
            const lockedCount = questions.filter(q => q.locked).length;
            const manualCount = questions.filter(q => q.isManual && !q.locked).length;
            const preservedCount = lockedCount + (regenMode === 'ai-only' ? manualCount : 0);
            const localTotal = hasFiles
              ? [...localJdFiles, ...localSupportingFiles].filter(f => selectedFileIds.has(f.id)).reduce((s, f) => s + (parseInt(f.questionCount) || 5), 0)
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
                  {lockedCount > 0 && (
                    <>🔒 {lockedCount} locked question{lockedCount !== 1 ? 's' : ''} will be preserved exactly as-is. </>
                  )}
                  {regenMode === 'all'
                    ? `${questions.length - preservedCount} unlocked question${questions.length - preservedCount !== 1 ? 's' : ''} will be replaced. This cannot be undone.`
                    : manualCount > 0
                      ? `${manualCount} manually edited question${manualCount !== 1 ? 's' : ''} will also be preserved. Only unlocked AI-generated questions (${questions.length - preservedCount}) will be replaced.`
                      : `All unlocked AI-generated questions (${questions.length - preservedCount}) will be replaced.`
                  }
                </p>

                {hasFiles ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400">
                        {regenMode === 'ai-only' ? 'Questions per file (AI-generated portion):' : 'Select which document(s) feed this generation:'}
                      </p>
                      <button type="button"
                        onClick={() => setSelectedFileIds(selectedFileIds.size === allFileIds.length ? new Set() : new Set(allFileIds))}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
                        {selectedFileIds.size === allFileIds.length ? 'Select none' : 'Select all'}
                      </button>
                    </div>
                    {localJdFiles.map((f, i) => {
                      const selected = selectedFileIds.has(f.id);
                      return (
                      <div key={f.id || i} className={`flex items-center gap-2 text-xs bg-[#0F172A] rounded px-3 py-1.5 border ${selected ? 'border-slate-700' : 'border-slate-800 opacity-50'}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleFileSelected(f.id)}
                          className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-indigo-500 shrink-0" />
                        <span className="truncate flex-1 text-slate-300">{f.name}</span>
                        <span className="text-indigo-400 shrink-0">JD</span>
                        <input type="number" min="1" max="200" value={f.questionCount} disabled={!selected}
                          onChange={e => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: e.target.value } : x))}
                          onBlur={() => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: Math.max(1, parseInt(x.questionCount) || 1) } : x))}
                          className="w-14 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-center focus:outline-none focus:border-amber-500 disabled:opacity-50" />
                        <span className="text-slate-500 shrink-0">Q</span>
                        <button type="button" disabled={!selected}
                          onClick={() => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, stakeholder: !x.stakeholder } : x))}
                          title={f.stakeholder ? 'Stakeholder questions ON — click to disable' : 'Stakeholder questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors disabled:opacity-50 ${f.stakeholder ? 'bg-amber-600/25 text-amber-300 border-amber-500/50 hover:bg-amber-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Stakeholder: {f.stakeholder ? 'Yes' : 'No'}
                        </button>
                        <button type="button" disabled={!selected}
                          onClick={() => setLocalJdFiles(p => p.map((x, j) => j === i ? { ...x, processDelivery: !x.processDelivery } : x))}
                          title={f.processDelivery ? 'Process Delivery questions ON — click to disable' : 'Process Delivery questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors disabled:opacity-50 ${f.processDelivery ? 'bg-cyan-600/25 text-cyan-300 border-cyan-500/50 hover:bg-cyan-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Process Delivery: {f.processDelivery ? 'Yes' : 'No'}
                        </button>
                      </div>
                    );})}
                    {localSupportingFiles.map((f, i) => {
                      const selected = selectedFileIds.has(f.id);
                      return (
                      <div key={f.id || i} className={`flex items-center gap-2 text-xs bg-[#0F172A] rounded px-3 py-1.5 border ${selected ? 'border-slate-700' : 'border-slate-800 opacity-50'}`}>
                        <input type="checkbox" checked={selected} onChange={() => toggleFileSelected(f.id)}
                          className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 accent-indigo-500 shrink-0" />
                        <span className="truncate flex-1 text-slate-300">{f.name}</span>
                        <span className="text-emerald-400 shrink-0">doc</span>
                        <input type="number" min="1" max="200" value={f.questionCount} disabled={!selected}
                          onChange={e => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: e.target.value } : x))}
                          onBlur={() => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, questionCount: Math.max(1, parseInt(x.questionCount) || 1) } : x))}
                          className="w-14 bg-slate-800 border border-slate-600 text-slate-100 rounded px-2 py-0.5 text-center focus:outline-none focus:border-amber-500 disabled:opacity-50" />
                        <span className="text-slate-500 shrink-0">Q</span>
                        <button type="button" disabled={!selected}
                          onClick={() => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, stakeholder: !x.stakeholder } : x))}
                          title={f.stakeholder ? 'Stakeholder questions ON — click to disable' : 'Stakeholder questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors disabled:opacity-50 ${f.stakeholder ? 'bg-amber-600/25 text-amber-300 border-amber-500/50 hover:bg-amber-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Stakeholder: {f.stakeholder ? 'Yes' : 'No'}
                        </button>
                        <button type="button" disabled={!selected}
                          onClick={() => setLocalSupportingFiles(p => p.map((x, j) => j === i ? { ...x, processDelivery: !x.processDelivery } : x))}
                          title={f.processDelivery ? 'Process Delivery questions ON — click to disable' : 'Process Delivery questions OFF — click to enable'}
                          className={`text-xs px-2.5 py-1 rounded-md shrink-0 font-medium border transition-colors disabled:opacity-50 ${f.processDelivery ? 'bg-cyan-600/25 text-cyan-300 border-cyan-500/50 hover:bg-cyan-600/40' : 'bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700/80 hover:text-slate-300'}`}>
                          Process Delivery: {f.processDelivery ? 'Yes' : 'No'}
                        </button>
                      </div>
                    );})}
                    <p className="text-xs text-indigo-300 font-semibold pt-1">Total: {localTotal} questions {selectedFileIds.size === 0 && <span className="text-red-400">— select at least one document</span>}</p>
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
                    onClick={() => handleRegen(false)}
                    disabled={regen || (hasFiles && selectedFileIds.size === 0)}
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
            <button
              onClick={() => { setQTypePicker(v => !v); setAddMode(false); }}
              disabled={!hasFeaturePermission('questions.edit')}
              title={!hasFeaturePermission('questions.edit') ? "You don't have permission to edit questions" : undefined}
              className="text-xs px-3 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
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
          {viewArchive ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-2.5">
                <p className="text-xs text-sky-200">
                  <strong>{viewArchive.label}</strong> — read-only snapshot · archived {viewArchive.createdAt ? new Date(viewArchive.createdAt).toLocaleString() : ''} · {viewArchive.questionCount} questions
                </p>
                <button onClick={() => setViewArchive(null)} className="text-xs px-3 py-1 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shrink-0">← Back to current questions</button>
              </div>
              {(viewArchive.questions || []).map((q, i) => (
                <QuestionCard key={q.id || i} q={q} index={i} readOnly />
              ))}
            </>
          ) : (<>
          {loading &&<p className="text-slate-400 text-sm text-center py-8">Loading question bank…</p>}
          {!loading && generating && questions.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600/10 border border-indigo-500/30">
                <span className="text-indigo-400 text-sm">⏳</span>
                <p className="text-indigo-300 text-sm font-medium">
                  {genProgress?.total
                    ? `Generating questions… ${genProgress.done}/${genProgress.total}`
                    : 'Generating questions from your documents…'}
                </p>
              </div>
              {genProgress?.total > 0 && (
                <div className="max-w-xs mx-auto h-1.5 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((genProgress.done / Math.max(1, genProgress.total)) * 100))}%` }}
                  />
                </div>
              )}
              <p className="text-slate-500 text-xs">
                {genProgress?.phase === 'throttled' && genProgress?.throttleMs > 0
                  ? `Paused ~${Math.round(genProgress.throttleMs / 1000)}s for the AI provider's rate limit — this is normal on the free tier.`
                  : 'This can take a few minutes on the free AI tier. This page updates automatically — you can leave it open.'}
              </p>
            </div>
          )}
          {/* Source breakdown for the run that just finished — answers "why are
              my questions generic?" with numbers instead of guesswork. */}
          {!generating && genDiagnostics && (
            <div className={`rounded-xl border p-3 ${genDiagnostics.templateFallback > 0 ? 'bg-amber-500/5 border-amber-500/30' : 'bg-emerald-500/5 border-emerald-500/25'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-xs font-bold ${genDiagnostics.templateFallback > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {genDiagnostics.templateFallback > 0
                      ? `⚠ ${genDiagnostics.fromSource} of ${genDiagnostics.requested} questions came from your documents — ${genDiagnostics.templateFallback} are generic templates`
                      : `✓ All ${genDiagnostics.requested} questions were generated from your documents`}
                  </p>
                  {genDiagnostics.templateFallback > 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      Generic templates appear when there isn't enough distinct source text to draw more specific questions from.
                      Regenerating won't fix this — add more detail to the documents below, then regenerate.
                    </p>
                  )}
                  {Array.isArray(genDiagnostics.perFile) && genDiagnostics.perFile.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {genDiagnostics.perFile.map((f, i) => (
                        <span key={i} className={`text-[11px] ${f.thin ? 'text-amber-400' : 'text-slate-500'}`}>
                          {f.name}: {f.chars.toLocaleString()} chars{f.thin ? ' ⚠ thin' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setGenDiagnostics(null)} className="text-slate-500 hover:text-white text-sm px-1 shrink-0">✕</button>
              </div>
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
              <div key={q.id || i} className={isEditing ? "bg-[#0F172A] border border-slate-700 rounded-xl p-4" : undefined}>
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
                  <QuestionCard
                    q={q} index={i} canEdit={hasFeaturePermission('questions.edit')} lockingQid={lockingQid}
                    onEdit={() => startEdit(realIdx)} onToggleLock={() => toggleQuestionLock(q)} onDelete={() => deleteQ(realIdx)}
                  />
                )}
              </div>
            );
          })}
          </>)}
        </div>

        <div className="p-4 border-t border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── History Modal (versions, regeneration/lock audit log, assignment history) ─
const AUDIT_EVENT_LABELS = {
  assessment_locked: '✓ Approved & assigned',
  assessment_unlocked: '🔓 Unlocked (legacy assessment-level)',
  assessment_regenerated: '✨ Regenerated',
  assessment_ai_regenerated: '🔄 AI-regenerated',
  assessment_modification_blocked: '🚫 Blocked edit attempt',
  question_locked: '🔒 Question locked',
  question_unlocked: '🔓 Question unlocked',
};

function HistoryModal({ role, onClose }) {
  const { notify: toast } = useNotification();
  const [tab, setTab] = useState('versions'); // 'versions' | 'audit' | 'assignments'
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [assignmentHistory, setAssignmentHistory] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [v, a, h] = await Promise.all([
          authFetch(`/api/roles/${role.id}/versions`),
          authFetch(`/api/roles/${role.id}/history`),
          authFetch(`/api/roles/${role.id}/assignment-history`),
        ]);
        setVersions((Array.isArray(v) ? v : v?.data ?? []).slice().sort((x, y) => y.version - x.version));
        setAuditLog(Array.isArray(a) ? a : a?.data ?? []);
        setAssignmentHistory(Array.isArray(h) ? h : h?.data ?? []);
      } catch (e) { toast(e.message, 'error'); }
      finally { setLoading(false); }
    })();
  }, [role.id]);

  const statusBadge = (status) => {
    const cls = status === 'approved' ? 'bg-emerald-900/40 text-emerald-400 border-emerald-700/50'
      : status === 'draft' ? 'bg-amber-900/40 text-amber-400 border-amber-700/50'
      : 'bg-slate-700/50 text-slate-400 border-slate-600';
    return <span className={`px-2 py-0.5 rounded-full text-xs border capitalize ${cls}`}>{status}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">📜 History — {role.roleName}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Version, regeneration, and assignment history</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex gap-1 px-5 pt-3 flex-shrink-0">
          {[['versions', `Versions (${versions.length})`], ['audit', `Timeline (${auditLog.length})`], ['assignments', `Assignments (${assignmentHistory.length})`]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-t-lg text-xs font-semibold transition-colors ${tab === key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 pt-3">
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-sm">Loading…</div>
          ) : tab === 'versions' ? (
            versions.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No versions yet.</p> : (
              <div className="space-y-2">
                {versions.map(v => (
                  <div key={v.id} className="bg-[#0F172A] border border-slate-700 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-white font-medium">Version {v.version} {statusBadge(v.status)}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {v.question_count} questions · created {v.created_at ? new Date(v.created_at).toLocaleString() : '—'}
                        {v.approved_at && <> · approved {new Date(v.approved_at).toLocaleString()} by {v.approved_by || '—'}</>}
                        {v.unlocked_at && <> · unlocked {new Date(v.unlocked_at).toLocaleString()} by {v.unlocked_by || '—'}</>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : tab === 'audit' ? (
            auditLog.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No recorded events yet.</p> : (
              <div className="space-y-2">
                {auditLog.map(entry => (
                  <div key={entry.logId} className="bg-[#0F172A] border border-slate-700 rounded-lg p-3">
                    <p className="text-sm text-white font-medium">{AUDIT_EVENT_LABELS[entry.eventType] || entry.eventType}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {new Date(entry.timestamp).toLocaleString()}
                      {entry.metadata?.newVersion && <> · version {entry.metadata.newVersion}</>}
                      {entry.metadata?.lockedCount != null && <> · {entry.metadata.lockedCount} locked, {entry.metadata.freshCount} regenerated</>}
                      {entry.metadata?.questionId && <> · question {entry.metadata.questionId.slice(0, 12)}…</>}
                    </p>
                  </div>
                ))}
              </div>
            )
          ) : (
            assignmentHistory.length === 0 ? <p className="text-sm text-slate-500 text-center py-8">No assignments yet.</p> : (
              <div className="space-y-2">
                {assignmentHistory.map(a => (
                  <div key={a.assessmentId} className="bg-[#0F172A] border border-slate-700 rounded-lg p-3">
                    <p className="text-sm text-white font-medium">{a.questionCount} questions assigned to {a.employeeCount} employee{a.employeeCount !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'} · {a.submittedCount}/{a.employeeCount} submitted
                    </p>
                  </div>
                ))}
              </div>
            )
          )}
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
  const [assessmentDate, setAssessmentDate] = useState('');
  // 'fixed' = one shared calendar deadline for every assignee (today's only
  // behavior). 'relative' = each employee's own deadline is their assignment
  // date + durationDays — the option a new employee joining later needs, so
  // they get a fair full-length window instead of inheriting the original
  // group's already-passed (or nearly-expired) calendar date.
  const [schedulingMode, setSchedulingMode] = useState('fixed');
  const [deadline, setDeadline] = useState('');
  const [durationDays, setDurationDays] = useState(5);
  const [locking, setLocking] = useState(false);

  const handleLock = async () => {
    setLocking(true);
    try {
      const payload = { schedulingMode };
      if (assessmentDate) payload.assessmentDate = new Date(assessmentDate).toISOString();
      if (schedulingMode === 'fixed' && deadline) payload.deadline = new Date(deadline).toISOString();
      if (schedulingMode === 'relative') payload.durationDays = Math.max(1, parseInt(durationDays) || 5);
      const res = await authFetch(`/api/roles/${role.id}/lock`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const count = res?.employeeCount ?? res?.data?.employeeAssignments?.length ?? 0;
      toast(`Assessment approved & assigned to ${count} employee${count !== 1 ? 's' : ''}`);
      onClose(res?.roleApproval || true);
    } catch (e) {
      toast(e.message || 'Failed to approve assessment', 'error');
    } finally {
      setLocking(false);
    }
  };

  const maxQ = role.questionBankCount || 50;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-white">✓ Approve Assessment</h2>
            <p className="text-sm text-slate-400 mt-0.5">{role.roleName}</p>
          </div>
          <button onClick={() => onClose(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <p className="text-xs text-emerald-300">
              This publishes the current <strong>{maxQ}-question bank</strong> exactly as-is and assigns it to every employee with the role <strong>"{role.roleName}"</strong>. You can still lock individual questions and regenerate the rest at any time afterward — a future approval creates a new version without affecting employees already assigned to this one.
            </p>
          </div>
          <div>
            <label className={labelCls}>Start Date &amp; Time <span className="text-slate-500">(optional)</span></label>
            <input
              type="datetime-local"
              className={inputCls}
              value={assessmentDate}
              onChange={e => setAssessmentDate(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">Employees won't see this assessment until this date/time. Leave blank to make it available immediately.</p>
          </div>
          <div>
            <label className={labelCls}>Deadline</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setSchedulingMode('fixed')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border ${schedulingMode === 'fixed' ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-600 text-slate-400'}`}
              >
                Fixed date
              </button>
              <button
                type="button"
                onClick={() => setSchedulingMode('relative')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border ${schedulingMode === 'relative' ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-600 text-slate-400'}`}
              >
                Duration per employee
              </button>
            </div>
            {schedulingMode === 'fixed' ? (
              <>
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={deadline}
                  onChange={e => setDeadline(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">Same calendar deadline for every employee, including anyone who joins this role later. Leave blank for no deadline.</p>
              </>
            ) : (
              <>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={durationDays}
                  onChange={e => setDurationDays(e.target.value)}
                />
                <p className="text-xs text-slate-500 mt-1">Days each employee gets from THEIR OWN assignment date. A new employee joining this role next month still gets the full {durationDays || 5}-day window, starting from their join date — not the original group's deadline.</p>
              </>
            )}
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => onClose(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-slate-400">
              Cancel
            </button>
            <button onClick={handleLock} disabled={locking} className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {locking ? 'Approving…' : '✓ Approve & Assign'}
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
  const { hasFeaturePermission } = useAuth();
  const [roles, setRoles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [modal, setModal]         = useState(null); // null | {type:'add'|'edit'|'view'|'import', role?}
  const [delId, setDelId]         = useState(null);
  const [qBankRole, setQBankRole] = useState(null); // role to view question bank for
  const [approveRole, setApproveRole] = useState(null); // role to approve assessment for
  const [historyRole, setHistoryRole] = useState(null); // role to view version/audit/assignment history for

  // Fired by QuestionBankModal the moment it learns generation produced
  // questions — updates the table row's count immediately (so the Approve
  // button appears without a manual page reload) rather than waiting for the
  // next full `load()`.
  const handleBankGenerated = (roleId, count) => {
    setRoles(prev => prev.map(r => r.id === roleId ? { ...r, questionBankCount: count } : r));
  };

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
          <button onClick={() => setModal({ type: 'import' })}
            disabled={!hasFeaturePermission('roles.import')}
            title={!hasFeaturePermission('roles.import') ? "You don't have permission to import roles" : undefined}
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Import
          </button>
          <button onClick={() => setModal({ type: 'add' })}
            disabled={!hasFeaturePermission('roles.create')}
            title={!hasFeaturePermission('roles.create') ? "You don't have permission to add roles" : undefined}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
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
                      <button onClick={() => setModal({ type: 'edit', role })}
                        disabled={!hasFeaturePermission('roles.edit')}
                        title={!hasFeaturePermission('roles.edit') ? "You don't have permission to edit roles" : undefined}
                        className="text-xs px-2 py-1 rounded bg-indigo-600/30 text-indigo-300 hover:bg-indigo-600/50 disabled:opacity-40 disabled:cursor-not-allowed">Edit</button>
                      <button onClick={() => setQBankRole(role)} className="text-xs px-2 py-1 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 whitespace-nowrap">
                        📚 Questions{role.questionBankCount ? ` (${role.questionBankCount})` : ''}
                      </button>
                      {role.questionBankCount > 0 && (
                        role.approved ? (
                          <button disabled title={role.approvedAt ? `Approved ${new Date(role.approvedAt).toLocaleString()} — questions are locked` : 'Approved — questions are locked'}
                            className="text-xs px-2 py-1 rounded bg-emerald-900/30 text-emerald-500 whitespace-nowrap border border-emerald-800/40 cursor-default opacity-80">
                            ✓ Approved
                          </button>
                        ) : (
                          <button onClick={() => setApproveRole(role)} className="text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 whitespace-nowrap border border-emerald-500/30">
                            ✓ Approve
                          </button>
                        )
                      )}
                      <button onClick={() => setHistoryRole(role)} className="text-xs px-2 py-1 rounded bg-sky-600/20 text-sky-300 hover:bg-sky-600/40 whitespace-nowrap" title="Version, regeneration, and assignment history">
                        📜 History
                      </button>
                      <button onClick={() => setDelId(role.id)}
                        disabled={!hasFeaturePermission('roles.edit')}
                        title={!hasFeaturePermission('roles.edit') ? "You don't have permission to delete roles" : undefined}
                        className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 disabled:opacity-40 disabled:cursor-not-allowed">Delete</button>
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
          onRoleUpdated={updated => {
            setRoles(prev => prev.map(r => r.id === updated.id ? updated : r));
            setModal(m => (m?.type === 'view' ? { ...m, role: updated } : m));
          }}
        />
      )}
      {modal?.type === 'import' && (
        <ImportModal onClose={() => setModal(null)} onImported={() => { setModal(null); load(); }} />
      )}

      {/* Question Bank Modal */}
      {qBankRole && (
        <QuestionBankModal role={qBankRole} onClose={() => setQBankRole(null)} onGenerated={handleBankGenerated} onApprove={setApproveRole} />
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

      {/* History Modal (versions, regeneration audit, assignment history) */}
      {historyRole && (
        <HistoryModal role={historyRole} onClose={() => setHistoryRole(null)} />
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
