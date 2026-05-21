import {createClient} from '@supabase/supabase-js';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');

const c = createClient('https://btyyyayavdvvgdelvrhx.supabase.co', process.env.SUPABASESERVICE_ROLE_KEY, {auth:{persistSession:false}});
(async () => {
  // Probe: what does PostgREST return for a table that doesn't exist yet?
  const r1 = await c.from('users').select('*', {count:'exact', head:true});
  console.log('Probe users:', JSON.stringify({
    errCode: r1.error?.code,
    errMsg:  r1.error?.message,
    status:  r1.error?.status,
    metaCount: r1.data?.meta?.count,
    rawData: r1.data,
  }, null, 2));

  // Also probe a known-missing table name pattern
  const r2 = await c.from('nonexistent').select('*');
  console.log('Probe nonexistent:', {
    errCode: r2.error?.code,
    errMsg:  r2.error?.message,
  });
})();
