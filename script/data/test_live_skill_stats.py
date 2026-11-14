import unittest, tempfile
from pathlib import Path
from refresh_live_skill_stats import term_value, number, read_historical_minutes, retain_previous_switch
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
 def test_outage_retains_original_switch_evidence_without_growing_it(self):
  previous={'season':2027,'generated_at':'2026-11-01T12:00:00Z','players':[
   {'nba_id':1,'minutes':120,'games':4,'raw_skills':{'SWITCH':.2},'skill_evidence_minutes':{'SWITCH':90},'switch_sample':{'covered_games':3,'status':'partial'}}]}
  feed={'season':2027,'players':[{'nba_id':1,'minutes':179,'games':6,'raw_skills':{'SWITCH':None,'FTD':.7}}]}
  retain_previous_switch(feed,previous)
  p=feed['players'][0]
  self.assertEqual(p['raw_skills'],{'SWITCH':.2,'FTD':.7})
  self.assertEqual(p['skill_evidence_minutes']['SWITCH'],90)
  self.assertEqual(p['switch_sample']['status'],'retained')
  self.assertEqual(p['switch_sample']['covered_games'],3)
  self.assertEqual(p['switch_sample']['stats_games'],6)
 def test_previous_season_or_missing_observation_never_becomes_current(self):
  for season,value in [(2026,.2),(2027,None),(2027,float('nan'))]:
   previous={'season':season,'players':[{'nba_id':1,'minutes':120,'games':4,'raw_skills':{'SWITCH':value}}]}
   feed={'season':2027,'players':[{'nba_id':1,'minutes':179,'games':6,'raw_skills':{'SWITCH':None}}]}
   retain_previous_switch(feed,previous)
   self.assertIsNone(feed['players'][0]['raw_skills']['SWITCH'])
if __name__=='__main__': unittest.main()
