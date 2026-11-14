"""Reprice historical players under a new method, preserving the old archive."""
import copy,json
from assemble import assemble,HISTORICAL_INJURIES
from publish import TEAMS,METHOD
from model_version import LEGACY_VERSION,data_root

def legacy_snapshots(repo):
    result={}
    for team in TEAMS:
        path=data_root(repo,LEGACY_VERSION)/'teams'/f'{team}.json'
        if not path.exists():raise ValueError('Missing legacy inventory for '+team)
        content=json.loads(path.read_text())
        if content.get('method')!='peak4-payroll-0.8-'+LEGACY_VERSION:raise ValueError('Unexpected legacy valuation method')
        result[team]={s['date']:s for s in content['snapshots']}
    return result

def reconstruct(players,current_picks,legacy,events,asof,current_sources,historical_picks=None):
    if set(legacy)!=set(TEAMS):raise ValueError('Historical reconstruction needs all 30 teams')
    dates=sorted({day for points in legacy.values()for day in points if day[:7]<asof[:7]}|{asof})
    byday={}
    for row in players:byday.setdefault(row['date'],[]).append(row)
    out=[];previous={}
    for day in dates:
        rows=byday.get(day,[])
        if len(rows)!=30 or {r['team']for r in rows}!=set(TEAMS):raise ValueError('Missing complete player reconstruction at '+day)
        if day==asof:picks=current_picks;sources=current_sources;vintage='published'
        else:
            if any(day not in legacy[t]for t in TEAMS):raise ValueError('Missing common legacy observation at '+day)
            first=legacy[TEAMS[0]][day]
            picks=historical_picks[day]if historical_picks is not None else {'complete':True,'teams':{t:copy.deepcopy([a for a in legacy[t][day]['assets']if a['kind']=='pick'])for t in TEAMS},
                'assumptions':[a for a in first.get('assumptions',[])if a!=HISTORICAL_INJURIES]}
            sources=first.get('source_dates');vintage='reconstructed'
        batch=assemble(rows,{day:picks},events,vintage,sources,previous)
        for snapshot in batch:
            snapshot['valuation_revision']={'method':METHOD,'prior_method':'peak4-payroll-0.8-'+LEGACY_VERSION,
                'nba_forecast_weight':'Year-four appraisal blended with original draft expectation using completed and current observed NBA minutes',
                'path_valuation':'Direct future-season games and MPG forecasts from completed seasons, with gradual updates from verified appearances'}
            previous[snapshot['team']]=snapshot
        out.extend(batch)
    return out


def reprice_historical_picks(repo,model,dates,draws=10000,runtime=None):
    """Replay joint legal outcomes, never price a protection at its mean slot."""
    from concurrent.futures import ThreadPoolExecutor
    from backfill.pick_replay import active_rules,load_actions,display_years
    from backfill.league_pick_values import simulate,value_portfolio
    inputs=repo/'processed/asset_history/picks'
    forecasts=json.loads((inputs/'forecast_inputs.json').read_text())
    baseline=json.loads((inputs/'opening_baseline.json').read_text())
    catalog=json.loads((inputs/'dated_events.json').read_text())
    orders=json.loads((inputs/'dated_orders.json').read_text())
    actions,missing=load_actions()
    if missing:raise ValueError('Missing historical legal pick cohorts')
    from backfill.run_pick_refresh import new_pick_actions
    events=[]
    if runtime is not None:events=json.loads((runtime/'monthly_reconstruction/league_ownership/league_events.json').read_text())
    saved=repo/'processed/asset_history/player_state/ownership_events.json'
    if saved.exists():
        extra=json.loads(saved.read_text());extra=extra.get('events',extra)if isinstance(extra,dict)else extra
        events=list({(e['event_id'],e['date'],e['text']):e for e in events+extra}.values())
    last=max(dates);first=min(display_years(last,orders['draft_completion_dates'],announced_draft_months=orders.get('announced_draft_months')))
    fresh,extra_catalog,unknown=new_pick_actions(events,catalog,last,first)
    if unknown:raise ValueError('Unreviewed new pick terms prevent historical repricing')
    actions+=fresh;catalog+=extra_catalog
    def one(day):
        earlier=[d for d in forecasts['ratings']if d<=day]
        if not earlier:raise ValueError('No dated pick forecast before '+day)
        source=max(earlier)
        view=active_rules(baseline,actions,day,catalog)
        if not view['complete']:raise ValueError('Incomplete historical legal rights at '+day)
        years=display_years(day,{int(y):d for y,d in orders['draft_completion_dates'].items()},announced_draft_months=orders.get('announced_draft_months'))
        sim=simulate(day,forecasts['ratings'][source],forecasts['standings'][source],view['rules'],orders['orders'],forecasts['qualifiers'],draws,max(2033,max(years)))
        value=value_portfolio(day,view,sim,model,years)
        value['assumptions'].append('Reconstructed career-path pick prices use the fixed current endpoint-trained model and the last archived strength/standings forecast dated '+source+'; legal rights are dated '+day+'.')
        print('Repriced historical picks: '+day,flush=True)
        return day,value
    with ThreadPoolExecutor(max_workers=3)as pool:return dict(pool.map(one,dates))



