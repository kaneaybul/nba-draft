"""Store bulky JSON compactly in git; serve ordinary JSON to the browser."""
import argparse,gzip
from pathlib import Path

def sources(repo):
    return [*(repo/'frontend/public/data/asset_history/v2/teams').glob('*.json.gz'),repo/'processed/asset_history/contracts/contract_agreements.json.gz']

def materialize(repo):
    count=0
    for source in sources(repo):
        if not source.exists():continue
        target=source.with_suffix('');data=gzip.decompress(source.read_bytes())
        if not target.exists()or target.read_bytes()!=data:target.write_bytes(data)
        count+=1
    return count

def compact(repo):
    paths=[*(repo/'frontend/public/data/asset_history/v2/teams').glob('*.json'),repo/'processed/asset_history/contracts/contract_agreements.json']
    for target in paths:
        if target.exists():target.with_suffix(target.suffix+'.gz').write_bytes(gzip.compress(target.read_bytes(),compresslevel=6,mtime=0))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--compact',action='store_true');a=p.parse_args()
    if a.compact:compact(a.repo.resolve())
    else:print('Materialized asset-history inputs:',materialize(a.repo.resolve()))
