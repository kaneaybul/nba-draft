"""Freeze reproducible candidate inputs from a checked-out NBA repository."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path


def export(repo,output):
    output.mkdir(parents=True,exist_ok=True)
    mapping={
        'trained_pick_model.json':'processed/asset_history/picks/trained_pick_model.json',
        'contract_agreements.json':'processed/asset_history/contracts/contract_agreements.json.gz',
        'contract_adjustments.json':'processed/asset_history/contracts/contract_adjustments.json',
        'bref_player_seasons.csv':'raw/bref_player_seasons.csv',
        'salary_cap_assumptions.csv':'processed/livedata/impactrefresh/salary_cap_assumptions.csv',
        'manifest.json':'frontend/public/data/asset_history/v2/manifest.json'}
    for team in 'ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split():
        mapping[team+'.json']=f'frontend/public/data/asset_history/v2/teams/{team}.json.gz'
    provenance=[]
    for name,relative in mapping.items():
        data=(repo/relative).read_bytes()
        provenance.append(dict(path=relative,sha256=hashlib.sha256(data).hexdigest()))
        if relative.endswith('.gz'):
            data=gzip.decompress(data)
        (output/name).write_bytes(data)
    (output/'input_hashes.json').write_text(json.dumps(provenance,indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True);a=p.parse_args();export(a.repo,a.out)
