import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const isEdit = !!role;

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
            <label className={labelCls}>Job Description</label>
            <textarea className={inputCls} rows={7} value={form.jobDescription} onChange={f('jobDescription')} placeholder="Paste the full job description here..." />
            <p className="text-xs text-slate-500 mt-1">{form.jobDescription.length.toLocaleString()} chars</p>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoleLibrary() {
  const [roles, setRoles]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [modal, setModal]         = useState(null); // null | {type:'add'|'edit'|'view'|'import', role?}
  const [delId, setDelId]         = useState(null);

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
                <th className={thCls}>Skills</th>
                <th className={thCls}>JD</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((role, i) => (
                <tr key={role.id} className={`border-b border-slate-700/50 hover:bg-slate-700/20 ${i % 2 === 0 ? '' : 'bg-slate-800/20'}`}>
                  <td className="px-4 py-3 font-medium text-white">{role.roleName}</td>
                  <td className="px-4 py-3 text-slate-400">{role.department || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(role.skills || []).slice(0, 3).map(s => (
                        <span key={s} className="px-1.5 py-0.5 rounded text-xs bg-slate-700 text-slate-300">{s}</span>
                      ))}
                      {(role.skills || []).length > 3 && <span className="text-xs text-slate-500">+{role.skills.length - 3}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {role.jobDescription
                      ? <span className="text-emerald-400 text-xs">✓ {role.jobDescription.length.toLocaleString()} chars</span>
                      : <span className="text-slate-600 text-xs">—</span>}
                  </td>
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
                      <button onClick={async () => {
                        try {
                          await authFetch(`/api/roles/${role.id}/generate-assessment`, { method: 'POST', body: JSON.stringify({ questionCount: 10 }) });
                          toast(`Assessment template generated for ${role.roleName}`);
                          load();
                        } catch (e) { toast(e.message, 'error'); }
                      }} className="text-xs px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 whitespace-nowrap">
                        {role.assessmentTemplateId ? '↻ Regen' : '⚡ Gen Assessment'}
                      </button>
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
