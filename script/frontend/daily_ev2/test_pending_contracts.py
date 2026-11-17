import unittest,copy
from pending_contracts import memberships,priced_roster,native_asset_ledger,overlay_recent_terms
DAY='2026-11-17'
class Tests(unittest.TestCase):
 def setUp(self):
  self.book={'as_of':DAY,'complete':True,'players':[{'nba_id':1,'team':'UTA'}],'contract_pending':[{'nba_id':2,'team':'UTA','player_name':'Pending','known_from':DAY,'source':'https://example.test/official','event_id':'E2'}]}
  self.rows=[{'nba_id':i,'team':'UTA','pool_status':'roster'}for i in (1,2)]
 def test_pending_not_asset(self):self.assertEqual([x['nba_id']for x in priced_roster(self.rows,self.book,DAY)],[1])
 def test_unchanged_priced(self):
  self.book['contract_pending']=[];self.assertEqual(priced_roster(self.rows[:1],self.book,DAY),self.rows[:1])
 def test_unconfirmed_rejected(self):
  self.book['contract_pending']=[]
  with self.assertRaisesRegex(ValueError,'Unapproved'):priced_roster(self.rows,self.book,DAY)
 def test_wrong_team(self):
  self.rows[1]['team']='BOS'
  with self.assertRaisesRegex(ValueError,'Wrong pending'):priced_roster(self.rows,self.book,DAY)
 def test_future_pending(self):
  self.book['contract_pending'][0]['known_from']='2026-11-18'
  with self.assertRaisesRegex(ValueError,'future'):memberships(self.book,DAY)
 def test_missing_evidence(self):
  del self.book['contract_pending'][0]['event_id']
  with self.assertRaisesRegex(ValueError,'Unverified'):memberships(self.book,DAY)
 def test_overlap_rejected(self):
  self.book['contract_pending'][0]['nba_id']=1
  with self.assertRaisesRegex(ValueError,'also priced'):memberships(self.book,DAY)
 def test_missing_signed_rejected(self):
  with self.assertRaisesRegex(ValueError,'Incomplete'):priced_roster(self.rows[1:],self.book,DAY)
 def test_native_excludes_current_only(self):
  ledger=[{'cutoff_date':'2026-11-14','roster':copy.deepcopy(self.rows)},{'cutoff_date':DAY,'roster':copy.deepcopy(self.rows)}];old=copy.deepcopy(ledger);new=native_asset_ledger(ledger,DAY,{2});self.assertEqual(ledger,old);self.assertEqual(new[0],old[0]);self.assertEqual(new[1]['roster'],self.rows[:1])
 def test_missing_pending_in_ledger(self):
  with self.assertRaisesRegex(ValueError,'exclusion'):native_asset_ledger([{'cutoff_date':DAY,'roster':self.rows[:1]}],DAY,{2})
class TermsTests(unittest.TestCase):
 def setUp(self):
  self.book={'as_of':DAY,'complete':True,'players':[{'nba_id':1,'team':'UTA'}]}
  self.e={'event_id':'S1','date':'2026-11-15','parsed_actions':[{'action':'add','nba_id':1,'to_team':'UTA'}]}
  self.a={'nba_id':1,'player_name':'Player','known_from':'2026-11-15','signing_team':'UTA','source':'verified','pending_event_id':'S1','pending_event_date':'2026-11-15','schedule_complete':True,'resets_prior_schedule':True,'salaries':[{'year':2027,'amount':100}]}
 def run_overlay(self,base=None):return overlay_recent_terms(base or [],[self.a],[self.e],self.book,DAY)
 def test_reviewed_new_episode(self):self.assertEqual(self.run_overlay(),[self.a])
 def test_later_trade_retains_terms(self):
  self.book['players'][0]['team']='BOS';self.assertEqual(self.run_overlay(),[self.a])
 def test_waived_retains_terms(self):
  self.book['players']=[];self.assertEqual(self.run_overlay(),[self.a])
 def test_wrong_signing_team(self):
  self.a['signing_team']='BOS'
  with self.assertRaisesRegex(ValueError,'player/team'):self.run_overlay()
 def test_roster_capture_rejected(self):
  self.e['parsed_status']='roster_capture'
  with self.assertRaisesRegex(ValueError,'original signing'):self.run_overlay()
 def test_overwrite_rejected(self):
  old=copy.deepcopy(self.a);old['salaries'][0]['amount']=101
  with self.assertRaisesRegex(ValueError,'overwrite frozen'):self.run_overlay([old])
 def test_duplicate_exact_idempotent(self):self.assertEqual(self.run_overlay([self.a]),[self.a])
 def test_future_rejected(self):
  self.a['known_from']='2026-11-18'
  with self.assertRaisesRegex(ValueError,'date outside'):self.run_overlay()
if __name__=='__main__':unittest.main()
