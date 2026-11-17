#!/usr/bin/env python3
"""Lineup-constrained positional inference, not observed labelled positions.
No fitting: each five-player lineup has one PG/SG/SF/PF/C in every assignment.
Dated priors inform assignment ambiguity; posterior seconds yield player shares.
"""
import argparse,csv,itertools,json,math,os,time,urllib.error,urllib.request,urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
TEAMS={'ATL':1610612737,'BOS':1610612738,'CLE':1610612739,'NOP':1610612740,'CHI':1610612741,'DAL':1610612742,'DEN':1610612743,'GSW':1610612744,'HOU':1610612745,'LAC':1610612746,'LAL':1610612747,'MIA':1610612748,'MIL':1610612749,'MIN':1610612750,'BKN':1610612751,'NYK':1610612752,'ORL':1610612753,'IND':1610612754,'PHI':1610612755,'PHX':1610612756,'POR':1610612757,'SAC':1610612758,'SAS':1610612759,'OKC':1610612760,'TOR':1610612761,'UTA':1610612762,'MEM':1610612763,'WAS':1610612764,'DET':1610612765,'CHA':1610612766}
POS=['PG','SG','SF','PF','C'];FIELDS=[p.lower()+'_share'for p in POS];PERMS=list(itertools.permutations(range(5)));FLOOR=.02

def posterior(priors):
 weights=[]
 for perm in PERMS:weights.append(math.prod(priors[i][perm[i]]for i in range(5)))
 total=sum(weights);shares=[[0.]*5 for _ in range(5)]
 for perm,w in zip(PERMS,weights):
  for i,k in enumerate(perm):shares[i][k]+=w/total
 return shares

def prior_table(path):
 d=json.loads(path.read_text());stamp=d.get('generated_at')
 if not stamp:raise ValueError('Dated prior generated_at required')
 if datetime.fromisoformat(stamp.replace('Z','+00:00'))>datetime.now(timezone.utc):raise ValueError('Future-dated prior')
 priors={};names={}
 for r in d['players']:
  if not r.get('nba_id'):continue
  v=[float(r.get(k)or 0)for k in FIELDS]
  if any(not math.isfinite(x)or x<0 for x in v)or sum(v)<=0:continue
  v=[x/sum(v)for x in v];priors[str(r['nba_id'])]=[(1-5*FLOOR)*x+FLOOR for x in v];names[str(r['nba_id'])]=r.get('player_name','')
 return priors,names,stamp

def infer(payloads,priors,names,season,stamp,source='pbpstats_lineup'):
 accum={};audit={'lineups':0,'lineup_seconds':0.,'max_slot_mass_error':0.,'unknown_prior_ids':set()}
 for team,payload in payloads:
  rows=payload.get('multi_row_table_data');seen=set()
  if not isinstance(rows,list)or not rows:raise ValueError('Missing lineup coverage '+team)
  for r in rows:
   ids=str(r['EntityId']).split('-');sec=float(r['SecondsPlayed'])
   if len(ids)!=5 or len(set(ids))!=5 or any(not x.isdigit()for x in ids)or not math.isfinite(sec)or sec<0:raise ValueError('Malformed five-player lineup '+team)
   if r['EntityId']in seen:raise ValueError('Duplicate lineup '+team)
   seen.add(r['EntityId'])
   if sec==0:continue
   if str(r.get('TeamId'))!=str(TEAMS[team]):raise ValueError('Team mismatch')
   ps=[priors.get(pid,[.2]*5)for pid in ids];assigned=posterior(ps)
   audit['max_slot_mass_error']=max(audit['max_slot_mass_error'],max(abs(sum(x[k]for x in assigned)-1)for k in range(5)))
   audit['lineups']+=1;audit['lineup_seconds']+=sec
   labels=str(r.get('Name','')).split(', ')
   for i,pid in enumerate(ids):
    if pid not in priors:audit['unknown_prior_ids'].add(pid)
    a=accum.setdefault(pid,{'seconds':0.,'mass':[0.]*5,'teams':set(),'name':names.get(pid)or(labels[i]if len(labels)==5 else pid)})
    a['seconds']+=sec;a['teams'].add(team)
    for k in range(5):a['mass'][k]+=sec*assigned[i][k]
 out=[]
 for pid,a in sorted(accum.items(),key=lambda x:int(x[0])):
  shares=[x/a['seconds']for x in a['mass']];entropy=-sum(x*math.log(x)for x in shares if x>0)/math.log(5)
  out.append(dict(nba_id=int(pid),player_name=a['name'],name=a['name'],year=season,team=next(iter(a['teams']))if len(a['teams'])==1 else 'TOT',**dict(zip(FIELDS,shares)),position_estimate=POS[max(range(5),key=lambda k:shares[k])],position_entropy=entropy,position_index=sum((k+1)*x for k,x in enumerate(shares)),minutes=a['seconds']/60,source=source,prior_asof=stamp,prior_available=pid in priors,uncertain=pid not in priors or a['seconds']<600 or max(shares)<.5))
 audit['unknown_prior_ids']=sorted(audit['unknown_prior_ids']);audit['players']=len(out);audit['uncertain_players']=sum(r['uncertain']for r in out);return out,audit

def load_api(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
 for delay in (0,2,5):
  if delay:time.sleep(delay)
  try:
   with urllib.request.urlopen(req,timeout=30)as response:return json.load(response)
  except urllib.error.HTTPError as ex:
   if ex.code not in (429,500,502,503,504) or delay==5:raise
  except (urllib.error.URLError,TimeoutError):
   if delay==5:raise

def fetch(team,season):
 query=urllib.parse.urlencode({'Season':f'{season-1}-{str(season)[-2:]}','SeasonType':'Regular Season','Type':'Lineup','TeamId':TEAMS[team]})
 return team,load_api('https://api.pbpstats.com/get-totals/nba?'+query)

def coverage(payloads,totals):
 byid={str(r['TeamId']):r for r in totals['multi_row_table_data']};proof={}
 for team,payload in payloads:
  expected=byid[str(TEAMS[team])];observed=sum(float(r['SecondsPlayed'])for r in payload['multi_row_table_data'])
  if abs(observed-float(expected['SecondsPlayed']))>.1:raise ValueError('Incomplete/truncated lineup seconds '+team)
  proof[team]={'lineup_seconds':observed,'team_seconds':float(expected['SecondsPlayed']),'games':int(expected['GamesPlayed'])}
 return proof

def main():
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--season',type=int,default=int(os.environ['CURRENT_ROSTER_YEAR'])+1 if 'CURRENT_ROSTER_YEAR'in os.environ else None);p.add_argument('--prior',type=Path);p.add_argument('--team',choices=TEAMS);p.add_argument('--team-totals-json',type=Path);p.add_argument('--input-json',type=Path,help='Single-team saved endpoint response; requires --team');a=p.parse_args()
 if not a.season:p.error('--season or CURRENT_ROSTER_YEAR required')
 if a.input_json and not a.team:p.error('--input-json requires --team')
 prior=a.prior or a.repo/f'raw/pbp_position_prior_{a.season}.json';priors,names,stamp=prior_table(prior);teams=[a.team]if a.team else list(TEAMS)
 source='sdv_nba_lineup_inferred';metadata={}
 if not (a.input_json or a.team or a.team_totals_json):
  from sdv_position_lineups import load_lineups
  payloads,totals,metadata=load_lineups(a.season)
 else:
  source='pbpstats_lineup'
  if a.input_json:payloads=[(a.team,json.loads(a.input_json.read_text()))]
  else:
   with ThreadPoolExecutor(max_workers=3)as pool:payloads=list(pool.map(lambda t:fetch(t,a.season),teams))
  if a.team_totals_json:totals=json.loads(a.team_totals_json.read_text())
  elif not a.input_json:
   url='https://api.pbpstats.com/get-totals/nba?'+urllib.parse.urlencode({'Season':f'{a.season-1}-{str(a.season)[-2:]}','SeasonType':'Regular Season','Type':'Team'})
   totals=load_api(url)
  else:raise ValueError('Saved sample requires --team-totals-json for independent seconds reconciliation')
 reconciled=coverage(payloads,totals)
 if not a.team and set(reconciled)!=set(TEAMS):raise ValueError('Position season must cover all 30 teams')
 rows,audit=infer(payloads,priors,names,a.season,stamp,source)
 audit['team_coverage']=reconciled
 audit['source_metadata']={k:v for k,v in metadata.items() if k!='player_seconds_by_game'}
 audit['coverage_basis']='Provider coverage may lag official completed games';target=a.repo/'raw/live';target.mkdir(parents=True,exist_ok=True);out=target/'pbp_position_estimates.csv';tmp=out.with_suffix('.tmp')
 with tmp.open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
 tmp.replace(out);now=datetime.now(timezone.utc).isoformat();status={'checked_at':now,'seasons':{str(a.season):{'year':a.season,'status':'ok'if len(teams)==30 else 'partial','source':source,'method':'seconds_weighted_legal_lineup_permutation_posterior','teams_checked':len(reconciled),'rows':len(rows),'prior_asof':stamp,'note':'Inferred positions conditional on dated priors, not independent positional observations; capture time does not prove completed-game coverage',**audit}}}
 s=target/'position_status.json';stmp=s.with_suffix('.tmp');stmp.write_text(json.dumps(status,indent=2));stmp.replace(s);print(json.dumps(status))
if __name__=='__main__':main()
