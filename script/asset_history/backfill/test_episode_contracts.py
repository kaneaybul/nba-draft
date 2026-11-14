import unittest
from episode_contracts import annualize_episode

class Episodes(unittest.TestCase):
 def test_rest_season_cash_is_not_prorated_twice(self):
  a=dict(short_episode=True,known_from='2024-02-22',contract_type='VETERAN CONTRACT (REST OF SEASON)',table_complete=True,salaries=[dict(year=2024,amount=530000,guaranteed_amount=530000),dict(year=2025,amount=2000000)])
  annualize_episode(a)
  # Feb22 throughApr14inleapyear=53days; regularseason174days.
  self.assertEqual(a['salaries'][0]['amount'],1740000)
  self.assertEqual(a['salaries'][1]['amount'],2000000)
  self.assertEqual(a['salaries'][0]['original_episode_amount'],530000)
  self.assertTrue(a['schedule_complete'])
 def test_unknown_calendar_is_not_guessed(self):
  a=dict(short_episode=True,known_from='2027-02-01',contract_type='10-DAY CONTRACT',schedule_complete=False,salaries=[dict(year=2028,amount=100000)])
  annualize_episode(a);self.assertFalse(a['schedule_complete']);self.assertEqual(a['salaries'][0]['amount'],100000)
 def test_full_season_unchanged(self):
  a=dict(short_episode=False,salaries=[dict(year=2027,amount=1000000)]);annualize_episode(a);self.assertEqual(a['salaries'][0]['amount'],1000000)

if __name__=='__main__':unittest.main()
