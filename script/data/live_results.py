"""Validated final regular-season results, shared with the injury schedule pull."""
from datetime import datetime
from zoneinfo import ZoneInfo
ALIASES = {'UTAH':'UTA','GS':'GSW','NY':'NYK','NO':'NOP','SA':'SAS','WSH':'WAS','PHO':'PHX','BRK':'BKN'}
def build_results(schedules, season, now):
    games = {}
    all_ids = set()
    for team, payload in schedules.items():
        events = [e for e in payload.get('events',[]) if int(e.get('seasonType',{}).get('type',0))==2]
        if len(events)<70: raise ValueError('Incomplete current schedule: '+team)
        for event in events:
            all_ids.add(str(event['id']))
            c=event['competitions'][0]
            if not c.get('status',{}).get('type',{}).get('completed',False): continue
            teams={x['homeAway']:x for x in c['competitors']}
            def abbr(x):
                a=x['team']['abbreviation'];return ALIASES.get(a,a)
            def score(x):
                s=x['score'];return int(s['value'] if isinstance(s,dict) else s)
            home,away=teams['home'],teams['away'];hs,aws=score(home),score(away)
            if hs==aws or min(hs,aws)<1: raise ValueError('Invalid final score')
            when=datetime.fromisoformat(event['date'].replace('Z','+00:00'))
            if when>now: raise ValueError('Future final game')
            row=dict(game_id=str(event['id']),date=when.astimezone(ZoneInfo('America/New_York')).date().isoformat(),home_team=abbr(home),away_team=abbr(away),home_score=hs,away_score=aws,is_completed=True,result=abbr(home) if hs>aws else abbr(away))
            if row['game_id'] in games and games[row['game_id']]!=row: raise ValueError('Conflicting final scores')
            games[row['game_id']]=row
    if len(all_ids)<1100: raise ValueError('Incomplete league schedule')
    return dict(schema_version=1,season=season,generated_at=now.isoformat(),source='ESPN final regular-season scores',teams_checked=len(schedules),games=sorted(games.values(),key=lambda g:(g['date'],g['game_id'])))
