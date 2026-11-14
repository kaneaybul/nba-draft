"""Read-only live check using saved perimeter inputs and public NBA data.

No provider credentials or publication are used. The resulting local feed lets
the R perimeter step exercise real matchup data before approving deployment.
"""
import json
from pathlib import Path
from live_positions import build_positions, enrich_stats_positions
from live_switch import refresh_assignments, diagnose_nba_access
from nba_transport import nba_table

def public_player_params(season):
    params=dict(LastNGames=0,MeasureType='Base',Month=0,OpponentTeamID=0,PaceAdjust='N',
        PerMode='Per100Possessions',Period=0,PlusMinus='N',Rank='N',
        Season=f'{season-1}-{str(season)[-2:]}',SeasonType='Regular Season',LeagueID='00',TeamID=0)
    for k in ['College','Conference','Country','DateFrom','DateTo','Division','DraftPick','DraftYear',
              'GameScope','GameSegment','Height','Location','Outcome','PORound','PlayerExperience',
              'PlayerPosition','SeasonSegment','ShotClockRange','StarterBench','TwoWay','VsConference',
              'VsDivision','Weight','ISTRound']:
        params[k]=''
    return params

def main():
    root=Path(__file__).resolve().parents[2]
    path=root/'raw/live/skill_stats.json';feed=json.loads(path.read_text());season=feed['season']
    requests=[]
    try:
        rows,params=nba_table('leaguedashplayerstats',public_player_params(season),'LeagueDashPlayerStats',requests)
        if params.get('Season',params.get('SeasonYear')) != public_player_params(season)['Season']:
            raise ValueError('Public scoring input season mismatch')
        lookup={int(r['PLAYER_ID']):r for r in rows};stats=[]
        for p in feed['players']:
            r=lookup.get(p['nba_id'])
            # Never combine a partial/new game with older perimeter statistics.
            if r is None or int(r['GP'])!=int(p['games']):continue
            stats.append(dict(nba_id=p['nba_id'],player_name=p['player_name'],GamesPlayed=p['games'],
                TeamId=r['TEAM_ID'],d_Points_Per100=r['PTS'],**p.get('perimeter_inputs',{})))
        positions=build_positions(stats,season,root);enrich_stats_positions(stats,positions)
        (root/'raw/live/positions.json').write_text(json.dumps(positions)+'\n')
        scores,audit=refresh_assignments(stats,season)
        by_id={p['nba_id']:p for p in stats}
        for p in feed['players']:
            if p['nba_id'] in by_id:p['perimeter_inputs']['Pos2']=by_id[p['nba_id']]['Pos2']
        feed['switch_assignment_coverage']=audit.pop('player_coverage',{})
        feed['switch_assignments']=scores;feed['switch_status']=audit
        feed['switch_status']['diagnostic_offense_source']='Public NBA Per100Possessions; saved perimeter inputs and matched game counts'
        path.write_text(json.dumps(feed)+'\n')
        report=dict(public_offense_requests=requests,matched_saved_players=len(stats),position_sources=positions['sources'],switch_status=audit)
    except Exception as error:
        report=dict(public_offense_requests=requests,error=type(error).__name__+': '+str(error))
    report['controls']=diagnose_nba_access(season)['controls']
    print('PUBLIC SWITCH DIAGNOSTIC '+json.dumps(report),flush=True)
    (root/'raw/live/switch_diagnostics.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__=='__main__':main()
