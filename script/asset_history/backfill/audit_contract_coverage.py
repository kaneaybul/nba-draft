"""Measure original-table coverage without claiming complete as-of terms."""
import argparse,csv,json
from collections import defaultdict
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);a=p.parse_args()
 agreements=json.loads((a.contracts/'contract_agreements.json').read_text());byid=defaultdict(list)
 for x in agreements:byid[x['nba_id']].append(x)
 rows=[];missing=[]
 canonical_dates={r['cutoff_date']for r in csv.DictReader((a.sources/'epm/epm_monthly.csv').open())}
 for snapshot in json.loads((a.sources/'league_ownership/monthly_league_rosters.json').read_text()):
  d=snapshot['cutoff_date']
  if d not in canonical_dates:continue
  season=int(d[:4])+(int(d[5:7])>=7);teams=defaultdict(list)
  for r in snapshot['roster']:teams[r['team']].append(r)
  for team,roster in sorted(teams.items()):
   row={'date':d,'team':team,'roster_players':len(roster),'unknown_nba_id':0,'with_original_table':0,'with_complete_original_table':0,'with_current_year_salary_cell':0,'unreviewed_future_max_starts':0,'missing_original_table':0}
   for r in roster:
    pid=r.get('nba_id');eligible=[x for x in byid.get(pid,[])if x['known_from']<=d and x['expiry_season']>=season]
    if not pid:row['unknown_nba_id']+=1
    if eligible:
     row['with_original_table']+=1
     row['with_complete_original_table']+=int(any(x.get('table_complete',x['schedule_complete'])for x in eligible))
     row['with_current_year_salary_cell']+=int(any(any(s['year']==season for s in x['salaries'])for x in eligible))
     row['unreviewed_future_max_starts']+=int(any(min(s['year']for s in x['salaries'])>season and x['max_salary_years'] for x in eligible))
    else:
     row['missing_original_table']+=1;missing.append({'date':d,'team':team,'player_name':r['player_name'],'nba_id':pid,'known_from_roster':r['known_from'],'draft_rights':r.get('draft_rights',False),'two_way':r.get('two_way',False)})
   rows.append(row)
 for name,data in [('monthly_coverage.csv',rows),('missing_player_months.csv',missing)]:
  with (a.contracts/name).open('w')as f:
   if data:w=csv.DictWriter(f,data[0]);w.writeheader();w.writerows(data)
 summary={'roster_team_snapshots':len(rows),'roster_player_months':sum(r['roster_players']for r in rows),'with_original_table':sum(r['with_original_table']for r in rows),'with_complete_original_table':sum(r['with_complete_original_table']for r in rows),'missing_original_table':len(missing),'warning':'Structural original-table coverage only. Max-salary cap/performance clauses, partial guarantees, short episodes and dated public knowledge still require as-of validation.'}
 (a.contracts/'monthly_coverage_summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
if __name__=='__main__':main()
