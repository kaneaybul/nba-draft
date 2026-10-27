import unittest
from contracts import parse_contracts,slug,option_adjustments

HTML='''<div class="sw_playerContract"><h6 class="sw_playerContract__title">VETERAN EXTENSION</h6><div class="sw_playerContract__meta"><div>Length: 1 - 2 years</div><div>Value: $22,000,000</div><div>Cap %: 25.00</div><div>Signing Team: BOS</div><div>Signing Date: August 7, 2021</div></div><table><tbody><tr><td>2022-23</td><td></td><td></td><td>$10,000,000</td><td>$10,000,000</td><td>$10,000,000</td></tr><tr><td>2023-24</td><td>Player</td><td>No (Jun 30, 2023)</td><td>$12,000,000</td><td>$12,000,000 (+8%)</td><td>$12,000,000</td></tr></tbody></table></div>'''
class ContractTests(unittest.TestCase):
 def test_original_dates_rows_options(self):
  a,issues=parse_contracts(HTML,'Example',1,'https://source');a=a[0]
  self.assertFalse(issues);self.assertEqual(a['known_from'],'2021-08-07');self.assertTrue(a['schedule_complete']);self.assertEqual(a['expiry_season'],2024);self.assertEqual(a['annual_salary_total'],22000000)
  self.assertEqual(a['salaries'][1]['kind'],'player_option');self.assertIsNone(a['salaries'][1]['guaranteed_amount'])
 def test_later_decline_is_dated(self):
  a,_=parse_contracts(HTML,'Example',1,'https://source');x=option_adjustments(a)[0]
  self.assertEqual(x['known_from'],'2023-06-30');self.assertEqual(x['remove_years'],[2024])
 def test_missing_row_does_not_claim_full_term(self):
  broken=HTML.replace('1 - 2 years','1 - 3 years');a,_=parse_contracts(broken,'Example',1,'https://source');self.assertFalse(a[0]['schedule_complete'])
 def test_no_signing_date_no_agreement(self):
  a,issues=parse_contracts(HTML.replace('Signing Date','Missing Date'),'Example',1,'https://source');self.assertFalse(a);self.assertIn('missing_signing_date',issues)
 def test_short_contract_cash_and_later_full_year_are_distinct(self):
  a,_=parse_contracts(HTML.replace('VETERAN EXTENSION','10-DAY CONTRACT'),'Example',1,'https://source');a=a[0]
  self.assertTrue(a['schedule_complete']);self.assertTrue(a['episode_annual_rate_estimated'])
  self.assertEqual(a['salaries'][0]['original_episode_amount'],10000000)
  self.assertEqual(a['salaries'][0]['amount'],174000000)
  self.assertEqual(a['salaries'][1]['amount'],12000000)
 def test_future_max_is_not_asof_complete(self):
  html=HTML.replace('2022-23</td>','2022-23 <span class="contract_maximum" title="Maximum Contract Salary">Max</span></td>')
  a,_=parse_contracts(html,'Example',1,'https://source');a=a[0]
  self.assertTrue(a['table_complete']);self.assertFalse(a['schedule_complete']);self.assertTrue(a['max_salary_asof_review_required']);self.assertEqual(a['first_cap_known_from'],'2022-07-01')
 def test_settled_max_is_nominally_known(self):
  html=HTML.replace('August 7, 2021','August 7, 2022').replace('2022-23</td>','2022-23 <span class="contract_maximum" title="Maximum Contract Salary">Max</span></td>')
  a,_=parse_contracts(html,'Example',1,'https://source');self.assertTrue(a[0]['schedule_complete'])
 def test_waiver_css_is_not_max_salary(self):
  html=HTML.replace('2022-23</td>','2022-23 <span class="contract_maximum" title="Contract was waived on Jul 1, 2024">W</span></td>')
  a,_=parse_contracts(html,'Example',1,'https://source');self.assertFalse(a[0]['max_salary_asof_review_required']);self.assertTrue(a[0]['schedule_complete'])
 def test_slug_punctuation(self):
  self.assertEqual(slug("De'Aaron Fox"),'deaaron-fox');self.assertEqual(slug('Shai Gilgeous-Alexander'),'shai-gilgeousalexander');self.assertEqual(slug('Jaren Jackson Jr.'),'jaren-jacksonjr')
if __name__=='__main__':unittest.main()
