"""Report actual player quote outputs without presenting missing assets as zero."""
import argparse,csv,json
from pathlib import Path

TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()

def report(root,cutoff):
    teams=[];missing=[]
    for team in TEAMS:
        folder=root/team;f=folder/'monthly_player_values.csv';coverage=folder/'league_player_coverage.json'
        if not f.exists()or not coverage.exists():missing.append(team);continue
        with f.open()as h:rows=[r for r in csv.DictReader(h)if r['cutoff_date']==cutoff and r['active_asset']=='True']
        if not rows:missing.append(team);continue
        cv=next((r for r in json.loads(coverage.read_text())['coverage']if r['date']==cutoff),None)
        if cv is None:missing.append(team);continue
        bad_contracts=set(cv['missing_complete_contracts']);priced=[r for r in rows if r['all_four_year_app_quote_priced']=='True']
        covered=[r for r in priced if r['player_name']not in bad_contracts]
        teams.append({'team':team,'date':cutoff,'roster_players':len(rows),'modeled_four_year_quotes':len(priced),
          'modeled_player_quote_subtotal':sum(float(r['app_style_four_year_asset_quote_with_draft_prior'])for r in priced),
          'contract_reviewed_player_quote_subtotal':sum(float(r['app_style_four_year_asset_quote_with_draft_prior'])for r in covered),
          'contract_reviewed_players':len(covered),'coverage':cv,
          'scope':'Player quotes only; draft-pick inventory excluded. Modeled subtotal can include explicit cost/profile fallbacks and is not complete team inventory unless coverage review passes.'})
    return {'schema_version':1,'date':cutoff,'teams_computed':len(teams),'missing_teams':missing,'player_rows':sum(r['roster_players']for r in teams),'modeled_four_year_quotes':sum(r['modeled_four_year_quotes']for r in teams),'teams':teams,'all30_computed':len(teams)==30,'publishable_total_inventory':False,'remaining_total_inventory_requirement':'Join reviewed dated pick entitlements/EVs and validate portfolio coverage. Player quote output alone is not total asset inventory.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--date',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();x=report(a.root,a.date);a.output.write_text(json.dumps(x,indent=2));print(json.dumps({k:v for k,v in x.items()if k!='teams'}))
