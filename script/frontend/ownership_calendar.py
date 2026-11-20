"""Carry a publication-bound authority calendar before appending a fresh cutoff."""
import copy,hashlib,json
from collections import Counter
from datetime import date,datetime,timezone
from pathlib import Path

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rows(v):return Counter(json.dumps(r,sort_keys=True,separators=(',',':'),allow_nan=False) for r in v)
def reconcile(prior,candidate,asof):
 date.fromisoformat(asof)
 def indexed(items):
  out={}
  for r in items:
   d=r['cutoff_date'];date.fromisoformat(d)
   if d in out or not isinstance(r.get('roster'),list):raise ValueError('Duplicate or invalid calendar cutoff')
   out[d]=r
  return out
 old=indexed(prior);new=indexed(candidate)
 if not old or max(old)>=asof or asof not in new or set(new)-set(old)!={asof}:raise ValueError('Expected exactly one fresh current cutoff')
 for d in old.keys()&new.keys():
  if {k:v for k,v in old[d].items()if k!='roster'}!={k:v for k,v in new[d].items()if k!='roster'} or rows(old[d]['roster'])!=rows(new[d]['roster']):raise ValueError('Conflicting authoritative overlap: '+d)
 return copy.deepcopy(prior)+[copy.deepcopy(new[asof])]

def apply(runtime,prior_path,prior_sha,publication_path,publication_sha,asof):
 prior_path=Path(prior_path);publication_path=Path(publication_path)
 if sha(prior_path)!=prior_sha or sha(publication_path)!=publication_sha:raise ValueError('Prior authority/publication bytes changed')
 prior=json.loads(prior_path.read_bytes());publication=json.loads(publication_path.read_bytes())
 expected=publication.get('authoritative_ledger_sha256')or publication.get('future_use',{}).get('authority_ledger_sha256')
 if publication.get('production')is not True or not publication.get('deployment_id')or publication.get('asof')!=max(x['cutoff_date']for x in prior)or expected!=prior_sha:raise ValueError('Authority calendar is not bound to successful prior publication')
 root=Path(runtime)/'monthly_reconstruction/league_ownership';ledger=root/'monthly_league_rosters.json';audit=root/'roster_refresh_source.json';current=json.loads(ledger.read_bytes());source=json.loads(audit.read_bytes())
 if source.get('knowledge_date')!=asof:raise ValueError('Current ownership audit date mismatch')
 official=source.get('official_nba_supplement',{})
 if official:
  receipt=root/official['receipt_file']
  if sha(receipt)!=official['sha256']or json.loads(receipt.read_bytes()).get('knowledge_date')!=asof:raise ValueError('Official transaction receipt changed')
 merged=reconcile(prior,current,asof)
 evidence={'schema':'nba-published-authority-calendar-carry-v1','asof':asof,'prior_calendar':{'path':str(prior_path.resolve()),'sha256':prior_sha},'prior_publication':{'path':str(publication_path.resolve()),'sha256':publication_sha,'deployment_id':publication['deployment_id']},'candidate_sha256':sha(ledger),'source_audit_sha256':sha(audit),'prior_cutoffs':len(prior),'current_cutoffs':len(current),'result_cutoffs':len(merged),'restored_cutoffs':sorted({x['cutoff_date']for x in prior}-{x['cutoff_date']for x in current}),'reconciled_at':datetime.now(timezone.utc).isoformat()}
 ledger.write_text(json.dumps(merged,allow_nan=False));evidence['result_sha256']=sha(ledger)
 source['calendar_baseline']=evidence;audit.write_text(json.dumps(source,indent=2)+'\n')
 return evidence
