/**
 * xlsxStyle.js — cell styling for the Excel reports.
 *
 * The community build of `xlsx` cannot write cell styles, frozen panes, print
 * setup or rotated text, so the workbook is written first and this module then
 * patches the package: it renders a complete styles.xml from the styles the
 * report code registered, and writes the style id, freeze pane, zoom, print
 * setup and print titles into the sheet / workbook XML.
 *
 * No new dependencies: only `adm-zip`, which the reports already use.
 */
import AdmZip from 'adm-zip';

// ── one palette for every workbook ──────────────────────────────────────────
export const PALETTE = {
  indigo: '4338CA',
  zebra: 'F8FAFC',
  grid: 'E2E8F0',
  ink: '1E293B',
  muted: '64748B',
  white: 'FFFFFF',
  band: 'EEF2FF',
  green: { fill: 'DCFCE7', text: '166534' },
  blue: { fill: 'DBEAFE', text: '1E40AF' },
  amber: { fill: 'FEF3C7', text: '92400E' },
  red: { fill: 'FEE2E2', text: '991B1B' },
  grey: { fill: 'F1F5F9', text: '475569' },
};

// Rating band -> colours (same four colours in Excel, PDF and Word).
export const RATING_COLOURS = {
  Expert: PALETTE.green,
  Intermediate: PALETTE.blue,
  Basic: PALETTE.amber,
  'No Rating': PALETTE.red,
};

export const STATUS_COLOURS = {
  Completed: PALETTE.green,
  'In progress': PALETTE.blue,
  'Not started': PALETTE.grey,
  Overdue: PALETTE.red,
  Cancelled: PALETTE.grey,
};

export const RESULT_COLOURS = {
  Correct: PALETTE.green,
  Wrong: PALETTE.red,
  'Not answered': PALETTE.grey,
};

// ── style registry ──────────────────────────────────────────────────────────
const fonts = [];
const fills = [];
const borders = [];
const numFmts = [];
const xfs = [];
const xfIndex = new Map();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function intern(list, xml) {
  let i = list.indexOf(xml);
  if (i === -1) { list.push(xml); i = list.length - 1; }
  return i;
}

function fontXml({ b, i, sz = 11, color = PALETTE.ink }) {
  return `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/><color rgb="FF${color}"/><name val="Calibri"/><family val="2"/></font>`;
}
function fillXml(rgb) {
  return rgb ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>` : '<fill><patternFill patternType="none"/></fill>';
}
function borderXml(on) {
  if (!on) return '<border><left/><right/><top/><bottom/><diagonal/></border>';
  const e = `<color rgb="FF${PALETTE.grid}"/>`;
  return `<border><left style="thin">${e}</left><right style="thin">${e}</right><top style="thin">${e}</top><bottom style="thin">${e}</bottom><diagonal/></border>`;
}

// Reserved entries so style id 0 is the plain default and fills 0/1 are the
// two the file format requires.
fonts.push(fontXml({}));
fills.push(fillXml(null), '<fill><patternFill patternType="gray125"/></fill>');
borders.push(borderXml(false));
xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');

/**
 * Register a style and get its id.
 * spec: { b, i, sz, color, fill, border (default true), h: 'left'|'center'|'right',
 *         v: 'center'|'top'|'bottom', numFmt, rotate, indent }
 * Text is NEVER wrapped: rows keep one fixed height and long text is read in the
 * formula bar, which is what keeps the sheets compact.
 */
export function style(spec = {}) {
  const { b = false, i = false, sz = 11, color = PALETTE.ink, fill = null, border = true, h = 'left', v = 'center', numFmt = null, rotate = 0, indent = 0 } = spec;
  const fontId = intern(fonts, fontXml({ b, i, sz, color }));
  const fillId = intern(fills, fillXml(fill));
  const borderId = intern(borders, borderXml(border));
  let fmtId = 0;
  if (numFmt) {
    const idx = intern(numFmts, numFmt);
    fmtId = 164 + idx;
  }
  const align = `<alignment horizontal="${h}" vertical="${v}"${rotate ? ` textRotation="${rotate}"` : ''}${indent ? ` indent="${indent}"` : ''}/>`;
  const xml = `<xf numFmtId="${fmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  let id = xfIndex.get(xml);
  if (id === undefined) { xfs.push(xml); id = xfs.length - 1; xfIndex.set(xml, id); }
  return id;
}

function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : '')
    + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
    + `<fills count="${fills.length}">${fills.join('')}</fills>`
    + `<borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

// ── package patch ───────────────────────────────────────────────────────────
/**
 * sheetMeta[i] = {
 *   styles: Map<'A1', styleId>,   // style of every styled cell
 *   freeze: { cols, rows },       // frozen columns / rows (0 = none)
 *   gridlines: boolean,           // default true
 *   zoom: number,                 // default 100
 *   landscape: boolean, fitWidth: boolean,
 *   printTitleRows: [from, to] | null,
 *   name: string,                 // sheet name (for print titles)
 * }
 */
export function patchPackage(buf, sheetMeta) {
  const zip = new AdmZip(buf);
  zip.updateFile('xl/styles.xml', Buffer.from(stylesXml(), 'utf8'));

  sheetMeta.forEach((meta, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    let xml = zip.readAsText(path);
    if (!xml) return;

    // style id on every cell (cells without a registered style get the default)
    xml = xml.replace(/<c r="([A-Z]+\d+)"(?: s="\d+")?/g, (_m, ref) => `<c r="${ref}" s="${meta.styles?.get(ref) ?? 0}"`);

    const f = meta.freeze || { cols: 0, rows: 0 };
    let pane = '';
    if (f.cols || f.rows) {
      const tl = `${colLetter(f.cols)}${f.rows + 1}`;
      const active = f.cols && f.rows ? 'bottomRight' : f.rows ? 'bottomLeft' : 'topRight';
      pane = `<pane${f.cols ? ` xSplit="${f.cols}"` : ''}${f.rows ? ` ySplit="${f.rows}"` : ''} topLeftCell="${tl}" activePane="${active}" state="frozen"/>`
        + `<selection pane="${active}" activeCell="${tl}" sqref="${tl}"/>`;
    }
    const views = `<sheetViews><sheetView${meta.gridlines === false ? ' showGridLines="0"' : ''}${i === 0 ? ' tabSelected="1"' : ''} zoomScale="${meta.zoom || 100}" zoomScaleNormal="${meta.zoom || 100}" workbookViewId="0">${pane}</sheetView></sheetViews>`;
    xml = /<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)
      ? xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views)
      : xml.replace(/(<dimension[^>]*\/>)/, `$1${views}`);

    if (meta.fitWidth) xml = xml.replace(/<dimension/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');

    const print = '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
      + `<pageSetup paperSize="9" orientation="${meta.landscape ? 'landscape' : 'portrait'}"${meta.fitWidth ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`;
    xml = /<ignoredErrors/.test(xml) ? xml.replace(/<ignoredErrors/, `${print}<ignoredErrors`) : xml.replace(/<\/worksheet>/, `${print}</worksheet>`);
    zip.updateFile(path, Buffer.from(xml, 'utf8'));
  });

  // print titles (header row repeats on every printed page)
  const titles = sheetMeta
    .map((m, i) => (m.printTitleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(m.name).replace(/'/g, "''")}'!$${m.printTitleRows[0]}:$${m.printTitleRows[1]}</definedName>` : ''))
    .join('');
  if (titles) {
    let wb = zip.readAsText('xl/workbook.xml');
    wb = /<definedNames>/.test(wb) ? wb.replace(/<definedNames>/, `<definedNames>${titles}`) : wb.replace(/<\/sheets>/, `</sheets><definedNames>${titles}</definedNames>`);
    zip.updateFile('xl/workbook.xml', Buffer.from(wb, 'utf8'));
  }
  return zip.toBuffer();
}

export function colLetter(zeroBased) {
  let n = zeroBased;
  let s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
