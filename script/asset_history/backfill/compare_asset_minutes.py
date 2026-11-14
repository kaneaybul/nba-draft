"""Bounded same-source Utah asset-dollar replay; never publishes data."""
import argparse,csv,json,os,subprocess,sys
from pathlib import Path
import pandas as pd
from run_player_refresh import unpack

def run(repo,work):
 runtime=work/'runtime';unpack(repo/'processed/asset_history/canonical_runtime_seed.zip',runtime)
 for method in ['before','after']:
  command=[sys.executable]
  if method=='before':
   command+=['-c',"import runpy,sys;sys.path.insert(0,'script/asset_history/backfill');import asset_minutes;asset_minutes.install=lambda module:lambda:None;sys.argv=['script/asset_history/backfill/league_player_values.py']+sys.argv[1:];runpy.run_path(sys.argv[0],run_name='__main__')"]
  else:command+=['script/asset_history/backfill/league_player_values.py']
  command+=['--canonical',str(runtime),'--skill-dir',str(runtime/'monthly_reconstruction/skill'),'--team','UTA','--through','2022-04-30','--output',str(work/method),'--uniform-contracts','--agreements',str(repo/'processed/asset_history/contracts/contract_agreements.json'),'--contract-adjustments',str(repo/'processed/asset_history/contracts/contract_adjustments.json')]
  with(work/(method+'.log')).open('w')as f:subprocess.run(command,cwd=repo,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)
 a=pd.read_csv(work/'before/UTA/monthly_player_values.csv');b=pd.read_csv(work/'after/UTA/monthly_player_values.csv')
 keys=['cutoff_date','player_name'];field='app_style_four_year_asset_quote_with_draft_prior'
 both=a.merge(b,on=keys,suffixes=('_before','_after'),validate='one_to_one')
 for k in ['healthy_current_total','contract_schedule_signature']:
  if k+'_before' in both:assert both[k+'_before'].fillna('').equals(both[k+'_after'].fillna('')),k
 valid=both[both[field+'_before'].notna()&both[field+'_after'].notna()].copy()
 valid['change']=valid[field+'_after']-valid[field+'_before']
 result={'scope':'Utah same-source canonical four-year asset quotes; December 2021 through April 2022. Source ratings and contract inputs are identical between runs. This is not a fixed-rating time-series volatility estimate or a complete league/endpoint-scenario validation.',
 'paired_quotes':len(valid),'changed_quotes':int((abs(valid.change)>.01).sum()),'mean_absolute_dollar_change':float(abs(valid.change).mean()),'max_absolute_dollar_change':float(abs(valid.change).max()),
 'examples':valid.loc[abs(valid.change).nlargest(5).index,keys+[field+'_before',field+'_after','change']].to_dict('records')}
 if not result['changed_quotes']:raise ValueError('No downstream asset-dollar response to the role method')
 (work/'asset_minutes_comparison.json').write_text(json.dumps(result,indent=2,allow_nan=False));print(json.dumps(result),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--work',type=Path,required=True);a=p.parse_args();a.work.mkdir(parents=True,exist_ok=True);run(a.repo.resolve(),a.work.resolve())
