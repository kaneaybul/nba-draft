"""Shared rolling-production player attribution, applied identically to every team.

Ported from the corrected rolling-production-attribution-v1 analysis. Endpoint
appraisals never enter the additive waterfall; contract effects stay financial.
"""
import json,sys,re,unicodedata
from collections import Counter,defaultdict
from pathlib import Path
from datetime import date,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parent/'backfill'))
from quote_window import quote_window
from endpoint_stock import active as endpoint_active
from league_player_values import agreements_at
CAP=164961000.
def name_key(name):
    s=unicodedata.normalize('NFKD',str(name)).encode('ascii','ignore').decode().lower()
    s=re.sub(r'[.,]',' ',s).strip();s=re.sub(r'\s+(jr|sr|ii|iii|iv|v)$','',s).strip()
    k=re.sub(r'[^a-z0-9]','',s)
    return {'juanhernangomez':'juanchohernangomez','nicolasclaxton':'nicclaxton','cameronthomas':'camthomas','nathanwilliams':'natewilliams','kenyonmartin':'kjmartin','ishmaelsmith':'ishsmith'}.get(k,k)
def production_bucket(year,asof):
    return 'draft' if year is not None and asof<f'{int(year)+4}-08-01' else 'player'

def parts(a):
    d=a.get('details',{});annual=d.get('annual_values',[])
    if not annual:return float(d.get('peak_production',d.get('app_style_four_year_peak_production_quote',a['value']))),0.,[]
    q=quote_window([r['production']for r in annual],[r['asset']for r in annual],[r['exposure']for r in annual])
    peak=float(d.get('peak_production',d.get('app_style_four_year_peak_production_quote',q['production_quote'])))
    premium=float(d.get('rolling_production_quote',peak))-q['production_quote'] if endpoint_active(d) else a['value']-q['quote']
    assert endpoint_active(d) or abs(peak-q['production_quote']-premium)<.05,(a['name'],peak,q,premium)
    return peak,premium,annual

def clock(a,exposures):
    peak,premium,annual=parts(a)
    if not annual:return dict(value=a['value'],peak=peak,rolling_peak=peak,method='no annual path; value held fixed')
    by={int(r['season']):r for r in annual};last=by[max(by)];p=[];v=[];e=[];tails=[]
    for year,exposure in sorted(exposures.items()):
        r=by.get(year,last)
        if year not in by:tails.append(year)
        p.append(r['production']);v.append(r['asset']);e.append(exposure)
    q=quote_window(p,v,e)
    rolling=q['production_quote']+premium
    production=peak if endpoint_active(a.get('details',{})) else rolling
    return dict(value=production+q['contract_adjustment_sum'],peak=production,rolling_peak=rolling,tail_carry= tails,
                method='frozen annual rates and expected-peak premium; missing new tail rate carried flat')


def market_reference(a,dt,caps,market):
    """Entry quote at the existing market-salary policy, before actual terms.

    The published annual talent rates and path-selection premium are retained.
    The reference treats each season as unsigned, using the same ability to
    decline an uneconomic market continuation as the canonical player model.
    Any resulting service-selection difference is part of the financial
    counterfactual, not a claim that the player developed on the signing day.
    """
    peak,premium,annual=parts(a)
    if not annual:
        return dict(value=a['value'],contract_effect=0.,production_quote=peak,
                    method='no annual path; entry mark retained',annual=[])
    anchor=max(y for y in caps if f'{y-1}-06-30'<=dt)
    cohort=int(float(a.get('details',{}).get('draft_year')or 2000))
    completed=int(dt[:4])+(int(dt[5:7])>=7)-1
    production=[];assets=[];exposure=[];audit=[]
    for r in annual:
        year=int(r['season']);p=r['production']
        cap=caps[anchor][0]*1.05**(year-anchor)
        budget=caps[anchor][1]*1.05**(year-anchor)
        cost,method,scale=market.expected(p*cap/CAP,budget,cap,max(0,year-cohort-1),completed)
        cost=cost*CAP/cap
        declined=1.8*p-.8*cost<0
        ref_p,ref_c=(0.,0.)if declined else(p,cost)
        production.append(ref_p);assets.append(1.8*ref_p-.8*ref_c);exposure.append(r['exposure'])
        audit.append(dict(season=year,exposure=r['exposure'],underlying_production=p,
                          market_salary=cost,reference_production=ref_p,
                          reference_asset=assets[-1],continuation_declined=declined,
                          salary_model=method,market_scale=scale))
    reference=quote_window(production,assets,exposure)
    value=peak+reference['contract_adjustment_sum'] if endpoint_active(a.get('details',{})) else reference['quote']+premium
    return dict(value=value,contract_effect=a['value']-value,
                production_quote=reference['production_quote']+premium,
                method='same underlying production; as-of expected market terms and unsigned continuation policy',
                annual=audit)

def player_bridge(team,ctx):
    snapshots=list(ctx['histories'][team].values())
    league,owners,histories=ctx['league'],ctx['owners'],ctx['histories']
    events,contracts,caps,market=ctx['events'],ctx['contracts'],ctx['caps'],ctx['market']
    TRADES=ctx.get('reviewed_trades',[]) if team=='UTA' else []
    drafted={k:r for k,r in ctx['drafts'].items() if r['team']==team}
    event_names=defaultdict(list);event_ids=defaultdict(list)
    for e in events:
        for person in e.get('players',[]):
            event_names[name_key(person['name'])].append(e)
            if person.get('nba_id')is not None:event_ids[int(person['nba_id'])].append(e)
    aliases={}
    allplayers=[a for st in snapshots for a in st['assets']if a['kind']=='player']
    for a in allplayers:
        if name_key(a['name'])in drafted:aliases[a['id']]=drafted[name_key(a['name'])]
    for a in allplayers:
        if a['id']in aliases:drafted[name_key(a['name'])]=aliases[a['id']]
    def cap_at(y,dt):
        yy=max(z for z in caps if f'{z-1}-06-30'<=dt)
        return caps[yy][0]*1.05**(y-yy)
    def budget_at(y,dt):
        yy=max(z for z in caps if f'{z-1}-06-30'<=dt)
        return caps[yy][1]*1.05**(y-yy)
    def event_matches(a,start,end,kind=None):
        k=name_key(a['name']);pid=int(a['id'].split(':')[-1])if':nba:'in a['id']else None
        found=[e for e in {e['event_id']:e for e in event_names[k]+event_ids.get(pid,[])}.values() if start<e['date']<=end and(not kind or kind in e['parsed_status'])and any(name_key(p['name'])==k or(pid is not None and p.get('nba_id')==pid)for p in e.get('players',[]))]
        if kind in(None,'trade'):
            for t in TRADES:
                if start<t['date']<=end and any(name_key(n)==k for n in t['players_in']+t['players_out']):
                    found.append(dict(date=t['date'],parsed_status='reviewed_trade',text=t['label'],source=t['source']))
        return found
    def production_category(a,dt):
        info=drafted.get(name_key(a['name']))
        return production_bucket(info['year']if info else None,dt)
    contract_names=defaultdict(list)
    for r in contracts:contract_names[name_key(r['player_name'])].append(r)
    def contract_change(a,start,end):
        k=name_key(a['name']);matches=[r for r in contract_names[k] if name_key(r['player_name'])==k and not r.get('adjustment_only')and start<r['known_from']<=end and r.get('contract_type')!='ROOKIE SCALE CONTRACT']
        if not matches:return None
        latest=max(matches,key=lambda r:r['known_from']);before=(date.fromisoformat(latest['known_from'])-timedelta(days=1)).isoformat()
        pid=int(a['id'].split(':')[-1])if':nba:'in a['id']else None
        agreements=contract_names[k]
        old,_,_=agreements_at(agreements,a['name'],pid,before,name_key,lambda y,*_:cap_at(y,end))
        old={int(r['year']):r for r in old};annual=a['details'].get('annual_values',[])
        if not annual:return None
        p=[];v=[];e=[]
        cohort=int(float(a['details'].get('draft_year')or 2000));completed=int(end[:4])+(int(end[5:7])>=7)-1
        for r in annual:
            y=int(r['season']);production=r['production'];cell=old.get(y)
            if cell:
                cost=cell['amount']*CAP/cap_at(y,end)
                if cell.get('waiver_option_verified'):
                    guarantee=cell['waiver_guaranteed_amount_asof']*CAP/cap_at(y,end)
                    if 1.8*production-.8*cost<-.8*guarantee:production=0.;cost=guarantee
            else:
                cp=cap_at(y,end);cost=market.expected(production*cp/CAP,budget_at(y,end),cp,max(0,y-cohort-1),completed)[0]*CAP/cp
                if 1.8*production-.8*cost<0:production=0.;cost=0.
            p.append(production);v.append(1.8*production-.8*cost);e.append(r['exposure'])
        beforeq=quote_window(p,v,e);currentq=quote_window([r['production']for r in annual],[r['asset']for r in annual],e)
        endpoint=endpoint_active(a['details'])
        return dict(value=currentq['contract_adjustment_sum']-beforeq['contract_adjustment_sum'] if endpoint else currentq['quote']-beforeq['quote'],production_component=0. if endpoint else currentq['production_quote']-beforeq['production_quote'],date=latest['known_from'],type=latest.get('contract_type'),player=a['name'])
    totals=Counter();intervals=[];details=[];contract_rows=[];draft_tracking={};warnings=[]
    clock_details=[];fa_entries=[];attribution=[];endpoint_attribution=[]
    for previous,current in zip(snapshots,snapshots[1:]):
        start,end=previous['date'],current['date'];old={a['id']:a for a in previous['assets']if a['kind']=='player'};new={a['id']:a for a in current['assets']if a['kind']=='player'}
        exemplar=next(a for a in new.values()if a.get('details',{}).get('annual_values'))
        exposures={int(r['season']):r['exposure']for r in exemplar['details']['annual_values']}
        changes=Counter();clocked={aid:clock(a,exposures)for aid,a in old.items()}
        changes['player_clock']=sum(clocked[aid]['value']-a['value']for aid,a in old.items())
        def attribute(a,category,component,value):
            if abs(value)>.000001:
                attribution.append(dict(start=start,end=end,player=a['name'],asset_id=a['id'],
                                        category=category,component=component,value=value))
        for aid,a in old.items():
            old_peak,_,_=parts(a);cf=clocked[aid]
            production=cf['peak']-old_peak;financial=cf['value']-a['value']-production
            clock_details.append(dict(start=start,end=end,player=a['name'],asset_id=aid,
                                      total=production+financial,production=production,
                                      financial=financial,tail_carry=cf.get('tail_carry',[]),production_category=production_category(a,end)))
            attribute(a,production_category(a,end),'Rolling production window and aging',production)
            attribute(a,'contracts','Remaining contract-year mix',financial)
        def revalue(a,before,before_peak,isnew=False):
            aid=a['id'];key=name_key(a['name']);total=a['value']-before
            decision=None if isnew else contract_change(a,start,end)
            extension=decision['value']if decision else 0.;extension_p=decision['production_component']if decision else 0.
            if decision:
                rookie_terms=key in drafted and int(decision['date'][:4])==drafted[key]['year']and'EXTENSION'not in str(decision['type'])
                category='rookie_contract_terms'if rookie_terms else'extensions_renewals'
                changes[category]+=extension;contract_rows.append(dict(interval=end,category=category,**decision))
                attribute(a,'contracts','Original rookie contract terms'if rookie_terms else'Extensions and renewals',extension)
            peak,_,_=parts(a);production=peak-before_peak-extension_p
            category=production_category(a,end)
            changes['draft_production_revaluation'if category=='draft'else'player_production_revaluation']+=production
            timing=0.
            previous_asset=old.get(aid)
            if previous_asset and endpoint_active(previous_asset.get('details',{})) and not endpoint_active(a.get('details',{})):
                timing=clocked[aid]['rolling_peak']-before_peak
                attribute(a,'timing','Endpoint to rolling-window handoff',timing)
            attribute(a,category,'Year-four endpoint valuation change' if endpoint_active(a.get('details',{})) else 'Rolling production forecast changes',production-timing)
            financial=total-production-extension
            changes['contract_continuation_revaluation']+=financial
            attribute(a,'contracts','Existing contract and continuation revaluation',financial)
            details.append(dict(start=start,end=end,player=a['name'],kind='new_acquisition_revaluation'if isnew else'continuing',total=total,production=production,financial=financial,extension=extension))
        for aid,a in new.items():
            if aid in old:
                revalue(a,clocked[aid]['value'],clocked[aid]['peak']);continue
            key=name_key(a['name']);draft=int(end[:4])==int(float(a.get('details',{}).get('draft_year')or 0)) and bool(a.get('details',{}).get('draft_slot')) and (start,aid)not in league
            trades=event_matches(a,start,end,'trade')
            if draft:
                changes['draft_player_entry']+=a['value']
                details.append(dict(start=start,end=end,player=a['name'],kind='draft_entry',value=a['value']))
            elif trades:
                incoming=league.get((start,aid))
                if incoming:
                    owner=owners[start,aid]
                    ref=next(z for z in histories[owner][end]['assets']if z['kind']=='player'and z.get('details',{}).get('annual_values'))
                    source_exposures={int(z['season']):z['exposure']for z in ref['details']['annual_values']}
                    cf=clock(incoming,source_exposures);changes['trade_players']+=cf['value'];revalue(a,cf['value'],cf['peak'],True)
                else:
                    changes['trade_players']+=a['value'];warnings.append(dict(date=end,player=a['name'],reason='No previous league mark; incoming trade uses first post-trade monthly value'))
                details.append(dict(start=start,end=end,player=a['name'],kind='trade_in',value=cf['value']if incoming else a['value'],event=trades[-1]['text']))
                attribute(a,'trades','Incoming player',cf['value']if incoming else a['value'])
            else:
                changes['free_agent_entries']+=a['value'];details.append(dict(start=start,end=end,player=a['name'],kind='signing_or_claim_entry',value=a['value'],events=[e['text']for e in event_matches(a,start,end)]))
                reference=market_reference(a,end,caps,market)
                fa_entries.append(dict(date=end,player=a['name'],asset_id=aid,actual_value=a['value'],
                                       reference_value=reference['value'],contract_effect=reference['contract_effect'],
                                       method=reference['method'],annual=reference['annual']))
                attribute(a,'fa','Initial acquisition at reference market terms',reference['value'])
                attribute(a,'contracts','FA and claim terms versus reference market terms',reference['contract_effect'])
        for aid,a in old.items():
            if aid in new:continue
            trades=event_matches(a,start,end,'trade');key=name_key(a['name'])
            if not trades and not event_matches(a,start,end):
                earlier=[t for t in TRADES if t['date']<=end and any(name_key(n)==key for n in t['players_out'])]
                if earlier:
                    t=max(earlier,key=lambda r:r['date']);trades=[dict(date=t['date'],text=t['label'],source=t['source'])]
                    warnings.append(dict(date=end,player=a['name'],reason='Removal observed after reviewed transfer date',transfer_date=t['date']))
            matched_events=event_matches(a,start,end)
            sign_trade=any('sign-and-trade'in e['text'].lower()or'sign and trade'in e['text'].lower()for e in matched_events)
            unrestricted=False
            if sign_trade:
                agencies=[e['date']for e in matched_events if e['parsed_status']=='free_agency']
                if agencies:
                    agency=min(agencies);season=int(agency[:4])
                    restricted=any(name_key(r['player_name'])==key and r.get('contract_type')=='ROOKIE SCALE CONTRACT'and r.get('expiry_season')==season for r in contract_names[key])
                    unrestricted=not restricted
            expired_sign_trade=bool(trades)and unrestricted
            category='trade_players'if trades and not expired_sign_trade else'waiver_expiry_boundary'
            changes[category]-=clocked[aid]['value']
            draft_loss=clocked[aid]['peak'] if category!='trade_players' and production_category(a,end)=='draft' and endpoint_active(a.get('details',{})) else 0.
            if draft_loss:attribute(a,'draft','Loss of drafted player rights before year four',-draft_loss)
            attribute(a,'trades'if category=='trade_players'else'contracts',
                      'Outgoing player'if category=='trade_players'else'Waiver or expiry of contract control',-clocked[aid]['value']+draft_loss)
            details.append(dict(start=start,end=end,player=a['name'],kind='trade_out'if category=='trade_players'else'waiver_or_expiry',value=-clocked[aid]['value'],events=[e['text']for e in event_matches(a,start,end)]))
        delta=sum(a['value']for a in new.values())-sum(a['value']for a in old.values())
        assert abs(sum(changes.values())-delta)<.05,(end,delta,changes)
        totals.update(changes);intervals.append(dict(start=start,end=end,changes=dict(changes),delta=delta))
    derived=dict(clock_production=sum(r['production']for r in clock_details),
                 player_clock_production=sum(r['production']for r in clock_details if r['production_category']=='player'),
                 draft_clock_production=sum(r['production']for r in clock_details if r['production_category']=='draft'),
                 clock_financial=sum(r['financial']for r in clock_details),
                 fa_reference_entries=sum(r['reference_value']for r in fa_entries),
                 fa_contract_effect=sum(r['contract_effect']for r in fa_entries))
    assert abs(derived['clock_production']+derived['clock_financial']-totals['player_clock'])<.01
    assert abs(derived['fa_reference_entries']+derived['fa_contract_effect']-totals['free_agent_entries'])<.01
    payload=dict(totals=dict(totals),derived_totals=derived,intervals=intervals,details=details,
                 clock_details=clock_details,fa_entries=fa_entries,attribution=attribution,endpoint_attribution=endpoint_attribution,
                 contracts=contract_rows,draft_tracking=list(draft_tracking.values()),warnings=warnings,
                 method='rolling-production-attribution-v1; actual rolling production changes during the original owned draft window enter Drafted Player Development, later changes enter Player Development and Aging; contract effects remain separate; year-four endpoint grades are non-additive companion evaluations')
    return payload
