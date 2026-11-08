#!/usr/bin/env python3
"""Resolve signed ownership before exporting projections; retain saved terms."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'script/asset_history'))
sys.path.insert(0,str(ROOT/'script/asset_history/backfill'))
sys.path.insert(0,str(ROOT/'script/frontend'))
from materialize import materialize
from run_player_refresh import unpack
from ownership_runtime import refresh_events,replay,restore_events
from espn_ownership import capture_additions
from build_shared_contracts import build,write

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,default=ROOT)
parser.add_argument('--work-dir',type=Path,required=True)
args=parser.parse_args()
repo=args.repo.resolve()
pool=json.loads((repo/'raw/live/player_pool.json').read_text())
asof=pool['generated_at'][:10]
runtime=args.work_dir.resolve()/'runtime'
materialize(repo)
unpack(repo/'processed/asset_history/canonical_runtime_seed.zip',runtime)
restore_events(runtime,repo/'processed/asset_history/player_state')
source=refresh_events(runtime,asof,repo=repo)
roster_path=runtime/'monthly_reconstruction/league_ownership/monthly_league_rosters.json'
dates={s['cutoff_date'] for s in json.loads(roster_path.read_text())}|{asof}
_,audit=replay(runtime,dates)
if source.get('mode')=='espn_dated_fallback' and capture_additions(runtime,pool,asof):
    _,audit=replay(runtime,dates)
if audit.get('unresolved_events'):
    raise ValueError('Unresolved signed ownership; retain the last successful release')
capture={'date':asof,'roster':json.loads(roster_path.read_text())}
write(repo,build(repo,capture=capture))
print('Signed ownership prepared before projections; saved contract terms preserved.')
