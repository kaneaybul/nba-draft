"""Conservative absence-of-outgoing audit against complete eligible-window pages.

Past protected firsts may have rolled and may have second-round fallbacks. An
unadjudicated past clause therefore blocks all reachable future vintages rather
than being silently treated as expired. This intentionally leaves false-positive
review items until a pre-baseline settlement is evidenced.
"""
from pick_event_evidence import MENTION,ALIASES
from pick_allocator import TEAMS
ALIASES.update({'GOS':'GSW','WSH':'WAS'})
# RealGM uses 'Swap' for transfers of a retained/basket entitlement as well as
# actual options. These dated economic groups were adjudicated jointly above.
REVIEWED_ABSTRACTS={
 ('2018-02-08',2022,2),('2018-02-08',2024,2),('2018-07-06',2022,2),('2018-07-13',2023,2),('2018-11-12',2022,2),('2019-06-21',2022,2),('2019-07-06',2023,1),('2019-07-06',2024,1),('2019-07-06',2025,1),('2019-07-10',2023,1),('2019-07-10',2025,1),('2019-07-16',2025,1),('2020-02-06',2023,2),('2020-11-19',2022,2),('2020-11-20',2023,2),('2020-11-22',2024,2),('2020-11-23',2024,1),('2020-11-23',2026,1),('2020-11-27',2023,2),('2021-01-16',2023,1),('2021-01-16',2025,1),('2021-01-16',2027,1),('2021-01-16',2023,2),('2021-01-16',2024,2),('2021-07-30',2024,2),('2021-07-30',2026,2),('2021-07-30',2027,2),('2021-08-06',2022,2),('2021-08-06',2024,2),('2021-08-06',2025,2),('2021-08-07',2024,2),('2021-08-07',2026,2),('2021-08-11',2022,2),('2021-08-17',2023,2),('2021-09-04',2024,2),('2021-09-04',2025,2),('2021-09-15',2026,2)}

REVIEWED_ABSTRACTS.update({('2019-07-08',2023,2),('2019-07-07',2022,2),('2019-07-07',2023,2),('2021-06-18',2025,2),('2021-06-18',2023,2),('2021-03-25',2025,2),('2021-03-25',2022,1)})

def audit(events,covered,settled_claims=()):
 blocked={};unknown_abstract=[]
 settlements={}
 for claim in settled_claims:
  if claim.get('reviewed')is not True or not claim.get('source')or claim.get('settled_by','9999')>'2021-12-31':raise ValueError('Legacy claim settlement must be sourced, reviewed and known by baseline')
  key=(claim['date'],claim['origin'],int(claim['claim_year']),int(claim['round']))
  if key in settlements:raise ValueError('Duplicate reviewed legacy settlement '+str(key))
  settlements[key]=claim
 def block(p,e,reason):
  if p[1]not in range(2022,2029):return
  blocked.setdefault(p,[]).append(dict(date=e['date'],source=e['source'],source_text=e['text'],reason=reason))
 for e in events:
  if e['date']>'2021-12-31':continue
  for m in MENTION.finditer(e['text']):
   y,rnd=int(m['year']),int(m['round']);origin=ALIASES.get(m['origin'],m['origin']);conditional=(m['qualifier']or'').strip().lower()=='conditional'
   if origin is None:
    if y>=2022 and(e['date'],y,rnd)not in REVIEWED_ABSTRACTS:
     unknown_abstract.append(dict(date=e['date'],year=y,round=rnd,source=e['source'],text=e['text']))
     for t in TEAMS:block((t,y,rnd),e,'Unadjudicated future reference without physical origin')
    continue
   if y>=2022:
    if(origin,y,rnd)not in covered:block((origin,y,rnd),e,'Explicit future outgoing/incoming claim outside reviewed allocation scope')
   elif conditional:
    if(e['date'],origin,y,rnd)in settlements:continue
    # Seven-year maximum is a deliberately conservative outer bound; precise
    # original rollover endpoints and observed conveyance shrink this footprint.
    for future in range(2022,min(2028,int(e['date'][:4])+7)+1):
     for rr in([1,2]if rnd==1 else[2]):block((origin,future,rr),e,'Past protected clause requires proof of pre-baseline settlement or exact maximum rollover')
 confirmed=[];unresolved=[]
 for t in sorted(TEAMS):
  for y in range(2022,2029):
   for rnd in(1,2):
    p=(t,y,rnd)
    if p in covered:continue
    if p in blocked:unresolved.append(dict(pick=list(p),blockers=blocked[p]))
    else:
     local=[c for c in settled_claims if c['origin']==t]
     sources={e['source']for e in events}
     for c in local:sources.update(c['source']if isinstance(c['source'],list)else[c['source']])
     confirmed.append(dict(pick=list(p),owner=t,status='documented_no_outgoing_claim_in_complete_eligible_window',source=sorted(sources),known_from='2021-12-31',reviewed_settlement_keys=[[c['date'],c['origin'],c['claim_year'],c['round']]for c in local],proof='Complete2015–2022league registers contain no live outgoing claim touching this component, after explicitly reviewed pre-baseline settlements. Initial own assignment follows NBA draft rights; current inventory is not copied backward.'))
 return dict(confirmed_retained_own=confirmed,unresolved_legacy_or_origin_claims=unresolved,unresolved_abstract_groups=unknown_abstract,reviewed_legacy_settlements=list(settled_claims))
