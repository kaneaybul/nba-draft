"""Identify already-published same-day inputs without skipping new evidence."""
import hashlib,json


def source_signature(repo):
    patterns=('raw/live/*.json','raw/bref_player_seasons.csv',
        'processed/livedata/impactrefresh/salary_cap_assumptions.csv',
        'processed/asset_history/picks/*.json','processed/asset_history/contracts/contract_agreements.json.gz',
        'processed/asset_history/contracts/contract_adjustments.json','processed/asset_history/injuries/*.json',
        'processed/asset_history/runtime_seed/manifest.json',
        'processed/asset_history/player_state/archived_inputs/*',
        'frontend/public/data/v2/team_schedules/*.json','frontend/public/data/v2/team_projections/*.json','frontend/public/data/v2/impact_players/*.json',
        'script/asset_history/*.py','script/asset_history/backfill/*.py','script/asset_history/calibration/*.py',
        'script/frontend/role_minutes_policy.json')
    files={p for pattern in patterns for p in repo.glob(pattern)if p.is_file()and not p.name.startswith('test_')}
    parts=[(str(p.relative_to(repo)),hashlib.sha256(p.read_bytes()).hexdigest())for p in sorted(files)]
    return hashlib.sha256(json.dumps(parts,separators=(',',':')).encode()).hexdigest()


