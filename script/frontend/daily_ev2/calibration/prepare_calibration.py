"""Bind deterministic calibration and existing injury merge to prepared native inputs."""
import argparse,json
from pathlib import Path
from build_fixed import compute,seed,sha,read,need
from merge_injuries import merge
MODEL='fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f'
def run(a):
 need(not a.out.exists(),'Fresh output directory required')
 need(sha(a.prepared_receipt)==a.prepared_receipt_sha256,'Prepared receipt changed')
 p=read(a.prepared_receipt);need(p['asof']==a.asof and p['model_sha256']==MODEL and p.get('extension_executed')is True,'Wrong/incomplete prepared inputs')
 need(sha(a.seed_inventory)==a.seed_inventory_sha256,'Reviewed seed inventory changed')
 need(sha(a.prior_episodes)==a.prior_episodes_sha256,'Prior injury checkpoint changed')
 need(sha(a.base_injuries)==a.base_injuries_sha256,'Saved injury terms changed')
 need(sha(a.runtime/'sparse_role_models.json')==MODEL,'Fixed coefficient bytes changed')
 before={str(f):sha(f)for f in [a.prepared_receipt,a.seed_inventory,a.prior_episodes,a.base_injuries]}
 for m in p['sources'].values():need(sha(Path(m['path']))==m['sha256'],'Prepared source changed')
 a.out.mkdir(parents=True)
 compute(a.repo,a.runtime,read(a.seed_inventory),a.asof,a.out/'calibration.json')
 injury=merge(a.repo,a.runtime,a.prior_episodes,a.base_injuries,a.asof,a.out/'injuries')
 need(all(sha(Path(f))==h for f,h in before.items()),'Input changed during preparation')
 r={'schema':'nba-daily-native-calibration-v1','asof':a.asof,'model_sha256':MODEL,'source_preparation_receipt_sha256':a.prepared_receipt_sha256,'calibration_sha256':sha(a.out/'calibration.json'),'injuries_sha256':injury['injuries_sha256'],'injuries_asof':a.asof,'reviewed':a.reviewed,'seed_inventory_sha256':a.seed_inventory_sha256,'prior_asof':read(a.seed_inventory)['prior_asof'],'inputs':before,'fixed_parameters_only':True,'fit_invocations':0,'provider_calls':0,'production':False}
 (a.out/'calibration_receipt.json').write_text(json.dumps(r,indent=2));return r
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['repo','runtime','prepared-receipt','seed-inventory','prior-episodes','base-injuries','out']:p.add_argument('--'+k,type=lambda s:Path(s).resolve(),required=True)
 for k in ['asof','prepared-receipt-sha256','seed-inventory-sha256','prior-episodes-sha256','base-injuries-sha256']:p.add_argument('--'+k,required=True)
 p.add_argument('--reviewed',action='store_true',help='Only after control/code and input provenance review; default cannot pass native gate')
 print(json.dumps(run(p.parse_args())))
