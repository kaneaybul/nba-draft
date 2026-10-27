"""List exact held player/date points with unresolved future max bases."""
import argparse,csv,json
from collections import defaultdict
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);a=p.parse_args();byid=defaultdict(list)
 for ag in json.loads((a.contracts/'contract_agreements.json').read_text()):byid[ag['nba_id']].append(ag)
 dates={r['cutoff_date']for r in csv.DictReader((a.sources/'epm/epm_monthly.csv').open())};rows=[]
 for snap in json.loads((a.sources/'league_ownership/monthly_league_rosters.json').read_text()):
  d=snap['cutoff_date']
  if d not in dates:continue
  current=int(d[:4])+(int(d[5:7])>=7)
  for r in snap['roster']:
   known=[ag for ag in byid.get(r.get('nba_id'),[])if ag['known_from']<=d];reset=max((ag['known_from']for ag in known if ag.get('resets_prior_schedule')),default='')
   for ag in known:
    if ag['known_from']<reset or not ag.get('max_salary_asof_review_required')or d>=ag['amount_terms_fixed_from']:continue
    if min(s['year']for s in ag['salaries'])>current+4:continue
    if ag.get('max_salary_asof_formula_verified')and ag['max_salary_asof_formula']['rule_known_from']<=d:continue
    rows.append(dict(date=d,team=r['team'],nba_id=r.get('nba_id'),player_name=r['player_name'],agreement=ag['known_from'],first_salary_year=min(s['year']for s in ag['salaries']),first_cap_known_from=ag['first_cap_known_from'],type=ag['contract_type'],class_of_review='rookie_cap_or_performance_clause'if'ROOKIE'in ag['contract_type'].upper()else'veteran_cap_or_prior_salary_rule',source=ag['source']))
 with(a.contracts/'historical_max_review_points.csv').open('w')as f:
  if rows:w=csv.DictWriter(f,rows[0]);w.writeheader();w.writerows(rows)
 grouped=defaultdict(list)
 for r in rows:grouped[(r['nba_id'],r['agreement'])].append(r)
 summary=[dict(nba_id=pid,agreement=ag,player_name=rs[0]['player_name'],first_date=min(r['date']for r in rs),last_date=max(r['date']for r in rs),points=len(rs),class_of_review=rs[0]['class_of_review'])for(pid,ag),rs in grouped.items()];summary.sort(key=lambda r:(r['class_of_review'],r['player_name'],r['agreement']))
 (a.contracts/'historical_max_review_summary.json').write_text(json.dumps({'points':len(rows),'agreements':len(summary),'review':summary},indent=2));print(json.dumps({'points':len(rows),'agreements':len(summary)}))
if __name__=='__main__':main()
