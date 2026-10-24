"""Current NBA assignment score, matching script/switch/switchprocess.txt.

Optional tracking data fail closed: unavailable is not zero or cached history.
"""
import json, math, statistics, urllib.parse, urllib.request
from datetime import datetime, timezone

def nba_table(endpoint, params, table):
    url='https://stats.nba.com/stats/'+endpoint+'?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'})
    with urllib.request.urlopen(req,timeout=20) as response: data=json.load(response)
    sets=data.get('resultSets',[])
    found=next(x for x in sets if x['name']==table)
    return [dict(zip(found['headers'],row)) for row in found['rowSet']],data.get('parameters',{})

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
        g=groups.setdefault(defender,{'poss':0,'pts':0,'C':0,'F':0,'G':0,'games':0})
        g['poss']+=poss;g['pts']+=poss*pts;g[pos]+=poss
        g['games']=max(g['games'],int(r['GP']))
    # Require enough distinct defenders for the original season z-score.
    # Partial game coverage retains the prior rather than using all season minutes.
    groups={pid:g for pid,g in groups.items() if g['games']>=int(lookup[pid]['GamesPlayed']) and g['poss']>0}
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
           'source':'https://stats.nba.com/stats/leagueseasonmatchups','status':'unavailable','reason':'','matchup_rows':0}
    try:
        rows,params=nba_table('leagueseasonmatchups',dict(LeagueID='00',Season=label,SeasonType='Regular Season',DefTeamID=0,OffTeamID=0,DefPlayerID=0,OffPlayerID=0,PerMode='Totals'),'SeasonMatchups')
        if params.get('SeasonYear',params.get('Season'))!=label: raise ValueError('Matchup season mismatch')
        if params.get('SeasonType')!='Regular Season': raise ValueError('Matchup season type mismatch')
        audit['matchup_rows']=len(rows)
        if not rows:
            audit['reason']='NBA returned an empty current-season matchup table; SWITCH remains at preseason.'
            return {},audit
        expected='2'+str(season-1)
        if any(str(r.get('SEASON_ID'))!=expected for r in rows): raise ValueError('Matchup row season mismatch')
        pos,_=nba_table('playerindex',dict(LeagueID='00',Season=label,Historical=0,TeamID=0),'PlayerIndex')
        positions={int(r['PERSON_ID']):str(r['POSITION'])[:1] for r in pos}
        scores=score_assignments(rows,players,positions)
        audit.update(status='assignments_available',reason='Assignment data available; perimeter inputs must also pass validation.')
        return scores,audit
    except Exception as error:
        audit['reason']='Current matchup data unavailable or failed validation ('+type(error).__name__+'); SWITCH remains at preseason.'
        return {},audit
