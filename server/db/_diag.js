// diagnose.js — check Postgres cache + raw info_schema scan
import {createClient} from '@supabase/supabase-js';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');
const secret = process.env.SUPABASESERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const URL = process.env.SUPABASE_URL || '';
console.log('Secret prefix:', secret.slice(0, 12));
console.log('URL:', URL);
(async () => {
  // 1. Any table that already existed here would survive schema drops via IF NOT EXISTS
  const c = createClient(URL, secret, {auth:{persistSession:false}});
  for (const t of ['users','sessions','assignments','modules','packages','skill_packages','learning_tracks','assessments','audit_logs','groups']) {
    const {error} = await c.from(t).select('*').in('id',['__probe_missing__']);
    console.log(t, error ? `PGRST205=${error.code}` : 'present');
  }

  // 2. Also check using pg_catalog directly
  const res = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/', {
    headers: { 'apikey': secret, 'Authorization': 'Bearer ' + secret }
  });
  console.log('GET / =>', res.status, (await res.text()).slice(0,200));

  // 3. Check column names of any table reference (uses public.table_name OID lookup)
  try {
    const res3 = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/rpc/users_info', {
      method: 'GET',
      headers: { 'apikey': secret, 'Authorization': 'Bearer ' + secret }
    });
    console.log('rpc users_info =>', res3.status, (await res.text()).slice(0,300));
  } catch(e) { console.warn('rpc failed:', e.message); }

  // 4. Direct PostgREST count with raw path format to avoid cache mis-match
  const res4 = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/users?select=count', {
    headers: { 'apikey': secret, 'Authorization': 'Bearer ' + secret, 'Prefer': 'count=exact' }
  });
  console.log('Prefer:count=exact =>', res4.status, (await res.text()).slice(0,200));
})();
