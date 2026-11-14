"""Versioned, digest-checked hidden pricing contexts kept out of browser data."""
import json,gzip,hashlib
from pathlib import Path
from collections import defaultdict

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def digest(v):return hashlib.sha256(canonical(v)).hexdigest()
def root(repo):
 from model_version import DATA_VERSION
 return Path(repo)/'processed/asset_history/rolling_pricing'/DATA_VERSION

def detach(repo,snapshots):
 by=defaultdict(list)
 for s in snapshots:by[s['team']].append(s)
 for team,rows in by.items():
  file=root(repo)/(team+'.json.gz')
  if file.exists():
   with gzip.open(file,'rt')as f:store=json.load(f)
  else:store={}
  for s in rows:
   for a in s['assets']:
    d=a.get('details',{});impact=d.get('rolling_impact')
    if impact is None:
     if d.get('rolling_pricing_ref')and d['rolling_pricing_ref']not in store:raise ValueError('Missing retained rolling pricing reference '+team)
     continue
    payload={'rolling_impact':impact};scenarios=d.get('path_calibration',{}).get('frozen_pricing_scenarios')
    if scenarios is not None:payload['frozen_pricing_scenarios']=scenarios
    ref=digest(payload);store[ref]=payload;d['rolling_pricing_ref']=ref
    d.pop('rolling_impact',None);d.get('path_calibration',{}).pop('frozen_pricing_scenarios',None);d.pop('impact_path_knots',None)
  file.parent.mkdir(parents=True,exist_ok=True);tmp=file.with_suffix('.tmp');tmp.write_bytes(gzip.compress(canonical(store),mtime=0));tmp.replace(file)
 return snapshots

def hydrate(repo,team,snapshots):
 refs=[a.get('details',{}).get('rolling_pricing_ref')for s in snapshots for a in s['assets']]
 if not any(refs):return snapshots
 file=root(repo)/(team+'.json.gz')
 if not file.exists():raise ValueError('Missing rolling pricing sidecar '+team)
 with gzip.open(file,'rt')as f:store=json.load(f)
 for s in snapshots:
  for a in s['assets']:
   d=a.get('details',{});ref=d.get('rolling_pricing_ref')
   if not ref:continue
   payload=store.get(ref)
   if payload is None or digest(payload)!=ref:raise ValueError('Missing or corrupt rolling pricing context '+team)
   d['rolling_impact']=payload['rolling_impact']
   if 'frozen_pricing_scenarios'in payload:d.setdefault('path_calibration',{})['frozen_pricing_scenarios']=payload['frozen_pricing_scenarios']
 return snapshots
