"""Verify on-pace blending and owner-independent development on real histories."""
import argparse,gzip,json
from collections import Counter
from pathlib import Path
from attribution_players import parts
from endpoint_stock import active
from model_version import data_root,METHOD
from publish import TEAMS,atomic

def read(path):
    if path.exists():return json.loads(path.read_text())
    with gzip.open(path.with_suffix('.json.gz'),'rt')as f:return json.load(f)

def review(repo):
    counts=Counter();totals=Counter();maximum_error=0.;baselines={};owners={}
    for team in TEAMS:
        history=read(data_root(repo)/'teams'/f'{team}.json')['snapshots']
        bydate={s['date']:{a['id']:a for a in s['assets']if a['kind']=='player'}for s in history}
        for s in history:
            for aid,a in bydate[s['date']].items():
                d=a['details'];g=d.get('draft_development',{})
                if not active(d)or g.get('status')!='priced':continue
                baseline=g['original_expectation']
                if aid in baselines:assert abs(baselines[aid]-baseline)<.02,(team,a['name'],'reset draft prior')
                baselines[aid]=baseline;owners.setdefault(aid,set()).add(team)
                c=d.get('path_calibration',{})
                if c.get('status')!='priced':continue
                expected=(1-c['nba_weight'])*baseline+c['nba_weight']*c['nba_production_quote']
                assert abs(c['production_quote']-expected)<.02,(team,s['date'],a['name'],'endpoint blend')
                audit=c['endpoint_projection']
                assert audit.get('latest_label',c['cutoff'])<=c['cutoff'],'future revision label'
                counts['verified_endpoint_blends']+=1
                counts['zero_evidence_prior_quotes']+=c['nba_weight']==0
        ledger=read(data_root(repo)/'attribution'/f'{team}.json')
        for interval in ledger['intervals']:
            totals.update(interval['categories'])
            previous,current=bydate[interval['start']],bydate[interval['end']]
            contributors={r['player']:r['value']for r in interval['contributors']['draft']}
            for aid in previous.keys()&current.keys():
                a,b=previous[aid],current[aid];d=b['details'];g=d.get('draft_development',{})
                if not(active(a['details'])and active(d))or interval['end']>g['endpoint']:continue
                change=parts(b)[0]-parts(a)[0]
                attributed=contributors.get(b['name'],0.)
                error=abs(attributed-change);maximum_error=max(maximum_error,error)
                assert error<.02,(team,interval['end'],b['name'],change,attributed)
                counts['verified_continuing_draftee_intervals']+=1
    counts['draftees_observed_with_multiple_owners']=sum(len(v)>1 for v in owners.values())
    result=dict(method=METHOD,counts=dict(counts),maximum_development_reconciliation_error=maximum_error,
                league_category_totals=dict(totals),centering_applied=False)
    atomic(repo/'processed/asset_history/draftee_development_validation.json',result)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd())
    print(json.dumps(review(p.parse_args().repo.resolve())))
