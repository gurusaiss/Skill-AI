/**
 * ModuleSession.jsx
 * Day/session learning view inside a module.
 * Route: /module/:moduleId/session/:sessionIndex?assignmentId=xxx
 *
 * Flow:
 *  1. Show session content (definitions, key points, explanations, notes)
 *  2. Generate 10 questions via AI (70% MCQ, 30% subjective/fill-blank)
 *  3. Show score, strengths, weaknesses after quiz completion
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { authFetch } from '../utils/authFetch.js';
import { useAuth } from '../contexts/AuthContext';

// ─── Content phase ────────────────────────────────────────────────────────────

// Real PDF export (jsPDF, text/vector only — no HTML rendering) covering the
// full session: definitions, key points, explanation, and the quiz results
// when the session has already been completed. jsPDF is loaded on demand
// (dynamic import) rather than at module load — its package pulls in
// html2canvas/svg2pdf as part of the same bundle graph even though this code
// never uses the .html() feature, which would otherwise add ~140KB gzipped
// to every employee's initial load of this route just to support a button
// most sessions won't click every time.
async function downloadSessionNotesPDF(session, sessionIndex, moduleTitle, quizResults) {
  const { jsPDF } = await import('jspdf');
  const title = session.title || session.topic || `Day ${sessionIndex + 1}`;
  const keyPoints = session.keyPoints || session.key_points || session.topics || [];
  const definitions = session.definitions || [];
  const notes = session.notes || session.content || '';
  const explanation = session.explanation || '';
  const learningObjectives = session.learningObjectives || [];

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin) { doc.addPage(); y = margin; }
  };
  const heading = (text) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(30, 41, 59);
    doc.text(text, margin, y);
    y += 8;
    doc.setDrawColor(226, 232, 240).line(margin, y, pageWidth - margin, y);
    y += 16;
  };
  const paragraph = (text, { bold = false, size = 10, color = [51, 65, 85], gap = 6 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach(line => {
      ensureSpace(size * 1.4);
      doc.text(line, margin, y);
      y += size * 1.4;
    });
    y += gap;
  };
  const bullet = (text, indent = 14) => {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text, maxWidth - indent);
    lines.forEach((line, i) => {
      ensureSpace(14);
      doc.text(i === 0 ? `•  ${line}` : `   ${line}`, margin, y);
      y += 14;
    });
  };

  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(99, 102, 241);
  doc.text((moduleTitle || 'Learning Module').toUpperCase(), margin, y);
  y += 22;
  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(15, 23, 42);
  doc.text(`Day ${sessionIndex + 1}: ${title}`, margin, y);
  y += 24;
  if (session.description) paragraph(session.description, { color: [71, 85, 105], gap: 12 });

  if (learningObjectives.length > 0) {
    heading('Learning Objectives');
    learningObjectives.forEach(o => bullet(typeof o === 'string' ? o : JSON.stringify(o)));
    y += 8;
  }

  if (definitions.length > 0) {
    heading('Key Definitions');
    definitions.forEach(d => {
      const term = typeof d === 'string' ? d : d.term || d.word || '';
      paragraph(term, { bold: true, size: 10.5, color: [15, 23, 42], gap: 2 });
      if (d.definition) paragraph(d.definition, { size: 10, color: [71, 85, 105], gap: 10 });
    });
  }

  const subtopics = session.subtopics || [];
  if (subtopics.length > 0) {
    heading("What You'll Cover");
    subtopics.forEach(s => {
      const name = typeof s === 'string' ? s : s.name;
      if (!name) return;
      bullet(name + (s.minutes ? ` (${s.minutes} min)` : ''));
      if (s.summary) paragraph(s.summary, { size: 9.5, color: [100, 116, 139], gap: 6 });
    });
    y += 4;
  }

  // Explanation and Notes are separate fields — this used to print only
  // `explanation || notes`, silently dropping Notes whenever Explanation was
  // present, same bug as the on-screen render before this fix.
  if (explanation) { heading('Explanation'); paragraph(explanation, { gap: 12 }); }
  if (notes && notes !== explanation) { heading('Notes'); paragraph(notes, { gap: 12 }); }

  // contentVersion 2 blocks: walk the DATA, not the DOM (charts/tables render
  // as text grids/lists — cheap, and works identically whether or not the
  // on-screen block ever rendered).
  const blocks = Array.isArray(session.blocks) ? session.blocks : [];
  for (const b of blocks) {
    if (!b || !b.type) continue;
    switch (b.type) {
      case 'prose':
        if (b.heading) heading(b.heading);
        if (b.body) paragraph(b.body, { gap: 12 });
        break;
      case 'flowchart':
        heading(b.title || 'Process');
        (b.steps || []).forEach((s, i) => bullet(`${i + 1}. ${typeof s === 'string' ? s : [s.label, s.detail].filter(Boolean).join(' — ')}`));
        y += 6;
        break;
      case 'bar':
      case 'pie':
        heading(b.title || 'Chart');
        (b.data || []).forEach(d => bullet(`${d.label} — ${d.value}${b.unit ? ` ${b.unit}` : ''}`));
        if (b.insight) paragraph(b.insight, { size: 9.5, color: [100, 116, 139], gap: 10 });
        break;
      case 'comparison':
        heading(b.title || 'Comparison');
        paragraph((b.columns || []).join('  |  '), { bold: true, size: 9.5, gap: 4 });
        (b.rows || []).forEach(r => paragraph(Array.isArray(r) ? r.join('  |  ') : String(r), { size: 9.5, gap: 4 }));
        y += 6;
        break;
      case 'lessonPlan':
        heading(b.title || "Lesson Plan");
        (b.rows || []).forEach(r => bullet(`${r.subtopic} — ${r.outcome}${r.minutes ? ` (${r.minutes} min)` : ''}`));
        y += 6;
        break;
      case 'example':
        heading(b.title || `Example${b.company ? `: ${b.company}` : ''}`);
        if (b.scenario) paragraph(b.scenario, { size: 9.5, gap: 4 });
        if (b.action) paragraph(`What they did: ${b.action}`, { size: 9.5, color: [100, 116, 139], gap: 4 });
        if (b.outcome) paragraph(`Result: ${b.outcome}`, { size: 9.5, color: [100, 116, 139], gap: 4 });
        if (b.takeaway) paragraph(`→ ${b.takeaway}`, { bold: true, size: 9.5, color: [16, 128, 87], gap: 10 });
        break;
      case 'callout':
        heading(b.title || 'Note');
        if (b.body) paragraph(b.body, { size: 9.5, gap: 10 });
        break;
      case 'checklist':
        heading(b.title || 'Checklist');
        (b.items || []).forEach(it => bullet(`☐ ${it}`));
        y += 6;
        break;
      default:
        break;
    }
  }

  const abbreviations = session.abbreviations || [];
  if (abbreviations.length > 0) {
    heading('Abbreviations');
    abbreviations.forEach(a => bullet(`${a.short} — ${a.full}${a.note ? ` (${a.note})` : ''}`));
    y += 6;
  }

  const mnemonics = session.mnemonics || [];
  if (mnemonics.length > 0) {
    heading('Memory Aids');
    mnemonics.forEach(m => {
      paragraph(m.device, { bold: true, size: 11, color: [88, 28, 135], gap: 2 });
      if (m.expands) paragraph(m.expands, { size: 9.5, gap: 2 });
      if (m.howToUse) paragraph(m.howToUse, { size: 9, color: [100, 116, 139], gap: 8 });
    });
  }

  const keepInMind = session.keepInMind || [];
  if (keepInMind.length > 0) {
    heading('Keep In Mind');
    keepInMind.forEach(p => {
      bullet(`[${(p.severity || 'important').toUpperCase()}] ${p.point}`);
      if (p.why) paragraph(p.why, { size: 9, color: [100, 116, 139], gap: 6 });
    });
  }

  const cardDeck = session.cardDeck || [];
  if (cardDeck.length > 0) {
    heading(`Recall Cards (${cardDeck.length})`);
    cardDeck.forEach((c, i) => {
      paragraph(`${i + 1}. ${c.front}`, { bold: true, size: 9.5, color: [15, 23, 42], gap: 2 });
      if (c.back) paragraph(c.back, { size: 9.5, color: [71, 85, 105], gap: 8 });
    });
  }

  if (keyPoints.length > 0) {
    heading('Key Points');
    keyPoints.forEach(p => bullet(typeof p === 'string' ? p : p.title || p.point || JSON.stringify(p)));
    y += 8;
  }

  if (Array.isArray(quizResults) && quizResults.length > 0) {
    heading('Knowledge Quiz Results');
    quizResults.forEach((r, i) => {
      paragraph(`${i + 1}. ${r.question}`, { bold: true, size: 10, color: [15, 23, 42], gap: 2 });
      paragraph(`${r.isCorrect ? '✓ Correct' : '✗ Incorrect'} — your answer: ${r.userAnswer || '(no answer)'}${!r.isCorrect ? `  |  correct: ${r.answer}` : ''}`,
        { size: 9.5, color: r.isCorrect ? [16, 128, 87] : [190, 40, 40], gap: r.explanation ? 2 : 10 });
      if (r.explanation) paragraph(r.explanation, { size: 9.5, color: [100, 116, 139], gap: 12 });
    });
  }

  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(148, 163, 184);
  doc.text(`Downloaded from SkillForge AI · ${new Date().toLocaleDateString()}`, margin, pageHeight - 24);

  doc.save(`Day${sessionIndex + 1}-${title.replace(/[^a-z0-9]/gi, '-')}-Notes.pdf`);
}

// Lightweight, dependency-free chart/diagram rendering for session content —
// flowchart as a connected step list, bar/pie via plain CSS (no charting
// library needed for a handful of values, keeps this route's bundle light).
const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899'];

function SessionVisual({ visual }) {
  if (!visual || visual.type === 'none' || !visual.type) return null;

  if (visual.type === 'flowchart' && Array.isArray(visual.flowSteps) && visual.flowSteps.length > 0) {
    return (
      <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        {visual.title && <h2 className="text-xs font-bold text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span>🔀</span> {visual.title}</h2>}
        <div className="space-y-0">
          {visual.flowSteps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center flex-shrink-0">
                <span className="w-8 h-8 rounded-full bg-cyan-600/25 border border-cyan-500/40 flex items-center justify-center text-xs font-black text-cyan-300">{i + 1}</span>
                {i < visual.flowSteps.length - 1 && <span className="w-px flex-1 bg-cyan-500/30 my-1" style={{ minHeight: '1.25rem' }} />}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed pb-4">{typeof step === 'string' ? step : step.label || JSON.stringify(step)}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if ((visual.type === 'bar' || visual.type === 'pie') && Array.isArray(visual.data) && visual.data.length > 0) {
    const data = visual.data.filter(d => d && typeof d.value === 'number').slice(0, 8);
    if (data.length === 0) return null;
    const max = Math.max(...data.map(d => d.value), 1);
    const total = data.reduce((s, d) => s + d.value, 0) || 1;

    if (visual.type === 'pie') {
      let acc = 0;
      const stops = data.map((d, i) => {
        const start = (acc / total) * 360;
        acc += d.value;
        const end = (acc / total) * 360;
        return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}deg ${end}deg`;
      }).join(', ');
      return (
        <section className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
          {visual.title && <h2 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span>🥧</span> {visual.title}</h2>}
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="w-36 h-36 rounded-full flex-shrink-0" style={{ background: `conic-gradient(${stops})` }} />
            <ul className="space-y-1.5 w-full">
              {data.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="flex-1">{d.label}</span>
                  <span className="text-slate-500 font-semibold">{Math.round((d.value / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }

    return (
      <section className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5">
        {visual.title && <h2 className="text-xs font-bold text-purple-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span>📊</span> {visual.title}</h2>}
        <div className="space-y-2.5">
          {data.map((d, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                <span>{d.label}</span>
                <span className="text-slate-500 font-semibold">{d.value}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
}

// ─── Deep content blocks (contentVersion 2) ───────────────────────────────────
// Each day now arrives as an ordered `blocks` array so the page reads as
// several varied pages instead of one wall of prose. Rendered with plain
// CSS/SVG rather than a charting library on purpose: the values are a handful
// of hand-authored categories, and the PDF exporter walks the DATA (not the
// DOM), so a canvas-based library would add weight without helping export.

function BlockShell({ tone = 'slate', icon, title, children }) {
  const tones = {
    slate:  'border-slate-700/50 bg-slate-800/30',
    cyan:   'border-cyan-500/20 bg-cyan-500/5',
    purple: 'border-purple-500/20 bg-purple-500/5',
    emerald:'border-emerald-500/20 bg-emerald-500/5',
    amber:  'border-amber-500/20 bg-amber-500/5',
    rose:   'border-rose-500/20 bg-rose-500/5',
    indigo: 'border-indigo-500/20 bg-indigo-500/5',
  };
  const text = {
    slate: 'text-slate-400', cyan: 'text-cyan-400', purple: 'text-purple-400',
    emerald: 'text-emerald-400', amber: 'text-amber-400', rose: 'text-rose-400', indigo: 'text-indigo-400',
  };
  return (
    <section className={`rounded-xl border p-5 ${tones[tone] || tones.slate}`}>
      {title && (
        <h3 className={`text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2 ${text[tone] || text.slate}`}>
          {icon && <span>{icon}</span>}{title}
        </h3>
      )}
      {children}
    </section>
  );
}

function ProseBlock({ block }) {
  return (
    <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
      {block.heading && <h3 className="text-base font-bold text-white mb-3">{block.heading}</h3>}
      <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{block.body}</div>
    </section>
  );
}

function FlowchartBlock({ block }) {
  const steps = (block.steps || []).filter(Boolean);
  if (steps.length === 0) return null;
  return (
    <BlockShell tone="cyan" icon="🔀" title={block.title || 'Process'}>
      <div>
        {steps.map((s, i) => {
          const label = typeof s === 'string' ? s : s.label;
          const detail = typeof s === 'string' ? '' : s.detail;
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center flex-shrink-0">
                <span className="w-8 h-8 rounded-full bg-cyan-600/25 border border-cyan-500/40 flex items-center justify-center text-xs font-black text-cyan-300">{i + 1}</span>
                {i < steps.length - 1 && <span className="w-px flex-1 bg-cyan-500/30 my-1" style={{ minHeight: '1.25rem' }} />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-semibold text-slate-100">{label}</p>
                {detail && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{detail}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {block.note && <p className="text-xs text-cyan-200/70 mt-1 italic">{block.note}</p>}
    </BlockShell>
  );
}

function ChartBlock({ block }) {
  const data = (block.data || []).filter(d => d && typeof d.value === 'number').slice(0, 8);
  if (data.length < 2) return null;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const max = Math.max(...data.map(d => d.value), 1);

  if (block.type === 'pie') {
    let acc = 0;
    const stops = data.map((d, i) => {
      const start = (acc / total) * 360;
      acc += d.value;
      return `${CHART_COLORS[i % CHART_COLORS.length]} ${start}deg ${(acc / total) * 360}deg`;
    }).join(', ');
    return (
      <BlockShell tone="purple" icon="🥧" title={block.title || 'Breakdown'}>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-36 h-36 rounded-full flex-shrink-0" style={{ background: `conic-gradient(${stops})` }} />
          <ul className="space-y-1.5 w-full">
            {data.map((d, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1">{d.label}</span>
                <span className="text-slate-500 font-semibold">{Math.round((d.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
        {block.insight && <p className="text-xs text-purple-200/70 mt-4 italic">{block.insight}</p>}
      </BlockShell>
    );
  }

  return (
    <BlockShell tone="purple" icon="📊" title={block.title || 'Comparison'}>
      <div className="space-y-2.5">
        {data.map((d, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
              <span>{d.label}</span>
              <span className="text-slate-500 font-semibold">{d.value}{block.unit ? ` ${block.unit}` : ''}</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
            </div>
          </div>
        ))}
      </div>
      {block.insight && <p className="text-xs text-purple-200/70 mt-4 italic">{block.insight}</p>}
    </BlockShell>
  );
}

function TableBlock({ block }) {
  const columns = block.columns || [];
  const rows = (block.rows || []).filter(r => Array.isArray(r) && r.length > 0);
  if (columns.length < 2 || rows.length === 0) return null;
  return (
    <BlockShell tone="indigo" icon="📋" title={block.title || 'Comparison'}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/60">
              {columns.map((c, i) => (
                <th key={i} className="text-left py-2 px-2 text-slate-400 font-bold uppercase tracking-wider">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-900/30' : ''}>
                {r.map((cell, j) => (
                  <td key={j} className={`py-2 px-2 align-top ${j === 0 ? 'text-white font-medium' : 'text-slate-300'}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockShell>
  );
}

function LessonPlanBlock({ block }) {
  const rows = (block.rows || []).filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <BlockShell tone="emerald" icon="🗂️" title={block.title || "What you'll cover"}>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-700/60">
              <th className="text-left py-2 px-2 text-slate-400 font-bold uppercase tracking-wider">Subtopic</th>
              <th className="text-left py-2 px-2 text-slate-400 font-bold uppercase tracking-wider">You'll be able to</th>
              <th className="text-left py-2 px-2 text-slate-400 font-bold uppercase tracking-wider">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {rows.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-900/30' : ''}>
                <td className="py-2 px-2 text-white font-medium align-top">{r.subtopic}</td>
                <td className="py-2 px-2 text-slate-300 align-top">{r.outcome}</td>
                <td className="py-2 px-2 align-top whitespace-nowrap">
                  {r.minutes ? <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold">{r.minutes} min</span> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockShell>
  );
}

function ExampleBlock({ block }) {
  return (
    <section className="rounded-xl border-l-4 border-l-emerald-500 border border-emerald-500/20 bg-emerald-500/5 p-5">
      {(block.company || block.year) && (
        <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-1">
          {block.company}{block.company && block.year ? ' · ' : ''}{block.year}
        </p>
      )}
      {block.title && <h3 className="text-sm font-bold text-white mb-2">{block.title}</h3>}
      {block.scenario && <p className="text-sm text-slate-200 leading-relaxed mb-2">{block.scenario}</p>}
      {block.action && <p className="text-xs text-slate-300 leading-relaxed mb-1"><span className="font-bold text-slate-400">What they did: </span>{block.action}</p>}
      {block.outcome && <p className="text-xs text-slate-300 leading-relaxed"><span className="font-bold text-slate-400">Result: </span>{block.outcome}</p>}
      {block.takeaway && (
        <p className="text-sm text-emerald-200 font-semibold mt-3 pt-3 border-t border-emerald-500/20">→ {block.takeaway}</p>
      )}
    </section>
  );
}

const CALLOUT_VARIANTS = {
  warning: { tone: 'amber', icon: '⚠️' },
  pitfall: { tone: 'rose', icon: '⛔' },
  tip:     { tone: 'cyan', icon: '💡' },
};

function CalloutBlock({ block }) {
  const v = CALLOUT_VARIANTS[block.variant] || CALLOUT_VARIANTS.tip;
  return (
    <BlockShell tone={v.tone} icon={v.icon} title={block.title || block.variant || 'Note'}>
      <p className="text-sm text-slate-200 leading-relaxed">{block.body}</p>
    </BlockShell>
  );
}

function ChecklistBlock({ block }) {
  const items = (block.items || []).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <BlockShell tone="slate" icon="☑️" title={block.title || 'Checklist'}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-slate-200">
            <span className="w-4 h-4 mt-0.5 rounded border border-slate-600 flex-shrink-0" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </BlockShell>
  );
}

const BLOCK_RENDERERS = {
  prose: ProseBlock,
  flowchart: FlowchartBlock,
  bar: ChartBlock,
  pie: ChartBlock,
  comparison: TableBlock,
  lessonPlan: LessonPlanBlock,
  example: ExampleBlock,
  callout: CalloutBlock,
  checklist: ChecklistBlock,
};

// Unknown block types render nothing rather than breaking the page, so the
// generator can add new types before the client knows about them.
function SessionBlocks({ blocks }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return (
    <>
      {blocks.map((block, i) => {
        const Renderer = BLOCK_RENDERERS[block?.type];
        if (!Renderer) return null;
        return <Renderer key={i} block={block} />;
      })}
    </>
  );
}

function CardDeck({ cards, forceRevealed = false }) {
  const [revealed, setRevealed] = useState({});
  const [allOpen, setAllOpen] = useState(forceRevealed);
  const list = (cards || []).filter(c => c && (c.front || c.back));
  if (list.length === 0) return null;
  return (
    <BlockShell tone="indigo" icon="🃏" title={`Recall cards (${list.length})`}>
      <button
        onClick={() => { setAllOpen(v => !v); setRevealed({}); }}
        className="mb-3 text-xs font-semibold text-indigo-300 hover:text-indigo-200 transition-colors"
      >
        {allOpen ? 'Hide all answers' : 'Reveal all answers'}
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {list.map((c, i) => {
          const open = allOpen || revealed[i];
          return (
            <button
              key={i}
              onClick={() => setRevealed(p => ({ ...p, [i]: !p[i] }))}
              className="text-left rounded-lg border border-slate-700/60 bg-slate-900/50 hover:border-indigo-500/40 p-3 transition-all min-h-[84px]"
            >
              {c.tag && <span className="inline-block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{c.tag}</span>}
              <p className="text-sm font-semibold text-white leading-snug">{c.front}</p>
              {open
                ? <p className="text-xs text-indigo-200 mt-2 leading-relaxed">{c.back}</p>
                : <p className="text-xs text-slate-500 mt-2 italic">Tap to reveal</p>}
            </button>
          );
        })}
      </div>
    </BlockShell>
  );
}

function DefinitionsBlock({ definitions }) {
  const list = (definitions || []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <BlockShell tone="amber" icon="📖" title="Key definitions">
      <dl className="space-y-3">
        {list.map((d, i) => (
          <div key={i}>
            <dt className="text-sm font-bold text-white">{typeof d === 'string' ? d : d.term || d.word || `Term ${i + 1}`}</dt>
            {d.definition && <dd className="text-sm text-slate-400 mt-0.5 ml-3">{d.definition}</dd>}
            {d.whyItMatters && <dd className="text-xs text-amber-200/70 mt-1 ml-3 italic">Why it matters: {d.whyItMatters}</dd>}
          </div>
        ))}
      </dl>
    </BlockShell>
  );
}

function AbbreviationsBlock({ abbreviations }) {
  const list = (abbreviations || []).filter(a => a && (a.short || a.full));
  if (list.length === 0) return null;
  return (
    <BlockShell tone="slate" icon="🔤" title="Abbreviations">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {list.map((a, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <dt className="font-black text-white whitespace-nowrap">{a.short}</dt>
            <dd className="text-slate-400">
              {a.full}
              {a.note && <span className="block text-xs text-slate-500 italic">{a.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </BlockShell>
  );
}

function MnemonicsBlock({ mnemonics }) {
  const list = (mnemonics || []).filter(m => m && m.device);
  if (list.length === 0) return null;
  return (
    <BlockShell tone="purple" icon="🧠" title="Memory aids">
      <div className="space-y-3">
        {list.map((m, i) => (
          <div key={i}>
            <p className="text-lg font-black text-purple-200 tracking-wide font-mono">{m.device}</p>
            {m.expands && <p className="text-sm text-slate-300 mt-0.5">{m.expands}</p>}
            {m.howToUse && <p className="text-xs text-slate-500 mt-0.5 italic">{m.howToUse}</p>}
          </div>
        ))}
      </div>
    </BlockShell>
  );
}

const SEVERITY_STYLES = {
  critical:  'bg-rose-500/15 border-rose-500/40 text-rose-300',
  important: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
  tip:       'bg-cyan-500/15 border-cyan-500/40 text-cyan-300',
};

function KeepInMindBlock({ points }) {
  const list = (points || []).filter(p => p && p.point);
  if (list.length === 0) return null;
  return (
    <BlockShell tone="rose" icon="📌" title="Keep in mind">
      <ul className="space-y-3">
        {list.map((p, i) => (
          <li key={i}>
            <div className="flex items-start gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border flex-shrink-0 ${SEVERITY_STYLES[p.severity] || SEVERITY_STYLES.important}`}>
                {p.severity || 'important'}
              </span>
              <p className="text-sm text-slate-200 leading-snug">{p.point}</p>
            </div>
            {p.why && <p className="text-xs text-slate-500 mt-0.5 ml-[4.25rem] leading-relaxed">{p.why}</p>}
          </li>
        ))}
      </ul>
    </BlockShell>
  );
}

function SubtopicStrip({ subtopics }) {
  const list = (subtopics || []).map(s => (typeof s === 'string' ? { name: s } : s)).filter(s => s?.name);
  if (list.length === 0) return null;
  return (
    <BlockShell tone="slate" icon="🧭" title="What you'll cover">
      <ol className="space-y-2">
        {list.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-5 h-5 rounded bg-slate-700/60 text-slate-300 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
            <div>
              <p className="text-sm font-semibold text-white">
                {s.name}
                {s.minutes ? <span className="ml-2 text-xs text-slate-500 font-normal">{s.minutes} min</span> : null}
              </p>
              {s.summary && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.summary}</p>}
            </div>
          </li>
        ))}
      </ol>
    </BlockShell>
  );
}

function ContentPhase({ session, sessionIndex, module, preparingDeep, onStartQuiz, onOpenNotes, onHome }) {
  const [readProgress, setReadProgress] = useState(0);
  const contentRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const el = contentRef.current;
      const scrolled = el.scrollTop + el.clientHeight;
      const total = el.scrollHeight;
      setReadProgress(Math.min(100, Math.round((scrolled / total) * 100)));
    };
    const el = contentRef.current;
    if (el) el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el?.removeEventListener('scroll', handleScroll);
  }, []);

  const title = session.title || session.topic || `Day ${sessionIndex + 1}`;
  const description = session.description || session.objective || '';
  const keyPoints = session.keyPoints || session.key_points || session.topics || [];
  const definitions = session.definitions || [];
  const notes = session.notes || session.content || '';
  const explanation = session.explanation || '';
  const learningObjectives = session.learningObjectives || [];
  const visual = session.visual;
  const isCapstone = session.type === 'capstone';

  // Deep (contentVersion 2) days carry an ordered `blocks` array plus a card
  // deck, abbreviations, mnemonics and keep-in-mind points. Older sessions
  // have none of this — SessionBlocks/CardDeck/etc all render null on empty
  // input, so a v1 session below falls straight through to the legacy
  // Key Points / Visual / Explanation section unchanged.
  const isDeep = session.contentVersion === 2 && Array.isArray(session.blocks) && session.blocks.length > 0;
  const subtopics = session.subtopics || [];
  const abbreviations = session.abbreviations || [];
  const mnemonics = session.mnemonics || [];
  const keepInMind = session.keepInMind || [];
  const cardDeck = session.cardDeck || [];

  return (
    <div className="min-h-screen bg-[#0F172A]">
      {/* Top progress */}
      <div className="fixed top-[57px] left-0 right-0 z-10">
        <div className="h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${readProgress}%` }} />
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        {/* Breadcrumb + Home */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{module?.title || 'Module'}</span>
            <span>/</span>
            <span className="text-slate-300">{title}</span>
          </div>
          <button
            onClick={onHome}
            title="Module Home"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/60 text-slate-400 hover:text-white text-xs font-semibold transition-all"
          >
            <span>🏠</span> Module Home
          </button>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-3 ${isCapstone ? 'bg-amber-600/15 border border-amber-500/25 text-amber-300' : 'bg-indigo-600/15 border border-indigo-500/25 text-indigo-300'}`}>
            <span>{isCapstone ? '🏆' : '📚'}</span> {isCapstone ? `Day ${sessionIndex + 1} · Capstone` : `Day ${sessionIndex + 1}`}
            {session.duration && <span className="text-slate-400 font-medium">· {session.duration}</span>}
          </div>
          <h1 className="text-3xl font-black text-white mb-3 leading-tight">{title}</h1>
          {description && <p className="text-slate-300 text-base leading-relaxed">{description}</p>}
        </div>

        {preparingDeep && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
            <span className="w-4 h-4 border-2 border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-indigo-200">Preparing your deep dive for this day — the material below will expand in a moment.</p>
          </div>
        )}

        {/* Content scroll area */}
        <div className="space-y-6" ref={contentRef}>
          {/* Learning Objectives */}
          {learningObjectives.length > 0 && (
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>🎯</span> Learning Objectives
              </h2>
              <ul className="space-y-1.5">
                {learningObjectives.map((o, i) => (
                  <li key={i} className="text-sm text-slate-200 leading-relaxed flex gap-2">
                    <span className="text-emerald-400 flex-shrink-0">▸</span>
                    <span>{typeof o === 'string' ? o : JSON.stringify(o)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Definitions */}
          {definitions.length > 0 && (
            <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
              <h2 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <span>📖</span> Key Definitions
              </h2>
              <dl className="space-y-3">
                {definitions.map((def, i) => (
                  <div key={i}>
                    <dt className="text-sm font-bold text-white">
                      {typeof def === 'string' ? def : def.term || def.word || `Term ${i + 1}`}
                    </dt>
                    {def.definition && (
                      <dd className="text-sm text-slate-400 mt-0.5 ml-3">{def.definition}</dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          )}

          {isDeep ? (
            <>
              {/* What you'll cover — the subtopic strip for this deep day */}
              <SubtopicStrip subtopics={subtopics} />

              {/* The bulk of the day, in the order the model chose:
                  prose / flowchart / charts / tables / examples / callouts */}
              <SessionBlocks blocks={session.blocks} />

              <AbbreviationsBlock abbreviations={abbreviations} />
              <MnemonicsBlock mnemonics={mnemonics} />
              <KeepInMindBlock points={keepInMind} />
              <CardDeck cards={cardDeck} />

              {/* Key Points recap, after the deep material rather than before it */}
              {keyPoints.length > 0 && (
                <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                  <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span>✅</span> Key Points Recap
                  </h2>
                  <ul className="space-y-2">
                    {keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-200 leading-relaxed">
                          {typeof point === 'string' ? point : point.title || point.point || JSON.stringify(point)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              {/* Key Points */}
              {keyPoints.length > 0 && (
                <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                  <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span>✅</span> Key Points
                  </h2>
                  <ul className="space-y-2">
                    {keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-200 leading-relaxed">
                          {typeof point === 'string' ? point : point.title || point.point || JSON.stringify(point)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Visual: flowchart / bar / pie — only when the content genuinely has one */}
              <SessionVisual visual={visual} />

              {/* Explanation and Notes are two distinct fields the generator can
                  both populate — this used to render `explanation || notes`,
                  which silently dropped Notes whenever Explanation was present.
                  Shown as separate sections, de-duplicated only when identical. */}
              {explanation && (
                <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span>💡</span> Explanation
                  </h2>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{explanation}</div>
                </section>
              )}
              {notes && notes !== explanation && (
                <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span>📝</span> Notes
                  </h2>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{notes}</div>
                </section>
              )}

              {/* Summary fallback if no structured content */}
              {!notes && !explanation && keyPoints.length === 0 && definitions.length === 0 && (
                <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 text-center">
                  <div className="text-4xl mb-3 opacity-50">📝</div>
                  <p className="text-slate-400 text-sm">
                    Learning content for <strong className="text-white">{title}</strong> covers the foundational concepts of the module.
                    Complete the knowledge quiz below to progress.
                  </p>
                </section>
              )}
            </>
          )}

        </div>

        {/* CTA */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onOpenNotes}
            className="px-6 py-3 rounded-2xl border border-slate-600/60 bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 hover:text-white font-semibold text-sm transition-all flex items-center gap-2"
          >
            📝 View Notes
          </button>
          <button
            onClick={onStartQuiz}
            className="px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-base transition-all shadow-xl shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-100"
          >
            Take Knowledge Quiz →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notes phase ──────────────────────────────────────────────────────────────
// A dedicated, read-optimized view of everything from this session — separate
// from the main learning flow so an employee can jump back to review without
// re-reading through Learning Objectives/quiz CTAs, with a real PDF export.

function NotesPhase({ session, sessionIndex, module, quizResults, onBack, onHome }) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const title = session.title || session.topic || `Day ${sessionIndex + 1}`;
  const keyPoints = session.keyPoints || session.key_points || session.topics || [];
  const definitions = session.definitions || [];
  const notes = session.notes || session.content || '';
  const explanation = session.explanation || '';
  const learningObjectives = session.learningObjectives || [];
  const isDeep = session.contentVersion === 2 && Array.isArray(session.blocks) && session.blocks.length > 0;
  const subtopics = session.subtopics || [];
  const abbreviations = session.abbreviations || [];
  const mnemonics = session.mnemonics || [];
  const keepInMind = session.keepInMind || [];
  const cardDeck = session.cardDeck || [];

  const handleDownload = async () => {
    setDownloadingPdf(true);
    try {
      await downloadSessionNotesPDF(session, sessionIndex, module?.title, quizResults);
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white transition-colors">
            <span>←</span> Back to Session
          </button>
          <button
            onClick={onHome}
            title="Module Home"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/60 text-slate-400 hover:text-white text-xs font-semibold transition-all"
          >
            <span>🏠</span> Module Home
          </button>
        </div>

        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-3 bg-purple-600/15 border border-purple-500/25 text-purple-300">
              <span>📝</span> Day {sessionIndex + 1} Notes
            </div>
            <h1 className="text-2xl font-black text-white leading-tight">{title}</h1>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloadingPdf}
            className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20"
          >
            {downloadingPdf ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Preparing…</> : <>📄 Download PDF</>}
          </button>
        </div>

        <div className="space-y-6">
          {learningObjectives.length > 0 && (
            <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h2 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3">🎯 Learning Objectives</h2>
              <ul className="space-y-1.5">
                {learningObjectives.map((o, i) => (
                  <li key={i} className="text-sm text-slate-200 leading-relaxed flex gap-2">
                    <span className="text-emerald-400 flex-shrink-0">▸</span>
                    <span>{typeof o === 'string' ? o : JSON.stringify(o)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {definitions.length > 0 && (
            <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
              <h2 className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-4">📖 Key Definitions</h2>
              <dl className="space-y-3">
                {definitions.map((def, i) => (
                  <div key={i}>
                    <dt className="text-sm font-bold text-white">{typeof def === 'string' ? def : def.term || def.word || `Term ${i + 1}`}</dt>
                    {def.definition && <dd className="text-sm text-slate-400 mt-0.5 ml-3">{def.definition}</dd>}
                  </div>
                ))}
              </dl>
            </section>
          )}

          {isDeep ? (
            <>
              <SubtopicStrip subtopics={subtopics} />
              <SessionBlocks blocks={session.blocks} />
              <AbbreviationsBlock abbreviations={abbreviations} />
              <MnemonicsBlock mnemonics={mnemonics} />
              <KeepInMindBlock points={keepInMind} />
              {/* Force-revealed here: a notes page is for review/printing,
                  not testing recall — flipping every card is the point. */}
              <CardDeck cards={cardDeck} forceRevealed />
              {keyPoints.length > 0 && (
                <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                  <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4">✅ Key Points Recap</h2>
                  <ul className="space-y-2">
                    {keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0 mt-0.5">{i + 1}</span>
                        <span className="text-sm text-slate-200 leading-relaxed">{typeof point === 'string' ? point : point.title || point.point || JSON.stringify(point)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <>
              {keyPoints.length > 0 && (
                <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5">
                  <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4">✅ Key Points</h2>
                  <ul className="space-y-2">
                    {keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="w-5 h-5 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xs font-black text-indigo-400 flex-shrink-0 mt-0.5">{i + 1}</span>
                        <span className="text-sm text-slate-200 leading-relaxed">{typeof point === 'string' ? point : point.title || point.point || JSON.stringify(point)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <SessionVisual visual={session.visual} />

              {explanation && (
                <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">💡 Explanation</h2>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{explanation}</div>
                </section>
              )}
              {notes && notes !== explanation && (
                <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">📝 Notes</h2>
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{notes}</div>
                </section>
              )}
            </>
          )}

          {Array.isArray(quizResults) && quizResults.length > 0 && (
            <section className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
              <div className="p-4 border-b border-slate-700/40">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">📋 Knowledge Quiz Results</h2>
              </div>
              <div className="divide-y divide-slate-700/30">
                {quizResults.map((r, i) => (
                  <div key={i} className={`p-4 ${r.isCorrect ? 'bg-emerald-500/5' : 'bg-rose-500/5'}`}>
                    <div className="flex gap-3">
                      <span className={`flex-shrink-0 text-sm ${r.isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>{r.isCorrect ? '✓' : '✗'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-semibold mb-1">{r.question}</p>
                        {!r.isCorrect && (
                          <>
                            <p className="text-xs text-rose-400">Your answer: {r.userAnswer || '(no answer)'}</p>
                            <p className="text-xs text-emerald-400">Correct: {r.answer}</p>
                          </>
                        )}
                        {r.explanation && <p className="text-xs text-slate-500 mt-1 italic">{r.explanation}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Quiz phase ───────────────────────────────────────────────────────────────

const FALLBACK_QUESTIONS = (sessionTitle, topics = []) => {
  const topicStr = topics.length > 0 ? topics[0] : sessionTitle;
  return [
    { type: 'mcq', question: `What is a key characteristic of ${topicStr}?`, options: [`A) It is used in ${topicStr} workflows`, 'B) It is rarely applied in practice', 'C) It only applies to large organizations', 'D) It requires no foundational knowledge'], answer: 'A', explanation: `${topicStr} is primarily valuable because it enables practical workflows and outcomes.` },
    { type: 'mcq', question: `Which best describes the primary purpose of ${topicStr}?`, options: ['A) To complicate existing processes', `B) To improve efficiency and outcomes in ${sessionTitle}`, 'C) To replace all manual work immediately', 'D) To reduce team collaboration'], answer: 'B', explanation: `The primary purpose of ${topicStr} is improving efficiency and driving better outcomes.` },
    { type: 'mcq', question: `When implementing ${topicStr}, what is the most important first step?`, options: ['A) Skip planning and start immediately', `B) Understand the current state and requirements`, 'C) Copy what competitors are doing', 'D) Avoid stakeholder input'], answer: 'B', explanation: 'Understanding current state and requirements ensures the implementation addresses actual needs.' },
    { type: 'fill_blank', question: `In ${sessionTitle}, ${topicStr} is primarily used to ______ business outcomes.`, answer: 'improve', explanation: `${topicStr} is applied to improve measurable business outcomes.` },
    { type: 'mcq', question: `What is a common challenge when working with ${topicStr}?`, options: ['A) Too much available documentation', 'B) Ensuring consistent application across the organization', 'C) Excessive simplicity', 'D) Lack of industry relevance'], answer: 'B', explanation: 'Consistent organizational application is one of the most common implementation challenges.' },
    { type: 'subjective', question: `Describe how ${topicStr} from "${sessionTitle}" would be applied to solve a real problem in your organization.`, answer: `Apply ${topicStr} by first identifying the specific problem, then systematically implementing the concepts from this session, measuring outcomes, and iterating based on results.`, explanation: 'Application to real organizational problems demonstrates genuine understanding.' },
    { type: 'mcq', question: `Which stakeholder group benefits most directly from ${topicStr}?`, options: ['A) Only the IT department', 'B) Executive leadership exclusively', 'C) The teams directly working in the relevant processes', 'D) External vendors only'], answer: 'C', explanation: 'Teams directly working in the relevant processes see the most immediate benefit.' },
    { type: 'mcq', question: `What measurement indicates successful implementation of ${topicStr}?`, options: ['A) The number of meetings held', 'B) Time spent in training', 'C) Measurable improvement in targeted outcomes', 'D) Number of tools purchased'], answer: 'C', explanation: 'Measurable improvement in targeted outcomes is the definitive success indicator.' },
    { type: 'subjective', question: `What is one risk or limitation of ${topicStr} that someone in your role should watch for, and how would you mitigate it?`, answer: `A common risk is applying ${topicStr} inconsistently or without understanding the underlying context, which produces unreliable outcomes. Mitigate it by confirming the prerequisites are in place, applying the concept deliberately rather than mechanically, and reviewing the result against the intended outcome.`, explanation: 'Identifying limitations and mitigations shows understanding beyond memorisation.' },
    { type: 'mcq', question: `What is the relationship between ${topicStr} and the broader ${sessionTitle} discipline?`, options: [`A) ${topicStr} is an isolated concept with no connections`, `B) ${topicStr} is a foundational element that supports the broader discipline`, 'C) They are unrelated topics', 'D) The broader discipline depends on ignoring this concept'], answer: 'B', explanation: `${topicStr} serves as a foundational building block within the broader ${sessionTitle} framework.` },
  ];
};

function QuizPhase({ session, sessionIndex, module, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loadingQ, setLoadingQ] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(null);
  const [currentQ, setCurrentQ] = useState(0);

  const sessionTitle = session?.title || session?.topic || `Day ${sessionIndex + 1}`;

  useEffect(() => {
    loadQuestions();
  }, []);

  const loadQuestions = async () => {
    setLoadingQ(true);
    const sessionTopics = session?.topics || session?.keyPoints?.slice(0, 5) || [];

    // Use pre-generated quiz embedded in the session object when available —
    // avoids a fresh LLM call on every employee session-open.
    const embedded = Array.isArray(session?.quiz) ? session.quiz : [];
    if (embedded.length >= 3) {
      setQuestions(embedded.slice(0, 10));
      setLoadingQ(false);
      return;
    }

    try {
      const sessionKeyPoints = session?.keyPoints || [];
      const res = await authFetch('/api/assessments/generate', {
        method: 'POST',
        body: JSON.stringify({
          moduleTitle: module?.title || 'Learning Module',
          moduleDescription: session?.description || session?.objective || module?.description || '',
          skills: session?.topics || module?.skills || [],
          numQuestions: 10,
          // 7 MCQ / 2 subjective / 1 fill-in-blank. The server derives the mix
          // from this array and enforces it deterministically after generation.
          questionTypes: ['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'subjective', 'subjective', 'fill_blank'],
          sessionTitle,
          sessionTopics,
          sessionKeyPoints,
        }),
      });
      const qs = Array.isArray(res) ? res : (res?.questions || []);
      setQuestions(qs.length >= 5 ? qs.slice(0, 10) : FALLBACK_QUESTIONS(sessionTitle, sessionTopics));
    } catch {
      setQuestions(FALLBACK_QUESTIONS(sessionTitle, sessionTopics));
    } finally {
      setLoadingQ(false);
    }
  };

  const handleAnswer = (qIdx, value) => {
    setAnswers(prev => ({ ...prev, [qIdx]: value }));
  };

  const handleSubmit = () => {
    // Grade all questions
    let correct = 0;
    const results = questions.map((q, i) => {
      const userAnswer = (answers[i] || '').toString().trim().toLowerCase();
      const correctAnswer = (q.answer || '').toString().trim().toLowerCase();
      let isCorrect;
      if (q.type === 'subjective') {
        isCorrect = userAnswer.length > 20; // subjective: any substantial answer
      } else if (q.type === 'mcq') {
        // MCQ answers are always a single letter after server-side
        // normalization (QuestionMix.normalizeQuestionShape), so an exact
        // match is both correct and sufficient. The previous fallback —
        // `userAnswer.startsWith(correctAnswer.charAt(0))` — was only inert
        // by coincidence (a normalized answer's first character equals
        // itself); against any non-normalized/legacy question where `answer`
        // is full option text ("b) some option"), it could mark a correct
        // pick wrong or a wrong pick right depending on shared first letters.
        // Extracting the letter from either shape removes that fragility.
        const letterOf = (s) => (s.match(/^[a-d]\)?/) || [s.charAt(0)])[0].replace(')', '');
        isCorrect = letterOf(userAnswer) === letterOf(correctAnswer);
      } else {
        isCorrect = userAnswer === correctAnswer;
      }
      if (isCorrect) correct++;
      return { ...q, userAnswer: answers[i] || '', isCorrect };
    });
    const pct = Math.round((correct / questions.length) * 100);
    const scoreData = { correct, total: questions.length, pct, results };
    setScore(scoreData);
    setSubmitted(true);
    // Immediately call onComplete with score so parent can save progress + show ScorePhase
    onComplete(scoreData);
  };

  if (loadingQ) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⟳</div>
          <p className="text-slate-400 text-sm">Generating your knowledge quiz…</p>
          <p className="text-slate-600 text-xs mt-1">Using AI to tailor questions to this session</p>
        </div>
      </div>
    );
  }

  // Once submitted, parent ModuleSession takes over with ScorePhase
  if (submitted) return null;

  const rawQ = questions[currentQ];
  // Embedded module-session quizzes (generated server-side and stored on the
  // session/assignment) are produced by several different code paths, none
  // of which stamp a `type` field on each question — only `question`/
  // `options`/`answer`. Gating strictly on `q.type === 'mcq'` meant EVERY
  // such question fell through every render branch: the header badge
  // defaulted to showing "Multiple Choice" (a separate default-label bug),
  // while the actual answer area — options, fill-blank input, subjective
  // textarea — rendered nothing at all, making the quiz uncompletable.
  // Infer the real type from shape instead of trusting a field that's
  // usually absent: an options array means MCQ regardless of what (if
  // anything) `type` says; otherwise fall back to the stated type.
  const KNOWN_TYPES = new Set(['mcq', 'fill_blank', 'subjective']);
  const hasOptions = Array.isArray(rawQ?.options) && rawQ.options.length > 0;
  const q = rawQ && (!KNOWN_TYPES.has(rawQ.type))
    ? { ...rawQ, type: hasOptions ? 'mcq' : (rawQ.type === 'fill' ? 'fill_blank' : 'subjective') }
    : rawQ;
  if (!q) return null;

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span>Question {currentQ + 1} of {questions.length}</span>
            <span>{Object.keys(answers).length} answered</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>
        </div>

        {/* Question card */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
              q.type === 'mcq' ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
              : q.type === 'fill_blank' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
            }`}>
              {q.type === 'fill_blank' ? 'Fill Blank' : q.type === 'subjective' ? 'Short Answer' : 'Multiple Choice'}
            </span>
            {q.difficulty && (
              <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${
                q.difficulty === 'easy' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : q.difficulty === 'hard' ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}>
                {q.difficulty}
              </span>
            )}
          </div>

          <p className="text-lg font-bold text-white leading-snug mb-6">{q.question}</p>

          {/* MCQ options */}
          {q.type === 'mcq' && (!q.options || q.options.length === 0) && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-300 text-sm">
              ⚠️ This question could not be loaded correctly (no answer options found). Skip ahead — your progress on other questions is unaffected.
            </div>
          )}
          {q.type === 'mcq' && q.options && q.options.length > 0 && (
            <div className="space-y-2.5">
              {q.options.map((opt, oi) => {
                const letter = ['A', 'B', 'C', 'D'][oi];
                const selected = answers[currentQ] === letter;
                return (
                  <button
                    key={oi}
                    onClick={() => handleAnswer(currentQ, letter)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all text-sm font-medium ${
                      selected
                        ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-100'
                        : 'border-slate-700/50 bg-slate-800/50 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-xs font-black mr-2 ${
                      selected ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>{letter}</span>
                    {opt.replace(/^[A-D]\)\s*/, '')}
                  </button>
                );
              })}
            </div>
          )}

          {/* Fill blank */}
          {q.type === 'fill_blank' && (
            <input
              value={answers[currentQ] || ''}
              onChange={e => handleAnswer(currentQ, e.target.value)}
              placeholder="Type your answer here…"
              className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900/60 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30"
            />
          )}

          {/* Subjective */}
          {q.type === 'subjective' && (
            <textarea
              value={answers[currentQ] || ''}
              onChange={e => handleAnswer(currentQ, e.target.value)}
              placeholder="Write your detailed answer here…"
              rows={5}
              className="w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-900/60 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 resize-none"
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentQ(prev => Math.max(0, prev - 1))}
            disabled={currentQ === 0}
            className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-semibold transition-all disabled:opacity-30"
          >
            ← Previous
          </button>

          <div className="flex gap-1.5">
            {questions.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentQ(i)}
                className={`w-6 h-6 rounded-full text-xs font-black transition-all ${
                  i === currentQ ? 'bg-indigo-600 text-white'
                  : answers[i] !== undefined ? 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-700 text-slate-500'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {currentQ < questions.length - 1 ? (
            <button
              onClick={() => setCurrentQ(prev => Math.min(questions.length - 1, prev + 1))}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-all"
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={Object.keys(answers).length < questions.length}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit Quiz
            </button>
          )}
        </div>

        {Object.keys(answers).length < questions.length && currentQ === questions.length - 1 && (
          <p className="text-center text-xs text-amber-400 mt-3">
            {questions.length - Object.keys(answers).length} question(s) unanswered
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Score phase ──────────────────────────────────────────────────────────────

function ScorePhase({ score, sessionTitle, sessionIndex, totalSessions, onRewatch, onRetryQuiz, onNextSession, onDashboard, saving, saveError, onRetrySave, onOpenNotes }) {
  const { pct, correct, total, results } = score;
  const passed = pct >= 70;
  const hasNext = sessionIndex + 1 < totalSessions;

  const strengths = results.filter(r => r.isCorrect).slice(0, 3);
  const weaknesses = results.filter(r => !r.isCorrect).slice(0, 3);

  return (
    <div className="min-h-screen bg-[#0F172A]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        {/* Score card */}
        <div className={`rounded-2xl border p-8 text-center mb-8 ${passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
          <div className="text-6xl mb-4">{pct >= 90 ? '🌟' : pct >= 70 ? '🎉' : '📚'}</div>
          <h1 className="text-4xl font-black text-white mb-2">{pct}%</h1>
          <p className={`text-lg font-bold mb-1 ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
            {passed ? 'Session Complete!' : 'Session Complete'}
          </p>
          <p className="text-slate-400 text-sm">{correct} correct out of {total} questions</p>
          {saving ? (
            <p className="text-slate-400 text-xs mt-2 animate-pulse">💾 Saving progress…</p>
          ) : saveError ? (
            <div className="mt-3 inline-flex flex-col items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
              <p className="text-rose-300 text-xs font-semibold">⚠️ Your progress didn't save — this session won't count as complete yet.</p>
              <button
                onClick={onRetrySave}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors"
              >
                Retry Save
              </button>
            </div>
          ) : (
            <p className="text-emerald-300 text-xs mt-2">✓ Progress saved</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          {/* Strengths */}
          {strengths.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>💪</span> Strengths
              </h3>
              <ul className="space-y-2">
                {strengths.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-snug flex gap-2">
                    <span className="text-emerald-400 flex-shrink-0">✓</span>
                    <span className="line-clamp-2">{r.question}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Areas to Review */}
          {weaknesses.length > 0 && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
              <h3 className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <span>🎯</span> Areas to Review
              </h3>
              <ul className="space-y-2">
                {weaknesses.map((r, i) => (
                  <li key={i} className="text-xs text-slate-300 leading-snug flex gap-2">
                    <span className="text-rose-400 flex-shrink-0">✗</span>
                    <span className="line-clamp-2">{r.question}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Recommendations */}
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 mb-8">
          <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">
            💡 Recommendations
          </h3>
          <ul className="space-y-1.5 text-xs text-slate-300">
            {pct >= 90 && <li>• Excellent work! Consider exploring advanced topics in this area.</li>}
            {pct >= 70 && pct < 90 && <li>• Good performance. Review the questions you missed to solidify understanding.</li>}
            {pct < 70 && <li>• Review the session content again to reinforce these concepts before moving on.</li>}
            {weaknesses.length > 0 && <li>• Focus on: {weaknesses.map(r => r.question.slice(0, 40)).join('; ')}…</li>}
            <li>• Apply what you've learned in a real project or work scenario.</li>
          </ul>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={onRewatch}
            className="flex flex-col items-center gap-1.5 py-3.5 px-4 rounded-xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all text-sm font-semibold"
          >
            <span className="text-lg">🔁</span>
            <span>Rewatch Session</span>
            <span className="text-xs text-slate-500 font-normal">Review the material</span>
          </button>
          <button
            onClick={onRetryQuiz}
            className="flex flex-col items-center gap-1.5 py-3.5 px-4 rounded-xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-700/50 hover:border-slate-600 text-slate-300 hover:text-white transition-all text-sm font-semibold"
          >
            <span className="text-lg">🔄</span>
            <span>Retry Quiz</span>
            <span className="text-xs text-slate-500 font-normal">Try for a higher score</span>
          </button>
        </div>

        <button
          onClick={onOpenNotes}
          className="w-full mb-6 py-3 rounded-xl border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 hover:text-purple-200 text-sm font-semibold transition-all flex items-center justify-center gap-2"
        >
          <span>📝</span> View Notes (includes quiz results, downloadable as PDF)
        </button>

        <div className="flex flex-col gap-3">
          {hasNext && (
            <button
              onClick={onNextSession}
              disabled={saveError}
              title={saveError ? 'Retry saving your progress first' : undefined}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            >
              <span>Continue to Day {sessionIndex + 2}</span>
              <span>→</span>
            </button>
          )}
          <button
            onClick={onDashboard}
            className={`w-full py-3 rounded-xl border text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              hasNext
                ? 'border-slate-700/50 bg-slate-800/30 text-slate-400 hover:text-white hover:bg-slate-700/40'
                : 'border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30'
            }`}
          >
            <span>🏠</span>
            <span>{hasNext ? 'Back to Module Dashboard' : 'Complete — Back to Dashboard'}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="my-8 border-t border-slate-700/30" />

        {/* Answer review (collapsible feel via scroll) */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/20 overflow-hidden">
          <div className="p-4 border-b border-slate-700/40">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Answer Review</h3>
          </div>
          <div className="divide-y divide-slate-700/30 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`p-4 ${r.isCorrect ? 'bg-emerald-500/3' : 'bg-rose-500/3'}`}>
                <div className="flex gap-3">
                  <span className={`flex-shrink-0 text-sm ${r.isCorrect ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.isCorrect ? '✓' : '✗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-semibold mb-1">{r.question}</p>
                    {!r.isCorrect && (
                      <>
                        <p className="text-xs text-rose-400">Your answer: {r.userAnswer || '(no answer)'}</p>
                        <p className="text-xs text-emerald-400">Correct: {r.answer}</p>
                      </>
                    )}
                    {r.explanation && (
                      <p className="text-xs text-slate-500 mt-1 italic">{r.explanation}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ModuleSession ───────────────────────────────────────────────────────

export default function ModuleSession() {
  const { moduleId, sessionIndex: sessionIndexStr } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const searchParams = new URLSearchParams(location.search);
  const assignmentId = searchParams.get('assignmentId');
  const sessionIndex = parseInt(sessionIndexStr || '0', 10);

  const [phase, setPhase] = useState('content'); // 'content' | 'quiz' | 'score'
  const [module, setModule] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [quizScore, setQuizScore] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [quizKey, setQuizKey] = useState(0); // increment to force QuizPhase remount on retry
  const [preparingDeep, setPreparingDeep] = useState(false);
  const deepAttemptRef = useRef(null); // "moduleId-sessionIndex" already attempted this mount
  // Observer mode — an admin/manager reviewing someone else's assigned
  // session. Must never write to their progress, and must not trigger content
  // generation on the shared module as a side effect of just looking.
  const [isObserver, setIsObserver] = useState(false);
  const [observedName, setObservedName] = useState('');

  useEffect(() => {
    loadData();
  }, [moduleId, sessionIndex]);

  const loadData = async () => {
    setLoading(true);
    setPhase('content');
    setQuizScore(null);
    try {
      const [modRes, assignRes] = await Promise.allSettled([
        authFetch(`/api/modules/${moduleId}`),
        assignmentId ? authFetch(`/api/assignments/${assignmentId}`) : Promise.resolve(null),
      ]);

      let mod = null;
      if (modRes.status === 'fulfilled' && modRes.value?.id) {
        mod = modRes.value;
      } else if (assignRes.status === 'fulfilled' && assignRes.value?.module?.id) {
        mod = assignRes.value.module;
      } else if (assignRes.status === 'fulfilled' && assignRes.value) {
        const a = assignRes.value;
        mod = { id: moduleId, title: a.module_name || a.title || 'Your Module', sessions: [], content: {} };
      }

      if (!mod) throw new Error('Module not found');
      setModule(mod);

      const sessions = mod.sessions || mod.content?.sessions || [];
      const sess = sessions[sessionIndex];
      if (!sess) throw new Error(`Session ${sessionIndex + 1} not found`);
      setSession(sess);

      // If this session was already completed, restore its saved review
      // instead of dropping the employee back at the content phase — without
      // this, reopening (or even just refreshing) a finished day permanently
      // lost the correct/incorrect breakdown and explanations, since `phase`
      // otherwise always resets to 'content' on load.
      const assignment = assignRes.status === 'fulfilled' ? assignRes.value : null;
      if (assignment) {
        const ownerId = assignment.assigned_to_user || assignment.assignedToUser || assignment.employeeId || assignment.userId;
        setIsObserver(!!ownerId && !!user?.userId && ownerId !== user.userId);
        setObservedName(assignment.employeeName || assignment.userName || 'this employee');
      }
      const sessionProgress = assignment?.sessionProgress || assignment?.session_progress || {};
      const savedReport = assignment?.progress_data?.sessionReports?.[sessionIndex]
        || assignment?.progressData?.sessionReports?.[sessionIndex];
      if (sessionProgress[sessionIndex] === 'completed' && Array.isArray(savedReport?.results)) {
        setQuizScore({ correct: savedReport.correct, total: savedReport.total, pct: savedReport.score, results: savedReport.results });
        setPhase('score');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Self-heal for a session that isn't deep yet — the background job
  // normally lands content well before a day unlocks, but this covers the
  // rare race and pre-existing modules created before per-day generation
  // existed. Guarded to attempt at most once per module+day per mount so a
  // generation failure (or an intentionally thin v1 module) can't retry in a
  // loop; the employee simply keeps the legacy rendering for that day.
  useEffect(() => {
    if (!session || !moduleId) return;
    if (isObserver) return; // reviewing — never mutate the shared module here
    const isDeep = session.contentVersion === 2 && Array.isArray(session.blocks) && session.blocks.length >= 6;
    if (isDeep) return;
    const attemptKey = `${moduleId}-${sessionIndex}`;
    if (deepAttemptRef.current === attemptKey) return;
    deepAttemptRef.current = attemptKey;

    let cancelled = false;
    setPreparingDeep(true);
    authFetch(`/api/modules/${moduleId}/sessions/${sessionIndex}/ensure-content`, { method: 'POST' })
      .then(res => {
        if (cancelled) return;
        const updated = res?.session;
        if (updated) setSession(updated);
      })
      .catch(() => { /* stay on the legacy rendering for this day */ })
      .finally(() => { if (!cancelled) setPreparingDeep(false); });
    return () => { cancelled = true; };
  }, [session, moduleId, sessionIndex, isObserver]);

  // Called by QuizPhase when the user submits their answers.
  // Always saves progress regardless of score, then transitions to score phase.
  const handleQuizDone = async (score) => {
    setQuizScore(score);
    setPhase('score');
    await saveQuizProgress(score);
  };

  // Persists the completed session's progress + score to the assignment.
  // Extracted from handleQuizDone so the score screen can retry it — this
  // write must never fail silently: if it doesn't land, the employee's
  // completed session is invisible to their manager/admin forever with no
  // indication anything went wrong.
  const saveQuizProgress = async (score) => {
    if (!assignmentId) return;
    // An admin/manager reviewing this session must never overwrite the
    // employee's own completion status or score.
    if (isObserver) return;

    setSaving(true);
    setSaveError(false);
    try {
      // Fetch current assignment to get the full existing state
      const current = await authFetch(`/api/assignments/${assignmentId}`);
      const existingProgress = current?.sessionProgress || current?.session_progress || {};
      const existingProgressData = current?.progress_data || {};
      const existingSessionReports = existingProgressData?.sessionReports || {};

      // Merge session completion — never overwrite previous sessions
      const mergedProgress = { ...existingProgress, [sessionIndex]: 'completed' };

      // Calculate overall progress from ACTUAL session count — never default to 1 (causes instant 100%)
      const allSessions = module?.sessions || module?.content?.sessions || current?.module?.sessions || [];
      const totalSessions = allSessions.length > 0
        ? allSessions.length
        : Math.max(Object.keys(mergedProgress).length, sessionIndex + 1);
      const completedCount = Object.values(mergedProgress).filter(s => s === 'completed').length;
      const newProgress = totalSessions > 0 ? Math.min(100, Math.round((completedCount / totalSessions) * 100)) : 0;
      // Only mark completed when ALL sessions are truly done
      const allDone = allSessions.length > 0 && completedCount >= allSessions.length;
      const newStatus = allDone ? 'completed' : 'in_progress';

      // Build per-session report for analytics/reports. `results` is the full
      // per-question breakdown (question, options, userAnswer, correct answer,
      // isCorrect, explanation) — persisted in full so reopening this session
      // later restores the exact same review the employee saw right after
      // submitting, not just the truncated strengths/weaknesses summary.
      const sessionReport = {
        score: score.pct,
        correct: score.correct,
        total: score.total,
        completedAt: new Date().toISOString(),
        sessionTitle: session?.title || session?.topic || `Day ${sessionIndex + 1}`,
        strengths: score.results.filter(r => r.isCorrect).map(r => r.question).slice(0, 3),
        weaknesses: score.results.filter(r => !r.isCorrect).map(r => r.question).slice(0, 3),
        results: score.results,
      };

      await authFetch(`/api/assignments/${assignmentId}`, {
        method: 'PUT',
        body: JSON.stringify({
          sessionProgress: mergedProgress,
          status: newStatus,
          progress: newProgress,
          progress_data: {
            ...existingProgressData,
            sessionReports: { ...existingSessionReports, [sessionIndex]: sessionReport },
          },
        }),
      });
    } catch (_) {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const goToDashboard = () => {
    navigate(`/module/${moduleId}/learn${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  };

  const goToNextSession = () => {
    navigate(`/module/${moduleId}/session/${sessionIndex + 1}${assignmentId ? `?assignmentId=${assignmentId}` : ''}`);
  };

  const handleRewatch = () => {
    setPhase('content');
  };

  const handleRetryQuiz = () => {
    setQuizKey(k => k + 1); // force QuizPhase to remount and reload fresh questions
    setPhase('quiz');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-indigo-400 text-4xl mb-4">⟳</div>
          <p className="text-slate-400 text-sm">Loading session…</p>
        </div>
      </div>
    );
  }

  if (error || !module || !session) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-white mb-2">Session Not Found</h2>
          <p className="text-slate-400 text-sm mb-6">{error}</p>
          <button
            onClick={goToDashboard}
            className="px-6 py-3 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
          >
            ← Back to Module
          </button>
        </div>
      </div>
    );
  }

  // Must match loadData's own read of the session list (line ~1627) —
  // `module.sessions` (top-level) can go stale relative to
  // `module.content.sessions` for modules stored via the JSONB fallback path
  // (see db/store.js), because an edit that only touches `content.sessions`
  // (e.g. removing a day in ModuleManagement's SessionsEditor) never updates
  // that top-level mirror. Reading `content.sessions` first is what
  // ScorePhase's "Continue to Next Day" button correctness depends on: a
  // stale, larger `module.sessions` count was making that button appear even
  // for a module that now genuinely has only one day.
  const totalSessions = (module?.content?.sessions || module?.sessions || []).length || 1;

  // Every phase renders its own full-page layout, so the review banner is
  // wrapped around whichever one is active rather than living inside them.
  const withObserverBanner = (node) => {
    if (!isObserver) return node;
    return (
      <>
        <div className="sticky top-0 z-50 bg-indigo-600/95 backdrop-blur px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-white font-semibold">
            👁 Reviewing {observedName}'s session — nothing here is saved to their progress
          </p>
          <button
            onClick={() => navigate(`/admin/modules?edit=${moduleId}`)}
            className="px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors flex-shrink-0"
          >
            ✎ Edit Module
          </button>
        </div>
        {node}
      </>
    );
  };

  if (phase === 'content') {
    return withObserverBanner(
      <ContentPhase
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        preparingDeep={preparingDeep}
        onStartQuiz={() => setPhase('quiz')}
        onOpenNotes={() => setPhase('notes')}
        onHome={goToDashboard}
      />
    );
  }

  if (phase === 'notes') {
    return withObserverBanner(
      <NotesPhase
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        quizResults={quizScore?.results}
        onBack={() => setPhase(quizScore ? 'score' : 'content')}
        onHome={goToDashboard}
      />
    );
  }

  if (phase === 'quiz') {
    return withObserverBanner(
      <QuizPhase
        key={quizKey}
        session={session}
        sessionIndex={sessionIndex}
        module={module}
        onComplete={handleQuizDone}
      />
    );
  }

  if (phase === 'score' && quizScore) {
    return withObserverBanner(
      <ScorePhase
        score={quizScore}
        sessionTitle={session?.title || session?.topic || `Day ${sessionIndex + 1}`}
        sessionIndex={sessionIndex}
        totalSessions={totalSessions}
        // No save is attempted while observing, so never show saving/retry UI
        saving={isObserver ? false : saving}
        saveError={isObserver ? false : saveError}
        onRetrySave={() => saveQuizProgress(quizScore)}
        onRewatch={handleRewatch}
        onRetryQuiz={handleRetryQuiz}
        onNextSession={goToNextSession}
        onDashboard={goToDashboard}
        onOpenNotes={() => setPhase('notes')}
      />
    );
  }

  return null;
}
