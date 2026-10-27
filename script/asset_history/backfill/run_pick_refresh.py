"""Refresh current pick forecasts after the app's daily source refresh.

New uncomplicated fixed-pick trades can enter through a guarded structural
parser. New protected/basket/swap clauses stop publication for source review;
they never disappear from a team's inventory as if worth zero.
"""
from __future__ import annotations
import argparse,hashlib,json,re
from collections import defaultdict
from pathlib import Path
from pick_event_evidence import extract
from pick_replay import active_rules,load_actions,display_years
from league_pick_values import simulate,value_portfolio,TEAMS

def current_forecast(repo,asof):
    results=json.loads((repo/'raw/live/results.json').read_text());season=int(results['season'])
    rows=json.loads((repo/f'frontend/public/data/v2/team_projections/{season}.json').read_text())
    rows=[r for r in rows if r['scenario_id']=='base']
    if len(rows)!=30 or {r['team']for r in rows}!=TEAMS:raise ValueError('Incomplete current team forecasts')
    if any(r.get('schedule_as_of','')!=asof for r in rows):raise ValueError('Team forecast date differs from asset observation')
    if results['generated_at'][:10]!=asof or results['teams_checked']!=30:raise ValueError('Current results source is not aligned')
    record={t:{'wins':0,'gp':0,'season_ending':season}for t in TEAMS}
    for game in results['games']:
        if not game.get('is_completed')or game['date']>asof:continue
        home,away=game['home_team'],game['away_team'];record[home]['gp']+=1;record[away]['gp']+=1
        winner=home if game['home_score']>game['away_score']else away
        record[winner]['wins']+=1
    anchor_path=repo/'processed/asset_history/picks/daily_team_rating_anchor.json'
    if not anchor_path.exists():raise ValueError('Missing daily team-rating source calibration')
    anchor=json.loads(anchor_path.read_text())
    if anchor['known_from']>asof or set(anchor['teams'])!=TEAMS:raise ValueError('Invalid dated team-rating anchor')
    ratings=[dict(team_alias=r['team'],net=float(anchor['teams'][r['team']]['forecast_net'])+float(r['total'])-float(anchor['teams'][r['team']]['app_net']),date=asof,season=season)for r in rows]
    return ratings,record

def new_pick_actions(events,catalog,asof,first_display_year):
    known={(e['known_from'],e['source_text'])for e in catalog};extra=[];new_catalog=[];unknown=[]
    for event in events:
        if event['date']>asof or 'trade'not in event['parsed_status']or not re.search(r'\bpicks?\b',event['text'],re.I):continue
        if (event['date'],event['text'])in known:continue
        refs=extract(event)
        row=dict(event_id=event['event_id'],known_from=event['date'],source=event['source'],source_text=event['text'],references=refs)
        new_catalog.append(row)
        simple=refs and all(r['origin_team']in TEAMS and r['from_team']in TEAMS and r['to_team']in TEAMS and not r['qualifier']for r in refs)
        simple=simple and not re.search(r'protect|swap|favorable|conditional|defer|amend|return|void',event['text'],re.I)
        if not simple:
            unknown.append(row);continue
        for j,r in enumerate(refs):
            if r['draft_year']<first_display_year:
                extra.append(dict(event_id=event['event_id'],known_from=event['date'],reviewed=True,source=event['source'],kind='no_future_pick_effect',reason='Selection already completed before the current reporting horizon; no retained future pick claim.'))
                continue
            rule=dict(rule_id=f"AUTO_{event['event_id']}_{j}",kind='transfer',pick=[r['origin_team'],r['draft_year'],r['round']],from_team=r['from_team'],to_team=r['to_team'],known_from=event['date'],order=100000+j,reviewed=True,source=event['source'])
            extra.append(dict(event_id=event['event_id'],known_from=event['date'],reviewed=True,source=event['source'],kind='add_rule',rule=rule))
    return extra,new_catalog,unknown

def run(repo,runtime,asof,output,draws=10000):
    inputs=repo/'processed/asset_history/picks'
    baseline=json.loads((inputs/'opening_baseline.json').read_text());catalog=json.loads((inputs/'dated_events.json').read_text());orders=json.loads((inputs/'dated_orders.json').read_text());model=json.loads((inputs/'trained_pick_model.json').read_text());historical=json.loads((inputs/'forecast_inputs.json').read_text())
    completion={int(y):d for y,d in orders['draft_completion_dates'].items()}
    years=display_years(asof,completion,announced_draft_months=orders.get('announced_draft_months'))
    actions,missing=load_actions()
    if missing:raise ValueError('Missing reviewed pick cohorts')
    events=json.loads((runtime/'monthly_reconstruction/league_ownership/league_events.json').read_text())
    fresh,new_catalog,unknown=new_pick_actions(events,catalog,asof,min(years))
    output.parent.mkdir(parents=True,exist_ok=True)
    if unknown:
        output.with_name('pending_pick_review.json').write_text(json.dumps({'date':asof,'events':unknown},indent=2))
        raise ValueError('New conditional pick terms require review; preserving last validated portfolio')
    view=active_rules(baseline,actions+fresh,asof,catalog+new_catalog)
    if not view['complete']:raise ValueError('Incomplete current legal pick view')
    ratings,standing=current_forecast(repo,asof)
    sim=simulate(asof,ratings,standing,view['rules'],orders['orders'],historical['qualifiers'],draws,max(2033,max(years)))
    result=value_portfolio(asof,view,sim,model,years)
    result['assumptions'].append('Daily team-strength forecasts extend the last reconstructed rating using changes in the app’s team projections, preserving the source basis at the October2026 transition.')
    result['source_fingerprint']=hashlib.sha256(json.dumps([ratings,standing,view],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    output.write_text(json.dumps(result,separators=(',',':'),allow_nan=False))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--runtime-dir',type=Path,required=True);p.add_argument('--as-of',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--draws',type=int,default=10000);a=p.parse_args()
    result=run(a.repo.resolve(),a.runtime_dir.resolve(),a.as_of,a.output,a.draws);print(json.dumps({'date':a.as_of,'teams':len(result['teams']),'total':result['total']}))
