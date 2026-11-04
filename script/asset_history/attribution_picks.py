"""Joint-outcome pick attribution: ownership, horizon, repricing and lottery."""
from __future__ import annotations
import copy,json,sys
from collections import Counter,defaultdict
from datetime import date,timedelta
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from league_pick_values import simulate,value_portfolio
from pick_replay import active_rules,load_actions,display_years

CTX=None

def parties(node):
    if isinstance(node,dict):
        direct={node.get('from_team'),node.get('to_team')} if node.get('to_team')!='FORFEITED' else set()
        return direct|set().union(*(parties(v)for v in node.values()))
    if isinstance(node,list):return set().union(*(parties(v)for v in node))if node else set()
    return set()

def setup(ctx,repo):
    global CTX
    root=repo/'processed/asset_history/picks'
    for key,name in [('baseline','opening_baseline.json'),('catalog','dated_events.json'),('orders','dated_orders.json'),('model','trained_pick_model.json'),('inputs','forecast_inputs.json')]:ctx[key]=json.loads((root/name).read_text())
    actions,missing=load_actions()
    if missing:raise ValueError('Missing reviewed pick replay actions')
    ctx['actions']=actions
    last=max(ctx['dates'])
    if last>max(ctx['inputs']['ratings']):
        from run_pick_refresh import current_forecast,new_pick_actions
        if last>=json.loads((repo/'raw/live/results.json').read_text())['generated_at'][:10]:
            ratings,record=current_forecast(repo,last)
            ctx['inputs']['ratings'][last]=ratings;ctx['inputs']['standings'][last]=record
    fresh,catalog,unknown=new_pick_actions(ctx['events'],ctx['catalog'],last,min(display_years(last,ctx['orders']['draft_completion_dates'],announced_draft_months=ctx['orders'].get('announced_draft_months'))))
    if unknown:raise ValueError('Unreviewed new pick terms prevent attribution')
    ctx['actions']+=fresh;ctx['catalog']+=catalog
    # Direct trade parties, not an observer affected indirectly by a rule.
    trade_dates=defaultdict(set)
    for e in ctx['events']:
        if 'trade' in e['parsed_status']:
            for team,name in ctx['names'].items():
                if name in e['text'] or team=='PHI' and 'Philadelphia Sixers' in e['text']:trade_dates[e['date']].add(team)
            trade_dates[e['date']]|={a.get('to_team')for a in e.get('parsed_actions',[])}&set(ctx['teams'])
    for action in ctx['actions']:trade_dates[action['known_from']]|=parties(action.get('rule',{}))&set(ctx['teams'])
    ctx['trade_dates']=trade_dates;CTX=ctx

def view(day):
    c=CTX;v=active_rules(c['baseline'],c['actions'],day,c['catalog'])
    if not v['complete']:raise ValueError(('Incomplete legal view',day,v['unresolved']))
    return v

def years(day):
    c=CTX;return display_years(day,c['orders']['draft_completion_dates'],announced_draft_months=c['orders'].get('announced_draft_months'))

def interval(pair):
    c=CTX;start,end=pair;oldv,newv=view(start),view(end);oldys,newys=set(years(start)),set(years(end));union=oldys|newys
    source=max(t for t in c['inputs']['ratings']if t<=end)
    sim=simulate(end,c['inputs']['ratings'][source],c['inputs']['standings'][source],newv['rules'],c['orders']['orders'],c['inputs']['qualifiers'],10000,max(2033,max(union)))
    cache={}
    def price(v,ys):
        if not ys:return {t:[]for t in c['teams']}
        key=json.dumps([v['rules'],v.get('economic_claims',[]),sorted(ys)],sort_keys=True)
        if key not in cache:cache[key]=value_portfolio(end,v,sim,c['model'],sorted(ys))['teams']
        return cache[key]
    def totals(p):return {t:sum(a['value']for a in p[t])for t in c['teams']}
    oldrepr=price(oldv,oldys);horizon=totals(price(oldv,newys-oldys));before=totals(price(oldv,union));out={};legal=[];contributions=[]
    for team in c['teams']:
        old={a['id']:a for a in c['histories'][team][start]['assets']if a['kind']=='pick'};new={a['id']:a for a in oldrepr[team]};changes=Counter(horizon_entry=horizon[team])
        for aid in old.keys()|new.keys():
            asset=new.get(aid,old.get(aid));delta=new.get(aid,{}).get('value',0)-old.get(aid,{}).get('value',0)
            category='own_pick_revaluation'if asset.get('physical_origin')==team else'acquired_pick_revaluation'
            changes[category]+=delta
            if abs(delta)>.000001:contributions.append(dict(team=team,asset_id=aid,player=asset['name'],category=category,value=delta))
        out[team]=changes
    dates=sorted({a['known_from']for a in c['actions']if start<a['known_from']<=end}|{a['known_until']for a in c['actions']if a.get('known_until')and start<a['known_until']<=end}|{end})
    prior=oldv
    for day in dates:
        v=view(day)
        if v['rules']==prior['rules']and v.get('economic_claims')==prior.get('economic_claims'):continue
        after=totals(price(v,union))
        for team in c['teams']:
            delta=after[team]-before[team];category='trade_picks'if team in c['trade_dates'][day]else'external_legal'
            out[team][category]+=delta
            if abs(delta)>.000001:legal.append(dict(date=day,team=team,category=category,value=delta))
        before=after;prior=v
    retired=price(newv,oldys-newys);retired_totals=totals(retired);cur=totals(price(newv,newys));errors={}
    for team in c['teams']:
        out[team]['draft_pick_retirement']=-retired_totals[team]
        old=sum(a['value']for a in c['histories'][team][start]['assets']if a['kind']=='pick');published=sum(a['value']for a in c['histories'][team][end]['assets']if a['kind']=='pick')
        errors[team]=dict(replay=published-cur[team],bridge=published-old-sum(out[team].values()))
        if max(abs(v)for v in errors[team].values())>.01:raise ValueError(('Pick attribution failed',team,start,end,errors[team]))
    rights=[dict(owner=t,**a)for t,assets in retired.items()for a in assets]
    return dict(start=start,end=end,changes={t:dict(v)for t,v in out.items()},legal=legal,retired_rights=rights,contributions=contributions,errors=errors)

def lottery(row):
    c=CTX;y=int(row['year']);pre=(date.fromisoformat(row['known_from'])-timedelta(days=1)).isoformat();v=view(pre)
    cutoff=max(d for d in c['inputs']['ratings']if d<=pre and int(c['inputs']['ratings'][d][0]['season'])==y)
    standing=c['inputs']['standings'][cutoff]
    if not all(int(r['gp'])==82 for r in standing.values()):raise ValueError('Lottery luck requires final pre-draw records')
    tie=max((r for r in c['orders']['orders']if int(r['year'])==y and r['kind']=='tiebreaks'and r['known_from']<=pre),key=lambda r:r['known_from'])
    draws=20000;sim=simulate(pre,c['inputs']['ratings'][cutoff],standing,v['rules'],c['orders']['orders'],c['inputs']['qualifiers'],draws,2033)
    idx=sim['index'];field=sorted(tie['first'][:14],key=lambda r:r['physical_position']);columns=np.array([idx[r['origin']]for r in field]);records=np.array([int(standing[r['origin']]['wins'])for r in field]);base=np.array([140,140,140,125,105,90,75,60,45,30,20,15,10,5],float)
    weights=np.array([base[records==n].mean()for n in records]);rng=np.random.default_rng(902100+y)
    keys=-np.log(np.maximum(rng.random((draws,14)),1e-15))/weights;winners=np.argsort(keys,axis=1)[:,:4];slots=np.zeros((draws,30),dtype=np.int16);rr=np.arange(draws)
    for k in range(4):slots[rr,columns[winners[:,k]]]=k+1
    unchosen=np.ones((draws,14),bool)
    for k in range(4):unchosen[rr,winners[:,k]]=False
    remaining=np.argsort(np.where(unchosen,np.arange(14),99),axis=1)[:,:10]
    for k in range(10):slots[rr,columns[remaining[:,k]]]=k+5
    for r in tie['first'][14:]:slots[:,idx[r['origin']]]=r['physical_position']
    sim['first'][y]=slots
    for r in tie['second']:sim['second'][y][:,idx[r['origin']]]=r['physical_position']
    post=dict(sim);post['first']=dict(sim['first']);post['first'][y]=slots.copy()
    for r in row['rows']:
        if r['round']==1:post['first'][y][:,idx[r['origin']]]=r['physical_slot']
    before=value_portfolio(pre,v,sim,c['model'],years(pre))['teams'];after=value_portfolio(pre,v,post,c['model'],years(pre))['teams'];teams={};details=[]
    for team in c['teams']:
        b={a['id']:a for a in before[team]};a={a['id']:a for a in after[team]};sums=Counter()
        for aid in b.keys()|a.keys():
            asset=a.get(aid,b.get(aid));delta=a.get(aid,{}).get('value',0)-b.get(aid,{}).get('value',0);kind='own'if asset.get('physical_origin')==team else'acquired';sums[kind]+=delta
            if abs(delta)>.000001:details.append(dict(team=team,asset_id=aid,player=asset['name'],category=kind,value=delta))
        teams[team]=dict(own=sums['own'],acquired=sums['acquired'])
    if abs(sum(sum(v.values())for v in teams.values()))>.01:raise ValueError('Lottery luck does not conserve league value')
    return dict(date=row['known_from'],year=y,teams=teams,contributions=details)
