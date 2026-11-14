import json,math,unittest
from pathlib import Path
from pick_allocator import TEAMS
from forfeiture_rules import FORFEITED,apply_forfeiture,effective_slots_after_forfeitures,rookie_scale_slot,RoundAwarePickQuotes,penalty_rules,lottery_policy_status

def universe(year=2029):
 slots={}
 for j,t in enumerate(sorted(TEAMS)):slots[(t,year,1)]=j+1;slots[(t,year,2)]=j+31
 return {p:p[0]for p in slots},slots
class Forfeitures(unittest.TestCase):
 def test_next_available_is_held_claim_not_own(self):
  owners={('DEN',2023,2):'CHI',('CHI',2023,2):'WAS',('CHI',2026,2):'CHI'};slots={('DEN',2023,2):50,('CHI',2023,2):40,('CHI',2026,2):35}
  r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  self.assertEqual(apply_forfeiture(owners,slots,r),('DEN',2023,2));self.assertEqual(owners[('CHI',2023,2)],'WAS')
 def test_protected_nuggets_rolls_to_chi2026(self):
  owners={('DEN',2023,2):'DEN',('CHI',2023,2):'WAS',('CHI',2026,2):'CHI'};slots={k:40 for k in owners};r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  self.assertEqual(apply_forfeiture(owners,slots,r),('CHI',2026,2))
 def test_retained_chi2025_precedes_chi2026_when_den_protected(self):
  # SAS owns CHI2025 only at56–60; a retained31–55 component is available
  # to the penalty first if the conditionalDEN2023 second never conveyed.
  owners={('DEN',2023,2):'DEN',('CHI',2025,2):'CHI',('CHI',2026,2):'CHI'};slots={k:40 for k in owners}
  r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  self.assertEqual(apply_forfeiture(owners,slots,r),('CHI',2025,2))
 def test_conveyed_chi2025_not_forfeited(self):
  owners={('DEN',2023,2):'DEN',('CHI',2025,2):'SAS',('CHI',2026,2):'CHI'};slots={k:58 for k in owners}
  r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  self.assertEqual(apply_forfeiture(owners,slots,r),('CHI',2026,2));self.assertEqual(owners[('CHI',2025,2)],'SAS')
 def test_false_original_owner_blocked(self):
  owners={('CHI',2022,2):'CHI',('DEN',2023,2):'CHI'};slots={k:40 for k in owners};r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  with self.assertRaisesRegex(ValueError,'Unreviewed earlier'):apply_forfeiture(owners,slots,r)
 def test_same_year_choice_not_guessed(self):
  owners={('CHI',2028,2):'CHI',('POR',2028,2):'CHI'};slots={k:40 for k in owners};r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021')
  with self.assertRaisesRegex(ValueError,'selection policy'):apply_forfeiture(owners,slots,r)
 def test_partial_horizon_leaves_pending_liability(self):
  r=next(r for r in penalty_rules()if r['rule_id']=='FORFEIT_CHI_NEXT_2021');self.assertIsNone(apply_forfeiture({('DEN',2023,2):'DEN'},{('DEN',2023,2):45},r))
 def test_second_removal_compresses_later_selections(self):
  owners,slots=universe();pick=next(p for p,v in slots.items()if v==50);owners[pick]=FORFEITED
  actual=effective_slots_after_forfeitures(owners,slots)
  self.assertIsNone(actual[pick]);self.assertEqual(sorted(v for v in actual.values()if v is not None),list(range(1,60)))
 def test_first_removal_changes_second_start(self):
  owners,slots=universe();p=next(k for k,v in slots.items()if v==20);owners[p]=FORFEITED;x=effective_slots_after_forfeitures(owners,slots)
  self.assertEqual(min(v for k,v in x.items()if k[2]==2),30)
 def test_middle_salary_scale_removed(self):
  self.assertEqual(rookie_scale_slot(14,1),14);self.assertEqual(rookie_scale_slot(15,1),16);self.assertEqual(rookie_scale_slot(29,1),30)
  self.assertEqual(rookie_scale_slot(15,2),17);self.assertEqual(rookie_scale_slot(14,3),17)
 def test_lac_specific_physical_firsts(self):
  r=[r for r in penalty_rules()if r['rule_id'].startswith('FORFEIT_LAC')]
  self.assertEqual([r['pick']for r in r],[['IND',2029,1]]+[['LAC',y,1]for y in range(2030,2034)])
  self.assertNotIn(['LAC',2029,1],[r['pick']for r in r]);self.assertNotIn(['TOR',2031,1],[r['pick']for r in r])
 def test_future_lottery_interaction_not_falsely_verified(self):
  self.assertFalse(lottery_policy_status(2029,1)['verified']);self.assertTrue(lottery_policy_status(2026,1)['verified'])
class PriceTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  p=Path(__file__).resolve().parents[4]/'reconstruction/Utah_Monthly_Asset_Reconstruction/monthly_reconstruction/pick_values/trained_pick_model.json'
  if not p.exists():raise unittest.SkipTest('Canonical model dataset not present')
  cls.model=json.loads(p.read_text());cls.price=RoundAwarePickQuotes(cls.model)
 def test_all60_existing_quotes_unchanged_without_forfeit(self):
  for row in self.model['pick_curve']:
   n=row['pick'];self.assertAlmostEqual(self.price(1 if n<=30 else 2,n),row['quote'],places=5)
 def test_second_at30_uses_second_salary(self):
  p=self.price.components(2,30,1);self.assertIn('Second-round',p['salary_method']);self.assertIsNone(p['rookie_scale_slot'])
  f=self.model['pick_fit'];expected=sum(max(0,a+b*math.log(30))for a,b in f['second_round_salary_OLS_coefficients']);self.assertAlmostEqual(p['expected_salary'],expected)
 def test_first15_uses_scale16_but_production15(self):
  p=self.price.components(1,15,1);base=self.price.components(1,15,0)
  self.assertEqual(p['production_quote'],base['production_quote']);self.assertEqual(p['rookie_scale_slot'],16)
  expected=[v*w for v,w in zip(self.model['pick_curve'][15]['annual_full_rookie_scale_reporting_dollars'],self.model['pick_curve'][14]['annual_paid_cost_fraction'])]
  self.assertEqual(p['annual_expected_salary'],expected)
if __name__=='__main__':unittest.main()
