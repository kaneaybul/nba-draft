"""Dated source certification for isolated e-v2 native input preparation only. No collectors."""
import argparse,json,hashlib,math,sys,csv
from datetime import datetime,date,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'phase2'))
from source_injury_metadata import prepare as prepare_acute
import injury_calendar
TEAMS=set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())
MODEL='fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def certify(repo,demographics,schedule,model,asof,season):
 date.fromisoformat(asof)
 if not isinstance(season,int):raise ValueError("Integer season required")
 history=model.parent/'monthly_reconstruction/darko/end_of_month/darko_monthly.csv'
 prior={int(r['nba_id']):r for r in sorted(csv.DictReader(history.open()),key=lambda r:r['cutoff']) if r['cutoff']<asof}
 fallback=[]
 if sha(model)!=MODEL:raise ValueError('Wrong fitted model')
 files={k:repo/v for k,v in {'ratings':'raw/live/ratings.json','skills':'raw/live/skill_stats.json','roster':'raw/live/player_pool.json','results':'raw/live/results.json','positions':'raw/live/positions.json','injuries':'frontend/public/data/injury_outlook.json','ownership':'processed/contracts/current.json'}.items()}
 source={k:json.loads(p.read_text()) for k,p in files.items()}
 for k,v in source.items():
  day=v['as_of'] if k=='ownership' else datetime.fromisoformat(v['generated_at'].replace('Z','+00:00')).date().isoformat()
  if day!=asof:raise ValueError('Wrong source observation date: '+k)
  if v.get('season')!=season:raise ValueError('Wrong source season: '+k)
  if k in ('roster','results','injuries') and v['teams_checked']!=30:raise ValueError('Incomplete source: '+k)
 if (date.fromisoformat(source['ratings']['epm_as_of'])-timedelta(days=1)).isoformat()>asof or source['ratings']['darko_through']>asof:raise ValueError('Future provider performance')
 book=source['ownership'];owners={(int(r['nba_id']),r['team']) for r in book['players']}
 if not book['complete'] or len(owners)!=len(book['players']) or {t for _,t in owners}!=TEAMS:raise ValueError('Incomplete signed ownership')
 rows=json.loads(demographics.read_text());games=json.loads(schedule.read_text());seen=set()
 if not games or any(g.get('season')!=season for g in games):raise ValueError('Wrong schedule season')
 if any(g.get('is_completed') and g.get('date','9999')>asof for g in games):raise ValueError('Future schedule result')
 primary={int(r['nba_id']):r['primary_position'] for r in source['positions']['players'] if r.get('nba_id')}
 for r in rows:
  pid=int(r.get('source_nba_id') or r['nba_id'])
  if pid in primary:r['Pos1']=primary[pid]
 for r in rows:
  pid=r.get('source_nba_id') or r['nba_id']
  if pid in seen:raise ValueError('Duplicate demographic identity')
  seen.add(pid)
  if r.get('pool_status')=='roster':
   if (int(pid),r['team']) not in owners:raise ValueError('Unapproved demographic owner')
   old=prior.get(int(pid),{});age=r.get('age');yoe=r.get('yoe');position=r.get('Pos1') or r.get('position') or old.get('position')
   if age is None and old:age=float(old['age'])+season-int(old['season'])
   rookie=int(old['rookie_season']) if old else season-int(yoe)+1 if yoe is not None else None
   if not isinstance(age,(int,float)) or not math.isfinite(age) or rookie is None or not position:raise ValueError('Missing source demographic: '+r['player_name'])
   if yoe is None:fallback.append({'nba_id':int(pid),'field':'rookie_season','source_cutoff':old['cutoff']})
 if {(int(r.get('source_nba_id') or r['nba_id']),r['team']) for r in rows if r.get('pool_status')=='roster'}!=owners:raise ValueError('Incomplete demographic ownership')
 acute=prepare_acute([r for r in rows if r.get('pool_status')=='roster'],source['injuries'],games,asof,injury_calendar);byid={r['nba_id']:r for r in acute}
 metadata=[byid.get(r['nba_id'],r) for r in rows]
 resultgames=[g for g in source['results']['games'] if g.get('is_completed')]
 if any(g['date']>asof for g in resultgames):raise ValueError('Future completed game')
 receipt={'asof':asof,'scope':'dated-native-inputs-only-not-replayed-not-priced-not-published','season':season,'model_sha256':MODEL,'sources':{k:{'path':str(p.resolve()),'sha256':sha(p)} for k,p in files.items()},'demographics_sha256':sha(demographics),'schedule_sha256':sha(schedule),'native_existing_demographic_fallbacks':fallback,'prior_darko_sha256':sha(history),'owned_players':len(owners),'demographic_players':len(rows),'source_performance':{'epm_pregame':source['ratings']['epm_as_of'],'darko_through':source['ratings']['darko_through'],'latest_completed_game':max(g['date'] for g in resultgames),'completed_games':len(resultgames)}}
 return metadata,games,receipt

METHOD='peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster'
DATA=('raw/live/ratings.json','raw/live/skill_stats.json','raw/live/player_pool.json','raw/live/results.json','raw/live/positions.json','frontend/public/data/injury_outlook.json','processed/contracts/current.json')
def load(p):return json.loads(Path(p).read_text())
def checked_file(item):
 p=Path(item['path']).resolve()
 if not p.is_file()or sha(p)!=item['sha256']:raise ValueError('Source receipt hash mismatch')
 return p

def validate_bundle(native,source,demographics,schedule,collector_receipt,ownership_receipt,r_receipt,asof,season):
 """Receipts prove identity of existing inputs, never grant provider/contract authority."""
 import runpy
 native=Path(native).resolve();source=Path(source).resolve()
 mv=runpy.run_path(str(native/'repo/script/asset_history/model_version.py'))
 if mv.get('METHOD')!=METHOD:raise ValueError('Wrong native method')
 if sha(native/'repo/script/asset_history/backfill/injury_calendar.py')!=sha(Path(injury_calendar.__file__)):raise ValueError('Foreign acute calendar implementation')
 c=load(collector_receipt)
 if c.get('schema')!='nba-source-only-coverage-v1' or c.get('asof')!=asof or c.get('season')!=season or not c.get('source_checks_pass') or c.get('issues') or not c.get('coverage_evidence_supplied'):raise ValueError('Uncertified dated collector sources')
 for rel in DATA[:-1]:
  if c.get('feeds',{}).get(rel,{}).get('sha256')!=sha(source/rel):raise ValueError('Collector/source hash mismatch: '+rel)
 o=load(ownership_receipt)
 if o.get('schema')!='nba-existing-dated-ownership-binding-v1' or o.get('asof')!=asof or o.get('season')!=season:raise ValueError('Missing dated ownership binding')
 ledger=checked_file(o['ledger']);audit=checked_file(o['source_audit']);book=checked_file(o['signed_book'])
 events=checked_file(o['ownership_events'])
 for key,name in [('contract_agreements','contract_agreements.json'),('contract_adjustments','contract_adjustments.json')]:
  original=checked_file(o['native_terms'][key])
  if sha(original)!=sha(native/'repo/processed/asset_history/contracts'/name):raise ValueError('Saved native terms differ; explicit review required')
 if book!=source/'processed/contracts/current.json':raise ValueError('Wrong signed book destination')
 if load(audit).get('knowledge_date')!=asof:raise ValueError('Stale dated ownership audit')
 dated=[x for x in load(ledger)if x['cutoff_date']==asof]
 if len(dated)!=1:raise ValueError('Missing or duplicate dated ownership ledger')
 ledger_owners={(int(r['nba_id']),r['team'])for r in dated[0]['roster']if r.get('nba_id')is not None and not r.get('draft_rights') and not r.get('rfa_pending')}
 signed={(int(r['nba_id']),r['team'])for r in load(book)['players']}
 if ledger_owners!=signed:raise ValueError('Ledger/signed book ownership mismatch')
 # Metadata/calendar provenance must be explicitly bound, not a renamed frozen output.
 rp=load(r_receipt)
 if rp.get('schema')!='nba-source-r-demographics-calendar-v1' or rp.get('asof')!=asof or rp.get('season')!=season:raise ValueError('Missing R provenance binding')
 for key,path in [('demographics',demographics),('schedule',schedule)]:
  item=rp.get(key,{})
  if item.get('asof')!=asof or checked_file(item)!=Path(path).resolve():raise ValueError('Unbound dated '+key)
 rows,games,r=certify(source,Path(demographics),Path(schedule),native/'runtime/sparse_role_models.json',asof,season)
 def game_map(rows):
  out={}
  for g in rows:
   if not g.get('is_completed'):continue
   key=(g['date'],g['home_team'],g['away_team'])
   if key in out:raise ValueError('Duplicate dated matchup')
   out[key]=(float(g['home_score']),float(g['away_score']))
  return out
 expected=game_map(games);actual=game_map(load(source/'raw/live/results.json')['games'])
 if not expected or expected!=actual:raise ValueError('Independent schedule/result matchup or score mismatch')
 r.update(method=METHOD,collector_receipt_sha256=sha(collector_receipt),ownership_receipt_sha256=sha(ownership_receipt),dated_ledger_sha256=sha(ledger),dated_ownership_audit_sha256=sha(audit),ownership_events_sha256=sha(events),native_terms_sha256={k:v['sha256']for k,v in o['native_terms'].items()},native_code_sha256={str(p.relative_to(native/'repo')):sha(p)for p in (native/'repo/script/asset_history').rglob('*.py')},demographic_calendar_binding=rp,r_provenance_receipt_sha256=sha(r_receipt),retained_non_signed_rights=[r for r in dated[0]['roster']if r.get('rfa_pending') or r.get('draft_rights')])
 return rows,games,r,ledger,audit

def prepare(native,source,demographics,schedule,collector_receipt,ownership_receipt,r_receipt,asof,season,work,execute_extension=True):
 import shutil,subprocess,os
 native=Path(native).resolve();source=Path(source).resolve();work=Path(work).resolve()
 if work.exists() or work==native or native in work.parents or source in work.parents:raise ValueError('Fresh separate work directory required')
 rows,games,r,ledger,audit=validate_bundle(native,source,demographics,schedule,collector_receipt,ownership_receipt,r_receipt,asof,season)
 shutil.copytree(native/'repo',work/'repo',ignore=shutil.ignore_patterns('__pycache__'));shutil.copytree(native/'runtime',work/'runtime',ignore=shutil.ignore_patterns('__pycache__'))
 repo=work/'repo';runtime=work/'runtime'
 for rel in DATA:
  p=repo/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/rel,p)
  expected=next(v['sha256']for v in r['sources'].values()if Path(v['path'])==source/rel)
  if sha(p)!=expected:raise ValueError('Source changed during copy')
 for rel,data in [(f'impact_players/{season}.json',rows),(f'team_schedules/{season}.json',games)]:
  p=repo/'frontend/public/data/v2'/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data,allow_nan=False))
 target=runtime/'monthly_reconstruction/league_ownership';shutil.copy2(ledger,target/'monthly_league_rosters.json');shutil.copy2(audit,target/'roster_refresh_source.json');shutil.copy2(checked_file(load(ownership_receipt)['ownership_events']),target/'league_events.json')
 # Strip same/future provider fallback rows in isolated copy only.
 p=runtime/'monthly_reconstruction/darko/end_of_month/darko_monthly.csv';records=list(csv.DictReader(p.open()));fields=list(records[0]);records=[x for x in records if x['cutoff']<asof]
 with p.open('w')as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(records)
 if execute_extension:
  cmd=[sys.executable,str(repo/'script/asset_history/backfill/extend_daily_inputs.py'),'--runtime',str(runtime),'--repo',str(repo),'--as-of',asof]
  with (work/'extension.log').open('w')as log:subprocess.run(cmd,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=600,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})
 for rel,h in r['native_code_sha256'].items():
  if sha(repo/rel)!=h:raise ValueError('Native code changed during input preparation')
 r.update(evidence_policy='sparse-observed-role-evidence-v2-transient-roster',prepared_files_sha256={str(p.relative_to(work)):sha(p)for base in (repo,runtime)for p in base.rglob('*')if p.is_file()},extension_executed=execute_extension,native_replay_invocations=0,pricing_invocations=0,r_exports=0,release_ready=False)
 (work/'source_preparation_receipt.json').write_text(json.dumps(r,indent=2)+'\n')
 return r

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser()
 for k in ('native','source','demographics','schedule','collector-receipt','ownership-receipt','r-receipt','work'):p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--asof',required=True);p.add_argument('--season',type=int,required=True);p.add_argument('--prepare-only',action='store_true')
 a=p.parse_args();r=prepare(a.native,a.source,a.demographics,a.schedule,a.collector_receipt,a.ownership_receipt,a.r_receipt,a.asof,a.season,a.work,not a.prepare_only);print(json.dumps({k:r[k]for k in ('asof','season','scope','extension_executed','native_replay_invocations','pricing_invocations','release_ready')}))
