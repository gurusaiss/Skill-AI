import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'crypto';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');
const secret = process.env.SUPABASESERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const c = createClient(process.env.SUPABASE_URL, secret, {auth:{persistSession:false}});

(async()=>{
  // force PostgREST schema refresh
  const {error} = await c.from('users').select('*').in('user_id',['__nonexistent__']);
  console.log('SELECT users (nonexistent filter):', error ? 'err: '+error.message+' code:'+error.code : 'found some rows');

  // Direct raw PATCH
  const body = JSON.stringify([{
    user_id:'usr_admin_001', email:'admin@skillforge.ai', name:'System Admin',
    role:'admin', learning_uuid:randomUUID(), password_hash:'x', email_verified:true,
    created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
  }]);
  const res = await fetch('https://btyyyayavdvvgdelvrhx.supabase.co/rest/v1/users', {
    method:'PATCH',
    headers:{
      'Authorization':'Bearer '+secret,
      'apikey': process.env.SUPABASE_ANON_KEY||secret,
      'Content-Type':'application/json',
      'Prefer':'resolution=merge-duplicates,return=representation',
    },
    body,
  });
  console.log('PATCH status:', res.status, res.statusText);
  const ct = res.headers.get('content-type') || '';
  const rbody = ct.includes('json') ? JSON.parse(await res.text()) : await res.text();
  console.log(JSON.stringify(rbody, null, 2).slice(0,500));
})();
