"""Project published Asset History quotes into current and dated app feeds.

Every quote is copied from a validated inventory. Historical season rows use
the final available observation in that season, never today's player price.
"""
from __future__ import annotations
import argparse,json,math,sys
from pathlib import Path

TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()

def season_of(day):
    return int(day[:4])+(int(day[5:7])>=7)

def player_quote(asset,day):
    value=asset['value'];details=asset.get('details',{});annual=details.get('annual_values',[])
    if annual:
        if abs(sum(r['exposure']for r in annual)-4)>1e-8:raise ValueError('Incomplete annual value path')
        if any(not math.isfinite(r[k])for r in annual for k in ['production','asset','exposure']):raise ValueError('Nonfinite annual path')
        remaining=2.;peak=0.
        for row in sorted(annual,key=lambda r:-r['production']):
            take=min(remaining,row['exposure']);peak+=take*row['production'];remaining-=take
        quote=2*peak+sum((r['asset']-r['production'])*r['exposure']for r in annual)
        calibration=details.get('path_calibration',{})
        if calibration.get('status')=='priced':
            if abs(quote-calibration['mean_path_quote'])>.01:raise ValueError('Scenario mean annual path does not reconcile')
            quote=calibration['production_quote']+calibration['contract_adjustment_sum']
            adjustment=sum((r['asset']-r['production'])*r['exposure']for r in annual)
            if abs(adjustment-calibration['contract_adjustment_sum'])>.01:raise ValueError('Expected annual contract costs do not reconcile')
            if abs(calibration['mean']-value)>.01:raise ValueError('Expected scenario quote does not reconcile')
        if abs(quote-value)>.01:raise ValueError('Annual path disagrees with the published player quote')
    grade=details.get('draft_development')or{}
    if grade.get('status')=='priced' and day<=grade.get('endpoint',''):
        if abs(grade['value']-details['peak_production'])>.01:
            raise ValueError('Draft appraisal differs from the shared player quote')
    result={'date':day,'value':value,'annual':annual}
    for key in ('draft_development','raw_annual_production','role_minutes_policy'):
        if details.get(key)is not None:result[key]=details[key]
    if details.get('path_calibration',{}).get('status')=='priced':
        result['distribution']={k:details['path_calibration'][k]for k in ('p10','p50','p90','production_quote','contract_adjustment_sum','nba_weight')if k in details['path_calibration']}
    return result

def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,separators=(',',':'),allow_nan=False)+'\n')

def build(repo):
    public=repo/'frontend/public/data'
    sys.path.insert(0,str(repo/'script/asset_history'))
    from model_version import DATA_VERSION,METHOD
    root=public/'asset_history'/DATA_VERSION
    manifest=json.loads((root/'manifest.json').read_text())
    if manifest['method']!=METHOD:raise ValueError('Published asset method differs from application method')
    latest={r['latest']for r in manifest['teams']if r['status']=='available'}
    if len(latest)!=1 or len(manifest['teams'])!=30:raise ValueError('Asset quotes need a complete same-date league')
    day=latest.pop();selected=None;feeds={}
    for team in TEAMS:
        data=json.loads((root/'teams'/f'{team}.json').read_text())
        observations={s['date']:s for s in data['snapshots']}
        dates={}
        for dt in sorted(observations):dates[season_of(dt)]=dt
        if selected is None:
            selected=dates
            feeds={dt:{'players':{},'picks':[]}for dt in selected.values()}
        if dates!=selected:raise ValueError('Historical asset quotes need complete same-date league seasons')
        for dt in selected.values():
            feed=feeds[dt]
            for asset in observations[dt]['assets']:
                if not math.isfinite(asset['value']):raise ValueError('Nonfinite published asset value')
                if asset['kind']=='player'and asset['id'].startswith('player:nba:'):
                    pid=asset['id'].split(':')[-1]
                    if pid in feed['players']:raise ValueError('Duplicate player valuation identity')
                    feed['players'][pid]=player_quote(asset,dt)
                elif asset['kind']=='pick':
                    feed['picks'].append({'team':team,'origin':asset['physical_origin'],'year':asset['draft_year'],'round':asset['round'],'value':asset['value']})
    model=json.loads((repo/'processed/asset_history/picks/trained_pick_model.json').read_text())
    if model.get('production_policy')!='year-four-assessed-production-paths-v3':raise ValueError('Published inventories need the shared career-path endpoint-trained pick model')
    if model.get('stock_policy')!='year-four-endpoint-picks-shared-players-v4':raise ValueError('Current release requires shared padded player pricing')
    slots={str(r['pick']):r['quote']for r in model['pick_curve']}
    if len(slots)!=60 or any(not math.isfinite(v)for v in slots.values()):raise ValueError('Incomplete asset pick curve')
    index={}
    reviews=json.loads((repo/'script/asset_history/backfill/reviewed_trade_packages.json').read_text())
    for year,dt in selected.items():
        reviewed={}
        for package in reviews['packages']:
            if package['date']>dt:continue
            for transfer in package['pick_transfers']:
                if not transfer.get('unprotected'):continue
                key=(transfer['origin_team'],transfer['draft_year'],transfer['round'])
                claims=[p for p in feeds[dt]['picks'] if (p['origin'],p['year'],p['round'])==key]
                # The current legal replay, not the original recipient, owns the
                # quote if the pick has subsequently been traded again.
                if len(claims)==1:
                    reviewed[key]={**claims[0],'source_url':package['sources'][0]}
        feeds[dt]['reviewed_pick_ownership']=list(reviewed.values())
        path=f'/data/asset_valuations/{DATA_VERSION}/{year}.json'
        index[str(year)]={'observation_date':dt,'path':path}
        feeds[dt].update(schema_version=2,method=METHOD,history_version=DATA_VERSION,
            generated_at=manifest['generated_at'],observation_date=dt,season=year,reporting_cap=164961000,slots=slots)
        write(public/path.removeprefix('/data/'),feeds[dt])
    result={**feeds[day],'seasons':index}
    write(public/'asset_valuation.json',result)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());args=p.parse_args()
    result=build(args.repo.resolve())
    print(json.dumps({'date':result['observation_date'],'players':len(result['players']),'pick_claims':len(result['picks']),'slots':len(result['slots']),'seasons':result['seasons']}))
