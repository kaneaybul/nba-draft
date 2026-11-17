"""Exact date availability port of pinned injury_projections.R (d1c82410...).
Only evaluates acute injury q; never multiplies healthy GP/MPG or old mean q.
"""
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
import math,re,unicodedata

def day(x):return date.fromisoformat(str(x)[:10]) if x else None

def name_key(x):
 x=unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower()
 return re.sub('[^a-z0-9]','',re.sub(r'\b(jr|sr|ii|iii|iv|v)\b','',x))

def build_plan(row,as_of,future_dates):
 as_of=day(as_of);future=sorted(day(d) for d in future_dates if day(d)>=as_of)
 try:minimum=max(0,min(len(future),int(row.get('games_missed_min') or 0)))
 except (ValueError,TypeError):minimum=0
 plan={'kind':'none','start':str(as_of),'end':str(as_of),'half_life':0,'minimum_through':str(future[minimum-1]) if minimum else None,'status':row.get('status'),'basis':row.get('basis'),'source_url':row.get('source_url'),'policy':'existing_frontend_injury_date_v1'}
 if row.get('season_ending') is True:plan['kind']='season_ending';return plan
 earliest,latest,expected,review,provider=(day(row.get(k)) for k in ('return_earliest','return_latest','return_expected','reevaluation_date','provider_return_date'))
 basis=row.get('basis');reported=basis in ('reported_window','reported_duration','reported_games')
 if reported and latest and latest>=as_of and earliest:
  plan.update(kind='window',start=str(max(as_of,earliest)),end=str(max(as_of,earliest,latest)))
 elif reported and expected and expected>=as_of:plan.update(kind='window',start=str(expected),end=str(expected))
 elif basis=='provider_estimate' and provider and provider>=as_of:
  spread=7 if row.get('status')=='Out' else 3
  plan.update(kind='window',start=str(max(as_of,provider-timedelta(days=spread))),end=str(provider+timedelta(days=spread)))
 else:
  plan.update(kind='uncertain',half_life=28 if row.get('status')=='Out' else 7)
  if basis=='reevaluation' and review:plan.update(start=str(max(as_of,review)),half_life=14)
  elif earliest and earliest>=as_of:plan.update(start=str(earliest),half_life=14)
 return plan

def availability_on_date(plan,game_date):
 d=day(game_date)
 if plan['kind']=='season_ending':return 0.
 if plan.get('minimum_through') and d<=day(plan['minimum_through']):return 0.
 if plan['kind']=='window':
  a,b=day(plan['start']),day(plan['end']);width=(b-a).days
  return float(d>=b) if width==0 else max(0.,min(1.,(d-a).days/width))
 if plan['kind']=='uncertain':return 1-math.exp(-math.log(2)*max(0,(d-day(plan['start'])).days)/plan['half_life'])
 return 1.

def dated_payload(meta,outlook,schedules,cutoff):
 # Only exact same export capture may enrich a current row. Never backfill old q.
 if not outlook or outlook.get('generated_at')!=meta.get('injury_projection_as_of'):
  return {'availability_resolution':'aggregate_only_missing_exact_capture'}
 if day(outlook['generated_at'])>day(cutoff):raise ValueError('Future injury outlook')
 team=meta.get('team');matches=[r for r in outlook['players'] if r.get('team')==team and r.get('name_key')==name_key(meta['player_name'])]
 if len(matches)>1:raise ValueError('Ambiguous dated injury identity')
 as_of=datetime.fromisoformat(outlook['generated_at'].replace('Z','+00:00')).astimezone(ZoneInfo('America/New_York')).date()
 future=[r['date'] for r in schedules if r.get('season_type')=='Regular Season' and not r.get('is_completed') and r.get('date') and day(r['date'])>=as_of and (r.get('selected_team')==team if r.get('is_placeholder') else team in (r.get('home_team'),r.get('away_team')))]
 if not future:return {'availability_resolution':'aggregate_only_missing_team_schedule'}
 if not matches:
  if float(meta['injury_availability'])!=1.:raise ValueError('Nonhealthy mean without source injury match')
  plan={'kind':'none','minimum_through':None,'policy':'existing_frontend_injury_date_v1'}
 else:plan=build_plan(matches[0],as_of,future)
 return {'availability_resolution':'dated_existing_frontend_plan','availability_plan':plan,'availability_plan_as_of':str(as_of),'availability_outlook_generated_at':outlook['generated_at'],'availability_source_row':matches[0] if matches else None,'availability_scheduled_games':[{'date':d,'probability':availability_on_date(plan,d)} for d in sorted(future)]}

def availability_for_dates(record,dates):
 if record.get('availability_resolution')!='dated_existing_frontend_plan':raise ValueError('Aggregate-only injury record has no individual-game return timeline')
 values=[availability_on_date(record['availability_plan'],d) for d in dates]
 return sum(values)/len(values) if values else 1.
