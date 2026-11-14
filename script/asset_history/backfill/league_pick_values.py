"""Common-outcome league pick EVs with dated orders and conserved ownership.

Unknown future rule choices are explicit forecast assumptions. They are not
presented as NBA policy. The latest announced system is continued beyond its
announced term until a new rule is known, rather than predicting a future vote.
"""
from __future__ import annotations
import argparse, copy, csv, importlib.util, io, json, math
from collections import defaultdict
from pathlib import Path
import numpy as np
from pick_allocator import TEAMS, allocate, compile_choice_policies
from pick_replay import active_rules, load_actions, display_years
from forfeiture_rules import RoundAwarePickQuotes, effective_slots_after_forfeitures

SEED=281025
EAST=set('ATL BOS BKN CHA CHI CLE DET IND MIA MIL NYK ORL PHI TOR WAS'.split())
NEW_KNOWN='2026-05-28'
FUTURE_POLICY='For2030andlater, continue the latest announced lottery system; the NBA has not yet determined those rules.'
FORFEIT_POLICY='First-round forfeitures are excluded before the lottery. Under the new system, keep the remaining relegated teams’ No.12floor and origin-based repeat-pick restrictions. Second-round ordering uses the full30-origin counterfactual lottery. This forfeiture interaction is a modeling assumption pending a detailed NBA procedure.'

_PORTFOLIO_QUOTE_CACHE=[]
def portfolio_quote(model,reporting_cap=None):
    """Reuse immutable model/cost quotes across joint counterfactual replays.

    Each caller's model object is the publication's fixed fitted model. Retain
    identity references so a different model can never inherit cached prices.
    """
    for saved,cap,quote in _PORTFOLIO_QUOTE_CACHE:
        if saved is model and cap==reporting_cap:return quote
    quote=RoundAwarePickQuotes(model,reporting_cap)
    _PORTFOLIO_QUOTE_CACHE.append((model,reporting_cap,quote))
    del _PORTFOLIO_QUOTE_CACHE[:-4]
    return quote

def first_forfeited_physical(rules,asof=None):
    """Find unconditional physical firsts, including fixed entitlement transfers.

    Legal replay sometimes expresses a fixed one-pick penalty as an entitlement
    transfer. Operation spelling must not determine whether its origin receives
    lottery odds. A genuinely contingent first penalty requires joint pre-draw
    treatment and is rejected here rather than silently ignored.
    """
    result=set()
    for rule in rules:
        if asof is not None and(rule['known_from']>asof or(rule.get('known_until')and asof>=rule['known_until'])):continue
        if rule.get('to_team')!='FORFEITED':continue
        if rule['kind']=='transfer':picks=[rule['pick']]
        elif rule['kind']=='entitlement_transfer':picks=rule['picks']
        else:
            if any(int(p[2])==1 for p in rule.get('picks',[])):raise ValueError('Contingent first forfeiture needs joint pre-draw treatment')
            continue
        firsts=[tuple(p)for p in picks if int(p[2])==1]
        if not firsts:continue
        if len(picks)!=1 or(rule['kind']=='entitlement_transfer'and list(rule.get('count_range',[]))!=[1,1]):
            raise ValueError('Contingent first forfeiture needs joint pre-draw treatment')
        result.add(firsts[0])
    return result

def prepare_rule_conditions(rules):
    """Interpret source top-N second protections at the actual overall number.

    Older encodings start at31because no second could previously be30. Once a
    first is forfeited, a top55-protected second at30must remain protected.
    Keep original curated clauses unchanged; this is a dated pricing adapter.
    """
    result=copy.deepcopy(rules)
    def walk(obj):
        if isinstance(obj,list):
            for v in obj:walk(v)
        elif isinstance(obj,dict):
            if 'protected_ranges'in obj:
                obj['protected_ranges']=[[1 if lo==31 else lo,hi]for lo,hi in obj['protected_ranges']]
            if obj.get('pick') and len(obj['pick'])==3 and obj['pick'][2]==2 and obj.get('range',[None])[0]==31:
                obj['range'][0]=1
            for v in obj.values():walk(v)
    walk(result)
    return result

def valuation_assumptions(view,years):
    notes=[]
    def footprint(obj):
        if isinstance(obj,(list,tuple)):
            if len(obj)==3 and isinstance(obj[0],str)and obj[0]in TEAMS and isinstance(obj[1],int)and obj[2]in(1,2):return {obj[1]}
            return set().union(*(footprint(v)for v in obj))if obj else set()
        if isinstance(obj,dict):return set().union(*(footprint(v)for v in obj.values()))if obj else set()
        return set()
    for r in view['rules']:
        if r.get('valuation_assumption') and footprint(r)&set(years):notes.append(r['valuation_assumption'])
        if r.get('rule_id')=='L14013_79'and footprint(r)&set(years):notes.append(r['review_note'])
    return sorted(set(notes))

def old_lottery(wins,rng,conferences,playoff_field=None):
    n=len(wins);rid=np.arange(n);lot=np.zeros_like(wins,dtype=bool)
    if playoff_field is not None:lot[:,[i for i in range(30)if i not in playoff_field]]=True
    else:
        for conf in conferences:
            order=conf[np.argsort(-wins[:,conf],axis=1)];a,b,c,d=[order[:,k]for k in [6,7,8,9]]
            def game(x,y):
                p=1/(1+np.exp(-((wins[rid,x]-wins[rid,y])/12+.22)))
                outcome=rng.random(n)<p
                return np.where(outcome,x,y),np.where(outcome,y,x)
            _,loser78=game(a,b);winner910,loser910=game(c,d);_,loser=game(loser78,winner910)
            for k in range(10,15):lot[rid,order[:,k]]=True
            lot[rid,loser910]=True;lot[rid,loser]=True
    order=np.argsort(np.where(lot,wins,np.inf),axis=1)[:,:14]
    records=wins[rid[:,None],order];tied=np.abs(records[:,:,None]-records[:,None,:])<2.1e-5
    weights=np.array([140,140,140,125,105,90,75,60,45,30,20,15,10,5.])
    weights=(tied*weights[None,None,:]).sum(axis=2)/tied.sum(axis=2)
    keys=-np.log(np.clip(rng.random((n,14)),1e-12,1))/weights
    chosen=order[rid[:,None],np.argsort(keys,axis=1)[:,:4]];slots=np.zeros_like(wins,dtype=np.int16)
    for k in range(4):slots[rid,chosen[:,k]]=k+1
    left=order[rid[:,None],np.argsort(np.where(slots[rid[:,None],order]==0,np.arange(14),99),axis=1)[:,:10]]
    for k in range(10):slots[rid,left[:,k]]=k+5
    playoff=np.argsort(np.where(~lot,wins,np.inf),axis=1)[:,:16]
    for k in range(16):slots[rid,playoff[:,k]]=k+15
    second=np.empty_like(slots);record_order=np.argsort(wins,axis=1)
    for k in range(30):second[rid,record_order[:,k]]=k+31
    return slots,second

def new_lottery(wins,rng,conferences,prevtop,prevprev,prevone,excluded=()):
    n=len(wins);rid=np.arange(n);lot=np.zeros_like(wins,dtype=bool);weights=np.zeros_like(wins)
    for conf in conferences:
        order=conf[np.argsort(-wins[:,conf],axis=1)];a,b,c,d=[order[:,k]for k in [6,7,8,9]]
        loser78=np.where(rng.random(n)<1/(1+np.exp(-((wins[rid,a]-wins[rid,b])/12+.22))),b,a)
        for k in range(10,15):lot[rid,order[:,k]]=True;weights[rid,order[:,k]]=3
        for t in [c,d]:lot[rid,t]=True;weights[rid,t]=2
        lot[rid,loser78]=True;weights[rid,loser78]=1
    bottom=np.zeros_like(lot);relegated=np.argsort(wins,axis=1)[:,:3]
    for k in range(3):bottom[rid,relegated[:,k]]=True;weights[rid,relegated[:,k]]=2
    removed=np.zeros_like(lot)
    if excluded:removed[:,list(excluded)]=True
    eligible_lot=lot&~removed
    keys=np.where(eligible_lot,-np.log(np.clip(rng.random(wins.shape),1e-12,1))/np.maximum(weights,1),np.inf)
    rank=np.argsort(keys,axis=1);available=eligible_lot.copy();slots=np.zeros_like(wins,dtype=np.int16)
    restricted=prevtop&prevprev;bottom&=~removed;count=eligible_lot.sum(axis=1)
    for slot in range(1,17):
        active=count>=slot;eligible=available.copy()
        if slot==1:eligible&=~prevone
        if slot<=5:eligible&=~restricted
        if slot<=12:
            force=(available&bottom).sum(axis=1)>=(13-slot)
            eligible[force]&=bottom[force]
        can=eligible[rid[:,None],rank]
        if not can[active].any(axis=1).all():raise ValueError('Lottery restriction/floor scenario has no eligible selection')
        chosen=rank[rid,np.argmax(can,axis=1)]
        slots[rid[active],chosen[active]]=slot;available[rid[active],chosen[active]]=False
    playoff=np.argsort(np.where(~lot&~removed,wins,np.inf),axis=1)
    for k in range(16):
        t=playoff[:,k];active=~lot[rid,t]&~removed[rid,t]
        slots[rid[active],t[active]]=count[active]+k+1
    for j,t in enumerate(sorted(excluded)):slots[:,t]=31-len(excluded)+j
    if not np.all(np.sort(slots,axis=1)==np.arange(1,31)):raise AssertionError('Physical lottery positions do not conserve30origins')
    second=np.where(slots<=16,47-slots,slots+30).astype(np.int16)
    return slots,second

def dated_orders(orders,asof):
    out={}
    for r in orders:
        if r['known_from']<=asof:out.setdefault(int(r['year']),{})[r['kind']]=r
    return out

def simulate(asof,ratings,standing,rules,orders,qualifiers=(),draws=10000,max_year=2033):
    names=sorted(TEAMS);idx={t:i for i,t in enumerate(names)};rd={r['team_alias']:r for r in ratings}
    if set(rd)!=TEAMS or set(standing)!=TEAMS:raise ValueError('All30dated team ratings/standings are required')
    season=int(ratings[0]['season'])
    if {int(r['season'])for r in ratings}!={season}:raise ValueError('Mixed ratings seasons')
    current_wins=np.array([int(standing[t]['wins'])for t in names]);gp=np.array([int(standing[t]['gp'])for t in names])
    if np.any(gp<0)or np.any(gp>82):raise ValueError('Invalid completed game count')
    net=np.array([float(rd[t]['net'])for t in names]);net-=net.mean()
    confs=[np.array([idx[t]for t in names if t in EAST]),np.array([idx[t]for t in names if t not in EAST])]
    known=dated_orders(orders,asof);first={};second={};paths={}
    for year in range(2022,season):
        if 'lottery'not in known.get(year,{}):raise ValueError('Missing known historical physical order: '+str(year))
        rows=known[year]['lottery']['rows']
        first[year]=np.zeros((draws,30),np.int16);second[year]=np.zeros((draws,30),np.int16)
        for r in rows:(first if r['round']==1 else second)[year][:,idx[r['origin']]]=r['physical_slot']
    rng=np.random.default_rng(SEED+200000+season)
    latent_sd=math.sqrt(8.**2-82*.25)
    strength=41+2.7*net+rng.normal(0,latent_sd,(draws,30))
    wins=current_wins+rng.binomial(82-gp,np.clip(strength/82,.03,.97))
    wins=wins.astype(float)+rng.uniform(-1e-5,1e-5,wins.shape)
    prevtop=np.zeros((draws,30),bool);prevprev=prevtop.copy();prevone=prevtop.copy()
    for year,target in [(season-1,prevtop),(season-2,prevprev)]:
        if 'lottery'in known.get(year,{}):
            for r in known[year]['lottery']['rows']:
                if r['round']==1 and r['actual_slot']<=5:target[:,idx[r['origin']]]=True
                if year==season-1 and r['round']==1 and r['actual_slot']==1:prevone[:,idx[r['origin']]]=True
    assumptions=[]
    for year in range(season,max_year+1):
        if year>season:
            yr_rng=np.random.default_rng(SEED+200000+year)
            strength=41+.5817315925444178*(strength-41)+yr_rng.normal(0,9.784470389330068,(draws,30))
            wins=np.clip(strength,3,79);wins-=wins.mean(axis=1,keepdims=True)-41
        paths[year]=wins
        excluded={idx[p[0]]for p in first_forfeited_physical(rules,asof)if int(p[1])==year}
        lottery_rng=np.random.default_rng(SEED+100000+year)
        if asof>=NEW_KNOWN and year>=2027:
            state=copy.deepcopy(lottery_rng.bit_generator.state)
            full,s2=new_lottery(wins,lottery_rng,confs,prevtop,prevprev,prevone)
            if excluded:
                lottery_rng.bit_generator.state=state
                s,_=new_lottery(wins,lottery_rng,confs,prevtop,prevprev,prevone,excluded)
                assumptions.append(FORFEIT_POLICY)
            else:s=full
            if year>=2030:assumptions.append(FUTURE_POLICY)
        else:
            if excluded:raise ValueError('Old-system first-round forfeiture scenario needs separate pre-draw treatment')
            field=[idx[q['team_alias']]for q in qualifiers if int(q['season'])==season and q['first_playoff_date']<=asof]
            s,s2=old_lottery(wins,lottery_rng,confs,set(field)if year==season and len(field)==16 else None)
        if year in known:
            if 'lottery'in known[year]:
                for r in known[year]['lottery']['rows']:(s if r['round']==1 else s2)[:,idx[r['origin']]]=r['physical_slot']
            elif 'tiebreaks'in known[year]:
                tie=known[year]['tiebreaks']
                for r in tie['first'][14:]:s[:,idx[r['origin']]]=r['physical_position']
                # Shared second-round slots reverse the now-simulated first
                # order; fixed actual numbers already reflect forfeitures.
                groups=defaultdict(list)
                for r in tie['second']:
                    if len(r['slots'])>1:groups[tuple(r['slots'])].append(r)
                    else:s2[:,idx[r['origin']]]=r['physical_position']
                for members in groups.values():
                    columns=[idx[r['origin']]for r in members];rank=np.argsort(-s[:,columns],axis=1)
                    physical=sorted(r['physical_position']for r in members)
                    for j,position in enumerate(physical):s2[np.arange(draws),np.array(columns)[rank[:,j]]]=position
        first[year]=s;second[year]=s2
        prevprev=prevtop;prevtop=s<=5;prevone=s==1
    return dict(first=first,second=second,index=idx,names=names,draws=draws,season=season,wins=paths,assumptions=sorted(set(assumptions)))

class SlotView:
    def __init__(self,sim,i):self.sim=sim;self.i=i
    def __getitem__(self,p):return int(self.sim['first'if p[2]==1 else'second'][p[1]][self.i,self.sim['index'][p[0]]])
    def items(self):
        for year in sorted(self.sim['first']):
            for team in self.sim['names']:
                for rnd in [1,2]:
                    p=(team,year,rnd);yield p,self[p]

class Draws:
    def __init__(self,sim):self.sim=sim
    def __iter__(self):return (SlotView(self.sim,i)for i in range(self.sim['draws']))

def value_portfolio_scalar(asof,view,sim,model,years,reporting_cap=None):
    if not view['complete']:raise ValueError('Unresolved legal pick events prevent publication')
    quote=portfolio_quote(model,reporting_cap);rules=compile_choice_policies(view['rules'],Draws(sim),quote)
    values=defaultdict(float);counts=defaultdict(int);slot_sums=defaultdict(float);global_sum=0.;claims=defaultdict(float);claim_ranges={}
    generic=np.array([quote(2,s)for s in range(31,61)])
    for slots in Draws(sim):
        raw=dict(slots.items());owners=allocate(raw,rules,asof)
        # Legal protection thresholds use actual selection numbers. Re-evaluate
        # after forfeiture numbering, stopping if the legal allocation cycles.
        for _ in range(6):
            actual=effective_slots_after_forfeitures(owners,raw)
            conditions={p:actual[p]if actual[p]is not None else raw[p]for p in raw}
            resolved=allocate(raw,rules,asof,condition_slots=conditions)
            if resolved==owners:break
            owners=resolved
        else:raise ValueError('Forfeiture/protection allocation did not stabilize')
        first_counts={year:sum(p[1]==year and p[2]==1 and owner=='FORFEITED'for p,owner in owners.items())for year in years}
        for p,owner in owners.items():
            if p[1]not in years or owner=='FORFEITED':continue
            slot=actual[p];value=quote(p[2],slot,first_counts[p[1]],p[1])
            key=(owner,p);values[key]+=value;counts[key]+=1;slot_sums[key]+=slot;global_sum+=value
        for c in view.get('economic_claims',[]):
            pred=c['predicate'];slot=raw[tuple(pred['pick'])]
            interval=pred.get('slot_range',pred.get('range'))
            if not interval[0]<=slot<=interval[1]:continue
            amount=int(c['count'])*float(generic.mean());cid=c.get('claim_id','NYK_HART_FALLBACK_2023')
            for owner,sign in [(c['from_team'],-1),(c['to_team'],1)]:claims[(owner,cid)]+=sign*amount
            claim_ranges[cid]=(int(c['count'])*float(generic.min()),int(c['count'])*float(generic.max()))
    n=sim['draws'];by_team={t:[]for t in sorted(TEAMS)}
    for (owner,p),amount in sorted(values.items()):
        chance=counts[(owner,p)]/n;slot=slot_sums[(owner,p)]/counts[(owner,p)]
        by_team[owner].append(dict(id=f'pick:{p[0]}:{p[1]}:{p[2]}',kind='pick',name=f'{p[1]} {p[0]} round{p[2]}'+(' · conditional entitlement'if chance<.999999 else''),value=amount/n,
            source='Dated reviewed trade/penalty rules; official NBA draft orders; joint forecast outcomes; trained production/rookie-cost model',
            note=f'{chance:.1%} holding probability; mean selection {slot:.1f} conditional on holding. Protections and swaps share the same simulated outcomes.',
            physical_origin=p[0],draft_year=p[1],round=p[2],holding_probability=chance,expected_selection_if_held=slot))
    for (owner,cid),amount in sorted(claims.items()):
        by_team[owner].append(dict(id='pick-claim:'+cid,kind='pick',name='Josh Hart contingent four-second fallback'+(' obligation'if amount<0 else''),value=amount/n,
            source='Contemporary reported Hart trade terms: protected2023first or four futureseconds; exact fallback origins not publicly specified.',
            note='Modeled generic-second EV, uniform31–60. Equal credit/debit preserves league value; no physical pick origins are invented.',conditional_scenario_range=claim_ranges[cid]))
    total=sum(a['value']for assets in by_team.values()for a in assets)
    if not math.isclose(total,global_sum/n,abs_tol=.01):raise AssertionError('League pick EV conservation failed')
    return dict(date=asof,teams=by_team,total=total,draws=n,assumptions=sim['assumptions']+(['Hart fallback: four generic seconds; exact physical terms were not public.']if claims else[]),complete=True)

def actual_number_arrays(raw,owners,keys,forfeited_owner):
    """Compress both rounds in joint outcomes, keeping physical IDs stable."""
    actual=raw.copy();first_counts={};rid=np.arange(len(raw))[:,None]
    for year in sorted({p[1]for p in keys}):
        offset=np.zeros(len(raw),dtype=np.int16)
        for rnd in [1,2]:
            cols=np.array([j for j,p in enumerate(keys)if p[1]==year and p[2]==rnd])
            order=np.argsort(raw[:,cols],axis=1);removed=owners[:,cols]==forfeited_owner
            ranked_removed=removed[rid,order]
            ranked_numbers=np.arange(1,31)[None,:]-np.cumsum(ranked_removed,axis=1)+ranked_removed+offset[:,None]
            local=np.empty_like(raw[:,cols]);local[rid,order]=ranked_numbers
            # A removed pick has no actual selection. Its internal protection
            # predicate uses the ordinal without its own deletion, retaining
            # earlier removals. Restoring raw rank would undo other penalties
            # and make next-available protected obligations alternate owners.
            actual[:,cols]=local
            if rnd==1:first_counts[year]=removed.sum(axis=1)
            offset+=30-removed.sum(axis=1)
    return actual,first_counts

def value_portfolio(asof,view,sim,model,years,reporting_cap=None):
    from vector_pick_allocator import allocate_vector,OWNER_INDEX,OWNER_NAMES
    if not view['complete']:raise ValueError('Unresolved legal pick events prevent publication')
    quote=portfolio_quote(model,reporting_cap)
    short_round=bool(first_forfeited_physical(view['rules'],asof))
    rules=compile_choice_policies(prepare_rule_conditions(view['rules'])if short_round else view['rules'],Draws(sim),quote)
    keys=[(t,y,r)for y in sorted(sim['first'])for t in sim['names']for r in [1,2]]
    raw=np.column_stack([(sim['first'if r==1 else'second'][y][:,sim['index'][t]])for t,y,r in keys])
    owners=allocate_vector(raw,keys,rules,asof);forfeited=OWNER_INDEX['FORFEITED']
    for _ in range(6):
        actual,first_counts=actual_number_arrays(raw,owners,keys,forfeited)
        resolved=allocate_vector(raw,keys,rules,asof,condition_slots_array=actual)
        if np.array_equal(resolved,owners):break
        owners=resolved
    else:raise ValueError('Forfeiture/protection allocation did not stabilize')
    n=sim['draws'];by_team={t:[]for t in sorted(TEAMS)};global_sum=0.
    # Salary/production is nonlinear in slot, so price each outcome before
    # averaging. A quote at the average slot would give the wrong EV.
    max_forfeits=max((int(first_counts[y].max())for y in years),default=0)
    lookup={};production_lookup={}
    for year in years:
        lookup[year]=np.zeros((3,max_forfeits+1,61));production_lookup[year]=np.zeros_like(lookup[year])
        for rnd in [1,2]:
            for count in range(max_forfeits+1):
                for slot in range(1,61):
                    if (rnd==1 and slot<=30-count)or(rnd==2 and slot>=30):
                        parts=quote.components(rnd,slot,count,year)
                        lookup[year][rnd,count,slot]=parts['quote']
                        production_lookup[year][rnd,count,slot]=parts['production_quote']
    for j,p in enumerate(keys):
        if p[1]not in years:continue
        nums=actual[:,j];values=lookup[p[1]][p[2],first_counts[p[1]],nums]
        values=np.where(owners[:,j]==forfeited,0.,values);global_sum+=float(values.sum())
        production=np.where(owners[:,j]==forfeited,0.,production_lookup[p[1]][p[2],first_counts[p[1]],nums])
        production_sums=np.bincount(owners[:,j],weights=production,minlength=len(OWNER_NAMES))
        counts=np.bincount(owners[:,j],minlength=len(OWNER_NAMES));sums=np.bincount(owners[:,j],weights=values,minlength=len(OWNER_NAMES));slots=np.bincount(owners[:,j],weights=nums,minlength=len(OWNER_NAMES))
        for k in np.flatnonzero(counts[:30]):
            owner=OWNER_NAMES[k];chance=counts[k]/n;mean=slots[k]/counts[k]
            by_team[owner].append(dict(id=f'pick:{p[0]}:{p[1]}:{p[2]}',kind='pick',name=f'{p[1]} {p[0]} round{p[2]}'+(' · conditional entitlement'if chance<.999999 else''),value=float(sums[k]/n),
                source='Dated reviewed trade/penalty rules; official NBA draft orders; joint forecast outcomes; trained production/rookie-cost model',
                note=f'{chance:.1%} holding probability; mean selection {mean:.1f} conditional on holding. Protections and swaps share the same simulated outcomes.',
                physical_origin=p[0],draft_year=p[1],round=p[2],holding_probability=float(chance),expected_selection_if_held=float(mean),
                details={'endpoint_production':float(production_sums[k]/n),'contract_adjustment':float((sums[k]-production_sums[k])/n),'stock_policy':model.get('stock_policy','legacy')}))
    generic=np.array([quote(2,s)for s in range(31,61)]);claims=False;index={p:j for j,p in enumerate(keys)}
    for c in view.get('economic_claims',[]):
        pred=c['predicate'];interval=pred.get('slot_range',pred.get('range'));nums=actual[:,index[tuple(pred['pick'])]]
        probability=float(np.mean((nums>=interval[0])&(nums<=interval[1])))
        if not probability:continue
        amount=int(c['count'])*float(generic.mean())*probability;claims=True
        for owner,sign in [(c['from_team'],-1),(c['to_team'],1)]:
            by_team[owner].append(dict(id='pick-claim:'+c['claim_id'],kind='pick',name='Josh Hart contingent four-second fallback'+(' obligation'if sign<0 else''),value=sign*amount,source=c['source'],
                note='Modeled generic-second EV, uniform31–60. Equal credit/debit preserves league value; no physical pick origins are invented.',
                conditional_scenario_range=[int(c['count'])*float(generic.min())*probability,int(c['count'])*float(generic.max())*probability]))
    total=sum(a['value']for assets in by_team.values()for a in assets)
    if not math.isclose(total,global_sum/n,abs_tol=.01):raise AssertionError('League pick EV conservation failed')
    assumptions=sim['assumptions']+valuation_assumptions(view,years)+(['Hart fallback: four generic seconds; exact physical terms were not public.']if claims else[])
    if short_round:assumptions.append('Top-N second-round protections use actual overall numbers, including a second-round selection atNo.30 after a first-round forfeiture.')
    return dict(date=asof,teams=by_team,total=total,draws=n,assumptions=assumptions,complete=True)

def load_historical_inputs(canonical):
    canonical=Path(canonical);monthly=canonical/'monthly_reconstruction'
    ratings={x['cutoff_date']:list(csv.DictReader(io.StringIO(x['csv'])))for x in json.loads((monthly/'team_ratings/dated_team_snapshots.json').read_text())}
    standings=defaultdict(dict)
    for r in csv.DictReader((monthly/'pick_forecasts/standings_monthly.csv').open()):standings[r['cutoff']][r['team_alias']]=r
    overrides=defaultdict(dict);path=monthly/'league_ownership/summer_team_rating_overrides.csv'
    if path.exists():
        for r in csv.DictReader(path.open()):overrides[r['cutoff_date']][r['team_alias']]=r
    for cutoff,by_team in overrides.items():
        if len(by_team)!=30:raise ValueError('Incomplete summer roster ratings')
        for row in ratings[cutoff]:
            o=by_team[row['team_alias']];row['net']=o['upcoming_season_net'];row['season']=o['forecast_season']
        standings[cutoff]={t:{**standings[cutoff][t],'wins':'0','gp':'0','season_ending':by_team[t]['forecast_season']}for t in by_team}
    qualifiers=[];qp=monthly/'pick_forecasts/playoff_qualifiers.json'
    if qp.exists():
        for year,rows in json.loads(qp.read_text()).items():qualifiers.extend({**r,'season':int(year)}for r in rows)
    return dict(ratings=ratings,standings=dict(standings),qualifiers=qualifiers)

def main():
    p=argparse.ArgumentParser();p.add_argument('--canonical',type=Path,required=True);p.add_argument('--baseline',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--orders',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--draws',type=int,default=10000);p.add_argument('--date');a=p.parse_args()
    inputs=load_historical_inputs(a.canonical);baseline=json.loads(a.baseline.read_text());catalog=json.loads(a.catalog.read_text());order_data=json.loads(a.orders.read_text());model=json.loads((a.canonical/'monthly_reconstruction/pick_values/trained_pick_model.json').read_text());actions,missing=load_actions()
    if missing:raise ValueError('Missing legal replay cohorts '+str(missing))
    a.output.mkdir(parents=True,exist_ok=True)
    for cutoff in sorted(inputs['ratings']):
        if a.date and cutoff!=a.date:continue
        view=active_rules(baseline,actions,cutoff,catalog)
        if not view['complete']:raise ValueError('Unresolved legal events '+json.dumps(view['unresolved'])[:1000])
        years=display_years(cutoff,{int(y):d for y,d in order_data['draft_completion_dates'].items()});max_year=max(2033,max(years))
        sim=simulate(cutoff,inputs['ratings'][cutoff],inputs['standings'][cutoff],view['rules'],order_data['orders'],inputs['qualifiers'],a.draws,max_year)
        values=value_portfolio(cutoff,view,sim,model,years)
        (a.output/f'{cutoff}.json').write_text(json.dumps(values,separators=(',',':')))
        print(json.dumps({'date':cutoff,'league_total':values['total'],'claims':sum(len(v)for v in values['teams'].values()),'draws':a.draws}),flush=True)

if __name__=='__main__':main()

