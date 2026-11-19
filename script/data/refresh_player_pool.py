"""Daily roster membership independent of rating coverage; preserve stable IDs.

ESPN roster membership is authoritative for additions. A disappearance requires
an explicit departure transaction or a reviewed override before removal.
"""
import csv,json,math,re,sys
from collections import defaultdict,Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
from refresh_injury_outlook import API,TEAM_IDS,ALIASES,fetch_json,name_key,iso_datetime,season_for
ROOT=Path(__file__).resolve().parents[2]

def read_json(path,default):
    return json.loads(path.read_text()) if path.exists() else default

def validate_source(data,season,now):
    if data.get('status')!='success' or int(data.get('season',{}).get('year',0))!=season:
        raise ValueError('Wrong roster/transaction season or source status')
    age=(now-iso_datetime(data['timestamp'])).total_seconds()
    if not -3600<=age<=48*3600: raise ValueError('Stale roster/transaction source')

def roster_rows(payloads,season,now):
    if set(payloads)!=set(TEAM_IDS): raise ValueError('All 30 team rosters are required')
    out=[];seen=set()
    for team,data in payloads.items():
        validate_source(data,season,now)
        athletes=data.get('athletes',[])
        if not 13<=len(athletes)<=23: raise ValueError('Incomplete or implausible team roster: '+team)
        for a in athletes:
            eid=str(a['id'])
            if eid in seen: raise ValueError('Player appears on multiple teams; membership needs review')
            seen.add(eid)
            salary=next((c.get('salary') for c in a.get('contracts',[]) if c.get('season',{}).get('year')==season and c.get('salary',0)>0),None)
            out.append(dict(espn_id=eid,player_name=a['displayName'],team=team,age=a.get('age'),
                position=a.get('position',{}).get('abbreviation','UNK'),experience=a.get('experience',{}).get('years',0),
                salary=salary,source_url=f'{API}/teams/{TEAM_IDS[team]}/roster'))
    return out

def departure_for(player,transactions,since):
    matches=[];key=name_key(player['player_name'])
    for t in transactions:
        if t['date'][:10]<since[:10] or name_key(t['description']).find(key)<0: continue
        team=ALIASES.get(t.get('team',''),t.get('team',''))
        if team and team!=player.get('team') and player.get('team')!='FA': continue
        text=t['description']
        verbs=list(re.finditer(r'\b(signed|waived|released|retired|retirement|converted|traded|acquired)\b',text,re.I))
        for i,verb in enumerate(verbs):
            clause=text[verb.start():verbs[i+1].start() if i+1<len(verbs) else len(text)]
            if key not in name_key(clause):continue
            action='inactive' if verb[0].lower() in ('retired','retirement') else 'free_agent' if verb[0].lower() in ('waived','released') else None
            if action:matches.append((t['date'],action,t))
    return max(matches,key=lambda x:x[0]) if matches else None

def reconcile(existing,active,transactions,season,now,overrides=()):
    by_espn={str(p['espn_id']):p for p in existing if p.get('espn_id')}
    by_name=defaultdict(list)
    for p in existing: by_name[name_key(p['player_name'])].append(p)
    records={p['app_nba_id']:dict(p) for p in existing};observed=set();changes=[]
    for a in active:
        candidates=by_name[name_key(a['player_name'])]
        old=by_espn.get(a['espn_id'])
        if old is None and len(candidates)==1: old=candidates[0]
        if old is None and len(candidates)>1: raise ValueError('Ambiguous player identity: '+a['player_name'])
        if old is None:
            old=dict(app_nba_id=-1000000000-int(a['espn_id']),nba_id=None,player_name=a['player_name'],first_seen=now.isoformat(),contract_status='Signed',last_nba_season=None)
        p=dict(old);pid=p['app_nba_id']
        if pid in observed: raise ValueError('Duplicate canonical player identity')
        observed.add(pid)
        if p.get('team')!=a['team'] or p.get('pool_status')!='roster': changes.append(dict(player_name=a['player_name'],from_team=p.get('team'),to_team=a['team'],action='roster_added_or_moved'))
        # An old team's salary must not be attributed to a new signing.
        if p.get('team')!=a['team']: p['salary']=None
        p.update(a,pool_status='roster',roster_state='active',last_seen=now.isoformat(),review_pending=False,inactive_confirmed=False,
                 note='Confirmed on current ESPN team roster.',identity_status='nba_id' if p.get('nba_id') else 'provisional_id')
        if p.get('contract_status') in (None,'UFA','RFA','Rookie FA'):
            p['contract_status']='Signed'
        for t in transactions:
            if name_key(a['player_name']) in name_key(t['description']) and 'two-way' in t['description'].lower() and t['date'][:10]>=f'{season-1}-07-01':
                p['contract_status']='Two-Way';break
        records[pid]=p
    for pid,p in records.items():
        if pid in observed: continue
        since=p.get('last_seen',f'{season-1}-07-01')
        departure=departure_for(p,transactions,since)
        if departure:
            _,status,t=departure
            p.update(team='FA',pool_status=status,roster_state='inactive',review_pending=False,
                     note=t['description'],status_source_url=API+'/transactions',salary=None)
            if status=='free_agent':p['waived_season']=season
            changes.append(dict(player_name=p['player_name'],action=status,date=t['date']))
        elif p.get('pool_status')=='roster':
            p.update(review_pending=True,note='Missing from latest roster; prior team retained pending a confirmed transaction or review.')
        elif p.get('pool_status')!='inactive' or not p.get('inactive_confirmed'):
            recent=(p.get('last_nba_season') or 0)>=season-1 or p.get('waived_season')==season
            p.update(team='FA',pool_status='free_agent' if recent else ('draft' if pid<0 and not p.get('last_nba_season') else 'inactive'),
                     note='Recent NBA player without a confirmed roster spot; signing availability unverified.' if recent else 'No recent NBA participation or confirmed roster spot.')
        if departure and departure[1]=='inactive':p['inactive_confirmed']=True
    for o in overrides:
        if not o.get('reason') or not o.get('source_url') or not o.get('expires_at'):raise ValueError('Overrides need reason, source and expiration')
        if o['expires_at'][:10]<now.date().isoformat():continue
        if o['pool_status'] not in ('roster','free_agent','inactive','draft'):raise ValueError('Invalid override status')
        matches=[p for p in records.values() if p['app_nba_id']==o.get('app_nba_id') or (p.get('nba_id') is not None and p['nba_id']==o.get('nba_id'))]
        if len(matches)!=1:raise ValueError('Override identity must match exactly one player')
        p=matches[0];team=o.get('team','FA')
        if o['pool_status']=='roster' and team not in TEAM_IDS:raise ValueError('Roster override requires a team')
        p.update(pool_status=o['pool_status'],team=team,review_pending=False,note=o['reason'],status_source_url=o['source_url'],inactive_confirmed=o['pool_status']=='inactive')
    return sorted(records.values(),key=lambda p:p['app_nba_id']),changes

def seed_registry(root,season,previous):
    records={p['app_nba_id']:dict(p) for p in previous}
    published=read_json(root/f'frontend/public/data/v2/impact_players/{season}.json',[])
    archive=read_json(root/f'frontend/public/data/archive/{season}-preseason/impact_players.json',[])
    for p in archive+published:
        pid=int(p['nba_id'])
        if pid in records:continue
        team=p.get('team_projection_base') or 'FA'
        records[pid]=dict(app_nba_id=pid,nba_id=pid if pid>0 else None,player_name=p['player_name'],team=team,
            pool_status='roster' if team in TEAM_IDS else 'inactive',contract_status=p.get('contract_status'),
            position=p.get('position','UNK'),age=p.get('age'),experience=p.get('yoe'),salary=p.get('contract'),
            last_seen=p.get('roster_truth_pulled_at') or f'{season-1}-07-01',last_nba_season=None)
    names=defaultdict(list)
    for p in records.values():names[name_key(p['player_name'])].append(p)
    history=list(csv.DictReader((root/'processed/livedata/impactrefresh/impactoutput.csv').open()))
    ratings=read_json(root/'raw/live/ratings.json',{}).get('players',[])
    evidence=read_json(root/'raw/live/skill_stats.json',{}).get('players',[])
    for row in history+ratings+evidence:
        canonical=int(float(row['nba_id']));candidates=names[name_key(row['player_name'])]
        p=records.get(canonical)
        if p is None and len(candidates)==1:p=candidates[0]
        year=int(row.get('year',season));minutes=float(row.get('Minutes',row.get('minutes',0)) or 0)
        if p is None:
            # Keep recent NBA participants and rated players; older history stays in historical tabs.
            if year<season-1 or (not minutes and row not in ratings):continue
            p=dict(app_nba_id=canonical,nba_id=canonical,player_name=row['player_name'],team='FA',pool_status='inactive',last_nba_season=None)
            records[canonical]=p;names[name_key(p['player_name'])].append(p)
        p['nba_id']=canonical
        if minutes>0:p['last_nba_season']=max(p.get('last_nba_season') or 0,year)
    # Official profiles can establish identity before the first rating or NBA
    # minute. Keep the app ID so frozen preseason comparisons still join.
    for identity in read_json(root/'ref/player_identity_overrides.json',[]):
        p=records.get(identity['app_nba_id'])
        if p is None:continue
        if (name_key(p['player_name'])!=name_key(identity['player_name'])
            or p.get('nba_id') not in (None,identity['nba_id'])
            or not identity.get('source_url')):
            raise ValueError('Conflicting verified player identity: '+identity['player_name'])
        p.update(nba_id=identity['nba_id'],identity_status='nba_id',identity_source_url=identity['source_url'])
    return list(records.values())

def main():
    now=datetime.now(timezone.utc);season=season_for(now.date())
    previous=read_json(ROOT/'raw/live/player_pool.json',{})
    if previous and previous['season']!=season:raise ValueError('Player registry season rollover requires a new preseason snapshot')
    if '--enrich' in sys.argv:
        if not previous:raise ValueError('Roster refresh must run before enrichment')
        previous['players']=seed_registry(ROOT,season,previous['players'])
        # Resolve newcomers without changing signed ownership or salary terms.
        from official_player_identity import prepare_identities
        previous=prepare_identities(ROOT,previous,now=now)
        for p in previous['players']:
            if p.get('pool_status')!='roster' and not p.get('inactive_confirmed') and (p.get('last_nba_season') or 0)>=season-1:
                p.update(pool_status='free_agent',team='FA')
        previous['counts']=dict(Counter(p['pool_status'] for p in previous['players']))
        previous['provisional_ids']=sum(p.get('nba_id') is None for p in previous['players'])
        path=ROOT/'raw/live/player_pool.json';path.write_text(json.dumps(previous,allow_nan=False,separators=(',',':'))+'\n')
        print('Registry enriched with current rating/stat identities:',previous['counts'])
        return
    with ThreadPoolExecutor(max_workers=6) as executor:
        payloads=dict(executor.map(lambda kv:(kv[0],fetch_json(f'{API}/teams/{kv[1]}/roster')),TEAM_IDS.items()))
    active=roster_rows(payloads,season,now)
    first=fetch_json(API+'/transactions?limit=1000');validate_source(first,season,now)
    pages=[first]
    if int(first.get('pageCount',1))>10:raise ValueError('Unexpected transaction pagination')
    for page in range(2,int(first.get('pageCount',1))+1):
        data=fetch_json(f'{API}/transactions?limit=1000&page={page}');validate_source(data,season,now);pages.append(data)
    transactions=[dict(date=t['date'],description=t['description'],team=ALIASES.get(t.get('team',{}).get('abbreviation'),t.get('team',{}).get('abbreviation',''))) for page in pages for t in page['transactions']]
    if len(transactions)<int(first.get('count',0)):raise ValueError('Truncated transactions')
    seeds=seed_registry(ROOT,season,previous.get('players',[]))
    players,changes=reconcile(seeds,active,transactions,season,now,read_json(ROOT/'ref/player_pool_overrides.json',[]))
    output=dict(schema_version=1,season=season,generated_at=now.isoformat(),source='ESPN team rosters and transactions',teams_checked=30,
        players=players,changes=changes,counts=dict(Counter(p['pool_status'] for p in players)),
        review_pending=sum(bool(p.get('review_pending')) for p in players),provisional_ids=sum(p.get('nba_id') is None for p in players),
        transactions_checked=len(transactions),transactions_as_of=first['timestamp'])
    path=ROOT/'raw/live/player_pool.json';tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(output,allow_nan=False,separators=(',',':'))+'\n');tmp.replace(path)
    print('Player registry:',output['counts'],'pending review:',output['review_pending'],'provisional IDs:',output['provisional_ids'])
if __name__=='__main__':main()
