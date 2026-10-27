"""Recover original contracts for dated name-only roster records.

Negative source IDs are stable RealGM-profile keys, not invented NBA identities.
The valuation engine joins these records by the original ledger name.
"""
import argparse,concurrent.futures,json,re
from pathlib import Path
from contracts import fetch_one,option_adjustments

PROFILE_SOURCE_SLUGS={59227:'wes-iwundu',108581:'nathan-mensah',173877:'zach-austin',152389:'adama-bal',117468:'jaylin-williams2',112202:'terrell-brown-jr'}


def main():
 p=argparse.ArgumentParser();p.add_argument('--gaps',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);p.add_argument('--raw',type=Path,required=True);p.add_argument('--workers',type=int,default=2);a=p.parse_args()
 gaps=json.loads(a.gaps.read_text());players={}
 for r in gaps:
  url=r.get('realgm_profile')or r.get('realgm_url')or'';m=re.search(r'/Summary/(\d+)',url)
  if r.get('nba_id')is not None:pid=int(r['nba_id'])
  elif m:pid=-9000000000-int(m.group(1))
  else:continue
  player=dict(nba_id=pid,player_name=r['player_name'],identity_kind='nba_id'if pid>0 else'realgm_profile_source_id',realgm_profile=url)
  if m and int(m.group(1))in PROFILE_SOURCE_SLUGS:player['source_url']='https://www.salaryswish.com/players/'+PROFILE_SOURCE_SLUGS[int(m.group(1))]
  players.setdefault(pid,player)
 a.raw.mkdir(parents=True,exist_ok=True);results=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:
  for result in pool.map(lambda r:fetch_one(r,a.contracts,raw_dir=a.raw,asof='2026-10-27'),players.values()):
   results.append(result);print(json.dumps({k:v for k,v in result.items()if k!='agreements'}),flush=True)
 agreements=json.loads((a.contracts/'contract_agreements.json').read_text());keys={(r['nba_id'],r['known_from'])for r in agreements}
 for result in results:
  for row in result['agreements']:
   row['identity_kind']=result['identity_kind'];row['realgm_profile']=result['realgm_profile'];row['nba_id_confirmed']=result['nba_id']>0
   if(row['nba_id'],row['known_from'])not in keys:agreements.append(row)
 agreements.sort(key=lambda r:(r['known_from'],r['nba_id']))
 for name,data in [('contract_agreements.json',agreements),('contract_adjustments.json',option_adjustments(agreements)),('name_gap_source_audit.json',[{k:v for k,v in r.items()if k!='agreements'}for r in results])]:
  dest=a.contracts/name;temp=dest.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2));temp.replace(dest)
 print(json.dumps(dict(requested=len(players),available=sum(r['status']=='available'for r in results),agreements=len(agreements))),flush=True)

if __name__=='__main__':main()
