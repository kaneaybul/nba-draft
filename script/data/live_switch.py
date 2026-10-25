"""Current NBA assignment score, matching script/switch/switchprocess.txt.

Optional tracking data fail closed: unavailable is not zero or cached history.
"""
import math, statistics, os
from datetime import datetime, timezone
from pathlib import Path
from live_positions import matchup_position
from nba_transport import nba_table
from matchup_snapshot import read_snapshot

def diagnose_nba_access(season):
    """Deliberate controls; another season is never used as rating evidence."""
    from concurrent.futures import ThreadPoolExecutor
    label = f'{season-1}-{str(season)[-2:]}'
    prior = f'{season-2}-{str(season-1)[-2:]}'
    def probe(item):
        endpoint, params, table = item
        audit = []
        try: nba_table(endpoint, params, table, audit, timeouts=(25,))
        except Exception: pass
        return audit
    common = dict(LeagueID='00', SeasonType='Regular Season', PerMode='Totals',
                  DefTeamID='', OffTeamID='', DefPlayerID='', OffPlayerID='')
    probes = [('leagueseasonmatchups',dict(common,Season=label),'SeasonMatchups'),
              ('leagueseasonmatchups',dict(common,Season=prior),'SeasonMatchups'),
              ('playerindex',dict(LeagueID='00',Season=label,Historical=0,TeamID=0),'PlayerIndex')]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(probe, probes))
    return dict(checked_at=datetime.now(timezone.utc).isoformat(), season=season,
                controls=[x for result in results for x in result])

def zscores(values):
    if len(values)<2 or statistics.stdev(values)<=0: raise ValueError('Degenerate assignment distribution')
    mean=statistics.mean(values);sd=statistics.stdev(values)
    return [(v-mean)/sd for v in values]

def score_assignments(matchups, players, positions):
    lookup={int(r['nba_id']):r for r in players}
    groups={};seen=set()
    for r in matchups:
        defender=int(r['DEF_PLAYER_ID']);offender=int(r['OFF_PLAYER_ID'])
        key=(defender,offender)
        if key in seen: raise ValueError('Duplicate matchup pair')
        seen.add(key)
        if defender not in lookup or offender not in lookup: continue
        pos=positions.get(offender);pts=lookup[offender].get('d_Points_Per100')
        if pos not in ('C','F','G') or pts is None: continue
        poss=float(r['PARTIAL_POSS']);pts=float(pts)
        if not math.isfinite(poss) or not math.isfinite(pts) or poss<0: raise ValueError('Invalid matchup values')
        if poss==0: continue
        g=groups.setdefault(defender,{'poss':0,'pts':0,'C':0,'F':0,'G':0,'games':{}})
        g['poss']+=poss;g['pts']+=poss*pts;g[pos]+=poss
        team=lookup[offender].get('TeamId')
        if team is not None:
            team=str(team);g['games'][team]=max(g['games'].get(team,0),int(r['GP']))
    # Require enough distinct defenders for the original season z-score.
    # Partial game coverage retains the prior rather than using all season minutes.
    groups={pid:g for pid,g in groups.items() if sum(g['games'].values())>=int(lookup[pid]['GamesPlayed']) and g['poss']>0}
    if len(groups)<100: raise ValueError('Insufficient complete matchup coverage')
    ids=list(groups);difficulty=[];versatility=[]
    for pid in ids:
        g=groups[pid];p=g['poss'];difficulty.append(g['pts']/p)
        versatility.append(-math.sqrt(2*(g['C']/p)**2+(g['F']/p)**2+(g['G']/p)**2))
    score=zscores([.5*a+.5*b for a,b in zip(zscores(difficulty),zscores(versatility))])
    return {str(pid):v for pid,v in zip(ids,score)}

def refresh_assignments(players,season):
    label=f'{season-1}-{str(season)[-2:]}'
    audit={'season':season,'season_label':label,'checked_at':datetime.now(timezone.utc).isoformat(),
           'source':'https://stats.nba.com/stats/leagueseasonmatchups','status':'unavailable','reason':'','matchup_rows':0,'requests':[]}
    try:
        snapshot = Path(os.environ.get('NBA_MATCHUP_SNAPSHOT',str(Path(__file__).resolve().parents[2]/'raw/live/matchup_snapshot.json')))
        rows = None
        if snapshot.exists():
            try:
                rows,metadata = read_snapshot(snapshot,season)
                params = metadata['parameters']
                audit.update(transport='verified_external_snapshot',snapshot_generated_at=metadata['generated_at'],snapshot_sha256=metadata['sha256'])
            except Exception as error:
                audit['snapshot_rejected']=str(error)
        if rows is None:
            # The runner's direct network path is known to stall. A bounded
            # fallback preserves availability without delaying every daily run.
            timeouts = (20,) if os.environ.get('GITHUB_ACTIONS')=='true' else (60,90)
            rows,params=nba_table('leagueseasonmatchups',dict(LeagueID='00',Season=label,SeasonType='Regular Season',DefTeamID='',OffTeamID='',DefPlayerID='',OffPlayerID='',PerMode='Totals'),'SeasonMatchups',audit['requests'],timeouts=timeouts)
            audit['transport']='direct_nba'
        if params.get('SeasonYear',params.get('Season'))!=label: raise ValueError('Matchup season mismatch')
        if params.get('SeasonType')!='Regular Season': raise ValueError('Matchup season type mismatch')
        audit['matchup_rows']=len(rows)
        if not rows:
            audit['reason']='NBA returned an empty current-season matchup table; SWITCH remains at preseason.'
            return {},audit
        expected='2'+str(season-1)
        if any(str(r.get('SEASON_ID'))!=expected for r in rows): raise ValueError('Matchup row season mismatch')
        # Reuse daily positions instead of making another NBA API request.
        positions={int(r['nba_id']):matchup_position(r.get('Pos2')) for r in players}
        scores=score_assignments(rows,players,positions)
        audit.update(status='assignments_available',reason='Assignment data available; perimeter inputs must also pass validation.')
        return scores,audit
    except Exception as error:
        audit['error_type']=type(error).__name__
        audit['reason']='Current matchup data unavailable or failed validation ('+type(error).__name__+': '+str(error)[:300]+'); SWITCH remains at preseason.'
        return {},audit

