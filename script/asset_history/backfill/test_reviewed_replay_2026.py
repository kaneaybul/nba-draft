import unittest
from copy import deepcopy
from reviewed_replay_2026 import actions,p
from reviewed_swaps_2026 import apply_selected_swap
from reviewed_transfer_helpers import apply_selected_transfer


class Replay2026Tests(unittest.TestCase):
    def event_rules(self,eid):return [a['rule'] for a in actions() if a['event_id']==eid and a['kind']=='add_rule']
    def test_repeatable_actions(self):self.assertEqual(actions(),actions())
    def test_no_unreviewed_or_unresolved(self):
        a=actions();self.assertFalse([r for r in a if r['kind']=='unresolved'])
        self.assertTrue(all(r['reviewed']and r['source']for r in a))
    def test_brown_first_conveys_without_swap(self):
        rules=self.event_rules('L13956')[-2:]
        slots={tuple(p(t,2028,1)):v for t,v in [('LAC',20),('PHI',4),('BOS',23),('SAS',10)]}
        owners={tuple(p(t,2028,1)):o for t,o in [('LAC','PHI'),('PHI','PHI'),('BOS','BOS'),('SAS','SAS')]}
        apply_selected_transfer(owners,slots,rules[0]);apply_selected_swap(owners,slots,rules[1])
        self.assertEqual(owners[tuple(p('LAC',2028,1))],'BOS');self.assertEqual(owners[tuple(p('PHI',2028,1))],'PHI')
    def test_brown_converts_and_can_use_protected_phi(self):
        rules=self.event_rules('L13956')[-2:]
        slots={tuple(p(t,2028,1)):v for t,v in [('LAC',12),('PHI',4),('BOS',23),('SAS',10)]}
        owners={tuple(p(t,2028,1)):o for t,o in [('LAC','PHI'),('PHI','PHI'),('BOS','BOS'),('SAS','SAS')]}
        apply_selected_transfer(owners,slots,rules[0]);apply_selected_swap(owners,slots,rules[1])
        self.assertEqual(owners[tuple(p('PHI',2028,1))],'BOS');self.assertEqual(owners[tuple(p('BOS',2028,1))],'PHI')
        self.assertEqual(owners[tuple(p('LAC',2028,1))],'PHI')
    def test_brown_does_not_take_brooklyn_owed_phi(self):
        rules=self.event_rules('L13956')[-2:]
        slots={tuple(p(t,2028,1)):v for t,v in [('LAC',12),('PHI',9),('BOS',23),('SAS',10)]}
        owners={tuple(p(t,2028,1)):o for t,o in [('LAC','PHI'),('PHI','BKN'),('BOS','BOS'),('SAS','SAS')]}
        apply_selected_transfer(owners,slots,rules[0]);apply_selected_swap(owners,slots,rules[1])
        self.assertEqual(owners[tuple(p('LAC',2028,1))],'BOS');self.assertEqual(owners[tuple(p('PHI',2028,1))],'BKN')
    def test_brown_respects_prior_boston_number_one_protection(self):
        rules=self.event_rules('L13956')[-2:]
        slots={tuple(p(t,2028,1)):v for t,v in [('LAC',12),('PHI',4),('BOS',1),('SAS',23)]}
        owners={tuple(p(t,2028,1)):o for t,o in [('LAC','PHI'),('PHI','PHI'),('BOS','BOS'),('SAS','SAS')]}
        before=deepcopy(owners)
        apply_selected_transfer(owners,slots,rules[0]);apply_selected_swap(owners,slots,rules[1])
        self.assertEqual(owners,before)
    def test_collins_conveys_best_held_right_without_stealing_phi_pick(self):
        rule=self.event_rules('L14013')[0]
        slots={tuple(p(t,2028)):v for t,v in [('DET',56),('CHA',59),('LAC',58),('MIA',60),('NYK',57)]}
        owners={tuple(p(t,2028)):o for t,o in [('DET','PHI'),('CHA','CHA'),('LAC','DET'),('MIA','UTA'),('NYK','DET')]}
        apply_selected_transfer(owners,slots,rule)
        self.assertEqual(owners[tuple(p('DET',2028))],'PHI')
        self.assertEqual(owners[tuple(p('NYK',2028))],'LAC')
        self.assertEqual(owners[tuple(p('LAC',2028))],'DET')
    def test_collins_protection_is_on_best_entitlement(self):
        rule=self.event_rules('L14013')[0]
        slots={tuple(p(t,2028)):v for t,v in [('DET',56),('CHA',59),('LAC',58),('MIA',60),('NYK',42)]}
        owners={tuple(p(t,2028)):o for t,o in [('DET','PHI'),('CHA','CHA'),('LAC','DET'),('MIA','UTA'),('NYK','DET')]}
        before=deepcopy(owners);apply_selected_transfer(owners,slots,rule)
        self.assertEqual(owners,before)
    def test_mccain_does_not_take_harden_worst_pick(self):
        rule=self.event_rules('L12894')[0]
        slots={tuple(p(t,2026,1)):v for t,v in [('HOU',28),('OKC',26),('LAC',12)]}
        owners={tuple(p(t,2026,1)):o for t,o in [('HOU','WAS'),('OKC','OKC'),('LAC','OKC')]}
        apply_selected_transfer(owners,slots,rule)
        self.assertEqual(owners[tuple(p('HOU',2026,1))],'WAS')
        self.assertEqual(owners[tuple(p('OKC',2026,1))],'PHI')
        self.assertEqual(owners[tuple(p('LAC',2026,1))],'OKC')
    def test_mccain_receives_middle_even_when_houston_is_best(self):
        rule=self.event_rules('L12894')[0]
        slots={tuple(p(t,2026,1)):v for t,v in [('HOU',6),('OKC',26),('LAC',12)]}
        owners={tuple(p(t,2026,1)):o for t,o in [('HOU','OKC'),('OKC','WAS'),('LAC','OKC')]}
        apply_selected_transfer(owners,slots,rule)
        self.assertEqual(owners[tuple(p('LAC',2026,1))],'PHI')
        self.assertEqual(owners[tuple(p('HOU',2026,1))],'OKC')
    def test_mccain_receives_first_when_houston_protected(self):
        rule=self.event_rules('L12894')[0]
        slots={tuple(p(t,2026,1)):v for t,v in [('HOU',2),('OKC',26),('LAC',12)]}
        owners={tuple(p(t,2026,1)):o for t,o in [('HOU','HOU'),('OKC','WAS'),('LAC','OKC')]}
        apply_selected_transfer(owners,slots,rule)
        self.assertEqual(owners[tuple(p('LAC',2026,1))],'PHI')
        self.assertEqual(owners[tuple(p('HOU',2026,1))],'HOU')
    def test_guard_rejects_unowned_swap(self):
        rule=self.event_rules('L14029')[0]
        slots={tuple(p(t,2028,1)):v for t,v in [('CLE',10),('UTA',23),('LAL',5)]}
        owners={tuple(p(t,2028,1)):t for t in ['CLE','UTA','LAL']}
        owners[tuple(p('LAL',2028,1))]='DAL'
        with self.assertRaises(ValueError):apply_selected_swap(owners,slots,rule)
    def test_forfeit_only_original_five_physical_claims(self):
        rules=self.event_rules('NBA_2026_09_02_LAC_FORFEIT')
        picks={tuple(r['picks'][0])for r in rules}
        self.assertEqual(picks,{('IND',2029,1),*[('LAC',y,1)for y in range(2030,2034)]})
        self.assertFalse(any(r.get('picks',[[]])[0][0]=='TOR' for r in rules))
    def test_dosunmu_fourth_pick_not_phantom_chi_swap(self):
        rules=self.event_rules('L12908')
        self.assertEqual(len(rules),4)
        self.assertEqual(rules[-1]['from_team'],'MIN');self.assertEqual(rules[-1]['to_team'],'CHI')

if __name__=='__main__':unittest.main()
