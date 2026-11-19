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
from build_shared_contracts import build,read_json,write

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,default=ROOT)
parser.add_argument('--work-dir',type=Path,required=True)
parser.add_argument('--dated-receipt',type=Path,help='Optional new local receipt for a separately validated native source stage')
parser.add_argument('--official-transactions-start',help='Inclusive NBA.com movement check from prior verified coverage (YYYY-MM-DD)')
args=parser.parse_args()
repo=args.repo.resolve()
pool_path=repo/'raw/live/player_pool.json'
pool=json.loads(pool_path.read_text())
# Certified source bytes are immutable at this consumer boundary.
# Install reviewed mappings during normal collection, before its receipt.
sys.path.insert(0,str(repo/'script/data'))
from official_player_identity import require_collected_identities
require_collected_identities(repo,pool)
asof=pool['generated_at'][:10]
runtime=args.work_dir.resolve()/'runtime'
materialize(repo)
unpack(repo/'processed/asset_history/canonical_runtime_seed.zip',runtime)
restore_events(runtime,repo/'processed/asset_history/player_state')
source=refresh_events(runtime,asof,repo=repo)
if args.official_transactions_start:
    from official_nba_transactions import refresh as add_official_movements
    add_official_movements(runtime,asof,start=args.official_transactions_start)
    source=json.loads((runtime/'monthly_reconstruction/league_ownership/roster_refresh_source.json').read_text())
roster_path=runtime/'monthly_reconstruction/league_ownership/monthly_league_rosters.json'
dates={s['cutoff_date'] for s in json.loads(roster_path.read_text())}|{asof}
_,audit=replay(runtime,dates)
if source.get('mode')=='espn_dated_fallback' and capture_additions(runtime,pool,asof):
    _,audit=replay(runtime,dates)
if audit.get('unresolved_events'):
    raise ValueError('Unresolved signed ownership; retain the last successful release')
capture={'date':asof,'roster':json.loads(roster_path.read_text())}
events_path=roster_path.with_name('league_events.json')
events=json.loads(events_path.read_text())
# A dated transaction can establish ownership before salary terms arrive.
# A roster observation alone is not independent confirmation of a signing.
confirmed={e['event_id'] for e in events if e.get('source') and not e.get('roster_capture')}
contracts=repo/'processed/asset_history/contracts'
saved=read_json(contracts/'contract_agreements.json')
cache=repo/'processed/contracts/reconciled_recent_agreements.json'
recent=read_json(cache) if cache.exists() else []
if not isinstance(recent,list):
    raise ValueError('Malformed reviewed recent contract cache')
def current_book(terms):
    return build(repo,agreements=saved+terms,capture=capture,confirmed_transactions=confirmed)
book=current_book(recent)
if book['contract_pending']:
    from recheck_pending_contracts import recheck
    # Verified NBA profile bridge for a player whose old provider profile may
    # not be in this checkout. Keep identity evidence private to the lookup.
    verified_profiles={1643572:('2003-03-30','https://www.nba.com/player/1643572/rafael-castro')}
    lookup=[]
    for row in book['contract_pending']:
        profile=verified_profiles.get(row['nba_id'])
        lookup.append({**row,'verified_official_birthdate':profile[0],
            'official_identity_source':profile[1]} if profile else row)
    checked=recheck(lookup,saved+recent,asof,repo=repo)
    additions=checked['reviewed_additions']
    if additions:
        recent=recent+additions
        candidate=current_book(recent)
        resolved={r['nba_id'] for r in book['contract_pending']}-{r['nba_id'] for r in candidate['contract_pending']}
        if resolved!={int(a['nba_id']) for a in additions}:
            raise ValueError('Rechecked terms did not match the confirmed pending signings')
        book=candidate
        cache.parent.mkdir(parents=True,exist_ok=True)
        temp=cache.with_suffix('.tmp')
        temp.write_text(json.dumps(recent,separators=(',',':'),allow_nan=False)+'\n')
        temp.replace(cache)
write(repo,book)
if args.dated_receipt is not None:
    from dated_source_receipts import make_ownership_receipt
    make_ownership_receipt(args.dated_receipt,roster_path,roster_path.with_name('roster_refresh_source.json'),
        repo/'processed/contracts/current.json',asof,int(pool['season']),
        native_terms={key:contracts/(key+'.json') for key in ('contract_agreements','contract_adjustments')},
        ownership_events=events_path,recent_contract_terms=cache if recent else None)
print('Signed ownership prepared; pending terms excluded from pricing:',len(book['contract_pending']))

