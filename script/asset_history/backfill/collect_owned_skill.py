"""Bounded league SKILL backfill: league totals then missing-owned supplements.

Cache/provenance are confined to an explicit isolated skill directory. The
public league table may be capped at500; that is not called complete. Missing
owned performance stays flagged, never fabricated as zero. Current NBA GP come
from the already dated NBA inputs because current PBP responses omit GP.
"""
from __future__ import annotations
import argparse,concurrent.futures,hashlib,json,pathlib,sys,time,threading,urllib.parse,urllib.request
from expand_league_skill import COUNTS,TEAMS,write
TEAM_ABBRS=['ATL','BOS','CLE','NOP','CHI','DAL','DEN','GSW','HOU','LAC','LAL','MIA','MIL','MIN','BKN','NYK','ORL','IND','PHI','PHX','POR','SAC','SAS','OKC','TOR','UTA','MEM','WAS','DET','CHA']
TM=dict(zip(TEAM_ABBRS,TEAMS))

def main():
 p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--rosters',type=pathlib.Path,required=True);p.add_argument('--max-new-requests',type=int,default=80);p.add_argument('--workers',type=int,default=3);p.add_argument('--rebuild',action='store_true');p.add_argument('--only-dates',nargs='*');a=p.parse_args()
 root=a.skill_dir.resolve();assert 'league_backfill' in str(root),'An isolated workspace is required';sys.path.insert(0,str(root));import fetch_monthly_skill as model
 raw=root/'raw';match=root/'matchups';cutoffs=model.month_cutoffs();dates=sorted(set(model.source_date(d)for d in cutoffs));rosters=json.loads(a.rosters.read_text());bydate={r['cutoff_date']:r['roster'] for r in rosters};owned={d:set()for d in dates}
 for d in cutoffs:
  for r in bydate.get(d,[]):
   if r.get('nba_id')is not None:owned[model.source_date(d)].add(int(r['nba_id']))
 starts={}
 for season in range(2022,2028):
  f=match/(f'league_games_{season}-04-30.json' if season<=2026 else 'league_games_2026-10-25.json')
  rs=json.loads(f.read_text())['resultSets'][0];i=rs['headers'].index('GAME_DATE');starts[season]=min(r[i][:10]for r in rs['rowSet'])
 request_count=0;failure_count=0;audits=[];jobs=[];lock=threading.Lock()
 def query(d,t=None):
  nonlocal request_count,failure_count
  label=f'league_pbp_{d}'if t is None else f'pbp_team_{t}_{d}'
  cache=(raw if t is None else match)/(label+'.json')
  if cache.exists():return json.loads(cache.read_text()).get('multi_row_table_data',[]),str(cache),None
  if a.only_dates and d not in a.only_dates:return None,None,'Outside bounded date selection'
  with lock:
   if request_count>=a.max_new_requests or failure_count>=8:return None,None,'Request budget/circuit breaker'
   request_count+=1
  y=int(d[:4])+(int(d[5:7])>=10)
  params={'Season':f'{y-1}-{str(y)[-2:]}','SeasonType':'Regular Season','Type':'Player','FromDate':starts[y],'ToDate':d}
  if t:params['TeamId']=t
  url='https://api.pbpstats.com/get-totals/nba?'+urllib.parse.urlencode(params)
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'})
   with urllib.request.urlopen(req,timeout=90)as r:body=r.read()
   obj=json.loads(body);rows=obj['multi_row_table_data'];assert rows,'Empty source table'
   write(cache,obj);write(cache.with_suffix('.source.json'),{'url':url,'retrieved_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sha256':hashlib.sha256(body).hexdigest(),'leverage_filter':'Default All','season_start_equivalence':'Cached official NBA regular-season game log establishes no earlier regular-season games'})
   return rows,url,None
  except Exception as e:
   with lock:failure_count+=1
   return None,url,type(e).__name__+': '+str(e)[:150]
 with concurrent.futures.ThreadPoolExecutor(max_workers=min(3,a.workers))as ex:
  for d,result in zip(dates,ex.map(query,dates)):
   rows,url,error=result;audits.append({'date':d,'kind':'league','players':len(rows or []),'source':url,'error':error});print('league',d,len(rows or []),error,flush=True)
 # Missing owned players have their current team requested; existing cached team
 # tables for any other team are also merged. A player with a closed prior-team
 # stint keeps a missing-evidence flag if aggregate totals do not match dated NBA.
 def aggregate(d):
  lp=raw/f'league_pbp_{d}.json';league=json.loads(lp.read_text()).get('multi_row_table_data',[])if lp.exists()else []
  nba=json.loads((raw/f'nba_assignment_inputs_{d}.json').read_text())['players'];ref={int(r['nba_id']):r for r in nba};merged={}
  for t in TEAMS:
   f=match/f'pbp_team_{t}_{d}.json'
   if not f.exists():continue
   for z in json.loads(f.read_text()).get('multi_row_table_data',[]):
    pid=int(z['EntityId']);o=merged.setdefault(pid,{'EntityId':str(pid),'Name':z['Name'],'TeamId':0,'TeamAbbreviation':'TOT','RowId':str(pid),'_teams':[],'_rates':[],'_off_fg_rebounds':0.,'_off_fg_rebound_opportunities':0.})
    o['_teams'].append(t);o['_rates'].append(z.get('OffFGReboundPct'))
    for k in COUNTS:o[k]=o.get(k,0)+float(z.get(k)or 0)
    n=float(z.get('OffTwoPtRebounds')or 0)+float(z.get('OffThreePtRebounds')or 0);pct=z.get('OffFGReboundPct')
    if n and pct and pct>0:o['_off_fg_rebounds']+=n;o['_off_fg_rebound_opportunities']+=n/pct
    else:o.setdefault('_zero_rebound_components',[]).append(t)
  exact=set()
  for z in league:
   pid=int(z['EntityId']);o=merged.setdefault(pid,{'EntityId':str(pid),'Name':z['Name'],'TeamId':0,'TeamAbbreviation':'TOT','RowId':str(pid),'_teams':[],'_rates':[]})
   for k in COUNTS:o[k]=float(z.get(k)or 0)
   o['OffFGReboundPct']=z.get('OffFGReboundPct')
   for meta in ['_reconstructed_by','_OREB_reconstruction_flag','_NBA_reference_disagreement','_unused_negative_counts']:
    if meta in z:o[meta]=z[meta]
   exact.add(pid)
  dropped=[]
  for pid,o in list(merged.items()):
   r=ref.get(pid)
   if r is None:dropped.append({'nba_id':pid,'reason':'No dated NBA GP reference'});del merged[pid];continue
   if pid not in exact:
    # Avoid accepting only a traded player's current team as whole-NBA evidence.
    exact_minutes=o.get('SecondsPlayed',0)/60 if o.get('SecondsPlayed',0)>0 else o['Minutes']
    if abs(exact_minutes-float(r['minutes']))>max(.2,float(r['minutes'])*.001):
     dropped.append({'nba_id':pid,'reason':'PBP team segments do not cover whole-NBA minutes','PBP_minutes':exact_minutes,'NBA_minutes':r['minutes']});del merged[pid];continue
    if len(o['_teams'])==1:o['OffFGReboundPct']=o['_rates'][0]
    elif not o['_off_fg_rebounds']:o['OffFGReboundPct']=0.
    elif o.get('_zero_rebound_components'):o['OffFGReboundPct']=None
    else:o['OffFGReboundPct']=o['_off_fg_rebounds']/o['_off_fg_rebound_opportunities']
   o['GamesPlayed']=r['games'];o['_games_source']='Dated NBA league player totals'
  return merged,ref,dropped
 for d in dates:
  merged,ref,dropped=aggregate(d)
  needed=owned[d]&set(ref)-set(merged)
  jobs.extend((d,t)for t in sorted({TM[ref[i]['team']]for i in needed if ref[i]['team']in TM}))
 with concurrent.futures.ThreadPoolExecutor(max_workers=min(3,a.workers))as ex:
  for job,result in zip(jobs,ex.map(lambda x:query(*x),jobs)):
   rows,url,error=result;audits.append({'date':job[0],'kind':'team','team_id':job[1],'players':len(rows or []),'source':url,'error':error});
   if url:print('supplement',*job,len(rows or []),error,flush=True)
 coverage=[]
 for d in dates:
  merged,ref,dropped=aggregate(d);missing=sorted(owned[d]&set(ref)-set(merged));allmissing=sorted(set(ref)-set(merged))
  c={'date':d,'observed_players':len(merged),'owned_with_official_games':len(owned[d]&set(ref)),'owned_missing_current_SKILL_evidence':[ref[i]for i in missing],'owned_evidence_complete':not missing,'official_players_missing_evidence':[ref[i]for i in allmissing],'excluded_partial_stints':dropped}
  coverage.append(c);write(match/f'league_owned_pbp_{d}.json',{'cutoff':d,'players':list(merged.values()),'coverage':c,'source':'PBPStats exact league rows supplemented by whole-NBA-validated team segments; GP from dated NBA totals'})
 write(root/'owned_league_source_audit.json',{'new_requests':request_count,'failed_requests':failure_count,'audit':audits,'coverage':coverage})
 print('DONE',json.dumps({'dates':len(dates),'owned_complete_dates':sum(c['owned_evidence_complete']for c in coverage),'new_requests':request_count,'failed_requests':failure_count}),flush=True)
 if a.rebuild:
  import subprocess
  here=pathlib.Path(__file__).resolve().parent
  subprocess.run([sys.executable,str(here/'rebuild_owned_skill.py'),'--skill-dir',str(root)],check=True)
  for script in ['score_switch_sample.py','blend_monthly_skill.py','summarize_coverage.py']:subprocess.run([sys.executable,str(root/script)],check=True)
  subprocess.run([sys.executable,str(here/'audit_owned_skill.py'),'--skill-dir',str(root),'--rosters',str(a.rosters)],check=True)
if __name__=='__main__':main()
