// Fails (exit 1) if any client source file introduces a horizontal scrollbar.
// Intentional exceptions must have the text `scroll-ok: <reason>` on the same line or the previous line.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PATTERN = /overflow-x-auto|overflow-x-scroll|overflow-x\s*:\s*(auto|scroll)/;
const EXT = /\.(jsx|js|css)$/;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(name)) scan(p);
  }
}

function scan(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    if (line.includes('scroll-ok:') || (i > 0 && lines[i - 1].includes('scroll-ok:'))) return;
    hits.push(`${relative(join(root, '..'), file).split('\\').join('/')}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}

walk(root);
if (hits.length) {
  console.error('Horizontal scroll is not allowed. Shrink, wrap, truncate, hide columns or stack instead.');
  console.error('If it is truly unavoidable add a "scroll-ok: <reason>" comment on the line or the line above.\n');
  hits.forEach((h) => console.error('  ' + h));
  process.exit(1);
}
console.log('check-no-scroll: OK (no horizontal scroll producers found)');
