"""Single current-date native stage. No collectors, R, terms refresh or publication."""
import argparse,csv,hashlib,json,os,shutil,subprocess,sys
from datetime import datetime,timezone,date
from pathlib import Path
METHOD='peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster'
MODEL='fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f'
POLICY='sparse-observed-role-evidence-v2-transient-roster'
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def need(ok,msg):
 if not ok:raise ValueError(msg)
def inventory(root):
 root=Path(root);need(not root.is_symlink(),'Symlink root rejected')
 paths=sorted(root.rglob('*'));need(not any(p.is_symlink() for p in paths),'Symlinks rejected')
 return {p.relative_to(root).as_posix():sha(p) for p in paths if p.is_file()}
def digest(obj):return hashlib.sha256(json.dumps(obj,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def checkpoint_hash(prior):
 return digest({'manifest.json':sha(prior/'manifest.json'),**{'states/'+t+'.json':sha(prior/'states'/f'{t}.json') for t in TEAMS}})
def verify_map(root,values):
 need(bool(values),'Empty reviewed inventory')
 for name,h in values.items():
  p=root/name;need(p.resolve().is_relative_to(root.resolve()) and not p.is_symlink(),'Unsafe inventory path')
  need(p.is_file() and sha(p)==h,'Changed prepared file: '+name)
def validate(a,today=None):
 day=date.fromisoformat(a.asof);need(a.asof==(today or datetime.now(timezone.utc).date().isoformat()),'Not current UTC date')
 need(sha(a.prepared_receipt)==a.prepared_receipt_sha256,'Reviewed prep receipt changed')
 p=read(a.prepared_receipt)
 need(p.get('scope')=='dated-native-inputs-only-not-replayed-not-priced-not-published','Not fresh prepared source')
 need(p.get('asof')==a.asof and p.get('season')==day.year+(day.month>=7),'Prepared date/season mismatch')
 need(p.get('method')==METHOD and p.get('model_sha256')==MODEL and p.get('evidence_policy')==POLICY,'Method/model mismatch')
 need(p.get('extension_executed') is True,'Missing native input extension')
 need(all(p.get(k)==0 for k in ('native_replay_invocations','pricing_invocations','r_exports')),'Preparation contains downstream work')
 for meta in p.get('sources',{}).values():need(sha(meta['path'])==meta['sha256'],'Changed authentic source')
 need(bool(p.get('sources')),'No source evidence')
 files=p.get('prepared_files_sha256',{});verify_map(a.prepared_root,files)
 actual={k:v for k,v in inventory(a.prepared_root).items() if k.startswith(('repo/','runtime/'))}
 need(actual==files,'Prepared tree inventory differs')
 runtime=a.prepared_root/'runtime';repo=a.prepared_root/'repo'
 need(sha(runtime/'sparse_role_models.json')==MODEL,'Wrong fitted model bytes')
 prior=read(a.prior_checkpoint/'manifest.json');need(date.fromisoformat(prior['as_of'])<day,'Prior checkpoint must precede date')
 need(checkpoint_hash(a.prior_checkpoint)==a.prior_checkpoint_sha256,'Prior checkpoint changed')
 need(sha(a.grades)==a.grade_checkpoint_sha256,'Grade checkpoint changed')
 need(sha(a.calibration_receipt)==a.calibration_receipt_sha256,'Calibration receipt changed')
 cal=read(a.calibration_receipt)
 need(cal.get('schema')=='nba-daily-native-calibration-v1','Unknown calibration receipt')
 need(cal.get('asof')==a.asof and cal.get('model_sha256')==MODEL and cal.get('source_preparation_receipt_sha256')==a.prepared_receipt_sha256,'Calibration date/source/model mismatch')
 need(cal.get('calibration_sha256')==sha(a.calibration) and cal.get('injuries_sha256')==sha(a.injuries),'Calibration/injuries changed')
 need(cal.get('injuries_asof')==a.asof and cal.get('reviewed') is True,'Unreviewed or stale injuries/calibration')
 need(sha(a.signed_book)==a.signed_book_sha256,'Signed book changed')
 need(any(m.get('sha256')==a.signed_book_sha256 and Path(m['path']).resolve()==a.signed_book.resolve() for m in p['sources'].values()),'Signed book not source-bound')
 return p,prior

def run(a,runner=subprocess.run,today=None):
 need(not a.output.exists(),'Output must be new; never overwrite or consume prior proof')
 p,prior=validate(a,today);a.output.mkdir(parents=True)
 initial=a.output/'initial';shutil.copytree(a.prior_checkpoint/'states',initial);shutil.copy2(a.prior_checkpoint/'manifest.json',initial/'ownership_manifest.json')
 source=a.prepared_root/'repo/script/asset_history/backfill';runtime=a.prepared_root/'runtime'
 cmd=[sys.executable,str(source/'run_owner_replay.py'),'--canonical',str(runtime),'--repo',str(a.prepared_root/'repo'),'--output',str(a.output/'replay'),'--initial-state',str(initial),'--injuries',str(a.injuries),'--calibration-cache',str(a.calibration),'--through',a.asof,'--max-dates','1','--workers','4']
 with (a.output/'native.log').open('w') as log:runner(cmd,check=True,stdout=log,stderr=subprocess.STDOUT,timeout=900,env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1','PYTHONDONTWRITEBYTECODE':'1'})
 validate(a,today) # never issue a receipt after input mutation
 batch=a.output/'replay/batches'/a.asof;manifest=read(batch/'manifest.json');need(manifest.get('as_of')==a.asof,'Wrong native date')
 need(read(a.output/'replay/latest.json').get('batch')=='batches/'+a.asof,'Unexpected terminal batch')
 need({x.name for x in (a.output/'replay/batches').iterdir() if x.is_dir()}=={prior['as_of'],a.asof},'Extra replay dates')
 need({x.name for x in (batch/'output').iterdir() if x.is_dir()}==set(TEAMS),'Incomplete team outputs')
 for t in TEAMS:
  state=read(batch/'states'/f'{t}.json');need(state.get('as_of')==a.asof,'Stale state')
  need(state.get('model_source_hashes')==manifest.get('model_source_hashes'),'State fingerprint mismatch')
  for name in ('league_player_coverage.json','monthly_player_values.csv','monthly_annual_values.csv','monthly_quote_carry_states.csv'):
   f=batch/'output'/t/name;need(f.is_file() and f.stat().st_size>0,'Missing '+t+'/'+name)
   if name.endswith('.csv'):
    with f.open() as inp:
     for row in csv.DictReader(inp):need(row.get('cutoff_date',a.asof)==a.asof,'Mixed output date')
 out=inventory(batch/'output');need(all(len(k.split('/'))==2 for k in out),'Unexpected nested output')
 official=p.get('official_injury_receipt')
 if official:
  need(sha(official['path'])==official['sha256'],'Official injury evidence receipt changed')
 r={'schema':'nba-daily-native-replay-v1','asof':a.asof,'season':p['season'],'method':METHOD,'model_sha256':MODEL,'evidence_policy':POLICY,'source_preparation_receipt_sha256':a.prepared_receipt_sha256,'signed_book_sha256':a.signed_book_sha256,'batch_manifest_sha256':sha(batch/'manifest.json'),'output_sha256':out,'prior_checkpoint':{'asof':prior['as_of'],'sha256':a.prior_checkpoint_sha256},'grade_checkpoint_sha256':a.grade_checkpoint_sha256,'teams':30,'complete':True,'production':False,'native_replay_invocations':1,'calibration_receipt_sha256':a.calibration_receipt_sha256}
 if official:
  r['official_injury_outlook']=p['sources']['injuries']
  r['official_injury_receipt']=official
 path=a.output/'native_replay_receipt.json';path.write_text(json.dumps(r,sort_keys=True,indent=2)+'\n');return {'receipt':str(path),'batch':str(batch),'receipt_sha256':sha(path)}
if __name__=='__main__':
 q=argparse.ArgumentParser()
 for k in ('prepared-root','prepared-receipt','prior-checkpoint','grades','calibration','calibration-receipt','injuries','signed-book','output'):q.add_argument('--'+k,type=lambda s:Path(s).resolve(),required=True)
 for k in ('asof','prepared-receipt-sha256','prior-checkpoint-sha256','grade-checkpoint-sha256','calibration-receipt-sha256','signed-book-sha256'):q.add_argument('--'+k,required=True)
 print(json.dumps(run(q.parse_args())))
