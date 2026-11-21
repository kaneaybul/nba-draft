"""Isolated Work shared-ledger R/Impact/Lineup/Pick lane. No publish/collect."""
import argparse, csv, hashlib, json, math, os, re, shutil, subprocess, sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from finalize import merge, pid, read, sha

HERE=Path(__file__).resolve().parent
SOURCE_FILES={
 'exporter':'script/frontend/export_frontend_data.R','pool_r':'script/frontend/player_pool.R',
 'shared_injury_r':'script/frontend/injury_projections.R',
 'caps':'processed/livedata/impactrefresh/salary_cap_assumptions.csv',
 'preseason':'frontend/public/data/archive/{season}-preseason/impact_players.json',
 'pick_generate':'script/frontend/daily_ev2/pick_seam/generate.py',
 'pick_attach':'script/frontend/daily_ev2/pick_seam/attach.py',
 'pick_model':'processed/asset_history/picks/trained_pick_model.json',
 'results':'raw/live/results.json',
}
PICK_INPUTS=('opening_baseline','dated_events','dated_orders','daily_team_rating_anchor','forecast_inputs')
ADAPTER_NAMES=('run_next.py','run_team.R','run_economics.R','run_lineups.R','shared_team_game_rotation.R','finalize.py')

def need(x,s):
 if not x: raise ValueError(s)
def pinned(item):
 p=Path(item['path']).resolve(strict=True)
 need(p.is_file() and re.fullmatch('[0-9a-f]{64}',item['sha256']) and sha(p)==item['sha256'],f'Changed input: {p.name}')
 return p
def put(p,x):
 with p.open('x') as f:json.dump(x,f,indent=2,allow_nan=False);f.write('\n')
def stage_include(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True)
 need(not dst.exists() or sha(dst)==sha(src),f'Conflicting staged dependency: {dst.name}')
 if not dst.exists():shutil.copy2(src,dst)

def prepare(c, out):
 need(c['schema']=='nba-shared-r-team-pick-stage-config-v1','Wrong R lane config')
 d=c['asof']; day=date.fromisoformat(d); season=c['season']
 need(day.isoformat()==d and type(season) is int and season==day.year+(day.month>=7),'Unverified season/date')
 first=c['first_history_season']; need(type(first) is int and 1900<first<season,'Bad fit season range')
 paths={k:pinned(c[k]) for k in ('ledger','ledger_receipt','roster','schedule','outlook','control_impact','control_r_receipt','rscript','pick_reference_receipt','ownership_events','signed_book','ownership_receipt')}
 ledger=read(paths['ledger_receipt'])
 need((ledger['schema'],ledger['asof'],ledger['season'],ledger['production'])==('nba-shared-daily-resolved-v1',d,season,False),'Wrong resolved stage receipt')
 need(ledger['outputs']['resolved.csv']==c['ledger']['sha256'],'Ledger is not exact resolved output')
 for k in ('roster','schedule','outlook'):
  need(ledger['inputs'][k]['sha256']==c[k]['sha256'],f'Ledger receipt mismatch: {k}')
 control=read(paths['control_r_receipt']); ro=read(paths['ownership_receipt'])
 need((control['schema'],control['asof'],control['season'])==('nba-daily-role-r-export-v1',d,season),'Need same-date private R source control')
 for k,w in [('calendar_sha256','schedule'),('injuries_sha256','outlook'),('signed_book_sha256','signed_book')]:
  need(control['inputs'][k]==c[w]['sha256'],f'Private R control input differs: {w}')
 need(control['outputs'][f'frontend/public/data/v2/impact_players/{season}.json']==c['control_impact']['sha256'],'Impact input is not exact private R control output')
 need(ro['asof']==d and ro['season']==season and ro['signed_book']['sha256']==c['signed_book']['sha256'] and ro['ownership_events']['sha256']==c['ownership_events']['sha256'],'Fresh ownership not bound to dated signed book/events')
 outlook=read(paths['outlook'])
 ts=datetime.fromisoformat(outlook['generated_at'].replace('Z','+00:00'))
 need(ts.tzinfo is not None and ts.astimezone(ZoneInfo('America/New_York')).date()==day and outlook['season']==season and outlook['teams_checked']==30,'Uncertified dated availability')
 files={k:pinned(c['sources'][k]) for k in SOURCE_FILES}
 need(set(c['sources'])==set(files),'Source code set differs')
 adapter=c['adapter_sha256']; need(set(adapter)==set(ADAPTER_NAMES) and all(sha(HERE/n)==h for n,h in adapter.items()),'Shared R lane source pin differs')
 history={y:pinned(spec) for y,spec in c['history'].items()}
 need(set(history)=={str(y) for y in range(first,season)},'Historical market fit seasons incomplete')
 ps=read(paths['pick_reference_receipt']); need(ps['asof']==d and ps['source_mode']=='same_date_native_current' and ps['draws']==10000,'Wrong original legal-pick control')
 pick={k:pinned(c['pick_inputs'][k]) for k in PICK_INPUTS}
 for k in PICK_INPUTS:
  expected=ps['forecast_inputs_before_sha256'] if k=='forecast_inputs' else ps['inputs'][k]['sha256']
  need(c['pick_inputs'][k]['sha256']==expected,f'Exact legal pick input differs: {k}')
 for k,w in [('model','pick_model'),('results','results')]:
  need(ps['inputs'][k]['sha256']==c['sources'][w]['sha256'],f'Legal pick dependency differs: {k}')
 need(ps['inputs']['events']['sha256']==c['ownership_events']['sha256'],'Legal pick event input differs')
 picksrc={k:pinned(spec) for k,spec in c['pick_source'].items()}
 need(all(re.fullmatch(r'script/asset_history/(?:backfill/)?[A-Za-z0-9_]+\.(?:py|json)',k) for k in picksrc),'Unexpected pick source path')
 for k,w in [('script/asset_history/backfill/run_pick_refresh.py',ps['native_runner_sha256']),('script/asset_history/backfill/reviewed_trade_packages.json',ps['inputs']['reviewed_trades']['sha256'])]:
  need(sha(picksrc[k])==w,'Exact native legal runner/trade book differs')
 need(not out.exists(),'Fresh private output directory required')
 return paths,files,history,pick,picksrc

def dated_roster(c, p):
 # Existing producer certifies the observation at the packet boundary, not
 # in every row. Accept that exact shape, never a mixed or mismatched date.
 day,season=c['asof'],c['season']
 for key in ('roster','ledger','ledger_receipt','control_impact','control_r_receipt','schedule','outlook'):
  need(sha(p[key])==c[key]['sha256'],f'R roster date binding changed: {key}')
 receipt=read(p['ledger_receipt']); control=read(p['control_r_receipt'])
 need((receipt['schema'],receipt['asof'],receipt['season'],receipt['production'])==('nba-shared-daily-resolved-v1',day,season,False),'Roster date not bound by resolved ledger receipt')
 need((control['schema'],control['asof'],control['season'])==('nba-daily-role-r-export-v1',day,season),'Roster date not bound by R control receipt')
 need(control['outputs'][f'frontend/public/data/v2/impact_players/{season}.json']==c['control_impact']['sha256'] and control['inputs']['calendar_sha256']==c['schedule']['sha256'] and control['inputs']['injuries_sha256']==c['outlook']['sha256'],'R control receipt does not bind observed rows/calendar/outlook')
 need(receipt['outputs']['resolved.csv']==c['ledger']['sha256'] and all(receipt['inputs'][k]['sha256']==c[k]['sha256'] for k in ('roster','schedule','outlook')),'Roster date receipt does not bind exact ledger inputs')
 rows=read(p['roster'])
 need(isinstance(rows,list) and rows and all(isinstance(row,dict) for row in rows),'Expected a nonempty R roster')
 tagged=sum('asof' in row for row in rows)
 need(tagged in (0,len(rows)) and all(row.get('asof',day)==day for row in rows),'Mixed or wrong explicit date in roster')
 return ([{**row,'asof':day} for row in rows] if not tagged else rows),len(rows)-tagged

def inspect_ledger(c, p, dated=None):
 r=dated_roster(c,p)[0] if dated is None else dated
 base=read(p['control_impact']); calendar=read(p['schedule'])
 roster={pid(x):x for x in r}
 active={pid(x):x for x in base if x['pool_status']=='roster'}
 need(roster.keys()==active.keys() and len(roster)==len(r) and len(active)==sum(x['pool_status']=='roster' for x in base),'Roster identity differs')
 d=c['asof'];season=c['season']; teams={x['team'] for x in r}
 need(len(teams)==30 and all(x['pool_status']=='roster' and x['asof']==d and x['year']==season for x in r) and all(x['year']==season for x in base),'Wrong team coverage, date or season')
 need(all(all(v[k]==active[i][k] for k in ('team','team_projection_base','contract_pending','minutes_actual','minutes_actual_games')) for i,v in roster.items()),'Same-date observed row disagree')
 games={g['game_id']:g for g in calendar}; counts=Counter(); future=Counter()
 need(len(games)==len(calendar)>0 and all(isinstance(j,str) and j for j in games),'Missing/duplicated source game properties')
 for g in calendar:
  need(g['season']==season,'Mixed source schedule seasons')
  if g['season_type']!='Regular Season':
   need(g['is_completed'] or g['date']<d,'No shared postseason ledger')
   continue
  slot=[g['selected_team']] if g['is_placeholder'] else [g['home_team'],g['away_team']]
  need(all(t in teams for t in slot) and len(set(slot))==len(slot),'Bad source team slots')
  need(g['is_completed'] or g['date']>=d,'Undecided past game')
  counts.update(slot)
  if not g['is_completed']:future.update(slot)
 need(set(counts)==teams and set(counts.values())=={82},'Regular calendar is not 82 slots per team')
 need(all(x['minutes_remaining_team_games']==future[x['team']] for x in r),'Observed team clock differs')
 pos=defaultdict(set); sums=defaultdict(lambda:[0.,0.,0.]); version=c['forecast_version']
 with p['ledger'].open(newline='') as stream:
  for g in csv.DictReader(stream):
   i=int(g['nba_id']); j=int(g['game']); t=roster[i]['team']
   need(g['asof']==d and g['team']==t and g['forecast_version']==version and j>=1 and j not in pos[i],'Unexpected ledger identity/day/model')
   n=future[t]; need(int(g['team_game_clock'])==82*(season-2000)+82-n+j-1,'Disconnected team clock')
   p0,m,q,x,h,a,b=map(lambda z:float(g[z]),('probability','conditional_mpg','baseline_probability','expected_minutes','healthy_rotation','availability','baseline_minutes'))
   need(all(map(math.isfinite,(p0,m,q,x,h,a,b))) and 0<=p0<=1 and 0<=q<=1 and 0<=m<=48+1e-7 and 0<=a<=1 and 0<=h<=48*q+1e-7 and 0<=b<=48*q+1e-7 and abs(p0*m-x)<1e-7 and abs(p0-q*a)<1e-7,'Invalid role arithmetic')
   pos[i].add(j)
   if j<=n:
    gsum=sums[t,j];gsum[0]+=x;gsum[1]+=48*p0;gsum[2]+=h
 need(set(pos)==set(roster) and all(len(q)>=future[roster[i]['team']]+410 and min(q)==1 and max(q)==len(q) for i,q in pos.items()),'Incomplete current + five-year minutes horizon')
 need(len(sums)==sum(future.values()),'Missing dated team slots')
 shortages=Counter()
 for (t,j),(x,cap,h) in sums.items():
  need(abs(x-min(240,cap))<1e-7 and abs(h-240)<1e-7,f'Unexplained rotation budget: {t} {j}')
  shortages[t]+=max(0,240-x)
 need(all(x<=3+1e-7 for x in shortages.values()),'Existing 3-minute team threshold exceeded')
 return {'player_rows':len(base),'participants':len(r),'pending':sum(x['contract_pending'] for x in r),'calendar_rows':len(calendar),'completed_games':sum(bool(g['is_completed']) for g in calendar),'remaining_team_slots':len(sums),'max_team_shortfall':max(shortages.values(),default=0)}

def main(cfg,pin,out,check=False):
 config=Path(cfg); c=read(pinned({'path':str(config),'sha256':pin}))
 out=Path(out).resolve(); p,s,h,pk,ps=prepare(c,out)
 roster_rows,dates_bound=dated_roster(c,p); audit=inspect_ledger(c,p,roster_rows)
 if check:return {'asof':c['asof'],'preflight':True,'roster_dates_bound':dates_bound,**audit}
 out.mkdir(parents=True)
 # Keep the producer's exact file/path as the authoritative input. R consumes
 # a distinct, private derivative whose only possible doc change is row asof.
 r_roster=out/'roster-r-input.json'
 put(r_roster,roster_rows)
 roster_view={'schema':'nba-shared-r-roster-dated-view-v1','asof':c['asof'],
  'rows':len(roster_rows),'dates_bound_from_receipt':dates_bound,
  'original_roster_sha256':c['roster']['sha256'],'derived_roster_sha256':sha(r_roster),
  'ledger_sha256':c['ledger']['sha256'],'ledger_receipt_sha256':c['ledger_receipt']['sha256'],
  'control_r_receipt_sha256':c['control_r_receipt']['sha256']}
 rr=out/'r-repo'; pr=out/'pick-repo'; hist=out/'history'; result=out/'outputs'; season=c['season']; d=c['asof']
 for k,path in s.items():
  rel=SOURCE_FILES[k].format(season=season)
  stage_include(path,(pr if k.startswith('pick_') or k=='results' else rr)/rel)
 for k,path in pk.items():stage_include(path,pr/'processed/asset_history/picks'/f'{k}.json')
 for rel,path in ps.items():stage_include(path,pr/rel)
 for y,path in h.items():stage_include(path,hist/f'{y}.json')
 runtime=out/'runtime'
 stage_include(p['ownership_events'],runtime/'monthly_reconstruction/league_ownership/league_events.json')
 env={k:v for k,v in os.environ.items() if k not in {'NBA_ROLLING_ROLE_FILE','NBA_ROLLING_ROLE_AS_OF','NBA_DAILY_OFFICIAL_OUTLOOK','NBA_MINUTE_CAPACITY_EVIDENCE'}}
 def call(name,*args):
  with (out/f'{name}.log').open('x') as log:
   subprocess.run(list(map(str,args)),cwd=out,env=env,check=True,stdout=log,stderr=subprocess.STDOUT)
 def R(name,*args):call(name,p['rscript'],'--vanilla',HERE/f'{name}.R',*args)
 R('run_team',rr,HERE/'shared_team_game_rotation.R',p['control_impact'],r_roster,p['schedule'],p['outlook'],p['ledger'],result,c['forecast_version'],d,season)
 R('run_economics',rr,p['control_impact'],result/'player_minutes_witness.json',p['ledger'],hist,result/'impact-active.json',c['first_history_season'],season)
 impact=result/f'impact_players_{season}.json'
 merge(p['control_impact'],result/'impact-active.json',impact)
 R('run_lineups',rr,impact,result/'team_lineups.json',season)
 stage_include(result/'team_projections.json',pr/f'frontend/public/data/v2/team_projections/{season}.json')
 call('picks',sys.executable,pr/SOURCE_FILES['pick_generate'],'--stage',out,'--repo',pr,'--runtime',runtime,'--asof',d,'--output',result/'picks.json')
 picks=read(result/'picks.json');pp=read(result/'picks.proof.json')
 teams=read(result/'team_projections.json'); sched=read(result/'team_schedules.json'); lineups=read(result/'team_lineups.json')
 orig_sched=read(p['schedule']); completed=lambda rows:{v['game_id']:{k:v[k] for k in ('date','home_team','away_team','home_score','away_score','result')} for v in rows if v['is_completed']}
 need(len(teams)==90 and sum(v['scenario_id']=='base' and v['schedule_as_of']==d for v in teams)==30 and len(lineups)==900 and len(sched)==len(orig_sched) and completed(sched)==completed(orig_sched),'Team/lineup coverage or completed results changed')
 need(all(sha(v)==c[k]['sha256'] for k,v in p.items()) and all(sha(v)==c['sources'][k]['sha256'] for k,v in s.items()) and sha(config)==pin and sha(r_roster)==roster_view['derived_roster_sha256'],'A certified input changed while preparing the stage')

 need(picks['complete'] is True and picks['date']==d and len(picks['teams'])==30 and picks['draws']==10000 and pp['pick_packet_sha256']==sha(result/'picks.json') and pp['inputs']['team_projections']['sha256']==sha(result/'team_projections.json'),'Incomplete or unlinked legal pick output')
 rc={'schema':'nba-shared-r-team-pick-stage-v1','asof':d,'season':season,'forecast_version':c['forecast_version'],'config_sha256':pin,'inputs':{k:c[k]['sha256'] for k in p},'ledger_sha256':c['ledger']['sha256'],'ledger_receipt_sha256':c['ledger_receipt']['sha256'],'control_r_receipt_sha256':c['control_r_receipt']['sha256'],'audit':audit,'r_roster_view':roster_view,'production':False,'release_ready':False,'outputs':{x.name:sha(x) for x in result.glob('*.json') if x.name!='impact-active.json'}}
 put(out/'receipt.json',rc)
 return rc
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('config');a.add_argument('sha256');a.add_argument('out');a.add_argument('--check',action='store_true')
 v=a.parse_args();print(json.dumps(main(v.config,v.sha256,v.out,v.check),indent=2))
