"""Bounded source-only Work driver. Default dry-run. No Git/contract/export APIs.
Use an exclusively assigned isolated Work copy; hash checks are NOT a lock.
"""
import argparse, hashlib, json, os, subprocess
from pathlib import Path
from datetime import date, datetime, timezone
ALLOW=tuple('raw/live/'+x+'.json' for x in ('ratings','skill_stats','player_pool','results','positions','position_status'))+('frontend/public/data/injury_outlook.json','raw/bref_position_estimates.csv','raw/switch/player_positions.rds')
COMMANDS=[['python3','script/data/refresh_player_pool.py'],['node','--test','script/data/test_live_ratings.mjs'],['node','script/data/refresh_live_ratings.mjs'],['python3','script/data/refresh_injury_outlook.py','--results-output','raw/live/results.json'],['Rscript','script/data/pull_bref_position_estimates.R'],['python3','script/data/refresh_live_skill_stats.py'],['Rscript','script/frontend/refresh_live_switch.R'],['python3','script/data/refresh_player_pool.py','--enrich']]
BLOCK_SHA='48e253621417f137a24163613843492556c66197e6745125d7c8c95395bc2a70'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def workflow_block(repo):
 text=(repo/'script/frontend/run_work_refresh.sh').read_text()
 block=text[text.index("echo 'Refreshing player membership"):text.index("echo 'Scoring the verified draft input snapshot'")]
 if hashlib.sha256(block.encode()).hexdigest()!=BLOCK_SHA:raise ValueError('Collector block changed; review required')
 return block

def snapshot(repo):
 out={}
 for p in sorted(repo.rglob('*')):
  rel=p.relative_to(repo)
  if '.git' in rel.parts:continue
  if p.is_symlink():raise ValueError('Symlink not permitted in isolated input copy: '+str(rel))
  if p.is_file():out[str(rel)]=sha(p)
 return out

def protected_diff(before,after):
 return sorted(k for k in before.keys()|after.keys() if k not in ALLOW and before.get(k)!=after.get(k))

def day(v):return datetime.fromisoformat(v.replace('Z','+00:00')).date().isoformat()
def inspect_sources(repo,asof,season,coverage=None):
 date.fromisoformat(asof);issues=[];feeds={};loaded={}
 for rel in ALLOW:
  p=repo/rel
  if not p.is_file():issues.append('missing:'+rel);continue
  f={'sha256':sha(p),'bytes':p.stat().st_size};feeds[rel]=f
  if p.suffix!='.json':continue
  try:
   d=json.loads(p.read_text());loaded[rel]=d
   if not isinstance(d,dict):raise ValueError('object required')
   stamp=d.get('checked_at') if rel.endswith('position_status.json') else d.get('generated_at')
   f['observed_at']=stamp
   if not stamp or day(stamp)!=asof:issues.append('observation_date:'+rel)
   if rel.endswith('position_status.json'):
    status=d.get('seasons',{}).get(str(season),{});f['season_status']=status.get('status')
    if status.get('status') not in ('ok','updated','success'):issues.append('position_provider_not_fresh')
    continue
   if d.get('schema_version')!=1 or d.get('season')!=season:issues.append('schema_or_season:'+rel)
   for key in ('epm_as_of','darko_through','source_updated_at','held_components','held_skill_components','completed_games_at_fetch','teams_checked','review_pending','provisional_ids'):
    if key in d:f[key]=d[key]
   for key in ('epm_as_of','darko_through'):
    if key in d and (not isinstance(d[key],str) or d[key][:10]>asof):issues.append('future_provider:'+rel+':'+key)
   if rel.endswith(('player_pool.json','results.json','injury_outlook.json')) and d.get('teams_checked')!=30:issues.append('team_coverage:'+rel)
   if 'players' in d:
    rows=d['players'];f['rows']=len(rows)
    if not isinstance(rows,list) or not rows:issues.append('empty_players:'+rel);continue
    ids=[(r.get('team'),r.get('name_key')) if rel.endswith('injury_outlook.json') else (r.get('app_nba_id') or r.get('nba_id')) for r in rows]
    if any(x is None or (isinstance(x,tuple) and None in x) for x in ids) or len(set(map(str,ids)))!=len(ids):issues.append('unresolved_or_duplicate_id:'+rel)
   if rel.endswith('player_pool.json') and (d.get('review_pending') or d.get('provisional_ids')):issues.append('ownership_identity_review_pending')
   if rel.endswith('positions.json') and any(r.get('primary_position') not in ('PG','SG','SF','PF','C') for r in d['players']):issues.append('missing_primary_position')
  except (ValueError,TypeError,KeyError,AttributeError) as e:issues.append('invalid_source:'+rel+':'+type(e).__name__)
 results=loaded.get('raw/live/results.json',{});games=results.get('games',[])
 completed=[g for g in games if g.get('is_completed')];gids=[str(g.get('game_id')) for g in completed]
 if not completed or len(set(gids))!=len(gids) or any(g.get('date','9999')>asof for g in completed):issues.append('invalid_completed_games')
 rf=feeds.get('raw/live/results.json',{});rf.update(completed_games=len(completed),latest_completed_day=max((g.get('date','') for g in completed),default=None))
 skills=loaded.get('raw/live/skill_stats.json',{})
 if skills.get('completed_games_at_fetch')!=len(completed):issues.append('skill_results_count_mismatch')
 # A fetch timestamp is not proof all scheduled completed games arrived.
 if not coverage:issues.append('independent_schedule_coverage_missing')
 else:
  if coverage.get('asof')!=asof or set(map(str,coverage.get('expected_completed_game_ids',[])))!=set(gids) or not coverage.get('source_sha256') or not coverage.get('source_description'):issues.append('independent_schedule_coverage_mismatch')
 return {'schema':'nba-source-only-coverage-v1','asof':asof,'season':season,'feeds':feeds,'issues':sorted(set(issues)),'coverage_evidence_supplied':coverage is not None,'source_checks_pass':not issues,'native_ready':False,'release_ready':False,'scope':'source-only; independent signed ownership/demographic/acute binding still required'}

def run(repo,out,asof,season,execute=False,coverage=None,runner=subprocess.run):
 repo=repo.resolve();out=out.resolve()
 if repo==out or repo in out.parents:raise ValueError('Receipt directory must be outside isolated repository')
 if out.exists():raise ValueError('New receipt directory required; no automatic resume')
 workflow_block(repo);out.mkdir(parents=True)
 before=snapshot(repo);(out/'before.json').write_text(json.dumps(before,sort_keys=True))
 plan={'commands':COMMANDS,'allowlist':ALLOW,'execute':execute,'requested_asof':asof,'season':season,'provider_commands_run':0}
 (out/'plan.json').write_text(json.dumps(plan,indent=2))
 if not execute:return plan
 # Inherit existing authorized process authentication without reading/printing it.
 env=os.environ.copy();env.update(TZ='UTC',CURRENT_ROSTER_YEAR=str(season-1),BREF_POSITION_YEARS=str(season),BREF_POSITION_REFRESH='true',PYTHONDONTWRITEBYTECODE='1')
 error=None
 try:
  for i,cmd in enumerate(COMMANDS):
   result=runner(cmd,cwd=repo,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=600,check=False)
   plan['provider_commands_run']=i+1
   if result.returncode:raise RuntimeError('collector step '+str(i+1)+' exited '+str(result.returncode))
   changes=protected_diff(before,snapshot(repo))
   if changes:raise RuntimeError('nonallowlisted file changes; stop and review')
 except Exception as e:error=type(e).__name__+':'+str(e)
 after=snapshot(repo);unexpected=protected_diff(before,after)
 receipt=inspect_sources(repo,asof,season,coverage)
 receipt.update(execution_error=error,unexpected_changed_paths=unexpected,provider_commands_run=plan['provider_commands_run'],allowlisted_changed_paths=[k for k in ALLOW if before.get(k)!=after.get(k)],protected_bytes_unchanged=not unexpected)
 if error or unexpected:receipt['source_checks_pass']=False
 (out/'after.json').write_text(json.dumps(after,sort_keys=True));(out/'receipt.json').write_text(json.dumps(receipt,indent=2))
 return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--asof',required=True);p.add_argument('--season',type=int,required=True);p.add_argument('--execute-collectors',action='store_true');p.add_argument('--coverage',type=Path);a=p.parse_args()
 r=run(a.repo,a.out,a.asof,a.season,a.execute_collectors,json.loads(a.coverage.read_text()) if a.coverage else None)
 print(json.dumps({'executed':a.execute_collectors,'source_checks_pass':r.get('source_checks_pass',False),'native_ready':False,'release_ready':False}))
 if a.execute_collectors and not r.get('source_checks_pass'):raise SystemExit(2)
