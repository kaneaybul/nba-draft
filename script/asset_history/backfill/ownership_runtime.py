"""Replay dated roster evidence with profile-resolved identities.

A current roster feed is supporting evidence; it cannot resurrect a player
after a dated waiver or replace a signed player with an unverified free agent.
"""
from __future__ import annotations
import importlib.util,json,sys,hashlib
from datetime import datetime,timezone
from pathlib import Path

ALIASES={
 'bjboston':1630527,'brandonboston':1630527,
 'ejharkless':1641989,'elijahharkless':1641989,
 'cameronchristie':1642353,'camchristie':1642353,
 'herbjones':1630529,'herbertjones':1630529,
 'kennylofton':1631254,'kennethlofton':1631254,
}

# Primary announcements omitted from the transaction-page prose. These are
# dated inventory facts, not inferences from later roster absence.
SUPPLEMENTAL_EVENTS=[
 {'date':'2024-07-08','event_id':'PRIMARY_GRAY_CHI_20240708','text':'Raiquan Gray was acquired by the Chicago Bulls.',
  'players':[{'name':'Raiquan Gray','nba_id':1630564,'realgm_url':'https://basketball.realgm.com/player/Raiquan-Gray/Summary/104922'}],
  'teams':[],'parsed_status':'simple_two_team_trade','parsed_actions':[],
  'source':'https://www.nba.com/news/2024-offseason-trade-tracker',
  'note':'NBA offseason tracker lists RaiQuan Gray from San Antonio in July8 three-team DeRozan transaction. Supplemental record captures only the reviewed player destination.'},
 {'date':'2026-05-12','event_id':'PRIMARY_CLARKE_20260512','text':'Brandon Clarke no longer has future NBA player service following the May12 public announcement of his passing.',
  'players':[{'name':'Brandon Clarke','nba_id':1629634,'realgm_url':'https://basketball.realgm.com/player/Brandon-Clarke/Summary/84518'}],
  'teams':[],'parsed_status':'waiver','parsed_actions':[{'player_name':'Brandon Clarke','nba_id':1629634,'action':'remove'}],
  'source':'https://pr.nba.com/adam-silver-statement-brandon-clarke/'}]

def restore_events(runtime,state):
    """Carry accepted dated facts forward, separately from the frozen seed."""
    root=runtime/'monthly_reconstruction/league_ownership'
    path=root/'league_events.json';events=json.loads(path.read_text())
    seed_ids={e['event_id']for e in events}
    (root/'ownership_seed_cutoff.json').write_text(json.dumps({'date':max(e['date']for e in events)}))
    saved=state/'ownership_events.json'
    if saved.exists():
        events.extend(e for e in json.loads(saved.read_text())if e['event_id']not in seed_ids)
        events.sort(key=lambda e:(e['date'],e['text']))
        path.write_text(json.dumps(events,indent=2))
    return seed_ids

def save_events(runtime,state,seed_ids):
    events=json.loads((runtime/'monthly_reconstruction/league_ownership/league_events.json').read_text())
    (state/'ownership_events.json').write_text(json.dumps([e for e in events if e['event_id']not in seed_ids],separators=(',',':')))

def replay(runtime,dates):
    root=runtime/'monthly_reconstruction/league_ownership'
    sys.path.insert(0,str(root))
    import source_inventory as source
    original=source.id_map
    ids=original();ids.update(ALIASES)
    events=json.loads((root/'league_events.json').read_text())
    # The fallback's verified NBA identities may be newer than the runtime seed.
    # Do not infer identity from a same-name player or overwrite a known conflict.
    for event in events:
        if event.get('identity_source')!='verified_live_player_pool':continue
        for player in event['players']:
            name=source.key(player['name']);pid=int(player['nba_id'])
            if name in ids and ids[name]!=pid:raise ValueError('Conflicting fallback player identity: '+player['name'])
            ids[name]=pid
    present={r['event_id']for r in events}
    events += [r for r in SUPPLEMENTAL_EVENTS if r['event_id']not in present]
    (root/'league_events.json').write_text(json.dumps(events,indent=2))
    profiles={}
    for event in events:
        for p in event['players']:
            pid=p.get('nba_id')or ids.get(source.key(p['name']))
            if pid and p.get('realgm_url'):profiles.setdefault(p['realgm_url'],set()).add(int(pid))
    conflicts={p:sorted(v)for p,v in profiles.items()if len(v)>1}
    if conflicts:raise ValueError('Conflicting NBA IDs for source profiles: '+str(conflicts))
    for event in events:
        for p in event['players']:
            known=profiles.get(p.get('realgm_url'))
            if known:ids[source.key(p['name'])]=next(iter(known))
    source.id_map=lambda:ids
    try:
        path=root/'replay_summer_ratings.py'
        spec=importlib.util.spec_from_file_location('asset_history_ownership_replay',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        snapshots,audit=module.replay(sorted(dates))
    finally:source.id_map=original
    for cutoff,rows in snapshots.items():
        owned={}
        for r in rows:
            # The undrafted Auburn forward is a different person from OKC's
            # Arkansas center. A unique model identity prevents name-only
            # provider, draft-prior and career-history fallbacks crossing IDs.
            if (r.get('realgm_profile')or'').endswith('/117468')and r.get('nba_id')is None:
                r['source_player_name']=r['player_name'];r['player_name']='Jaylin Williams (Auburn)'
            pid=r.get('nba_id')
            if pid is None:continue
            if pid in owned:raise ValueError(f'Duplicate NBA player ownership {cutoff} {pid}')
            owned[pid]=r['team']
    (root/'monthly_league_rosters.json').write_text(json.dumps([{'cutoff_date':d,'roster':v}for d,v in snapshots.items()],indent=2))
    audit.update(identity_aliases=ALIASES,profile_identity_matches=sum(len(v)==1 for v in profiles.values()))
    (root/'ownership_runtime_audit.json').write_text(json.dumps(audit,indent=2))
    from draft_identity import update as update_actual_drafts
    audit['actual_draft_identity']=update_actual_drafts(runtime,events)
    return snapshots,audit

def refresh_events(runtime,asof,html_path=None,repo=None):
    """Merge fresh current-season source transactions into the dated register."""
    root=runtime/'monthly_reconstruction/league_ownership'
    sys.path.insert(0,str(root));import source_inventory as source
    source.ROOT=root;source.BASE=runtime;source.RAW=root/'raw';source.RAW.mkdir(exist_ok=True)
    year=int(asof[:4])+(int(asof[5:7])>=7)
    cache=source.RAW/f'realgm_league_{year}.html'
    if html_path:cache.write_bytes(Path(html_path).read_bytes())
    else:
        from urllib.request import Request,urlopen
        from urllib.error import URLError
        try:
            cache.write_bytes(urlopen(Request(f'https://basketball.realgm.com/nba/transactions/league/{year}',headers={'User-Agent':'Mozilla/5.0'}),timeout=45).read())
        except (URLError,TimeoutError)as exc:
            if repo is None:raise
            from espn_ownership import refresh
            return refresh(runtime,repo,asof,exc)
    page=source.fetch(year)
    events=json.loads((root/'league_events.json').read_text());known={(e['date'],e['text'])for e in events}
    added=[]
    for event in page['events']:
        if event['date']>asof or(event['date'],event['text'])in known:continue
        event['event_id']='REFRESH_'+hashlib.sha256((event['date']+event['text']).encode()).hexdigest()[:14]
        added.append(event);known.add((event['date'],event['text']))
    events+=added;events.sort(key=lambda e:(e['date'],e['text']))
    (root/'league_events.json').write_text(json.dumps(events,indent=2))
    audit={'knowledge_date':asof,'source':page['url'],'retrieved_at':datetime.now(timezone.utc).isoformat(),'source_sha256':hashlib.sha256(cache.read_bytes()).hexdigest(),'new_dated_events':len(added),'latest_event':max(e['date']for e in events)}
    (root/'roster_refresh_source.json').write_text(json.dumps(audit,indent=2));return audit

def reconcile_current(previous,pool,asof):
    """Use current captures for genuinely new assets; dated removals prevail.

    The latest replay already contains every reviewed dated event through the
    current day. Current-feed additions are marked as captures, never backdated.
    """
    rows=[dict(r)for r in previous];byid={r['nba_id']:r for r in rows if r.get('nba_id')is not None}
    changes=[]
    for p in pool['players']:
        pid=p.get('nba_id')or p.get('app_nba_id')
        if not pid or p.get('pool_status')!='roster'or p.get('inactive_confirmed')or p.get('team')in(None,'FA'):continue
        existing=byid.get(pid)
        if existing and existing['team']!=p['team']:
            changes.append({'nba_id':pid,'name':p['player_name'],'feed_team':p['team'],'dated_team':existing['team'],'action':'retained_dated_ownership'})
    return rows,changes
