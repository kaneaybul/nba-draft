"""Independent nearby-snapshot diagnostics for simple player-for-pick trades.

Not used to fit either model. Cash, protected rights, player bundles, and picks
sent with the player are rejected. Sparse monthly snapshots are not exact
transaction-date quotes. TPEs are disclosed, not assigned an invented price.
"""
import json
import re
from datetime import date
from pathlib import Path


def benchmark(source,events_file):
    snapshots=[]
    for p in Path(source).glob('???.json'):
        d=json.load(p.open())
        if 'snapshots' in d:
            snapshots.extend(d['snapshots'])
    dates=sorted({s['date'] for s in snapshots})
    by_date={dt:[s for s in snapshots if s['date']==dt] for dt in dates}
    result=[]
    for e in json.load(Path(events_file).open()):
        text=e['text']
        if len(e.get('players',[]))!=1 or 'trade' not in e.get('parsed_status',''):
            continue
        if not re.search('pick',text,re.I) or re.search('cash|draft rights|sign-and-trade|swap|protect|conditional|favorable',text,re.I):
            continue
        if 'in exchange for:' not in text:
            continue
        left,right=text.split('in exchange for:',1)
        player=e['players'][0]
        if player['name'].lower() not in left.lower() or re.search('pick',left,re.I):
            continue
        picks=re.findall(r'(\d{4}) 2nd round pick \(([A-Z]{3}) own\)',right)
        if not picks:
            continue
        next_date=next((dt for dt in dates if dt>=e['date']),None)
        if next_date is None:
            continue
        lag=(date.fromisoformat(next_date)-date.fromisoformat(e['date'])).days
        if lag>31:
            continue
        all_assets=[a for s in by_date[next_date] for a in s['assets']]
        player_assets=[a for a in all_assets if a['kind']=='player' and
                       a['id']==f"player:nba:{player['nba_id']}"]
        aliases={'BRK':'BKN','UTH':'UTA','PHO':'PHX','CHO':'CHA'}
        basket=[]
        for year,origin in picks:
            ident=f'pick:{aliases.get(origin,origin)}:{year}:2'
            matching=[a for a in all_assets if a['id']==ident]
            # Clean single-holder rights only; do not price a protected basket.
            if len(matching)!=1 or matching[0].get('holding_probability',0)<.999999:
                basket=[];break
            basket.append(matching[0])
        if len(player_assets)!=1 or len(basket)!=len(picks):
            continue
        p=player_assets[0]['value'];b=sum(a['value'] for a in basket)
        result.append(dict(event_id=e['event_id'],trade_date=e['date'],quote_date=next_date,
            quote_lag_days=lag,player=player['name'],player_quote=p,pick_basket_quote=b,
            player_to_picks_ratio=p/b if b else None,
            pick_ids=[a['id'] for a in basket],tpe_mentioned='TPE' in text,
            source=e['source'],source_text=text))
    return result


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True)
    p.add_argument('--events',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();r=benchmark(a.source,a.events)
    a.out.write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
