import unittest
from reviewed_replay_2022 import actions,p
from pick_allocator import allocate
from pick_replay import active_rules

class Replay2022Tests(unittest.TestCase):
 def event_rules(self,eid):return [a['rule'] for a in actions() if a['event_id']==eid and a['kind']=='add_rule']
 def test_oni_removes_existing_favors_fallback_before_unconditional_transfer(self):
  aa=[a for a in actions()if a['event_id']=='L00922'];self.assertEqual(aa[0]['kind'],'patch_rule');self.assertEqual(aa[0]['changes'][0]['value'],[])
  self.assertEqual(aa[1]['rule']['picks'],[p('UTA',2028)])
 def test_white_fallback_never_uses_boston_own_second(self):
  rr=self.event_rules('L01441');first=next(r for r in rr if r['rule_id']=='BOS_WHITE_2022_FIRST');self.assertEqual(first['fallback_picks'],[])
  fallback=next(r for r in rr if r['kind']=='selected_transfer' and 'held' in r['select']);self.assertNotIn(p('BOS',2023),fallback['select']['held']['picks'])
 def test_harrell_preserves_complementary_second(self):
  r=self.event_rules('L01449')[0]
  slots={('BOS',2023,2):40,('BOS',2024,2):58}
  intro=[dict(rule_id='prior'+str(y),kind='transfer',known_from='2020-11-29',order=y,reviewed=True,source='NBA Hayward release',pick=p('BOS',y),from_team='BOS',to_team='CHA')for y in [2023,2024]]
  own=allocate(slots,intro+[r],'2022-02-28');self.assertEqual(own['BOS',2023,2],'CHA');self.assertEqual(own['BOS',2024,2],'WAS')
  slots['BOS',2023,2]=57;own=allocate(slots,intro+[r],'2022-02-28');self.assertEqual(own['BOS',2023,2],'WAS');self.assertEqual(own['BOS',2024,2],'CHA')
 def test_mccollum_2022_first_is_five_to_fourteen(self):
  r=next(r for r in self.event_rules('L01419')if r['kind']=='protected_chain')
  for slot in [4,5,14,15]:
   intro=dict(rule_id='prior',kind='transfer',known_from='2020-11-24',order=1,reviewed=True,source='NBA Jrue release',pick=p('MIL',2025,1),from_team='MIL',to_team='NOP')
   own=allocate({('NOP',2022,1):slot,('MIL',2025,1):20},[intro,r],'2022-02-28');self.assertEqual(own['NOP',2022,1]=='POR',5<=slot<=14);self.assertEqual(own['MIL',2025,1]=='POR',not 5<=slot<=14)
 def test_gobert_swap_disappears_when_utah_own_is_owed(self):
  r=next(r for r in self.event_rules('L02369')if r['kind']=='selected_swap')
  prior=dict(rule_id='prior',kind='transfer',known_from='2021-07-30',order=1,reviewed=True,source='NBA Favors',pick=p('UTA',2026,1),from_team='UTA',to_team='OKC')
  own=allocate({('UTA',2026,1):15,('MIN',2026,1):5},[prior,r],'2022-07-31');self.assertEqual(own['MIN',2026,1],'MIN')
 def test_denver_chain_respects_two_prior_dependencies(self):
  r=next(r for r in self.event_rules('L01982')if r['kind']=='protected_chain');self.assertEqual(r['requires_gap_after_rule'],'DEN_GORDON_2021');self.assertTrue(r['requires_prior_conveyance']);self.assertEqual(r['minimum_gap_years'],2)
 def test_known_nets_deferral_is_not_reoptimized(self):
  a=next(a for a in actions()if a['event_id']=='RESOLVED_PHI_2022_DEFERRAL');self.assertEqual(a['known_from'],'2022-05-31');self.assertEqual(set(a['changes'][0]['value'].values()),{'later'})
 def test_brogdon_first_failure_transfers_retained_second(self):
  rr=self.event_rules('L02432');fallback=next(r for r in rr if r['kind']=='selected_transfer');self.assertEqual(fallback['to_team'],'IND');self.assertEqual(fallback['conditions'],[dict(pick=p('BOS',2023,1),range=[1,12])]);self.assertEqual(fallback['select']['held']['count_range'],[1,1])
 def test_penalties_enter_when_announced(self):
  aa=actions();self.assertEqual({a['event_id']for a in aa if a['known_from']=='2022-10-31'},{'FORFEIT_PHI2023','FORFEIT_PHI2024'});self.assertTrue(any(a['event_id']=='FORFEIT_NYK2025' and a['known_from']=='2022-12-21'for a in aa))

if __name__=='__main__':unittest.main()
