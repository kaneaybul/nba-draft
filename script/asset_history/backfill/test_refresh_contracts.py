import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from refresh_contracts import refresh

class RefreshContracts(unittest.TestCase):
 def setup_files(self,root):
  seed=[dict(nba_id=1,player_name='One',known_from='2025-07-01',salaries=[dict(year=2027,amount=10)]),dict(nba_id=2,player_name='Two',known_from='2025-07-01',salaries=[dict(year=2027,amount=20)])]
  (root/'contract_agreements.json').write_text(json.dumps(seed));(root/'refresh_state.json').write_text(json.dumps(dict(ledger_asof='2026-10-25',last_checked={'1':'2026-10-25','2':'2026-10-25'})))
  pool=dict(generated_at='2026-10-26T12:00Z',players=[dict(nba_id=i,player_name=n,pool_status='roster',team='BOS')for i,n in[(1,'One'),(2,'Two')]],changes=[])
  pp=root/'pool.json';pp.write_text(json.dumps(pool));ep=root/'events.json';ep.write_text(json.dumps([dict(date='2026-10-26',type='Extension',players=[dict(name='One')])]))
  return pp,ep,seed
 def test_source_failure_preserves_original_and_retries(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,seed=self.setup_files(root)
   with patch('refresh_contracts.fetch_one',return_value=dict(nba_id=1,player_name='One',status='unavailable',agreements=[])):
    report=refresh(root,pp,ep,'2026-10-26',rotation_limit=0)
   self.assertEqual(report['failed_mandatory_player_ids'],[1]);self.assertEqual(json.loads((root/'contract_agreements.json').read_text()),seed)
   self.assertEqual(json.loads((root/'refresh_state.json').read_text())['pending_player_ids'],[1])
 def test_success_updates_only_changed_player(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,seed=self.setup_files(root);new=dict(nba_id=1,player_name='One',known_from='2026-10-26',salaries=[dict(year=2028,amount=30)])
   with patch('refresh_contracts.fetch_one',return_value=dict(nba_id=1,player_name='One',status='available',agreements=[seed[0],new]))as fetch:
    report=refresh(root,pp,ep,'2026-10-26',rotation_limit=0)
   stored=json.loads((root/'contract_agreements.json').read_text());self.assertIn(seed[1],stored);self.assertIn(new,stored);self.assertFalse(report['failed_mandatory_player_ids']);self.assertEqual(fetch.call_args.args[-1],'2026-10-26')
 def test_future_pool_rejected(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,_=self.setup_files(root)
   with self.assertRaises(ValueError):refresh(root,pp,ep,'2026-10-25',rotation_limit=0)
 def test_verified_internal_alias_survives_source_table_refresh(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,seed=self.setup_files(root);seed[0]['app_id_aliases']=[-2027010];seed[0]['player_name_aliases']=['Old One'];(root/'contract_agreements.json').write_text(json.dumps(seed))
   new=dict(nba_id=1,player_name='One',known_from='2026-10-26',salaries=[dict(year=2028,amount=30)])
   with patch('refresh_contracts.fetch_one',return_value=dict(nba_id=1,player_name='One',status='available',agreements=[new])):refresh(root,pp,ep,'2026-10-26',rotation_limit=0)
   refreshed=next(a for a in json.loads((root/'contract_agreements.json').read_text())if a['nba_id']==1)
   self.assertEqual(refreshed['app_id_aliases'],[-2027010]);self.assertEqual(refreshed['player_name_aliases'],['Old One'])
 def test_authoritative_roster_discovers_name_only_and_pool_omission(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,seed=self.setup_files(root)
   roster=root/'roster.json';roster.write_text(json.dumps([dict(cutoff_date='2026-10-26',roster=[dict(player_name='One',nba_id=1,team='BOS'),dict(player_name='New Camp',nba_id=None,team='BOS',realgm_profile='https://basketball.realgm.com/player/New-Camp/Summary/999'),dict(player_name='Missed by ESPN',nba_id=3,team='UTA')])]))
   def response(player,*args):
    return dict(**player,status='available',agreements=[dict(nba_id=player['nba_id'],player_name=player['player_name'],known_from='2026-10-26',salaries=[dict(year=2027,amount=30)])])
   with patch('refresh_contracts.fetch_one',side_effect=response)as fetch:
    report=refresh(root,pp,ep,'2026-10-26',rotation_limit=20,roster_path=roster)
   selected={call.args[0]['nba_id']for call in fetch.call_args_list}
   self.assertEqual(selected,{1,3,-9000000999});self.assertNotIn(2,selected)
   self.assertFalse(report['failed_mandatory_player_ids']);self.assertEqual(report['discovery']['ownership_source'],'dated_ownership_replay')
   stored=json.loads((root/'contract_agreements.json').read_text());self.assertIn(seed[1],stored)
   camp=next(a for a in stored if a['nba_id']==-9000000999);self.assertEqual(camp['identity_kind'],'realgm_profile_source_id');self.assertFalse(camp['nba_id_confirmed'])
 def test_recent_dated_signing_absent_from_pool_is_discovered(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,_=self.setup_files(root)
   ep.write_text(json.dumps([dict(date='2026-10-26',parsed_actions=[dict(player_name='New Camp',nba_id=None,action='add',to_team='UTA')],players=[dict(name='New Camp',realgm_url='https://basketball.realgm.com/player/New-Camp/Summary/999')])]))
   def response(player,*args):return dict(**player,status='available',agreements=[dict(nba_id=player['nba_id'],player_name=player['player_name'],known_from='2026-10-26',salaries=[dict(year=2027,amount=30)])])
   with patch('refresh_contracts.fetch_one',side_effect=response)as fetch:report=refresh(root,pp,ep,'2026-10-26',rotation_limit=0)
   self.assertEqual(report['mandatory_player_ids'],[-9000000999]);self.assertEqual(fetch.call_args.args[0]['realgm_profile'],'https://basketball.realgm.com/player/New-Camp/Summary/999')
 def test_fresh_source_profile_cannot_reuse_other_person_url(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);pp,ep,seed=self.setup_files(root);seed[0]['source']='https://www.salaryswish.com/players/one';(root/'contract_agreements.json').write_text(json.dumps(seed))
   roster=root/'roster.json';roster.write_text(json.dumps([dict(cutoff_date='2026-10-26',roster=[dict(player_name='One',nba_id=None,team='BOS',realgm_profile='https://basketball.realgm.com/player/One/Summary/999')])]))
   def response(player,*args):return dict(**player,status='available',url=seed[0]['source'],agreements=[dict(nba_id=player['nba_id'],player_name='One',known_from='2026-10-26',salaries=[])])
   with patch('refresh_contracts.fetch_one',side_effect=response):report=refresh(root,pp,ep,'2026-10-26',rotation_limit=0,roster_path=roster)
   self.assertEqual(report['failed_mandatory_player_ids'],[-9000000999]);self.assertEqual(report['results'][0]['status'],'identity_review_required')
   self.assertEqual(json.loads((root/'contract_agreements.json').read_text()),seed)

if __name__=='__main__':unittest.main()
