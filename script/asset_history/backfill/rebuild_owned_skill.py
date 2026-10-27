"""Rebuild observed evidence while preserving explicitly absent owned samples."""
import argparse,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);a=p.parse_args();root=a.skill_dir.resolve();sys.path.insert(0,str(root));import fetch_monthly_skill as model
from atomic_output import write_json

def cached(label,url,timeout=90):
 if label.startswith('league_pbp_'):
  d=label.removeprefix('league_pbp_');f=root/'matchups'/f'league_owned_pbp_{d}.json';x=json.loads(f.read_text());return {'multi_row_table_data':x['players']}
 f=root/'raw'/(label+'.json')
 if not f.exists():raise FileNotFoundError(label)
 return json.loads(f.read_text())
model.retrieve=cached;coverage=[];observations=[]
for d in model.month_cutoffs():
 c,o=model.build(d);e=json.loads((root/'matchups'/f'league_owned_pbp_{model.source_date(d)}.json').read_text())['coverage'];c['owned_evidence_coverage']=e
 reconstructed={int(r['EntityId']):r for r in json.loads((root/'matchups'/f'league_owned_pbp_{model.source_date(d)}.json').read_text())['players']}
 for r in o:
  m=reconstructed.get(int(r['nba_id']),{});r['source_cutoff']=model.source_date(d)
  if m.get('_reconstructed_by'):
   r['source_reconstruction']={'method':m['_reconstructed_by'],'NBA_reference_disagreement':m.get('_NBA_reference_disagreement'),'held_OREB_reason':m.get('_OREB_reconstruction_flag'),'unused_negative_counts':m.get('_unused_negative_counts')}
   r['current_raw_source']='Same-source PBP additive-count reconstruction; available components observed, flagged discrepancies and unavailable OREB denominator retained'
  elif m:r['current_raw_source']='Direct PBPStats cutoff or completed regular-season totals; GP from dated NBA' 
 coverage.append(c);observations.extend(o)
baseline=root/'baseline_monthly_skill_observations.json'
if baseline.exists():
 lookup={(r['date'],r['nba_id']):r for r in observations}
 for r in json.loads(baseline.read_text()):
  k=r['date'],r['nba_id'];old=lookup.get(k)
  if old and old['games']>=r['games']:continue
  lookup[k]=r
 observations=list(lookup.values())
supplement=root/'player_supplements.json'
if supplement.exists():
 lookup={(r['date'],r['nba_id']):r for r in observations}
 for r in json.loads(supplement.read_text()):
  k=r['date'],r['nba_id'];old=lookup.get(k)
  if old and old['games']>=r['games']:continue
  lookup[k]=r
 observations=list(lookup.values())
# Completed-season raw observations are already known at April30 and every
# carried offseason cutoff. Use the canonical audited Databallr converter,
# then recompute SWITCH with the date-specific earlier-only residual model.
from supplement_current_performance import db_observation
lookup={(r['date'],r['nba_id']):r for r in observations};db_cache={};completed_added=[]
for d in model.month_cutoffs():
 sd=model.source_date(d)
 if not sd.endswith('-04-30'):continue
 year=int(sd[:4]);f=root/'raw'/f'db_full_{year}.json'
 if not f.exists():continue
 if year not in db_cache:
  db_cache[year]=[db_observation(sd,int(r['nba_id']),r.get('Name',str(r['nba_id'])),r) for r in json.loads(f.read_text())]
 count=0
 for row in db_cache[year]:
  k=d,row['nba_id']
  old=lookup.get(k)
  if old and (old['games']>=row['games'] or old.get('current_raw_source','').startswith('Direct PBPStats')):continue
  lookup[k]=dict(row,date=d);count+=1
 completed_added.append({'date':d,'source_cutoff':sd,'new_completed_season_player_rows':count})
observations=list(lookup.values());write_json(root/'completed_league_observation_audit.json',completed_added,indent=2)
write_json(root/'monthly_skill_observations.json',observations,separators=(',',':'));write_json(root/'source_coverage.json',coverage,indent=2)
print('Observed rows',len(observations),'months',len(coverage))
