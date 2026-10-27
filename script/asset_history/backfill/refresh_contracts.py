"""Refresh newly transacted players immediately and rotate remaining source checks.

The repository's parsed agreement seed is sufficient: downloading every raw page
again on each CI runner is unnecessary. Failed refreshes retain prior schedules
and remain pending; the snapshot coverage gate decides whether they can publish.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from contracts import fetch_one, option_adjustments
from fetch_name_contract_gaps import PROFILE_SOURCE_SLUGS


def key(name):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', name).encode('ascii','ignore').decode().lower())


def atomic_json(path, value):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n');temp.replace(path)


def source_identity(row, profiles=None):
    """A source profile is a contract key when an NBA identifier is unavailable."""
    name=row.get('player_name',row.get('name',''))
    profile=row.get('realgm_profile')or row.get('realgm_url')or row.get('url')or''
    if '/player/'not in profile:profile=''
    if not profile and profiles:
        candidates=profiles.get(key(name),set())
        if len(candidates)==1:profile=next(iter(candidates))
    pid=row.get('nba_id')
    match=re.search(r'/Summary/(\d+)',profile)
    if pid is None and match:pid=-9000000000-int(match.group(1))
    if pid is None:return None
    player=dict(nba_id=int(pid),player_name=name)
    if profile:player['realgm_profile']=profile
    if int(pid)<=-9000000000:
        player['identity_kind']='realgm_profile_source_id';player['nba_id_confirmed']=False
        if match and int(match.group(1))in PROFILE_SOURCE_SLUGS:
            player['source_url']='https://www.salaryswish.com/players/'+PROFILE_SOURCE_SLUGS[int(match.group(1))]
    return player


def current_players(pool,events,cutoff,last,roster_path=None):
    profiles={}
    for event in events:
        if event.get('date','')[:10]>cutoff:continue
        for row in event.get('players',[]):
            profile=row.get('realgm_profile')or row.get('realgm_url')or row.get('url')or''
            if '/player/'in profile:profiles.setdefault(key(row.get('name',row.get('player_name',''))),set()).add(profile)
    if roster_path:
        data=json.loads(Path(roster_path).read_text())
        if isinstance(data,dict):data=data.get('snapshots',[data])
        snapshot=next((s for s in data if s.get('cutoff_date',s.get('asof_date'))==cutoff),None)
        if snapshot is None:raise ValueError('Current ownership replay must contain the requested contract cutoff')
        rows=snapshot.get('roster',snapshot.get('roster_and_rights',[]))
        rows=[r for r in rows if not r.get('draft_rights')and r.get('asset_type')not in('unsigned_draft_right','dormant_draft_right','dormant_retention_right')]
        origin='dated_ownership_replay'
    else:
        rows=[r for r in pool['players']if r.get('pool_status')=='roster'and r.get('team')not in(None,'FA')and not r.get('inactive_confirmed')]
        origin='live_pool_plus_recent_dated_signings'
    players={};unidentified=[]
    for row in rows:
        player=source_identity(row,profiles)
        if player:players[player['nba_id']]=player
        else:unidentified.append(row.get('player_name',row.get('name')))
    # An explicitly replayed roster already incorporates additions and removals.
    # The fallback still discovers signings absent from the ESPN player pool.
    if not roster_path:
        for event in sorted(events,key=lambda e:(e.get('date',''),e.get('event_id',''))):
            if not last<=event.get('date','')[:10]<=cutoff:continue
            for action in event.get('parsed_actions',[]):
                player=source_identity(action,profiles)
                if not player:continue
                if action.get('action')=='add'and action.get('to_team')and not action.get('draft_rights'):
                    players[player['nba_id']]=player
                elif action.get('action')=='remove':players.pop(player['nba_id'],None)
    return players,dict(ownership_source=origin,owned_source_identities=len(players),unidentified_owned_players=sorted(set(unidentified)))


def refresh(contracts_dir, pool_path, events_path, cutoff, rotation_limit=20, workers=2,roster_path=None):
    contracts_dir.mkdir(parents=True, exist_ok=True)
    raw=contracts_dir/'raw';raw.mkdir(exist_ok=True)
    agreement_path=contracts_dir/'contract_agreements.json'
    agreements=json.loads(agreement_path.read_text())
    pool=json.loads(pool_path.read_text())
    if str(pool.get('generated_at',''))[:10]>cutoff:raise ValueError('Future player pool cannot establish earlier contract knowledge')
    events=json.loads(events_path.read_text()) if events_path else []
    if isinstance(events,dict):events=events.get('events',[])
    state_path=contracts_dir/'refresh_state.json'
    state=json.loads(state_path.read_text())if state_path.exists()else{}
    last=state.get('ledger_asof',cutoff)
    last_checked=state.get('last_checked',{})
    players,discovery=current_players(pool,events,cutoff,last,roster_path)
    # The previous parsed seed records canonical aliases and disambiguated URLs.
    # Reuse them when CI has no raw HTML cache (e.g. Jaylin Williams vs Williams2).
    for agreement in sorted(agreements,key=lambda a:a['known_from']):
        pid=int(agreement['nba_id'])
        if pid in players and agreement['known_from']<=cutoff and agreement.get('source','').startswith('https://www.salaryswish.com/players/'):
            players[pid]['source_url']=agreement['source']
    byname={}
    for pid,row in players.items():byname.setdefault(key(row['player_name']),set()).add(pid)
    changed={key(r['player_name'])for r in pool.get('changes',[])if last<=r.get('date','')[:10]<=cutoff}
    changed_ids=set()
    for event in events:
        if not last<=event.get('date','')[:10]<=cutoff or event.get('type')=='G League':continue
        changed.update(key(p.get('name',p.get('player_name','')))for p in event.get('players',[]))
        for row in event.get('players',[])+event.get('parsed_actions',[]):
            player=source_identity(row)
            if player and player['nba_id']in players:changed_ids.add(player['nba_id'])
    sourced={int(a['nba_id'])for a in agreements if a['known_from']<=cutoff}
    unique_changed={next(iter(byname[n]))for n in changed if n in byname and len(byname[n])==1}
    mandatory={pid for pid in players if pid not in sourced}|unique_changed|changed_ids|set(map(int,state.get('pending_player_ids',[])))
    mandatory&=set(players)
    optional=sorted(set(players)-mandatory,key=lambda pid:(last_checked.get(str(pid),''),pid))[:rotation_limit]
    selected=sorted(mandatory)+optional
    results=[]
    source_ids={}
    aliases={}
    for agreement in agreements:
        pid=int(agreement['nba_id']);source_ids.setdefault(agreement.get('source'),set()).add(pid)
        entry=aliases.setdefault(pid,{'app_id_aliases':set(),'player_name_aliases':set()})
        for field in entry:entry[field].update(agreement.get(field,[]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers)as executor:
        for result in executor.map(lambda pid:fetch_one(players[pid],contracts_dir,True,raw,cutoff),selected):
            others=source_ids.get(result.get('url'),set())-{int(result['nba_id'])}
            if result.get('url')and result.get('identity_kind')=='realgm_profile_source_id'and others and int(result['nba_id'])not in source_ids.get(result.get('url'),set()):
                result['status']='identity_review_required';result['error']='Source URL belongs to a different established contract identity; a matching name does not establish the same person.';result['agreements']=[]
            for agreement in result.get('agreements',[]):
                for field in('identity_kind','nba_id_confirmed','realgm_profile'):
                    if field in result:agreement[field]=result[field]
                for field,values in aliases.get(int(result['nba_id']),{}).items():
                    if values:agreement[field]=sorted(set(agreement.get(field,[]))|values)
            results.append(result)
    successful={int(r['nba_id']):r for r in results if r['status']=='available'}
    merged=[a for a in agreements if int(a['nba_id'])not in successful]
    merged.extend(a for r in successful.values()for a in r['agreements'])
    # Primary-source supplements are preserved unless a real original table supersedes them.
    supplement_path=Path(__file__).with_name('supplemental_contract_agreements.json')
    supplements=json.loads(supplement_path.read_text())if supplement_path.exists()else[]
    existing={(a['nba_id'],a['known_from'])for a in merged}
    included_ids=set(players)|{int(a['nba_id'])for a in agreements}
    merged.extend(a for a in supplements if a['known_from']<=cutoff and int(a['nba_id'])in included_ids and(a['nba_id'],a['known_from'])not in existing)
    merged.sort(key=lambda a:(a['known_from'],a['nba_id']))
    failed=[int(r['nba_id'])for r in results if r['status']!='available']
    pending=sorted(mandatory-set(successful))
    for pid in successful:last_checked[str(pid)]=cutoff
    audit=dict(cutoff=cutoff,generated_at=datetime.now(timezone.utc).isoformat(),
        mandatory_player_ids=sorted(mandatory),rotation_players=len(optional),
        available_players=len(successful),pending_player_ids=pending,
        optional_source_failures=sorted(set(failed)-mandatory),
        failed_mandatory_player_ids=sorted(mandatory-set(successful)),
        all_original_agreements=len(merged),
        discovery=discovery,
        results=[{k:v for k,v in r.items()if k!='agreements'}for r in results],
        method='Dated transaction refresh plus oldest-check rotation; failures retain prior source schedules and retry.')
    atomic_json(agreement_path,merged);atomic_json(contracts_dir/'contract_adjustments.json',option_adjustments(merged))
    atomic_json(state_path,dict(ledger_asof=cutoff,last_checked=last_checked,pending_player_ids=pending))
    atomic_json(contracts_dir/'refresh_audit.json',audit)
    return audit


def main():
    p=argparse.ArgumentParser();p.add_argument('--contracts',type=Path,required=True);p.add_argument('--live-pool',type=Path,required=True)
    p.add_argument('--events',type=Path);p.add_argument('--roster',type=Path);p.add_argument('--date',default=date.today().isoformat());p.add_argument('--rotation-limit',type=int,default=20);p.add_argument('--workers',type=int,default=2)
    a=p.parse_args();report=refresh(a.contracts,a.live_pool,a.events,a.date,a.rotation_limit,a.workers,a.roster)
    print(json.dumps({k:v for k,v in report.items()if k!='results'}))
    if report['failed_mandatory_player_ids']or report['discovery']['unidentified_owned_players']:raise SystemExit('New/changed contracts or owned identities remain unverified; retain last good snapshot')

if __name__=='__main__':main()
