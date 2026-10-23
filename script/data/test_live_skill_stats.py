import unittest
from refresh_live_skill_stats import term_value, number
class EvidenceTests(unittest.TestCase):
 def test_zero_attempts_and_missing_percent(self):
  self.assertEqual(term_value({'3PA_100':0,'3P_PERC':None},'I(X3PA_100 * X3P_PERC)'),0)
  self.assertIsNone(term_value({'3PA_100':5,'3P_PERC':None},'I(X3PA_100 * X3P_PERC)'))
 def test_missing_stat_is_not_zero(self):
  self.assertIsNone(term_value({},'rim_points_saved_100'))
  self.assertIsNone(number(float('nan')))
 def test_shooting_units(self):
  self.assertAlmostEqual(term_value({'3PA_100':8,'3P_PERC':.4},'I(X3PA_100 * X3P_PERC)'),3.2)
if __name__=='__main__': unittest.main()
