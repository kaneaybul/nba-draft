"""Dated original legal entitlements created or transferred during 2023.

Each operation follows original conditional terms; labels naming subsequently
selected players are excluded. Allocation preserves every physical component.
"""
from copy import deepcopy

META = {'L03993': ('2023-01-05', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=2023-02-09&offset-trade_id=234']), 'L04148': ('2023-01-23', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=2023-02-09&offset-trade_id=234']), 'L04255': ('2023-02-06', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=2023-02-09&offset-trade_id=234']), 'L04269': ('2023-02-07', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=2023-02-09&offset-trade_id=234']), 'L04288': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04289': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04290': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04291': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04292': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04293': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04294': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04295': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04296': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04297': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04298': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04299': ('2023-02-09', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04887': ('2023-06-22', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04888': ('2023-06-23', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04889': ('2023-06-23', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04890': ('2023-06-23', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04894': ('2023-06-23', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04942': ('2023-06-28', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04944': ('2023-06-28', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04945': ('2023-06-28', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L04946': ('2023-06-28', ['https://basketball.realgm.com/nba/transactions/league/2023', 'https://www.salaryswish.com/ajax2/trades?season=2023&offset-date=&offset-trade_id=0']), 'L05222': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05230': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05231': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05249': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05262': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05264': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05297': ('2023-07-06', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05309': ('2023-07-07', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05316': ('2023-07-07', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05345': ('2023-07-08', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05372': ('2023-07-11', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2023-07-12&offset-trade_id=283']), 'L05381': ('2023-07-12', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L05383': ('2023-07-12', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L05401': ('2023-07-17', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L05617': ('2023-09-27', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L05707': ('2023-10-01', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L05851': ('2023-10-17', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L06254': ('2023-11-01', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'L06817': ('2023-12-30', ['https://basketball.realgm.com/nba/transactions/league/2024', 'https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'SS_2023_07_17_ORL_PHX': ('2023-07-17', ['https://www.salaryswish.com/ajax2/trades?season=2024&offset-date=2024-02-08&offset-trade_id=315']), 'NBA_2023_10_25_PHX_PENALTY': ('2023-10-25', ['https://www.nba.com/news/suns-lose-2024-second-round-draft-pick-free-agency-violation'])}

def p(team,year,rnd=2):return [team,year,rnd]
def actions():
 out=[];current=None
 def event(eid):
  nonlocal current
  current=eid
 def emit(kind,**fields):
  day,sources=META[current]
  item=dict(event_id=current,known_from=day,order=30000+len(out),reviewed=True,source=sources,kind=kind,**fields)
  out.append(item);return item
 def rule(kind,**fields):
  day,sources=META[current];rid=fields.pop('rule_id',f'{current}_{len(out)}')
  emit('add_rule',rule=dict(rule_id=rid,known_from=day,order=30000+len(out),reviewed=True,source=sources,kind=kind,**fields))
 def move(origin,year,source,target,rnd=2,optional=False):
  rule('entitlement_transfer',picks=[p(origin,year,rnd)],from_team=source,to_team=target,count_range=[0 if optional else 1,1])
 def basket(origins,year,source,target,rnd=2,count=1):
  rule('entitlement_transfer',picks=[p(t,year,rnd)for t in origins],from_team=source,to_team=target,count_range=[count,count])
 def rank(origins,year,source,target,which='best',rnd=2,**extra):
  rule('ranked_transfer',picks=[p(t,year,rnd)for t in origins],from_team=source,to_team=target,rank=which,**extra)
 def chain(origin,source,target,branches,fallback=(),rnd=1,**extra):
  rule('protected_chain',from_team=source,to_team=target,branches=[dict(pick=p(origin,y,rnd),protected_ranges=ranges)for y,ranges in branches],fallback_picks=list(fallback),**extra)
 def swap(leftpool,rightpool,left,right,**extra):
  rule('holder_pool_swap',left_pool=leftpool,right_pool=rightpool,left_owner=left,right_owner=right,**extra)
 def unresolved(reason):emit('unresolved',reason=reason,exact_missing_terms=reason)

 event('L03993')
 chain('SAS','SAS','BOS',[(2024,[[31,54]])],rnd=2)
 event('L04148')
 move('CHI',2023,'LAL','WAS');rank(['LAL','WAS'],2028,'LAL','WAS','worst');move('LAL',2029,'LAL','WAS')
 event('L04255')
 move('DAL',2027,'DAL','BKN');move('DAL',2029,'DAL','BKN',rnd=1);move('DAL',2029,'DAL','BKN')
 event('L04269');move('MIA',2028,'MIA','SAS')
 event('L04288')
 move('LAC',2024,'LAC','LAL');move('LAC',2025,'LAC','LAL');move('DEN',2024,'DEN','ORL')
 event('L04289')
 for y in[2024,2025]:move('OKC',y,'ATL','HOU',optional=True)
 event('L04290');move('PHX',2029,'PHX','OKC')
 event('L04291')
 for y in[2023,2025,2027,2029]:move('PHX',y,'PHX','BKN',rnd=1,optional=y==2023)
 swap([p(t,2028,1)for t in['BKN','PHI']],[p('PHX',2028,1)],'BKN','PHX',left_rank='worst',rule_id='L04291_BKN_PHX_2028_SWAP')
 rank(['CLE','GSW','MIL'],2023,'MIL','IND','best')
 move('MIL',2024,'MIL','IND');move('IND',2025,'MIL','IND')
 move('MIL',2028,'MIL','BKN');move('MIL',2029,'MIL','BKN')
 event('L04292')
 move('TOR',2023,'TOR','SAS');move('TOR',2025,'TOR','SAS')
 chain('TOR','TOR','SAS',[(y,[[1,6]])for y in[2024,2025,2026]],[p('TOR',2026),p('TOR',2027)],rule_id='L04292_TOR2024_FIRST')
 event('L04293')
 if 'https://atlantahawkspr.wordpress.com/wp-content/uploads/2023/02/bey-2.9.23.pdf' not in META[current][1]:META[current][1].append('https://atlantahawkspr.wordpress.com/wp-content/uploads/2023/02/bey-2.9.23.pdf')
 # The already-outgoing protected tails retain their earlier owners. Only the
 # complementary Atlanta-owned portions were transferred in the Bey deal.
 basket(['ATL','CHA','BKN'],2023,'ATL','POR')
 chain('ATL','ATL','POR',[(2024,[[56,60]])],rnd=2)
 chain('ATL','ATL','POR',[(2025,[[41,60]])],rnd=2)
 move('ATL',2026,'ATL','GSW');move('ATL',2028,'ATL','GSW')
 move('MEM',2026,'GSW','POR',optional=True);move('GSW',2028,'GSW','POR')
 event('L04294')
 chain('NYK','NYK','POR',[(2023,[[1,14]])],rule_id='L04294_NYK2023_FIRST')
 emit('add_economic_claim',known_until='2023-04-02',claim=dict(claim_id='L04294_NYK_HART_UNSPECIFIED_SECOND_FALLBACK',kind='conditional_generic_seconds',predicate=dict(pick=p('NYK',2023,1),range=[1,14]),count=4,quote_distribution=dict(round=2,slots=list(range(31,61)),probabilities=[1/30]*30),from_team='NYK',to_team='POR',model_assumption='Fourpubliclyreportedsecond-roundfallbacks, undisclosedphysicaloriginsandyears. Modeledasfouruniform31–60expectedpickquotes, conservedNYKtoPOR; doesnotassertphysicalownership.',resolved_by='https://www.nba.com/game/was-vs-nyk-0022201168',resolution='NYKclinchedplayoffberth2023-04-02; thefirstisnonlotteryandthefour-secondfallbackcannotactivate.'))
 basket(['ATL','CHA','BKN'],2023,'PHI','CHA')
 move('NYK',2024,'CHA','PHI');move('POR',2029,'POR','PHI')
 rank(['NOP','POR'],2027,'POR','CHA','best')
 event('L04295')
 rank(['NOP','CHI'],2024,'NOP','SAS','best')
 basket(['NOP','POR'],2026,'NOP','SAS')
 move('NOP',2028,'NOP','SAS');move('NOP',2029,'NOP','SAS')
 event('L04296')
 basket(['IND','CLE','UTA'],2024,'MEM','LAC');move('TOR',2024,'MEM','LAC');move('MEM',2027,'MEM','LAC')
 swap([p('MIL',2023,1)],[p(t,2023,1)for t in['LAC','OKC']],'HOU','LAC',protected_ranges=[[1,6]])
 swap([p(t,2026)for t in['IND','MIA','BOS']],[p('LAC',2026)],'MEM','LAC',rule_id='L04296_MEM_LAC2026_SECOND_SWAP')
 event('L04297')
 basket(['MEM','WAS'],2024,'LAL','MIN');move('UTA',2025,'UTA','MIN',optional=True);move('UTA',2026,'UTA','MIN',optional=True)
 chain('LAL','LAL','UTA',[(2027,[[1,4]])],[p('LAL',2027)],rule_id='L04297_LAL2027_FIRST')
 event('L04298');move('LAC',2028,'LAC','CHA')
 event('L04299')
 rank(['DAL','MIA','POR'],2023,'BOS','OKC','worst');move('BOS',2029,'BOS','OKC')
 event('L04887');move('MIL',2030,'MIL','ORL')
 event('L04888')
 chain('DEN','DEN','OKC',[(2029,[[1,5]]),(2030,[[1,5]])],[p('DEN',2030)],requires_gap_after_rule='DEN2027_FIRST_2022_GREEN',minimum_gap_years=2,requires_prior_conveyance=True,rule_id='L04888_DEN2029_FIRST')
 rank(['OKC','LAC','HOU','UTA'],2024,'OKC','IND','worst',rnd=1)
 basket(['CHA','MIN'],2024,'OKC','DEN')
 event('L04889')
 for y in[2024,2026,2028,2030]:
  rightpool=[p(t,y,1)for t in(['PHX','BKN','PHI']if y==2028 else['PHX'])]
  if y in[2024,2026]:
   rule('selected_swap',left_select={'held':dict(picks=[p('WAS',y,1)],owner='WAS',count_range=[0,1])},right_select={'held':dict(picks=rightpool,owner='PHX',count_range=[1,1])},left_owner='WAS',right_owner='PHX',allow_no_selection=True,rule_id=f'L04889_WAS_PHX_{y}_RESIDUAL_SWAP')
  else:swap([p('WAS',y,1)],rightpool,'WAS','PHX',rule_id=f'L04889_WAS_PHX_{y}_RESIDUAL_SWAP')
 for y in[2024,2025,2026,2027,2030]:move('PHX',y,'PHX','WAS')
 move('PHX',2028,'PHX','IND');move('WAS',2029,'WAS','IND')
 event('L04890')
 rule('entitlement_transfer',picks=[p('GSW',y,1)for y in[2024,2025,2026]],from_team='MEM',to_team='BOS',count_range=[1,1])
 event('L04894')
 move('UTA',2026,'MIN','SAS',optional=True);move('MIN',2028,'MIN','SAS')
 event('L04942');move('DAL',2024,'SAC','BOS')
 event('L04944')
 move('CHI',2026,'CHI','WAS',optional=True);move('CHI',2027,'CHI','WAS',optional=True)
 event('L04945')
 rank(['DET','GSW','WAS'],2025,'DET','BOS','best')
 rank(['MIN','NYK','NOP','POR'],2026,'DET','BOS','best')
 event('L04946');move('ATL',2027,'ATL','BOS')
 event('L05222')
 chain('BKN','HOU','BKN',[(2024,[[31,55]])],rnd=2);move('MIL',2028,'BKN','HOU')
 event('L05230')
 move('DAL',2028,'SAC','IND');move('SAC',2030,'SAC','IND')
 event('L05231')
 move('GSW',2027,'GSW','WAS')
 chain('GSW','GSW','WAS',[(2030,[[1,20]])],[p('GSW',2030)],rule_id='L05231_GSW2030_FIRST')
 event('L05249')
 move('DAL',2027,'BKN','DET');move('MIL',2029,'BKN','DET')
 event('L05262')
 move('LAL',2026,'CLE','MIA');move('CLE',2030,'CLE','SAS')
 basket(['OKC','DAL','PHI'],2026,'MIA','SAS')
 # SAS already owns the worstfour entitlement from Hernangomez. Transfer the
 # less favorable of that entitlement and SASown, preserving the retainedother.
 rank(['SAS','OKC','HOU','IND','MIA'],2027,'SAS','MIA','worst')
 event('L05264')
 move('DAL',2027,'DET','WAS');move('BKN',2027,'DET','WAS')
 rank(['DAL','BKN'],2027,'WAS','DET','worst')
 event('L05297')
 move('MIA',2029,'MIA','OKC');move('MIA',2030,'MIA','OKC')
 event('L05309');move('MEM',2026,'UTA','ATL',optional=True)
 event('L05316')
 rank(['IND','PHX'],2028,'IND','NYK','worst');rank(['IND','WAS'],2029,'IND','NYK','worst')
 event('L05345')
 move('MEM',2027,'LAC','HOU')
 # Clippers own the residual after Memphis's prior improvement option.
 basket(['LAC','BOS','IND','MIA'],2026,'LAC','HOU')
 move('MIN',2025,'HOU','ATL');move('HOU',2028,'HOU','ATL')
 for y in[2024,2029,2030]:move('HOU',y,'HOU','OKC',optional=y==2024)
 event('L05372')
 for y in[2024,2030]:swap([p('MEM',y,1)],[p(t,y,1)for t in['WAS','PHX']],'MEM','PHX',rule_id=f'L05372_MEM_PHX_{y}_RESIDUAL_SWAP')
 move('NOP',2025,'MEM','PHX');move('MEM',2028,'MEM','PHX');move('MEM',2029,'MEM','PHX')
 event('L05381');move('GSW',2026,'ATL','OKC')
 event('L05383')
 basket(['NOP','CHI'],2024,'SAS','BOS');move('TOR',2025,'SAS','DAL');move('MIA',2028,'SAS','DAL')
 move('DAL',2030,'DAL','BOS')
 rule('selected_swap',left_select={'held':dict(picks=[p(t,2025)for t in['DET','GSW','WAS']],owner='BOS',count_range=[1,1])},right_select={'held':dict(picks=[p('DAL',2025)],owner='DAL',count_range=[0,1])},left_owner='BOS',right_owner='DAL',allow_no_selection=True,rule_id='L05383_BOS_DAL2025_SECOND_SWAP')
 swap([p('SAS',2030,1)],[p('DAL',2030,1)],'SAS','DAL',rule_id='L05383_SAS_DAL2030_FIRST_SWAP')
 event('SS_2023_07_17_ORL_PHX')
 swap([p('ORL',2026,1)],[p(t,2026,1)for t in['WAS','PHX']],'ORL','PHX',rule_id='SS_2023_ORL_PHX2026_FIRST_SWAP')
 move('DEN',2024,'ORL','PHX')
 rank(['ORL','DET','MIL'],2026,'ORL','PHX','worst')
 move('BOS',2028,'ORL','PHX',optional=True)
 event('L05401')
 chain('SAS','SAS','PHX',[(2024,[[31,49],[55,60]])],rnd=2)
 move('NOP',2025,'PHX','SAS')
 event('L05617')
 move('MIL',2029,'MIL','POR',rnd=1)
 for y in[2028,2030]:
  rule('selected_swap',left_select={'held':dict(picks=[p('POR',y,1)],owner='POR',count_range=[0 if y==2028 else 1,1])},right_select=p('MIL',y,1),left_owner='POR',right_owner='MIL',allow_no_selection=True,rule_id=f'L05617_POR_MIL{y}_FIRST_SWAP')
 event('L05707')
 rule('entitlement_transfer',picks=[p('GSW',y,1)for y in[2024,2025,2026]],from_team='BOS',to_team='POR',count_range=[1,1])
 move('BOS',2029,'BOS','POR',rnd=1)
 event('L05851')
 move('MIN',2027,'HOU','OKC');move('MIL',2028,'HOU','OKC')
 event('NBA_2023_10_25_PHX_PENALTY');move('DEN',2024,'PHX','FORFEITED')
 event('L06254')
 move('LAC',2028,'LAC','PHI',rnd=1);move('LAC',2029,'LAC','PHI')
 swap([p(t,2027,1)for t in['OKC','DEN']],[p('LAC',2027,1)],'OKC','LAC',left_rank='worst',rule_id='L06254_OKC_LAC2027_FIRST_SWAP')
 rank(['OKC','LAC','HOU'],2026,'OKC','PHI','worst',rnd=1)
 swap([p('PHI',2029,1)],[p('LAC',2029,1)],'PHI','LAC',protected_ranges=[[1,3]],rule_id='L06254_PHI_LAC2029_FIRST_SWAP')
 rank(['TOR','IND','CLE','UTA'],2024,'LAC','PHI','best')
 event('L06817');move('DET',2024,'NYK','TOR')
 return deepcopy(out)
