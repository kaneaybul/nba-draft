"""Compatibility entry point for the complete methodology rebuild.

A versioned method change must refit labels and replay player paths. Replacing
production means inside existing snapshots cannot implement this methodology.
"""
import argparse,json
from pathlib import Path
from types import SimpleNamespace
from model_version import data_root
from refresh import main
from validate_attribution import validate

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--runtime',type=Path,required=True);a=p.parse_args()
    repo=a.repo.resolve()
    if not(data_root(repo)/'manifest.json').exists():
        main(SimpleNamespace(repo=repo,work_dir=a.runtime.resolve().parent,reseed=True,
            allow_reconstructed=True,use_published_inputs=True,preserve_unsupported=True,draws=10000))
    print(json.dumps(validate(repo)))
