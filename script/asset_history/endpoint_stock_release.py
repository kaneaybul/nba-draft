"""Refit and replay a new method; reuse only matching calibration stocks."""
import argparse,gzip,hashlib,json,re,shutil,subprocess
from pathlib import Path
from types import SimpleNamespace
from model_version import DATA_VERSION,data_root
from refresh import main
from validate_attribution import validate


def calibration_changes(repo):
    with gzip.open(repo/'processed/asset_history/player_state/path_calibration.json.gz','rt')as f:cached=json.load(f)
    root=repo/'script/asset_history/calibration'
    names={'production.py','path_model.py','historical.py','run_backtest.py','endpoint_model.py','legacy_v4.py'}
    return [name for name,expected in cached['source_hashes']if name in names and
            hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected]


def release(repo,runtime,rebuild_unpublished=False):
    exists=(data_root(repo)/'manifest.json').exists()
    changed=calibration_changes(repo)if exists else []
    if changed:
        if not rebuild_unpublished:raise ValueError('Calibration source changed after the versioned rebuild: '+', '.join(changed))
        # A draft release can be rebuilt before merging. A version already on
        # main is preserved and requires a new version instead of being rewritten.
        subprocess.run(['git','fetch','origin','main','--depth=1'],cwd=repo,check=True)
        source=subprocess.check_output(['git','show','FETCH_HEAD:script/asset_history/model_version.py'],cwd=repo,text=True)
        published=re.search(r"DATA_VERSION\s*=\s*['\"]([^'\"]+)['\"]",source)
        if not published or published.group(1)==DATA_VERSION:
            raise ValueError('The current version is already published; use a new method version')
        shutil.rmtree(data_root(repo));exists=False
    if not exists:
        main(SimpleNamespace(repo=repo,work_dir=runtime.parent,reseed=True,
            allow_reconstructed=True,use_published_inputs=True,preserve_unsupported=True,draws=10000))
    else:
        from materialize import materialize,compact
        from attribution import run
        from source_signature import source_signature
        from publish import atomic
        materialize(repo);run(repo,runtime,workers=2)
        checks=validate(repo)
        path=data_root(repo)/'refresh_status.json';status=json.loads(path.read_text())
        status['source_signature']=source_signature(repo);atomic(path,status);compact(repo)
    return validate(repo)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--runtime',type=Path,required=True)
    p.add_argument('--rebuild-unpublished',action='store_true');a=p.parse_args()
    print(json.dumps(release(a.repo.resolve(),a.runtime.resolve(),a.rebuild_unpublished)))
