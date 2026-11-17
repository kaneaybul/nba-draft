"""Run native legal pick refresh only inside an explicitly isolated daily stage."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,sys,json,hashlib
from attach import PICK_SHA,sha,check

def generate(stage,repo,runtime,asof,output,draws=10000):
 stage=Path(stage).resolve();repo=Path(repo).resolve();runtime=Path(runtime).resolve();output=Path(output).resolve()
 check(repo.is_relative_to(stage)and runtime.is_relative_to(stage)and output.is_relative_to(stage),'Pick refresh must use isolated stage paths')
 model=repo/'processed/asset_history/picks/trained_pick_model.json';check(sha(model)==PICK_SHA,'Wrong inventory pick model')
 sys.path[:0]=[str(repo/'script/asset_history/backfill'),str(repo/'script/asset_history')]
 from run_pick_refresh import run,current_forecast
 # Date/complete checks before legal pricing or forecast-capture mutation.
 current_forecast(repo,asof)
 results=json.loads((repo/'raw/live/results.json').read_text());season=results['season']
 paths={'results':repo/'raw/live/results.json','team_projections':repo/f'frontend/public/data/v2/team_projections/{season}.json','events':runtime/'monthly_reconstruction/league_ownership/league_events.json','model':model,'reviewed_trades':repo/'script/asset_history/backfill/reviewed_trade_packages.json'}
 for name in ['opening_baseline','dated_events','dated_orders','daily_team_rating_anchor','forecast_inputs']:paths[name]=repo/f'processed/asset_history/picks/{name}.json'
 inputs={k:{'path':str(p),'sha256':sha(p)}for k,p in paths.items()}
 result=run(repo,runtime,asof,output,draws,model_path=model,use_published_inputs=False)
 # forecast_inputs capture intentionally changes only inside the stage. Bind post-run
 # capture, and retain pre-run hash separately to establish transition provenance.
 pre=inputs['forecast_inputs']['sha256'];inputs['forecast_inputs']['sha256']=sha(paths['forecast_inputs'])
 proof={'asof':asof,'source_mode':'same_date_native_current','pick_model_sha256':PICK_SHA,'source_fingerprint':result['source_fingerprint'],'pick_packet_sha256':sha(output),'generated_at':datetime.now(timezone.utc).isoformat(),'inputs':inputs,'forecast_inputs_before_sha256':pre,'native_runner_sha256':sha(repo/'script/asset_history/backfill/run_pick_refresh.py'),'draws':draws,'scope':'current legal pick claims only; no publication','release_ready':False}
 output.with_suffix('.proof.json').write_text(json.dumps(proof,indent=2)+'\n');return proof
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--stage',type=Path,required=True);p.add_argument('--repo',type=Path,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--asof',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(generate(a.stage,a.repo,a.runtime,a.asof,a.output)))
