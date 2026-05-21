import {createClient} from '@supabase/supabase-js';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');
const KEY = process.env.SUPABASESERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

console.log('Key prefix:', KEY.slice(0, 12));

const c = createClient('https://btyyyayavdvvgdelvrhx.supabase.co', KEY, {auth:{persistSession:false}});

(async()=>{
  // Test what supabase-js returns for a check against a non-existent table
  const {error, data, count} = await c.from('users').select('*', {count:'exact', head:true});
  console.log('JS client direct -> error:', JSON.stringify(error), '| count:', count, '| data type:', typeof data);

  // Exact behavior check on a table we know might NOT exist
  const {error:e2} = await c.from('__nonexistent_test__').select('*');
  console.log('JS nonexistent table -> error.message:', e2?.message, '| code:', e2?.code, '| status:', e2?.status);

  // What does postgrest return for a select on an empty-known table
  const res = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/users?select=count', {
    headers:{'apikey':KEY,'Authorization':'Bearer '+KEY,'Prefer':'count=exact'}
  });
  console.log('fetch /users?select=count ->', res.status, (await res.text()).slice(0,300));
})();
