import json,tempfile,unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
from espn_ownership import API,parse,capture_additions,validate_captures,collect,event

class EspnOwnership(unittest.TestCase):
 def pool(self):
  return {'players':[{'player_name':name,'nba_id':pid,'team':team,'pool_status':'roster',
    'last_seen':'2026-10-30T10:00:00Z','source_url':API+'/teams/13/roster'}
    for name,pid,team in [('AK Okereke',1,'LAL'),('Lawson Lovering',2,'LAL'),('Enrique Freeman',3,'MIN'),('Blake Wesley',4,'LAC')]]}
 def test_combined_waiver_and_signing_keep_independent_actions_and_dates(self):
  rows=[{'date':'2026-10-28T07:00Z','description':'Waived F AK Okereke. Signed C Lawson Lovering to a two-way contract.','team':{'abbreviation':'LAL'}}]
  result=parse(rows,self.pool(),'2026-10-26','2026-10-30')
  self.assertEqual([e['parsed_actions'][0]['action']for e in result],['remove','add'])
  self.assertEqual([e['players'][0]['nba_id']for e in result],[1,2])
  self.assertTrue(result[1]['parsed_actions'][0]['two_way']);self.assertEqual(result[1]['date'],'2026-10-28')
 def test_trades_cannot_drop_pick_claims(self):
  rows=[{'date':'2026-10-29','description':'Acquired Blake Wesley and a first-round pick.','team':{'abbreviation':'LAC'}}]
  with self.assertRaisesRegex(ValueError,'pick direction review'):parse(rows,self.pool(),'2026-10-26','2026-10-30')
 def test_conversion_to_standard_contract_does_not_keep_two_way_role(self):
  rows=[{'date':'2026-10-29','description':'Converted C Lawson Lovering from a two-way contract to a standard contract.','team':{'abbreviation':'LAL'}}]
  result=parse(rows,self.pool(),'2026-10-26','2026-10-30')
  self.assertFalse(result[0]['parsed_actions'][0]['two_way'])
 def test_multiple_team_options_are_contract_events_without_roster_changes(self):
  rows=[{'date':'2026-10-29','description':'Exercised the third-year team options on Fs AK Okereke and Lawson Lovering.','team':{'abbreviation':'LAL'}}]
  result=parse(rows,self.pool(),'2026-10-26','2026-10-30')
  self.assertEqual(len(result),1);self.assertEqual(result[0]['parsed_actions'],[])
  self.assertEqual({p['nba_id']for p in result[0]['players']},{1,2})
  self.assertEqual(result[0]['contract_option'],dict(decision='exercised',kind='team_option',ordinal=3))
 def test_contract_option_with_an_unknown_additional_person_is_rejected(self):
  rows=[{'date':'2026-10-29','description':'Exercised the third-year team options on Fs AK Okereke and Unknown Player.','team':{'abbreviation':'LAL'}}]
  with self.assertRaisesRegex(ValueError,'identities'):parse(rows,self.pool(),'2026-10-26','2026-10-30')
 def test_unidentified_and_multiple_players_stop_publication(self):
  for text in ['Signed C Unknown Player.','Waived F AK Okereke and C Lawson Lovering.','Waived F AK Okereke and Unknown Player.']:
   with self.assertRaisesRegex(ValueError,'identities'):
    parse([{'date':'2026-10-29','description':text,'team':{'abbreviation':'LAL'}}],self.pool(),'2026-10-26','2026-10-30')
 def test_same_name_different_ids_require_review(self):
  pool=self.pool();pool['players'].append({**pool['players'][0],'nba_id':999})
  with self.assertRaisesRegex(ValueError,'Ambiguous'):
   parse([{'date':'2026-10-29','description':'Waived F AK Okereke.','team':{'abbreviation':'LAL'}}],pool,'2026-10-26','2026-10-30')
 def test_previous_and_future_transactions_are_not_inserted(self):
  rows=[{'date':d,'description':'Signed F Enrique Freeman.','team':{'abbreviation':'MIN'}}for d in ['2026-10-26','2026-10-31']]
  self.assertEqual(parse(rows,self.pool(),'2026-10-26','2026-10-30'),[])
 def test_roster_capture_requires_observed_membership_and_new_verified_contract(self):
  with tempfile.TemporaryDirectory()as folder:
   runtime=Path(folder);root=runtime/'monthly_reconstruction/league_ownership';root.mkdir(parents=True)
   pool=self.pool();pool['players']=pool['players'][-1:]
   (root/'monthly_league_rosters.json').write_text(json.dumps([{'cutoff_date':'2026-10-30','roster':[]}]))
   removed=event('2026-10-17','Waived Blake Wesley.',pool['players'][0],'LAC','remove')
   (root/'league_events.json').write_text(json.dumps([removed]))
   pool['players'][0]['review_pending']=True
   self.assertEqual(capture_additions(runtime,pool,'2026-10-30'),[])
   pool['players'][0]['review_pending']=False
   added=capture_additions(runtime,pool,'2026-10-30');self.assertEqual(added[0]['date'],'2026-10-30')
   contracts=runtime/'contracts';contracts.mkdir();path=contracts/'contract_agreements.json'
   path.write_text(json.dumps([{'nba_id':4,'known_from':'2026-10-01','signing_team':'LAC','schedule_complete':True}]))
   ignored=validate_captures(runtime,contracts,'2026-10-30')
   self.assertEqual(ignored[0]['nba_id'],4)
   self.assertEqual(json.loads((root/'league_events.json').read_text()),[removed])
   capture_additions(runtime,pool,'2026-10-30')
   path.write_text(json.dumps([{'nba_id':4,'known_from':'2026-10-29','signing_team':'LAC','schedule_complete':True}]))
   self.assertEqual(validate_captures(runtime,contracts,'2026-10-30'),[])
 def test_truncated_pagination_is_rejected(self):
  payload={'pageCount':1,'status':'success','season':{'year':2027},'timestamp':'2026-10-30T10:00:00Z','count':2,'transactions':[{}]}
  with patch('espn_ownership.fetch_json',return_value=payload),patch('espn_ownership.datetime',wraps=datetime)as clock:
   clock.now.return_value=datetime(2026,10,30,12,tzinfo=timezone.utc)
   with self.assertRaisesRegex(ValueError,'Truncated'):collect('2026-10-30')
 def test_capture_freshness_boundaries(self):
  for stamp,accepted in [('2026-10-28T12:00:00Z',True),('2026-10-28T11:59:59Z',False),('2026-10-30T12:00:00Z',True),('2026-10-30T13:00:01Z',False)]:
   with self.subTest(timestamp=stamp):
    payload={'pageCount':1,'status':'success','season':{'year':2027},'timestamp':stamp,'count':0,'transactions':[]}
    with patch('espn_ownership.fetch_json',return_value=payload),patch('espn_ownership.datetime',wraps=datetime)as clock:
     clock.now.return_value=datetime(2026,10,30,12,tzinfo=timezone.utc)
     if accepted:self.assertEqual(collect('2026-10-30'),([],stamp))
     else:
      with self.assertRaisesRegex(ValueError,'Stale or future'):collect('2026-10-30')
 def test_resilient_mode_applies_player_transfers_and_logs_pending_trade(self):
  rows=[
   {'date':'2026-10-29','description':'Acquired Blake Wesley and a first-round pick.','team':{'abbreviation':'LAC'}},
   {'date':'2026-10-29','description':'Traded Blake Wesley and a first-round pick to LAC.','team':{'abbreviation':'LAL'}},
   {'date':'2026-10-29','description':'Traded a 2029 second-round pick for cash considerations.','team':{'abbreviation':'MIN'}},
  ]
  pending=[]
  result=parse(rows,self.pool(),'2026-10-26','2026-10-30',allow_unreviewed_trades=True,pending_trades=pending)
  self.assertEqual(len(result),1)
  self.assertEqual(result[0]['parsed_status'],'trade')
  self.assertTrue(result[0]['unreviewed_trade'])
  self.assertEqual(result[0]['parsed_actions'],[{'player_name':'Blake Wesley','nba_id':4,'to_team':'LAC','action':'transfer','two_way':False}])
  self.assertEqual(len(pending),3)

if __name__=='__main__':unittest.main()

