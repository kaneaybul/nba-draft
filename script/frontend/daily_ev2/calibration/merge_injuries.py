"""Exact native injury_history behavior on a private copied checkpoint only."""
import argparse,json,hashlib,sys,shutil
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def merge(repo,runtime,prior_episodes,base,asof,out):
 if out.exists():raise ValueError('Fresh injury staging directory required')
 current=runtime/'monthly_reconstruction/injuries/current_availability.json';panel=json.loads(current.read_text())
 if panel.get('date')!=asof:raise ValueError('Current availability date differs')
 for r in panel.get('records',[]):
  if not 0<=r['availability']<=1 or r.get('known_from','9999')>asof:raise ValueError('Invalid or future injury evidence')
 inputs={str(p):sha(p)for p in [prior_episodes,base,current]};out.mkdir(parents=True);state=out/'state';state.mkdir();shutil.copy2(prior_episodes,state/'injury_episodes.json')
 sys.path[:0]=[str(repo/'script/asset_history'),str(repo/'script/asset_history/backfill')]
 from run_player_refresh import injury_history
 injury_history(runtime,state,base,out/'combined_injury_episodes.json')
 if any(sha(Path(p))!=h for p,h in inputs.items()):raise ValueError('Injury input changed')
 proof={'asof':asof,'inputs':inputs,'injuries_sha256':sha(out/'combined_injury_episodes.json'),'state_sha256':sha(state/'injury_episodes.json'),'policy':'existing_native_injury_history_on_private_copy','no_provider_calls':True}
 (out/'injury_merge_proof.json').write_text(json.dumps(proof,indent=2));return proof
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['repo','runtime','prior-episodes','base','out']:p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--asof',required=True);a=p.parse_args();print(json.dumps(merge(a.repo.resolve(),a.runtime.resolve(),a.prior_episodes.resolve(),a.base.resolve(),a.asof,a.out.resolve())))
