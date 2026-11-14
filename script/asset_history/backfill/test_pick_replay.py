import unittest
from pick_replay import active_rules,event_instances,display_years

class ReplayStateTests(unittest.TestCase):
 def baseline(self):return {'complete':True,'asof':'2021-12-31','rules':[{'rule_id':'original','known_from':'2020-07-01','kind':'transfer','from_team':'UTA','to_team':'OKC','pick':['UTA',2028,2]}]}
 def action(self,kind,**kw):return dict(event_id='trade',known_from='2022-01-04',reviewed=True,source='original NBA release',kind=kind,**kw)
 def test_later_amendment_does_not_rewrite_earlier_knowledge(self):
  a=self.action('patch_rule',rule_id='original',changes=[dict(path=['to_team'],expected='OKC',value='NYK')])
  self.assertEqual(active_rules(self.baseline(),[a],'2021-12-31')['rules'][0]['to_team'],'OKC')
  self.assertEqual(active_rules(self.baseline(),[a],'2022-01-31')['rules'][0]['to_team'],'NYK')
 def test_prior_term_must_match_before_amendment(self):
  a=self.action('patch_rule',rule_id='original',changes=[dict(path=['to_team'],expected='PHX',value='NYK')])
  with self.assertRaisesRegex(ValueError,'Prior legal term'):active_rules(self.baseline(),[a],'2022-01-31')
 def test_unknown_catalog_event_never_defaults_to_complete(self):
  catalog=[dict(event_id='missing',known_from='2022-01-03',source='NBA release',source_text='A protected pick changes hands')]
  view=active_rules(self.baseline(),[],'2022-01-31',catalog);self.assertFalse(view['complete']);self.assertEqual(len(view['unresolved']),1)
 def test_duplicate_source_events_require_distinct_instance_coverage(self):
  catalog=[dict(event_id='same',known_from='2022-01-03',source='NBA release',source_text='Same-source firstleg'),dict(event_id='same',known_from='2022-01-03',source='NBA release',source_text='Same-source secondleg')]
  a=self.action('no_future_pick_effect',reason='Consumed draft selection',event_instance='same#0')
  view=active_rules(self.baseline(),[a],'2022-01-31',catalog);self.assertFalse(view['complete']);self.assertEqual(view['unresolved'][0]['event_instance'],'same#1')
 def test_economic_fallback_expires_on_dated_resolution(self):
  a=self.action('add_economic_claim',known_until='2022-03-01',claim={'claim_id':'fallback','from_team':'NYK','to_team':'POR','count':4})
  before=active_rules(self.baseline(),[a],'2022-02-28');after=active_rules(self.baseline(),[a],'2022-03-31')
  self.assertEqual(before['economic_claims'][0]['count'],4);self.assertEqual(after['economic_claims'],[])
 def test_new_own_horizon_enters_only_after_draft(self):
  dates={2026:'2026-06-24'};self.assertEqual(display_years('2026-05-31',dates),list(range(2026,2033)));self.assertEqual(display_years('2026-06-30',dates),list(range(2027,2034)))

if __name__=='__main__':unittest.main()
