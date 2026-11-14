"""Recover cutoff PBP counts by subtracting a same-source later-game tail.

Only additive event counts are subtracted. Rates are recalculated, not
subtracted. Unknown rebound opportunity denominators remain missing. Player
points and seconds must match the independent dated NBA reference before a
recovered row is accepted. The existence of later data adds no later production
because the full-season and tail counts cancel exactly.
"""
import argparse,copy,json,math,pathlib
from expand_league_skill import COUNTS,write

UNUSED_FOR_SKILL={'NonHeaveArc3FGA','NonHeaveArc3FGM','Arc3FGA','Arc3FGM','Corner3FGA','Corner3FGM','OffRebounds','FG2M'}

def denominator(row):
 n=float(row.get('OffTwoPtRebounds')or 0)+float(row.get('OffThreePtRebounds')or 0);pct=row.get('OffFGReboundPct')
 if n>0 and pct and pct>0:
  d=n/pct
  if abs(d-round(d))<1e-4:return float(round(d))
 return None

def difference(full,tail,nba,no_later_games=False,point_tolerance=0.,minute_tolerance=.2):
 if tail is None and not no_later_games:return None,'Missing tail row for a player with later NBA games'
 tail=tail or {};out={'EntityId':str(full['EntityId']),'Name':full['Name'],'TeamId':0,'TeamAbbreviation':'TOT','RowId':str(full['EntityId'])}
 for k in COUNTS:
  if k in ('Minutes','GamesPlayed'):continue
  v=float(full.get(k)or 0)-float(tail.get(k)or 0)
  if v<-.00001:
   if k in UNUSED_FOR_SKILL:
    out[k]=v;out.setdefault('_unused_negative_counts',{})[k]=v;continue
   return None,'Negative difference: '+k
  out[k]=0. if abs(v)<.00001 else v
 if out['OffPoss']<=0 or out['DefPoss']<=0:return None,'No positive cutoff possessions'
 point_delta=out['Points']-float(nba['points'])
 if abs(point_delta)>point_tolerance:return None,'Cutoff NBA point-count mismatch outside direct-source envelope'
 secmins=out['SecondsPlayed']/60
 minute_delta=secmins-float(nba['minutes'])
 if float(nba['minutes'])<=0 and secmins>0:return None,'Positive prefix for NBA zero-minute sample'
 if abs(minute_delta)>max(minute_tolerance,float(nba['minutes'])*.001):return None,'Cutoff NBA minutes mismatch outside direct-source envelope'
 out['_NBA_reference_disagreement']={'point_delta':point_delta,'minute_delta':minute_delta,'point_tolerance':point_tolerance,'minute_tolerance':minute_tolerance} if abs(point_delta)>.00001 or abs(minute_delta)>.00001 else None
 out['Minutes']=secmins;out['GamesPlayed']=nba['games'];n=out['OffTwoPtRebounds']+out['OffThreePtRebounds'];df=denominator(full);dt=denominator(tail)
 if n==0:out['OffFGReboundPct']=0.;flag=None
 elif no_later_games and not tail:out['OffFGReboundPct']=full.get('OffFGReboundPct');flag=None
 elif df is not None and dt is not None and df>dt and n<=df-dt:out['OffFGReboundPct']=n/(df-dt);flag=None
 else:out['OffFGReboundPct']=None;flag='Unknown OREB opportunity denominator; retain OREB prior'
 out['_reconstructed_by']='PBP full-season additive counts minus strictly later PBP tail';out['_OREB_reconstruction_flag']=flag
 return out,None

def reconstruct(fullrows,tailrows,cutoff_nba,completed_nba,tolerance=None):
 tail={int(r['EntityId']):r for r in tailrows};nba={int(r['nba_id']):r for r in cutoff_nba};completed={int(r['nba_id']):r for r in completed_nba};out=[];rejected=[]
 for f in fullrows:
  pid=int(f['EntityId']);n=nba.get(pid)
  if n is None or n['games']<=0:continue
  no_later=pid in completed and completed[pid]['games']==n['games']
  z,error=difference(f,tail.get(pid),n,no_later_games=no_later,**(tolerance or {}))
  if z:out.append(z)
  else:rejected.append({'nba_id':pid,'name':f['Name'],'reason':error})
 return out,rejected

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--cutoff',required=True);p.add_argument('--tail-start',required=True);p.add_argument('--compare-direct',action='store_true');p.add_argument('--save',action='store_true');a=p.parse_args();root=a.skill_dir.resolve();raw=root/'raw';y=int(a.cutoff[:4])+(int(a.cutoff[5:7])>=10)
 full=json.loads((raw/f'full_season_pbp_{y}.json').read_text())['multi_row_table_data'];tail=json.loads((raw/f'tail_pbp_{a.tail_start}.json').read_text())['multi_row_table_data'];nba=json.loads((raw/f'nba_assignment_inputs_{a.cutoff}.json').read_text())['players'];completed=json.loads((raw/f'nba_assignment_inputs_{y}-04-30.json').read_text())['players'];rows,rejected=reconstruct(full,tail,nba,completed)
 audit={'cutoff':a.cutoff,'tail_start':a.tail_start,'accepted_players':len(rows),'rejected_players':rejected,'unknown_oreb_denominator_players':[r['EntityId']for r in rows if r['_OREB_reconstruction_flag']],'method':'Same-source exact additive-count subtraction; NBA cutoff points/minutes verification; no rates subtracted'}
 if a.compare_direct:
  direct={int(r['EntityId']):r for r in json.loads((raw/f'league_pbp_{a.cutoff}.json').read_text())['multi_row_table_data']};diffs=[];rate_diffs=[];shared=0
  for r in rows:
   d=direct.get(int(r['EntityId']))
   if not d:continue
   shared+=1
   for k in COUNTS:
    if k in ('Minutes','GamesPlayed'):continue
    if abs(float(r.get(k)or 0)-float(d.get(k)or 0))>.001:diffs.append({'nba_id':r['EntityId'],'field':k,'recovered':r.get(k),'direct':d.get(k)})
   if r['OffFGReboundPct'] is not None and d.get('OffFGReboundPct') is not None and abs(r['OffFGReboundPct']-d['OffFGReboundPct'])>1e-10:rate_diffs.append({'nba_id':r['EntityId'],'recovered':r['OffFGReboundPct'],'direct':d['OffFGReboundPct']})
  audit.update(direct_shared_players=shared,direct_additive_count_differences=diffs,direct_oreb_rate_differences=rate_diffs)
 write(root/f'pbp_subtraction_audit_{a.cutoff}.json',audit)
 if a.save:
  dest=raw/f'league_pbp_{a.cutoff}.json'
  if dest.exists():raise ValueError('Refusing to replace direct source cache')
  write(dest,{'multi_row_table_data':rows,'source_method':audit['method'],'reconstruction_audit':str(root/f'pbp_subtraction_audit_{a.cutoff}.json')})
  write(dest.with_suffix('.source.json'),{'cutoff':a.cutoff,'tail_start':a.tail_start,'inputs':[str(raw/f'full_season_pbp_{y}.json'),str(raw/f'tail_pbp_{a.tail_start}.json')],'method':audit['method']})
 print({k:v for k,v in audit.items()if not isinstance(v,list)})
