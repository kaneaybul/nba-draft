"""Measure the minutes change with identical live inputs on both sides."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ['raw/live/ratings.json', 'raw/live/skill_stats.json', 'raw/live/results.json',
           'raw/live/player_pool.json', 'frontend/public/data/injury_outlook.json']

def source_hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES}

def compare(before, after, output):
    captured = json.loads((before / 'source_hashes.json').read_text())
    if captured != source_hashes():
        raise ValueError('Inputs changed during the before/after comparison')
    old_players = json.loads((before / 'players.json').read_text())
    new_players = json.loads((after / 'impact_players/2027.json').read_text())
    old = {p['nba_id']: p for p in old_players}
    if set(old) != {p['nba_id'] for p in new_players}:
        raise ValueError('Player inclusion changed during the minutes-only comparison')
    fields = ['p_mpg', 'Minutes', 'games', 'score', 'value', 'scalability']
    players = []
    for p in new_players:
        prior = old[p['nba_id']]
        for key in ['total', 'offense', 'defense', 'skill_model_off', 'skill_model_def']:
            if abs(p[key] - prior[key]) > 0.00001:
                raise ValueError(f'Per-minute rating changed: {p["player_name"]} {key}')
        players.append(dict(nba_id=p['nba_id'], player_name=p['player_name'], team=p['team'],
            before={k: prior.get(k) for k in fields}, after={k: p.get(k) for k in fields},
            delta={k: round((p.get(k) or 0) - (prior.get(k) or 0), 3) for k in fields},
            source=p.get('minutes_source'), input_mpg=p.get('minutes_input_mpg'),
            remaining_mpg=p.get('minutes_remaining_mpg')))
    old_teams = {t['team']: t for t in json.loads((before / 'teams.json').read_text()) if t['scenario_id'] == 'base'}
    teams = []
    for t in json.loads((after / 'team_projections/2027.json').read_text()):
        if t['scenario_id'] != 'base':
            continue
        prior = old_teams[t['team']]
        teams.append(dict(team=t['team'],before_wins=prior['projected_wins'],after_wins=t['projected_wins'],
            wins_delta=round(t['projected_wins']-prior['projected_wins'],1),
            before_rating=prior['total'],after_rating=t['total'],rating_delta=round(t['total']-prior['total'],2)))
    result = dict(generated_at=datetime.now(timezone.utc).isoformat(), source_hashes=captured,
        method='Same live ratings, injuries, rosters, schedules and completed results. Only the minutes pipeline and full-rotation aggregation differ.',
        teams=sorted(teams,key=lambda t:abs(t['wins_delta']),reverse=True),
        players=sorted(players,key=lambda p:abs(p['delta']['p_mpg']),reverse=True))
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,allow_nan=False,separators=(',',':'))+'\n')
    print('Minutes-only comparison written:',output)
    print('Jazz:',next(t for t in teams if t['team']=='UTA'))
    print('Peterson:',next(p for p in players if p['player_name']=='Darryn Peterson'))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture',type=Path)
    parser.add_argument('--before',type=Path)
    parser.add_argument('--after',type=Path,default=ROOT/'frontend/public/data/v2')
    parser.add_argument('--output',type=Path,default=ROOT/'raw/live/minutes_impact.json')
    args=parser.parse_args()
    if args.capture:
        (args.capture/'source_hashes.json').write_text(json.dumps(source_hashes()))
    else:
        compare(args.before,args.after,args.output)
