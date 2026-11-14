"""Uncalibrated research candidate: endpoint only; service weights unchanged."""
import math
POLICY='candidate-team-games-only-smoothstep-50-87p5-100-v1'
def smoothstep(x):
 x=max(0.,min(1.,float(x)));return x*x*(3.-2.*x)
def ramp(games):
 g=max(0.,min(328.,float(games)))
 for lo,hi,a,b in [(0.,82.,0.,.5),(82.,164.,.5,.875),(164.,328.,.875,1.)]:
  if g<=hi:return a+(b-a)*smoothstep((g-lo)/(hi-lo))
 return 1.
def endpoint_weight(team_games,played_minutes,remaining_seasons):
 if not all(math.isfinite(float(x))and float(x)>=0 for x in [team_games,played_minutes,remaining_seasons]):raise ValueError('Invalid padding ramp evidence')
 base=ramp(team_games)
 release=smoothstep(1.-remaining_seasons) if remaining_seasons<1. else 0.
 return 1.-(1.-base)*(1.-release)
def audit(player,draft,minutes,remaining):
 origin=82*(int(draft)+1-2000)
 raw=player.get('impact_team_game_clock');offset=float(player.get('impact_coordinate_offset')or 0.)
 games=max(0.,min(328.,float(raw)-offset-origin)) if raw not in(None,'')else max(0.,min(328.,82*(4.-remaining)))
 return {'policy':POLICY,'team_games':games,'played_minutes':float(minutes),'minutes_evidence_gate':False,'remaining_development_seasons':float(remaining),'terminal_prior_release':'smoothstep during last original development season, including zero-minute players; no minutes gate','coordinate_policy':'owner-translation-invariant impact clock minus original draft-season origin','weight':endpoint_weight(games,minutes,remaining),'calibrated':False}
