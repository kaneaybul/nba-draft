"""One publisher interlock and isolated legacy generation. Never uploads or deploys."""
import argparse,hashlib,json,subprocess,sys
from datetime import date
from pathlib import Path
SHARED='peak4-payroll-0.8-v20-shared-minutes-comparables-career-v3-conditional-tail-current'
LEGACY_ASSEMBLER_SHA='be9111768f4a7c44ee1f2324214f345384cead13cb744c93a949b205019026f0'
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_bytes())
def require(x,m):
 if not x:raise ValueError(m)
def pinned(x):
 p=Path(x['path']).resolve(strict=True);require(digest(p)==x['sha256'],'Hash mismatch: '+p.name);return p
def index(p):return read(p)
def plan(c):
 day=c['requested_asof'];date.fromisoformat(day);live=index(pinned(c['canonical_index']));method=live['method'];cutover=c['shared_cutover_enabled'];require(type(cutover)is bool,'Explicit cutover state required')
 if method==SHARED and not cutover:raise ValueError('Approved config would roll back a live shared method')
 require(c['active_publication_lane']==('shared' if cutover else 'legacy'),'Single active lane required')
 return {'asof':day,'canonical_method':method,'canonical_asof':live['current_observation_date'],'active_publication_lane':c['active_publication_lane'],'legacy_generation_only_after_cutover':cutover,'production':False}
def generation(c,work):
 p=plan(c);a=pinned(c['legacy_assembly_config']);cfg=read(a);require(cfg['asof']==p['asof'],'Wrong legacy generation date');source=pinned(c['legacy_assembler']);require(digest(source)==LEGACY_ASSEMBLER_SHA,'Unreviewed generation-only assembler');require(not work.exists(),'Generation must use a fresh existing Work sibling root');repo=Path(cfg['repo']).resolve();require(repo.parent==work.resolve().parent,'Require isolated sibling in Work');require(str(repo.resolve()).startswith(str(Path(c['isolated_workspace']).resolve())+'/'),'Repo outside isolated root')
 subprocess.run([sys.executable,str(source),'--config',str(a),'--work',str(work),'--execute','--skip-regression'],check=True)
 r=read(work/'assembly_receipt.json');require(r['production'] is False and r['release_ready'] is False and r['asof']==p['asof'],'Legacy adapter improperly claims publication');return {**p,'result':'generated only; no publish permission','receipt_sha256':digest(work/'assembly_receipt.json')}
def rebase_identity(m):
 keys=('rebase_asof','rebase_ledger_sha256','rebase_asset_index_sha256')
 present=[k in m for k in keys];require(all(present) or not any(present),'Partial frozen rebase provenance')
 return (m.get(keys[0],m['asof']),m.get(keys[1],m['ledger_sha256']),m.get(keys[2],m['asset_index_sha256']),m['rebase_sha256'])
def verify_rebase(c,p,dist,ledger):
 manifest=read(dist/'data/manifest.json')['shared_minutes_release'];d=p['asof'];require(manifest['asof']==d and manifest['ledger_sha256']==ledger and manifest['asset_index_sha256']==c['candidate_index']['sha256'],'Active publication bindings differ')
 frozen=rebase_identity(manifest);side=dist/'data/shared_minutes_rebase.json';reb=read(side)
 require(frozen==(reb['asof'],reb['ledger_sha256'],reb['new_index_sha256'],digest(side)) and reb['not_development_or_trade'] is True,'Frozen rebase payload/provenance differs')
 if p['canonical_method']==SHARED:
  canonical=read(pinned(c['canonical_manifest']))['shared_minutes_release'];require(canonical['asof']==p['canonical_asof'] and canonical['asset_index_sha256']==c['canonical_index']['sha256'],'Canonical manifest not tied to canonical bytes')
  require(frozen==rebase_identity(canonical),'Original cutover rebase may not be changed')
  if d!=frozen[0]:require(all(k in manifest for k in ('rebase_asof','rebase_ledger_sha256','rebase_asset_index_sha256')),'Post-cutover release needs explicit frozen provenance')
 else:require(frozen[:3]==(d,ledger,c['candidate_index']['sha256']),'First cutover must bind its same-date rebase')
 return frozen
def verify(c):
 p=plan(c);cur=index(pinned(c['canonical_index']));cand=index(pinned(c['candidate_index']));lane=c['active_publication_lane'];d=p['asof'];require(d>=cur['current_observation_date'],'Rollback date');require(cand['current_observation_date']==cand['pick_observation_date']==d,'Mismatched current or picks date');require(cand['asset_history_version']==cur['asset_history_version'] and cand['seasons']==cur['seasons'],'Historical lineage changed');policy=pinned(c['history_policy']);h=read(policy);dist=Path(c['dist']).resolve(strict=True)
 require(digest(dist/'data/asset_valuation.json')==c['candidate_index']['sha256'],'Candidate distribution index differs')
 for rel,pin in h['protected_files'].items():require(digest(dist/rel)==pin,'Protected history/UI file changed: '+rel)
 require((cand['method']==SHARED)==(lane=='shared'),'Legacy generation cannot publish on shared lane')
 if lane=='shared':
  m=read(pinned(c['shared_daily_receipt']));require(m['schema']=='nba-shared-current-daily-admission-v1' and m['asof']==d and m['forecast_version']=='shared-minutes-comparables-career-v3-conditional-tail','Wrong dated shared proof');require(m['candidate_index_sha256']==c['candidate_index']['sha256'] and m['canonical_base_index_sha256']==c['canonical_index']['sha256'] and m['policy_sha256']==digest(policy),'Wrong canonical/policy/product binding');roles=('resolved_ledger','appraisal_scope','native_player_dollars','player_impact','team_forecast','future_lineups','legal_pick_quotes','continuation_checkpoint','source_collection','same_date_bridge');require(set(m['evidence'])==set(roles),'Missing same-date shared companion evidence');
  for b in m['evidence'].values():pinned(b)
  frozen=verify_rebase(c,p,dist,m['evidence']['resolved_ledger']['sha256']);require(m['evidence']['same_date_bridge']['sha256']==frozen[3],'Admission receipt references a different frozen rebase')
  require(m['new_model_reprice_booked_as']=='separate-methodology-rebase','Never book cutover as player development')
 return {**p,'result':'independent preflight eligible; no authorization or deployment','candidate_sha256':c['candidate_index']['sha256'],'history_policy_sha256':digest(policy)}
if __name__=='__main__':
 q=argparse.ArgumentParser();q.add_argument('mode',choices=['plan','generate-legacy','verify']);q.add_argument('config');q.add_argument('config_sha256');q.add_argument('--work',type=Path);a=q.parse_args();cfg=read(pinned({'path':a.config,'sha256':a.config_sha256}));print(json.dumps(plan(cfg) if a.mode=='plan' else generation(cfg,a.work) if a.mode=='generate-legacy' else verify(cfg),indent=2))

