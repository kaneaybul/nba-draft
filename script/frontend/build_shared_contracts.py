"""Publish one dated agreement ledger for player salaries and team cap views."""
from __future__ import annotations
import argparse,csv,gzip,json,sys
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'script/asset_history/backfill'))
from league_player_values import agreements_at
from refresh_contracts import key

def read_json(path):
    if not path.exists() and path.with_suffix(path.suffix+'.gz').exists():path=path.with_suffix(path.suffix+'.gz')
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix=='.gz' else path.read_text())

def build(repo,agreements=None,capture=None):
    agreements=agreements or read_json(repo/'processed/asset_history/contracts/contract_agreements.json')
    adjustments=repo/'processed/asset_history/contracts/contract_adjustments.json'
    if adjustments.exists():
        agreements=agreements+[{**r,'adjustment_only':True,'salaries':[]}for r in read_json(adjustments)]
    capture=capture or read_json(repo/'processed/asset_history/player_state/latest_inputs.json')
    day=capture['date'];year=int(day[:4])+(int(day[5:7])>=7)
    pool=read_json(repo/'raw/live/player_pool.json')
    if day>pool['generated_at'][:10]:raise ValueError('Contract capture is newer than the roster observation')
    caps={int(r['year']):float(r['salary_cap']) for r in csv.DictReader((repo/'processed/livedata/impactrefresh/salary_cap_assumptions.csv').open()) if r.get('salary_cap')}
    def cap_for_year(y,_):
        if y in caps:return caps[y]
        prior=max(v for v in caps if v<y)
        return caps[prior]*1.05**(y-prior)
    metadata={int(p['nba_id']):p for p in pool['players']if p.get('nba_id')is not None}
    roster=next(s['roster'] for s in capture['roster']if s['cutoff_date']==day)
    records=[];dormant=[]
    for owned in roster:
        if owned.get('draft_rights'):continue
        pid=owned.get('nba_id')
        if pid is None:raise ValueError('Owned current contract needs a verified NBA identity: '+owned['player_name'])
        cells,complete,agreement=agreements_at(agreements,owned['player_name'],pid,day,key,cap_for_year)
        current=next((c for c in cells if c['year']==year and c.get('amount')is not None),None)
        if not current and owned.get('rfa_pending'):
            dormant.append(dict(nba_id=pid,player_name=owned['player_name'],reason='Retained rights without a current signed NBA salary'))
            continue
        if not complete or not current or not current['amount']>0:
            raise ValueError('Incomplete dated contract: '+owned['player_name'])
        title=agreement.get('contract_type','');two_way='TWO-WAY'in title.upper()
        out=[]
        for y in range(year-1,year+6):
            cell=next((c for c in cells if int(c['year'])==y),None)
            amount=None;guaranteed=None;status='UFA';kind='empty';rate=None
            if cell:
                rate=cell.get('amount')
                amount=cell.get('original_episode_amount',rate)
                option=cell.get('kind')
                exercised=cell.get('option_exercised_asof')
                status='Two-Way'if two_way else 'Player Option'if option=='player_option'and not exercised else 'Team Option'if option=='team_option'and not exercised else 'Signed'
                kind='player_option'if status=='Player Option'else'team_option'if status=='Team Option'else'guaranteed'
                guaranteed=cell.get('original_episode_guaranteed_amount',cell.get('guaranteed_amount'))
                if guaranteed is not None and amount is not None:guaranteed=max(0,min(amount,guaranteed))
                if status=='Signed'and guaranteed is not None and amount is not None and guaranteed<amount:
                    status='Non-Guaranteed';kind='non_guaranteed'
                if amount is not None:amount=round(amount)
            out.append(dict(year=y,amount=amount,salary_rate=rate,kind=kind,status=status,
                guaranteed_amount=guaranteed,unguaranteed_amount=None if guaranteed is None or amount is None else amount-guaranteed,
                counts_against_cap=not two_way,cap_amount=0 if two_way else (round(cell.get('cap_hit'))if cell and cell.get('cap_hit')and not cell.get('max_formula_sources')else amount),source=cell.get('source')if cell else agreement['source'],
                source_quality='contract',known_from=cell.get('known_from')if cell else agreement['known_from'],
                note='Dated signed agreement; future maximum amounts use the existing as-of cap formula where applicable'if cell and cell.get('max_formula_sources')else None))
        meta=metadata.get(pid,{})
        records.append(dict(nba_id=int(pid),player_name=owned['player_name'],team=owned['team'],
            contract_type=title,two_way=two_way,position=meta.get('position'),source=agreement['source'],
            known_from=agreement['known_from'],ownership_source=owned.get('source'),cells=out,
            current_salary=next(c['amount']for c in out if c['year']==year),current_status=next(c['status']for c in out if c['year']==year)))
    ids=[r['nba_id']for r in records]
    if any(not r['current_salary']or r['current_salary']<=0 for r in records):raise ValueError('Missing signed player salary')
    if len(ids)!=len(set(ids)):raise ValueError('Duplicate contract ownership')
    teams=sorted({r['team']for r in records})
    if len(teams)!=30 or len(records)<450:raise ValueError('Incomplete all-team agreement ledger')
    inactive=[dict(nba_id=p['nba_id'],player_name=p['player_name'],team=p['team'],reason='Absent from the complete dated signed-contract ownership ledger')
        for p in pool['players']if p.get('pool_status')=='roster'and p.get('nba_id')is not None and int(p['nba_id'])not in ids]
    audit=read_json(repo/'processed/asset_history/contracts/refresh_audit.json')if(repo/'processed/asset_history/contracts/refresh_audit.json').exists()else{}
    return dict(schema_version=1,as_of=day,season=year,generated_at=datetime.now(timezone.utc).isoformat(),
        complete=True,teams=teams,players=records,inactive_registry_records=inactive,dormant_rights=dormant,
        coverage=dict(active_players=len(records),priced_players=len(records),missing_players=[],teams=30),
        source_refresh=dict(checked_at=audit.get('generated_at'),available_players=audit.get('available_players'),
            retained_agreements=audit.get('retained_agreements',[]),source_failures=audit.get('optional_source_failures',[])))

def write(repo,data):
    out=repo/'processed/contracts';out.mkdir(exist_ok=True,parents=True)
    target=out/'current.json'
    # Source checks and build timestamps alone must not trigger another
    # player rebuild. Changed ownership or terms do require a new export.
    stable=lambda d:{k:v for k,v in d.items()if k not in('generated_at','source_refresh')}
    if target.exists() and (out/'current.csv').exists() and stable(read_json(target))==stable(data):
        print(json.dumps(dict(**data['coverage'],unchanged=True)))
        return
    (out/'current.json').write_text(json.dumps(data,separators=(',',':'),allow_nan=False))
    year=data['season'];rows=[]
    for player in data['players']:
        row={k:player[k]for k in('nba_id','player_name','team','contract_type','source')}
        row.update(rank=len(rows)+1,source_contract_year=year-1,contract_status_source=player['current_status'],free_agent_status='UFA',free_agent_year=max(c['year']for c in player['cells']if c['amount']is not None)+1,signed_using='',contract_notes='Dated agreement known from '+player['known_from'],match_method='verified_nba_id_dated_agreement')
        for h,y in enumerate(range(year-1,year+6)):
            cell=next(c for c in player['cells']if c['year']==y)
            row['salary_y'+str(h)]=cell['amount'];row['contract_status_y'+str(h)]=cell['status']
        rows.append(row)
    with(out/'current.csv').open('w',newline='')as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    print(json.dumps(data['coverage']))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,default=ROOT);args=parser.parse_args()
    write(args.repo,build(args.repo))
