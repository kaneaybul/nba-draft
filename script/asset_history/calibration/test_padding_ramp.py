import sys,unittest,copy
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from calibration.padding_ramp import ramp,endpoint_weight,audit
from calibration.path_model import summarize_development
class PaddingRampTests(unittest.TestCase):
 def test_anchors_and_smooth_terminal(self):
  for g,w in [(0,0),(82,.5),(164,.875),(328,1)]:self.assertAlmostEqual(ramp(g),w)
  for g in range(329):
   w=endpoint_weight(g,g*12,max(0,4-g/82));self.assertTrue(0<=w<=1)
  self.assertAlmostEqual(endpoint_weight(327.999,0,.001/82),1.,places=8)
 def test_minutes_do_not_gate_known_endpoint(self):
  self.assertEqual(endpoint_weight(164,0,2),.875)
  self.assertEqual(endpoint_weight(82,300,3),endpoint_weight(82,984,3))
  self.assertEqual(endpoint_weight(328,0,0),1)
 def test_owner_coordinates_and_late_entry(self):
  a=audit({'impact_team_game_clock':82*27+20,'impact_coordinate_offset':0},2026,0,4-20/82)
  b=audit({'impact_team_game_clock':82*27+23,'impact_coordinate_offset':3},2026,0,4-20/82)
  self.assertEqual(a['team_games'],20);self.assertEqual(a['team_games'],b['team_games']);self.assertGreater(a['weight'],0)
 def quote(self,ep=None,service=.8):
  p=np.array([[10.,20.],[20.,30.]]);pc=p*.5;pw=np.array([.4,.6]);n=np.array([[30.,50.],[50.,80.]]);nc=n*.4;nw=np.array([.3,.7]);own=np.array([100.,200.]);ew=np.array([.25,.75])
  return summarize_development(np.tile(p,(1,2)),np.tile(pc,(1,2)),pw,np.array([50.,70.]),np.tile(n,(1,2)),np.tile(nc,(1,2)),nw,service,[1.,1.,1.,1.],own,ew,endpoint_weight=ep)
 def test_equal_weights_exact_old_distribution(self):
  self.assertEqual(self.quote(None),self.quote(.8))
 def test_point_financial_marginal_unchanged(self):
  base=self.quote(None)
  for w in [0.,.2,.8,1.]:
   q=self.quote(w);self.assertAlmostEqual(q['mean']-q['production_quote'],base['mean']-base['production_quote'])
   self.assertAlmostEqual(q['production_quote'],(1-w)*62+w*175)
 def test_endpoint_shift_uses_separate_weight_even_no_service(self):
  from frozen_pricing import endpoint_shift
  from rolling_impact import ImpactPath
  p=ImpactPath(((82*27,0),(82*32,5)));q=ImpactPath(((82*27,1),(82*32,6)))
  group={'weight':0.,'endpoint_weight':.5,'endpoint':{'years':[2028,2029,2030,2031],'sensitivities':[1.]*4,'paths':[[1.,2.,3.,4.]],'weights':[1.]}}
  self.assertAlmostEqual(endpoint_shift(p,q,group),2.)
if __name__=='__main__':unittest.main()
