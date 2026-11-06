"""Publish one MECE rolling-production attribution ledger for every NBA team.

Every adjacent pair reconciles to canonical inventory without a residual bucket.
Arbitrary selected windows are sums of those same additive interval records.
"""
from __future__ import annotations
import argparse,base64,csv,gzip,hashlib,importlib.util,json,os,re,sys,zipfile
from collections import Counter,defaultdict
from concurrent.futures import ProcessPoolExecutor,as_completed
from multiprocessing import get_context
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from attribution_players import AGING_COMPONENT,player_bridge,clock,parts,market_reference,name_key
from endpoint_stock import active as endpoint_active
from model_version import data_root,METHOD,ATTRIBUTION_METHOD
import attribution_picks as picks

# The change to the player baseline does not invalidate historical pick replays.
PICK_CACHE_METHOD='age-separated-attribution-v5'
LABELS={'aging':'Aging','player':'Player Development','draft':'Draftee Development','trades':'Trades','contracts':'Contract Management','fa':'FA Signings','own_picks':'Own Pick Revaluation','acquired_picks':'Acquired Pick Revaluation','lottery':'Lottery Luck','automatic':'Automatic Pick Additions'}
NAMES=dict(zip('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split(),['Atlanta Hawks','Brooklyn Nets','Boston Celtics','Charlotte Hornets','Chicago Bulls','Cleveland Cavaliers','Dallas Mavericks','Denver Nuggets','Detroit Pistons','Golden State Warriors','Houston Rockets','Indiana Pacers','Los Angeles Clippers','Los Angeles Lakers','Memphis Grizzlies','Miami Heat','Milwaukee Bucks','Minnesota Timberwolves','New Orleans Pelicans','New York Knicks','Oklahoma City Thunder','Orlando Magic','Philadelphia 76ers','Phoenix Suns','Portland Trail Blazers','Sacramento Kings','San Antonio Spurs','Toronto Raptors','Utah Jazz','Washington Wizards']))

# Review the receiving team's trade and waiver as one episode. The reported
# dead cap is context for the deal and does not change the asset snapshots.
TRADE_WAIVERS = {
    ('UTA', 'player:nba:1628366'): dict(
        player='Lonzo Ball', acquired='2026-02-05', waived='2026-02-05',
        dead_cap=10_000_000, source='https://www.salaryswish.com/players/lonzo-ball',
    ),
    ('UTA', 'player:nba:1630240'): dict(
        player='Saben Lee', acquired='2022-09-22', waived='2022-10-09',
        dead_cap=1_752_638, source='https://www.salaryswish.com/players/saben-lee',
    ),
}
TRADE_WAIVER_COMPONENTS = {
    ('trades', 'Incoming player'): 'Trade receipt',
    ('trades', 'Intermediate acquired player absent at month-end'): 'Trade receipt',
    ('trades', 'Intermediate player receipt before loss of control'): 'Trade receipt',
    ('contracts', 'Intermediate loss of contract control'): 'Waiver',
    ('contracts', 'Waiver or expiry of contract control'): 'Waiver',
    ('contracts', 'Existing contract and continuation revaluation'): 'Contract and continuation forecast',
    ('contracts', 'Remaining contract-year mix'): 'Contract and continuation forecast',
    ('aging', AGING_COMPONENT): 'Production forecast',
    ('player', 'Player production forecast changes'): 'Production forecast',
}
TRADE_WAIVER_NONTRANSFER_COMPONENTS = {
    f'{deal["player"]} · {label}' for deal in TRADE_WAIVERS.values()
    for (category, _), label in TRADE_WAIVER_COMPONENTS.items() if category != 'trades'
}


def attribute_trade_waiver(team, row):
    deal = TRADE_WAIVERS.get((team, row['asset_id']))
    if deal and row['start'] < deal['waived'] and deal['acquired'] <= row['end']:
        label = TRADE_WAIVER_COMPONENTS.get((row['category'], row['component']))
        if label:
            return dict(row, category='trades', component=f'{deal["player"]} · {label}')
    return row


def read(path):return json.loads(Path(path).read_text())
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(path)

def context(repo,runtime):
    histories={}
    for team in NAMES:
        file=data_root(repo)/'teams'/f'{team}.json'
        if file.exists() and file.stat().st_size:rows=read(file)['snapshots']
        else:
            with gzip.open(file.with_suffix('.json.gz'),'rt')as f:rows=json.load(f)['snapshots']
        histories[team]={s['date']:s for s in rows}
    dates=sorted(histories['UTA'])
    if any(sorted(h)!=dates for h in histories.values()):raise ValueError('Attribution needs all 30 teams on the same observation dates')
    league={};owners={}
    for team,h in histories.items():
        for day,s in h.items():
            for asset in s['assets']:
                if asset['kind']=='player':
                    if(day,asset['id'])in owners:raise ValueError('Duplicated player ownership')
                    league[day,asset['id']]=asset;owners[day,asset['id']]=team
    review=read(repo/'processed/asset_history/attribution_reviewed.json')
    drafts={name_key(r['player']):r for r in review['drafts']}
    for r in review.get('draft_owners',[]):
        key=name_key(r['player'])
        if key in drafts:drafts[key]['team']=r['team']
    # New selections enter under their first retained draft-night claim owner.
    for day in dates:
        for team,h in histories.items():
            for a in h[day]['assets']:
                d=a.get('details',{});year=int(float(d.get('draft_year')or 0))
                if a['kind']=='player'and year>=2022 and year==int(day[:4]) and name_key(a['name'])not in drafts:drafts[name_key(a['name'])]=dict(player=a['name'],year=year,team=team)
    events=read(runtime/'monthly_reconstruction/league_ownership/league_events.json')
    saved=repo/'processed/asset_history/player_state/ownership_events.json'
    if saved.exists():
        additional=read(saved);additional=additional.get('events',additional)if isinstance(additional,dict)else additional
        events=list({(e['event_id'],e['date'],e['text']):e for e in events+additional}.values())
    agreements=repo/'processed/asset_history/contracts/contract_agreements.json'
    if agreements.exists():contracts=read(agreements)
    else:
        with gzip.open(agreements.with_suffix('.json.gz'),'rt')as f:contracts=json.load(f)
    contracts += [dict(r,adjustment_only=True,salaries=[])for r in read(repo/'processed/asset_history/contracts/contract_adjustments.json')]
    caps={int(r['year']):(float(r['salary_cap']),float(r['scale_cap']))for r in csv.DictReader((repo/'processed/livedata/impactrefresh/salary_cap_assumptions.csv').open())};caps[2027]=(164961000.,caps[2027][1])
    spec=importlib.util.spec_from_file_location('attribution_expected_contracts',runtime/'monthly_reconstruction/projections/expected_contracts.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    # The existing reviewed Utah trade ledger supplies missing dated roster evidence.
    spec=importlib.util.spec_from_file_location('attribution_reviewed_trades',runtime/'curated_ledger_v3.py');ledger=importlib.util.module_from_spec(spec);spec.loader.exec_module(ledger)
    return dict(teams=list(NAMES),names=NAMES,histories=histories,dates=dates,league=league,owners=owners,events=events,drafts=drafts,contracts=contracts,caps=caps,market=mod.ExpectedContracts(caps),reviewed_trades=ledger.TRADES,reviewed_routes=review['routes'])

def correct_transfers(players,ctx):
    """Same source-side transfer price, including receipts waived within a month."""
    by_interval={t:{(r['start'],r['end']):r for r in p['intervals']}for t,p in players.items()}
    def add(team,row,category,component,value,raw):
        p=players[team];key=row['start'],row['end']
        for k,v in raw.items():
            p['totals'][k]=p['totals'].get(k,0)+v;it=by_interval[team][key];it['changes'][k]=it['changes'].get(k,0)+v
        p['attribution'].append(dict(start=row['start'],end=row['end'],player=row['player'],asset_id=row['asset_id'],category=category,component=component,value=value))
    def loss_of_control(team,row,value,component):
        # A prospect traded and waived between snapshots still carries the
        # original development clock. Losing that production belongs to the
        # receiving team's Draftee Development, just as for an observed waiver.
        asset=ctx['league'].get((row['start'],row['asset_id']))
        d=asset.get('details',{})if asset else {}
        grade=d.get('draft_development',{})
        production=0.
        if endpoint_active(d)and row['end']<=grade.get('endpoint',''):
            annual=next((a['details']['annual_values']for a in ctx['histories'][team][row['end']]['assets']
                         if a['kind']=='player'and a.get('details',{}).get('annual_values')),None)
            if annual:
                production=clock(asset,{int(r['season']):r['exposure']for r in annual})['peak']
                add(team,row,'draft','Loss of acquired draftee before year four',-production,{})
        add(team,row,'contracts',component,-value+production,{'waiver_expiry_boundary':-value})
    legs=defaultdict(list)
    for team,p in players.items():
        for row in p['attribution']:
            if row['category']=='trades':legs[row['start'],row['end'],row['asset_id']].append((team,row))
    corrections=[]
    for (start,end,aid),rows in legs.items():
        incoming=[(t,r)for t,r in rows if r['component']=='Incoming player'];outgoing=[(t,r)for t,r in rows if r['component']=='Outgoing player']
        if len(incoming)==len(outgoing)==1:
            target,a=incoming[0];source,b=outgoing[0];delta=-b['value']-a['value']
            if abs(delta)>.01:raise ValueError(('Mismatched transfer prices',start,end,aid,delta))
            reviewed=[r for r in ctx['reviewed_routes']if r.get('from_team')==source and r['date']==end and name_key(r['player'])==name_key(a['player'])]
            if reviewed and reviewed[-1]['to_team']!=target:
                intermediate=reviewed[-1]['to_team'];value=a['value']
                add(intermediate,a,'trades','Intermediate player receipt before loss of control',value,{'trade_players':value})
                loss_of_control(intermediate,a,value,'Intermediate loss of contract control')
                import copy
                asset=copy.deepcopy(ctx['league'][start,aid]);annual=next(z['details']['annual_values']for z in ctx['histories'][source][end]['assets']if z['kind']=='player'and z.get('details',{}).get('annual_values'));ex={int(r['season']):r['exposure']for r in annual};cf=clock(asset,ex)
                path={int(r['season']):r for r in asset['details']['annual_values']};tail=path[max(path)];asset['details']['annual_values']=[dict(path.get(y,tail),season=y,exposure=e)for y,e in sorted(ex.items())];asset['value']=cf['value'];asset['details']['peak_production']=cf['peak'];ref=market_reference(asset,end,ctx['caps'],ctx['market'])
                add(target,a,'trades','Post-waiver acquisition reclassified as FA',-value,{'trade_players':-value})
                add(target,a,'fa','Post-waiver reference-market acquisition',ref['value'],{'free_agent_entries':value})
                add(target,a,'contracts','Post-waiver terms versus reference',value-ref['value'],{})
                corrections.append(dict(date=end,player=a['player'],from_team=source,to_team=intermediate,kind='intermediate_before_FA',value=value))
            continue
        if len(incoming)>1 or len(outgoing)>1:raise ValueError(('Ambiguous player transfer legs',start,end,aid))
        if outgoing:
            source,row=outgoing[0];value=-row['value'];pid=int(aid.split(':')[-1])if ':nba:'in aid else None
            reviewed=[r for r in ctx['reviewed_routes']if r.get('from_team')==source and r['date']==end and name_key(r['player'])==name_key(row['player'])]
            events=[e for e in ctx['events']if start<e['date']<=end and 'trade'in e['parsed_status']and any(p.get('nba_id')==pid or name_key(p['name'])==name_key(row['player'])for p in e.get('players',[]))]
            targets=[a.get('to_team')for e in events for a in e.get('parsed_actions',[])if(a.get('nba_id')==pid or name_key(a.get('player_name',''))==name_key(row['player']))and a.get('to_team')in players and a.get('to_team')!=source]
            if not targets:
                aliases={name:t for t,name in ctx['names'].items()};aliases['Philadelphia Sixers']='PHI'
                pattern='|'.join(re.escape(n)for n in sorted(aliases,key=len,reverse=True))
                for event in events:
                    for match in re.finditer(r'([^.]*) (?:was|were) acquired by (?:the )?('+pattern+')',event['text'].replace('Jr.','Jr')):
                        if name_key(row['player'])in name_key(match.group(1))and aliases[match.group(2)]!=source:targets.append(aliases[match.group(2)])
            target=reviewed[-1]['to_team']if reviewed else targets[-1]if targets else None
            if target:
                add(target,row,'trades','Intermediate acquired player absent at month-end',value,{'trade_players':value})
                loss_of_control(target,row,value,'Intermediate loss of contract control')
                corrections.append(dict(date=end,player=row['player'],from_team=source,to_team=target,kind='intermediate_transfer',value=value))
            elif not events:
                add(source,row,'trades','Withdrawal of unverified transfer classification',value,{'trade_players':value})
                loss_of_control(source,row,value,'Loss of contract control')
            else:raise ValueError(('Unresolved transfer destination',source,start,end,row['player']))
        elif incoming:
            target,row=incoming[0];value=row['value'];origin=ctx['owners'].get((start,aid))
            if origin:
                old=ctx['league'][start,aid];annual=next(a['details']['annual_values']for a in ctx['histories'][origin][end]['assets']if a['kind']=='player'and a.get('details',{}).get('annual_values'));ex={int(r['season']):r['exposure']for r in annual};cf=clock(old,ex)
                import copy
                a=copy.deepcopy(old);path={int(r['season']):r for r in a.get('details',{}).get('annual_values',[])}
                if not path:raise ValueError(('Transferred control has no annual path',target,end,aid))
                tail=path[max(path)];a['details']['annual_values']=[dict(path.get(y,tail),season=y,exposure=e)for y,e in sorted(ex.items())];a['value']=cf['value'];a['details']['peak_production']=cf['peak']
                ref=market_reference(a,end,ctx['caps'],ctx['market'])
            else:
                reviewed=[r for r in ctx['reviewed_routes']if r['kind']=='unpriced_origin_basis'and r['date']==end and r['to_team']==target and name_key(r['player'])==name_key(row['player'])]
                if reviewed:
                    source=reviewed[-1]['from_team'];add(source,row,'trades','Previously unpriced owned claim transferred',-value,{'trade_players':-value});category='player'if value>=0 else'contracts';raw='player_production_revaluation'if value>=0 else'contract_continuation_revaluation';add(source,row,category,'Coverage basis recognized at first transfer mark',value,{raw:value});continue
                a=next(a for a in ctx['histories'][target][end]['assets']if a['id']==aid);ref=market_reference(a,end,ctx['caps'],ctx['market'])
            add(target,row,'trades','Expired or new control acquisition reclassified as FA',-value,{'trade_players':-value})
            add(target,row,'fa','Reference-market acquisition',ref['value'],{'free_agent_entries':value})
            add(target,row,'contracts','Terms versus reference market acquisition',value-ref['value'],{})
            corrections.append(dict(date=end,player=row['player'],team=target,kind='FA_control_acquisition',value=value))
    for team,p in players.items():
        for it in p['intervals']:
            if abs(sum(it['changes'].values())-it['delta'])>.01:raise ValueError(('Player interval failed',team,it))
    # Transfer value is a zero-sum league movement in each individual interval.
    for pair in zip(ctx['dates'],ctx['dates'][1:]):
        value=sum(by_interval[t][pair]['changes'].get('trade_players',0)for t in players)
        if abs(value)>.01:raise ValueError(('Player trades do not conserve league value',pair,value))
    return corrections

def pick_cache_key(ctx,pair):
    start,end=pair;source=max(d for d in ctx['inputs']['ratings']if d<=end)
    return digest([PICK_CACHE_METHOD,ctx['model'],ctx['inputs']['ratings'][source],ctx['inputs']['standings'][source],ctx['orders'],ctx['actions'],[(t,[a for a in ctx['histories'][t][start]['assets']if a['kind']=='pick'],[a for a in ctx['histories'][t][end]['assets']if a['kind']=='pick'])for t in ctx['teams']]])

def assemble(ctx,players,pick_rows,lotteries):
    # Price selected-right transfers on the same retirement outcome used by picks.
    selected={}
    for it in pick_rows:
        for right in it['retired_rights']:
            if right.get('holding_probability',0)>.999999 and right.get('expected_selection_if_held')is not None:selected[int(right['draft_year']),round(right['expected_selection_if_held'])]=right
    transfers=defaultdict(Counter);transfer_contributors=defaultdict(list)
    for team,p in players.items():
        for row in p['details']:
            if row['kind']!='draft_entry':continue
            a=next(a for a in ctx['histories'][team][row['end']]['assets']if a['id']in{b['id']for b in ctx['histories'][team][row['end']]['assets']if b['name']==row['player']})
            d=a['details'];right=selected.get((int(float(d.get('draft_year')or 0)),int(float(d.get('draft_slot')or 0))))
            if right and right['owner']!=team:
                pair=row['start'],row['end'];v=right['value'];transfers[team][pair]+=v;transfers[right['owner']][pair]-=v
                for t,sign in [(team,1),(right['owner'],-1)]:transfer_contributors[t,pair].append(dict(player=a['name'],value=sign*v))
    pick_by_pair={(r['start'],r['end']):r for r in pick_rows};result={}
    for team,p in players.items():
        interval_rows=[]
        for raw in p['intervals']:
            start,end=raw['start'],raw['end'];pair=start,end;q=pick_by_pair[pair]['changes'][team];changes=raw['changes'];old=ctx['histories'][team][start];new=ctx['histories'][team][end]
            attributed=[r for r in p['attribution']if(r['start'],r['end'])==pair]
            components={k:Counter()for k in LABELS};contributors={k:Counter()for k in LABELS}
            for row in attributed:
                r = attribute_trade_waiver(team, row)
                components[r['category']][r['component']] += r['value']
                contributors[r['category']][r['player']] += r['value']
            conversion=changes.get('draft_player_entry',0)+q.get('draft_pick_retirement',0)-transfers[team][pair]
            # The retired right carries the fixed draft endpoint expectation.
            # Split conversion into observed production bases and financial terms.
            endpoint_change=0.
            for entry in p['details']:
                if entry['kind']!='draft_entry' or (entry['start'],entry['end'])!=pair:continue
                player=next(a for a in new['assets']if a['kind']=='player'and a['name']==entry['player'])
                detail=player.get('details',{});grade=detail.get('draft_development',{})
                if grade.get('status')!='priced':continue
                original=float(grade['original_expectation'])
                production=float(detail['peak_production'])
                gain=production-original
                endpoint_change+=gain
                contributors['draft'][player['name']]+=gain
            components['draft']['Padded draft entry value versus original expectation']+=endpoint_change
            components['contracts']['Pick-to-player contract terms']+=conversion-endpoint_change
            components['trades']['Future pick transfers']+=q.get('trade_picks',0)
            components['trades']['Selected draft-right transfers']+=transfers[team][pair]
            for r in transfer_contributors[team,pair]:contributors['trades'][r['player']]+=r['value']
            own=sum(l['teams'][team]['own']for l in lotteries if start<l['date']<=end);acquired=sum(l['teams'][team]['acquired']for l in lotteries if start<l['date']<=end)
            components['own_picks']['Own-origin pick forecast and rights changes']+=q.get('own_pick_revaluation',0)-own
            components['acquired_picks']['Acquired-origin pick forecast and rights changes']+=q.get('acquired_pick_revaluation',0)-acquired
            components['lottery']['Own-origin lottery luck']+=own;components['lottery']['Acquired-origin lottery luck']+=acquired
            components['automatic']['Automatic reporting-horizon additions']+=q.get('horizon_entry',0)
            for r in pick_by_pair[pair]['contributions']:
                if r['team']==team:contributors['own_picks'if r['category']=='own_pick_revaluation'else'acquired_picks'][r['player']]+=r['value']
            for l in lotteries:
                if start<l['date']<=end:
                    for r in l['contributions']:
                        if r['team']==team:
                            contributors['lottery'][r['player']]+=r['value'];contributors['own_picks'if r['category']=='own'else'acquired_picks'][r['player']]-=r['value']
            for r in pick_by_pair[pair]['legal']:
                if r['team']==team:
                    category={'trade_picks':'trades','own_pick_revaluation':'own_picks','acquired_pick_revaluation':'acquired_picks'}[r['category']]
                    contributors[category][r['date']+' · pick rights']+=r['value']
            categories={k:sum(v.values())for k,v in components.items()};error=old['total']+sum(categories.values())-new['total']
            if abs(error)>.01:raise ValueError(('Portfolio does not reconcile',team,start,end,error,categories))
            interval_rows.append(dict(start=start,end=end,opening=old['total'],closing=new['total'],categories=categories,components={k:dict(v)for k,v in components.items()},contributors={k:[dict(player=n,value=v)for n,v in sorted(rows.items(),key=lambda z:abs(z[1]),reverse=True)if abs(v)>.000001]for k,rows in contributors.items()},reconciliation_error=error))
        result[team]=dict(team=team,method=ATTRIBUTION_METHOD,valuation_method=METHOD,intervals=interval_rows,source_signature=digest([(d,s['total'])for d,s in ctx['histories'][team].items()]))
        waivers = [deal for (owner, _), deal in TRADE_WAIVERS.items() if owner == team]
        if waivers:
            result[team]['trade_waivers'] = waivers
    return result

def run(repo,runtime,workers=3):
    ctx=context(repo,runtime);print('Loaded canonical histories and source evidence for 30 teams',flush=True)
    players={t:player_bridge(t,ctx)for t in ctx['teams']};corrections=correct_transfers(players,ctx);print('Player intervals reconciled; trade conservation passed',flush=True)
    picks.setup(ctx,repo);cache=repo/'processed/asset_history/attribution_cache';cache.mkdir(exist_ok=True,parents=True);rows=[];pending=[]
    for seed in sorted(cache.glob('initial_cache-*.json')):
        for name,item in read(seed)['files'].items():
            if not re.fullmatch(r'(?:[0-9]{4}-[0-9]{2}-[0-9]{2}|lotteries)\.json\.gz',name):raise ValueError('Unsafe attribution cache name')
            target=cache/name
            if target.exists():continue
            data=base64.b64decode(item['base64'])
            if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Attribution cache digest mismatch')
            target.write_bytes(data)
    for pair in zip(ctx['dates'],ctx['dates'][1:]):
        key=pick_cache_key(ctx,pair);path=cache/(pair[1]+'.json.gz')
        if path.exists():
            with gzip.open(path,'rt')as f:saved=json.load(f)
            if saved.get('key')==key:rows.append(saved['row']);continue
        pending.append((pair,key,path))
    # Linux fork keeps one read-only canonical book; each pair prices all teams.
    with ProcessPoolExecutor(max_workers=workers,mp_context=get_context('fork'))as pool:
        jobs={pool.submit(picks.interval,pair):(pair,key,path)for pair,key,path in pending}
        for future in as_completed(jobs):
            pair,key,path=jobs[future];row=future.result();rows.append(row)
            with gzip.open(path,'wt')as f:json.dump(dict(key=key,row=row),f,separators=(',',':'))
            print('Pick interval reconciled:',pair[1],flush=True)
    rows.sort(key=lambda r:r['end']);lotteries=[]
    lottery_key=digest([ctx['model'],ctx['orders'],ctx['actions'],ctx['inputs']['qualifiers']]);path=cache/'lotteries.json.gz'
    if path.exists():
        with gzip.open(path,'rt')as f:saved=json.load(f)
        if saved.get('key')==lottery_key:lotteries=saved['rows']
    if not lotteries:
        with ProcessPoolExecutor(max_workers=workers,mp_context=get_context('fork'))as pool:
            futures=[pool.submit(picks.lottery,row)for row in ctx['orders']['orders']if row['kind']=='lottery'and ctx['dates'][0]<row['known_from']<=ctx['dates'][-1]]
            for future in as_completed(futures):lotteries.append(future.result());print('Lottery attribution reconciled',flush=True)
        with gzip.open(path,'wt')as f:json.dump(dict(key=lottery_key,rows=lotteries),f,separators=(',',':'))
    result=assemble(ctx,players,rows,lotteries)
    from attribution_trades import enrich_trade_details
    enrich_trade_details(ctx, result)
    out=data_root(repo)/'attribution'
    # Stage every team first; publish only after the whole league validates.
    for team,data in result.items():atomic(out/(team+'.json'),data)
    report=dict(method=ATTRIBUTION_METHOD,teams=30,intervals=sum(len(d['intervals'])for d in result.values()),first=ctx['dates'][0],latest=ctx['dates'][-1],max_reconciliation_error=max(abs(r['reconciliation_error'])for d in result.values()for r in d['intervals']),player_transfer_corrections=corrections)
    atomic(out/'manifest.json',{k:v for k,v in report.items()if k!='player_transfer_corrections'})
    atomic(repo/'processed/asset_history/attribution_validation.json',report)
    print(json.dumps({k:v for k,v in report.items()if k!='player_transfer_corrections'}),flush=True)
    return report

def refresh_trade_details(repo, runtime):
    """Add deal detail to the validated period ledgers without repricing them."""
    from attribution_trades import enrich_trade_details
    ctx = context(repo, runtime)
    picks.setup(ctx, repo)
    out = data_root(repo) / 'attribution'
    ledgers = {team: read(out / (team + '.json')) for team in ctx['teams']}
    enrich_trade_details(ctx, ledgers)
    for team, ledger in ledgers.items():
        atomic(out / (team + '.json'), ledger)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,default=Path.cwd());parser.add_argument('--runtime',type=Path);parser.add_argument('--work-dir',type=Path,default=Path('/tmp/nba-mece-attribution'));parser.add_argument('--workers',type=int,default=3);parser.add_argument('--trade-details-only',action='store_true');args=parser.parse_args();repo=args.repo.resolve();runtime=args.runtime
    if runtime is None:
        from run_player_refresh import unpack
        runtime=args.work_dir/'runtime';unpack(repo/'processed/asset_history/canonical_runtime_seed.zip',runtime)
    if args.trade_details_only:
        refresh_trade_details(repo, runtime.resolve())
    else:
        run(repo,runtime.resolve(),args.workers)
if __name__=='__main__':main()
