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

def reconstruct(players,current_picks,legacy,events,asof,current_sources):
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
            picks={'complete':True,'teams':{t:copy.deepcopy([a for a in legacy[t][day]['assets']if a['kind']=='pick'])for t in TEAMS},
                'assumptions':[a for a in first.get('assumptions',[])if a!=HISTORICAL_INJURIES]}
            sources=first.get('source_dates');vintage='reconstructed'
        batch=assemble(rows,{day:picks},events,vintage,sources,previous)
        for snapshot in batch:
            snapshot['valuation_revision']={'method':METHOD,'prior_method':'peak4-payroll-0.8-'+LEGACY_VERSION,
                'nba_forecast_weight':'Young players: completed and current observed NBA minutes; first-season draft prior retained',
                'path_valuation':'Expected payoff of complete linked career paths; veteran and generic pick policies retained'}
            previous[snapshot['team']]=snapshot
        out.extend(batch)
    return out

