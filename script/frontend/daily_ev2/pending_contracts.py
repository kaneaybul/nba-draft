"""Confirmed contract-pending participation is not a priced asset or a zero quote."""
from datetime import date
TEAMS=set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())
def memberships(book,asof):
 if book.get('as_of')!=asof or not book.get('complete'):raise ValueError('Incomplete or stale contract book')
 signed={};pending={}
 for label,rows,out in [('priced',book['players'],signed),('pending',book.get('contract_pending',[]),pending)]:
  for r in rows:
   pid=int(r['nba_id']);team=r['team']
   if pid<=0 or pid in out or team not in TEAMS:raise ValueError('Invalid or duplicate '+label+' identity')
   if label=='pending':
    if not r.get('player_name')or not r.get('source')or not r.get('event_id')or date.fromisoformat(r['known_from'])>date.fromisoformat(asof):raise ValueError('Unverified or future contract pending')
   out[pid]=team
 if signed.keys()&pending.keys():raise ValueError('Pending player also priced')
 return signed,pending

def priced_roster(rows,book,asof):
 signed,pending=memberships(book,asof);seen={};priced=[]
 for r in rows:
  if r.get('pool_status')not in ('roster','contract_pending'):continue
  pid=int(r.get('source_nba_id')or r['nba_id']);team=r['team']
  if pid in seen:raise ValueError('Duplicate participant identity')
  seen[pid]=team
  if pid in pending:
   if pending[pid]!=team:raise ValueError('Wrong pending participant team')
   continue
  if signed.get(pid)!=team:raise ValueError('Unapproved demographic owner')
  priced.append(r)
 if seen!={**signed,**pending}:raise ValueError('Incomplete demographic ownership or pending participation')
 return priced

def native_asset_ledger(ledger,asof,pending_ids):
 import copy
 result=copy.deepcopy(ledger);dates=[s for s in result if s['cutoff_date']==asof]
 if len(dates)!=1:raise ValueError('Missing or duplicate current ledger date')
 snapshot=dates[0];excluded=[r for r in snapshot['roster']if r.get('nba_id')in pending_ids]
 if {r['nba_id']for r in excluded}!=set(pending_ids) or len(excluded)!=len(pending_ids):raise ValueError('Pending native exclusion mismatch')
 snapshot['roster']=[r for r in snapshot['roster']if r.get('nba_id')not in pending_ids]
 return result

def overlay_recent_terms(base, additions, events, book, asof):
 """Only explicitly reviewed, event-linked complete episodes; never infer salaries."""
 import copy,math
 signed,pending=memberships(book,asof)
 indexed={}
 for e in events:
  eid=e.get('event_id')
  if eid in indexed:raise ValueError('Duplicate ownership event identity')
  indexed[eid]=e
 result=copy.deepcopy(base);seen=set()
 for a in additions:
  pid=int(a['nba_id']);known=a['known_from'];key=(pid,known)
  if key in seen:raise ValueError('Duplicate reviewed contract episode')
  seen.add(key);e=indexed.get(a.get('pending_event_id'))
  if not e or e.get('date')!=a.get('pending_event_date') or 'roster_capture' in str(e).lower():raise ValueError('Contract episode lacks original signing event')
  if not date.fromisoformat(e['date'])<=date.fromisoformat(known)<=date.fromisoformat(asof):raise ValueError('Contract episode date outside verified signing window')
  team=a.get('signing_team')
  if not any(x.get('action')=='add'and x.get('nba_id')==pid and x.get('to_team')==team for x in e.get('parsed_actions',[])):raise ValueError('Contract episode player/team differs from signing')
  if not a.get('source') or not a.get('player_name')or a.get('schedule_complete')is not True or a.get('resets_prior_schedule')is not True or not a.get('salaries'):raise ValueError('Incomplete reviewed episode terms')
  for s in a['salaries']:
   if type(s.get('year'))is not int or not isinstance(s.get('amount'),(int,float))or not math.isfinite(s['amount'])or s['amount']<0:raise ValueError('Invalid reviewed salary schedule')
  # Current owner may legitimately differ after a trade or waiver. Link original signing,
  # not current ownership. Pending later episodes do not erase older accepted terms.
  current=next((r for r in book['players']if int(r['nba_id'])==pid),None)
  if current and current.get('known_from')==e['date'] and current['team']!=team:raise ValueError('Current signing identity conflicts with verified episode')
  existing=[b for b in result if b.get('nba_id')==pid and b.get('known_from')==known]
  if existing:
   if len(existing)!=1 or existing[0]!=a:raise ValueError('Reviewed episode would overwrite frozen terms')
  else:result.append(copy.deepcopy(a))
 return result
