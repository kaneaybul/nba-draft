"""Versioned, source-identical conversion of published inputs to endpoint stocks."""
from __future__ import annotations
import argparse,copy,json,sys
from collections import Counter
from pathlib import Path
from datetime import datetime,timezone
from model_version import DATA_VERSION,LEGACY_VERSION,METHOD,data_root
from endpoint_stock import promote,STOCK_POLICY,promote_quote
from materialize import materialize,compact
from publish import TEAMS,publish,atomic
from assemble import bridge
from versioned_rebuild import reprice_historical_picks

def migrate(repo,runtime):
    materialize(repo);out=data_root(repo)
    if (out/'manifest.json').exists():raise ValueError('New version already published; do not rewrite closed history')
    model=json.loads((repo/'processed/asset_history/picks/trained_pick_model.json').read_text())
    model['stock_policy']=STOCK_POLICY
    sys.path.insert(0,str(repo/'script/asset_history/backfill'))
    from forfeiture_rules import RoundAwarePickQuotes
    from calibration.endpoint_model import EndpointModel
    from attribution_players import name_key
    quotes=RoundAwarePickQuotes(model);prior=EndpointModel(model['endpoint_records'])
    for row in model['pick_curve']:
        c=quotes.components(1 if row['pick']<=30 else 2,row['pick'])
        row.update(quote=c['quote'],peak_production_quote=c['production_quote'],contract_adjustment=c['contract_adjustment'],draft_endpoint_expectation=c['draft_endpoint_expectation'])
    atomic(repo/'processed/asset_history/picks/trained_pick_model.json',model)
    old={t:json.loads((data_root(repo,LEGACY_VERSION)/'teams'/f'{t}.json').read_text())for t in TEAMS}
    dates=sorted(s['date']for s in old['UTA']['snapshots']);asof=dates[-1]
    repriced=reprice_historical_picks(repo,model,dates)
    from run_pick_refresh import run as refresh_picks
    repriced[asof]=refresh_picks(repo,runtime,asof,repo/'processed/asset_history/endpoint_latest_pick_candidates.json')
    candidates=[];effects=Counter();grades=Counter()
    for team,file in old.items():
        previous=None
        for before in file['snapshots']:
            s=copy.deepcopy(before);s.update(method=METHOD,vintage='reconstructed')
            s.pop('method_comparison',None);s.pop('bridge',None)
            players=[]
            for a in s['assets']:
                if a['kind']!='player':continue
                d=a['details'];year=int(float(d.get('draft_year')or 0));slot=int(float(d.get('draft_slot')or 0))
                if year>=2022 and slot and d.get('asset_type')=='unsigned_draft_right' and s['date']<=f'{year+4}-07-31':
                    original=prior.prior(slot,min(model['endpoint_training_through'],year-1),name_key(a['name']))['value']
                    d['draft_development']=dict(status='priced',method='year-four-production-endpoint-v1',endpoint=f'{year+4}-07-31',original_expectation=original,value=original,gain=0.,nba_weight=0.,completed=False,contract_effect=0.)
                before_contract=float(d['contract_adjustment'])
                value=promote(d,a['value'],s['date'])
                if d.get('endpoint_stock_policy')==STOCK_POLICY:
                    if abs(d['peak_production']-d['draft_development']['value'])>.01:raise ValueError('Endpoint stock identity failed')
                    if d['contract_adjustment']!=before_contract:raise ValueError('Migration changed salary effects')
                if value!=a['value']:
                    effects[team]+=value-a['value']
                    q=d.get('path_calibration')
                    if q and q.get('status')=='priced':d['path_calibration']=promote_quote(q,d['draft_development'],s['date'])
                    elif q and q.get('status')=='unsigned_draft_right_existing_policy':q.update(value=value,production_quote=d['peak_production'],contract_adjustment_sum=d['contract_adjustment'])
                    a['value']=value;grades['repriced']+=1
                players.append(a)
            s['assets']=players+repriced[s['date']]['teams'][team]
            s['total']=sum(a['value']for a in s['assets'])
            s.setdefault('assumptions',[]).append('Picks and original development-window production use the same year-four target; salaries are separate; older unsupported historical cohorts retain the archived production policy.')
            if previous:s['bridge']=bridge(previous,s)
            previous=s;candidates.append(s)
    publish(candidates,out)
    from attribution import run
    run(repo,runtime,workers=2)
    from validate_attribution import validate
    checks=validate(repo)
    from source_signature import source_signature
    atomic(out/'refresh_status.json',dict(status='success',method=METHOD,observation_date=asof,recorded_at=datetime.now(timezone.utc).isoformat(),teams=30,observations=len(candidates),source_signature=source_signature(repo)))
    atomic(repo/'processed/asset_history/endpoint_stock_release.json',dict(method=METHOD,source_version=LEGACY_VERSION,observation_date=asof,repriced_player_observations=grades['repriced'],checks=checks))
    compact(repo);print(json.dumps(checks),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());p.add_argument('--runtime',type=Path,required=True);a=p.parse_args();migrate(a.repo.resolve(),a.runtime.resolve())
