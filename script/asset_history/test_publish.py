import copy, json, tempfile, unittest
from contextlib import contextmanager
from pathlib import Path
from datetime import date
from unittest.mock import patch
from publish import METHOD,OUT,merge,publish,validate
from quote_window import quote_window

@contextmanager
def observed_on(day):
 # Publication tests use a fixed calendar; checked-in data uses the real clock.
 with patch('publish.datetime') as clock:
  clock.now.return_value.date.return_value=date.fromisoformat(day)
  yield

def sample(d='2026-09-30'):
 return {'team':'UTA','date':d,'source_cutoff':d,'method':METHOD,'reporting_cap':164961000,'vintage':'published','finalized_through':d,'source_dates':dict.fromkeys(('ownership','contracts','epm','darko','skill'),d),'coverage':dict.fromkeys(('ownership','contracts','skill','pick_rights','injury_review'),True),'assets':[{'id':'1','kind':'player','name':'Test','value':100,'exposure':4,'source':'test'}],'total':100,'moves':[]}
class Checks(unittest.TestCase):
 def test_checked_in_inventory(self):
  root=OUT
  if not root.exists():self.skipTest('No checked-in inventories')
  for path in (root/'teams').glob('*.json'):
   for row in json.loads(path.read_text())['snapshots']:validate(row)
 @observed_on('2026-10-21')
 def test_closed_immutable(self):
  s=sample();x=merge({'snapshots':[]},s);s['assets'][0]['value']=101;s['total']=101
  with self.assertRaisesRegex(ValueError,'immutable'):merge(x,s)
 @observed_on('2026-10-21')
 def test_identical_closed_noop(self):
  s=sample();x=merge({'snapshots':[]},s);self.assertEqual(merge(x,s),x)
 @observed_on('2026-10-21')
 def test_daily_replaces_provisional(self):
  x=merge({'snapshots':[]},sample('2026-10-20'));x=merge(x,sample('2026-10-21'));self.assertEqual([p['date'] for p in x['snapshots']],['2026-10-21'])
 @observed_on('2026-10-21')
 def test_month_not_fabricated(self):
  x=merge({'snapshots':[]},sample('2026-09-29'));x=merge(x,sample('2026-10-01'));self.assertEqual(x['snapshots'][0]['date'],'2026-09-29');self.assertTrue(x['snapshots'][0]['closed'])
 def test_incomplete_rejected(self):
  x=sample();x['coverage']['contracts']=False
  with self.assertRaises(AssertionError):validate(x)
 def test_incomplete_coverage_names_team_gate_and_players(self):
  x=sample();x['team']='CHA';x['coverage']['contracts']=False
  x['player_coverage']={'missing_complete_contracts':['Missing Contract']}
  with self.assertRaisesRegex(AssertionError,'CHA.*contracts.*Missing Contract'):validate(x)
 def test_duplicates_rejected(self):
  x=sample();x['assets']*=2;x['total']=200
  with self.assertRaises(AssertionError):validate(x)
 def test_sum_rejected(self):
  x=sample();x['total']=99
  with self.assertRaises(AssertionError):validate(x)
 def test_missing_year_rejected(self):
  x=sample();x['assets'][0]['exposure']=3.9
  with self.assertRaises(AssertionError):validate(x)
 def test_nonfinite_rejected(self):
  x=sample();x['total']=float('nan')
  with self.assertRaises(AssertionError):validate(x)
 def test_cutoff_rejected(self):
  x=sample();x['source_cutoff']='2026-10-01'
  with self.assertRaises(AssertionError):validate(x)
 def test_failed_batch_no_write(self):
  with tempfile.TemporaryDirectory() as t:
   a=sample();b=copy.deepcopy(a);b['team']='BOS'
   with self.assertRaises(AssertionError):publish([a,b],Path(t))
   self.assertFalse(list(Path(t).rglob('*.json')))
 def test_quote_penalizes_salary(self):
  p=[20]*4;e=[1]*4
  def q(c):return quote_window(p,[v+.8*(v-c)for v in p],e)['quote']
  self.assertAlmostEqual(q(30),48);self.assertAlmostEqual(q(10),112)
 def test_source_lag_is_disclosed_not_future(self):
  x=sample();x['source_dates']['skill']='2026-09-29';validate(x)
  x['source_dates']['skill']='2026-10-01'
  with self.assertRaisesRegex(AssertionError,'Future source'):validate(x)
 @observed_on('2026-09-30')
 def test_month_end_morning_not_sealed(self):
  x=merge({'snapshots':[]},sample())
  self.assertFalse(x['snapshots'][0]['closed'])
 @observed_on('2026-10-01')
 def test_past_month_observation_sealed_with_actual_date(self):
  s=sample();del s['finalized_through']
  self.assertTrue(merge({'snapshots':[]},s)['snapshots'][0]['closed'])
 def test_missing_source_dates_rejected(self):
  x=sample();del x['source_dates']
  with self.assertRaisesRegex(AssertionError,'dated source'):validate(x)
 def test_partial_league_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   with self.assertRaisesRegex(AssertionError,'all 30'):publish([sample()],Path(t),require_league=True)
 @observed_on('2026-10-21')
 def test_stale_candidate_rejected(self):
  x=merge({'snapshots':[]},sample('2026-10-21'))
  with self.assertRaisesRegex(ValueError,'Stale'):merge(x,sample('2026-10-20'))
 def test_month_rollover_seals_last_actual_observation(self):
  for last_day,next_day in (('2026-10-30','2026-11-01'),('2026-12-30','2027-01-01')):
   with self.subTest(next_day=next_day):
    with observed_on(last_day):
     x=merge({'snapshots':[]},sample(last_day))
     self.assertFalse(x['snapshots'][0]['closed'])
    with observed_on(next_day):
     x=merge(x,sample(next_day))
     self.assertEqual([p['date'] for p in x['snapshots']],[last_day,next_day])
     self.assertEqual([p['closed'] for p in x['snapshots']],[True,False])
     self.assertEqual(x['snapshots'][0]['closed_at'],next_day)
     changed=sample(last_day);changed['assets'][0]['value']=101;changed['total']=101
     with self.assertRaisesRegex(ValueError,'immutable'):merge(x,changed)
 def test_partial_seasons(self):
  e=[.1,1,1,1,.9];p=[0,10,20,30,40];q=quote_window(p,[x+.8*(x-10)for x in p],e)
  self.assertEqual(sum(q['selected_exposure']),2);self.assertAlmostEqual(q['production_quote'],136)
if __name__=='__main__':unittest.main()

