"""Measure cross-provider disagreement using independently retrieved cutoffs."""
import argparse,json,pathlib,math
p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);a=p.parse_args();root=a.skill_dir.resolve();raw=root/'raw';records=[];cutoffs=[]
for f in sorted(raw.glob('league_pbp_*.json')):
 if f.name.endswith('.source.json'):continue
 d=f.stem.removeprefix('league_pbp_')
 # The latest provisional season can have a known publishing lag; do not use
 # it to enlarge a historical source-definition discrepancy envelope.
 if d>='2026-10-01':continue
 x=json.loads(f.read_text())
 if x.get('source_method')or x.get('reconstruction_audit'):continue
 cutoffs.append(d);ref={int(r['nba_id']):r for r in json.loads((raw/f'nba_assignment_inputs_{d}.json').read_text())['players']}
 for z in x['multi_row_table_data']:
  pid=int(z['EntityId']);n=ref.get(pid)
  if not n or n['minutes']<=0:continue
  seconds=float(z.get('SecondsPlayed',float(z.get('Minutes',0))*60));records.append({'date':d,'nba_id':pid,'name':z['Name'],'point_delta':float(z.get('Points',0))-n['points'],'minute_delta':seconds/60-n['minutes'],'NBA_points':n['points'],'NBA_minutes':n['minutes']})
maxpoints=max(abs(r['point_delta'])for r in records);maxminutes=max(abs(r['minute_delta'])for r in records)
x={'scope':'Empirical maximum cross-provider disagreement in independent direct cumulative PBP sources vs dated official NBA references; latest provisional season excluded','direct_cutoffs':cutoffs,'comparison_rows':len(records),'point_tolerance':float(math.ceil(maxpoints)),'minute_tolerance':float(math.ceil(maxminutes)),'observed_max_point_difference':maxpoints,'observed_max_minute_difference':maxminutes,'point_disagreements':sum(abs(r['point_delta'])>.00001 for r in records),'all_disagreements_logged':True,'rows':[r for r in records if abs(r['point_delta'])>.00001 or abs(r['minute_delta'])>.00001]};(root/'direct_source_tolerance.json').write_text(json.dumps(x,indent=2));print({k:v for k,v in x.items()if k!='rows'})
