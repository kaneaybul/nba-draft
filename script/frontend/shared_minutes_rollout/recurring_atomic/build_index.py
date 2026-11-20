"""Build atomic public player/pick index from genuine native inputs, not a publisher."""
from pathlib import Path
import argparse,copy,json,math
from assemble import VERSION,METHOD,enc,sha,pin,need,rd,pick_keys

def build(base,packet,picks,pick_proof,scope,ledger,source_sha,stamp):
 d=scope['asof'];y=scope['season'];need(base['current_observation_date']==base['pick_observation_date']==picks['date']==pick_proof['asof']==d,'Mixed player/pick/base date');need(picks['complete'] is True and pick_proof['pick_model_sha256']==base['current_pick_model_sha256'],'Wrong legal-pick model')
 if 'players' in packet:
  need(packet['asof']==d and packet['ledger_sha256']==ledger and packet['model_forecast_version']==VERSION,'Wrong native ledger/version/date')
  owned={i:r['team'] for i,r in scope['players'].items()if not r['contract_pending']};need(packet['owners']==owned and set(packet['players'])==set(owned),'Native packet owner differs'); packets={t:[]for t in set(owned.values())}
  for pid,q in packet['players'].items():
   need(q['date']==d,'Native player date differs');packets[owned[pid]].append({'id':'player:nba:'+pid,'value':q['value'],'name':q.get('name'),'details':{'annual_values':q['annual'],'draft_development':q.get('draft_development'),'raw_annual_production':q['raw_annual_production']}})
  packet={'snapshots':[{'date':d,'team':team,'assets':v}for team,v in sorted(packets.items())]}
 teams=packet['snapshots'];need(len(teams)==30 and all(x['date']==d and not x.get('unpriced_players') for x in teams),'Incomplete current pricing');scopep=scope['players'];live=base['players'];expected={i for i,row in scopep.items()if not row['contract_pending']};need(expected==set(live),'Current ownership baseline mismatches signed prices');new={};names={};n0=n1=0
 for book in teams:
  for asset in book['assets']:
   ident=asset['id'];pid=ident.rsplit(':',1)[-1];
   if pid not in expected:continue
   need(pid not in new and scopep[pid]['team']==book['team'],'Native signed player owner mismatch '+pid);details=asset['details'];old=live[pid];raw=details['annual_values'];annual=[{key:float(v[key])if key!='season'else int(v[key]) for key in ('season','production','asset','exposure')}for v in raw];need(annual and abs(sum(x['exposure']for x in annual)-4)<1e-8,'Unpriced 4Y inventory '+pid)
   base_grade=old.get('draft_development')or{};candidate_grade=details.get('draft_development');
   if base_grade.get('completed')is True:grade=copy.deepcopy(base_grade);n0+=1
   elif scopep[pid]['appraisal_seasons']:
    grade=candidate_grade;need(grade and grade['status']=='priced' and grade.get('completed')is False and math.isfinite(grade['value']),'Missing draft appraisal '+pid);need((grade['endpoint'],grade['original_expectation'])==(base_grade['endpoint'],base_grade['original_expectation']),'Draft endpoint/prior changed '+pid);n1+=1
   else:grade=copy.deepcopy(old.get('draft_development'))
   new[pid]={'date':d,'value':float(asset['value']),'annual':annual,'draft_development':grade,'raw_annual_production':details['raw_annual_production'],'role_minutes_policy':VERSION};names[pid]=asset['name']
 need(set(new)==expected and n1==sum(bool(scopep[x]['appraisal_seasons'])for x in expected),'Native signed/appraisal coverage drift')
 picks_by={(t,p['physical_origin'],p['draft_year'],p['round']):p for t,ps in picks['teams'].items() for p in ps};need(set(picks_by)==pick_keys(base) and sum(len(ps)for ps in picks['teams'].values())==len(picks_by),'Legal-pick claims changed');newp=[dict(r,value=picks_by[(r['team'],r['origin'],r['year'],r['round'])]['value'])for r in base['picks']]
 out=copy.deepcopy(base);out.update(players=new,picks=newp,method=METHOD,current_method_scope='same_date_shared_minutes_native_player_and_legal_pick_quotes',current_source_sha256=source_sha,current_generated_at=stamp,current_role_initialization='same_date_verified_shared_player_game_ledger',current_quote_source_method=METHOD.removesuffix('-current'),current_pick_source_fingerprint=picks['source_fingerprint'],shared_minutes_release={'schema':1,'asof':d,'season':y,'forecast_version':VERSION,'ledger_sha256':ledger})
 out['reviewed_pick_ownership']=[dict(r,value=picks_by[(r['team'],r['origin'],r['year'],r['round'])]['value'])for r in base['reviewed_pick_ownership']]
 return out,names,{'players':len(new),'picks':len(newp),'completed_preserved':n0,'open_appraisals_priced':n1}
