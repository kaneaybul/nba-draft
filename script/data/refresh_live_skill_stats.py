"""Fetch current-season skill evidence using the repository's existing Databallr connection.
Never rewrites historical stats or refits model coefficients.
"""
import csv, hashlib, hmac, json, math, pathlib, re, statistics, time, urllib.request, uuid
from datetime import datetime, timezone
ROOT = pathlib.Path(__file__).resolve().parents[2]
SKILLS = {
 'FTD':['I(FTA_100 * FT_PERC)'],
 'SHOOT':['I(X3PA_100 * X3P_PERC)','I(d_ShortMidRangeFGA_Per100 * ShortMidFGPerc)','I(d_LongMidRangeFGA_Per100 * LongMidFGPerc)'],
 'PASS':['d_Assists_Per100','cTOV'], 'RIM':['d_AtRimFGA_Per100','RimFGPerc'], 'OREB':['OffFGReboundPct'],
 'DPM':['Steals_100','d_FTOVs_Per100'], 'DREB':['d_DefRebounds_Per100'],
 'RIMPRO':['d_Blocks_Per100','rim_points_saved_100']}

def number(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except (ValueError,TypeError): return None

def term_value(row, term):
    aliases={'X3PA_100':'3PA_100','X3P_PERC':'3P_PERC'}
    if term.startswith('I('):
        a,b=term[2:-1].split(' * ')
        a=number(row.get(aliases.get(a,a))); b=number(row.get(aliases.get(b,b)))
        if a==0: return 0.0
        return None if a is None or b is None else a*b
    return number(row.get(aliases.get(term,term)))

def read_historical_minutes(path, season):
    with path.open() as f:
        reader=csv.DictReader(f)
        if not {'nba_id','year','Minutes'}.issubset(reader.fieldnames or []):
            raise ValueError('Historical source lacks actual Minutes')
        rows=list(reader)
    out={}
    for row in rows:
        year=int(row['year']); minutes=number(row.get('Minutes'))
        if season-3<=year<season and minutes is not None:
            out.setdefault(str(int(float(row['nba_id']))),{})[str(year)]=max(0,minutes)
    return out

def build_feed(data, season, root=ROOT):
    if len(data)<100 or len(data)>=2000: raise ValueError('Incomplete or truncated current-season stats')
    coefficients={}
    intercepts={}
    for side in ('off','def'):
        with (root/f'processed/modelresults/{side}_lm_1_results.csv').open() as f:
            for row in csv.DictReader(f):
                val=float(row.get('Estimate',row.get('estimate')))
                if row['term']=='(Intercept)': intercepts[side]=val
                else: coefficients[row['term']]=val
    with (root/'processed/livedata/impactrefresh/skilloutput.csv').open() as f:
        history=list(csv.DictReader(f))
    reference=[x for x in history if int(x['year'])==season-1]
    if len(reference)<100: raise ValueError('Missing frozen skill calibration')
    calibration={}
    for skill in SKILLS:
        vals=[number(x.get(skill+'_raw')) for x in reference]; vals=[x for x in vals if x is not None]
        if len(vals)<100 or statistics.stdev(vals)<=0: raise ValueError('Invalid skill calibration: '+skill)
        calibration[skill]={'mean':statistics.mean(vals),'sd':statistics.stdev(vals)}
    historical_minutes=read_historical_minutes(root/'processed/livedata/impactrefresh/impactoutput.csv',season)
    if len(historical_minutes)<100 or sum(str(season-1) in h for h in historical_minutes.values())<100:
        raise ValueError('Historical actual-minute coverage is incomplete')
    players=[]; seen=set()
    for row in data:
        if int(row.get('year',0))!=season or int(row.get('playoffs',0))!=0: raise ValueError('Wrong stats season/type')
        pid=int(row['nba_id']); minutes=number(row.get('Minutes')); games=number(row.get('GamesPlayed'))
        if pid in seen: raise ValueError('Duplicate stats player')
        seen.add(pid)
        if minutes is None or games is None or minutes<0 or minutes>games*70+1: raise ValueError('Invalid actual minutes')
        raw={}
        for skill, terms in SKILLS.items():
            values=[term_value(row,t) for t in terms]
            raw[skill]=None if any(x is None for x in values) else sum(coefficients[t]*v for t,v in zip(terms,values))
        players.append({'nba_id':pid,'player_name':row.get('player_name',row.get('Name')),
                        'team':row.get('TeamAbbreviation'),'minutes':minutes,'games':games,'raw_skills':raw})
    results=json.loads((root/'raw/live/results.json').read_text())
    n=len(results['games']); total=sum(x['minutes'] for x in players)
    if results['season']!=season or not .90*480*n<=total<=1.30*480*n+200:
        raise ValueError('Stats and completed-results coverage disagree')
    return {'schema_version':1,'season':season,'generated_at':datetime.now(timezone.utc).isoformat(),
            'source':'Databallr current regular-season statistics','players':players,
            'historical_minutes':historical_minutes,'calibration':calibration,'intercepts':intercepts,
            'completed_games_at_fetch':n,'total_actual_minutes':total,
            'held_components':['SWITCH'],'note':'Switch/perimeter skill retains its preseason prior until compatible current matchup inputs are available. Missing observed components retain their priors.'}

def main():
    season=json.loads((ROOT/'raw/live/ratings.json').read_text())['season']
    # Reuse existing connection material without logging it or copying it to outputs.
    source=(ROOT/'script/data/pulldataballrstats.txt').read_text()
    key=re.search(r'DATABALLR_API_KEY <- "([^"]+)"',source)[1]
    secret=re.search(r'DATABALLR_SIGNING_SECRET <- "([^"]+)"',source)[1]
    path='/api/supabase/player_stats_with_metrics'
    query=f'year={season}&playoffs=0&min_minutes=0&limit=2000&order_by=dpm&order_direction=desc'
    data=None
    for attempt in range(3):
        ts=str(int(time.time())); nonce=str(uuid.uuid4())
        signature=hmac.new(secret.encode(),':'.join([ts,nonce,'GET',path,query]).encode(),hashlib.sha256).hexdigest()
        req=urllib.request.Request('https://api.databallr.com'+path+'?'+query,headers={
            'X-API-Key':key,'X-Timestamp':ts,'X-Nonce':nonce,'X-Signature':signature,'User-Agent':'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req,timeout=40) as response: data=json.load(response)
            break
        except Exception:
            if attempt==2: raise RuntimeError('Current skill stats unavailable; existing published data preserved') from None
    feed=build_feed(data,season)
    dest=ROOT/'raw/live/skill_stats.json';tmp=dest.with_suffix('.tmp')
    tmp.write_text(json.dumps(feed,allow_nan=False,separators=(',',':'))+'\n');tmp.replace(dest)
    print(f"Current skill evidence: {len(feed['players'])} players, {feed['total_actual_minutes']:.0f} actual minutes, {feed['completed_games_at_fetch']} completed games")
if __name__=='__main__': main()
