#!/usr/bin/env python3
"""Package the active static release without unused historical method copies."""
import argparse
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--dist', type=Path, default=Path('frontend/dist'))
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
dist = args.dist.resolve()
version = json.loads((dist/'data/asset_valuation.json').read_text())['history_version']
if not version.startswith('v') or not version[1:].isdigit():
    raise ValueError('Invalid active asset-history version')
files = []
for p in sorted(dist.rglob('*')):
    if not p.is_file():
        continue
    relative = p.relative_to(dist)
    parts = relative.parts
    if len(parts) > 2 and parts[:2] in [('data','asset_history'),('data','asset_valuations')] and parts[2] != version:
        continue
    if p.name.endswith('.json.gz'):
        continue
    if p.stat().st_size > 25 * 1024 * 1024:
        raise ValueError(f'Asset exceeds the Pages limit: {relative}')
    files.append((p, relative.as_posix()))
names = {name for _,name in files}
required = {'index.html','data/manifest.json','data/asset_valuation.json',
            f'data/asset_history/{version}/manifest.json',
            f'data/asset_history/{version}/refresh_status.json'}
if not required <= names or len(files) > 20000:
    raise ValueError('Incomplete static release')
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for p,name in files:
        archive.write(p,name)
print(json.dumps({'version':version,'files':len(files),'zip_bytes':args.output.stat().st_size,'output':str(args.output.resolve())}))
