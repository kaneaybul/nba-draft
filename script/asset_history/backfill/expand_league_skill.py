"""Expand cached monthly SKILL to the NBA using cutoff PBP team tables.

Usage: python expand_league_skill.py --skill-dir ISOLATED_SKILL_COPY
All writes are confined to the explicit isolated copy. NBA cutoff tracking,
assignments and source regression models must already be present there.
"""
from __future__ import annotations
import argparse,concurrent.futures,hashlib,json,pathlib,sys,time,urllib.parse,urllib.request

COUNTS=['SecondsPlayed','Minutes','GamesPlayed','OffPoss','DefPoss','Points','FtPoints','FTA','FG2A','FG2M','FG3A','FG3M','Arc3FGA','Arc3FGM','Corner3FGA','Corner3FGM','NonHeaveArc3FGA','NonHeaveArc3FGM','ShortMidRangeFGA','ShortMidRangeFGM','LongMidRangeFGA','LongMidRangeFGM','AtRimFGA','AtRimFGM','Assists','Turnovers','Steals','Offensive Fouls Drawn','Charge Fouls Drawn','DefRebounds','OffRebounds','OffTwoPtRebounds','OffThreePtRebounds','Blocks']
TEAMS=list(map(str,range(1610612737,1610612767)))

def write(path,x):
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(x,separators=(',',':'),allow_nan=False));tmp.replace(path)

def main():
 p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--workers',type=int,default=1);p.add_argument('--all-dates',action='store_true');p.add_argument('--only-dates',nargs='*');p.add_argument('--rebuild',action='store_true');p.add_argument('--offline',action='store_true');a=p.parse_args()
 root=a.skill_dir.resolve();raw=root/'raw';match=root/'matchups';sys.path.insert(0,str(root));import fetch_monthly_skill as model
 assert root!=pathlib.Path(model.__file__).resolve().parent or 'league_backfill' in str(root),'Refusing canonical source writes'
 dates=a.only_dates or (list(dict.fromkeys(model.source_date(d) for d in model.month_cutoffs())) if a.all_dates else ['2022-01-31'])
 jobs=[]
 for d in dates:
  if d=='2021-12-31' and (match/f'full_league_pbp_{d}.json').exists():continue
  # Full NBA dates can contain more than 500 players; team requests protect all
  # low-minute rows and combine whole-NBA samples for traded players.
  jobs.extend((d,t)for t in TEAMS)
 def fetch(job):
  d,t=job;y=int(d[:4])+(int(d[5:7])>=10)
  params={'Season':f'{y-1}-{str(y)[-2:]}','SeasonType':'Regular Season','Type':'Player','FromDate':f'{y-1}-10-01','ToDate':d,'TeamId':t,'Leverage':'All'}
  url='https://api.pbpstats.com/get-totals/nba?'+urllib.parse.urlencode(params);path=match/f'pbp_team_{t}_{d}.json'
  if path.exists():return d,t,json.loads(path.read_text()).get('multi_row_table_data',[]),url,None
  if a.offline:return d,t,None,url,'Not cached (offline)'
  error=None
  for attempt in range(2):
   try:
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'})
    with urllib.request.urlopen(req,timeout=40)as r:body=r.read()
    data=json.loads(body);rows=data['multi_row_table_data'];assert rows,'Empty team response'
    write(path,data);write(path.with_suffix('.source.json'),{'url':url,'retrieved_at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'sha256':hashlib.sha256(body).hexdigest()})
    return d,t,rows,url,None
   except Exception as e:
    error=type(e).__name__+': '+str(e)[:180]
    if attempt==0:time.sleep(3)
  return d,t,None,url,error
 results={d:{}for d in dates};done=0;start=time.time()
 failure_count=0;aborted=False
 with concurrent.futures.ThreadPoolExecutor(max_workers=min(6,max(1,a.workers)))as ex:
  # Submit only a bounded wave, with a circuit breaker between waves.
  def completed():
   nonlocal aborted,failure_count
   size=min(6,max(1,a.workers))
   for i in range(0,len(jobs),size):
    wave=list(ex.map(fetch,jobs[i:i+size]))
    for r in wave:
     if r[-1]:failure_count+=1
     yield r
    if failure_count>=3:
     aborted=True;print('CIRCUIT_BREAKER: three source failures; stopping pending requests',flush=True);return
  for d,t,rows,url,error in completed():
   done+=1;results[d][t]={'rows':rows,'url':url,'error':error}
   if done%15==0 or error:
    print('fetched',done,'/',len(jobs),'elapsed',round(time.time()-start),'latest',d,t,'error',error,flush=True)
    write(root/'league_fetch_progress.json',{'done':done,'jobs':len(jobs),'elapsed_seconds':time.time()-start,'failed':[{'date':dd,'team':tt,'error':r['error']}for dd,rr in results.items()for tt,r in rr.items()if r['error']]})
 coverage=[]
 for d in dates:
  full=match/f'full_league_pbp_{d}.json'
  if d=='2021-12-31' and full.exists():
   x=json.loads(full.read_text());coverage.append({'date':d,'complete':x['complete_team_query_coverage'],'players':len(x['players']),'reused':True});continue
  merged={};audit=[]
  for t,r in results[d].items():
   rows=r['rows'];audit.append({'team_id':t,'rows':len(rows)if rows else 0,'url':r['url'],'status':'available'if rows is not None else 'unavailable','error':r['error']})
   for z in rows or []:
    pid=int(z['EntityId']);o=merged.setdefault(pid,{'EntityId':str(pid),'Name':z['Name'],'TeamId':0,'TeamAbbreviation':'TOT','RowId':str(pid),'_teams':[],'_rates':[],'_off_fg_rebounds':0.,'_off_fg_rebound_opportunities':0.})
    o['_teams'].append(t);o['_rates'].append(z.get('OffFGReboundPct'))
    for k in COUNTS:o[k]=o.get(k,0)+float(z.get(k)or 0)
    n=float(z.get('OffTwoPtRebounds')or 0)+float(z.get('OffThreePtRebounds')or 0);pct=z.get('OffFGReboundPct')
    if n and pct and pct>0:o['_off_fg_rebounds']+=n;o['_off_fg_rebound_opportunities']+=n/pct
    else:o.setdefault('_zero_rebound_components',[]).append(t)
  # Exact league rows, where cached, retain exact rebound opportunity rates.
  lp=raw/f'league_pbp_{d}.json';league=json.loads(lp.read_text()).get('multi_row_table_data',[])if lp.exists()else []
  rates={int(z['EntityId']):z.get('OffFGReboundPct')for z in league}
  # Exact league rows include whole-NBA totals even if one component team
  # request failed. Team-only rows supplement players beyond the 500-row cap.
  for z in league:
   pid=int(z['EntityId']);o=merged.setdefault(pid,{'EntityId':str(pid),'Name':z['Name'],'TeamId':0,'TeamAbbreviation':'TOT','RowId':str(pid),'_teams':[],'_rates':[]})
   for k in COUNTS:o[k]=float(z.get(k)or 0)
  for o in merged.values():
   pid=int(o['EntityId'])
   if pid in rates:o['OffFGReboundPct']=rates[pid]
   elif len(o['_teams'])==1:o['OffFGReboundPct']=o['_rates'][0]
   elif o['_off_fg_rebounds']==0:o['OffFGReboundPct']=0.
   elif o.get('_zero_rebound_components'):o['OffFGReboundPct']=None
   else:o['OffFGReboundPct']=o['_off_fg_rebounds']/o['_off_fg_rebound_opportunities']if o['_off_fg_rebound_opportunities']else None
  gp_path=raw/f'nba_assignment_inputs_{d}.json'
  nba_players=json.loads(gp_path.read_text())['players']
  gp={int(z['nba_id']):z['games'] for z in nba_players}
  missing_gp=[]
  for pid,o in merged.items():
   if pid not in gp:missing_gp.append(pid)
   else:o['GamesPlayed']=gp[pid]
  complete=not missing_gp and len(audit)==30 and all(r['status']=='available'for r in audit)
  write(full,{'cutoff':d,'source':'PBPStats complete thirty-team cutoff aggregation','complete_team_query_coverage':complete,'players':list(merged.values()),'team_audit':audit})
  coverage.append({'date':d,'complete':complete,'players':len(merged),'failed_teams':[r for r in audit if r['error']],'missing_official_games_played':missing_gp,'unqueried_team_ids':[t for t in TEAMS if t not in results[d]],'missing_official_players':[z for z in nba_players if int(z['nba_id']) not in merged]})
 write(root/'league_pbp_coverage.json',coverage)
 print('coverage',json.dumps(coverage),flush=True)
 if a.rebuild:
  if not all(r['complete'] for r in coverage):raise ValueError('Incomplete league data; refusing SKILL rebuild')
  import subprocess
  for script in ['rebuild_league_observations.py','score_switch_sample.py','blend_monthly_skill.py','summarize_coverage.py']:
   cmd=[sys.executable,str(pathlib.Path(__file__).with_name(script)),'--skill-dir',str(root)] if script=='rebuild_league_observations.py' else [sys.executable,str(root/script)]
   subprocess.run(cmd,check=True)

if __name__=='__main__':main()
