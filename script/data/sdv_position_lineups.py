"""SportsDataverse NBA event-lineup seconds adapter (stdlib only).
SDV current-row lineup owns the interval ending at that row, empirically checked
against the official SAS/UTA Nov15 gamebook. No positional labels are observed.
"""
import csv,gzip,hashlib,io,json,math,urllib.request
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
BASE='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/'

def _load(url,path=None):
 if path is not None:
  data=Path(path).read_bytes();modified=None
 else:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=90)as response:data=response.read();modified=response.headers.get('Last-Modified')
 return list(csv.DictReader(io.StringIO(gzip.decompress(data).decode('utf-8-sig')))),{'url':url,'sha256':hashlib.sha256(data).hexdigest(),'last_modified':modified,'bytes':len(data)}

def _players(row,side):
 ids=tuple(sorted(int(row[f'{side}_player_{i}'])for i in range(1,6)))
 # Validate distinct positive IDs only on positive-duration stints below.
 return ids

def load_lineups(season,lineups_path=None,pbp_path=None):
 season=int(season)
 lineups,lmeta=_load(BASE+f'nba_stats_game_lineups/nba_lineups_{season}.csv.gz',lineups_path)
 events,pmeta=_load(BASE+f'nba_stats_pbp/nba_play_by_play_{season}.csv.gz',pbp_path)
 keyed={};duplicates=0
 for r in lineups:
  if int(r['season'])!=season:raise ValueError('Wrong lineup season')
  key=(r['game_id'],int(r['action_number']));v=(int(r['period']),_players(r,'home'),_players(r,'away'))
  if key in keyed:
   if keyed[key]!=v:raise ValueError('Conflicting duplicate lineup')
   duplicates+=1
  keyed[key]=v
 games=defaultdict(list);used=set();names={};teams={}
 for e in events:
  if int(e['season'])!=season:raise ValueError('Wrong PBP season')
  key=(e['game_id'],int(e['action_number']))
  if key not in keyed or keyed[key][0]!=int(e['period']):raise ValueError('PBP/lineup key or period mismatch')
  used.add(key);games[e['game_id']].append(e)
  pid=e.get('person_id');name=e.get('player_name_i')or e.get('player_name')
  if pid and int(pid)>0 and name:names[int(pid)]=name
  if e.get('team_id')and int(e['team_id'])>0:
   tid=int(e['team_id']);abbr=e['team_tricode']
   if tid in teams and teams[tid]!=abbr:raise ValueError('Conflicting team name')
   teams[tid]=abbr
 if used!=set(keyed):raise ValueError('Unjoined lineup keys')
 accum=defaultdict(lambda:defaultdict(float));teamgames=defaultdict(set);summaries=[];player_seconds=defaultdict(lambda:defaultdict(float));excluded=[];zero_invalid=0
 for game,rr in sorted(games.items()):
  rr.sort(key=lambda r:int(r['order_index']))
  if len({int(r['order_index'])for r in rr})!=len(rr):raise ValueError('Duplicate event order')
  clock={};invalid_seconds=0.;invalid_rows=0
  for e in rr:
   per=int(e['period']);rem=float(e['seconds_remaining']);duration=clock.get(per,720. if per<=4 else 300.)-rem;clock[per]=rem
   _,hp,ap=keyed[game,int(e['action_number'])]
   invalid=len(set(hp))!=5 or len(set(ap))!=5 or min(hp+ap)<=0 or bool(set(hp)&set(ap))
   if invalid:
    if duration>0:invalid_seconds+=duration;invalid_rows+=1
    else:zero_invalid+=1
  if invalid_rows:
   excluded.append({'game_id':game,'reason':'invalid_five_distinct_positive_duration_lineup','invalid_seconds':invalid_seconds,'invalid_positive_rows':invalid_rows});continue
  orientation={'h':set(),'v':set()}
  for e in rr:
   if e['location']in orientation and int(e['team_id'])>0:orientation[e['location']].add(int(e['team_id']))
  if any(len(v)!=1 for v in orientation.values()):raise ValueError('Ambiguous home/away mapping')
  home=next(iter(orientation['h']));away=next(iter(orientation['v']))
  if home==away:raise ValueError('Same home/away team')
  periods={int(e['period'])for e in rr}
  if periods!=set(range(1,max(periods)+1))or max(periods)<4:raise ValueError('Incomplete periods')
  previous={};first={};elapsed=0.;final_scores=[0,0]
  for e in rr:
   period=int(e['period']);length=720. if period<=4 else 300.;remaining=float(e['seconds_remaining'])
   if not math.isfinite(remaining)or remaining<0 or remaining>length:raise ValueError('Invalid event clock')
   # First recorded event must establish full period start, never invent time.
   if period not in previous:
    if abs(remaining-length)>.01:raise ValueError('Missing period start')
    first[period]=remaining
   duration=previous.get(period,length)-remaining
   if duration<-.001:raise ValueError('Clock increases within period')
   previous[period]=remaining
   # Correct SDV semantics: CURRENT row lineup owns elapsed interval.
   _,hp,ap=keyed[game,int(e['action_number'])]
   if duration>0:
    for tid,players in [(home,hp),(away,ap)]:
     accum[tid][players]+=duration
     for pid in players:player_seconds[game][pid]+=duration
    elapsed+=duration
   for i,k in enumerate(('score_home','score_away')):
    if e.get(k)not in ('',None):final_scores[i]=int(float(e[k]))
  nominal=2880.+300.*(max(periods)-4)
  if any(abs(v)>.01 for v in previous.values())or abs(elapsed-nominal)>.01:raise ValueError('Incomplete regulation/overtime seconds')
  if abs(sum(player_seconds[game].values())-10*nominal)>.01:raise ValueError('Player-second mass mismatch')
  for tid in (home,away):teamgames[tid].add(game)
  summaries.append({'game_id':game,'home_team_id':home,'away_team_id':away,'home_score':final_scores[0],'away_score':final_scores[1],'periods':max(periods),'team_seconds':elapsed})
 payloads=[];totals=[]
 for tid,values in sorted(accum.items()):
  rows=[{'EntityId':'-'.join(map(str,ids)),'TeamId':str(tid),'TeamAbbreviation':teams[tid],'SecondsPlayed':seconds,'Name':', '.join(names.get(pid,str(pid))for pid in ids)}for ids,seconds in sorted(values.items())]
  payloads.append((teams[tid],{'multi_row_table_data':rows}))
  totals.append({'TeamId':str(tid),'TeamAbbreviation':teams[tid],'SecondsPlayed':sum(values.values()),'GamesPlayed':len(teamgames[tid])})
 metadata={'provider':'sportsdataverse','source':'sportsdataverse_lineup','season':season,'captured_at':datetime.now(timezone.utc).isoformat(),'lineups':lmeta,'pbp':pmeta,'source_event_rows':len(events),'source_lineup_rows':len(lineups),'duplicate_lineup_rows_deduplicated':duplicates,'games':len(summaries),'source_games':len(games),'excluded_games':excluded,'invalid_zero_duration_rows_ignored':zero_invalid,'teams':len(accum),'period_totals_verified':True,'join':'exact game_id/action_number; identical lineup duplicates collapsed; PBP remains ordered','duration_policy':'previous_clock_minus_current_clock assigned to current-row lineup','games_summary':summaries,'player_seconds_by_game':{g:{str(k):v for k,v in vals.items()}for g,vals in player_seconds.items()},'coverage_note':'Provider game IDs and period totals verified; official latest-game coverage must be compared separately; no inferred through date'}
 if len(accum)!=30:raise ValueError('Incomplete league team coverage')
 return payloads,{'multi_row_table_data':totals},metadata
