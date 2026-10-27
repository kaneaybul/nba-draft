import unittest
from annual_quote_adapter import common_source_cutoff,rolling_exposures,from_final_annual_path
class Check(unittest.TestCase):
 def test_pregame(self):self.assertEqual(common_source_cutoff('2026-11-01','2026-11-01'),'2026-10-31')
 def test_mismatched(self):
  with self.assertRaises(ValueError):common_source_cutoff('2026-11-01','2026-10-31')
 def test_missing_year(self):
  with self.assertRaisesRegex(ValueError,'Missing annual'):from_final_annual_path('2026-10-31',[],[(2027,1),(2028,1),(2029,1),(2030,1)],100)
 def test_cap_normalization_and_adjustments(self):
  rows=[{'season':2027+i,'source_cutoff':'2026-10-31','method':'peak4-payroll-0.8-v1','production':20*(1.05**i),'asset':12*(1.05**i),'salary_cap':100*(1.05**i)}for i in range(5)]
  q=from_final_annual_path('2026-10-31',rows,[(2027,.1),(2028,1),(2029,1),(2030,1),(2031,.9)],100)
  self.assertAlmostEqual(q['quote'],48)
 def test_cutoff_future_rejected(self):
  r={'season':2027,'source_cutoff':'2026-11-01','method':'peak4-payroll-0.8-v1','production':20,'asset':12,'salary_cap':100}
  with self.assertRaisesRegex(ValueError,'cutoff'):from_final_annual_path('2026-10-31',[r],[(2027,1)],100)
if __name__=='__main__':unittest.main()
