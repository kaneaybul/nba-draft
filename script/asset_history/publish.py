"""Validate dated asset inventories and publish without rewriting closed months.

Candidate input is intentionally separate from current app trade values: a team
must have dated ownership, contract terms, SKILL and joint pick EV coverage.
"""
import argparse, calendar, copy, hashlib, json, math, os
from datetime import date, datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'frontend/public/data/asset_history/v1'
TEAMS='ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split()
METHOD='peak4-payroll-0.8-v1'
REQUIRED=('ownership','contracts','skill','pick_rights','injury_review')

def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,separators=(',',':'),allow_nan=False));os.replace(tmp,path)
def finite(x):return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def validate(s):
    assert s['team'] in TEAMS and s['method']==METHOD
    d=date.fromisoformat(s['date']);assert d<=datetime.now(timezone.utc).date()
    assert s['reporting_cap']>0 and finite(s['reporting_cap'])
    assert all(s['coverage'].get(k) is True for k in REQUIRED),'Incomplete coverage'
    assert s['source_cutoff']==s['date'],'Source cutoff must match valuation date'
    assert s['vintage'] in ('reconstructed','published')
    assets=s['assets'];ids=[a['id'] for a in assets]
    assert len(ids)==len(set(ids)),'Duplicate asset ownership'
    assert all(a['kind'] in ('player','pick') and finite(a['value']) for a in assets)
    assert finite(s['total']) and abs(sum(a['value'] for a in assets)-s['total'])<.01,'Inventory does not reconcile'
    for a in assets:
        assert a.get('source'),'Missing asset provenance'
        if a['kind']=='player':
            assert a.get('exposure') is not None and abs(a['exposure']-4)<1e-8,'Incomplete four-year quote'
    return d

def merge(existing,candidate):
    d=validate(candidate);new=copy.deepcopy(candidate)
    latest=max((s['date'] for s in existing.get('snapshots',[])),default='')
    if latest>new['date'] and not any(s['date']==new['date'] and s.get('closed') for s in existing.get('snapshots',[])):
        raise ValueError('Stale candidate cannot replace newer inventory')
    monthend=d.day==calendar.monthrange(d.year,d.month)[1]
    new['closed']=monthend
    points=copy.deepcopy(existing.get('snapshots',[]))
    for old in points:
        if old['date']==new['date'] and old.get('closed'):
            # Compare canonical candidate content; generated timestamps do not
            # alter a sealed observation. Corrections require a new method path.
            if digest(old)!=digest(new):raise ValueError('Closed month is immutable; publish a versioned correction')
            return existing
    points=[x for x in points if x.get('closed') or x['date'][:7]!=new['date'][:7]]
    points.append(new);points.sort(key=lambda x:x['date'])
    return {'schema_version':1,'team':candidate['team'],'method':METHOD,'snapshots':points}

def publish(candidates,out=OUT,require_league=False):
    if require_league:
        dates={s["date"] for s in candidates}
        assert len(dates)==1 and {s["team"] for s in candidates}==set(TEAMS),"Daily publication requires all 30 teams on one common cutoff"
    # Validate the complete batch and detect cross-team duplication before writes.
    keys=set();bydate={}; staged={}
    for s in candidates:
        validate(s);k=(s['team'],s['date']);assert k not in keys;keys.add(k)
        for a in s['assets']:
            if a['kind']=='player':
                player=(s['date'],a['id']);assert player not in bydate,'Player appears on two teams';bydate[player]=s['team']
        team=s['team'];path=out/'teams'/f'{team}.json'
        existing=staged.get(team) or (json.loads(path.read_text()) if path.exists() else {'snapshots':[]})
        staged[team]=merge(existing,s)
    for team,data in staged.items():atomic(out/'teams'/f'{team}.json',data)
    manifest={'schema_version':1,'method':METHOD,'generated_at':datetime.now(timezone.utc).isoformat(),'teams':[]}
    for team in TEAMS:
        f=out/'teams'/f'{team}.json';x=json.loads(f.read_text()) if f.exists() else None
        snapshots=x['snapshots'] if x else []
        manifest['teams'].append({'team':team,'status':'available' if snapshots else 'pending_backfill','count':len(snapshots),'latest':snapshots[-1]['date'] if snapshots else None,'path':f'/data/asset_history/v1/teams/{team}.json' if snapshots else None})
    atomic(out/'manifest.json',manifest)
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--require-league',action='store_true');a=p.parse_args()
    data=json.loads(a.input.read_text());print(json.dumps(publish(data['snapshots'],require_league=a.require_league)['teams']))
