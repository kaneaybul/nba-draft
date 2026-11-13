"""Decode the producer's one continuous impact path without a second forecast."""
import json,math
from rolling_impact import ImpactPath

def path_from_player(player):
 raw=player.get('impact_path_knots_json')
 if raw in(None,''):return None
 knots=json.loads(raw)if isinstance(raw,str)else raw
 clock=float(player['impact_team_game_clock'])
 if not math.isfinite(clock):raise ValueError('Nonfinite team-game clock')
 return ImpactPath(tuple(tuple(x)for x in knots)),clock

def annual_mean(path,year):return path.mean(82*(int(year)-2000),82*(int(year)+1-2000))
