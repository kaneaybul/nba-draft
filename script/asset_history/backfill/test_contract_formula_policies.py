import unittest
from league_player_values import agreements_at
from contracts import annotate_waiver_options

class Policies(unittest.TestCase):
 def fixture(self):
  rule=dict(first_year=2025,last_year=2026,rule_known_from='2023-07-08',prior_salary_amount=10,cap_fraction=.25,annual_raise_fraction_of_first_salary=.08,sources=['original'],conditional_salary_policy='signed_base_until_dated_qualification',conditional_cap_fraction_upper=.30,cap_fraction_events=[dict(known_from='2024-05-22',cap_fraction=.30)])
  return [dict(player_name='A',nba_id=1,known_from='2023-07-08',salaries=[dict(year=2025,amount=30),dict(year=2026,amount=32)],max_salary_years=[2025,2026],max_salary_asof_formula_verified=True,max_salary_asof_formula=rule,table_complete=True,schedule_complete=False)]
 def test_qualification_not_backdated(self):
  a=self.fixture();rows,complete,_=agreements_at(a,'A',1,'2024-04-30',str.lower,lambda y,d:100)
  self.assertTrue(complete);self.assertEqual(rows[0]['amount'],25);self.assertEqual(rows[0]['conditional_upper_salary'],30)
  rows,complete,_=agreements_at(a,'A',1,'2024-05-31',str.lower,lambda y,d:100)
  self.assertTrue(complete);self.assertEqual(rows[0]['amount'],30)
 def test_internal_id_alias(self):
  a=self.fixture();a[0]['app_id_aliases']=[-1]
  rows,complete,_=agreements_at(a,'Alias',-1,'2024-04-30',str.lower,lambda y,d:100)
  self.assertTrue(complete);self.assertEqual(rows[0]['amount'],25)
 def test_fixed_second_year_discount_preserved(self):
  a=self.fixture();a[0]['max_salary_asof_formula']['annual_salary_overrides']={'2026':22}
  rows,_,_=agreements_at(a,'A',1,'2024-04-30',str.lower,lambda y,d:100)
  self.assertEqual(rows[1]['amount'],22)
 def test_camp_release_floor_vests_on_dated_boundary(self):
  a=dict(player_name='Camp',nba_id=-1,known_from='2023-09-01',contract_type='EXHIBIT 10',source='original',schedule_complete=True,salaries=[dict(year=2024,amount=100,guaranteed_amount=0)])
  annotate_waiver_options(a)
  rows,_,_=agreements_at([a],'Camp',-1,'2023-09-30',str.lower)
  self.assertTrue(rows[0]['waiver_option_verified']);self.assertEqual(rows[0]['waiver_guaranteed_amount_asof'],0)
  rows,_,_=agreements_at([a],'Camp',-1,'2024-01-31',str.lower)
  self.assertEqual(rows[0]['waiver_guaranteed_amount_asof'],100)
 def test_arbitrary_veteran_guarantee_is_not_backdated(self):
  a=dict(contract_type='VETERAN CONTRACT',known_from='2023-09-01',source='retrospective',salaries=[dict(year=2024,amount=100,guaranteed_amount=0)])
  annotate_waiver_options(a);self.assertNotIn('waiver_option',a['salaries'][0])

if __name__=='__main__':unittest.main()
