import unittest
from pick_event_evidence import extract
from salaryswish_pick_history import parse_rows
class Checks(unittest.TestCase):
 def test_two_sides(self):
  e={'text':'Cash were acquired by the Utah Jazz from the Oklahoma City Thunder in exchange for: Miye Oni, a 2028 2nd round pick (UTH own) and cash.'}
  r=extract(e);self.assertEqual(len(r),1);self.assertEqual((r[0]['origin_team'],r[0]['from_team'],r[0]['to_team']),('UTA','UTA','OKC'))
 def test_conditional_not_asserted_ownership(self):
  e={'text':'A conditional 2027 1st round pick (PHL own) was acquired by the Brooklyn Nets from the Philadelphia Sixers in exchange for: cash.'}
  r=extract(e);self.assertEqual(r[0]['review_status'],'conditional_or_origin_unresolved');self.assertEqual(r[0]['origin_team'],'PHI')
 def test_original_rollover_not_hindsight(self):
  html='''<tr><td>Jul 7, 2019</td><td><div><h6>Memphis Grizzlies Acquire:</h6><div><div>2024 1st round pick (GSW - #14 - Carlton Carrington) [Protected]*</div><div class="trade_cond">*Protected Details: 2024: 1-4 (DID Transfer)<br>2025: 1-1 (Voided)<br>2026: Unprotected (Voided)</div><div class="trade_cond">*Protected Result: Unprotected</div></div></div></td></tr>'''
  r=parse_rows(html,'source',2020,0)[0]['recipients'][0];self.assertEqual(r['team'],'MEM');self.assertEqual(r['pick_references'][0]['origin_team'],'GSW');self.assertIn('2025: 1-1',r['original_reported_terms'][0]);self.assertNotIn('Voided',r['original_reported_terms'][0]);self.assertTrue(r['subsequent_reported_results']);self.assertNotIn('#14',r['pick_references'][0]['label_without_realized_selection'])
 def test_inline_result_separated(self):
  html='''<tr><td>Feb 6, 2020</td><td><div><h6>Golden State Warriors Acquire:</h6><div><div class="trade_cond">*Conditions: Top 3 in 2021, unprotected in 2022. *Result: Pick transferred in 2021.</div></div></div></td></tr>'''
  r=parse_rows(html,'source',2020,0)[0]['recipients'][0];self.assertNotIn('transferred',r['original_reported_terms'][0]);self.assertIn('transferred',r['subsequent_reported_results'][0])

from pick_allocator import allocate,expected_values,compile_choice_policies,TEAMS
class AllocatorChecks(unittest.TestCase):
 def rule(self,**kwargs):return dict(known_from='2021-01-01',order=0,reviewed=True,source='test',**kwargs)
 def test_protected_roll_is_one_pick(self):
  slots={('UTA',2024,1):7,('UTA',2025,1):20,('UTA',2026,1):22}
  r=self.rule(kind='protected_chain',from_team='UTA',to_team='OKC',branches=[dict(pick=['UTA',y,1],protected_ranges=[[1,10]])for y in(2024,2025,2026)])
  owners=allocate(slots,[r],'2022-01-01');self.assertEqual(sum(v=='OKC'for v in owners.values()),1);self.assertEqual(owners[('UTA',2025,1)],'OKC')
 def test_swap_conserves(self):
  slots={('UTA',2028,1):20,('CLE',2028,1):5};r=self.rule(kind='swap',left_pick=['UTA',2028,1],right_pick=['CLE',2028,1],left_owner='UTA',right_owner='CLE')
  owners=allocate(slots,[r],'2022-01-01');self.assertEqual(owners[('CLE',2028,1)],'UTA');self.assertEqual(owners[('UTA',2028,1)],'CLE');self.assertEqual(len(owners),2)
 def test_no_future_rule(self):
  r=self.rule(kind='transfer',pick=['UTA',2028,1],from_team='UTA',to_team='CLE');r['known_from']='2023-01-01';self.assertEqual(allocate({('UTA',2028,1):5},[r],'2022-01-01')[('UTA',2028,1)],'UTA')
 def test_wrong_chain_rejected(self):
  r=self.rule(kind='transfer',pick=['UTA',2028,1],from_team='BOS',to_team='CLE')
  with self.assertRaisesRegex(ValueError,'mismatch'):allocate({('UTA',2028,1):5},[r],'2022-01-01')
 def test_values_conserve(self):
  draws=[{('UTA',2028,1):20,('CLE',2028,1):5},{('UTA',2028,1):3,('CLE',2028,1):25}];q={i:100-i for i in range(1,61)};values=expected_values(draws,[],'2022-01-01',q,{2028});self.assertAlmostEqual(sum(values.values()),173.5)
 def test_best_option_leaves_unused_counterparty_unchanged(self):
  slots={('OKC',2025,1):20,('HOU',2025,1):11,('LAC',2025,1):5}
  rule=self.rule(kind='best_option_swap',left_pick=['OKC',2025,1],left_owner='OKC',options=[dict(pick=['HOU',2025,1],owner='HOU',protected_ranges=[[1,10]]),dict(pick=['LAC',2025,1],owner='LAC')])
  own=allocate(slots,[rule],'2022-01-01');self.assertEqual(own,{('OKC',2025,1):'LAC',('HOU',2025,1):'HOU',('LAC',2025,1):'OKC'})
 def test_deferral_policy_does_not_know_individual_future_outcome(self):
  early=('LAL',2024,1);late=('LAL',2025,1)
  rule=self.rule(kind='deferred_choice',earlier_pick=early,later_pick=late,from_team='LAL',to_team='NOP')
  draws=[{early:10,late:1},{early:10,late:30}];rules=compile_choice_policies([rule],draws,{i:100-i for i in range(1,61)})
  self.assertEqual(rules[0]['decision_by_slot']['10'],'earlier')
  self.assertEqual([allocate(d,rules,'2022-01-01')[early]for d in draws],['NOP','NOP'])
 def test_collapsed_baseline_rejects_earlier_date(self):
  rule=self.rule(kind='transfer',pick=['UTA',2028,1],from_team='UTA',to_team='CLE',baseline_only=True,baseline_asof='2021-12-31')
  with self.assertRaisesRegex(ValueError,'before their baseline'):allocate({('UTA',2028,1):10},[rule],'2021-06-01')
 def test_forfeiture_sink_and_compressed_second_quote(self):
  slots={(team,2022,2):31+i for i,team in enumerate(sorted(TEAMS))}
  rule=self.rule(kind='transfer',pick=['ATL',2022,2],from_team='ATL',to_team='FORFEITED')
  own=allocate(slots,[rule],'2022-01-01');self.assertEqual(own[('ATL',2022,2)],'FORFEITED')
  values=expected_values([slots],[rule],'2022-01-01',lambda rnd,slot,n:slot,{2022})
  self.assertEqual(values['ATL'],0);self.assertEqual(values['BKN'],31);self.assertEqual(sum(values.values()),sum(range(31,60)))
 def test_future_first_forfeit_is_gated(self):
  slots={(team,2029,rnd):1+i+30*(rnd-1)for rnd in(1,2)for i,team in enumerate(sorted(TEAMS))}
  rule=self.rule(kind='transfer',pick=['ATL',2029,1],from_team='ATL',to_team='FORFEITED')
  with self.assertRaisesRegex(ValueError,'Unverified first-forfeiture lottery policy'):expected_values([slots],[rule],'2022-01-01',lambda rnd,slot,n:slot,{2029})

if __name__=='__main__':unittest.main()
