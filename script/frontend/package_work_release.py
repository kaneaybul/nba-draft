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
metadata = json.loads((dist/'data/asset_valuation.json').read_text())
version = metadata['history_version']
history = metadata.get('asset_history_version', version)
if any(not isinstance(v, str) or not v.startswith('v') or not v[1:].isdigit() for v in (version, history)):
    raise ValueError('Invalid active asset-history version')
files = []
for p in sorted(dist.rglob('*')):
    if not p.is_file():
        continue
    relative = p.relative_to(dist)
    parts = relative.parts
    if len(parts) > 2 and parts[:2] == ('data','asset_history') and parts[2] not in {version, history}:
        continue
    if len(parts) > 2 and parts[:2] == ('data','asset_valuations') and parts[2] != version:
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
if history != version:
    required.add(f'data/asset_history/{history}/manifest.json')
    required.add('data/draft_class_results.json')
    active = json.loads((dist/f'data/asset_history/{history}/manifest.json').read_text())
    teams = {row['team'] for row in active['teams']}
    if len(teams) != 30:
        raise ValueError('Incomplete active Asset History team list')
    required.update(f'data/asset_history/{history}/{kind}/{team}.json' for kind in ('teams','attribution') for team in teams)
if not required <= names or len(files) > 20000:
    raise ValueError('Incomplete static release')
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for p,name in files:
        archive.write(p,name)
print(json.dumps({'version':version,'asset_history_version':history,'files':len(files),'zip_bytes':args.output.stat().st_size,'output':str(args.output.resolve())}))
