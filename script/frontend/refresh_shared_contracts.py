"""Refresh every roster agreement, then publish a complete shared salary book."""
import argparse,gzip,json
from pathlib import Path
from build_shared_contracts import ROOT,read_json,build,write
from refresh_contracts import refresh

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,default=ROOT);args=parser.parse_args();repo=args.repo.resolve()
    directory=repo/'processed/asset_history/contracts'
    plain=directory/'contract_agreements.json'
    if not plain.exists():plain.write_text(json.dumps(read_json(plain)))
    capture=read_json(repo/'processed/asset_history/player_state/latest_inputs.json')
    pool=read_json(repo/'raw/live/player_pool.json');day=pool['generated_at'][:10]
    if capture['date']!=day:raise ValueError('Refresh the dated ownership capture before a full contract refresh; its observation date must match the current roster date')
    import tempfile
    with tempfile.TemporaryDirectory()as scratch:
        scratch=Path(scratch);roster=scratch/'roster.json';events=scratch/'events.json'
        rows=capture['roster'][0]['roster'];ids={r.get('nba_id')for r in rows}
        rows=rows+[dict(nba_id=p['nba_id'],player_name=p['player_name'],team=p['team'],draft_rights=False)
            for p in pool['players']if p.get('pool_status')=='roster'and p.get('nba_id')not in ids and p.get('nba_id')is not None]
        roster.write_text(json.dumps([dict(cutoff_date=day,roster=rows)]));events.write_text('[]')
        result=refresh(directory,repo/'raw/live/player_pool.json',events,day,rotation_limit=1000,workers=4,roster_path=roster)
        if result['failed_mandatory_player_ids']:raise ValueError('New contract terms remain unverified')
    write(repo,build(repo))
    plain.with_suffix('.json.gz').write_bytes(gzip.compress(plain.read_bytes(),mtime=0))
