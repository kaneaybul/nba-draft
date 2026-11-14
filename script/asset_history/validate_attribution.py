"""Exhaustive ledger checks, including every selectable contiguous period."""
import argparse,json
from pathlib import Path
from collections import Counter
from attribution import LABELS,NAMES,ATTRIBUTION_METHOD,TRADE_WAIVER_NONTRANSFER_COMPONENTS
from model_version import data_root,METHOD
from endpoint_stock import active as endpoint_active

def validate(repo):
    root=data_root(repo);books={};ranges=0;largest=0.;net_trades=Counter();net_lottery=Counter();interval_count=0
    for team in NAMES:
        book=json.loads((root/'attribution'/f'{team}.json').read_text());books[team]=book
        assert book['method']==ATTRIBUTION_METHOD and book['valuation_method']==METHOD
        history={s['date']:s for s in json.loads((root/'teams'/f'{team}.json').read_text())['snapshots']}
        for snapshot in history.values():
            for asset in snapshot['assets']:
                d=asset.get('details',{})
                if endpoint_active(d):
                    if snapshot['date']<=d['draft_development']['endpoint']:
                        assert abs(d['peak_production']-d['draft_development']['value'])<.01,('Shared padded draft/player identity',team,asset['name'])
                    assert 'development_window_basis'not in d,('Obsolete draft basis',team,asset['name'])
                    assert d['draft_development']['method']=='year-four-assessed-production-paths-v3'
                    assert abs(asset['value']-d['peak_production']-d['contract_adjustment'])<.01,('Contract split',team,asset['name'])
        intervals=book['intervals'];assert len(intervals)==len(history)-1
        for i,row in enumerate(intervals):
            assert set(row['categories'])==set(LABELS),'Non-MECE category schema'
            assert abs(row['opening']-history[row['start']]['total'])<.01
            assert abs(row['closing']-history[row['end']]['total'])<.01
            assert i==0 or intervals[i-1]['end']==row['start'],'Gap in attribution'
            for key,value in row['categories'].items():assert abs(sum(row['components'][key].values())-value)<.01
            error=row['opening']+sum(row['categories'].values())-row['closing'];largest=max(largest,abs(error));assert abs(error)<.01
            # Waivers and forecasts affect the deal's value without transferring
            # an asset to another team. Only actual transfers must cancel out.
            net_trades[row['end']] += sum(value for label, value in row['components']['trades'].items()
                                          if label not in TRADE_WAIVER_NONTRANSFER_COMPONENTS)
            net_lottery[row['end']]+=row['categories']['lottery'];interval_count+=1
        for first in range(len(intervals)):
            running=Counter()
            for last in range(first,len(intervals)):
                running.update(intervals[last]['categories']);error=intervals[first]['opening']+sum(running.values())-intervals[last]['closing'];assert abs(error)<.01,(team,first,last,error);ranges+=1
    assert max(abs(v)for v in net_trades.values())<.01,('League trade conservation',net_trades)
    assert max(abs(v)for v in net_lottery.values())<.01,('League lottery conservation',net_lottery)
    golden=json.loads((repo/'processed/asset_history/attribution_jazz_benchmark.json').read_text());actual=Counter()
    for row in books['UTA']['intervals']:
        if golden['start']<=row['start'] and row['end']<=golden['end']:actual.update(row['categories'])
    # Any source correction that changes this established benchmark needs review.
    for key,want in (golden['categories'].items() if golden.get('method')==METHOD else []):assert abs(actual[key]-want)<.05,('Corrected Jazz benchmark',key,actual[key],want)
    return dict(teams=len(books),intervals=interval_count,selectable_periods=ranges,max_reconciliation_error=largest,trade_conservation='passed',lottery_conservation='passed',corrected_jazz_benchmark='passed' if golden.get('method')==METHOD else 'archived benchmark preserved; rolling / endpoint identity validated separately')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path.cwd());args=p.parse_args();print(json.dumps(validate(args.repo.resolve()),indent=2))

