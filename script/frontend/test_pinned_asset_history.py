#!/usr/bin/env python3
"""Validate independent published history in an isolated test-only public root."""
import argparse,hashlib,json,os,pathlib,subprocess,tempfile
from rehydrate_protected_static import restore
PINNED_POLICY_SHA256='9b9e51049acea4077acf1ca3d6b547073ccedd0fe6d67655d6e011a812d54e37'
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
PATHS={'data/asset_history_release.json','data/asset_history/v20/manifest.json',*[f'data/asset_history/v20/attribution/{t}.json' for t in TEAMS]}
def prepare(policy_path,output,fetch=None):
 raw=pathlib.Path(policy_path).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=PINNED_POLICY_SHA256:raise ValueError('Unreviewed history test policy')
 policy=json.loads(raw)
 if policy['history_version']!='v20':raise ValueError('Wrong protected history version')
 protected=policy['protected_files']
 if not PATHS<=protected.keys():raise ValueError('Incomplete chart test policy')
 subset=dict(policy,protected_files={p:protected[p] for p in sorted(PATHS)})
 # Only the verified subset is ever materialized; original policy hash stays mandatory.
 with tempfile.TemporaryDirectory(prefix='history-test-policy-') as t:
  p=pathlib.Path(t)/'policy.json';b=json.dumps(subset,sort_keys=True).encode();p.write_bytes(b)
  kwargs={} if fetch is None else {'fetch':fetch}
  receipt=restore(output,p,hashlib.sha256(b).hexdigest(),None,**kwargs)
 receipt['original_policy_sha256']=PINNED_POLICY_SHA256
 return receipt

def main():
 a=argparse.ArgumentParser();a.add_argument('--repo',default='.');a.add_argument('--policy',required=True);x=a.parse_args();repo=pathlib.Path(x.repo).resolve()
 with tempfile.TemporaryDirectory(prefix='nba-history-test-') as t:
  public=pathlib.Path(t)/'public';receipt=prepare(x.policy,public)
  env=dict(os.environ,ASSET_HISTORY_FRONTEND=str(repo/'frontend'),ASSET_HISTORY_PUBLIC=str(public))
  subprocess.run(['node',str(repo/'script/frontend/test_asset_history_visuals.mjs'),'--require-published'],cwd=repo,env=env,check=True)
  print(json.dumps({'passed':True,'scope':'Isolated published-history test; no checkout data or production writes','restoration':receipt}))
if __name__=='__main__':main()
