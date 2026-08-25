import {createClient} from '@supabase/supabase-js';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');
const c = createClient(process.env.SUBIASERVICE_ROLE_KEY||'', {auth:{persistSession:false}});
console.log('Client init OK, key prefix:', (process.env.SUPABASESERVICE_ROLE_KEY||'').slice(0,10));
(async()=>{
  // Test tableExists behavior: POST a sample DML query
  const {error, data, count, status} = await c.from('users').select('*', {count:'exact', head:true});
  console.log('tableExists snapshot -> error:', JSON.stringify(error), '| count:', count, '| status:', status);

  // Probe the same customer through fetch directly
  const res = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/users?select=count', {
    headers:{'apikey':process.env.SUBIASERVICE_ROLE_KEY||process.env.SUBIABASE_KEY,'Authorization':'Bearer '+(process.env.SUBIASERVICE_ROLE_KEY||process.env.SUBIABASE_KEY),'Prefer':'count=exact'}
  });
  console.log('fetch raw status:', res.status, 'body:', (await res.text()).slice(0,300));
  
  // Check multiple tables
  for(const t of ['users','sessions','assignments','modules']){
    const r2 = await c.from(t).select('id').in('__fake__',['no']).catch(e=>({error:e})); // note supabase-js swears
    console.log(t, '=> error:', r2?.error ? r2.error.message : 'none', '| data:', r2?.data);
  }
})();
