import unittest, tempfile
from pathlib import Path
from refresh_live_skill_stats import term_value, number, read_historical_minutes
class EvidenceTests(unittest.TestCase):
 def test_zero_attempts_and_missing_percent(self):
  self.assertEqual(term_value({'3PA_100':0,'3P_PERC':None},'I(X3PA_100 * X3P_PERC)'),0)
  self.assertIsNone(term_value({'3PA_100':5,'3P_PERC':None},'I(X3PA_100 * X3P_PERC)'))
 def test_missing_stat_is_not_zero(self):
  self.assertIsNone(term_value({},'rim_points_saved_100'))
  self.assertIsNone(number(float('nan')))
 def test_historical_minutes_use_actual_source_and_reject_missing_column(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'history.csv'
   p.write_text('nba_id,year,Minutes\n1,2026,2500\n1,2025,2000\n1,2023,1000\n')
   self.assertEqual(read_historical_minutes(p,2027),{'1':{'2026':2500,'2025':2000}})
   p.write_text('nba_id,year,skill_window_minutes\n1,2026,4000\n')
   with self.assertRaises(ValueError): read_historical_minutes(p,2027)
 def test_shooting_units(self):
  self.assertAlmostEqual(term_value({'3PA_100':8,'3P_PERC':.4},'I(X3PA_100 * X3P_PERC)'),3.2)
if __name__=='__main__': unittest.main()
