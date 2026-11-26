"""Store bulky JSON compactly in git; serve ordinary JSON to the browser."""
import argparse,gzip
from pathlib import Path
from model_version import data_root

def sources(repo):
    return [*(repo/'frontend/public/data/asset_history').glob('v*/teams/*.json.gz'),*(repo/'frontend/public/data/asset_history').glob('v*/draft_class_results.json.gz'),repo/'processed/asset_history/contracts/contract_agreements.json.gz',repo/'frontend/public/data/draft_class_results.json.gz']

def ensure_synced(repo):
    manifest = repo / 'script' / 'artifact_manifest.json'
    if not manifest.is_file():
        return
    import sys
    script_dir = str(repo / 'script')
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)
    import sync_artifacts
    sync_artifacts.sync(
        repo,
        manifest,
        only=['asset-history-v15', 'asset-history-v16', 'rolling-pricing-v16', 'runtime-seed'],
    )

def materialize(repo):
    ensure_synced(repo)
    count=0
    for source in sources(repo):
        if not source.exists():continue
        target=source.with_suffix('');data=gzip.decompress(source.read_bytes())
        if not target.exists()or target.read_bytes()!=data:target.write_bytes(data)
        count+=1
    return count

def compact(repo):
    paths=[*(data_root(repo)/'teams').glob('*.json'),repo/'processed/asset_history/contracts/contract_agreements.json']
    for target in paths:
        if target.exists():target.with_suffix(target.suffix+'.gz').write_bytes(gzip.compress(target.read_bytes(),compresslevel=6,mtime=0))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--compact',action='store_true');a=p.parse_args()
    if a.compact:compact(a.repo.resolve())
    else:print('Materialized asset-history inputs:',materialize(a.repo.resolve()))
