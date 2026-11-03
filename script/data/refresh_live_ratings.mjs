import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPageData } from './read_svelte_data.mjs';
import { validateRatingSourceDates } from './live_rating_dates.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function page(url) {
  for (let i=0;i<3;i++) {
    try { const r=await fetch(url,{signal:AbortSignal.timeout(30000)}); if(!r.ok)throw Error(`HTTP ${r.status}`);return readPageData(await r.text()); }
    catch(e) {if(i===2)throw e;}
  }
}
const epmUrl='https://dunksandthrees.com/epm';
const darkoUrl='https://www.darko.app/';
const [e,d]=await Promise.all([page(epmUrl).then(a=>a.find(x=>Array.isArray(x.stats))),page(darkoUrl).then(a=>a.find(x=>x.players?.keys))]);
if(!e||!d)throw Error('Source schema changed');
validateRatingSourceDates(e.date,d.ratingsThrough,today);
const season=Number(today.slice(0,4))+(Number(today.slice(5,7))>=7?1:0);
if(e.season!==season||e.stats.some(x=>x.season!==season||x.game_dt!==e.date))throw Error('Expected EPM season/date mismatch');
const darko=d.players.values[0].map((_,i)=>Object.fromEntries(d.players.keys.map((k,j)=>[k,d.players.values[j][i]])));
if(darko.some(x=>x.season!==season))throw Error('DARKO season mismatch');
if(e.stats.length<400||darko.length<400)throw Error('Incomplete ratings download; login or source repair may be needed');
const byId=new Map(darko.map(x=>[x.nba_id,x]));
const rows=e.stats.filter(x=>byId.has(x.player_id)).map(x=>{
 const y=byId.get(x.player_id);
 return {nba_id:x.player_id,player_name:x.player_name,team:x.team_alias,o_epm:x.off,d_epm:x.def,o_dpm:y.o_dpm,d_dpm:y.d_dpm,epm_mpg:x.p_mp_48,darko_mpg:y.x_minutes};
});
if(new Set(rows.map(x=>x.nba_id)).size!==rows.length||rows.length<400)throw Error('Invalid identity coverage');
if(rows.some(x=>['o_epm','d_epm','o_dpm','d_dpm'].some(k=>!Number.isFinite(x[k])||Math.abs(x[k])>20)))throw Error('Invalid ratings values');
const output={schema_version:1,season,generated_at:new Date().toISOString(),epm_type:'expected',epm_as_of:e.date,darko_through:d.ratingsThrough,epm_url:epmUrl,darko_url:darkoUrl,players:rows};
const dest=path.join(root,'raw/live/ratings.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest+'.tmp',JSON.stringify(output)+'\n');fs.renameSync(dest+'.tmp',dest);
console.log(`Expected EPM ${e.date}, DARKO through ${d.ratingsThrough}: ${rows.length} matched players`);

