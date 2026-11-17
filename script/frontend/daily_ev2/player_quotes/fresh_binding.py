"""Validate authentic prepared-source/native receipts without invoking R or collectors."""
import hashlib,json
from datetime import date
from pathlib import Path
from generate import METHOD,MODEL,POLICY,TEAMS

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def need(ok,message):
 if not ok:raise ValueError(message)
def validate_native(receipt_file,prepared_file,batch,signed_book,grades,asof):
 r=read(receipt_file);p=read(prepared_file);day=date.fromisoformat(asof)
 need(r.get('schema')=='nba-daily-native-replay-v1','Unknown native receipt schema')
 need(r.get('asof')==asof and p.get('asof')==asof,'Fresh source/native date mismatch')
 need(r.get('method')==p.get('method')==METHOD,'Fresh native method mismatch')
 need(r.get('model_sha256')==p.get('model_sha256')==MODEL and r.get('evidence_policy')==POLICY,'Fresh model/evidence policy mismatch')
 need(r.get('complete') is True and r.get('teams')==30 and r.get('production') is False,'Incomplete native replay')
 need(r.get('source_preparation_receipt_sha256')==sha(prepared_file),'Prepared source receipt hash mismatch')
 need(r.get('signed_book_sha256')==sha(signed_book),'Signed book mismatch')
 need(r.get('grade_checkpoint_sha256')==sha(grades),'Draft endpoint checkpoint mismatch')
 need(r.get('batch_manifest_sha256')==sha(batch/'manifest.json'),'Batch manifest mismatch')
 need(read(batch/'manifest.json').get('as_of')==asof,'Native batch date mismatch')
 prior=r.get('prior_checkpoint',{})
 need(isinstance(prior.get('sha256'),str) and len(prior['sha256'])==64 and date.fromisoformat(prior.get('asof','9999-01-01'))<day,'Prior checkpoint must precede requested observation')
 need(r.get('season')==p.get('season')==day.year+(day.month>=7),'Season mismatch')
 for team in TEAMS:
  for filename in ('league_player_coverage.json','monthly_player_values.csv','monthly_annual_values.csv','monthly_quote_carry_states.csv'):
   need((batch/'output'/team/filename).is_file(),'Missing required native pricing file')
 expected={str(f.relative_to(batch/'output')):sha(f) for t in TEAMS for f in (batch/'output'/t).glob('*') if f.is_file()}
 need(set(k.split('/')[0]for k in expected)==set(TEAMS),'Missing native team output')
 need(r.get('output_sha256')==expected,'Native raw output hashes differ')
 sources=p.get('sources',{})
 need(bool(sources),'Missing authentic source inventory')
 for meta in sources.values():
  path=Path(meta.get('path',''))
  need(path.is_file() and sha(path)==meta.get('sha256'),'Prepared source bytes changed')
 for key in ('collector_receipt_sha256','ownership_receipt_sha256','dated_ledger_sha256','dated_ownership_audit_sha256','r_provenance_receipt_sha256','demographics_sha256','schedule_sha256'):
  need(isinstance(p.get(key),str) and len(p[key])==64,'Missing prepared provenance: '+key)
 need(p.get('extension_executed') is True,'Source extension not complete')
 need(p.get('native_replay_invocations')==p.get('pricing_invocations')==p.get('r_exports')==0,'Prepared receipt mixes downstream computation')
 return r

def validate_r_join(quote,r):
 need(r.get('schema')=='nba-daily-role-r-export-v1','Unknown R receipt schema')
 for k in ('asof','model_sha256','healthy_bridge_sha256','signed_book_sha256'):
  need(r.get(k)==quote.get(k) and quote.get(k) is not None,'R/quote mismatch: '+k)
 need(r.get('inputs',{}).get('native_receipt_sha256')==quote.get('native_receipt_sha256') and quote.get('native_receipt_sha256') is not None,'Different native replay for R and quotes')
 need(r.get('teams')==30 and r.get('production') is False,'Incomplete or external R stage')
 return True
