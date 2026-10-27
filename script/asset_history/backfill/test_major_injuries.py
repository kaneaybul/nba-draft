import tempfile,unittest,json
from pathlib import Path
from build_major_injuries import SEEDS
from datetime import date
class InjuryChecks(unittest.TestCase):
 def test_unique_dated_seeds(self):
  ids=[(r[0],r[1],r[2])for r in SEEDS];self.assertEqual(len(ids),len(set(ids)))
 def test_known_before_end(self):
  for name,dt,season,status,url,summary in SEEDS:
   self.assertLessEqual(date.fromisoformat(dt),date(season,6,30),name)
   self.assertIn(status,('certain','expected'));self.assertTrue(url.startswith('https://'))
 def test_critical_boundaries(self):
  rows={(n,y):d for n,d,y,*_ in SEEDS}
  self.assertEqual(rows['Tyrese Haliburton',2026],'2025-07-07')
  self.assertEqual(rows['Kyrie Irving',2026],'2026-02-18')
  self.assertEqual(rows['Joel Embiid',2025],'2025-02-28')
 def test_unknown_jalen_return_not_season_ending(self):
  self.assertFalse(any(r[0]=='Jalen Williams' for r in SEEDS))
if __name__=='__main__':unittest.main()
