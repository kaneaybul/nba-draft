import unittest
from reviewed_chi_den import rules,EXPECTED
from pick_allocator import allocate,TEAMS

def candidates():return [dict(idx=i,date=d,team=t,source='https://reviewed-source.test/'+str(i))for i,(d,t)in EXPECTED.items()]
def slots():return {(t,y,r):20 if r==1 else 50 for t in TEAMS for y in range(2022,2029)for r in(1,2)}
class ReviewedChainChecks(unittest.TestCase):
 def setUp(self):self.rules=rules(candidates());self.s=slots()
 def run_rules(self):return allocate(self.s,self.rules,'2021-12-31')
 def test_all_five_reviewed_and_source_guarded(self):
  self.assertEqual(len(self.rules),5);self.assertTrue(all(r['reviewed']and r['source']and r['reviewed_coverage_refs']for r in self.rules))
  c=candidates();c[0]['date']='2020-11-25'
  with self.assertRaises(ValueError):rules(c)
 def test_den_on_time_conveyance(self):
  o=self.run_rules();self.assertEqual(o['DEN',2023,1],'OKC');self.assertEqual(o['DEN',2025,1],'ORL')
 def test_den_gap_after_2024(self):
  self.s['DEN',2023,1]=4;o=self.run_rules();self.assertEqual(o['DEN',2024,1],'OKC');self.assertEqual(o['DEN',2025,1],'DEN');self.assertEqual(o['DEN',2026,1],'ORL')
 def test_den_last_first_year(self):
  self.s['DEN',2023,1]=4;self.s['DEN',2024,1]=4;o=self.run_rules();self.assertEqual(o['DEN',2025,1],'OKC');self.assertEqual(o['DEN',2027,1],'ORL')
 def test_den_no_prior_first_extinguishes_orlando(self):
  for y in(2023,2024,2025):self.s['DEN',y,1]=10
  o=self.run_rules();self.assertEqual(o['DEN',2025,2],'OKC');self.assertEqual(o['DEN',2026,2],'OKC')
  self.assertTrue(all(o['DEN',y,1]=='DEN'for y in range(2023,2028)))
 def test_chi_delayed_orlando_blocks_2025_spurs(self):
  self.s['CHI',2023,1]=4;o=self.run_rules();self.assertEqual(o['CHI',2024,1],'ORL');self.assertEqual(o['CHI',2025,1],'CHI');self.assertEqual(o['CHI',2026,1],'SAS')
 def test_chi_no_prior_first_uses_both_fallbacks(self):
  self.s['CHI',2023,1]=4;self.s['CHI',2024,1]=3;o=self.run_rules()
  self.assertEqual(o['CHI',2026,2],'ORL');self.assertEqual(o['CHI',2027,2],'ORL');self.assertEqual(o['CHI',2028,2],'SAS')
  self.assertTrue(all(o['CHI',y,1]=='CHI'for y in range(2023,2028)))
 def test_chi_sas_2025_26_27_boundaries(self):
  self.s['CHI',2025,1]=10;self.s['CHI',2026,1]=8;self.s['CHI',2027,1]=9
  o=self.run_rules();self.assertEqual(o['CHI',2027,1],'SAS');self.assertEqual(o['CHI',2025,1],'CHI');self.assertEqual(o['CHI',2026,1],'CHI')
 def test_chi_sas_fallback_if_all_three_protected(self):
  self.s['CHI',2025,1]=10;self.s['CHI',2026,1]=8;self.s['CHI',2027,1]=8;o=self.run_rules();self.assertEqual(o['CHI',2028,2],'SAS')
 def test_nop_lottery_fallback(self):
  self.s['NOP',2022,1]=14;o=self.run_rules();self.assertEqual(o['NOP',2022,1],'NOP');self.assertEqual(o['NOP',2022,2],'CHA');self.assertEqual(o['NOP',2024,2],'CHA')
 def test_nop_nonlottery_first_only(self):
  self.s['NOP',2022,1]=15;o=self.run_rules();self.assertEqual(o['NOP',2022,1],'CHA');self.assertEqual(o['NOP',2022,2],'NOP');self.assertEqual(o['NOP',2024,2],'NOP')
 def test_before_agreement_no_future_rule(self):
  o=allocate(self.s,self.rules,'2021-01-01');self.assertEqual(o['DEN',2023,1],'OKC');self.assertEqual(o['DEN',2025,1],'DEN');self.assertEqual(o['CHI',2023,1],'CHI')
if __name__=='__main__':unittest.main()
