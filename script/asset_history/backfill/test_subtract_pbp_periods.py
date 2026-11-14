import unittest
from subtract_pbp_periods import difference,denominator,reconstruct

def source(points,seconds,fgreb,pct):
 return {'EntityId':'1','Name':'Player','Points':points,'SecondsPlayed':seconds,'OffPoss':points*2,'DefPoss':points*2+5,'OffTwoPtRebounds':fgreb,'OffThreePtRebounds':0,'OffFGReboundPct':pct}
class Checks(unittest.TestCase):
 def setUp(self):self.full=source(200,12000,10,.1);self.tail=source(80,4800,4,.1);self.nba={'nba_id':1,'points':120,'minutes':120,'games':5}
 def test_additive_counts_and_recovered_denominator(self):
  r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(e);self.assertEqual(r['Points'],120);self.assertEqual(r['SecondsPlayed'],7200);self.assertAlmostEqual(r['OffFGReboundPct'],.1);self.assertEqual(r['GamesPlayed'],5)
 def test_unknown_tail_denominator_retains_component_prior(self):
  self.tail['OffTwoPtRebounds']=0;self.tail['OffFGReboundPct']=0;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(e);self.assertIsNone(r['OffFGReboundPct']);self.assertIn('prior',r['_OREB_reconstruction_flag'])
 def test_future_tail_missing_is_not_zero(self):
  r,e=difference(self.full,None,self.nba);self.assertIsNone(r);self.assertIn('later',e)
 def test_no_later_games_can_have_exact_zero_tail(self):
  nba={'points':200,'minutes':200,'games':8};r,e=difference(self.full,None,nba,no_later_games=True);self.assertIsNone(e);self.assertAlmostEqual(r['OffFGReboundPct'],.1)
 def test_negative_difference_rejected(self):
  self.tail['Points']=300;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(r);self.assertIn('Negative',e)
 def test_independent_point_mismatch_rejected(self):
  self.nba['points']=121;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(r);self.assertIn('point-count',e)
 def test_independent_minutes_mismatch_rejected(self):
  self.nba['minutes']=100;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(r);self.assertIn('minutes',e)
 def test_impossible_rebound_fraction_retains_prior(self):
  self.tail['OffFGReboundPct']=4/95;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(e);self.assertIsNone(r['OffFGReboundPct'])
 def test_empirical_discrepancy_is_flagged_without_changing_counter(self):
  self.nba['points']=121;r,e=difference(self.full,self.tail,self.nba,point_tolerance=2,minute_tolerance=6);self.assertIsNone(e);self.assertEqual(r['Points'],120);self.assertEqual(r['_NBA_reference_disagreement']['point_delta'],-1)
 def test_material_discrepancy_still_rejected(self):
  self.nba['points']=130;r,e=difference(self.full,self.tail,self.nba,point_tolerance=2,minute_tolerance=6);self.assertIsNone(r);self.assertIn('outside',e)
 def test_positive_prefix_with_no_NBA_minutes_rejected(self):
  self.nba['minutes']=0;r,e=difference(self.full,self.tail,self.nba,point_tolerance=2,minute_tolerance=6);self.assertIsNone(r);self.assertIn('zero-minute',e)
 def test_unused_negative_counter_is_flagged_not_consumed(self):
  self.tail['NonHeaveArc3FGA']=1;r,e=difference(self.full,self.tail,self.nba);self.assertIsNone(e);self.assertEqual(r['_unused_negative_counts']['NonHeaveArc3FGA'],-1)
 def test_noninteger_implied_opportunities_are_unknown(self):
  self.full['OffFGReboundPct']=.101;self.assertIsNone(denominator(self.full))
if __name__=='__main__':unittest.main()
