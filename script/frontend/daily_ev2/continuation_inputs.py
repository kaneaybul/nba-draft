"""Exact prior observation dependencies bound to a complete native checkpoint."""
import copy,csv,hashlib,io,json
from datetime import date
from pathlib import Path
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
SPECS={
 'epm/epm_monthly.csv':('csv','cutoff_date',None),
 'darko/end_of_month/darko_monthly.csv':('csv','cutoff',None),
 'ledger/monthly_inventory.json':('json','asof_date',None),
 'league_ownership/monthly_league_rosters.json':('json','cutoff_date',None),
 'skill/monthly_skill_observations.json':('json','date',None),
 'skill/monthly_blended_skills.csv':('csv','date',None),
 'skill/coverage_summary.json':('json','date','rows'),
}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def checkpoint(prior):
 prior=Path(prior)
 manifest=json.loads((prior/'manifest.json').read_text());day=manifest['as_of'];date.fromisoformat(day)
 for t in TEAMS:
  state=json.loads((prior/'states'/f'{t}.json').read_text())
  if state.get('as_of')!=day or state.get('team')!=t or state.get('model_source_hashes')!=manifest.get('model_source_hashes'):raise ValueError('Incomplete or inconsistent continuation checkpoint')
 return day,digest({'manifest.json':sha(prior/'manifest.json'),**{'states/'+t+'.json':sha(prior/'states'/f'{t}.json')for t in TEAMS}})
def read_records(path,spec):
 kind,key,container=spec
 if kind=='csv':
  with Path(path).open(newline='')as f:
   reader=csv.DictReader(f);rows=list(reader);header=reader.fieldnames
  if not header or any(None in r or any(v is None for v in r.values())for r in rows):raise ValueError('Malformed provider CSV')
  return rows,header,None
 obj=json.loads(Path(path).read_text());rows=obj[container]if container else obj
 if not isinstance(rows,list):raise ValueError('Malformed continuation records')
 return rows,None,obj

def capture(runtime,prior,prepared_receipt,out):
 """Called only after native validation confirms all30 successful team outputs."""
 day,pin=checkpoint(prior);out=Path(out)
 if out.exists():raise ValueError('Continuation artifact already exists')
 files={};root=Path(runtime)/'monthly_reconstruction'
 for rel,spec in SPECS.items():
  rows,header,_=read_records(root/rel,spec);selected=[r for r in rows if r.get(spec[1])==day]
  if not selected and rel!='ledger/monthly_inventory.json':raise ValueError('Missing continuation dependency: '+rel)
  files[rel]={'header':header,'rows':selected,'source_sha256':sha(root/rel),'rows_sha256':digest(selected)}
 manifest={'schema':'nba-exact-continuation-inputs-v1','asof':day,'checkpoint_sha256':pin,'prepared_receipt_sha256':sha(prepared_receipt),'files':files}
 out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(manifest,allow_nan=False,indent=2)+'\n')
 return {'path':str(out.resolve()),'sha256':sha(out),'checkpoint_sha256':pin,'asof':day}

def restore(runtime,prior,bundle,expected_bundle_sha,expected_checkpoint_sha,asof):
 day,pin=checkpoint(prior)
 if pin!=expected_checkpoint_sha or day>=asof:raise ValueError('Wrong verified prior checkpoint')
 if not expected_bundle_sha or sha(bundle)!=expected_bundle_sha:raise ValueError('Unverified continuation artifact')
 b=json.loads(Path(bundle).read_text())
 if b.get('schema')!='nba-exact-continuation-inputs-v1' or b.get('asof')!=day or b.get('checkpoint_sha256')!=pin or set(b.get('files',{}))!=set(SPECS):raise ValueError('Continuation dependency binding differs')
 plans=[];root=Path(runtime)/'monthly_reconstruction'
 for rel,spec in SPECS.items():
  saved=b['files'][rel];want=saved['rows']
  if (not want and rel!='ledger/monthly_inventory.json') or any(r.get(spec[1])!=day for r in want)or digest(want)!=saved.get('rows_sha256'):raise ValueError('Invalid predecessor rows: '+rel)
  rows,header,obj=read_records(root/rel,spec);old=[r for r in rows if r.get(spec[1])==day]
  if header!=saved.get('header'):raise ValueError('Predecessor schema mismatch: '+rel)
  if old and old!=want:raise ValueError('Conflicting predecessor input: '+rel)
  if not old and want:
   result=copy.deepcopy(rows)+copy.deepcopy(want)
   if spec[0]=='csv':
    buf=io.StringIO(newline='');writer=csv.DictWriter(buf,fieldnames=header);writer.writeheader();writer.writerows(result);raw=buf.getvalue()
   else:
    if spec[2]:obj[spec[2]]=result
    else:obj=result
    raw=json.dumps(obj,allow_nan=False)+'\n'
   plans.append((root/rel,raw))
 # Validate all dependencies before writing any; existing record values/order preserved.
 for p,raw in plans:p.write_text(raw,newline='')
 verify(runtime,bundle)
 return {'bundle_sha256':expected_bundle_sha,'checkpoint_sha256':pin,'prior_date':day,'restored_files':[str(p.relative_to(root))for p,_ in plans]}

def verify(runtime,bundle):
 b=json.loads(Path(bundle).read_text());root=Path(runtime)/'monthly_reconstruction'
 for rel,spec in SPECS.items():
  rows,_,_=read_records(root/rel,spec);actual=[r for r in rows if r.get(spec[1])==b['asof']]
  if actual!=b['files'][rel]['rows']:raise ValueError('Predecessor dependency changed during preparation: '+rel)

def require_present(runtime,day):
    """Fail before team execution, not inside an arrival's RoleSmoother."""
    missing=[]
    root=Path(runtime)/'monthly_reconstruction'
    for rel,spec in SPECS.items():
        rows,_,_=read_records(root/rel,spec)
        if rel!='ledger/monthly_inventory.json' and not any(r.get(spec[1])==day for r in rows):missing.append(rel)
    if missing:raise ValueError('Exact prior observation dependencies missing for '+day+': '+', '.join(missing))

def prior_priced_ledger(authority,bundle,bundle_sha,prior,prior_sha,prepared_receipt):
    """Project only the authenticated prior slice; never mutate authority rows."""
    from collections import Counter
    day,pin=checkpoint(prior)
    if pin!=prior_sha or sha(bundle)!=bundle_sha:raise ValueError('Unverified prior priced dependency binding')
    b=json.loads(Path(bundle).read_bytes());proof=json.loads(Path(prepared_receipt).read_bytes())
    if b['checkpoint_sha256']!=pin or b['asof']!=day or sha(prepared_receipt)!=b['prepared_receipt_sha256']or proof['asof']!=day:raise ValueError('Prior preparation binding mismatch')
    saved=b['files']['league_ownership/monthly_league_rosters.json'];want=saved['rows']
    if digest(want)!=saved['rows_sha256']or len(want)!=1 or want[0]['cutoff_date']!=day:raise ValueError('Invalid exact prior ownership slice')
    actual=[x for x in authority if x['cutoff_date']==day]
    if len(actual)!=1:raise ValueError('Missing or duplicate authoritative predecessor date')
    exclusions=proof.get('native_pending_exclusion',{})
    if exclusions.get('asof')!=day or exclusions.get('policy')!='confirmed_contract_pending_not_priced':raise ValueError('Undocumented prior pending exclusion')
    ids=exclusions['ids'];removed=[r for r in actual[0]['roster']if r.get('nba_id')in ids]
    if len(removed)!=len(ids)or {r['nba_id']for r in removed}!=set(ids):raise ValueError('Prior pending identities differ')
    expected=copy.deepcopy(actual[0]);expected['roster']=[r for r in expected['roster']if r.get('nba_id')not in ids]
    canon=lambda rows:Counter(json.dumps(r,sort_keys=True,separators=(',',':'),allow_nan=False)for r in rows)
    if {k:v for k,v in expected.items()if k!='roster'}!={k:v for k,v in want[0].items()if k!='roster'}or canon(expected['roster'])!=canon(want[0]['roster']):raise ValueError('Prior priced rows conflict with authoritative ownership')
    result=copy.deepcopy(authority)
    for i,row in enumerate(result):
        if row['cutoff_date']==day:result[i]=copy.deepcopy(want[0])
    return result,{'asof':day,'dependency_sha256':bundle_sha,'checkpoint_sha256':pin,'prior_prepared_receipt_sha256':sha(prepared_receipt),'documented_pending_ids':ids,'authority_unchanged':True,'exact_prior_slice_restored':True}
