import unittest
from copy import deepcopy
from pick_allocator import allocate
from reviewed_replay_2023 import actions,p


def rules_for(eid):
    return [a['rule'] for a in actions() if a['event_id']==eid and a['kind']=='add_rule']


def transfer(origin,year,rnd,source,target,order=0):
    return dict(rule_id=f'fixture_{origin}_{target}_{year}_{rnd}',known_from='2021-01-01',order=order,
                reviewed=True,source='fixture://prior-reviewed-right',kind='transfer',
                pick=p(origin,year,rnd),from_team=source,to_team=target)


class Dated2023Terms(unittest.TestCase):
    def test_every_catalogued_2023_event_has_an_action(self):
        import json
        from pathlib import Path
        catalog=Path(__file__).resolve().parents[4]/'league_backfill/picks/dated_pick_event_evidence.json'
        if not catalog.exists():self.skipTest('Source catalog is not installed in this checkout')
        expected={e['event_id'] for e in json.loads(catalog.read_text()) if e['known_from'].startswith('2023')}
        self.assertFalse(expected-{a['event_id'] for a in actions()})
        self.assertFalse([a for a in actions() if a['kind']=='unresolved'])

    def test_hart_unknown_fallback_is_explicit_economic_assumption(self):
        claim=next(a for a in actions() if a['kind']=='add_economic_claim')
        self.assertEqual(claim['known_until'],'2023-04-02')
        self.assertEqual(claim['claim']['count'],4)
        self.assertEqual(claim['claim']['quote_distribution']['slots'],list(range(31,61)))
        self.assertAlmostEqual(sum(claim['claim']['quote_distribution']['probabilities']),1)
        first=rules_for('L04294')[0]
        self.assertEqual(first['fallback_picks'],[])

    def test_bey_only_transfers_2025_retained_top40(self):
        rules=[r for r in rules_for('L04293') if r.get('kind')=='protected_chain' and r['branches'][0]['pick'][1]==2025]
        self.assertEqual(len(rules),1)
        for slot,expected in [(31,'POR'),(40,'POR'),(41,'ATL'),(60,'ATL')]:
            got=allocate({('ATL',2025,2):slot},rules,'2023-02-28')
            self.assertEqual(got[('ATL',2025,2)],expected)

    def test_brooklyn_improves_worse_owned_2028_first(self):
        rule=next(r for r in rules_for('L04291') if r['kind']=='holder_pool_swap')
        prior=transfer('PHI',2028,1,'PHI','BKN')
        slots={('BKN',2028,1):5,('PHI',2028,1):19,('PHX',2028,1):10}
        got=allocate(slots,[prior,rule],'2023-02-28')
        self.assertEqual(got[('BKN',2028,1)],'BKN')
        self.assertEqual(got[('PHX',2028,1)],'BKN')
        self.assertEqual(got[('PHI',2028,1)],'PHX')
        # With no conveyedPhiladelphiafirst, Brooklyn improves only its own.
        got=allocate(slots,[rule],'2023-02-28')
        self.assertEqual(got[('PHI',2028,1)],'PHI')

    def test_harden_2024_second_chooses_only_lac_owned_entitlements(self):
        rule=next(r for r in rules_for('L06254') if r['kind']=='ranked_transfer' and r['picks'][0][1]==2024)
        prior=[transfer('TOR',2024,2,'TOR','LAC'),transfer('CLE',2024,2,'CLE','NYK'),
               transfer('IND',2024,2,'IND','LAC')]
        slots={('TOR',2024,2):36,('CLE',2024,2):32,('IND',2024,2):49,('UTA',2024,2):40}
        got=allocate(slots,[*prior,rule],'2023-11-30')
        self.assertEqual(got[('CLE',2024,2)],'NYK')
        self.assertEqual(got[('TOR',2024,2)],'PHI')
        self.assertEqual(got[('IND',2024,2)],'LAC')

    def test_grant_williams_swaps_boston_existing_entitlement(self):
        rule=next(r for r in rules_for('L05383') if r.get('rule_id')=='L05383_BOS_DAL2025_SECOND_SWAP')
        slots={('DET',2025,2):33,('GSW',2025,2):49,('WAS',2025,2):42,('DAL',2025,2):31}
        prior=[transfer('DET',2025,2,'DET','BOS')]
        got=allocate(slots,[*prior,rule],'2023-07-31')
        self.assertEqual(got[('DAL',2025,2)],'BOS')
        self.assertEqual(got[('DET',2025,2)],'DAL')
        self.assertEqual(len(got),4)

    def test_crowder_sends_one_better_of_two_mil_entitlements(self):
        rule=next(r for r in rules_for('L04291') if r['kind']=='ranked_transfer')
        prior=[transfer('CLE',2023,2,'CLE','MIL')]
        for own_slot,cle_slot in [(60,55),(48,58)]:
            slots={('CLE',2023,2):cle_slot,('GSW',2023,2):50,('MIL',2023,2):own_slot}
            got=allocate(slots,[*prior,rule],'2023-02-28')
            self.assertEqual(sum(o=='IND' for o in got.values()),1)
            self.assertEqual(got[min([('MIL',2023,2),('CLE',2023,2)],key=lambda k:slots[k])],'IND')

    def test_phoenix_penalty_removes_held_denver_second(self):
        rule=rules_for('NBA_2023_10_25_PHX_PENALTY')[0]
        prior=transfer('DEN',2024,2,'DEN','PHX')
        slots={('DEN',2024,2):52}
        self.assertEqual(allocate(slots,[prior,rule],'2023-10-24')[('DEN',2024,2)],'PHX')
        self.assertEqual(allocate(slots,[prior,rule],'2023-10-25')[('DEN',2024,2)],'FORFEITED')

    def test_prior_new_york_claim_can_extinguish_beal_swap(self):
        rule=next(r for r in rules_for('L04889') if r['rule_id']=='L04889_WAS_PHX_2026_RESIDUAL_SWAP')
        slots={('WAS',2026,1):9,('PHX',2026,1):2}
        prior=transfer('WAS',2026,1,'WAS','NYK')
        got=allocate(slots,[prior,rule],'2023-07-31')
        self.assertEqual(got[('WAS',2026,1)],'NYK')
        self.assertEqual(got[('PHX',2026,1)],'PHX')

    def test_portland_chicago_obligation_takes_priority_over_lillard_swap(self):
        rule=next(r for r in rules_for('L05617') if r['rule_id']=='L05617_POR_MIL2028_FIRST_SWAP')
        slots={('POR',2028,1):25,('MIL',2028,1):4}
        prior=transfer('POR',2028,1,'POR','CHI')
        got=allocate(slots,[prior,rule],'2023-10-31')
        self.assertEqual(got[('POR',2028,1)],'CHI')
        self.assertEqual(got[('MIL',2028,1)],'MIL')


if __name__=='__main__':unittest.main()
