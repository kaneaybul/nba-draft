"""Candidate native service seam. No pricing/draft/model changes or publication."""
import csv,math
from collections import defaultdict
POLICY='resolved-shared-game-service-v1'
def num(v):
 v=float(v)
 if not math.isfinite(v):raise ValueError('Nonfinite shared ledger value')
 return v

def contexts(filename,asof,version,eligible):
 """eligible maps verified priced NBA IDs to signed team and absolute clock."""
 groups=defaultdict(list)
 with open(filename,newline='') as f:
  for r in csv.DictReader(f):
   if r['asof']!=asof or r['forecast_version']!=version:raise ValueError('Mixed date/version')
   groups[int(r['nba_id'])].append(r)
 result={}
 if set(eligible)-set(groups):raise ValueError('Missing eligible priced player')
 for pid,rows in groups.items():
  if pid not in eligible:continue # Explicit authoritative pending/unpriced exclusion
  rows.sort(key=lambda r:int(r['game']));clock=num(rows[0]['team_game_clock']);cells=[]
  if rows[0]['team']!=eligible[pid]['team'] or clock!=num(eligible[pid]['team_game_clock']):raise ValueError('Signed team/clock mismatch')
  for i,r in enumerate(rows):
   p,m,e=map(num,(r['probability'],r['conditional_mpg'],r['expected_minutes']))
   if int(r['game'])!=i+1 or num(r['team_game_clock'])!=clock+i:raise ValueError('Discontinuous/duplicate ledger')
   if r['team']!=rows[0]['team'] or not(0<=p<=1 and 0<=m<=48)or abs(e-p*m)>1e-8:raise ValueError('Invalid resolved cell')
   cells.append([clock+i,p,m])
  result[pid]={'policy':POLICY,'asof':asof,'forecast_version':version,'nba_id':pid,'team':rows[0]['team'],'acute_overlay_already_resolved':True,'cells':cells,'injury_intervals':[]}
 return result

def integrate(context,impact_knots,start,end,replacement=0.,coordinate_shift=0.):
 if context.get('policy')!=POLICY or context.get('acute_overlay_already_resolved')is not True or context.get('injury_intervals'):raise ValueError('Requires resolved ledger; no second injury overlay')
 cells=context['cells'];start,end,shift,replacement=map(num,(start,end,coordinate_shift,replacement))
 if not cells or end<=start or start<cells[0][0]+shift or end>cells[-1][0]+shift+1:raise ValueError('Shared forecast horizon exhausted')
 ks=[tuple(map(num,k)) for k in impact_knots]
 if len(ks)<2 or any(b[0]<=a[0]for a,b in zip(ks,ks[1:]))or ks[0][0]>start or ks[-1][0]<end:raise ValueError('Impact horizon exhausted/invalid')
 def impact(x):
  for(a,u),(b,v)in zip(ks,ks[1:]):
   if a<=x<=b:return u+(v-u)*(x-a)/(b-a)-replacement
  raise ValueError('Impact outside path')
 games=minutes=production=0.
 for i,(clock,p,m) in enumerate(cells):
  clock,p,m=map(num,(clock,p,m))
  if clock!=cells[0][0]+i or not(0<=p<=1 and 0<=m<=48):raise ValueError('Invalid shared cells')
  a,b=max(start,clock+shift),min(end,clock+shift+1)
  if b<=a:continue
  cuts=sorted({a,b}|{x for x,y in ks if a<x<b})
  games+=(b-a)*p;minutes+=(b-a)*p*m
  production+=p*m*sum((v-u)*(impact(u)+impact(v))/2 for u,v in zip(cuts,cuts[1:]))
 scale=82/(end-start)
 return dict(expected_games=games,expected_minutes=minutes,impact_minutes=production,annual_games=games*scale,annual_minutes=minutes*scale,annual_impact_minutes=production*scale,policy=POLICY,acute_overlay_application_count=1)

def install(native_joint_pricing):
 """Preserve native dollar_rate and all downstream contracts/draft pricing."""
 original=native_joint_pricing.integrate
 def dispatch(context,*args,**kwargs):
  return integrate(context,*args,**kwargs) if context.get('policy')==POLICY else original(context,*args,**kwargs)
 native_joint_pricing.integrate=dispatch
 return lambda:setattr(native_joint_pricing,'integrate',original)

# Opt-in configuration is externally SHA-pinned, not self-authorizing.
_CONFIG_CACHE={}
def configured_context(pid,team,clock,asof):
 import os,json,hashlib
 path=os.environ.get('NBA_SHARED_NATIVE_CONFIG');pin=os.environ.get('NBA_SHARED_NATIVE_CONFIG_SHA256')
 if not path and not pin:return None
 if not path or not pin:raise ValueError('Both config path and external SHA required')
 if path not in _CONFIG_CACHE:
  from pathlib import Path
  raw=Path(path).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=pin:raise ValueError('Shared native config SHA mismatch')
  c=json.loads(raw);ledger=Path(c['ledger']);ledger=ledger if ledger.is_absolute() else Path(path).parent/ledger
  if hashlib.sha256(ledger.read_bytes()).hexdigest()!=c['ledger_sha256']:raise ValueError('Shared ledger SHA mismatch')
  if c['scope']!='all-eligible-current-endpoints' or c['cutover_booking']!='separate-method-rebase':raise ValueError('Explicit complete scope and cutover required')
  eligible={int(k):v for k,v in c['eligible'].items()}
  resolved=contexts(ledger,c['asof'],c['forecast_version'],eligible)
  # Healthy stages must preserve original baseline participation probability.
  healthy_rows=defaultdict(list)
  with ledger.open(newline='') as f:
   for row in csv.DictReader(f):
    k=int(row['nba_id'])
    if k in eligible:
     p,e=map(num,(row['baseline_probability'],row['healthy_rotation']))
     if not 0<=p<=1 or e<0 or(p==0 and e!=0)or(p>0 and e/p>48):raise ValueError('Invalid healthy ledger stage')
     healthy_rows[k].append([num(row['team_game_clock']),p,e/p if p else 0.])
  for k,v in resolved.items():v['healthy_cells']=sorted(healthy_rows[k])
  _CONFIG_CACHE[path]=(pin,c,resolved)
 stored,c,resolved=_CONFIG_CACHE[path]
 if stored!=pin or c['asof']!=asof:raise ValueError('Config changed or wrong asof')
 if pid is None or int(pid)not in resolved:raise ValueError('Missing eligible native asset; no legacy fallback in opt-in mode')
 result=resolved[int(pid)]
 if result['team']!=team or result['cells'][0][0]!=clock:raise ValueError('Native identity/team clock differs')
 return result

def healthy_context(context):
 if context.get('policy')!=POLICY:return dict(context,injury_intervals=[])
 return dict(context,cells=context['healthy_cells'],injury_intervals=[])

def dispatch(native,context,*args,**kwargs):
 return integrate(context,*args,**kwargs) if context.get('policy')==POLICY else native(context,*args,**kwargs)
