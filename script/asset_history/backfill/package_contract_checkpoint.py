"""Package raw contract evidence, canonical parsed tables and replay inputs."""
import argparse,csv,hashlib,io,json,zipfile
from datetime import datetime,timezone
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--sources',type=Path,required=True);p.add_argument('--contracts',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 entries=[]
 for folder in ['raw','parsed_v2']:
  for f in sorted((a.contracts/folder).rglob('*')):
   if f.is_file() and f.suffix!='.tmp':entries.append((f,'contracts/'+str(f.relative_to(a.contracts))))
 for name in ['max_salary_templates.json','supplemental_contract_agreements.json','primary_validation.json','alias_repair_audit.json','targeted_alias_repair_audit.json','first_pass_coverage.json']:
  f=a.contracts/name
  if f.exists():entries.append((f,'contracts/'+name))
 for name in ['contracts.py','test_contracts.py','rebuild_contract_cache.py','audit_contract_coverage.py','current_contract_gaps.py','priority_contract_review.py','historical_max_review.py','repair_contract_aliases.py','package_contract_checkpoint.py','CONTRACTS.md','max_salary_templates.json','supplemental_contract_agreements.json']:
  f=Path(__file__).parent/name;entries.append((f,'code/'+f.name))
 for source,target in [(a.sources/'league_ownership/monthly_league_rosters.json','inputs/monthly_reconstruction/league_ownership/monthly_league_rosters.json'),(a.sources/'pick_values/salary_sources/historical_player_salaries.csv','inputs/monthly_reconstruction/pick_values/salary_sources/historical_player_salaries.csv'),(a.sources.parent/'app_model/cap_tracker_compact.json','inputs/app_model/cap_tracker_compact.json'),(a.sources/'pick_values/salary_sources/cba101_2018.pdf','inputs/NBA_2018_CBA101.pdf')]:entries.append((source,target))
 dates=sorted({r['cutoff_date']for r in csv.DictReader((a.sources/'epm/epm_monthly.csv').open())});cutoffs='cutoff_date\n'+'\n'.join(dates)+'\n'
 manifest={'generated_at':datetime.now(timezone.utc).isoformat(),'scope':'Original contract schedules for leaguewide asset reconstruction,2021-12-31 through2026-10-25','source_files':[],'notes':['Source salary tables are retrospective original-contract histories, not archived historical publication vintages.','inputs/monthly_reconstruction/epm/epm_monthly.csv is a59-date index only; it intentionally contains no EPM values.','See CONTRACTS.md and contract source coverage for pending as-of clauses and missing players.']}
 a.output.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6)as z:
  for source,target in entries:
   body=source.read_bytes();z.writestr(target,body);manifest['source_files'].append({'path':target,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
  z.writestr('inputs/monthly_reconstruction/epm/epm_monthly.csv',cutoffs);z.writestr('manifest.json',json.dumps(manifest,indent=2))
 with zipfile.ZipFile(a.output)as z:assert z.testzip()is None
 receipt={'path':str(a.output.resolve()),'bytes':a.output.stat().st_size,'files':len(entries)+2,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()};a.output.with_suffix('.verification.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
if __name__=='__main__':main()
