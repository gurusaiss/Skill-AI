import {createClient} from '@supabase/supabase-js';
import {loadEnv} from '../config/loadEnv.js';
loadEnv('C:\\CODING\\HACKAP');

const c = createClient('https://btyyyayavdvvgdelvrhx.supabase.co', process.env.SUPABASESERVICE_ROLE_KEY, {auth:{persistSession:false}});

async function tableExists(table) {
  const { count } = await c.from(table).select('*', { count: 'exact', head: true });
  console.log(table, ' count=', count, '->', count !== null && count !== undefined ? 'EXISTS' : 'MISSING');
  return count !== null && count !== undefined;
}

(async()=>{
  const tables = ['users','sessions','assignments','modules','packages','skill_packages','learning_tracks','assessments','audit_logs','groups','__fake_nonexistent_xyz'];
  for (const t of tables) {
    await tableExists(t);
    await new Promise(r => setTimeout(r, 100)); // rate-limit
  }
})();
