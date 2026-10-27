"""Allocate physical picks once per joint lottery outcome.

A rule must be source-adjudicated before use. Free text from the evidence
collectors is deliberately not accepted as a legal rule. Expected team value is
then the average of its allocated physical picks; swaps are never extra picks.
"""
from __future__ import annotations
from collections import defaultdict
from copy import deepcopy
from datetime import date
import math

TEAMS=set('ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS'.split())

def ref(v):
    origin,year,rnd=v
    if origin not in TEAMS or int(rnd)not in(1,2):raise ValueError('Invalid physical pick')
    return origin,int(year),int(rnd)

def guarded_transfer(owners,pick,source,target):
    pick=ref(pick)
    if pick not in owners:raise ValueError('Rule references a physical pick outside the supplied horizon')
    if target not in TEAMS|{'FORFEITED'}:raise ValueError('Invalid recipient')
    if owners[pick]!=source:raise ValueError(f'Chain owner mismatch for {pick}: {owners[pick]} != {source}')
    owners[pick]=target

def eligible(branch,slots):
    pick=ref(branch['pick']);slot=slots[pick]
    return not any(int(lo)<=slot<=int(hi)for lo,hi in branch.get('protected_ranges',[]))

def allocate(slots,rules,asof,condition_slots=None):
    """Return one owner for every supplied physical pick in one joint outcome.

    slots maps (origin, year, round) to overall slot. All connected components
    of a protected chain must be provided, even outside a displayed year range.
    A later caller can limit valuation to its reporting/trading horizon.
    """
    date.fromisoformat(asof);slots={ref(k):int(v)for k,v in slots.items()}
    if any(not(1<=v<=30 if k[2]==1 else 31<=v<=60)for k,v in slots.items()):raise ValueError('Slot is inconsistent with round')
    if condition_slots is not None:
        if set(condition_slots)!=set(slots):raise ValueError('Condition-slot universe differs')
        slots={p:int(condition_slots[p])for p in slots}
    owners={k:k[0]for k in slots};settled_first_year={}
    for rule in sorted(rules,key=lambda r:(r['known_from'],r['order'])):
        if rule.get('baseline_only') and asof<rule['baseline_asof']:raise ValueError('Collapsed opening rules cannot reconstruct dates before their baseline')
        if rule['known_from']>asof or (rule.get('known_until')and asof>=rule['known_until']):continue
        if rule.get('reviewed')is not True or not rule.get('source'):raise ValueError('Unreviewed or unsourced legal rule')
        kind=rule['kind']
        if kind=='transfer':guarded_transfer(owners,rule['pick'],rule['from_team'],rule['to_team'])
        elif kind=='entitlement_transfer':
            picks=[ref(p)for p in rule['picks']]
            if len(picks)!=len(set(picks))or any(p not in owners for p in picks):raise ValueError('Invalid entitlement footprint')
            held=[p for p in picks if owners[p]==rule['from_team']]
            lo,hi=rule.get('count_range',[0,len(picks)])
            if not lo<=len(held)<=hi:raise ValueError('Transferred entitlement count outside reviewed bounds')
            for p in held:guarded_transfer(owners,p,rule['from_team'],rule['to_team'])
        elif kind=='ranked_transfer':
            from reviewed_transfer_helpers import apply_ranked_transfer
            apply_ranked_transfer(owners,slots,rule)
        elif kind=='selected_transfer':
            from reviewed_transfer_helpers import apply_selected_transfer
            apply_selected_transfer(owners,slots,rule)
        elif kind=='selected_swap':
            from reviewed_swaps_2026 import apply_selected_swap
            apply_selected_swap(owners,slots,rule)
        elif kind=='protected_chain':
            dependency=rule.get('requires_gap_after_rule')
            if dependency is not None and dependency not in settled_first_year:raise ValueError('Protected chain dependency must be allocated first')
            prior_year=settled_first_year.get(dependency)if dependency is not None else None
            gap=int(rule.get('minimum_gap_years',2))
            chosen=next((b for b in rule['branches']if not(rule.get('requires_prior_conveyance')and prior_year is None)and(prior_year is None or ref(b['pick'])[1]>=prior_year+gap)and eligible(b,slots)),None)
            settled_first_year[rule.get('rule_id')]=ref(chosen['pick'])[1]if chosen is not None else None
            if chosen is not None:guarded_transfer(owners,chosen['pick'],rule['from_team'],rule['to_team'])
            else:
                for fallback in rule.get('fallback_picks',[]):guarded_transfer(owners,fallback,rule['from_team'],rule['to_team'])
        elif kind=='swap':
            left,right=ref(rule['left_pick']),ref(rule['right_pick'])
            if eligible({'pick':right,'protected_ranges':rule.get('protected_ranges',[])},slots):
                if owners[left]!=rule['left_owner']or owners[right]!=rule['right_owner']:raise ValueError('Swap owner mismatch')
                if slots[right]<slots[left]:owners[left],owners[right]=owners[right],owners[left]
            else:
                for p in rule.get('fallback_picks',[]):guarded_transfer(owners,p,rule['right_owner'],rule['left_owner'])
        elif kind=='best_option_swap':
            left=ref(rule['left_pick']);owner=rule['left_owner']
            if owners[left]!=owner:raise ValueError('Option swap left owner mismatch')
            options=[]
            for b in rule['options']:
                p=ref(b['pick'])
                if owners[p]!=b['owner']:raise ValueError('Option swap candidate owner mismatch')
                if eligible(b,slots):options.append(p)
            right=min([left,*options],key=lambda p:(slots[p],p))
            if right!=left and slots[right]<slots[left]:owners[left],owners[right]=owners[right],owners[left]
        elif kind=='holder_swap':
            lefts=[ref(p)for p in rule['left_pool']if owners[ref(p)]==rule['left_owner']]
            if len(lefts)!=1:raise ValueError('Dynamic holder swap requires exactly one held physical pick')
            left=lefts[0];right=ref(rule['right_pick'])
            if owners[right]!=rule['right_owner']:raise ValueError('Dynamic holder right owner mismatch')
            if slots[right]<slots[left]:owners[left],owners[right]=owners[right],owners[left]
        elif kind=='holder_pool_swap':
            lefts=[ref(p)for p in rule['left_pool']if owners[ref(p)]==rule['left_owner']]
            rights=[ref(p)for p in rule['right_pool']if owners[ref(p)]==rule['right_owner']]
            selected=[]
            for picks,rank in [(lefts,rule.get('left_rank')),(rights,rule.get('right_rank'))]:
                if not picks or(rank is None and len(picks)!=1):raise ValueError('Pool swap requires exactly one held pick unless a reviewed rank is supplied')
                if rank not in(None,'best','worst'):raise ValueError('Invalid pool swap rank')
                selected.append((max if rank=='worst'else min)(picks,key=lambda p:(slots[p],p)))
            left,right=selected
            if eligible({'pick':right,'protected_ranges':rule.get('protected_ranges',[])},slots):
                if slots[right]<slots[left]:owners[left],owners[right]=owners[right],owners[left]
            else:
                for p in rule.get('fallback_picks',[]):guarded_transfer(owners,p,rule['right_owner'],rule['left_owner'])
        elif kind=='deferred_choice':
            early=ref(rule['earlier_pick']);late=ref(rule['later_pick'])
            policy=rule.get('decision_by_slot')
            if policy is None:raise ValueError('Deferred choice requires an ex ante decision policy before allocation')
            choice=early if policy[str(slots[early])]=='earlier'else late
            guarded_transfer(owners,choice,rule['from_team'],rule['to_team'])
        elif kind=='selector_partition':
            from second_basket_baseline import apply_selector_partition
            apply_selector_partition(owners,slots,rule)
        elif kind=='forfeit_next_available_second':
            from forfeiture_rules import apply_forfeiture
            apply_forfeiture(owners,slots,rule)
        elif kind=='partition':
            picks=[ref(p)for p in rule['picks']]
            if len(picks)!=len(set(picks))or len(picks)!=len(rule['owners_by_rank']):raise ValueError('Partition does not conserve physical picks')
            expected={ref(p):o for p,o in rule['expected_owners']}
            if any(owners[p]!=expected[p]for p in picks):raise ValueError('Partition owner mismatch')
            for pick,owner in zip(sorted(picks,key=lambda p:(slots[p],p)),rule['owners_by_rank']):
                if owner not in TEAMS:raise ValueError('Invalid partition recipient')
                owners[pick]=owner
        else:raise ValueError('Unsupported legal rule kind '+kind)
    assert len(owners)==len(slots)and set(owners)==set(slots)
    return owners

def pick_quote(quotes,rnd,slot,first_forfeitures=0):
    if callable(quotes):return float(quotes(rnd,slot,first_forfeitures))
    if first_forfeitures:raise ValueError('First-round forfeitures require a round-aware quote callback')
    return float(quotes[slot])

def expected_values(draws,rules,asof,quote_by_slot,display_years,forfeiture_lottery_verified_years=()):
    """Keep correlation of lottery slots, protections and swaps in every draw."""
    draws=list(draws);rules=compile_choice_policies(rules,draws,quote_by_slot)
    sums=defaultdict(float);n=0;global_total=0.
    for slots in draws:
        owners=allocate(slots,rules,asof);by_team=dict.fromkeys(TEAMS,0.)
        removed=[p for p,o in owners.items()if o=='FORFEITED']
        first_counts={y:sum(p[1]==y and p[2]==1 for p in removed)for y in {p[1]for p in slots}}
        if any(first_counts.values()):
            from forfeiture_rules import lottery_policy_status
            for year,count in first_counts.items():
                if count and year in display_years:
                    status=lottery_policy_status(year,count)
                    if not status['verified']:raise ValueError('Unverified first-forfeiture lottery policy: '+str(year))
                    if year not in forfeiture_lottery_verified_years:raise ValueError('Joint draws must incorporate first-round forfeitures before the lottery: '+str(year))
        if removed:
            from forfeiture_rules import effective_slots_after_forfeitures
            actual_slots=effective_slots_after_forfeitures(owners,slots)
        else:actual_slots=slots
        for p,owner in owners.items():
            if p[1]not in display_years or owner=='FORFEITED':continue
            value=pick_quote(quote_by_slot,p[2],actual_slots[p],first_counts[p[1]])
            if not math.isfinite(value):raise ValueError('Nonfinite pick quote')
            by_team[owner]+=value
        for team,value in by_team.items():sums[team]+=value
        global_total+=sum(by_team.values());n+=1
    if not n:raise ValueError('No joint slot outcomes')
    values={team:sums[team]/n for team in sorted(TEAMS)}
    if not math.isclose(sum(values.values()),global_total/n,abs_tol=.001):raise AssertionError('League pick value conservation failed')
    return values


def compile_choice_policies(rules,draws,quote_by_slot):
    """Defer using next-year EV conditional on the observed earlier slot.

    This slot-only information approximation never compares the two realized
    draw values. A future published choice replaces the modeled policy by date.
    """
    result=deepcopy(rules)
    for r in result:
        if r['kind']!='deferred_choice'or r.get('decision_by_slot')is not None:continue
        early,late=ref(r['earlier_pick']),ref(r['later_pick']);groups=defaultdict(list);all_values=[]
        for slots in draws:
            value=pick_quote(quote_by_slot,late[2],slots[late]);groups[slots[early]].append(value);all_values.append(value)
        if not all_values:raise ValueError('No simulated outcomes for deferral policy')
        fallback=sum(all_values)/len(all_values);policy={};thresholds={}
        for slot in range(1,31):
            expected=sum(groups[slot])/len(groups[slot])if groups[slot]else fallback
            thresholds[str(slot)]=expected;policy[str(slot)]='earlier'if pick_quote(quote_by_slot,early[2],slot)>=expected else'later'
        r.update(decision_by_slot=policy,conditional_later_EV_by_earlier_slot=thresholds,decision_policy='Earlier-slot conditional later-pick EV; fallback to unconditional simulated EV for unobserved slots. No draw-specific later outcome is used.')
    return result
