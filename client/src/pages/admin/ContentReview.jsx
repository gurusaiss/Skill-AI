import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../utils/authFetch.js';

const toast = (msg, type = 'success') => {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;color:#fff;background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b'};box-shadow:0 4px 12px rgba(0,0,0,.3);`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

const TIER_COLORS = {
  Outstanding: '#10B981', Excellent: '#22C55E', Good: '#84CC16',
  Average: '#EAB308', 'Needs Improvement': '#F97316', 'Critical Improvement Required': '#EF4444',
};

function ScoreBadge({ score }) {
  const color = score >= 85 ? '#10B981' : score >= 70 ? '#EAB308' : '#EF4444';
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44` }}
      className="px-2 py-0.5 rounded-full text-xs font-bold">
      {score}%
    </span>
  );
}

function StatusBadge({ status }) {
  const map = { active: ['bg-emerald-500/10 text-emerald-400 border-emerald-500/20', 'Active'],
    pending: ['bg-amber-500/10 text-amber-400 border-amber-500/20', 'Pending Review'],
    approved: ['bg-indigo-500/10 text-indigo-400 border-indigo-500/20', 'Approved'],
    rejected: ['bg-red-500/10 text-red-400 border-red-500/20', 'Rejected'] };
  const [cls, label] = map[status] || map.active;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>{label}</span>;
}

function TypeBadge({ type }) {
  const map = { assessment: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    assessment_template: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    module: 'bg-teal-500/10 text-teal-300 border-teal-500/20',
    learning_path: 'bg-orange-500/10 text-orange-300 border-orange-500/20' };
  const labels = { assessment: 'Assessment', assessment_template: 'Template', module: 'Module', learning_path: 'Learning Path' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${map[type] || map.assessment}`}>{labels[type] || type}</span>;
}

// ── Question Editor ───────────────────────────────────────────────────────────

function QuestionEditor({ assessment, onSaved, onClose }) {
  // Normalise: questions live in .questions or in employeeAssignments[0].questions
  const getQs = (a) => a?.questions || a?.employeeAssignments?.[0]?.questions || [];
  const [qs, setQs] = useState(() => getQs(assessment).map((q, i) => ({ ...q, _key: i })));
  const [saving, setSaving] = useState(false);

  const update = (idx, field, val) =>
    setQs(prev => prev.map((q, i) => i === idx ? { ...q, [field]: val } : q));

  const updateOption = (qIdx, optIdx, val) =>
    setQs(prev => prev.map((q, i) => {
      if (i !== qIdx) return q;
      const opts = [...(q.options || [])];
      opts[optIdx] = val;
      return { ...q, options: opts };
    }));

  const addQuestion = () =>
    setQs(prev => [...prev, {
      question: '', type: 'mcq', difficulty: 'medium', skillArea: '',
      options: ['Option A', 'Option B', 'Option C', 'Option D'], correctAnswer: 0,
      _key: Date.now(),
    }]);

  const removeQuestion = (idx) => setQs(prev => prev.filter((_, i) => i !== idx));

  const save = async () => {
    if (qs.some(q => !q.question?.trim())) { toast('All questions must have text', 'error'); return; }
    setSaving(true);
    try {
      const cleanQs = qs.map(({ _key, ...q }) => q);
      // Build body — update both .questions and inside employeeAssignments if present
      const body = { questions: cleanQs };
      if (assessment.employeeAssignments?.length > 0) {
        body.employeeAssignments = assessment.employeeAssignments.map(ea => ({ ...ea, questions: cleanQs }));
        body.questionCount = cleanQs.length;
      }
      await authFetch(`/api/assessments/${assessment.id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast(`Questions saved (${cleanQs.length} total)`);
      onSaved();
    } catch { toast('Failed to save questions', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">Edit Questions</h2>
            <p className="text-slate-400 text-xs mt-0.5 truncate max-w-sm">{assessment.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {qs.map((q, qi) => (
            <div key={q._key} className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-4">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-xs font-bold text-indigo-400 mt-2 flex-shrink-0">Q{qi + 1}</span>
                <div className="flex-1">
                  <textarea value={q.question} onChange={e => update(qi, 'question', e.target.value)}
                    rows={2} placeholder="Question text..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none" />
                </div>
                <button onClick={() => removeQuestion(qi)}
                  className="flex-shrink-0 px-2 py-1 rounded-lg bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs transition-colors mt-1">
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                {(q.options || []).map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-1.5">
                    <button onClick={() => update(qi, 'correctAnswer', oi)}
                      className={`flex-shrink-0 w-4 h-4 rounded-full border-2 transition-colors ${q.correctAnswer === oi ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600 hover:border-slate-400'}`} />
                    <input value={opt} onChange={e => updateOption(qi, oi, e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <select value={q.difficulty || 'medium'} onChange={e => update(qi, 'difficulty', e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none">
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <input value={q.skillArea || ''} onChange={e => update(qi, 'skillArea', e.target.value)}
                  placeholder="Skill area..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none" />
              </div>
            </div>
          ))}

          <button onClick={addQuestion}
            className="w-full py-3 border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl text-slate-500 hover:text-indigo-400 text-sm font-semibold transition-colors">
            + Add Question
          </button>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-700/60 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-sm transition-colors">
            {saving ? 'Saving…' : `Save ${qs.length} Questions`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ContentReview() {
  const [items, setItems] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('generated'); // 'generated' | 'assessments' | 'thresholds'
  const [selected, setSelected] = useState(null);
  const [previewAssessment, setPreviewAssessment] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editingAssessment, setEditingAssessment] = useState(null);
  const [thresholds, setThresholds] = useState([]);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [genRes, assRes, thrRes] = await Promise.all([
        authFetch('/api/assessments/generated-content').catch(() => ({ data: [] })),
        authFetch('/api/assessments?autoGenerated=true').catch(() => ({ data: [] })),
        authFetch('/api/assessments/thresholds').catch(() => ({ data: { thresholds: [] } })),
      ]);
      setItems(genRes?.data || []);
      const allAss = assRes?.data || [];
      setAssessments(allAss.filter(a => a.isAutoGenerated));
      setThresholds(thrRes?.data?.thresholds || [
        { min: 95, label: 'Outstanding', color: '#10B981' },
        { min: 85, label: 'Excellent', color: '#22C55E' },
        { min: 75, label: 'Good', color: '#84CC16' },
        { min: 60, label: 'Average', color: '#EAB308' },
        { min: 40, label: 'Needs Improvement', color: '#F97316' },
        { min: 0, label: 'Critical Improvement Required', color: '#EF4444' },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const viewAssessment = async (contentId) => {
    if (!contentId) return;
    setPreviewLoading(true);
    try {
      const res = await authFetch(`/api/assessments/${contentId}`);
      setPreviewAssessment(res?.data || null);
    } catch { toast('Failed to load assessment', 'error'); }
    finally { setPreviewLoading(false); }
  };

  const regenerate = async (roleId, roleName) => {
    if (!roleId) return toast('No role ID available to regenerate', 'warning');
    try {
      await authFetch(`/api/roles/${roleId}/generate-assessment`, { method: 'POST', body: JSON.stringify({ questionCount: 10 }) });
      toast(`Assessment regenerated for ${roleName}`);
      load();
    } catch { toast('Regeneration failed', 'error'); }
  };

  const bulkGenerate = async () => {
    try {
      const res = await authFetch('/api/roles/bulk-generate-assessments', { method: 'POST' });
      toast(`Bulk generation started — ${res?.data?.queued || 0} roles queued`);
    } catch { toast('Bulk generation failed', 'error'); }
  };

  const saveThresholds = async () => {
    setThresholdSaving(true);
    try {
      await authFetch('/api/assessments/thresholds', { method: 'PUT', body: JSON.stringify({ thresholds }) });
      toast('Thresholds saved');
    } catch { toast('Failed to save thresholds', 'error'); }
    finally { setThresholdSaving(false); }
  };

  const updateThreshold = (i, key, val) => {
    setThresholds(prev => prev.map((t, idx) => idx === i ? { ...t, [key]: key === 'min' ? parseInt(val) || 0 : val } : t));
  };

  const filtered = assessments.filter(a => {
    const q = search.toLowerCase();
    const matchSearch = !q || a.title?.toLowerCase().includes(q) || a.roleName?.toLowerCase().includes(q);
    const matchType = filterType === 'all' || (filterType === 'template' ? a.isTemplate : !a.isTemplate);
    return matchSearch && matchType;
  });

  const tabs = [
    { id: 'assessments', label: 'Generated Assessments', count: assessments.length },
    { id: 'generated', label: 'Content Log', count: items.length },
    { id: 'thresholds', label: 'Score Thresholds', count: null },
  ];

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 p-6">
      {editingAssessment && (
        <QuestionEditor
          assessment={editingAssessment}
          onClose={() => setEditingAssessment(null)}
          onSaved={() => { setEditingAssessment(null); viewAssessment(editingAssessment.id); load(); }}
        />
      )}
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Content Review</h1>
            <p className="text-slate-400 text-sm mt-1">Review, edit and manage all AI-generated assessments, modules and learning paths</p>
          </div>
          <button onClick={bulkGenerate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
            ⚡ Bulk Generate Assessments
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/50 p-1 rounded-xl mb-6 w-fit">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {t.label}
              {t.count !== null && <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${tab === t.id ? 'bg-white/20' : 'bg-slate-700'}`}>{t.count}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin text-indigo-400 text-4xl">⟳</div>
          </div>
        ) : (
          <>
            {/* ── Generated Assessments Tab ── */}
            {tab === 'assessments' && (
              <div className="flex gap-6">
                <div className="flex-1">
                  {/* Filters */}
                  <div className="flex gap-3 mb-4">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by role or title..."
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500" />
                    <select value={filterType} onChange={e => setFilterType(e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300">
                      <option value="all">All Types</option>
                      <option value="template">Templates</option>
                      <option value="employee">Employee</option>
                    </select>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="text-center py-16 text-slate-500">
                      <div className="text-4xl mb-3">📋</div>
                      <p className="font-medium">No generated assessments yet</p>
                      <p className="text-sm mt-1">Create users with job roles or use Bulk Generate to create templates</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filtered.map(a => (
                        <div key={a.id} onClick={() => { setSelected(a); viewAssessment(a.id); }}
                          className={`p-4 rounded-xl border cursor-pointer transition-all ${selected?.id === a.id ? 'bg-indigo-600/10 border-indigo-500/50' : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium text-sm text-white truncate">{a.title}</span>
                                {a.isTemplate && <TypeBadge type="assessment_template" />}
                                {!a.isTemplate && <TypeBadge type="assessment" />}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-400">
                                {a.roleName && <span>👤 {a.roleName}</span>}
                                <span>❓ {a.questionCount || (a.questions?.length) || 0} questions</span>
                                <span>🕐 {a.duration || 30} min</span>
                                {a.createdAt && <span>{new Date(a.createdAt).toLocaleDateString()}</span>}
                              </div>
                              {a.targetUsers?.length > 0 && (
                                <div className="mt-1 text-xs text-slate-500">Assigned to {a.targetUsers.length} employee{a.targetUsers.length > 1 ? 's' : ''}</div>
                              )}
                            </div>
                            <div className="flex gap-2 ml-3">
                              <button onClick={e => { e.stopPropagation(); regenerate(a.roleId, a.roleName || a.title); }}
                                className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors">
                                ↻ Regen
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preview panel */}
                {(selected || previewLoading) && (
                  <div className="w-96 bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 h-fit sticky top-6 overflow-y-auto max-h-[80vh] flex flex-col gap-3">
                    {previewLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <div className="animate-spin text-indigo-400 text-2xl">⟳</div>
                      </div>
                    ) : previewAssessment ? (
                      <>
                        <div>
                          <h3 className="font-semibold text-white mb-1 text-sm">{previewAssessment.title}</h3>
                          <p className="text-xs text-slate-400">{previewAssessment.roleName || '—'} · {(previewAssessment.questions || previewAssessment.employeeAssignments?.[0]?.questions || []).length} questions</p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button onClick={() => setEditingAssessment(previewAssessment)}
                            className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">
                            ✏️ Edit Questions
                          </button>
                          <button onClick={() => regenerate(previewAssessment.roleId || selected?.roleId, previewAssessment.roleName || selected?.roleName || previewAssessment.title)}
                            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold transition-colors">
                            ↻ Regen
                          </button>
                        </div>

                        <div className="space-y-2">
                          {(previewAssessment.questions || previewAssessment.employeeAssignments?.[0]?.questions || []).map((q, i) => (
                            <div key={i} className="bg-slate-900/50 rounded-lg p-3">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-bold text-indigo-400">Q{i + 1}</span>
                                <span className="text-xs text-slate-500">{q.difficulty} · {q.type}</span>
                                {q.skillArea && <span className="text-xs text-slate-600 truncate">· {q.skillArea}</span>}
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed">{q.question}</p>
                              {q.options?.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {q.options.map((opt, oi) => (
                                    <div key={oi} className={`text-xs px-2 py-0.5 rounded ${oi === q.correctAnswer ? 'text-emerald-400 bg-emerald-900/20' : 'text-slate-500'}`}>
                                      {oi === q.correctAnswer ? '✓ ' : '  '}{opt}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : <p className="text-slate-500 text-sm">Select an assessment to preview</p>}
                  </div>
                )}
              </div>
            )}

            {/* ── Content Log Tab ── */}
            {tab === 'generated' && (
              <div>
                {items.length === 0 ? (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-4xl mb-3">📦</div>
                    <p>No generated content logged yet</p>
                    <p className="text-sm mt-1">Content gets logged automatically when users are created or assessments are submitted</p>
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-700/50">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-800/80">
                        <tr>
                          {['Type', 'Employee / Role', 'Trigger', 'Status', 'Generated', 'Actions'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {items.map(item => (
                          <tr key={item.id} className="bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                            <td className="px-4 py-3"><TypeBadge type={item.type} /></td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-200 text-xs">{item.userName || item.roleName || '—'}</div>
                              {item.jobRole && <div className="text-slate-500 text-xs">{item.jobRole}</div>}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">{item.trigger?.replace(/_/g, ' ') || '—'}</td>
                            <td className="px-4 py-3"><StatusBadge status={item.status || 'active'} /></td>
                            <td className="px-4 py-3 text-xs text-slate-500">{item.generatedAt ? new Date(item.generatedAt).toLocaleDateString() : '—'}</td>
                            <td className="px-4 py-3">
                              {item.contentId && (
                                <button onClick={() => { setTab('assessments'); viewAssessment(item.contentId); }}
                                  className="text-xs text-indigo-400 hover:text-indigo-300 underline">
                                  View
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── Thresholds Tab ── */}
            {tab === 'thresholds' && (
              <div className="max-w-2xl">
                <p className="text-slate-400 text-sm mb-6">
                  Configure performance classification thresholds for your company. These determine how employee scores are labelled in reports and used to assign learning paths.
                </p>
                <div className="space-y-3 mb-6">
                  {thresholds.map((t, i) => (
                    <div key={i} className="flex items-center gap-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                      <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: t.color }} />
                      <div className="flex-1 grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Min Score</label>
                          <input type="number" min="0" max="100" value={t.min}
                            onChange={e => updateThreshold(i, 'min', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Label</label>
                          <input value={t.label} onChange={e => updateThreshold(i, 'label', e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 block mb-1">Color</label>
                          <div className="flex gap-2 items-center">
                            <input type="color" value={t.color} onChange={e => updateThreshold(i, 'color', e.target.value)}
                              className="h-8 w-12 rounded cursor-pointer border border-slate-600 bg-transparent" />
                            <input value={t.color} onChange={e => updateThreshold(i, 'color', e.target.value)}
                              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Preview */}
                <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mb-6">
                  <h3 className="text-sm font-semibold text-slate-300 mb-3">Preview</h3>
                  <div className="flex flex-wrap gap-2">
                    {[...thresholds].sort((a, b) => b.min - a.min).map((t, i) => (
                      <span key={i} style={{ background: t.color + '22', color: t.color, border: `1px solid ${t.color}44` }}
                        className="px-3 py-1 rounded-full text-xs font-semibold">
                        ≥{t.min}% — {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <button onClick={saveThresholds} disabled={thresholdSaving}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors">
                  {thresholdSaving ? 'Saving…' : 'Save Thresholds'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
