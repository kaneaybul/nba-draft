"""Targeted signed-term checks only. Returns additions; never modifies saved ledgers.
fetch_one's raw files live only in an automatically removed temporary directory.
No rotation, inferred salaries, alternate providers, or identity-by-name alone.
"""
from __future__ import annotations
import copy,json,math,re,sys,tempfile,unicodedata
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

def _key(s):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower())
def _dob(s):
 for fmt in ('%Y-%m-%d','%b %d, %Y','%B %d, %Y'):
  try:return datetime.strptime(str(s).strip(),fmt).date().isoformat()
  except ValueError:pass
 return None

def _url(s):
 u=urlparse(str(s));return u.scheme=='https' and u.hostname in ('www.salaryswish.com','salaryswish.com') and u.path.startswith('/players/') and not u.query and not u.fragment

def review_result(pending,result,identity,asof):
 """Pure review: identity is accepted NBA-ID/provider binding, not fetched claims."""
 pid=int(pending['nba_id']);observed=pending['known_from'];day=date.fromisoformat(asof);date.fromisoformat(observed)
 if observed>asof:return [],'future_pending_signing'
 if int(identity.get('nba_id',-1))!=pid or identity.get('confirmed')is not True:return [],'identity_not_accepted'
 if result.get('status')!='available':return [],'provider_'+str(result.get('status','unavailable'))
 if int(result.get('nba_id',-1))!=pid:return [],'wrong_returned_identity'
 verified_url=identity.get('source_url');dob=identity.get('birthdate')
 if not verified_url and not dob:return [],'provider_identity_binding_missing'
 if verified_url and (not _url(verified_url)or result.get('url')!=verified_url):return [],'provider_profile_changed'
 candidates=[]
 for a in result.get('agreements',[]):
  try:
   if int(a.get('nba_id',-1))!=pid or a.get('signing_team')!=pending['team']:continue
   known=a.get('known_from','');date.fromisoformat(known)
   if not observed<=known<=asof:continue
   if a.get('source')!=result.get('url') or not _url(a.get('source')):continue
   if _key(a.get('source_profile_name'))!=_key(identity.get('player_name',pending['player_name'])):continue
   if dob and (not _dob(dob)or _dob(a.get('source_profile_birthdate'))!=_dob(dob)):continue
   if a.get('schedule_complete')is not True or a.get('table_complete')is not True:continue
   if a.get('annual_rate_unresolved_years') or (a.get('max_salary_asof_review_required')and not a.get('max_salary_asof_formula_verified')):continue
   cells=a.get('salaries',[]);years=[int(c['year'])for c in cells]
   if not years or len(set(years))!=len(years)or sorted(years)!=list(range(min(years),max(years)+1)):continue
   year=day.year+(day.month>=7)
   if year not in years:continue
   if any(not isinstance(c.get('amount'),(int,float))or isinstance(c['amount'],bool)or not math.isfinite(c['amount'])or c['amount']<=0 or c.get('known_from',known)>asof for c in cells):continue
   if int(a.get('expiry_season',0))!=max(years):continue
   if a.get('resets_prior_schedule')is not True or any(t in a.get('contract_type','').upper()for t in ('EXTENSION','RENEGOTIATION')):continue
   if bool(pending.get('two_way'))!=('TWO-WAY'in a.get('contract_type','').upper()):continue
   candidates.append(a)
  except (ValueError,TypeError,KeyError):continue
 unique={json.dumps(a,sort_keys=True):a for a in candidates}
 if len(unique)!=1:return [],'absent_stale_incomplete_or_ambiguous_terms'
 addition=copy.deepcopy(next(iter(unique.values())))
 addition.update(pending_event_id=pending.get('event_id'),pending_event_date=observed)
 if not addition['pending_event_id']:return [],'missing_confirmed_pending_event'
 return [addition],None

def recheck_pending_contracts(pending,accepted_identities,asof,repo=None,max_checks=8,fetcher=None):
 """Return {reviewed_additions, pending, checks}; no saved-state mutation.
 pending is caller's confirmed pending-only queue (nba_id/name/team/known_from).
 accepted_identities maps NBA ID to confirmed identity + previously accepted
 SalarySwish source_url OR independently confirmed birthdate. No name-only trust.
 """
 date.fromisoformat(asof)
 if not 1<=max_checks<=30:raise ValueError('Targeted bounded check limit required')
 rows=list(pending);ids=[int(r['nba_id'])for r in rows]
 if any(pid<=0 for pid in ids)or len(set(ids))!=len(ids):raise ValueError('Confirmed unique positive NBA IDs required')
 if fetcher is None:
  root=Path(repo or Path(__file__).resolve().parents[2]);sys.path.insert(0,str(root/'script/asset_history/backfill'))
  from contracts import fetch_one
  fetcher=fetch_one
 additions=[];remaining=[];checks=[];attempts=0
 with tempfile.TemporaryDirectory(prefix='nba-pending-terms-')as directory:
  out=Path(directory);(out/'raw').mkdir()
  for row in rows:
   pid=int(row['nba_id']);identity=accepted_identities.get(pid,accepted_identities.get(str(pid),{}));reason=None;new=[]
   if attempts>=max_checks:reason='bounded_check_deferred'
   elif identity.get('confirmed')is not True or int(identity.get('nba_id',-1))!=pid:reason='identity_not_accepted'
   elif not identity.get('source_url')and not identity.get('birthdate'):reason='provider_identity_binding_missing'
   elif identity.get('source_url')and not _url(identity['source_url']):reason='provider_not_approved'
   elif row['known_from']>asof:reason='future_pending_signing'
   else:
    player={'nba_id':pid,'player_name':identity.get('player_name',row['player_name'])}
    if identity.get('source_url'):player['source_url']=identity['source_url']
    attempts+=1
    try:
     result=fetcher(player,out,True,out/'raw',asof)
     new,reason=review_result(row,result,identity,asof)
    except Exception as e:reason='provider_error_'+type(e).__name__
   additions.extend(new);checks.append({'nba_id':pid,'resolved':bool(new),'reason':reason})
   if not new:remaining.append(copy.deepcopy(row))
 return {'asof':asof,'reviewed_additions':additions,'pending':remaining,'checks':checks,'attempts':attempts,'rotation':False,'saved_state_written':False}


def recheck(pending,saved_agreements,asof,*,repo=None,max_checks=8,fetcher=None):
 """Public API. Bind pending IDs only to their already accepted saved profile.
 Optional pending fields verified_official_birthdate + official_identity_source
 (nba.com) are caller-reviewed identity evidence, never inferred from fetched names.
 """
 identities={}
 for row in pending:
  pid=int(row['nba_id']);saved=[a for a in saved_agreements if a.get('nba_id')is not None and int(a['nba_id'])==pid and a.get('known_from','9999')<=asof and _url(a.get('source')) and _key(a.get('source_profile_name')or a.get('player_name'))==_key(row['player_name'])]
  urls={a['source']for a in saved}
  if len(urls)==1:
   identities[pid]={'nba_id':pid,'confirmed':True,'player_name':row['player_name'],'source_url':next(iter(urls))}
   births={_dob(a.get('source_profile_birthdate'))for a in saved if _dob(a.get('source_profile_birthdate'))}
   if len(births)==1:identities[pid]['birthdate']=next(iter(births))
  elif not urls and _dob(row.get('verified_official_birthdate')) and urlparse(str(row.get('official_identity_source',''))).hostname in ('www.nba.com','nba.com'):
   identities[pid]={'nba_id':pid,'confirmed':True,'player_name':row['player_name'],'birthdate':_dob(row['verified_official_birthdate'])}
 return recheck_pending_contracts(pending,identities,asof,repo,max_checks,fetcher)
