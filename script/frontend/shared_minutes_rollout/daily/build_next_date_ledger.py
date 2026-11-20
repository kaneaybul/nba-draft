"""Run real date-parameterized shared ledger generation, never publish."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,sys
from datetime import date
from daily_gate import pinned,digest,require,read
root=Path(__file__).resolve().parents[1]

def build(cfg,out):
 d=cfg['asof']; day=date.fromisoformat(d);season=cfg['season'];require(season==day.year+(day.month>=7),'Season/date mismatch')
 blobs={k:pinned(cfg[k]) for k in ('roster','scope','mpg','outcomes','schedule','outlook','collector_receipt','appraisal_scope_receipt')}
 collection=read(blobs['collector_receipt']);require(collection['asof']==d and collection['season']==season and collection['source_checks_pass'] is True and collection['protected_bytes_unchanged'] is True,'Uncertified source collection')
 app=read(blobs['appraisal_scope_receipt']);require(app['asof']==d and app['scope_sha256']==digest(blobs['scope']) and app['roster_sha256']==digest(blobs['roster']),'Scope not tied to current roster and date')
 outlook=read(blobs['outlook']);require(outlook['season']==season and outlook['generated_at'][:10]==d and outlook['teams_checked']==30,'Stale or incomplete injury inputs')
 hist=Path(cfg['history_root']).resolve(strict=True);history={x.name:digest(x) for x in hist.glob('*.json') if x.stem.isdigit() and int(x.stem)<season};require(history==cfg['history_sha256'],'Unreviewed season history files')
 r_root=Path(cfg['r_workspace']).resolve(strict=True)
 for rel,pin in cfg['r_workspace_source_sha256'].items():require(digest(r_root/rel)==pin,'R role allocator source does not match')
 require(set(cfg['r_workspace_source_sha256'])=={'script/frontend/live_minutes.R','script/frontend/injury_projections.R'},'Missing R allocator source pins')
 rscript=pinned(cfg['rscript']);
 require(not out.exists(),'Use a fresh dated output root');out.mkdir(parents=True)
 def packet(key):return {'path':str(blobs[key]),'sha256':digest(blobs[key])}
 p=out/'inputs.json';p.write_text(json.dumps({'schema':'nba-shared-cutover-reviewed-inputs-v1','asof':d,'season':season,'roster_sha256':digest(blobs['roster']),'history_sha256':history,'appraisal_scope':packet('scope'),'mpg_anchors':packet('mpg'),'appearance_outcomes':packet('outcomes')},sort_keys=True)+'\n')
 env={**os.environ,'PYTHONPATH':str(root/'core/candidate'),'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'}
 for script,args in [(root/'assemble_horizon_receipt.py',[d,season,blobs['roster'],hist,p,digest(p),out/'horizon.json']), (root/'core/candidate/build_shared_roles.py',[hist,blobs['roster'],d,out/'healthy.csv','--horizon-receipt',out/'horizon.json','--horizon-receipt-sha256',None]), (root/'verify_draft_service_coverage.py',[out/'resolved.csv',blobs['scope'],out/'service.json'])]:
  if script.name=='build_shared_roles.py':args[-1]=digest(out/'horizon.json')
  if script.name=='verify_draft_service_coverage.py':subprocess.run(list(map(str,[rscript,'--vanilla',root/'core/candidate/allocate_shared_roles.R',r_root,out/'healthy.csv',blobs['roster'],blobs['schedule'],blobs['outlook'],d,out/'resolved.csv'])),env=env,check=True)
  subprocess.run(list(map(str,[sys.executable,script,*args])),env=env,check=True)
 receipt={'schema':'nba-shared-daily-resolved-v1','asof':d,'season':season,'inputs':{k:packet(k) for k in blobs},'outputs':{k:digest(out/k) for k in ('horizon.json','healthy.csv','resolved.csv','service.json')},'production':False,'release_ready':False};(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');return receipt
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('config');p.add_argument('sha256');p.add_argument('out',type=Path);a=p.parse_args();print(json.dumps(build(read(pinned({'path':a.config,'sha256':a.sha256})),a.out.resolve()),indent=2))

