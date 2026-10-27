"""Bounded same-source recovery for the remaining historical winter cutoffs.

Run after collect_owned_skill.py. This downloads source responses only, then
uses independently validated subtraction. It does not alter the original Utah
cache and never subtracts rounded Databallr rates from PBP event counters.
"""
import argparse,concurrent.futures,hashlib,json,pathlib,sys,threading,time,urllib.parse,urllib.request
from expand_league_skill import write
from subtract_pbp_periods import reconstruct

# Deliberately bounded research plan:4 full-season sources,13 tails,3 direct
# smaller early-season tables. Existing source files do not trigger a request.
RECOVER=[('2022-03-31','2022-04-01'),('2023-01-31','2023-02-01'),('2023-02-28','2023-03-01'),('2023-03-31','2023-04-01'),('2024-02-29','2024-03-01'),('2024-03-31','2024-04-01'),('2024-12-31','2025-01-01'),('2025-01-31','2025-02-01'),('2025-02-28','2025-03-01'),('2025-03-31','2025-04-01'),('2025-12-31','2026-01-01'),('2026-01-31','2026-02-01'),('2026-02-28','2026-03-01'),('2026-03-31','2026-04-01')]
DIRECT=['2024-10-31','2024-11-30','2025-11-30']

def main():
 p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--max-new-requests',type=int,default=20);p.add_argument('--workers',type=int,default=3);a=p.parse_args();root=a.skill_dir.resolve();assert 'league_backfill' in str(root);raw=root/'raw';match=root/'matchups';audit=[];count=0;failures=0;lock=threading.Lock()
 def fetch(item):
  nonlocal count,failures
  label,params,kind=item;dest=raw/(label+'.json')
  if dest.exists():return {'label':label,'kind':kind,'status':'cached','rows':len(json.loads(dest.read_text())['multi_row_table_data'])}
  with lock:
   if count>=a.max_new_requests:return {'label':label,'kind':kind,'status':'not_requested_budget'}
   # Smaller direct lookups remain allowed after a bulk-family failure.
   if failures>=8 and kind!='direct':return {'label':label,'kind':kind,'status':'not_requested_circuit'}
   count+=1
  url='https://api.pbpstats.com/get-totals/nba?'+urllib.parse.urlencode(params);start=time.time()
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'})
   with urllib.request.urlopen(req,timeout=90)as response:body=response.read()
   obj=json.loads(body);rows=obj['multi_row_table_data'];assert rows,'Empty source table'
   write(dest,obj);write(dest.with_suffix('.source.json'),{'url':url,'retrieved_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sha256':hashlib.sha256(body).hexdigest(),'source_kind':kind})
   return {'label':label,'kind':kind,'status':'available','rows':len(rows),'elapsed_seconds':time.time()-start,'url':url}
  except Exception as e:
   with lock:failures+=1
   time.sleep(2)
   return {'label':label,'kind':kind,'status':'unavailable','error':type(e).__name__+': '+str(e)[:180],'elapsed_seconds':time.time()-start,'url':url}
 def run(jobs):
  with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(3,a.workers)))as ex:
   for result in ex.map(fetch,jobs):
    audit.append(result);write(root/'pbp_recovery_progress.json',{'new_requests':count,'failed_requests':failures,'audit':audit});print(result['label'],result['status'],result.get('rows'),result.get('error'),flush=True)
 def params(y):return {'Season':f'{y-1}-{str(y)[-2:]}','SeasonType':'Regular Season','Type':'Player'}
 fulljobs=[(f'full_season_pbp_{y}',params(y),'full_season')for y in [2022,2023,2024,2025,2026]]
 directjobs=[]
 for d in DIRECT:
  y=int(d[:4])+1;f=match/f'league_games_{y}-04-30.json';rs=json.loads(f.read_text())['resultSets'][0];i=rs['headers'].index('GAME_DATE');start=min(r[i][:10]for r in rs['rowSet']);directjobs.append((f'league_pbp_{d}',dict(params(y),FromDate=start,ToDate=d),'direct'))
 run(fulljobs+directjobs)
 tails=[]
 for d,t in RECOVER:
  y=int(d[:4])+(int(d[5:7])>=10)
  if not (raw/f'full_season_pbp_{y}.json').exists():continue
  tails.append((f'tail_pbp_{t}',dict(params(y),FromDate=t),'tail'))
 run(tails)
 recovery=[]
 for d,t in RECOVER:
  y=int(d[:4])+(int(d[5:7])>=10);fullfile=raw/f'full_season_pbp_{y}.json';tailfile=raw/f'tail_pbp_{t}.json';dest=raw/f'league_pbp_{d}.json'
  if dest.exists() and not json.loads(dest.read_text()).get('source_method'):recovery.append({'cutoff':d,'status':'existing_direct_source'});continue
  if not fullfile.exists()or not tailfile.exists():recovery.append({'cutoff':d,'status':'missing_source'});continue
  full=json.loads(fullfile.read_text())['multi_row_table_data'];tail=json.loads(tailfile.read_text())['multi_row_table_data'];nba=json.loads((raw/f'nba_assignment_inputs_{d}.json').read_text())['players'];completed=json.loads((raw/f'nba_assignment_inputs_{y}-04-30.json').read_text())['players'];envelope=json.loads((root/'direct_source_tolerance.json').read_text()) if (root/'direct_source_tolerance.json').exists() else {'point_tolerance':0.,'minute_tolerance':.2}
  rows,rejected=reconstruct(full,tail,nba,completed,{'point_tolerance':envelope['point_tolerance'],'minute_tolerance':envelope['minute_tolerance']})
  meta={'cutoff':d,'source_cutoff':d,'tail_start':t,'accepted_players':len(rows),'rejected_players':rejected,'unknown_oreb_denominator_players':[r['EntityId']for r in rows if r['_OREB_reconstruction_flag']],'accepted_source_discrepancies':[dict(nba_id=int(r['EntityId']),name=r['Name'],**r['_NBA_reference_disagreement']) for r in rows if r.get('_NBA_reference_disagreement')], 'empirical_direct_source_envelope':{'points':envelope['point_tolerance'],'minutes':envelope['minute_tolerance']},'method':'Same-source exact additive-count subtraction, NBA sanity checks bounded by empirically observed direct-source disagreement; original PBP counters unchanged; missing OREB denominator retains component prior'}
  write(root/f'pbp_subtraction_audit_{d}.json',meta);write(dest,{'multi_row_table_data':rows,'source_method':meta['method']});write(dest.with_suffix('.source.json'),{'source_cutoff':d,'tail_start':t,'inputs':[str(fullfile),str(tailfile)],'method':meta['method'],'validation_reference':'December2022 verified461 overlapping players with zero additive-count and zero recoverable OREB-rate differences'})
  recovery.append({'cutoff':d,'status':'recovered','players':len(rows),'rejected':len(rejected),'unknown_oreb_denominators':len(meta['unknown_oreb_denominator_players'])})
 write(root/'pbp_recovery_audit.json',{'new_requests':count,'failed_requests':failures,'sources':audit,'recovery':recovery});print('RECOVERY',json.dumps(recovery),flush=True)
if __name__=='__main__':main()
