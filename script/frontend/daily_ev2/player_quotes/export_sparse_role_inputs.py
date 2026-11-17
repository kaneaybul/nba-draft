"""Export healthy final native sparse cells only; no provisional role posterior use."""
import argparse,csv,hashlib,json,sys
from pathlib import Path
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
POLICY='sparse-eligible-preacute-evidence-v2-transient-roster'
EVIDENCE_POLICY='sparse-observed-role-evidence-v2-transient-roster'
MODEL_POLICY='sparse-direct-hurdle-gam4-refit-20261116-v2'
def validate_transient(ctx,RolePath):
 meta=ctx['minutes_model'];role=RolePath.from_payload(ctx['role_path']);clock=float(meta['clock'])
 from transient_sparse_role import apply_to_path
 ev=meta.get('role_evidence',{})
 if ev.get('policy')!=EVIDENCE_POLICY or meta.get('roster_overlay_applied_once') is not True:raise ValueError('Wrong/missing transient policy')
 base=RolePath.from_payload(meta['unallocated_role_path'])
 expected=base if meta.get('camp_zero') else apply_to_path(base,ev)
 for j in range(328):
  if abs(role.minutes_integral(clock+j,clock+j+1)-expected.minutes_integral(clock+j,clock+j+1))>1e-8:raise ValueError('Transient applied zero/twice or role changed')
 if not meta.get('camp_zero') and abs(expected.minutes_integral(clock+82,clock+328)-base.minutes_integral(clock+82,clock+328))>1e-8:raise ValueError('Transient leaks past one future block')
 for j in range(82,328):
  if any(abs(x-y)>1e-8 for x,y in zip(expected.at(clock+j+.5),base.at(clock+j+.5))):raise ValueError('Transient GP/MPG tail leaked')
 return True
def export(source,asof,role_dir,model_file,output):
 sys.path.insert(0,str(role_dir));from rolling_role import RolePath
 model_sha=hashlib.sha256(Path(model_file).read_bytes()).hexdigest();players=[];seen=set();hashes={};eligible=0;maxerror=0.
 for team in TEAMS:
  path=Path(source)/team/'monthly_player_values.csv';hashes[team]=hashlib.sha256(path.read_bytes()).hexdigest();count=0
  for r in csv.DictReader(path.open()):
   if r['cutoff_date']!=asof or r['active_asset']!='True' or r['asset_type'] not in ['roster_contract','two_way']:continue
   pid=r.get('source_nba_id') or r.get('ledger_nba_id');pid=int(float(pid)) if pid else None;identity=(team,pid if pid else r['player_name'])
   if identity in seen:raise ValueError('Duplicate roster identity')
   seen.add(identity);count+=1;ctx=json.loads(r['joint_role_context_json']);meta=ctx.get('minutes_model');use=meta is not None
   row=dict(nba_id=pid,team=team,name=r['player_name'],asof=asof,sparse_eligible=use)
   if use:
    if r['asset_type']!='roster_contract' or meta['policy']!=MODEL_POLICY or meta['model_sha256']!=model_sha or meta['cutoff_date']!=asof:raise ValueError('Model/date/eligibility mismatch')
    if ctx.get('acute_overlay_applied_to_role') is not False:raise ValueError('Role must be preacute')
    role=RolePath.from_payload(ctx['role_path']);clock=float(meta['clock']);cells=[]
    validate_transient(ctx,RolePath)
    for k in range(328):
     gp=role.games_integral(clock+k,clock+k+1);mn=role.minutes_integral(clock+k,clock+k+1)
     if not (0<=gp<=1+1e-8 and 0<=mn<=38+1e-8):raise ValueError('Invalid cell')
     cells.append([gp,mn/gp if gp else 0,mn])
    error=abs(sum(c[2] for c in cells)-role.minutes_integral(clock,clock+328));maxerror=max(maxerror,error)
    if error>1e-7:raise ValueError('Cell sum mismatch')
    row.update(clock=clock,cells=cells[:82],model_sha256=model_sha);eligible+=1
   players.append(row)
  if not count:raise ValueError('Missing dated roster '+team)
 payload=dict(policy=POLICY,asof=asof,model_sha256=model_sha,acute_overlay_applied=False,allocation_applied=False,evidence_policy=EVIDENCE_POLICY,players=players)
 Path(output).write_text(json.dumps(payload,separators=(',',':'),allow_nan=False)+'\n')
 proof=dict(asof=asof,source_hashes=hashes,model_sha256=model_sha,players=len(players),eligible=eligible,max_328_cell_error=maxerror,injury_applied=False,evidence_policy=EVIDENCE_POLICY,transient_once_and_tail_verified=True)
 Path(output).with_suffix('.proof.json').write_text(json.dumps(proof,indent=2)+'\n');return proof
if __name__=='__main__':
 p=argparse.ArgumentParser()
 for k in ['source','asof','role-dir','model-file','output']:p.add_argument('--'+k,required=True)
 a=p.parse_args();print(json.dumps(export(a.source,a.asof,a.role_dir,a.model_file,a.output)))
