/**
 * pdfReports.js — Assessment report PDFs (individual + consolidated).
 *
 * Layout rules (the owner's main complaint was gaps and clutter):
 *  - content flows continuously; a new page starts only when the next block
 *    does not fit (or, before a major section, when < 25% of the page is left)
 *  - a heading is never left alone at the bottom of a page
 *  - table header rows repeat on every page; row height comes from the real
 *    wrapped text (nothing fixed, no padding rows)
 *  - a page is only ever added right before something is drawn on it, so there
 *    are no blank pages; the render meta reports where content ends per page
 *  - Helvetica only; one accent colour; the four rating colours only for ratings, green/red for right/wrong
 */
import PDFDocument from 'pdfkit';
import {
  DASH, safe, fmtDate, fmtPct, fmtDuration, truncate, reportTimezone, STATUS,
  buildSummary, skillAverages, followUpList, ratingLabel,
} from './reportData.js';
import { RATINGS } from '../grading.js';

const C = {
  accent: '#4338CA', accentSoft: '#EEF2FF', ink: '#1E293B', body: '#334155', muted: '#64748B',
  line: '#E2E8F0', zebra: '#F8FAFC', white: '#FFFFFF',
  green: '#15803D', greenSoft: '#DCFCE7', red: '#B91C1C', redSoft: '#FEE2E2', grey: '#475569', greySoft: '#E2E8F0',
};
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const LINE_GAP = 1.5;
const MAX_TEXT = 400;

/** Standard PDF fonts only cover Latin text; anything else becomes "?" instead of garbage. */
export function pdfSafe(v) {
  return String(v ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[→➔]/g, '->')
    .replace(/[^\n\x20-\x7E\xA0-\xFF–—•…]/g, '?');
}

class Layout {
  constructor({ title, company, generatedText }) {
    this.title = pdfSafe(title);
    this.doc = new PDFDocument({
      size: 'A4', bufferPages: true, margins: { top: 44, bottom: 54, left: 40, right: 40 },
      info: { Title: this.title, Producer: 'SkillForge', Creator: 'SkillForge' },
    });
    this.chunks = [];
    this.doc.on('data', c => this.chunks.push(c));
    this.done = new Promise(res => this.doc.on('end', () => res(Buffer.concat(this.chunks))));
    const m = this.doc.page.margins;
    this.x0 = m.left;
    this.w = this.doc.page.width - m.left - m.right;
    this.top = m.top;
    this.limit = this.doc.page.height - m.bottom - 0.5;
    this.contentH = this.limit - this.top;
    this.y = this.top;
    this.pageIdx = 0;
    this.pageEnd = [this.top];
    this.drawPage1Header(company, generatedText);
  }

  // ── page management ───────────────────────────────────────────────────────
  mark(y) { if (y > this.pageEnd[this.pageIdx]) this.pageEnd[this.pageIdx] = y; }
  remaining() { return this.limit - this.y; }
  newPage() {
    this.doc.addPage();
    this.pageIdx += 1;
    this.pageEnd[this.pageIdx] = this.top;
    this.y = this.top;
  }
  ensure(h) { if (this.y + h > this.limit && this.y > this.top + 1) this.newPage(); }
  gap(h) { this.y += h; }

  drawPage1Header(company, generatedText) {
    const d = this.doc;
    d.font(BOLD).fontSize(9).fillColor(C.accent).text(pdfSafe(company || 'SkillForge'), this.x0, this.y, { width: this.w * 0.6, lineBreak: false });
    d.font(FONT).fontSize(8.5).fillColor(C.muted).text(pdfSafe(generatedText), this.x0, this.y + 0.5, { width: this.w, align: 'right', lineBreak: false });
    this.y += 14;
    d.moveTo(this.x0, this.y).lineTo(this.x0 + this.w, this.y).lineWidth(0.8).strokeColor(C.accent).stroke();
    this.y += 10;
    this.mark(this.y);
  }

  // ── measuring + text ──────────────────────────────────────────────────────
  measure(text, { size = 9.5, bold = false, width = this.w } = {}) {
    this.doc.font(bold ? BOLD : FONT).fontSize(size);
    return this.doc.heightOfString(pdfSafe(text) || ' ', { width, lineGap: LINE_GAP });
  }

  text(text, { size = 9.5, bold = false, color = C.body, width = this.w, x = this.x0, align = 'left', after = 4 } = {}) {
    const h = this.measure(text, { size, bold, width });
    this.ensure(h);
    this.doc.font(bold ? BOLD : FONT).fontSize(size).fillColor(color)
      .text(pdfSafe(text) || ' ', x, this.y, { width, align, lineGap: LINE_GAP });
    this.y += h + after;
    this.mark(this.y);
    return h;
  }

  title1(text, sub) {
    this.text(text, { size: 20, bold: true, color: C.ink, after: 2 });
    if (sub) this.text(sub, { size: 10.5, color: C.muted, after: 6 });
  }

  /**
   * Major section heading. No forced page break: the heading moves to the next
   * page only when it plus the first `keepWith` points of its content would not
   * fit (keep-with-next), so pages are filled instead of leaving gaps.
   */
  section(title, keepWith = 70, right = '') {
    if (this.y > this.top + 1) this.y += 8;
    this.ensure(26 + keepWith);
    this.doc.font(BOLD).fontSize(13).fillColor(C.accent).text(pdfSafe(title), this.x0, this.y, { width: this.w, lineBreak: false });
    if (right) this.doc.font(FONT).fontSize(8.5).fillColor(C.muted).text(pdfSafe(right), this.x0, this.y + 4, { width: this.w, align: 'right', lineBreak: false });
    this.y += 17;
    this.doc.moveTo(this.x0, this.y).lineTo(this.x0 + this.w, this.y).lineWidth(0.5).strokeColor(C.line).stroke();
    this.y += 6;
    this.mark(this.y);
  }

  subheading(title, keepWith = 50) {
    this.ensure(18 + keepWith);
    this.doc.font(BOLD).fontSize(10.5).fillColor(C.ink).text(pdfSafe(title), this.x0, this.y, { width: this.w, lineBreak: false });
    this.y += 15;
    this.mark(this.y);
  }

  // ── primitives ────────────────────────────────────────────────────────────
  tag(text, x, y, { color, bg }) {
    const d = this.doc;
    d.font(BOLD).fontSize(7.5);
    const w = d.widthOfString(pdfSafe(text)) + 12;
    d.roundedRect(x, y, w, 13, 3).fill(bg);
    d.fillColor(color).text(pdfSafe(text), x + 6, y + 3.2, { width: w, lineBreak: false });
    return w;
  }

  bar(x, y, w, h, pct, color = C.accent) {
    const d = this.doc;
    d.roundedRect(x, y, w, h, h / 2).fill(C.greySoft);
    const fw = Math.max(0, Math.min(100, Number(pct) || 0)) / 100 * w;
    if (fw > 0.5) d.roundedRect(x, y, Math.max(fw, h), h, h / 2).fill(color);
  }

  /** key/value grid: label above value; per-row heights from wrapped text. */
  kvGrid(pairs, cols = 3) {
    const cw = this.w / cols;
    const padX = 8, padY = 5;
    for (let i = 0; i < pairs.length; i += cols) {
      const chunk = pairs.slice(i, i + cols);
      const heights = chunk.map(p => 10 + this.measure(safe(p.value), { size: 10, bold: true, width: cw - 2 * padX }));
      const h = Math.max(...heights) + 2 * padY;
      this.ensure(h);
      const d = this.doc;
      chunk.forEach((p, j) => {
        const x = this.x0 + j * cw;
        d.rect(x, this.y, cw, h).lineWidth(0.5).fillAndStroke(C.zebra, C.line);
        d.font(FONT).fontSize(7.5).fillColor(C.muted).text(pdfSafe(p.label).toUpperCase(), x + padX, this.y + padY, { width: cw - 2 * padX, lineBreak: false });
        d.font(BOLD).fontSize(10).fillColor(p.color || C.ink).text(pdfSafe(safe(p.value)), x + padX, this.y + padY + 10, { width: cw - 2 * padX, lineGap: LINE_GAP });
      });
      this.y += h;
      this.mark(this.y);
    }
    this.y += 6;
  }

  /** compact big-number tiles, up to `perRow` per row. */
  statRow(items, perRow = 4) {
    const gapX = 8;
    const cw = (this.w - gapX * (perRow - 1)) / perRow;
    const h = 42;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h);
      items.slice(i, i + perRow).forEach((it, j) => {
        const x = this.x0 + j * (cw + gapX);
        const d = this.doc;
        d.roundedRect(x, this.y, cw, h, 4).fillAndStroke(C.accentSoft, C.line);
        d.font(BOLD).fontSize(16).fillColor(it.color || C.accent).text(pdfSafe(safe(it.value)), x + 8, this.y + 6, { width: cw - 16, lineBreak: false });
        d.font(FONT).fontSize(8).fillColor(C.muted).text(pdfSafe(it.label), x + 8, this.y + 27, { width: cw - 16, lineBreak: false });
      });
      this.y += h + 6;
      this.mark(this.y);
    }
  }

  /**
   * columns: [{ header, w (relative weight), align }]
   * rows: arrays of cell = string | { text, color, bold } | { bar: pct }
   */
  table(columns, rows, { size = 8.5, emptyText = null } = {}) {
    if (!rows.length) {
      if (emptyText) this.text(emptyText, { color: C.muted, size: 9.5, after: 6 });
      return;
    }
    const padX = 4, padY = 3.5;
    const totalW = columns.reduce((a, c) => a + c.w, 0);
    const widths = columns.map(c => (c.w / totalW) * this.w);
    const d = this.doc;

    const headerH = Math.max(...columns.map((c, i) => this.measure(c.header, { size: 8, bold: true, width: widths[i] - 2 * padX }))) + 2 * padY;
    const cellText = (cell) => (cell && typeof cell === 'object' ? cell.text : cell);
    const rowHeight = (row) => Math.max(...row.map((cell, i) => {
      if (cell && typeof cell === 'object' && cell.bar !== undefined) return 9;
      const t = safe(cellText(cell));
      return this.measure(t, { size, bold: !!cell?.bold, width: widths[i] - 2 * padX });
    })) + 2 * padY;

    const drawHeader = () => {
      let x = this.x0;
      d.rect(this.x0, this.y, this.w, headerH).fill(C.accent);
      columns.forEach((c, i) => {
        d.font(BOLD).fontSize(8).fillColor(C.white)
          .text(pdfSafe(c.header), x + padX, this.y + padY, { width: widths[i] - 2 * padX, align: c.align || 'left', lineGap: LINE_GAP });
        x += widths[i];
      });
      this.y += headerH;
      this.mark(this.y);
    };

    const firstH = rowHeight(rows[0]);
    this.ensure(headerH + firstH);
    drawHeader();
    rows.forEach((row, ri) => {
      const rh = rowHeight(row);
      if (this.y + rh > this.limit) { this.newPage(); drawHeader(); }
      if (ri % 2 === 1) d.rect(this.x0, this.y, this.w, rh).fill(C.zebra);
      let x = this.x0;
      row.forEach((cell, i) => {
        if (cell && typeof cell === 'object' && cell.bar !== undefined) {
          this.bar(x + padX, this.y + (rh - 8) / 2, widths[i] - 2 * padX, 8, cell.bar);
        } else {
          d.font(cell?.bold ? BOLD : FONT).fontSize(size).fillColor(cell?.color || C.body)
            .text(pdfSafe(safe(cellText(cell))), x + padX, this.y + padY, { width: widths[i] - 2 * padX, align: columns[i].align || 'left', lineGap: LINE_GAP });
        }
        x += widths[i];
      });
      d.moveTo(this.x0, this.y + rh).lineTo(this.x0 + this.w, this.y + rh).lineWidth(0.4).strokeColor(C.line).stroke();
      this.y += rh;
      this.mark(this.y);
    });
    this.y += 6;
  }

  bulletBlock(items, width, size = 9.5) {
    return items.reduce((h, t) => h + this.measure(t, { size, width: width - 12 }) + 2.5, 0);
  }

  drawBullets(items, x, y, width, { size = 9.5, marker = '•', numbered = false, start = 0 } = {}) {
    const d = this.doc;
    let cy = y;
    items.forEach((t, i) => {
      const h = this.measure(t, { size, width: width - 14 });
      d.font(BOLD).fontSize(size).fillColor(C.accent).text(numbered ? `${start + i + 1}.` : marker, x, cy, { width: 12, lineBreak: false });
      d.font(FONT).fontSize(size).fillColor(C.body).text(pdfSafe(t), x + 14, cy, { width: width - 14, lineGap: LINE_GAP });
      cy += h + 2.5;
    });
    return cy;
  }

  /** two side-by-side lists (e.g. What went well | What to improve); breaks between rows. */
  twoLists(left, right) {
    const gapX = 10;
    const bw = (this.w - gapX) / 2;
    const inner = bw - 16;
    const prep = (b) => ({ ...b, items: b.items.length ? b.items : [b.empty] });
    const cols = [prep(left), prep(right)];
    const n = Math.max(cols[0].items.length, cols[1].items.length);
    const titleH = 24;
    const rowH = (i) => Math.max(...cols.map(b => (i < b.items.length ? this.measure(b.items[i], { size: 9.5, width: inner - 14 }) + 2.5 : 0)));
    // plan page segments
    const segs = [];
    let cur = null;
    let y = this.y;
    this.ensure(titleH + rowH(0) + 8);
    y = this.y;
    for (let i = 0; i < n; i++) {
      const h = rowH(i);
      if (!cur) { cur = { from: i, to: i, title: segs.length === 0, h: segs.length === 0 ? titleH : 6 }; y += cur.h; }
      if (y + h + 6 > this.limit && cur.to > cur.from - 0 && i > cur.from) { segs.push(cur); cur = { from: i, to: i, title: false, h: 6 }; y = this.top + 6; }
      cur.h += h; cur.to = i + 1; y += h;
    }
    if (cur) segs.push(cur);
    segs.forEach((seg, si) => {
      if (si > 0) this.newPage();
      const d = this.doc;
      const h = seg.h + 4;
      cols.forEach((b, ci) => {
        const x = this.x0 + ci * (bw + gapX);
        d.rect(x, this.y, bw, h).fillAndStroke(C.zebra, C.line);
        d.rect(x, this.y, 3, h).fill(b.color);
        if (seg.title) d.font(BOLD).fontSize(10.5).fillColor(b.color).text(pdfSafe(b.title), x + 12, this.y + 7, { width: inner, lineBreak: false });
        let cy = this.y + (seg.title ? titleH : 6);
        for (let i = seg.from; i < seg.to; i++) {
          if (i < b.items.length) this.drawBullets([b.items[i]], x + 12, cy, inner);
          cy += rowH(i);
        }
      });
      this.y += h;
      this.mark(this.y);
    });
    this.y += 6;
  }

  numbered(items) {
    // one item at a time so a long list can break across pages cleanly
    items.forEach((t, idx) => {
      const ih = this.measure(t, { size: 9.5, width: this.w - 14 }) + 2.5;
      this.ensure(ih);
      this.y = this.drawBullets([t], this.x0, this.y, this.w, { numbered: true, start: idx });
      this.mark(this.y);
    });
    this.y += 4;
  }

  footer() {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      const m = d.page.margins;
      const prevBottom = m.bottom;
      m.bottom = 0; // allow drawing inside the bottom margin without triggering a new page
      const y = d.page.height - 38;
      d.moveTo(this.x0, y - 5).lineTo(this.x0 + this.w, y - 5).lineWidth(0.4).strokeColor(C.line).stroke();
      d.font(FONT).fontSize(8).fillColor(C.muted).text(this.title, this.x0, y, { width: this.w * 0.75, lineBreak: false, ellipsis: true });
      d.text(`Page ${i + 1} of ${range.count}`, this.x0, y, { width: this.w, align: 'right', lineBreak: false });
      m.bottom = prevBottom;
    }
  }

  async finish() {
    this.footer();
    this.doc.end();
    const buffer = await this.done;
    return { buffer, meta: { pageCount: this.pageEnd.length, pageEnd: this.pageEnd.slice(), top: this.top, limit: this.limit } };
  }
}

const generatedLine = (now, tz) => `Generated ${fmtDate(now, tz)}`;
// Rating -> text colour (dark) and bar colour (solid), same four colours as Excel / Word.
const ratingColor = (label) => { const m = RATINGS.find(r => r.label === label); return m ? `#${m.text}` : C.ink; };
const ratingBar = (label) => { const m = RATINGS.find(r => r.label === label); return m ? `#${m.solid}` : C.accent; };

// ── INDIVIDUAL REPORT ───────────────────────────────────────────────────────
export async function renderIndividualPdf({ row, now = new Date(), tz = reportTimezone() }) {
  const L = new Layout({
    title: `Assessment Report - ${safe(row.name, 'Employee')} - ${safe(row.assessmentTitle, 'Assessment')}`,
    company: row.companyName || 'SkillForge',
    generatedText: generatedLine(now, tz),
  });
  const done = row.status === STATUS.COMPLETED;

  // 1) header block
  L.title1('Assessment Report', `${safe(row.name)}  |  ${safe(row.assessmentTitle)}`);
  L.kvGrid([
    { label: 'Employee ID', value: row.employeeId },
    { label: 'Job role', value: row.jobRole },
    { label: 'Department', value: row.department },
    { label: 'Manager', value: row.managerName },
    { label: 'Assessment type', value: row.assessmentType },
    { label: 'Company', value: row.companyName },
  ], 3);

  // 2) at a glance
  L.section('At a glance', 48);
  const rLabel = ratingLabel(row);
  const scoreText = done && row.scorePct !== null
    ? `${fmtPct(row.scorePct, 1)}${row.correct !== null && row.total ? `  (${row.correct} of ${row.total} correct)` : ''}`
    : DASH;
  L.kvGrid([
    { label: 'Score', value: scoreText },
    { label: 'Rating', value: done ? row.rating : rLabel, color: done ? ratingColor(row.rating) : C.ink },
    { label: 'Time taken', value: row.timeTakenMin !== null ? `${fmtDuration(row.timeTakenMin)} of ${row.timeLimitMin} min` : `${DASH} (limit ${row.timeLimitMin} min)` },
    { label: 'Attempt no.', value: row.attemptNo },
    { label: 'Assigned on', value: fmtDate(row.assignedAt, tz) },
    { label: 'Started', value: fmtDate(row.startedAt, tz) },
    { label: 'Completed on', value: fmtDate(row.completedAt, tz) },
  ], 3);

  if (!done) {
    L.text(`This employee has not completed the assessment yet (status: ${row.status}). Scores and answers will appear here once it is submitted.`, { color: C.muted, after: 6 });
    return L.finish();
  }

  // 3) skill scores
  if (row.skills.length) {
    L.section('Skill scores', 48);
    L.table(
      [{ header: 'Skill', w: 44 }, { header: 'Correct / Total', w: 17, align: 'center' }, { header: 'Score', w: 12, align: 'right' }, { header: '', w: 27 }],
      row.skills.map(s => [s.skill, `${s.correct ?? DASH} / ${s.total ?? DASH}`, { text: s.pct === null ? DASH : `${s.pct}%`, bold: true }, { bar: s.pct ?? 0 }]),
    );
  }

  // 4) what went well / what to improve / next steps
  const improve = [
    ...row.weakAreas,
    ...row.missingSkills.filter(m => !row.weakAreas.includes(m)).map(m => `${m} (no correct answers)`),
  ];
  const cap = (arr, n = 8) => (arr.length > n ? [...arr.slice(0, n), `and ${arr.length - n} more`] : arr);
  const wentWell = { title: 'What went well', items: cap(row.strengths), color: C.green, empty: 'No skill reached the 70% mark yet.' };
  const toImprove = { title: 'What to improve', items: cap(improve), color: C.red, empty: 'Nothing flagged. Well done.' };
  L.section('Strengths and next steps', 50);
  L.twoLists(wentWell, toImprove);
  if (row.recommendations.length) {
    L.subheading('Recommended next steps', 30);
    L.numbered(cap(row.recommendations.map(t => truncate(t, MAX_TEXT).text), 8));
  }

  // 5) question review
  if (row.questions.length) {
    const cnt = (r) => row.questions.filter(q => q.result === r).length;
    L.section('Question review', 30, `${row.questions.length} questions: ${cnt('Correct')} correct, ${cnt('Wrong')} wrong, ${cnt('Not answered')} not answered`);
    row.questions.forEach(q => drawQuestionBlock(L, q));
  }
  return L.finish();
}

function drawQuestionBlock(L, q) {
  const d = L.doc;
  const pad = 8;
  const inner = L.w - pad - 4;
  const clip = (s) => { const t = truncate(s, MAX_TEXT); return t.truncated ? `${t.text} (shortened)` : t.text; };
  const qText = clip(q.question) || DASH;
  const mine = q.userAnswer ? clip(q.userAnswer) : 'Not answered';
  const right = clip(q.correctAnswer) || DASH;
  const why = q.explanation ? clip(q.explanation) : '';
  const LABEL_W = 88;

  const hHead = 14;
  const wrap = (text, width, size, bold) => {
    d.font(bold ? BOLD : FONT).fontSize(size);
    const out = [];
    for (const para of pdfSafe(text).split('\n')) {
      let cur = '';
      for (let word of para.split(' ')) {
        while (d.widthOfString(word) > width) { // a single over-long token
          let k = word.length - 1;
          while (k > 1 && d.widthOfString(word.slice(0, k)) > width) k--;
          if (cur) { out.push(cur); cur = ''; }
          out.push(word.slice(0, k));
          word = word.slice(k);
        }
        const trial = cur ? `${cur} ${word}` : word;
        if (d.widthOfString(trial) <= width || !cur) cur = trial; else { out.push(cur); cur = word; }
      }
      out.push(cur);
    }
    return out;
  };
  const lineH = (size, bold) => L.measure('Ag', { size, bold, width: 1000 });
  const colors = q.result === 'Correct' ? { color: C.green, bg: C.greenSoft } : q.result === 'Wrong' ? { color: C.red, bg: C.redSoft } : { color: C.grey, bg: C.greySoft };
  const qLines = wrap(qText, inner, 9.5, true);
  const lhQ = lineH(9.5, true);
  // number/tag line + the first line of the question stay together; everything after may continue on the next page
  L.ensure(hHead + Math.min(1, qLines.length) * lhQ + 4);

  let y = L.y;
  let segStart = y;
  const x = L.x0 + pad;
  d.font(BOLD).fontSize(9).fillColor(C.accent).text(`Q${q.no}`, x, y + 1, { width: 40, lineBreak: false });
  const skillTxt = [q.skill, q.difficulty].filter(Boolean).join('  |  ');
  if (skillTxt) d.font(FONT).fontSize(8).fillColor(C.muted).text(pdfSafe(skillTxt), x + 30, y + 1.5, { width: inner - 100, lineBreak: false, ellipsis: true });
  const tw = d.font(BOLD).fontSize(7.5).widthOfString(q.result) + 12;
  L.tag(q.result, L.x0 + L.w - tw, y, colors);
  y += hHead;

  const closeSegment = () => { d.rect(L.x0, segStart, 2.5, Math.max(0, y - segStart)).fill(colors.color); L.y = y; L.mark(y); };
  const roomFor = (h) => {
    if (y + h > L.limit) { closeSegment(); L.newPage(); y = L.y; segStart = y; }
  };
  qLines.forEach((t) => {
    roomFor(lhQ);
    d.font(BOLD).fontSize(9.5).fillColor(C.ink).text(t, x, y, { width: inner + 40, lineBreak: false });
    y += lhQ;
  });
  y += 3;
  const field = (label, text, color = C.body, size = 9) => {
    const lines = wrap(text, inner - LABEL_W, size, false);
    const lh = lineH(size, false);
    lines.forEach((t, i) => {
      roomFor(lh);
      if (i === 0) d.font(BOLD).fontSize(size - 0.5).fillColor(C.muted).text(label, x, y, { width: LABEL_W - 4, lineBreak: false });
      d.font(FONT).fontSize(size).fillColor(color).text(t, x + LABEL_W, y, { width: inner, lineBreak: false });
      y += lh;
    });
    y += 1.5;
  };
  field('Your answer', mine, q.result === 'Correct' ? C.green : q.result === 'Wrong' ? C.red : C.muted);
  field('Correct answer', right);
  if (why) field('Why', why, C.muted, 8.5);
  y += 3;
  closeSegment();
  L.y = y + 3;
  d.moveTo(L.x0, L.y - 1.5).lineTo(L.x0 + L.w, L.y - 1.5).lineWidth(0.3).strokeColor(C.line).stroke();
  L.mark(L.y);
}

// ── CONSOLIDATED REPORT ─────────────────────────────────────────────────────
export async function renderConsolidatedPdf({ rows, summary, now = new Date(), tz = reportTimezone() }) {
  const sum = summary || buildSummary(rows, {}, null, now);
  const L = new Layout({
    title: `Assessment Results - ${safe(sum.title, 'Assessment')}`,
    company: sum.company || 'SkillForge',
    generatedText: generatedLine(now, tz),
  });

  // 1) title + facts
  const multi = sum.multi || null;
  const roleOrAssessment = multi ? { header: 'Assessment', pick: r => r.assessmentTitle } : { header: 'Job role', pick: r => r.jobRole };
  L.title1(safe(sum.title, 'Assessment'), multi ? 'All submitted assessments' : 'Assessment results report');
  L.kvGrid(multi ? [
    { label: 'Assessments covered', value: multi.assessments },
    { label: 'Records', value: rows.length },
    { label: 'Company', value: sum.company },
    { label: 'Generated on', value: fmtDate(now, tz, { time: false }) },
  ] : [
    { label: 'Type', value: sum.type },
    { label: 'Job role(s)', value: sum.jobRoles.join(', ') },
    { label: 'Company', value: sum.company },
    { label: 'Created on', value: fmtDate(sum.createdAt, tz, { time: false }) },
    { label: 'Starts', value: fmtDate(sum.startAt, tz) },
    { label: 'Due', value: fmtDate(sum.dueAt, tz) },
    { label: 'Time limit', value: `${sum.timeLimitMin} min` },
  ], 4);

  // 2) overview
  L.section('Overview', 48);
  L.statRow([
    { label: 'Assigned', value: sum.assigned },
    { label: 'Completed', value: sum.completed },
    { label: 'Not completed', value: sum.notCompleted },
    { label: 'Completion', value: fmtPct(sum.completionPct, 1) },
    { label: 'Average score', value: fmtPct(sum.avgScore, 1) },
    { label: 'Highest score', value: fmtPct(sum.highScore, 1) },
    { label: 'Lowest score', value: fmtPct(sum.lowScore, 1) },
    { label: 'Expert + Intermediate', value: fmtPct(sum.topSharePct, 1) },
  ], 4);
  if (sum.completed > 0) {
    L.subheading('Rating distribution', 52);
    const maxG = Math.max(1, ...sum.ratings.map(x => x.count));
    L.ensure(sum.ratings.length * 17);
    sum.ratings.forEach((x) => {
      const d = L.doc;
      const meta = RATINGS.find(m => m.label === x.label);
      d.font(BOLD).fontSize(9.5).fillColor(ratingColor(x.label)).text(x.label, L.x0, L.y + 1, { width: 72, lineBreak: false });
      d.font(FONT).fontSize(8.5).fillColor(C.muted).text(meta ? meta.range : '', L.x0 + 74, L.y + 1.5, { width: 90, lineBreak: false });
      L.bar(L.x0 + 168, L.y + 2, L.w - 280, 9, (x.count / maxG) * 100, ratingBar(x.label));
      d.font(BOLD).fontSize(9.5).fillColor(C.ink).text(`${x.count}  (${fmtPct(x.percent, 0)})`, L.x0 + L.w - 104, L.y + 1, { width: 104, align: 'right', lineBreak: false });
      L.y += 17;
      L.mark(L.y);
    });
  }

  // 3) results by employee
  L.section('Results by employee', 40);
  const sorted = rows.slice().sort((a, b) => safe(a.name, '').localeCompare(safe(b.name, '')));
  L.table(
    [
      { header: 'Employee ID', w: 62 }, { header: 'Name', w: 116 }, { header: roleOrAssessment.header, w: 92 },
      { header: 'Assigned', w: 62 }, { header: 'Completed', w: 62 },
      { header: 'Score', w: 40, align: 'right' }, { header: 'Rating', w: 81 },
    ],
    sorted.map(r => {
      const res = ratingLabel(r);
      return [
        r.employeeId, r.name, roleOrAssessment.pick(r),
        fmtDate(r.assignedAt, tz, { time: false }), fmtDate(r.completedAt, tz, { time: false }),
        r.status === STATUS.COMPLETED ? fmtPct(r.scorePct, 1) : DASH,
        { text: res, bold: true, color: r.status === STATUS.COMPLETED ? ratingColor(res) : C.muted },
      ];
    }),
    { size: 8, emptyText: 'No employees are assigned to this assessment.' },
  );

  // 4) skill performance
  const skills = skillAverages(rows);
  if (skills.length) {
    L.section('Skill performance', 50);
    L.text('Average score for each skill across everyone who completed the assessment. Weakest skills are listed first.', { size: 8.5, color: C.muted, after: 5 });
    const shown = skills.slice(0, 30);
    L.table(
      [{ header: 'Skill', w: 46 }, { header: 'People', w: 10, align: 'center' }, { header: 'Correct / Total', w: 16, align: 'center' }, { header: 'Average', w: 11, align: 'right' }, { header: '', w: 27 }],
      shown.map(s => [s.skill, String(s.people), `${s.correct} / ${s.total}`, { text: fmtPct(s.pct, 1), bold: true }, { bar: s.pct }]),
    );
    if (skills.length > shown.length) L.text(`and ${skills.length - shown.length} more skills (see the Excel file).`, { size: 8.5, color: C.muted });
  }

  // 5) needs follow-up
  L.section('Needs follow-up', 50);
  const follow = followUpList(rows, now);
  if (!follow.length) {
    L.text('Nobody needs follow-up: everyone has completed the assessment and earned a rating.', { color: C.green, bold: true });
  } else {
    L.text('Employees who have not completed the assessment, or finished with No Rating (below 70%). Most urgent first.', { size: 8.5, color: C.muted, after: 5 });
    L.table(
      [
        { header: 'Employee ID', w: 58 }, { header: 'Name', w: 106 }, { header: roleOrAssessment.header, w: 90 },
        { header: 'Status', w: 58 }, { header: 'Due', w: 62 }, { header: 'What to do', w: 141 },
      ],
      follow.map(f => [
        f.row.employeeId, f.row.name, roleOrAssessment.pick(f.row),
        { text: f.status, bold: true, color: f.status === 'No Rating' ? ratingColor('No Rating') : C.ink },
        fmtDate(f.row.dueAt, tz, { time: false }), f.reason,
      ]),
      { size: 8 },
    );
  }
  return L.finish();
}

export async function buildIndividualPdf(args) { return (await renderIndividualPdf(args)).buffer; }
export async function buildConsolidatedPdf(args) { return (await renderConsolidatedPdf(args)).buffer; }

/** Generic table (filtered-reports export): header repeats, row heights from text, wide tables split into column groups. */
export async function buildTablePdf({ title, metaLine, headers, rows }) {
  const L = new Layout({ title, company: 'SkillForge', generatedText: metaLine || '' });
  L.title1(safe(title, 'Reports'));
  const n = headers.length || 1;
  // Wide tables are split into column groups (ID + name repeated) so text stays readable in portrait.
  const MAX_COLS = 6;
  const groups = [];
  const keep = Math.min(2, n);
  if (n <= MAX_COLS) groups.push(headers.map((_, i) => i));
  else {
    const rest = headers.map((_, i) => i).slice(keep);
    const per = MAX_COLS - keep;
    for (let i = 0; i < rest.length; i += per) groups.push([...Array.from({ length: keep }, (_, k) => k), ...rest.slice(i, i + per)]);
  }
  groups.forEach((cols, gi) => {
    if (groups.length > 1) L.subheading(`Columns part ${gi + 1} of ${groups.length}`, 60);
    L.table(
      cols.map(ci => ({ header: safe(headers[ci], ''), w: 1 })),
      rows.map(r => cols.map(ci => truncate(Array.isArray(r) ? r[ci] : '', 300).text || DASH)),
      { size: 8, emptyText: 'No records match the selected filters.' },
    );
  });
  return (await L.finish()).buffer;
}
