"""Expose the validated Asset History quotes to every app value surface.

This is a build projection of published data, not a second valuation model.
It runs after asset-history materialization and never rewrites the archive.
"""
from __future__ import annotations
import argparse,json,math,sys
from pathlib import Path

TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()

def build(repo):
    public=repo/'frontend/public/data'
    sys.path.insert(0,str(repo/'script/asset_history'))
    from model_version import DATA_VERSION,METHOD
    version=DATA_VERSION
    root=public/'asset_history'/version
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest['method']!=METHOD:raise ValueError('Published asset method differs from application method')
    latest={row['latest']for row in manifest['teams']if row['status']=='available'}
    if len(latest)!=1 or len(manifest['teams'])!=30:raise ValueError('Asset quotes need a complete same-date league')
    day=latest.pop();players={};picks=[];seen=set()
    for team in TEAMS:
        data=json.loads((root/'teams'/f'{team}.json').read_text())
        snapshot=next(s for s in data['snapshots']if s['date']==day)
        for asset in snapshot['assets']:
            value=asset['value']
            if not math.isfinite(value):raise ValueError('Nonfinite published asset value')
            if asset['kind']=='player' and asset['id'].startswith('player:nba:'):
                pid=asset['id'].split(':')[-1]
                if pid in seen:raise ValueError('Duplicate player valuation identity')
                seen.add(pid)
                annual=asset.get('details',{}).get('annual_values',[])
                if annual:
                    if abs(sum(r['exposure']for r in annual)-4)>1e-8:raise ValueError('Incomplete annual value path')
                    if any(not math.isfinite(r[k])for r in annual for k in ['production','asset','exposure']):raise ValueError('Nonfinite annual path')
                    # Scenario-valued quotes select the peak within each path
                    # before averaging. Their annual means alone cannot recover
                    # that expected peak; reconcile the exported components.
                    remaining=2.;peak=0.
                    for row in sorted(annual,key=lambda r:-r['production']):
                        take=min(remaining,row['exposure']);peak+=take*row['production'];remaining-=take
                    quote=2*peak+sum((r['asset']-r['production'])*r['exposure']for r in annual)
                    calibration=asset.get('details',{}).get('path_calibration',{})
                    if calibration.get('status')=='priced':
                        if abs(quote-calibration['mean_path_quote'])>.01:
                            raise ValueError('Scenario mean annual path does not reconcile')
                        quote=calibration['production_quote']+calibration['contract_adjustment_sum']
                        annual_adjustment=sum((r['asset']-r['production'])*r['exposure']for r in annual)
                        if abs(annual_adjustment-calibration['contract_adjustment_sum'])>.01:
                            raise ValueError('Expected annual contract costs do not reconcile')
                        if abs(calibration['mean']-value)>.01:raise ValueError('Expected scenario quote does not reconcile')
                    if abs(quote-value)>.01:raise ValueError('Annual path disagrees with the published player quote')
                players[pid]={'date':day,'value':value,'annual':annual}
                d=asset.get('details',{})
                for k in ('draft_development','raw_annual_production'):
                    if d.get(k)is not None:players[pid][k]=d[k]
                if asset.get('details',{}).get('path_calibration',{}).get('status')=='priced':
                    c=asset['details']['path_calibration']
                    players[pid]['distribution']={k:c[k]for k in ('p10','p50','p90','production_quote','contract_adjustment_sum','nba_weight')}
            elif asset['kind']=='pick':
                picks.append({'team':team,'origin':asset['physical_origin'],'year':asset['draft_year'],
                              'round':asset['round'],'value':value})
    model=json.loads((repo/'processed/asset_history/picks/trained_pick_model.json').read_text())
    if DATA_VERSION in ('v5','v6')and model.get('production_policy')!='year-four-production-endpoint-v1':
        raise ValueError('Published v5 inventories need the shared endpoint-trained pick model')
    slots={str(row['pick']):row['quote']for row in model['pick_curve']}
    if len(slots)!=60 or any(not math.isfinite(v)for v in slots.values()):raise ValueError('Incomplete asset pick curve')
    season=int(day[:4])+(int(day[5:7])>=7)
    if DATA_VERSION=='v6' and model.get('stock_policy')!='year-four-endpoint-stock-v2':
        raise ValueError('v6 requires endpoint stock pick pricing')
    result={'schema_version':1,'method':manifest['method'],'history_version':version,'generated_at':manifest['generated_at'],
            'observation_date':day,'season':season,'reporting_cap':164961000,
            'players':players,'picks':picks,'slots':slots}
    target=public/'asset_valuation.json'
    target.write_text(json.dumps(result,separators=(',',':'),allow_nan=False)+'\n')
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,default=Path.cwd());args=parser.parse_args()
    result=build(args.repo.resolve())
    print(json.dumps({'date':result['observation_date'],'players':len(result['players']),'pick_claims':len(result['picks']),'slots':len(result['slots'])}))


