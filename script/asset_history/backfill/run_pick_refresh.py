"""Refresh current pick forecasts after the app's daily source refresh.

New trades require an independently reviewed complete package, including trades
whose source text omits picks. Reviewed fixed-pick transfers enter the replay;
unresolved packages or conditional terms stop publication for source review.
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

def reviewed_trade_package(event, packages):
    """Match the reviewed deal, including participants and transfer direction.

    Register event IDs/text can change when a source fills in missing terms.
    The dated complete player package prevents matching a different trade.
    """
    names={p['name'] for p in event.get('players',[])}
    routes={a['player_name']:a['to_team'] for a in event.get('parsed_actions',[])
            if a.get('action')=='transfer'}
    matches=[p for p in packages if p['date']==event['date'] and set(p['players'])==names
             and p['player_destinations']==routes and all(t in event['text'] for t in p['team_names'])]
    if len(matches)>1:raise ValueError('Ambiguous reviewed trade package')
    return matches[0] if matches else None

def new_pick_actions(events,catalog,asof,first_display_year,reviews=None):
    if reviews is None:
        reviews=json.loads(Path(__file__).with_name('reviewed_trade_packages.json').read_text())
    known={(e['known_from'],e['source_text'])for e in catalog};extra=[];new_catalog=[];unknown=[]
    seen_packages=set();seen_events=set()
    for event in events:
        if event['date']>asof or 'trade'not in event['parsed_status']:continue
        if (event['date'],event['text'])in known:continue
        package=reviewed_trade_package(event,reviews['packages'])
        source=event['source']
        if package:
            if package['id'] in seen_packages:continue
            if not package.get('pick_terms_complete') or not package.get('sources'):
                raise ValueError('Reviewed trade package lacks complete sourced pick terms')
            seen_packages.add(package['id']);source=package['sources']
            refs=[]
            for transfer in package['pick_transfers']:
                if (transfer.get('unprotected') is not True or
                    any(transfer.get(k) not in TEAMS for k in ('origin_team','from_team','to_team')) or
                    transfer['round'] not in (1,2) or transfer['from_team']==transfer['to_team']):
                    raise ValueError('Reviewed package needs explicit unprotected transfers; complex terms require legal-rule review')
                refs.append({**transfer,'qualifier':None})
        else:
            refs=extract(event)
        row=dict(event_id=event['event_id'],known_from=event['date'],source=source,source_text=event['text'],references=refs)
        if package:row['reviewed_package_id']=package['id']
        # The seed is a bounded reviewed history, not evidence that a later
        # player's return is empty. Every new deal needs its complete package.
        if event['date']>reviews['reviewed_register_through'] and package is None:
            row['reason']='Complete new trade package not independently verified; register text may omit picks'
            new_catalog.append(row);unknown.append(row);continue
        if not package and not re.search(r'\bpicks?\b',event['text'],re.I):continue
        event_key=(event['date'],event['text'])
        if event_key in seen_events:continue
        seen_events.add(event_key);new_catalog.append(row)
        if package and not refs:
            if not package.get('no_pick_reason'):raise ValueError('No-pick review requires a reason')
            extra.append(dict(event_id=event['event_id'],known_from=event['date'],reviewed=True,source=source,kind='no_future_pick_effect',reason=package['no_pick_reason']))
            continue
        simple=refs and all(r['origin_team']in TEAMS and r['from_team']in TEAMS and r['to_team']in TEAMS and not r['qualifier']for r in refs)
        simple=simple and (package is not None or not re.search(r'protect|swap|favorable|conditional|defer|amend|return|void',event['text'],re.I))
        if not simple:
            unknown.append(row);continue
        for j,r in enumerate(refs):
            if r['draft_year']<first_display_year:
                extra.append(dict(event_id=event['event_id'],known_from=event['date'],reviewed=True,source=source,kind='no_future_pick_effect',reason='Selection already completed before the current reporting horizon; no retained future pick claim.'))
                continue
            rule=dict(rule_id=f"AUTO_{event['event_id']}_{j}",kind='transfer',pick=[r['origin_team'],r['draft_year'],r['round']],from_team=r['from_team'],to_team=r['to_team'],known_from=event['date'],order=100000+j,reviewed=True,source=source)
            extra.append(dict(event_id=event['event_id'],known_from=event['date'],reviewed=True,source=source,kind='add_rule',rule=rule))
    return extra,new_catalog,unknown

def run(repo,runtime,asof,output,draws=10000,model_path=None,use_published_inputs=False):
    inputs=repo/'processed/asset_history/picks'
    baseline=json.loads((inputs/'opening_baseline.json').read_text());catalog=json.loads((inputs/'dated_events.json').read_text());orders=json.loads((inputs/'dated_orders.json').read_text());model=json.loads((inputs/'trained_pick_model.json').read_text());historical=json.loads((inputs/'forecast_inputs.json').read_text())
    if model_path is not None:model=json.loads(model_path.read_text())
    completion={int(y):d for y,d in orders['draft_completion_dates'].items()}
    years=display_years(asof,completion,announced_draft_months=orders.get('announced_draft_months'))
    actions,missing=load_actions()
    if missing:raise ValueError('Missing reviewed pick cohorts')
    events=json.loads((runtime/'monthly_reconstruction/league_ownership/league_events.json').read_text())
    fresh,new_catalog,unknown=new_pick_actions(events,catalog,asof,min(years))
    output.parent.mkdir(parents=True,exist_ok=True)
    if unknown:
        output.with_name('pending_pick_review.json').write_text(json.dumps({'date':asof,'events':unknown},indent=2))
        raise ValueError('New trade package or conditional pick terms require review; preserving last validated portfolio')
    view=active_rules(baseline,actions+fresh,asof,catalog+new_catalog)
    if not view['complete']:raise ValueError('Incomplete current legal pick view')
    if use_published_inputs:
        if asof not in historical['ratings']or asof not in historical['standings']:
            raise ValueError('Method-only pick replay needs the exact published dated forecast')
        ratings,standing=historical['ratings'][asof],historical['standings'][asof]
    else:
        ratings,standing=current_forecast(repo,asof)
    sim=simulate(asof,ratings,standing,view['rules'],orders['orders'],historical['qualifiers'],draws,max(2033,max(years)))
    result=value_portfolio(asof,view,sim,model,years)
    result['assumptions'].append('Daily team-strength forecasts extend the last reconstructed rating using changes in the app’s team projections, preserving the source basis at the October2026 transition.')
    result['source_fingerprint']=hashlib.sha256(json.dumps([ratings,standing,view],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    from pick_forecast_capture import capture
    capture(inputs/'forecast_inputs.json',asof,ratings,standing)
    output.write_text(json.dumps(result,separators=(',',':'),allow_nan=False))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--runtime-dir',type=Path,required=True);p.add_argument('--as-of',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--draws',type=int,default=10000);a=p.parse_args()
    result=run(a.repo.resolve(),a.runtime_dir.resolve(),a.as_of,a.output,a.draws);print(json.dumps({'date':a.as_of,'teams':len(result['teams']),'total':result['total']}))
