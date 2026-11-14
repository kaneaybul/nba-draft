"""Restore captured historical panels at their actual observation dates."""
import base64,gzip,hashlib,json,tempfile
from pathlib import Path

def restore_archived_inputs(runtime,repo,asof,restore):
    root=repo/'processed/asset_history/player_state/archived_inputs'
    manifest=root/'manifest.json'
    if not manifest.exists():return []
    restored=[]
    for entry in json.loads(manifest.read_text())['captures']:
        if entry['date']>asof:continue
        name=entry['file']
        if Path(name).name!=name:raise ValueError('Unsafe archived panel name')
        raw=base64.b64decode(''.join((root/name).read_text().split()),validate=True)
        if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Archived panel digest mismatch')
        payload=json.loads(gzip.decompress(raw))
        if payload.get('date')!=entry['date']:raise ValueError('Archived panel date mismatch')
        if not payload.get('roster')or not payload.get('coverage'):raise ValueError('Incomplete archived panel')
        with tempfile.TemporaryDirectory()as folder:
            state=Path(folder);(state/'latest_inputs.json.gz').write_bytes(raw)
            restore(runtime,state,results_path=repo/'raw/live/results.json')
        restored.append(entry['date'])
    return restored
