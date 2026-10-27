"""Separate missing observed performance from expected no-game rookie priors."""
import argparse,csv,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('--skill-dir',type=pathlib.Path,required=True);p.add_argument('--rosters',type=pathlib.Path,required=True);a=p.parse_args();root=a.skill_dir.resolve();sys.path.insert(0,str(root));from fetch_monthly_skill import source_date,month_cutoffs
obs={(r['date'],int(r['nba_id'])):r for r in json.loads((root/'monthly_skill_observations.json').read_text())};blended={(r['date'],int(r['nba_id'])):r for r in csv.DictReader((root/'monthly_blended_skills.csv').open())};rosters=json.loads(a.rosters.read_text());nba={};rows=[]
for snapshot in rosters:
 d=snapshot['cutoff_date']
 if d not in month_cutoffs():continue
 sd=source_date(d);f=root/'raw'/f'nba_assignment_inputs_{sd}.json'
 if not f.exists():continue
 if sd not in nba:nba[sd]={int(r['nba_id']):r for r in json.loads(f.read_text())['players']}
 teams={}
 for r in snapshot['roster']:
  if r.get('nba_id')is None:continue
  pid=int(r['nba_id']);team=r['team'];row=teams.setdefault(team,{'date':d,'source_cutoff':sd,'team':team,'owned_identified_players':0,'owned_with_current_NBA_games':0,'with_observed_current_performance':0,'with_blended_SKILL':0,'no_current_NBA_sample':[],'missing_current_performance':[],'missing_blended_SKILL':[],'accepted_source_discrepancies':[],'held_current_OREB':[],'completed_season_GP_metadata_discrepancies':[]});row['owned_identified_players']+=1
  ref=nba[sd].get(pid);ob=obs.get((d,pid));blend=blended.get((d,pid))
  if ob and ob.get('source_reconstruction'):
   meta=ob['source_reconstruction']
   if meta.get('NBA_reference_disagreement'):row['accepted_source_discrepancies'].append({'nba_id':pid,'name':r['player_name'],**meta['NBA_reference_disagreement']})
   if meta.get('held_OREB_reason'):row['held_current_OREB'].append({'nba_id':pid,'name':r['player_name'],'reason':meta['held_OREB_reason']})
  if blend:row['with_blended_SKILL']+=1
  else:row['missing_blended_SKILL'].append({'nba_id':pid,'name':r['player_name'],'current_NBA_minutes':ref['minutes']if ref else 0})
  if not ref or ref['games']<=0:row['no_current_NBA_sample'].append({'nba_id':pid,'name':r['player_name']});continue
  row['owned_with_current_NBA_games']+=1
  completed_GP_convention=bool(ob and sd.endswith('-04-30') and 'Completed regular-season Databallr' in ob.get('current_raw_source','') and abs(ob['games']-ref['games'])<=1 and abs(ob['minutes']-ref['minutes'])<=.51)
  if completed_GP_convention and ob['games']!=ref['games']:row['completed_season_GP_metadata_discrepancies'].append({'nba_id':pid,'name':r['player_name'],'source_games':ob['games'],'NBA_games':ref['games'],'source_minutes':ob['minutes'],'NBA_minutes':ref['minutes'],'reason':'Known completed-season source and full-season minutes agree within displayed minute rounding; game-count convention differs'})
  if ob and (ob['games']>=ref['games'] or completed_GP_convention):row['with_observed_current_performance']+=1
  else:row['missing_current_performance'].append({'nba_id':pid,'name':r['player_name'],'NBA_games':ref['games'],'NBA_minutes':ref['minutes'],'observed_games':ob['games']if ob else None})
 for row in teams.values():row['all_owned_current_samples_observed']=not row['missing_current_performance'];rows.append(row)
summary={'scope':'Actual dated ownership; a missing current NBA sample is separate from unavailable current performance','team_months':len(rows),'team_months_all_current_samples_observed':sum(r['all_owned_current_samples_observed']for r in rows),'missing_current_player_months':sum(len(r['missing_current_performance'])for r in rows),'rows':rows};(root/'owned_skill_coverage.json').write_text(json.dumps(summary,indent=2));print({k:v for k,v in summary.items()if k!='rows'})
