"""Dated ownership handoffs from immutable completed league checkpoints."""
import json,os
from pathlib import Path
from datetime import date
from owner_handoff import handoff

def install(src,canonical,team):
    root=os.environ.get('NBA_OWNER_PRIOR_BATCH')
    src.owner_team=team;src.owner_lineage='rolling-owner-v1'
    if not root:return
    root=Path(root);manifest=json.loads((root/'manifest.json').read_text())
    from live_runtime import fingerprint
    expected=fingerprint(canonical)
    if manifest['model_source_hashes']!=expected:raise ValueError('Owner checkpoint source mismatch')
    from rolling_export import decode_impact_cache
    from rolling_impact import ImpactPath
    from valuation_engine import AnnualState
    states={};clocks={};schedules={};monthly=canonical/'monthly_reconstruction'
    history=monthly/'daily_input_history.json';current=monthly/'daily_input_audit.json'
    panels=json.loads(history.read_text()) if history.exists()else []
    if current.exists():panels.append(json.loads(current.read_text()))
    for panel in panels:
        day=panel['date'];season=int(day[:4])+(int(day[5:7])>=7)
        for owner,completed in panel['completed_team_dates'].items():clocks[owner,day]=82*(season-2000)+min(82,len(completed))
    def owner_schedule(owner,season):
        key=(owner,season)
        if key in schedules:return schedules[key]
        raw=json.loads((canonical/f'app_model/schedule_{season}.json').read_text())
        ds=sorted(date.fromisoformat(r['date'])for r in raw if r.get('date')and r['season_type']=='Regular Season'and owner in(r['home_team'],r['away_team']))
        if owner!='UTA':
            complete=canonical/f'monthly_reconstruction/pick_forecasts/raw/nba_team_game_logs_{season}.json'
            league=canonical/f'app_model/league_schedule_{season}.json'
            if not league.exists():league=Path(__file__).resolve().parents[3]/f'processed/asset_history/team_schedule_{season}.json'
            if complete.exists():
                log=json.loads(complete.read_text())['resultSets'][0];records=[dict(zip(log['headers'],r))for r in log['rowSet']]
                ds=sorted(date.fromisoformat(r['GAME_DATE'][:10])for r in records if r['TEAM_ABBREVIATION']==owner)
            if(not complete.exists()or len(ds)!=82)and league.exists():
                full=json.loads(league.read_text())
                ds=sorted(date.fromisoformat(r['date'])for r in full if r.get('date')and r['season_type']=='Regular Season'and(r.get('selected_team')==owner if r.get('is_placeholder')else owner in(r['home_team'],r['away_team'])))
        if len(ds)!=82:raise ValueError(f'Incomplete donor schedule {owner} {season}')
        schedules[key]=ds;return ds
    def clock(owner,day):
        if(owner,day)in clocks:return clocks[owner,day]
        dt=date.fromisoformat(day);season=dt.year+(dt.month>=7)
        return 82*(season-2000)+min(82,sum(d<=dt for d in owner_schedule(owner,season)))
    def lookup(identity,day,local):
        record=manifest['owners'].get(str(identity))
        if record is None:return local
        owner=record['team']
        if owner==team:return local
        if owner not in states:
            data=json.loads((root/'states'/f'{owner}.json').read_text())
            states[owner]=decode_impact_cache(data['impact_state'],ImpactPath,AnnualState)
        prior=states[owner].get(identity)
        if prior is None:
            if record.get('has_impact'):raise ValueError('Authoritative owner impact state missing')
            return None
        from valuation_engine import project_path
        prior=dict(prior);path=prior['path'];annual=list(prior['states'])
        while path.knots[-1][0]<clock(owner,day):
            nxt=project_path(annual[-1],annual[:-1],1)[-1];annual.append(nxt);path=path.extend([nxt.total])
        prior.update(path=path,states=annual)
        moved,audit=handoff(prior,checkpoint_day=manifest['as_of'],refresh_day=day,previous_owner=owner,receiving_owner=team,owner_clock=clock,model_hashes=manifest['model_source_hashes'],expected_model_hashes=expected)
        moved['coordinate_offset']=prior.get('coordinate_offset',0.)+audit['clock_translation']
        moved['coordinate_lineage']=prior.get('coordinate_lineage',f'rolling-owner-v1:{identity}')
        moved['owner_handoff']=dict(audit,ownership_observed_day=day)
        return moved
    src.owner_impact_lookup=lookup
    endpoint_donors={}
    def endpoint_states(owner):
        if owner not in endpoint_donors:
            data=json.loads((root/'states'/f'{owner}.json').read_text())
            endpoint_donors[owner]=data['role_state'].get('endpoint_role_state')or{}
        return endpoint_donors[owner]
    def endpoint_lookup(pid,key,day,local):
        record=manifest['owners'].get(str(pid)) if pid is not None else None
        if record is not None:
            if record['team']==team:return local
            return endpoint_states(record['team']).get(key)
        # A player can leave active NBA service and later return elsewhere.
        # The active ownership manifest alone cannot identify their last state.
        # All prior team files retain historical overlays; pick the newest
        # record last updated by its own authoritative owner, not a stale copy.
        candidates=[]
        for path in sorted((root/'states').glob('*.json')):
            value=endpoint_states(path.stem).get(key)
            if value and value.get('last_owner')==path.stem:
                candidates.append(value)
        if not candidates:return local
        latest=max(v.get('last_asof','')for v in candidates)
        newest=[v for v in candidates if v.get('last_asof','')==latest]
        if len(newest)>1 and any(v!=newest[0]for v in newest[1:]):
            raise ValueError(f'Ambiguous endpoint reentry origin {key} {latest}')
        return newest[0]
    src.owner_endpoint_lookup=endpoint_lookup
