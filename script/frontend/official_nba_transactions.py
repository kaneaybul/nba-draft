"""Dated official NBA movement supplement; no salary or directory inference.

Fetches the exact public JSON used by NBA.com/players/transactions. Refresh
must run after ordinary collection and before ownership replay. All unfamiliar
in-window actions fail closed unless already reviewed as an exact official row.
"""
from __future__ import annotations
import hashlib,json,re,unicodedata
from datetime import date,datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen

URL='https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json'
PAGE='https://www.nba.com/players/transactions'
TEAM_ROWS=[(1610612737,'ATL','Atlanta Hawks','hawks'),(1610612738,'BOS','Boston Celtics','celtics'),(1610612739,'CLE','Cleveland Cavaliers','cavaliers'),(1610612740,'NOP','New Orleans Pelicans','pelicans'),(1610612741,'CHI','Chicago Bulls','bulls'),(1610612742,'DAL','Dallas Mavericks','mavericks'),(1610612743,'DEN','Denver Nuggets','nuggets'),(1610612744,'GSW','Golden State Warriors','warriors'),(1610612745,'HOU','Houston Rockets','rockets'),(1610612746,'LAC','LA Clippers','clippers'),(1610612747,'LAL','Los Angeles Lakers','lakers'),(1610612748,'MIA','Miami Heat','heat'),(1610612749,'MIL','Milwaukee Bucks','bucks'),(1610612750,'MIN','Minnesota Timberwolves','timberwolves'),(1610612751,'BKN','Brooklyn Nets','nets'),(1610612752,'NYK','New York Knicks','knicks'),(1610612753,'ORL','Orlando Magic','magic'),(1610612754,'IND','Indiana Pacers','pacers'),(1610612755,'PHI','Philadelphia 76ers','sixers'),(1610612756,'PHX','Phoenix Suns','suns'),(1610612757,'POR','Portland Trail Blazers','blazers'),(1610612758,'SAC','Sacramento Kings','kings'),(1610612759,'SAS','San Antonio Spurs','spurs'),(1610612760,'OKC','Oklahoma City Thunder','thunder'),(1610612761,'TOR','Toronto Raptors','raptors'),(1610612762,'UTA','Utah Jazz','jazz'),(1610612763,'MEM','Memphis Grizzlies','grizzlies'),(1610612764,'WAS','Washington Wizards','wizards'),(1610612765,'DET','Detroit Pistons','pistons'),(1610612766,'CHA','Charlotte Hornets','hornets')]
TEAMS={r[0]:r[1:] for r in TEAM_ROWS}

def sha(b):return hashlib.sha256(b).hexdigest()
def key(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower())
def integer(v):
 if isinstance(v,bool) or not isinstance(v,(int,float)) or int(v)!=v or v<=0:raise ValueError('Invalid official NBA numeric identity')
 return int(v)
def row_hash(r):return sha(json.dumps(r,sort_keys=True,separators=(',',':'),allow_nan=False).encode())
def fact(e):
 return {(e['date'],int(a['nba_id']),a['to_team'],a['action'],bool(a.get('two_way',False))) for a in e.get('parsed_actions',[]) if a.get('nba_id') and a.get('to_team') and a.get('action') in ('add','remove')}

def convert(row):
 pid=integer(row['PLAYER_ID']);tid=integer(row['TEAM_ID'])
 if tid not in TEAMS:raise ValueError('Unrecognized official NBA team')
 team,full,slug=TEAMS[tid]
 if row['TEAM_SLUG']!=slug:raise ValueError('Official team ID/slug conflict')
 day=date.fromisoformat(row['TRANSACTION_DATE'][:10]).isoformat();text=row['TRANSACTION_DESCRIPTION'];kind=row['Transaction_Type']
 prefix=re.escape(full)
 # The feed's actor ID and exact description/slug must identify the same person.
 if kind=='Signing':
  m=re.fullmatch(prefix+r' (?:re-)?signed (?:guard|forward|center)(?:-(?:guard|forward|center))? (.+?) to a (Two-Way|Rest-of-Season|10-Day|Rookie Scale|Exhibit 10|Standard|Contract) ?(?:Contract)?\.',text)
  # Plain "to a Contract." is valid. Extensions are deliberately not signings.
  if not m:raise ValueError('Unreviewed official signing syntax or extension: '+text)
  name=m[1];action='add';two_way=m[2]=='Two-Way'
 elif kind=='Waive':
  m=re.fullmatch(prefix+r' waived (?:guard|forward|center)(?:-(?:guard|forward|center))? (.+?)\.',text)
  if not m:raise ValueError('Unreviewed official waiver syntax: '+text)
  name=m[1];action='remove';two_way=False
 else:raise ValueError('Official action requires existing full direction/terms review: '+kind)
 if not name or key(name)!=key(row['PLAYER_SLUG']):raise ValueError('Official player description/slug conflict')
 group=row.get('GroupSort')
 if not isinstance(group,str) or not group.startswith(kind+' '):raise ValueError('Missing official transaction identity')
 identity={'group':group,'date':day,'player_id':pid,'team_id':tid,'type':kind}
 eid='NBA_OFFICIAL_'+sha(json.dumps(identity,sort_keys=True).encode())[:20]
 return {'date':day,'event_id':eid,'text':text,
  'players':[{'name':name,'nba_id':pid,'realgm_url':None}],
  'teams':[{'name':full}],'source':URL,'parsed_status':'signing' if action=='add' else 'waiver',
  'parsed_actions':[{'player_name':name,'nba_id':pid,'to_team':team,'action':action,'two_way':two_way}],
  'identity_source':'official_nba_transaction_feed',
  'official_transaction':{'date':day,'type':kind,'action':action,'to_team':team,'group':group,'row_sha256':row_hash(row),'player_id':pid,'team_id':tid,'player_slug':row['PLAYER_SLUG'],'team_slug':slug,'source_url':URL},
  'terms_status':'not_inferred_from_transaction'}

def merge(raw,existing,start,asof,captured_at):
 """Pure bounded merge. start is INCLUSIVE for same-day late source updates."""
 start=date.fromisoformat(start).isoformat();asof=date.fromisoformat(asof).isoformat()
 if start>asof or (date.fromisoformat(asof)-date.fromisoformat(start)).days>14:raise ValueError('Official supplement requires a bounded interval of at most14 days')
 capture=datetime.fromisoformat(captured_at.replace('Z','+00:00'))
 if capture.tzinfo is None or capture.date().isoformat()!=asof:raise ValueError('Official transaction capture must be same UTC as-of date')
 payload=json.loads(raw);rows=payload['NBA_Player_Movement']['rows']
 if not isinstance(rows,list) or not rows or len(rows)>20000:raise ValueError('Empty or oversized official transaction source')
 days=[date.fromisoformat(r['TRANSACTION_DATE'][:10]).isoformat() for r in rows]
 if min(days)>=start:raise ValueError('Official feed does not cross interval lower bound; possible truncation')
 if max(days)>asof:raise ValueError('Future official transaction row')
 known_ids={e['event_id']:e for e in existing}
 if len(known_ids)!=len(existing):raise ValueError('Duplicate existing event identity')
 facts=set().union(*(fact(e) for e in existing)) if existing else set()
 staged=[];dedup=[];seen_source={};administrative=[]
 for row,day in zip(rows,days):
  if not start<=day<=asof:continue
  rh=row_hash(row)
  # An exact source row may already have separately reviewed trade/terms logic.
  kind=row['Transaction_Type'];pid=integer(row['PLAYER_ID']);tid=integer(row['TEAM_ID'])
  if tid not in TEAMS or row['TEAM_SLUG']!=TEAMS[tid][2]:raise ValueError('Official team ID/slug conflict')
  team=TEAMS[tid][0]
  if kind=='Trade':
   reviewed=[e for e in existing if e['date']==day and 'trade' in e.get('parsed_status','') and any(a.get('nba_id')==pid and a.get('to_team')==team and a.get('action') in ('transfer','add') for a in e.get('parsed_actions',[]))]
   if reviewed:
    dedup.append({'row_sha256':rh,'event_id':reviewed[0]['event_id'],'basis':'existing_reviewed_trade_destination'});continue
  if kind=='Signing' and re.fullmatch(re.escape(TEAMS[tid][1])+r' re-signed (?:guard|forward|center)(?:-(?:guard|forward|center))? (.+?) to a (?:Rookie Scale|Veteran) Extension\.',row['TRANSACTION_DESCRIPTION']):
   match=re.fullmatch(re.escape(TEAMS[tid][1])+r' re-signed (?:guard|forward|center)(?:-(?:guard|forward|center))? (.+?) to a (?:Rookie Scale|Veteran) Extension\.',row['TRANSACTION_DESCRIPTION'])
   if key(match[1])!=key(row['PLAYER_SLUG']):raise ValueError('Official extension actor mismatch')
   administrative.append({'row_sha256':rh,'date':day,'nba_id':pid,'team':team,'description':row['TRANSACTION_DESCRIPTION'],'disposition':'no_ownership_action; normal_contract_terms_guards_unchanged'})
   continue
  # Unknown non-ownership actions may be audit-only only after an exact official
  # source row was already accepted by the primary reviewed pipeline.
  reviewed=[e for e in existing if e.get('official_transaction',{}).get('row_sha256')==rh and e.get('source')==URL]
  if kind not in ('Signing','Waive') and reviewed:
   dedup.append({'row_sha256':rh,'event_id':reviewed[0]['event_id'],'basis':'exact_previously_reviewed_official_row'});continue
  e=convert(row);eid=e['event_id']
  if eid in seen_source and seen_source[eid]!=rh:raise ValueError('Conflicting official rows for one transaction identity')
  if eid in seen_source:continue
  seen_source[eid]=rh
  f=next(iter(fact(e)));day,pid,team,action,two_way=f
  if eid in known_ids:
   if known_ids[eid].get('official_transaction',{}).get('row_sha256')!=rh:raise ValueError('Official event content changed')
   dedup.append({'row_sha256':rh,'event_id':eid,'basis':'exact_event_id'});continue
  equivalents=[x for x in facts if x[:4]==f[:4]]
  if equivalents:
   if action=='add' and any(x[4]!=two_way for x in equivalents):raise ValueError('Conflicting existing contract class for official signing')
   dedup.append({'row_sha256':rh,'basis':'same_date_id_team_action','fact':f});continue
  staged.append(e);facts.add(f)
 # Date-only source cannot establish order for a same-team waiver+resigning or
 # two different destination signings on one date. Cross-team waiver then add
 # remains allowed and is ordered removals before additions by existing replay.
 relevant=[f for f in facts if start<=f[0]<=asof]
 for day,pid in {(f[0],f[1]) for f in relevant}:
  fs=[f for f in relevant if f[:2]==(day,pid)]
  adds={f[2] for f in fs if f[3]=='add'};removes={f[2] for f in fs if f[3]=='remove'}
  if len(adds)>1 or adds&removes:raise ValueError('Ambiguous same-day official ownership order; dated direction review required')
 result=existing+staged;result.sort(key=lambda e:(e['date'],e['text']))
 audit={'schema':'nba-official-transactions-v1','knowledge_date':asof,'inclusive_start':start,'source':URL,
  'retrieved_at':captured_at,'source_sha256':sha(raw),'source_rows':len(rows),
  'source_first_date':min(days),'source_last_event_date':max(days),
  'coverage_claim':'complete returned public feed crosses lower bound; same-day capture is not a guarantee provider has posted every transaction',
  'administrative_observations':administrative,'new_dated_events':len(staged),'added_event_ids':[e['event_id']for e in staged],'deduplicated':dedup,
  'terms_inferred':False,'existing_events_preserved':True,'event_ledger_sha256':sha(json.dumps(result,indent=2).encode())}
 return result,audit

def refresh(runtime,asof,start=None,cached_capture=None):
 """Authorized publisher hook. All parsing/coverage checks precede any writes."""
 root=Path(runtime)/'monthly_reconstruction/league_ownership';path=root/'league_events.json'
 existing=json.loads(path.read_text())
 if start is None:
  anchor=root/'ownership_seed_cutoff.json'
  if not anchor.exists():raise ValueError('Explicit prior coverage boundary required')
  start=json.loads(anchor.read_text())['date']
 if cached_capture is not None:
  # Supplied receipt must be the publisher's saved successful source capture,
  # not a recertified old event feed. merge enforces same-day capture.
  if cached_capture.get('source')!=URL:raise ValueError('Wrong cached official source')
  raw=Path(cached_capture['payload_path']).read_bytes()
  if len(raw)>16000000 or sha(raw)!=cached_capture.get('source_sha256'):raise ValueError('Cached official response digest mismatch')
  stamp=cached_capture['retrieved_at']
 else:
  with urlopen(Request(URL,headers={'User-Agent':'NBA-Impact-Data/1.0','Accept':'application/json','Referer':PAGE}),timeout=45) as response:
   if response.geturl()!=URL:raise ValueError('Unexpected official transaction redirect')
   raw=response.read(16000001)
   if len(raw)>16000000:raise ValueError('Oversized official transaction response')
  stamp=datetime.now(timezone.utc).isoformat()
 result,audit=merge(raw,existing,start,asof,stamp)
 audit['capture_reused']=cached_capture is not None
 # Preserve primary source audit; attach a separately hash-bound supplement.
 audit_path=root/'roster_refresh_source.json';primary=json.loads(audit_path.read_text())
 if primary.get('knowledge_date')!=asof:raise ValueError('Primary transaction receipt is stale')
 raw_dir=root/'raw';raw_dir.mkdir(exist_ok=True)
 raw_path=raw_dir/f'nba_transactions_{asof}_{sha(raw)[:16]}.json'
 raw_path.write_bytes(raw)
 supplement=root/'official_nba_transactions_receipt.json';supplement.write_text(json.dumps(audit,indent=2)+'\n')
 tmp=path.with_suffix('.official.tmp');tmp.write_text(json.dumps(result,indent=2));tmp.replace(path)
 primary['official_nba_supplement']={'receipt_file':supplement.name,'sha256':sha(supplement.read_bytes()),'source_sha256':sha(raw),'new_dated_events':audit['new_dated_events']}
 audit_path.write_text(json.dumps(primary,indent=2)+'\n')
 return audit
