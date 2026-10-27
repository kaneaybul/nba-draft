"""Build full league raw skills from exact cached dated sources, no network."""
import json,pathlib,sys,argparse
parser=argparse.ArgumentParser();parser.add_argument('--skill-dir',type=pathlib.Path,required=True);parser.add_argument('--available-only',action='store_true');args=parser.parse_args()
ROOT=args.skill_dir.resolve();sys.path.insert(0,str(ROOT))
import fetch_monthly_skill as model
from atomic_output import write_json

def cached(label,url,timeout=90):
 if label.startswith('league_pbp_'):
  d=label.removeprefix('league_pbp_');p=ROOT/'matchups'/f'full_league_pbp_{d}.json'
  if not p.exists():raise FileNotFoundError('No complete league PBP cache '+d)
  x=json.loads(p.read_text())
  if not x['complete_team_query_coverage']:raise ValueError('Partial league coverage '+d)
  return {'multi_row_table_data':x['players']}
 p=ROOT/'raw'/(label+'.json')
 if not p.exists():raise FileNotFoundError(label)
 return json.loads(p.read_text())
model.retrieve=cached
complete_dates=[]
for d in sorted(set(model.source_date(d) for d in model.month_cutoffs())):
 p=ROOT/'matchups'/f'full_league_pbp_{d}.json'
 if not p.exists() or not json.loads(p.read_text()).get('complete_team_query_coverage'):
  if not args.available_only:raise ValueError('Cannot publish incomplete league SKILL: '+d)
 else:complete_dates.append(d)
coverage=[];obs=[]
for date in model.month_cutoffs():
 if model.source_date(date) not in complete_dates:continue
 c,o=model.build(date);coverage.append(c);obs.extend(o)
write_json(ROOT/'monthly_skill_observations.json',obs,separators=(',',':'))
write_json(ROOT/'source_coverage.json',coverage,indent=2)
print('league_observation_rows',len(obs),'dates',len(coverage),'min_players',min(c['players']for c in coverage))
