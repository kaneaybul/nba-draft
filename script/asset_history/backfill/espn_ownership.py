"""Strict current transaction fallback when the primary ledger is unavailable.

Only dated, identified roster actions are replayed. Unknown trades and prose
stop publication. A fresh roster capture can propose a new signing; its original
contract must independently confirm the team and post-waiver signing date.
"""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import datetime,timezone
from urllib.request import Request,urlopen

API='https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
TEAM_ALIASES={'GS':'GSW','NO':'NOP','NY':'NYK','SA':'SAS','UTAH':'UTA','WSH':'WAS','PHO':'PHX'}

def key(value):
    value=unicodedata.normalize('NFKD',str(value)).encode('ascii','ignore').decode().lower()
    return re.sub('[^a-z0-9]','',value)

def fetch_json(url):
    with urlopen(Request(url,headers={'User-Agent':'NBA-Impact-Data/1.0','Accept':'application/json'}),timeout=45)as response:
        return json.load(response)

def collect(asof):
    first=fetch_json(API+'/transactions?limit=1000');pages=[first]
    count=int(first.get('pageCount',1))
    if not 1<=count<=10:raise ValueError('Unexpected ESPN transaction pagination')
    for page in range(2,count+1):pages.append(fetch_json(f'{API}/transactions?limit=1000&page={page}'))
    for payload in pages:
        year=int(asof[:4])+(int(asof[5:7])>=7)
        if payload.get('status')!='success'or int(payload.get('season',{}).get('year',0))!=year:
            raise ValueError('Wrong ESPN transaction season or status')
        observed=datetime.fromisoformat(payload['timestamp'].replace('Z','+00:00'))
        age=(datetime.now(timezone.utc)-observed).total_seconds()
        if not -3600<=age<=48*3600 or observed.date().isoformat()>asof:
            raise ValueError('Stale or future ESPN transaction capture')
    rows=[row for page in pages for row in page['transactions']]
    if len(rows)!=int(first['count']):raise ValueError('Truncated ESPN transaction history')
    return rows,first['timestamp']

def event(day,text,player,team,action,two_way=False,capture=False):
    name=player.get('player_name',player.get('name'))
    identity=player.get('nba_id')
    if identity is None or int(identity)<=0:raise ValueError('Unverified ESPN player identity: '+str(name))
    source=player['source_url']if capture else API+'/transactions'
    detail={'name':name,'nba_id':int(identity),'realgm_url':None}
    return {'date':day,'event_id':'ESPN_'+hashlib.sha256((day+team+text).encode()).hexdigest()[:16],
      'text':text,'players':[detail],'teams':[{'name':team}],
      'source':source,'parsed_status':'signing'if action=='add'else'waiver',
      'parsed_actions':[{'player_name':name,'nba_id':int(identity),'to_team':team,'action':action,'two_way':two_way}],
      'identity_source':'verified_live_player_pool','roster_capture':capture}

def parse(rows,pool,after,asof):
    identities={}
    for player in pool['players']:
        if player.get('nba_id')is not None:identities.setdefault(key(player['player_name']),[]).append(player)
    out=[]
    for row in rows:
        day=row['date'][:10]
        if not after<day<=asof:continue
        team=TEAM_ALIASES.get(row['team']['abbreviation'],row['team']['abbreviation'])
        text=row['description']
        if re.search(r'\b(traded|acquired|exchange|picks?|draft)\b',text,re.I):
            raise ValueError('ESPN trade requires full player and pick direction review: '+text)
        # Protect punctuation inside known player names before sentence splitting.
        tokens={}
        for name,players in sorted(identities.items(),key=lambda pair:len(pair[0]),reverse=True):
            if len({p['nba_id']for p in players})>1 and any(p['player_name']in text for p in players):
                raise ValueError('Ambiguous ESPN transaction identities: '+players[0]['player_name'])
            for player in players:
                literal=player['player_name']
                if literal in text:
                    token=f'PLAYER{len(tokens)}TOKEN';tokens[token]=player;text=text.replace(literal,token)
        for clause in re.split(r'\.\s+|;\s*',text.strip()):
            clause=clause.strip().rstrip('.')
            if not clause:continue
            match=re.match(r'^(Re-signed|Signed|Waived|Released|Retired|Claimed|Converted|Exercised|Declined)\b\s*(.*)',clause,re.I)
            if not match:raise ValueError('Unreviewed ESPN transaction clause: '+clause)
            verb=match[1].lower();body=re.sub(r'^(?:[GFC](?:[/-][GFC])?\s+)+','',match[2])
            candidates=[(token,p)for token,p in tokens.items()if token in body]
            if not candidates:
                body_key=key(body)
                matches=[players for name,players in identities.items()if body_key.startswith(name)]
                candidates=[('',players[0])for players in matches if len({p['nba_id']for p in players})==1]
                if len(candidates)>1:
                    longest=max(len(key(p['player_name']))for _,p in candidates)
                    candidates=[(t,p)for t,p in candidates if len(key(p['player_name']))==longest]
            if len(candidates)!=1:raise ValueError('Unresolved or multiple ESPN transaction identities: '+clause)
            token,player=candidates[0]
            if token:
                remainder=body.removeprefix(token).strip()
                if not body.startswith(token)or(remainder and not re.match(r'^(to|on|for|from|off)\b',remainder,re.I)):
                    raise ValueError('Unresolved additional ESPN transaction identities: '+clause)
            if verb in ('exercised','declined')or 'extension'in clause.lower():
                raise ValueError('ESPN contract option or extension requires dated terms review: '+clause)
            if verb=='retired':action='remove'
            else:action='remove'if verb in ('waived','released')else'add'
            rendered=clause.replace(token,player['player_name'])if token else clause
            out.append(event(day,rendered+'.',player,team,action,'two-way'in clause.lower()))
    return out

def refresh(runtime,repo,asof,primary_error):
    root=runtime/'monthly_reconstruction/league_ownership'
    pool=json.loads((repo/'raw/live/player_pool.json').read_text())
    if pool['generated_at'][:10]!=asof or pool.get('teams_checked')!=30:
        raise ValueError('Fallback requires a fresh, complete 30-team roster capture')
    path=root/'league_events.json';events=json.loads(path.read_text())
    after=max(e['date']for e in events if e['date']<=asof)
    rows,timestamp=collect(asof)
    if not rows or min(row['date'][:10]for row in rows)>after:
        raise ValueError('ESPN transaction history does not cover the ledger gap')
    added=parse(rows,pool,after,asof)
    existing={e['event_id']for e in events};added=[e for e in added if e['event_id']not in existing]
    events+=added;events.sort(key=lambda e:(e['date'],e['text']))
    path.write_text(json.dumps(events,indent=2))
    audit={'knowledge_date':asof,'source':API+'/transactions','retrieved_at':datetime.now(timezone.utc).isoformat(),
      'source_timestamp':timestamp,'source_sha256':hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest(),
      'primary_error':str(primary_error),'new_dated_events':len(added),'latest_event':max(e['date']for e in events),
      'mode':'espn_dated_fallback'}
    (root/'roster_refresh_source.json').write_text(json.dumps(audit,indent=2))
    return audit

def capture_additions(runtime,pool,asof):
    root=runtime/'monthly_reconstruction/league_ownership'
    roster=json.loads((root/'monthly_league_rosters.json').read_text())
    current=next(s['roster']for s in roster if s['cutoff_date']==asof)
    byid={r['nba_id']:r for r in current if r.get('nba_id')is not None and not r.get('draft_rights')}
    additions=[]
    for player in pool['players']:
        if player.get('pool_status')!='roster'or player.get('review_pending')or player.get('inactive_confirmed'):
            continue
        if player.get('last_seen','')[:10]!=asof or not player.get('source_url','').startswith(API+'/teams/'):
            continue
        pid=player.get('nba_id');team=player['team']
        old=byid.get(pid)
        if old:
            if old['team']!=team:raise ValueError('Conflicting fresh ESPN and dated team ownership: '+player['player_name'])
            continue
        text=f"Current ESPN roster capture confirms {player['player_name']} on {team}; first observed for this inventory on {asof}."
        additions.append(event(asof,text,player,team,'add',player.get('contract_status')=='Two-Way',capture=True))
    if additions:
        path=root/'league_events.json';events=json.loads(path.read_text());events+=additions
        path.write_text(json.dumps(events,indent=2))
    return additions

def validate_captures(runtime,contracts,asof):
    path=runtime/'monthly_reconstruction/league_ownership/league_events.json'
    events=json.loads(path.read_text());ignored=[]
    agreements=json.loads((contracts/'contract_agreements.json').read_text())
    for capture in (e for e in events if e.get('roster_capture')and e['date']==asof):
        player=capture['players'][0];pid=player['nba_id'];team=capture['parsed_actions'][0]['to_team']
        removals=[e['date']for e in events if not e.get('roster_capture')and any(a.get('action')=='remove'and a.get('nba_id')==pid for a in e.get('parsed_actions',[]))]
        last_remove=max(removals,default='0000-00-00')
        confirmed=[a for a in agreements if a['nba_id']==pid and last_remove<a['known_from']<=asof and a.get('signing_team')==team and a.get('schedule_complete')]
        if not confirmed:
            if not removals:raise ValueError('Fresh roster signing lacks independently verified contract: '+player['name'])
            # A roster API can keep returning a waived player even with a fresh
            # HTTP timestamp. The dated removal remains authoritative unless a
            # separately verified later signing establishes a new asset.
            ignored.append({'event_id':capture['event_id'],'nba_id':pid,'name':player['name'],
              'reason':'Dated removal retained; no independently verified later signing','last_remove':last_remove})
    if ignored:
        rejected={r['event_id']for r in ignored}
        path.write_text(json.dumps([e for e in events if e['event_id']not in rejected],indent=2))
    return ignored
