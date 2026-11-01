"""Restore the actual game clock that belonged to a saved source panel."""
import csv,json

def restore_panel_clock(runtime,payload,results_path):
    from extend_daily_inputs import appendcsv
    monthly=runtime/'monthly_reconstruction';day=payload['date']
    standings=payload.get('standings');audit=payload.get('daily_input_audit')
    if not standings or not audit:
        coverage=payload.get('coverage',[])
        if not coverage or 'performance_cutoff' not in coverage[0]:
            raise ValueError('Saved panel has no observed game cutoff; cannot reconstruct its clock')
        cutoff=coverage[0]['performance_cutoff']
        if cutoff and cutoff>day:raise ValueError('Saved panel game cutoff is after its observation')
        played=[g for g in json.loads(results_path.read_text())['games']if g.get('is_completed')and cutoff and g['date']<=cutoff]
        with (monthly/'pick_forecasts/standings_monthly.csv').open()as f:meta={r['team_alias']:r for r in csv.DictReader(f)}
        teams=sorted({r['team']for panel in payload['roster']for r in panel['roster']})
        standings=[];dates={}
        for team in teams:
            games=[g for g in played if team in(g['home_team'],g['away_team'])];dates[team]=[g['date']for g in games]
            wins=sum(g['result']==team for g in games)
            standings.append({'cutoff':day,'season_ending':int(day[:4])+(int(day[5:7])>=7),'team_alias':team,
                'team_id':meta[team]['team_id'],'team_name':meta[team]['team_name'],'gp':len(games),'wins':wins,
                'losses':len(games)-wins,'win_pct':wins/len(games)if games else 0,
                'last_game_date':max(dates[team],default=None),
                'point_differential':sum((g['home_score']-g['away_score'])*(1 if g['home_team']==team else -1)for g in games),
                'points_scored':sum(g['home_score']if g['home_team']==team else g['away_score']for g in games)})
        audit={'date':day,'completed_team_dates':dates,'performance_cutoff':cutoff,'scope':'Saved panel observed game clock'}
    appendcsv(monthly/'pick_forecasts/standings_monthly.csv',standings,day,'cutoff')
    path=monthly/'daily_input_history.json';history=json.loads(path.read_text())if path.exists()else[]
    history=[r for r in history if r['date']!=day]+[audit]
    path.write_text(json.dumps(history,separators=(',',':')))
