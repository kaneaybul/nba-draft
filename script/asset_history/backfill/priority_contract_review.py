"""Finite review queues for opening inventory and fresh current roster."""
import argparse,csv,json,re,unicodedata
from collections import defaultdict
from pathlib import Path

def key(n):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower())
def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);p.add_argument('--live-pool',type=Path,required=True);a=p.parse_args()
 agreements=json.loads((a.contracts/'contract_agreements.json').read_text());adjustments=json.loads((a.contracts/'contract_adjustments.json').read_text());byid=defaultdict(list);adjid=defaultdict(list)
 for ag in agreements:byid[ag['nba_id']].append(ag)
 for ad in adjustments:adjid[ad['nba_id']].append(ad)
 snapshots=json.loads((a.sources/'league_ownership/monthly_league_rosters.json').read_text());baseline=next(s for s in snapshots if s['cutoff_date']=='2021-12-31');pool=json.loads(a.live_pool.read_text());current={'cutoff_date':pool['generated_at'][:10],'roster':[r for r in pool['players']if r.get('pool_status')=='roster'and r.get('team')not in (None,'FA')and not r.get('inactive_confirmed')]}
 salaryhist=list(csv.DictReader((a.sources/'pick_values/salary_sources/historical_player_salaries.csv').open()));salaries={}
 for r in salaryhist:salaries[(key(r['player']),int(r['season_year'])+1)]=max(float(r['salary']),salaries.get((key(r['player']),int(r['season_year'])+1),0))
 result={}
 for scope,snapshot in [('opening',baseline),('current',current)]:
  cutoff=snapshot['cutoff_date'];year=int(cutoff[:4])+(int(cutoff[5:7])>=7);maxpending=[];short=[];missing=[];options=[];verified=[];partial=[]
  for r in snapshot['roster']:
   pid=r.get('nba_id');salary=salaries.get((key(r['player_name']),year));base={'team':r['team'],'player_name':r['player_name'],'nba_id':pid,'salary_observation':salary,'material_10M_salary':salary is not None and salary>=1e7}
   known=sorted((ag for ag in byid.get(pid,[])if ag['known_from']<=cutoff),key=lambda ag:ag['known_from']);reset=max((ag['known_from']for ag in known if ag.get('resets_prior_schedule')),default='');known=[ag for ag in known if ag['known_from']>=reset];active=[ag for ag in known if ag['expiry_season']>=year]
   if not active:missing.append(dict(**base,reason='No in-scope original contract table; unsigned rights or identity must be reviewed'));continue
   for ag in active:
    if ag.get('short_episode')and any(yy>=year for yy in ag.get('annual_rate_unresolved_years',[min(s['year']for s in ag['salaries'])])):short.append(dict(**base,agreement=ag['known_from'],type=ag['contract_type'],source=ag['source'],reason='Episode total is not annual salary; exact expiration/current annual rate required'))
    if ag.get('max_salary_asof_review_required')and cutoff<ag['amount_terms_fixed_from']:
     item=dict(**base,agreement=ag['known_from'],type=ag['contract_type'],source=ag['source'],first_cap_known_from=ag['first_cap_known_from'],cap_pct_current_diagnostic=ag.get('first_year_cap_pct_current_diagnostic'))
     if ag.get('max_salary_asof_formula_verified')and ag['max_salary_asof_formula']['rule_known_from']<=cutoff:verified.append(dict(**item,reason='Verified as-of cap/prior-salary formula; resolve rather than gate'))
     else:maxpending.append(dict(**item,reason='Rose/All-NBA performance contingencies and award knowledge dates need review'if'ROOKIE'in ag['contract_type'].upper()else'Verify cap share,105%prior-salary floor and signed raises; eventual dollar schedule is not fixed at cutoff'))
   cells={}
   for ag in known:
    for s in ag['salaries']:
     if year<=s['year']<=year+4:cells[s['year']]=(s,ag)
   for ad in sorted(adjid.get(pid,[]),key=lambda x:x['known_from']):
    if ad['known_from']>cutoff:continue
    for yy in ad['remove_years']:cells.pop(yy,None)
   for yy,(s,ag)in sorted(cells.items()):
    if s['kind']in ('team_option','player_option'):
     resolved=[ad for ad in adjid.get(pid,[])if ad['known_from']<=cutoff and yy in ad['exercise_years']]
     options.append(dict(**base,year=yy,original_kind=s['kind'],disposition='exercised_asof'if resolved else'contingent_at_cutoff',resolution_date=max((ad['known_from']for ad in resolved),default=None),source=ag['source']))
    if s['kind']=='salary'and s.get('guaranteed_amount')is not None and s['guaranteed_amount']<s['amount']:partial.append(dict(**base,year=yy,amount=s['amount'],guaranteed_current_diagnostic=s['guaranteed_amount'],source=ag['source'],reason='Original guarantee and later vesting/amendment dates need review'))
  result[scope]={'date':cutoff,'roster_players':len(snapshot['roster']),'missing_original_contract':missing,'future_max_formula_pending':maxpending,'verified_formula_resolvable':verified,'short_episode_review':short,'future_option_dispositions':options,'partial_guarantee_review':partial,'counts':{k:len(v)for k,v in [('missing',missing),('max_pending',maxpending),('verified_max_resolvable',verified),('short',short),('options',options),('partial',partial)]}}
 (a.contracts/'priority_review.json').write_text(json.dumps(result,indent=2));print(json.dumps({s:{'date':v['date'],'roster_players':v['roster_players'],**v['counts']}for s,v in result.items()}))
if __name__=='__main__':main()
