import { createReadStream, statSync } from 'fs';
import { basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv } from '../config/loadEnv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv(join(__dirname, '..', '..'));

const KEY   = process.env.SUPABASESERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const URL   = process.env.SUPABASE_URL;
const REF   = URL.split('/').pop();
const FILE  = join(__dirname, '..', '..', 'supabase_schema.sql');
const SIZE  = statSync(FILE).size;

console.log(`Project : ${REF}`);
console.log(`Key     : ${KEY.slice(0, 10)}…`);
console.log(`Schema  : ${FILE}  (${SIZE.toLocaleString()} bytes)`);

const endpoint = `https://api.supabase.com/v1/projects/${REF}/database/migration`;

// Build a raw multipart body (no FormData dependency)
const boundary = `----sf${Date.now()}`;
const filename = basename(FILE);
const headers = {
  'Authorization': `Bearer ${KEY}`,
  'Content-Type':  `multipart/form-data; boundary=${boundary}`,
};

let raw = '';
const CR = '\r\n';
const fileRaw = createReadStream(FILE).read();
const fileB64 = Buffer.from(fileRaw).toString('base64');   // ← base64 inline avoids line-break issues

// Supabase migration endpoint accepts base64-encoded SQL file content
const bodyObj = {
  name:         `apply-schema-${Date.now()}`,
  is_system_managed: false,
  migration_sql: fileB64,
};
const bodyJson = JSON.stringify(bodyObj);

try {
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    bodyJson,
  });
  console.log(`HTTP ${res.status} ${res.statusText}`);
  const ct = res.headers.get('content-type') || '';
  console.log(ct.includes('json') ? JSON.stringify(await res.json(), null, 2).slice(0, 2000) : await res.text());
} catch (err) {
  console.error('Fetch error:', err.message);
}
