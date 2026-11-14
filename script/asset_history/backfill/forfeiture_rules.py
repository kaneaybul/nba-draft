"""Dated NBA forfeitures, selection-number compression and rookie cost rules.

Primary sources: NBA official disciplinary releases; 2023CBA ArtVIII1(b)(ii)
and ArtX3(b); NBA Constitution June2024 By-Laws7.02. A first-round forfeiture
must affect the lottery BEFORE the draw. Compression is not a lottery simulator.
"""
from __future__ import annotations
import argparse,concurrent.futures,hashlib,json,math,urllib.request
from pathlib import Path
try:
    from .pick_allocator import ref,TEAMS
except ImportError:
    from pick_allocator import ref,TEAMS

FORFEITED='FORFEITED'
BASE='https://pr.nba.com/'
SOURCES={
 'MIL2022':BASE+'bucks-penalty-early-free-agent-discussions/',
 'CHI_MIA':BASE+'bulls-heat-penalties-free-agency/',
 'PHI2023_2024':BASE+'nba-imposes-penalties-on-philadelphia-76ers-for-early-free-agency-discussions/',
 'NYK2025':BASE+'nba-imposes-penalty-on-new-york-knicks-for-early-free-agency-discussions/',
 'PHX2024':BASE+'nba-imposes-penalty-on-phoenix-suns-for-early-free-agency-discussions/',
 'LAC2029_2033':BASE+'nba-investigation-clippers-kawhi-leonard/',
 'Constitution2024':'https://cms.nba.com/wp-content/uploads/sites/4/2024/06/NBA-Consitution-By-Laws-June-2024.pdf',
 'Lottery2026':BASE+'nba-board-of-governors-approves-new-draft-lottery-system-to-address-tanking/',
 'CBA2023':'https://imgix.cosmicjs.com/25da5eb0-15eb-11ee-b5b3-fbd321202bdf-Final-2023-NBA-Collective-Bargaining-Agreement-6-28-23.pdf',
 'CurrentRights':'https://basketball.realgm.com/nba/draft/future_drafts/detailed',
}

def coverage_refs(rule):
    return {ref(v)for v in rule.get('allowed_candidates',[])}if rule['kind']=='forfeit_next_available_second'else{ref(rule['pick'])}

def apply_forfeiture(owners,slots,rule):
    """Forfeit the first reviewed available second; never guess an unknown right.

    Apply at the penalty date after legal ownership is reconstructed. This does
    not move the penalty to a different pick bought after its attachment. If the
    reviewed seven-year horizon contains no available pick, liability is pending
    outside that horizon, rather than fabricated as a zero-valued owned asset.
    """
    if rule.get('reviewed')is not True or not rule.get('source'):raise ValueError('Unreviewed forfeiture')
    team=rule['target_team'];year=int(rule['first_eligible_year'])
    if team not in TEAMS:raise ValueError('Invalid forfeiting team')
    held=[p for p,o in owners.items()if o==team and p[2]==2 and p[1]>=year]
    allowed={ref(p)for p in rule.get('allowed_candidates',held)}
    eligible=[p for p in held if p in allowed]
    earliest=min((p[1]for p in eligible),default=math.inf)
    reviewed_horizon=max((p[1] for p in allowed),default=year)
    unreviewed=[p for p in held if p not in allowed and p[1]<=min(earliest,reviewed_horizon)]
    if unreviewed:raise ValueError('Unreviewed earlier available ownership: '+str(unreviewed))
    if not eligible:return None
    picks=[p for p in eligible if p[1]==earliest]
    if len(picks)>1:
        if rule.get('same_year_policy')!='first_selection':raise ValueError('Multiple next-year picks require a reviewed penalty-selection policy')
        selected=min(picks,key=lambda p:slots[p])
    else:selected=picks[0]
    owners[selected]=FORFEITED
    return selected

def effective_slots_after_forfeitures(owners,slots):
    """Return actual overall selection numbers, with None for removed picks.

    Input slots are physical pre-forfeiture positions; each supplied round must
    contain all30physicalcomponents. If firsts are omitted, assume30surviving
    firsts; otherwise their forfeitures also move the second-round start.
    """
    slots={ref(k):int(v)for k,v in slots.items()}
    if set(owners)!=set(slots):raise ValueError('Owner/slot universe differs')
    result={}
    for year in sorted({p[1]for p in slots}):
        first=sorted([p for p in slots if p[1]==year and p[2]==1],key=slots.get)
        second=sorted([p for p in slots if p[1]==year and p[2]==2],key=slots.get)
        for picks,lo in [(first,1),(second,31)]:
            if picks and(len(picks)!=30 or sorted(slots[p]for p in picks)!=list(range(lo,lo+30))):
                raise ValueError('Compression requires a complete pre-forfeiture physical round')
        counter=1
        for p in first:
            result[p]=None if owners[p]==FORFEITED else counter
            if result[p]is not None:counter+=1
        if not first:counter=31
        for p in second:
            result[p]=None if owners[p]==FORFEITED else counter
            if result[p]is not None:counter+=1
    return result

def rookie_scale_slot(actual_first_slot,first_forfeitures):
    """CBA removes scale rows around15, not at the forfeited physical rank."""
    n=int(first_forfeitures);slot=int(actual_first_slot)
    if not 0<=n<30 or not 1<=slot<=30-n:raise ValueError('Invalid first-round selection/forfeiture count')
    # One removes15; two15,16; three14,15,16; four14..17, etc.
    removed={15+(k+1)//2 if k%2 else 15-k//2 for k in range(n)}
    kept=[i for i in range(1,31)if i not in removed]
    return kept[slot-1]

class RoundAwarePickQuotes:
    """Same trained production OLS, with round-correct and CBA-adjusted costs."""
    def __init__(self,model,reporting_cap=None):
        self.model=model
        self.endpoint=None
        if model.get('production_policy'):
            from calibration.endpoint_model import EndpointModel
            self.endpoint=EndpointModel(model['endpoint_records'])
        self.fit=model['pick_fit'];self.rows={int(r['pick']):r for r in model['pick_curve']}
        self.factor=float(reporting_cap or self.fit['reporting_cap'])/float(self.fit['reporting_cap'])
    def components(self,rnd,actual_slot,first_forfeitures=0,draft_year=None):
        rnd=int(rnd);slot=int(actual_slot)
        if rnd not in(1,2)or not 1<=slot<=60:raise ValueError('Invalid round/selection')
        x=math.log(slot);f=self.fit
        peak=f['peak_production_intercept']+f['peak_production_slope']*x
        cumulative=f['cumulative_production_intercept']+f['cumulative_production_slope']*x
        if rnd==1:
            scale_slot=rookie_scale_slot(slot,first_forfeitures)
            full=self.rows[scale_slot]['annual_full_rookie_scale_reporting_dollars']
            # Contract-cost survival fractions follow the actual drafted slot,
            # not the reindexed CBA salary-band row.
            fractions=self.rows[slot]['annual_paid_cost_fraction']
            cost=[v*w for v,w in zip(full,fractions)]
            method=f'CBA-adjusted first-round scale row {scale_slot}'
        else:
            if slot<30:raise ValueError('Second-round production/cost extrapolation below30 is not approved')
            scale_slot=None
            cost=[max(0.,a+b*x)for a,b in f['second_round_salary_OLS_coefficients']]
            method='Second-round annual salary OLS on actual overall selection'
        adjustment=float(f['payroll_opportunity_scale'])*(cumulative-sum(cost))
        raw=peak+adjustment;quote=max(0.,raw)
        if self.endpoint is not None:
            from calibration.endpoint_model import pick_components
            result=pick_components(self.model,slot,cost,self.endpoint,draft_year if self.model.get('stock_policy') else None)
            return {**{k:v*self.factor for k,v in result.items()},
                    'round':rnd,'actual_slot':slot,'rookie_scale_slot':scale_slot,
                    'expected_salary':sum(cost)*self.factor,
                    'annual_expected_salary':[v*self.factor for v in cost],
                    'salary_method':method}
        return {'round':rnd,'actual_slot':slot,'rookie_scale_slot':scale_slot,
                'production_quote':peak*self.factor,'cumulative_production':cumulative*self.factor,
                'expected_salary':sum(cost)*self.factor,'annual_expected_salary':[v*self.factor for v in cost],
                'contract_adjustment':adjustment*self.factor,'quote':quote*self.factor,
                'floor_adjustment':(quote-raw)*self.factor,'salary_method':method}
    def __call__(self,rnd,actual_slot,first_forfeitures=0,draft_year=None):return self.components(rnd,actual_slot,first_forfeitures,draft_year)['quote']

def penalty_rules():
    rules=[]
    def fixed(rid,known,pick,owner,source,extra=()):
        rules.append(dict(rule_id=rid,known_from=known,order=10000+len(rules),reviewed=True,source=[source,*extra],kind='transfer',pick=pick,from_team=owner,to_team=FORFEITED))
    fixed('FORFEIT_MIL2022','2020-12-21',['MIL',2022,2],'MIL',SOURCES['MIL2022'])
    # Reviewed candidate footprints from dated outgoing commitments. The generic
    # helper explicitly refuses any earlier unreviewed owner still present.
    for team,candidates in [
        ('CHI',[['DEN',2023,2],['CHI',2025,2],['CHI',2026,2],['CHI',2027,2],['CHI',2028,2],['POR',2028,2]]),
        ('MIA',[['DEN',2022,2],['PHI',2022,2],['MIA',2024,2],['MIA',2028,2]])]:
        rules.append(dict(rule_id=f'FORFEIT_{team}_NEXT_2021',known_from='2021-12-01',order=10000+len(rules),reviewed=True,
            source=[SOURCES['CHI_MIA']],kind='forfeit_next_available_second',target_team=team,first_eligible_year=2022,
            allowed_candidates=candidates,requires_complete_earlier_ownership=True,
            unresolved_policy='If multiple eligible held picks coexist in the earliest draft, stop for source adjudication; no best/worst assumption.'))
    for year in [2023,2024]:fixed(f'FORFEIT_PHI{year}','2022-10-31',['PHI',year,2],'PHI',SOURCES['PHI2023_2024'])
    fixed('FORFEIT_NYK2025','2022-12-21',['NYK',2025,2],'NYK',SOURCES['NYK2025'])
    fixed('FORFEIT_PHX_DEN2024','2023-10-25',['DEN',2024,2],'PHX',SOURCES['PHX2024'])
    # NBA announces one held first per year; current detailed rights identifies
    # IND2029, preserving PHI's separate swap on LAC2029. Later TOR2031/33
    # acquisitions are separate assets and are deliberately not forfeited.
    fixed('FORFEIT_LAC_IND2029','2026-09-02',['IND',2029,1],'LAC',SOURCES['LAC2029_2033'],[SOURCES['CurrentRights']])
    for year in range(2030,2034):fixed(f'FORFEIT_LAC{year}','2026-09-02',['LAC',year,1],'LAC',SOURCES['LAC2029_2033'],[SOURCES['CurrentRights']])
    return rules

def lottery_policy_status(year,first_forfeitures):
    """Never label post-draw deletion as a verified lottery treatment."""
    if not first_forfeitures:return {'verified':True,'reason':'No first-round forfeiture'}
    if int(year)<=2026:
        return {'verified':True,'source':SOURCES['Constitution2024'],
                'procedure':'Exclude forfeited physical origin before drawing; re-rank eligible nonplayoff teams; redistribute unused bottom-row odds proportionally. This helper does not perform that simulation.'}
    return {'verified':False,'affected_year':int(year),'source':[SOURCES['Constitution2024'],SOURCES['Lottery2026']],
            'reason':'2024Constitution excludes forfeited picks, but detailed interaction with the2027-29 sixteen-team drawing/floors and2030+ undecided rules has not been source-verified. Do not simply run30teams then delete the forfeited lottery outcome.'}

def cache_sources(output):
    output=Path(output);(output/'raw').mkdir(parents=True,exist_ok=True)
    def one(kv):
        key,url=kv;path=output/'raw'/(key+('.pdf'if url.endswith('.pdf')else'.html'))
        try:
            data=path.read_bytes()if path.exists()else urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=35).read()
            path.write_bytes(data)
            return dict(key=key,source=url,status='available',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
        except Exception as e:return dict(key=key,source=url,status='unavailable',error=type(e).__name__+': '+str(e))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:rows=list(pool.map(one,SOURCES.items()))
    (output/'source_manifest.json').write_text(json.dumps(rows,indent=2))
    (output/'reviewed_penalty_rules.json').write_text(json.dumps(penalty_rules(),indent=2))
    (output/'policy_review.json').write_text(json.dumps({'first_forfeiture_future_policy':lottery_policy_status(2029,1),
       'known_actual_order_crosschecks':[{'known_from':'2022-05-17','source':BASE+'2022-nba-draft-lottery-results/','forfeited_physical':'PHI2022R2 held by MIA; MIL2022R2'},
        {'known_from':'2023-04-17','source':BASE+'ties-broken-for-order-of-selection-in-nba-draft-2023-presented-by-state-farm/','forfeited_physical':'DEN2023R2 held byCHI; PHI2023R2'}],
       'crosscheck_scope':'Later actual orders validate identities only aftertheirpublication; neverforceanearlierprotectionoutcome.',
       'CBA_scale_removal':'ArticleVIII1(b)(ii): remove middle row15foroneforfeit; firstactual15usesoriginalscale16.',
       'round_numbering':'ArticleX3(b) reducesroundcount. Afteronefirstforfeit, secondroundbeginsat30andrequiressecondroundsalaryOLS.'},indent=2))
    return rows
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();print(json.dumps(cache_sources(a.output)))

