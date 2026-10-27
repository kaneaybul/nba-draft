import unittest
from league_player_values import agreements_at,team_inventory
key=lambda s:s.lower().replace(' ','')
class Check(unittest.TestCase):
 def test_same_name_different_ids_cannot_overwrite_contract(self):
  a=[{'player_name':'Jaylin Williams','nba_id':1,'known_from':'2025-07-01','salaries':[{'year':2027,'amount':10}],'schedule_complete':True},
   {'player_name':'Jaylin Williams','nba_id':2,'known_from':'2026-07-01','salaries':[{'year':2027,'amount':2}],'schedule_complete':True}]
  self.assertEqual(agreements_at(a,'Jaylin Williams',1,'2026-10-31',key)[0][0]['amount'],10)
  self.assertEqual(agreements_at(a,'Jaylin Williams',-9000117468,'2026-10-31',key),([],False,None))
 def test_no_future_agreement(self):
  a=[{'player_name':'A','nba_id':1,'known_from':'2026-11-01','salaries':[{'year':2027,'amount':40}],'schedule_complete':True}]
  self.assertEqual(agreements_at(a,'A',1,'2026-10-31',key),([],False,None))
 def test_new_agreement_replaces_only_explicit_year(self):
  a=[{'player_name':'A','nba_id':1,'known_from':'2025-07-01','salaries':[{'year':2026,'amount':10},{'year':2027,'amount':11}],'schedule_complete':True},
  {'player_name':'A','nba_id':1,'known_from':'2026-07-01','salaries':[{'year':2027,'amount':20}],'schedule_complete':True}]
  rows,complete,_=agreements_at(a,'A',1,'2026-10-31',key)
  self.assertEqual({r['year']:r['amount']for r in rows},{2026:10,2027:20});self.assertTrue(complete)
 def test_future_max_cap_unpriced(self):
  a=[{'player_name':'A','nba_id':1,'known_from':'2026-07-01','salaries':[{'year':2028,'amount':50}],'max_salary_years':[2028],'schedule_complete':True}]
  rows,complete,_=agreements_at(a,'A',1,'2026-10-31',key)
  self.assertIsNone(rows[0]['amount']);self.assertFalse(complete)
 def test_verified_future_max_uses_asof_cap(self):
  rule={'first_year':2028,'last_year':2029,'rule_known_from':'2026-07-01','prior_salary_amount':30,'prior_salary_multiplier':1.05,'cap_fraction':.35,'annual_raise_fraction_of_first_salary':.08,'sources':['primary']}
  a=[{'player_name':'A','nba_id':1,'known_from':'2026-07-01','salaries':[{'year':2028,'amount':50},{'year':2029,'amount':54}],'max_salary_years':[2028,2029],'max_salary_asof_formula_verified':True,'max_salary_asof_formula':rule,'table_complete':True,'schedule_complete':False}]
  rows,complete,_=agreements_at(a,'A',1,'2026-10-31',key,lambda yy,dt:100)
  self.assertEqual([r['amount']for r in rows],[35,38]);self.assertTrue(complete)
  self.assertEqual(a[0]['salaries'][0]['amount'],50)
 def test_verified_max_floor_beats_cap(self):
  rule={'first_year':2028,'last_year':2029,'rule_known_from':'2026-07-01','prior_salary_amount':50,'prior_salary_multiplier':1.05,'cap_fraction':.35,'annual_raise_fraction_of_first_salary':.08,'sources':['primary']}
  a=[{'player_name':'A','nba_id':1,'known_from':'2026-07-01','salaries':[{'year':2028,'amount':52},{'year':2029,'amount':56}],'max_salary_years':[2028,2029],'max_salary_asof_formula_verified':True,'max_salary_asof_formula':rule,'table_complete':True,'schedule_complete':False}]
  rows,complete,_=agreements_at(a,'A',1,'2026-10-31',key,lambda yy,dt:100)
  self.assertEqual([r['amount']for r in rows],[52,56]);self.assertTrue(complete)
 def test_option_deleted_only_after_event(self):
  a=[{'player_name':'A','nba_id':1,'known_from':'2025-07-01','salaries':[{'year':2027,'amount':11}],'schedule_complete':True},
  {'player_name':'A','nba_id':1,'known_from':'2026-11-01','salaries':[],'remove_years':[2027],'schedule_complete':True}]
  self.assertEqual(len(agreements_at(a,'A',1,'2026-10-31',key)[0]),1)
  self.assertEqual(agreements_at(a,'A',1,'2026-11-01',key)[0],[])
if __name__=='__main__':unittest.main()
