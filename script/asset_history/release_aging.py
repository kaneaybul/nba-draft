"""Attach auditable aging inputs to existing prices and rebuild attribution only."""
import argparse, copy, json
from pathlib import Path
from model_version import data_root
from materialize import materialize, compact
from attribution import run, atomic, NAMES
from validate_attribution import validate


def release(repo, runtime, candidates):
    materialize(repo)
    rows=json.loads(candidates.read_text())['snapshots']
    lookup={(s['team'],s['date'],a['id']):a for s in rows for a in s['assets']}
    count=0
    for team in NAMES:
        file=data_root(repo)/'teams'/f'{team}.json'
        data=json.loads(file.read_text())
        original=copy.deepcopy(data)
        for s in data['snapshots']:
            for a in s['assets']:
                if a['kind']!='player' or not a.get('details',{}).get('annual_values'): continue
                generated=lookup[team,s['date'],a['id']]
                # Prices never change, and the basis must belong to that exact path.
                if abs(generated['value']-a['value'])>.05:
                    raise ValueError(('Replayed price differs',team,s['date'],a['name'],generated['value'],a['value']))
                basis=generated['details']['aging_basis']
                a['details']['aging_basis']=basis
                count+=1
        stripped=copy.deepcopy(data)
        for s in stripped['snapshots']:
            for a in s['assets']: a.get('details',{}).pop('aging_basis',None)
        for s in original['snapshots']:
            for a in s['assets']: a.get('details',{}).pop('aging_basis',None)
        assert stripped==original, 'Aging changed inventory or valuation'
        atomic(file,data)
    report=run(repo,runtime,workers=2)
    checks=validate(repo)
    checks.update(aging_bases=count, inventory_and_values='unchanged')
    atomic(repo/'processed/asset_history/aging_validation.json',checks)
    compact(repo)
    print(json.dumps(checks),flush=True)
    return checks


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd())
    p.add_argument('--runtime',type=Path,required=True);p.add_argument('--candidates',type=Path,required=True)
    a=p.parse_args();release(a.repo.resolve(),a.runtime.resolve(),a.candidates.resolve())
