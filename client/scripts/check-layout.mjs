// Fails (exit 1) when a page leaves empty bands left/right or uses unreadably small text.
//   1. Page width caps: max-w-7xl / 6xl / 5xl / screen-xl / screen-2xl (and `container`)
//      in src/pages/** (modals use smaller max-w sizes, which are allowed).
//   2. Tiny arbitrary text: text-[8px] .. text-[12px] anywhere in src/pages and src/components.
// Intentional exceptions carry `layout-ok: <reason>` on the same line or the line above.
// Pass file paths as arguments to check only those files: node scripts/check-layout.mjs src/pages/Foo.jsx
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const CAP = /\bmax-w-(7xl|6xl|5xl|screen-xl|screen-2xl)\b|\bcontainer\b(?=[\s"'`])/;
const TINY = /\btext-\[(8|9|10|11|12)px\]/;
const EXT = /\.jsx$/;
const hits = [];

function walk(dir, fn) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, fn);
    else if (EXT.test(name)) fn(p);
  }
}

function scan(file) {
  const rel = relative(join(srcRoot, '..'), file).split('\\').join('/');
  const inPages = rel.startsWith('src/pages/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const ok = line.includes('layout-ok:') || (i > 0 && lines[i - 1].includes('layout-ok:'));
    if (ok) return;
    if (inPages && CAP.test(line)) hits.push(`${rel}:${i + 1}: page width cap -> ${line.trim().slice(0, 120)}`);
    if (TINY.test(line)) hits.push(`${rel}:${i + 1}: tiny text -> ${line.trim().slice(0, 120)}`);
  });
}

const args = process.argv.slice(2);
if (args.length) {
  args.forEach((a) => scan(resolve(a)));
} else {
  walk(join(srcRoot, 'pages'), scan);
  walk(join(srcRoot, 'components'), scan);
}

if (hits.length) {
  console.error('Layout rules: pages must fill the width (use PageContainer) and text must be readable.');
  console.error('Use text-xs / text-sm / text-base, and no max-w-7xl/6xl/5xl caps on pages. Exceptions need "layout-ok: <reason>".\n');
  hits.forEach((h) => console.error('  ' + h));
  console.error(`\n${hits.length} problem(s).`);
  process.exit(1);
}
console.log('check-layout: OK');
