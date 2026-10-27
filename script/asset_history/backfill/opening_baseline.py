"""Adjudicated first baseline cohort and finite remaining opening-right queue.

Do not price unknown physical picks as retained own picks. The allocator starts
with original owners only as an internal conservation device; that is not proof
of retained ownership in the output ledger.
"""
import argparse,json,random
from pathlib import Path
from pick_allocator import TEAMS,allocate

ASOF='2021-12-31'
EXPECTED={23:('2019-07-06','MEM'),93:('2021-07-30','OKC'),7:('2019-01-31','NYK'),24:('2019-07-06','NOP'),26:('2019-07-07','MEM'),32:('2019-07-10','OKC'),33:('2019-07-16','OKC'),41:('2020-11-17','OKC'),57:('2020-11-24','NOP'),67:('2020-12-08','OKC'),68:('2021-01-16','HOU'),73:('2021-03-19','HOU'),74:('2021-03-19','MIL'),90:('2021-07-29','NYK'),92:('2021-07-30','OKC'),111:('2021-08-28','CHI')}

def candidates_from_evidence(evidence):
    rows=[]
    for t in sorted(evidence,key=lambda t:t['date']):
        if t['date']>ASOF:continue
        for r in t['recipients']:
            refs=[p for p in r['pick_references']if p['draft_year']>=2022]
            if refs:rows.append(dict(idx=len(rows),date=t['date'],team=r['team'],refs=refs,terms=r['original_reported_terms'],source=t['source']))
    return rows

def build(candidates,register_events=None):
 rules=[];covered_candidates=set();unresolved=[]
 byidx={r['idx']:r for r in candidates}
 for idx,expected in EXPECTED.items():
  r=byidx[idx]
  if (r['date'],r['team'])!=expected:raise ValueError('Source candidate order changed; re-review curation before applying index '+str(idx))
 def base(idx,rid,kind,**kw):
  r=byidx[idx];rules.append(dict(rule_id=rid,known_from=r['date'],order=len(rules),reviewed=True,source=r['source'],source_candidate_index=idx,kind=kind,**kw));covered_candidates.add(idx)
 def transfer(idx,origin,year,rnd,target):base(idx,f'{origin}{year}R{rnd}_to_{target}','transfer',pick=[origin,year,rnd],from_team=origin,to_team=target)
 def chain(idx,rid,origin,target,years,cuts,fallback=()):
  base(idx,rid,'protected_chain',from_team=origin,to_team=target,branches=[dict(pick=[origin,y,1],protected_ranges=[[1,cut]]if cut else[])for y,cut in zip(years,cuts)],fallback_picks=[[origin,y,2]for y in fallback])
 # Unprotected first-round baseline transfers. These pick references are not
 # footnoted as swap/conditional references in their source trade blocks.
 for y in [2022,2024,2026]:transfer(32,'LAC',y,1,'OKC')
 for y in [2024,2026]:transfer(68,'BKN',y,1,'HOU')
 transfer(73,'MIL',2023,1,'HOU')
 for y in [2025,2027]:transfer(57,'MIL',y,1,'NOP')
 transfer(24,'LAL',2022,1,'NOP')
 # Original terms as they stood at the 2021 cutoff. In particular MIA was not
 # amended to 2025-only until February2022; the source's later amendment is
 # deliberately excluded here. DET/WAS references are not their realized
 # fallback labels in the retrospective source display.
 chain(23,'UTA_CONLEY_2019','UTA','MEM',[2022,2023,2024],[6,3,1],[2025,2026])
 chain(93,'UTA_FAVORS_2021','UTA','OKC',[2024,2025,2026],[10,10,8],[2028])
 rules[-1].update(requires_gap_after_rule='UTA_CONLEY_2019',minimum_gap_years=2,original_terms_crosscheck='Validated Utah initial obligations in monthly_reconstruction/ledger/build_ledger.py and pick_values/value_monthly_picks.py; no later amendment backfilled.')
 chain(6,'OKC_SCHRODER_2022','OKC','ATL',[2022],[14],[2024,2025])
 rules[-1]['source_crosschecks']=['https://boomtownhoops.com/prestis-war-chest-of-assets-explained/']
 # CLE's earlier protected2020first failed before this baseline, leaving the
 # 2022second in NewOrleans. The2021Valanciunas trade then conveys either
 # the LAL first outside top10, or that CLEsecond plus NOP's2025second.
 transfer(21,'CLE',2022,2,'NOP')
 base(102,'NOP_MEM_LAL_2022_VALANCIUNAS','protected_chain',from_team='NOP',to_team='MEM',branches=[dict(pick=['LAL',2022,1],protected_ranges=[[1,10]])],fallback_picks=[['CLE',2022,2],['NOP',2025,2]],reviewed_coverage_refs=[['LAL',2022,1],['CLE',2022,2],['NOP',2025,2]],source_crosschecks=['https://www.hoopsrumors.com/2021/09/traded-first-round-picks-for-2022-nba-draft.html','https://en.wikipedia.org/wiki/List_of_2021%E2%80%9322_NBA_season_transactions'])
 chain(7,'DAL_KP_2019','DAL','NYK',[2023,2024,2025],[10,10,10],[2025])
 chain(26,'GSW_IGUODALA_2019','GSW','MEM',[2024,2025,2026],[4,1,0])
 chain(32,'MIA_PG_ORIGINAL_2019','MIA','OKC',[2023,2024,2025,2026],[14,14,14,0])
 chain(33,'HOU_WESTBROOK_2024','HOU','OKC',[2024],[4],[2024,2025])
 chain(33,'HOU_WESTBROOK_2026','HOU','OKC',[2026],[4],[2026])
 chain(41,'PHX_CP3_2020','PHX','OKC',[2022,2023,2024,2025],[12,10,8,0])
 chain(92,'DET_SENGUN_2021','DET','OKC',[2022,2023,2024,2025,2026,2027],[16,18,18,13,11,9],[2027])
 chain(92,'WAS_SENGUN_2021','WAS','OKC',[2023,2024,2025,2026],[14,12,10,8],[2026,2027])
 chain(67,'PHI_HORFORD_2020','PHI','OKC',[2025,2026,2027],[6,4,4],[2027])
 chain(90,'CHA_KAI_JONES_2021','CHA','NYK',[2022,2023,2024,2025],[18,16,14,14],[2026,2027])
 chain(111,'POR_NANCE_2021','POR','CHI',list(range(2022,2029)),[14]*7,[2028])
 # Each transferred chain was re-traded to its final holder by the cutoff.
 # This baseline directly names that holder, avoiding artificial intermediate
 # assets. Other references in the same recipient leg remain in the queue.
 # Explicit retained ownership is supported by the March2021 return of the
 # Bucks' previously owed2022first, rather than a default-own assumption.
 own=[{'pick':['MIL',2022,1],'owner':'MIL','status':'documented_return_of_own_pick','source':byidx[74]['source'],'known_from':byidx[74]['date']}]
 # Retained own picks at the far end of the seven-year horizon can be
 # adjudicated without extrapolating today's inventory backward. All completed
 # 2020/2021 transactions and original protected endpoints were reviewed. A
 # pre2020 trade cannot reach2027, and a pre2021 trade cannot reach2028.
 # 2028first: Portland's2021Nance chain is the only outgoing first claim.
 # 2028seconds: WAS was traded outright; CHI/POR/UTA are contingent fallbacks.
 proof_sources=[f'https://basketball.realgm.com/nba/transactions/league/{y}'for y in(2020,2021,2022)]
 for year,rnd,exceptions in [(2028,1,{'POR'}),(2028,2,{'WAS','CHI','POR','UTA'}),(2027,1,{'BKN','HOU','CHI','MIL','DET','PHI','DEN','POR'})]:
  for team in sorted(TEAMS-exceptions):
   own.append(dict(pick=[team,year,rnd],owner=team,status='documented_no_outgoing_claim_in_complete_eligible_window',source=proof_sources,known_from=ASOF,proof='Complete eligible-window trade-register review plus original protected-chain endpoints; absence of claim is not inferred from current inventory.'))
 transfer(97,'WAS',2028,2,'LAL')
 from reviewed_chi_den import rules as more_chains
 from reviewed_first_swaps import rules as first_swaps
 from second_basket_baseline import build_rules as second_baskets
 from reviewed_second_straight import rules as more_seconds
 from reviewed_legacy_seconds import rules as legacy_seconds
 rules.extend(more_chains(candidates))
 rules.extend(first_swaps(candidates))
 rules.extend(second_baskets())
 rules.extend(more_seconds(candidates))
 rules.extend(legacy_seconds(candidates))
 for r in rules:r.update(baseline_only=True,baseline_asof=ASOF)
 def refs(r):
  if r.get('reviewed_coverage_refs'):return [tuple(p)for p in r['reviewed_coverage_refs']]
  if r.get('covered_refs'):return [tuple(p)for p in r['covered_refs']]
  if r['kind']=='protected_chain':return [tuple(b['pick'])for b in r['branches']]+[tuple(p)for p in r['fallback_picks']]
  if r['kind']=='transfer':return [tuple(r['pick'])]
  if r['kind']=='forfeit_next_available_second':return [tuple(p)for p in r['allowed_candidates']]
  raise ValueError('Rule missing explicit coverage refs '+r['rule_id'])
 resolved_refs={p for r in rules for p in refs(r)}
 resolved_refs.update(tuple(r['pick'])for r in own)
 retained_audit=None
 if register_events is not None:
  from retained_own_audit import audit as own_audit
  from reviewed_legacy_settlements_a import resolved_claims as settled_a
  from reviewed_legacy_settlements_b import resolved_claims as settled_b
  from reviewed_legacy_settlements_c import resolved_claims as settled_c
  retained_audit=own_audit(register_events,resolved_refs,settled_a()+settled_b()+settled_c())
  own.extend(retained_audit['confirmed_retained_own'])
  resolved_refs.update(tuple(r['pick'])for r in own)
 # Next-available penalties can only be attached after all earlier ownership
 # is proven. Raw allocator initialization is not evidence of availability.
 universe={(t,y,rnd)for t in TEAMS for y in range(2022,2029)for rnd in(1,2)}
 baseline_closed=register_events is not None and universe<=resolved_refs
 if baseline_closed:
  from forfeiture_rules import penalty_rules
  penalties=[r for r in penalty_rules()if r['known_from']<=ASOF]
  penalty_refs={p for r in penalties for p in refs(r)}
  for r in penalties:r.update(baseline_only=True,baseline_asof=ASOF)
  rules.extend(penalties)
  own=[r for r in own if tuple(r['pick'])not in penalty_refs]
 for c in candidates:
  if c['idx']==104:continue # RetrospectiveLAC label correctedtoSAC2022byoriginaldatedsource.
  remaining=[]
  for p in c['refs']:
   ref=(p['origin_team'],p['draft_year'],p['round'])
   # A first reviewed above does not resolve unrelated second-round baskets
   # appearing in the same trade. A swap flag also cannot become a full pick.
   if ref not in resolved_refs:remaining.append(p)
  if remaining:
   terms=' '.join(c['terms']).lower()
   reasons=[]
   if 'swap'in terms:reasons.append('swap_or_nested_basket_requires_rule')
   if 'higher'in terms or 'lower'in terms or 'favorable'in terms:reasons.append('ranked_basket_requires_joint_partition')
   if 'two years'in terms:reasons.append('prior_obligation_gap_dependency')
   if any(p['protected']or p['conditional']for p in remaining):reasons.append('protection_or_fallback_requires_rule')
   if not reasons:reasons.append('latest_transfer_chain_requires_source_reconciliation')
   unresolved.append(dict(candidate_index=c['idx'],date=c['date'],recipient=c['team'],references=remaining,original_terms=c['terms'],reasons=reasons,source=c['source']))
 ledger=[]
 for team in sorted(TEAMS):
  physical=[]
  for y in range(2022,2029):
   for rnd in [1,2]:
    p=(team,y,rnd);linked=[r['rule_id']for r in rules if p in refs(r)]
    retained=next((r for r in own if tuple(r['pick'])==p),None)
    physical.append(dict(pick=list(p),status='reviewed_allocation_component'if linked else 'documented_retained_own'if retained else'unresolved_no_default_own_claim',rule_ids=linked,retained_evidence=retained))
  ledger.append(dict(origin_team=team,physical_picks=physical,complete=baseline_closed))
 return dict(asof=ASOF,status='adjudicated_opening_baseline'if baseline_closed else'partial_adjudicated_baseline',complete=baseline_closed,method='Physical picks are allocated per joint outcome; unknown is not own and not zero. Known next-available forfeitures attach only after opening ownership is closed.',rules=rules,documented_retained_own=own,origin_ledgers=ledger,unresolved_candidates=unresolved,retained_own_audit=retained_audit)

def validate(data):
 # Deliberately exercise top-of-lottery protection, conveyance and crossover
 # paths. All physical picks remain conserved; these are structural checks,
 # not league inventory totals because opening ownership remains incomplete.
 from pick_allocator import compile_choice_policies
 draws=[]
 for seed in range(200):
  rng=random.Random(seed);slots={}
  for y in range(2022,2029):
   order=list(sorted(TEAMS));rng.shuffle(order)
   for i,t in enumerate(order):slots[(t,y,1)]=i+1;slots[(t,y,2)]=i+31
  draws.append(slots)
 compiled=compile_choice_policies(data['rules'],draws,{i:100-i for i in range(1,61)})
 for seed,slots in enumerate(draws):
  out=allocate(slots,compiled,ASOF);assert len(out)==420
  for r in data['rules']:
   if r['kind']=='protected_chain':
    k=[tuple(b['pick'])for b in r['branches']]
    assert sum(out[p]==r['to_team']for p in k)<=1,(r['rule_id'],seed)
 return dict(random_joint_outcomes_checked=200,physical_picks_per_outcome=420,conservation_passed=True,full_ownership_complete=data['complete'])

def main():
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--candidates',type=Path);g.add_argument('--evidence',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--registers',type=Path);a=p.parse_args();candidates=json.loads(a.candidates.read_text())if a.candidates else candidates_from_evidence(json.loads(a.evidence.read_text()));d=build(candidates,json.loads(a.registers.read_text())if a.registers else None);checks=validate(d);a.output.mkdir(parents=True,exist_ok=True)
 (a.output/'opening_2021_12_31_partial_ledger.json').write_text(json.dumps(d,indent=2));(a.output/'opening_2021_validation.json').write_text(json.dumps(checks,indent=2))
 audit=d.get('retained_own_audit')or{};queue={}
 for row in audit.get('unresolved_legacy_or_origin_claims',[]):
  for blocker in row['blockers']:
   key=(blocker['date'],blocker['source'],blocker['source_text'])
   item=queue.setdefault(key,dict(date=key[0],source=key[1],text=key[2],affected_refs=[]))
   if row['pick']not in item['affected_refs']:item['affected_refs'].append(row['pick'])
 (a.output/'remaining_opening_settlement_families.json').write_text(json.dumps(list(queue.values()),indent=2))
 (a.output/'remaining_opening_unknown_physical.json').write_text(json.dumps([row['pick']for row in audit.get('unresolved_legacy_or_origin_claims',[])],indent=2))
 print(json.dumps({'rules':len(d['rules']),'reviewed_physical_components':sum(p['status']=='reviewed_allocation_component'for t in d['origin_ledgers']for p in t['physical_picks']),'retained_own_documented':len(d['documented_retained_own']),'unresolved_candidates':len(d['unresolved_candidates']),'unresolved_physical_components':sum(p['status'].startswith('unresolved')for t in d['origin_ledgers']for p in t['physical_picks']),**checks},indent=2))
if __name__=='__main__':main()
