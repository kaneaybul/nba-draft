"""Reconcile a production migration against the old method on identical inputs."""
import argparse,json,math,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from model_version import DATA_VERSION,LEGACY_VERSION,METHOD,data_root
from publish import TEAMS


def report(repo):
    teams=[];players=[];historical={}
    for team in TEAMS:
        series=json.loads((data_root(repo)/'teams'/f'{team}.json').read_text())['snapshots']
        current=series[-1]
        old=json.loads((data_root(repo,LEGACY_VERSION)/'teams'/f'{team}.json').read_text())['snapshots'][-1]
        baseline=0.;priced=0
        for a in current['assets']:
            d=a.get('details',{});before=float(d.get('baseline_quote',a['value']))
            baseline+=before
            if a['kind']!='player':continue
            c=d.get('path_calibration',{})
            if c.get('status')=='priced':priced+=1
            players.append(dict(team=team,player=a['name'],baseline=before,value=a['value'],difference=a['value']-before,
                draft_year=d.get('draft_year'),calibration_status=c.get('status','existing_policy'),
                nba_weight=c.get('nba_weight'),p10=c.get('p10'),p90=c.get('p90')))
        delta=current['total']-baseline
        if not math.isclose(delta,sum(p['difference']for p in players if p['team']==team),abs_tol=.01):raise ValueError('Method impact does not reconcile')
        teams.append(dict(team=team,date=current['date'],baseline_same_source=baseline,value=current['total'],
            difference=delta,priced_young_players=priced,previously_published_date=old['date'],previously_published_total=old['total']))
        historical[team]={}
        for s in series:
            for a in s['assets']:
                state=a.get('details',{}).get('path_calibration',{}).get('status','existing_policy')
                historical[team][state]=historical[team].get(state,0)+1
    result=dict(method=METHOD,version=DATA_VERSION,baseline_method=LEGACY_VERSION,
        basis='Method-only difference on identical current source inputs and owned inventory',
        total_difference=sum(t['difference']for t in teams),teams=teams,players=players,historical_policy_counts=historical)
    target=repo/'processed/asset_history/calibration_release.json';target.write_text(json.dumps(result,indent=2,allow_nan=False))
    print(json.dumps(dict(method=METHOD,total_difference=result['total_difference'],
        jazz=next(t for t in teams if t['team']=='UTA'),jazz_players=[p for p in players if p['team']=='UTA'],
        largest_team_increases=sorted(teams,key=lambda t:-t['difference'])[:5]),separators=(',',':')))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());a=p.parse_args();report(a.repo.resolve())
