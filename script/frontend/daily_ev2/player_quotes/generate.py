"""Single-date native e-v2 player pricing only. No collectors, fit, Git, or publish."""
import argparse,hashlib,importlib.util,json,math,shutil,sys
from pathlib import Path
METHOD='peak4-payroll-0.8-v20-sparse-direct-role-refit-20261116-evidence-v2-transient-roster'
CURRENT=METHOD+'-current'
MODEL='fb08a02655155274d902433d6d35727fede1b45c1c7871977338e34138cc775f'
POLICY='sparse-observed-role-evidence-v2-transient-roster'
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def dump(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,separators=(',',':'),allow_nan=False)+'\n')
def validate(snapshots,asof):
 if len(snapshots)!=30 or {s['team'] for s in snapshots}!=set(TEAMS):raise ValueError('All30 unique teams required')
 seen=set()
 for s in snapshots:
  if s['date']!=asof or s['method']!=METHOD:raise ValueError('Snapshot date/method mismatch')
  if s['unpriced_players']:raise ValueError('Unpriced players')
  for a in s['assets']:
   if a['id'] in seen:raise ValueError('Duplicate player ownership')
   seen.add(a['id'])
   if not math.isfinite(a['value']) or abs(a['exposure']-4)>1e-8:raise ValueError('Invalid four-year quote')
 return len(seen)
def generate(a):
 if a.out.exists():raise ValueError('Fresh isolated output directory required')
 if read(a.batch/'manifest.json')['as_of']!=a.asof:raise ValueError('Native batch date mismatch')
 if sha(a.runtime/'sparse_role_models.json')!=MODEL:raise ValueError('Fitted model mismatch')
 fresh=getattr(a,'lane','frozen')=='fresh'
 if fresh:
  from fresh_binding import validate_native
  binding=validate_native(a.binding,a.prepared_receipt,a.batch,a.signed_book,a.grades,a.asof)
 else:binding=read(a.binding)
 if binding.get('asof')!=a.asof or binding.get('model_sha256')!=MODEL or binding.get('evidence_policy')!=POLICY:raise ValueError('Native binding date/policy mismatch')
 # This proof covers frozen control only; a later day needs new authoritative binding.
 if not fresh and a.asof!='2026-11-14':raise ValueError('Fresh authoritative source/R binding adapter not yet installed')
 sys.path[:0]=[str(a.repo/'script'),str(a.repo/'script/asset_history'),str(a.repo/'script/asset_history/backfill'),str(a.runtime/'monthly_reconstruction/projections')]
 import model_version,run_player_refresh
 if model_version.METHOD!=METHOD:raise ValueError('Native source method mismatch')
 inputs={str(p):sha(p) for t in TEAMS for p in (a.batch/'output'/t).glob('*') if p.is_file()}
 inputs.update({str(a.batch/'manifest.json'):sha(a.batch/'manifest.json'),str(a.binding):sha(a.binding),str(a.grades):sha(a.grades)})
 a.out.mkdir(parents=True)
 from export_sparse_role_inputs import export as export_bridge
 bridge=a.out/'healthy_role_inputs.json'
 export_bridge(a.batch/'output',a.asof,a.repo/'script/asset_history/backfill',a.runtime/'sparse_role_models.json',bridge)
 if not fresh and sha(bridge)!=binding['bridge_sha256']:raise ValueError('Native batch differs from R-validated healthy bridge')
 work=a.out/'native_pricing'
 for t in TEAMS:shutil.copytree(a.batch/'output'/t,work/t)
 (work/'player_state_staged').mkdir();shutil.copy2(a.grades,work/'player_state_staged/final_draft_results.json')
 spec=importlib.util.spec_from_file_location('fixed_release_calibrator',a.calibrator);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 cal=mod.create(a.repo,a.runtime)
 # EXPORT ONLY. run() performs collection, ownership operations and model preparation.
 result=run_player_refresh.export(work,a.asof,cal)
 count=validate(result['snapshots'],a.asof)
 # Use existing checked quote mapping, not arithmetic reconstruction of totals.
 spec=importlib.util.spec_from_file_location('quote_mapping',a.quote_mapper);qm=importlib.util.module_from_spec(spec);spec.loader.exec_module(qm)
 players={};owners={}
 for s in result['snapshots']:
  for asset in s['assets']:
   if asset['id'].startswith('player:nba:'):
    pid=asset['id'].split(':')[-1];players[pid]=qm.player_quote(asset,a.asof);owners[pid]=s['team']
 if any(sha(Path(p))!=h for p,h in inputs.items()):raise ValueError('Inputs changed during pricing')
 packet={'schema_version':1,'observation_date':a.asof,'method':CURRENT,'source_method':METHOD,'model_sha256':MODEL,'evidence_policy':POLICY,'players':players,'owners':owners,'scope':'player quotes only; no picks/current index/history mutation','release_ready':False}
 dump(a.out/'current_players.json',packet)
 proof={'schema':'single-date-native-quote-v1','asof':a.asof,'method':CURRENT,'source_method':METHOD,'players':len(players),'all_assets':count,'teams':30,'input_sha256':inputs,'model_sha256':MODEL,'binding_sha256':sha(a.binding),'healthy_bridge_sha256':sha(bridge),'owners_sha256':hashlib.sha256(json.dumps(owners,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'packet_sha256':sha(a.out/'current_players.json'),'calibrator_sha256':sha(a.calibrator),'calibration_dependencies':{p.name:sha(p) for p in a.calibrator.parent.glob('*')if p.is_file()},'source_code_sha256':{str(p.relative_to(a.repo)):sha(p)for p in (a.repo/'script/asset_history').rglob('*.py')},'scope':'frozen Nov14 control; fixed existing calibration; no source collection/refit','release_ready':False}
 if fresh:
  proof.update(scope='fresh native receipt-bound pricing; final R/static/ownership/pick assembly still required',native_receipt_sha256=sha(a.binding),source_preparation_receipt_sha256=sha(a.prepared_receipt),signed_book_sha256=sha(a.signed_book))
  book=read(a.signed_book);signed={str(r['nba_id']):r['team'] for r in book['players']}
  if len(signed)!=len(book['players']) or signed!=owners:raise ValueError('Priced ownership differs from signed book or has duplicate identities')
  from fresh_binding import validate_native
  validate_native(a.binding,a.prepared_receipt,a.batch,a.signed_book,a.grades,a.asof)
 dump(a.out/'receipt.json',proof)
 print(json.dumps({k:proof[k]for k in ('asof','teams','players','all_assets','packet_sha256','release_ready')}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ('repo','runtime','batch','calibrator','quote-mapper','grades','binding','out'):p.add_argument('--'+k,type=Path,required=True)
 p.add_argument('--asof',required=True);p.add_argument('--lane',choices=['frozen','fresh'],default='frozen');p.add_argument('--prepared-receipt',type=Path);p.add_argument('--signed-book',type=Path);a=p.parse_args()
 if a.lane=='fresh' and (a.prepared_receipt is None or a.signed_book is None):p.error('fresh lane requires prepared receipt and signed book')
 for k,v in vars(a).items():
  if isinstance(v,Path):setattr(a,k,v.resolve())
 generate(a)
