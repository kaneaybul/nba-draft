"""Reuse identical canonical annual projections during method-only rebuilds.

Path calibration and attribution are rerun. A checkpoint requires matching raw
runtime inputs, producer code, dated repo inputs, observation date, and every
saved output digest. It is never used for ordinary incremental daily refreshes.
"""
import hashlib,json,shutil
from pathlib import Path
FILES=('league_player_coverage.json','monthly_player_values.csv','monthly_annual_values.csv')

def digest(path):
    with path.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()

def signature(repo,runtime,injuries,asof):
    files={p for p in runtime.rglob('*')if p.is_file()and '__pycache__'not in p.parts and p.suffix!='.pyc'}
    patterns=('raw/live/*.json','processed/livedata/impactrefresh/salary_cap_assumptions.csv',
        'processed/asset_history/contracts/contract_agreements.json','processed/asset_history/contracts/contract_adjustments.json',
        'processed/asset_history/injuries/*.json','frontend/public/data/v2/team_schedules/*.json',
        'script/asset_history/backfill/*.py','script/asset_history/quote_window.py')
    records=[('runtime/'+str(p.relative_to(runtime)),digest(p))for p in sorted(files)]
    for pattern in patterns:
        records.extend(('repo/'+str(p.relative_to(repo)),digest(p))for p in sorted(repo.glob(pattern))if not p.name.startswith('test_'))
    records.append(('injuries',digest(injuries)))
    return hashlib.sha256(json.dumps([asof,records],separators=(',',':')).encode()).hexdigest()

def reuse(cache,output,state,teams,expected):
    manifest=cache/'manifest.json'
    if not manifest.exists():return False
    saved=json.loads(manifest.read_text())
    if saved.get('signature')!=expected or saved.get('teams')!=list(teams):return False
    required=[f'{t}/{name}'for t in teams for name in FILES]+[f'states/{t}.json'for t in teams]
    if set(saved.get('files',{}))!=set(required):return False
    if any(not(cache/name).is_file()or digest(cache/name)!=saved['files'][name]for name in required):return False
    for team in teams:
        (output/team).mkdir(exist_ok=True,parents=True)
        for name in FILES:shutil.copyfile(cache/team/name,output/team/name)
        shutil.copyfile(cache/'states'/f'{team}.json',state/f'{team}.json')
    return True

def save(cache,output,state,teams,expected):
    if cache.exists():shutil.rmtree(cache)
    (cache/'states').mkdir(parents=True)
    files={}
    for team in teams:
        (cache/team).mkdir()
        for name in FILES:
            target=cache/team/name;shutil.copyfile(output/team/name,target);files[str(target.relative_to(cache))]=digest(target)
        target=cache/'states'/f'{team}.json';shutil.copyfile(state/f'{team}.json',target);files[str(target.relative_to(cache))]=digest(target)
    (cache/'manifest.json').write_text(json.dumps(dict(signature=expected,teams=list(teams),files=files),separators=(',',':')))
