"""Source-reviewed second-round baskets at the 2021-12-31 opening baseline.

Rules collapse transfers already completed before the baseline into final joint
claims. They do not model earlier publication dates. Lower numerical overall
slot is always more favorable; no realized draft slot enters these expressions.
"""
from __future__ import annotations
from copy import deepcopy
from pick_allocator import ref,TEAMS

ASOF='2021-12-31'
PST='https://www.prosportstransactions.com/basketball/DraftTrades/Years/'
NBA_NETS='https://www.nba.com/nets/news/2021/08/06/brooklyn-nets-acquire-future-draft-considerations-five-team-trade'

def p(team,year):return [team,year,2]
def best(*xs):return {'best':list(xs)}
def worst(*xs):return {'worst':list(xs)}
def claim(team,expr):return {'owner':team,'select':expr}

def _select(expr,slots,scope,assigned):
    if isinstance(expr,(list,tuple)):
        result=ref(expr)
    elif isinstance(expr,dict) and 'if_slot_in' in expr:
        cond=expr['if_slot_in'];slot=slots[ref(cond['pick'])]
        result=_select(expr['then']if cond['range'][0]<=slot<=cond['range'][1]else expr['else'],slots,scope,assigned)
    elif isinstance(expr,dict) and ('best'in expr or'worst'in expr):
        op='best'if'best'in expr else'worst';xs=[_select(x,slots,scope,assigned)for x in expr[op]]
        if not xs:raise ValueError('Empty rank selector')
        result=(min if op=='best'else max)(xs,key=lambda k:(slots[k],k))
    elif expr in ('remaining','best_remaining','worst_remaining'):
        xs=scope-assigned
        if not xs or(expr=='remaining'and len(xs)!=1):raise ValueError('Remainder is not a single available physical pick')
        result=(max if expr=='worst_remaining'else min)(xs,key=lambda k:(slots[k],k))
    else:raise ValueError('Unsupported pick selector')
    if result not in scope:raise ValueError('Selector references a pick outside its reviewed basket')
    return result

def claim_owner(expr,slots):
    if isinstance(expr,dict) and 'if_slot_in' in expr:
        cond=expr['if_slot_in'];slot=slots[ref(cond['pick'])]
        return claim_owner(expr['then']if cond['range'][0]<=slot<=cond['range'][1]else expr['else'],slots)
    if expr not in TEAMS:raise ValueError('Invalid basket recipient')
    return expr

def apply_selector_partition(owners,slots,rule):
    """Allocate a reviewed basket once, checking ownership and total coverage."""
    if rule.get('reviewed')is not True or not rule.get('source'):raise ValueError('Unreviewed selector partition')
    picks=[ref(v)for v in rule['picks']];scope=set(picks)
    if len(scope)!=len(picks):raise ValueError('Duplicate physical component')
    expected={ref(v):owner for v,owner in rule['expected_owners']}
    if set(expected)!=scope or any(owners.get(k)!=v for k,v in expected.items()):raise ValueError('Selector partition owner mismatch')
    assignments={}
    for c in rule['claims']:
        owner=claim_owner(c['owner'],slots)
        pick=_select(c['select'],slots,scope,set(assignments))
        if pick in assignments:raise ValueError('Basket assigns one physical pick twice')
        assignments[pick]=owner
    if set(assignments)!=scope:raise ValueError('Basket leaves a physical pick unassigned')
    owners.update(assignments)

def affected_refs(rule):return {ref(v)for v in rule['picks']}

def build_rules():
    rules=[]
    def add(rid,known,picks,claims,sources,candidates,note):
        rules.append(dict(rule_id=rid,kind='selector_partition',known_from=known,order=1000+len(rules),reviewed=True,
            source=sources,picks=picks,covered_refs=picks,expected_owners=[[v,v[0]]for v in picks],claims=claims,
            source_candidate_indices=candidates,review_note=note,baseline_only=True,review_asof=ASOF))
    # Dallas had acquired Miami's physical pick; its better MIA/DAL entitlement
    # went to OKC. Memphis' worse entitlement and HOU swap went to Boston.
    # Houston's retained protected 31/32 interest / worse residual went to IND.
    # OKC later sent BOS the least favorable of OKC, WAS and better(MIA,DAL).
    h,m,d,o,w=[p(t,2023)for t in ['HOU','MIA','DAL','OKC','WAS']]
    a=best(m,d);b=worst(m,d)
    conditional=lambda yes,no:{'if_slot_in':{'pick':h,'range':[31,32]},'then':yes,'else':no}
    add('OPEN_2023_HOU_MIA_DAL_OKC_WAS_SECONDS','2021-08-17',[h,m,d,o,w],
        [claim('IND',conditional(h,worst(h,b))),claim('BOS',conditional(b,best(h,b))),
         claim('NYK',worst(o,w,a)),claim('OKC','best_remaining'),claim('OKC','remaining')],
        [PST+'2023.htm',PST+'2021.htm','https://www.nba.com/hornets/news/how-the-hornets-acquired-their-five-2023-nba-draft-picks'],[0,9,31,38,42,58,63,69,85,110],
        'IND receives HOU at31/32; otherwise the least favorable HOU/MIA/DAL. BOS retains the complementary MEM swap claim. The separate least favorable of OKC/WAS/better(MIA,DAL) went through BOS toNYK in theAug2021Fournier sign-and-trade; OKC retains the other two. Original NBA Hornets transaction explainer resolves the SS shorthand that stopped at BOS.')
    c,u,i=[p(t,2024)for t in ['CLE','UTA','IND']]
    add('OPEN_2024_IND_CLE_UTA_SECONDS','2021-08-07',[c,u,i],
        [claim('NYK',best(c,u)),claim('MEM',best(i,worst(c,u))),claim('IND','remaining')],
        [PST+'2024.htm',PST+'2026.htm'],[2,53,69,91,100],
        'NYK owns better(CLE,UTA). The IND-to-MIL-to-MEM claim is better(IND,worse(CLE,UTA)); IND retains the least favorable of the three. The source shorthand either was resolved using the original transaction description, not an actual pick slot.')
    i,m,s=[p(t,2026)for t in ['IND','MIA','SAS']]
    add('OPEN_2026_IND_MIA_SAS_SECONDS','2021-08-08',[i,m,s],
        [claim('MEM',best(i,m)),claim('SAS',best(s,worst(i,m))),claim('IND','remaining')],
        [PST+'2026.htm'],[18,91,100,107],
        'MEM owns better(IND,MIA) through MIL. SAS may improve its own pick using the less favorable of IND/MIA; IND keeps the less favorable of that swap pair. The later source statement identifying which pick was lower is hindsight and is not used.')
    b,m=[p(t,2025)for t in ['BOS','MEM']]
    add('OPEN_2025_BOS_MEM_SECONDS','2021-06-19',[b,m],
        [claim('OKC',best(b,m)),claim('ORL','remaining')],
        [PST+'2021.htm',PST+'2025.htm'],[42,79,86],
        'The Fournier trade gives ORL worse(BOS,MEM); the Walker/Horford trade gives OKC better(BOS,MEM). MEM transferred its original physical pick to BOS in2020. Neither pick is additionally retained by BOS or MEM.')
    w,g=[p(t,2025)for t in ['WAS','GSW']]
    add('OPEN_2025_WAS_GSW_SECONDS','2021-09-04',[w,g],
        [claim('DET',best(w,g)),claim('WAS','remaining')],
        [NBA_NETS,PST+'2025.htm'],[25,96,99,112],
        'NBA Nets original Aug6 announcement specifies a swap of the GSW pick for WAS, not the already-outgoing BKN own pick. Brooklyn transferred its improved claim to DET Sep4. WAS keeps the less favorable physical component.')
    m,w=[p(t,2024)for t in ['MEM','WAS']]
    add('OPEN_2024_MEM_WAS_SECONDS','2021-09-04',[m,w],
        [claim('DET',best(m,w)),claim('LAL','remaining')],
        [NBA_NETS,PST+'2024.htm'],[19,50,96,97,112],
        'MEM was transferred to OKC and then WAS before the five-team Aug6 deal. BKN received the more favorable MEM/WAS claim and LAL the other. BKN subsequently sent its claim to DET.')
    h,b,m=[[t,2022,1]for t in ['HOU','BKN','MIA']]
    d,f=[p(t,2022)for t in ['DEN','PHI']]
    lottery=lambda yes,no:{'if_slot_in':{'pick':m,'range':[1,14]},'then':yes,'else':no}
    median=best(worst(h,b),worst(h,m),worst(b,m))
    add('OPEN_2022_HOU_BKN_MIA_FIRST_AND_DEN_PHI_SECONDS','2021-03-25',[h,b,m,d,f],
        [claim('HOU',lottery(h,best(h,b,m))),claim('HOU',lottery(b,median)),
         claim('MIA',lottery(m,worst(h,b,m))),claim('MIN',best(d,f)),
         claim(lottery('HOU','MIA'),worst(d,f))],
        ['https://www.miamiherald.com/sports/spt-columns-blogs/barry-jackson/article251588273.html',PST+'2022.htm','https://www.nba.com/news/philadelphia-76ers-jimmy-butler-trade-official-release'],[],
        'Houston retains the two most favorable HOU/BKN/MIA firsts when MIA is nonlottery, and Miami the worst. If MIA is lottery protected, HOU keeps HOU/BKN and receives worse(DEN,PHI) second instead; MIA keeps its first. The better DEN/PHI second was transferred by PHI to MIN in the2018Butler trade; the RealGM register labels this as a swap but primaryNBA and original transaction terms establish a transferred better-pick entitlement, not a PHI/MIN physical swap. No actual2022results or laterforfeiture enters the original trade condition.')
    rules[-1]['expected_owners']=[[v,'HOU'if v==b else v[0]]for v in rules[-1]['picks']]
    return deepcopy(rules)
