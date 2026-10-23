import unittest
from datetime import datetime,timezone
from live_results import build_results
class Results(unittest.TestCase):
 def data(self):
  now=datetime(2026,10,23,tzinfo=timezone.utc)
  event=lambda i:dict(id=str(i),seasonType={'type':2},date='2026-10-21T01:00:00Z',competitions=[{'status':{'type':{'completed':i==0}},'competitors':[{'homeAway':'home','team':{'abbreviation':'UTAH'},'score':{'value':110}},{'homeAway':'away','team':{'abbreviation':'NY'},'score':{'value':100}}]}])
  return {'UTA':{'events':[event(i) for i in range(1200)]},'NYK':{'events':[event(i) for i in range(1200)]}},now
 def test_deduplicates_finals_and_excludes_in_progress(self):
  d,now=self.data();r=build_results(d,2027,now);self.assertEqual(len(r['games']),1);self.assertEqual(r['games'][0]['result'],'UTA');self.assertEqual(r['games'][0]['date'],'2026-10-20')
 def test_reject_tied_final(self):
  d,now=self.data();d['UTA']['events'][0]['competitions'][0]['competitors'][1]['score']['value']=110
  with self.assertRaises(ValueError):build_results(d,2027,now)
 def test_reject_partial_schedule(self):
  with self.assertRaises(ValueError):build_results({'UTA':{'events':[]}},2027,datetime.now(timezone.utc))
if __name__=='__main__':unittest.main()
