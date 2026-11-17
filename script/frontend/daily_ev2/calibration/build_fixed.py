"""One-date deterministic continuation of released league calibration; no fitting."""
import argparse,hashlib,json,math,sys
from pathlib import Path
from datetime import date

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def need(ok,msg):
 if not ok:raise ValueError(msg)
def clean(v):
 if isinstance(v,dict):return {str(k):clean(x)for k,x in v.items()}
 if isinstance(v,(list,tuple)):return [clean(x)for x in v]
 if hasattr(v,'item'):return clean(v.item())
 if isinstance(v,float)and not math.isfinite(v):return None
 return v

def seed(cal,inventory,asof):
 import numpy as np
 rows=inventory['files'];need(bool(rows),'No reviewed calibration seed files');seen=set()
 for entry in sorted(rows,key=lambda r:r['asof']):
  dt=entry['asof'];need(dt<asof and dt not in seen,'Future/duplicate calibration seed');seen.add(dt)
  p=Path(entry['path']);need(sha(p)==entry['sha256'],'Calibration seed changed');saved=read(p)
  need(set(saved['calibration'])=={dt},'Seed cutoff mismatch');v=saved['calibration'][dt]
  cal.previous={'date':date.fromisoformat(dt),'levels':v['levels'],'league_timin':v['league_timin']}
  for row in saved['positions']:
   need(row['cutoff_date']==dt,'Seed usage date mismatch')
   ident=int(row['nba_id'])if row.get('nba_id')is not None else row['player_key']
   cal.position_state[ident]={'date':date.fromisoformat(dt),'shares':np.array([row[k]for k in ('pg_share','sg_share','sf_share','pf_share','c_share')])}
 need(max(seen)==inventory['prior_asof'],'Seed does not end at prior checkpoint')

def compute(repo,runtime,inventory,asof,out):
 need(not out.exists(),'Fresh calibration path required')
 sys.path[:0]=[str(repo/'script/asset_history'),str(repo/'script/asset_history/backfill'),str(runtime/'monthly_reconstruction/projections')]
 import integrate_monthly as model
 from adaptive_calibration import AdaptiveCalibration
 from calibration_cache import source_signature
 need(Path(model.__file__).resolve().is_relative_to(runtime),'Wrong imported runtime; fresh process required')
 src=model.Inputs();cal=AdaptiveCalibration(src);seed(cal,inventory,asof)
 need(asof in src.pairs and asof in cal.progress,'Missing dated league source panel')
 dt=date.fromisoformat(asof);year=dt.year+(dt.month>=7);completed=max(y for y,end in src.reg_end.items()if end<=dt)
 cal.at(asof,year,completed)
 result=clean({'input_sha256':source_signature(runtime,runtime/'monthly_reconstruction/skill'),'calibration':cal.results,'rows':cal.rows,'positions':cal.position_rows})
 out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,allow_nan=False))
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ('repo','runtime','seed-inventory','out'):p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--seed-inventory-sha256',required=True);p.add_argument('--asof',required=True);a=p.parse_args();need(sha(a.seed_inventory)==a.seed_inventory_sha256,'Reviewed seed inventory changed');compute(a.repo.resolve(),a.runtime.resolve(),read(a.seed_inventory),a.asof,a.out.resolve())
