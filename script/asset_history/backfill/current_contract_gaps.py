"""Separate missing current contracts from reviewed/as-of-rule gaps."""
import argparse,csv,json
from collections import defaultdict
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);p.add_argument('--live-pool',type=Path);a=p.parse_args()
 rosters=json.loads((a.sources/'league_ownership/monthly_league_rosters.json').read_text());snapshot=max(rosters,key=lambda s:s['cutoff_date'])
 if a.live_pool:
  pool=json.loads(a.live_pool.read_text());snapshot={'cutoff_date':pool['generated_at'][:10],'roster':[dict(nba_id=r.get('nba_id'),player_name=r['player_name'],team=r['team'],known_from=r.get('first_seen',r.get('last_seen')),two_way=r.get('contract_status')=='Two-Way',draft_rights=False,rfa_pending=False)for r in pool['players']if r.get('pool_status')=='roster' and r.get('team')not in (None,'FA')and not r.get('inactive_confirmed')]}
 cutoff=snapshot['cutoff_date'];year=int(cutoff[:4])+(int(cutoff[5:7])>=7)
 agreements=json.loads((a.contracts/'contract_agreements.json').read_text());byid=defaultdict(list)
 for ag in agreements:byid[ag['nba_id']].append(ag)
 tracker=json.loads((a.sources.parent/'app_model/cap_tracker_compact.json').read_text());salary={}
 for r in tracker['contracts']:
  if r.get('row_type')!='player' or not r.get('nba_id'):continue
  for c in r['cells']:
   if c['year']==year and c.get('amount')is not None and c['kind']not in ('cap_hold','empty'):salary[(r['nba_id'],r['team'])]=c['amount']
 rows=[]
 for r in snapshot['roster']:
  pid=r.get('nba_id');known=[ag for ag in byid.get(pid,[])if ag['known_from']<=cutoff]
  reset=max((ag['known_from']for ag in known if ag.get('resets_prior_schedule')),default='')
  eligible=[ag for ag in known if ag['known_from']>=reset and ag['expiry_season']>=year]
  hascurrent=any(any(s['year']==year for s in ag['salaries'])for ag in eligible)
  verified=lambda ag:ag.get('max_salary_asof_formula_verified') and ag['max_salary_asof_formula']['rule_known_from']<=cutoff
  pendingmax=[ag for ag in eligible if ag.get('max_salary_asof_review_required') and cutoff<ag['amount_terms_fixed_from']and not verified(ag)]
  incomplete=[ag for ag in eligible if not ag['schedule_complete'] and ag not in pendingmax]
  # Incomplete max tables can be nominally fixed after the first cap is settled.
  incomplete=[ag for ag in incomplete if not(ag.get('table_complete')and((ag.get('max_salary_asof_review_required')and(cutoff>=ag['amount_terms_fixed_from']or verified(ag)))or(ag.get('short_episode')and all(yy<year for yy in ag.get('annual_rate_unresolved_years',[])))))]
  status='unsigned_draft_right' if r.get('draft_rights') else 'pending_rfa_right' if r.get('rfa_pending') and not hascurrent else 'no_original_agreement' if not eligible else 'current_salary_missing' if not hascurrent else 'future_max_formula_pending' if pendingmax else 'short_or_incomplete_table' if incomplete else 'source_tables_available'
  amount=salary.get((pid,r['team']))
  rows.append(dict(date=cutoff,team=r['team'],player_name=r['player_name'],nba_id=pid,current_tracker_salary=amount,material_salary=amount is not None and amount>=10000000,status=status,agreement_count=len(eligible),pending_max_agreements=';'.join(ag['known_from']for ag in pendingmax),draft_rights=r.get('draft_rights',False),rfa_pending=r.get('rfa_pending',False),two_way=r.get('two_way',False)))
 with (a.contracts/'current_contract_coverage.csv').open('w')as f:
  w=csv.DictWriter(f,rows[0]);w.writeheader();w.writerows(rows)
 counts=defaultdict(int)
 for r in rows:counts[r['status']]+=1
 summary=dict(date=cutoff,players=len(rows),status_counts=dict(counts),material_gaps=[r for r in rows if r['material_salary'] and r['status']!='source_tables_available'],all_missing=[r for r in rows if r['status']in ('no_original_agreement','current_salary_missing')],unresolved_max_formulas=[r for r in rows if r['status']=='future_max_formula_pending'],note='Source table availability is not an all-terms legal certification. Registered formula templates can resolve some listed max gaps; this diagnostic does not silently apply templates or impute missing contracts.')
 (a.contracts/'current_contract_coverage_summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps({k:v for k,v in summary.items()if k not in ('material_gaps','all_missing','unresolved_max_formulas')}))
 print('Material gaps:',[(r['team'],r['player_name'],r['status'])for r in summary['material_gaps']])
if __name__=='__main__':main()
