"""Current-only join of certified same-date native player and legal pick packets."""
from pathlib import Path
import json,hashlib,math,copy,sys
TEAMS=set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())
METHOD='peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster'
PICK_SHA='48260fd2e3a47fcc394cd1c4a30b51bbac2637e42fac28a3fd27858dd7fd4c8a'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def check(condition,message):
 if not condition:raise ValueError(message)
def validate_r_join(quote,r):
 # Exact fresh_binding.validate_r_join equivalence, without cross-module import collisions.
 check(r.get('schema')=='nba-daily-role-r-export-v1','Unknown R receipt schema')
 for k in ('asof','model_sha256','healthy_bridge_sha256','signed_book_sha256'):
  check(r.get(k)==quote.get(k) and quote.get(k)is not None,'R/quote mismatch: '+k)
 check(r.get('inputs',{}).get('native_receipt_sha256')==quote.get('native_receipt_sha256') and quote.get('native_receipt_sha256')is not None,'Different native replay for R and quotes')
 check(r.get('teams')==30 and r.get('production')is False,'Incomplete or external R stage')
 return True
def build(base,players,picks,model,proof,asof,roster,history_manifest,reviews,quote_proof,r_receipt):
 validate_r_join(quote_proof,r_receipt)
 check(quote_proof['asof']==asof,'R/quote join date mismatch')
 source_hash=quote_proof.get('source_preparation_receipt_sha256')
 check(isinstance(source_hash,str)and len(source_hash)==64,'Missing fresh source-preparation provenance')
 check(proof['asof']==asof and proof['pick_model_sha256']==PICK_SHA,'Pick proof date/model mismatch')
 check(proof.get('source_mode')=='same_date_native_current','Old/published pick source not allowed for daily join')
 check(picks['date']==asof and picks.get('complete')is True and set(picks['teams'])==TEAMS,'Incomplete or stale picks')
 check(picks.get('source_fingerprint')==proof['source_fingerprint'] and bool(picks.get('source_fingerprint')),'Pick source fingerprint mismatch')
 check(players['source_method']==METHOD and players['method']==METHOD+'-current' and players['observation_date']==asof,'Wrong/stale player packet')
 check(players['model_sha256']=='fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f','Player model mismatch')
 check(len(history_manifest['teams'])==30 and all(t.get('path')==f"/data/asset_history/v20/teams/{t['team']}.json" for t in history_manifest['teams']),'Independent v20 historical paths missing')
 check(history_manifest['method']==METHOD and {t['team']for t in history_manifest['teams']}==TEAMS,'Historical v20 selector not validated')
 slotrows=model['pick_curve'];slots={str(int(r['pick'])):float(r['quote'])for r in slotrows}
 check(len(slotrows)==60 and set(slots)=={str(n)for n in range(1,61)} and all(math.isfinite(v)for v in slots.values()),'Invalid60 slot curve')
 check(model.get('production_policy')=='year-four-assessed-production-paths-v3' and model.get('stock_policy')=='year-four-endpoint-picks-shared-players-v4','Wrong slot policy')
 outplayers=copy.deepcopy(players['players']);owners=players['owners']
 check(set(outplayers)==set(owners),'Missing player ownership')
 for pid,q in outplayers.items():
  check(q['date']==asof and math.isfinite(q['value']),'Stale/nonfinite player')
  if q.get('annual'):check(abs(sum(r['exposure']for r in q['annual'])-4)<1e-8,'Incomplete player path')
 check(owners==roster,'Native player/R roster identity or owner mismatch')
 claims=[];seen=set()
 for team,assets in picks['teams'].items():
  for a in assets:
   check(a['kind']=='pick' and math.isfinite(a['value']),'Invalid pick claim')
   key=(team,a['id']);check(key not in seen,'Duplicate pick claim');seen.add(key)
   claims.append(dict(team=team,origin=a['physical_origin'],year=a['draft_year'],round=a['round'],value=a['value']))
 check(abs(sum(x['value']for x in claims)-picks['total'])<.01,'Pick total mismatch')
 reviewed={}
 for pack in reviews['packages']:
  if pack['date']>asof:continue
  for tr in pack['pick_transfers']:
   if not tr.get('unprotected'):continue
   key=(tr['origin_team'],tr['draft_year'],tr['round']);matches=[p for p in claims if(p['origin'],p['year'],p['round'])==key]
   if len(matches)==1:reviewed[key]={**matches[0],'source_url':pack['sources'][0]}
 result=copy.deepcopy(base)
 result.update(current_observation_date=asof,pick_observation_date=asof,current_source_sha256=source_hash,current_role_initialization='verified_native_evidence_v2_transient_roster_continuation',current_method_scope='same_date_native_player_and_legal_pick_quotes',players=outplayers,picks=claims,slots=slots,reviewed_pick_ownership=list(reviewed.values()),observation_date=asof,season=int(asof[:4])+(int(asof[5:7])>=7),method=METHOD+'-current',asset_history_version='v20',current_quote_source_method=METHOD,current_pick_observation_date=asof,current_pick_source_fingerprint=proof['source_fingerprint'],current_pick_model_sha256=PICK_SHA,current_generated_at=proof['generated_at'])
 for key in ['history_version','historical_quote_release','seasons','generated_at']:
  if key in base:check(result[key]==base[key],'Historical metadata changed')
 return result

def attach_files(base_path,player_path,pick_path,model_path,proof_path,player_proof_path,asof,roster_path,history_manifest_path,reviews_path,r_receipt_path,output):
 load=lambda p:json.loads(Path(p).read_text())
 history_sha=sha(history_manifest_path)
 check(sha(model_path)==PICK_SHA,'Pinned pick file changed');proof=load(proof_path)
 check(sha(pick_path)==proof['pick_packet_sha256'],'Pick packet changed')
 pp=load(player_proof_path);check(sha(player_path)==pp['packet_sha256'] and pp['asof']==asof,'Player packet/proof mismatch')
 rr=load(r_receipt_path);validate_r_join(pp,rr)
 projection_hash=proof['inputs']['team_projections']['sha256']
 check(projection_hash in rr.get('outputs',{}).values(),'Pick forecasts not from verified R export')
 for row in proof['inputs'].values():check(sha(row['path'])==row['sha256'],'Pick input changed')
 result=build(load(base_path),load(player_path),load(pick_path),load(model_path),proof,asof,load(roster_path),load(history_manifest_path),load(reviews_path),pp,rr)
 check(sha(history_manifest_path)==history_sha,'Independent historical selector changed during join')
 result['asset_history_manifest_sha256']=history_sha
 out=Path(output);check(out.resolve()!=Path(history_manifest_path).resolve(),'Cannot overwrite historical manifest');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n')
 return {'date':asof,'players':len(result['players']),'pick_claims':len(result['picks']),'slots':60,'sha256':sha(out),'legacy_dated_metadata_preserved':True,'historical_selector':'v20'}
