import json,tempfile,unittest
from pathlib import Path
from run_player_refresh import stage_state
from ownership_runtime import restore_events,save_events

class DailyState(unittest.TestCase):
 def test_method_reseed_keeps_dated_sources_but_resets_model_states(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);saved=root/'saved';saved.mkdir()
   (saved/'BOS.json').write_text(json.dumps({'as_of':'2026-11-01','posterior':2}))
   for name in ('latest_inputs.json.gz','ownership_events.json','injury_episodes.json'):(saved/name).write_bytes(b'source-evidence')
   staged=root/'staged';self.assertTrue(stage_state(saved,staged,'2026-11-01',reseed=True))
   self.assertFalse((staged/'BOS.json').exists())
   for name in ('latest_inputs.json.gz','ownership_events.json','injury_episodes.json'):self.assertEqual((staged/name).read_bytes(),b'source-evidence')
 def test_verified_signing_keeps_its_first_capture_date_on_next_refresh(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);runtime=root/'runtime';ledger=runtime/'monthly_reconstruction/league_ownership';ledger.mkdir(parents=True)
   state=root/'state';state.mkdir()
   seed={'event_id':'SEED','date':'2026-10-26','text':'Seed event'}
   capture={'event_id':'CAPTURE','date':'2026-10-30','text':'Confirmed signing first observed on October 30'}
   path=ledger/'league_events.json';path.write_text(json.dumps([seed]))
   (state/'ownership_events.json').write_text(json.dumps([capture]))
   seed_ids=restore_events(runtime,state)
   self.assertEqual(json.loads(path.read_text()),[seed,capture])
   self.assertEqual(json.loads((ledger/'ownership_seed_cutoff.json').read_text())['date'],'2026-10-26')
   save_events(runtime,state,seed_ids)
   self.assertEqual(json.loads((state/'ownership_events.json').read_text()),[capture])
 def test_same_day_retry_starts_before_todays_update(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);saved=root/'saved';prior=saved/'prior_day';prior.mkdir(parents=True)
   (saved/'BOS.json').write_text(json.dumps({'as_of':'2026-10-26','posterior':2}))
   (prior/'BOS.json').write_text(json.dumps({'as_of':'2026-10-25','posterior':1}))
   (prior/'latest_inputs.json.gz').write_bytes(b'previous-panel')
   staged=root/'staged';self.assertFalse(stage_state(saved,staged,'2026-10-26'))
   self.assertEqual(json.loads((staged/'BOS.json').read_text())['posterior'],1)
   self.assertEqual((staged/'latest_inputs.json.gz').read_bytes(),b'previous-panel')
   self.assertEqual(json.loads((staged/'prior_day/BOS.json').read_text())['posterior'],1)
 def test_new_day_keeps_current_day_as_rollback_checkpoint(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);saved=root/'saved';saved.mkdir()
   (saved/'BOS.json').write_text(json.dumps({'as_of':'2026-10-26','posterior':2}))
   staged=root/'staged';self.assertFalse(stage_state(saved,staged,'2026-10-27'))
   self.assertEqual(json.loads((staged/'prior_day/BOS.json').read_text())['posterior'],2)
 def test_first_checkpoint_same_day_reseeds_instead_of_double_counting(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);saved=root/'saved';saved.mkdir()
   (saved/'BOS.json').write_text(json.dumps({'as_of':'2026-10-26','posterior':2}))
   staged=root/'staged';self.assertTrue(stage_state(saved,staged,'2026-10-26'))
   self.assertFalse((staged/'BOS.json').exists())
 def test_stale_capture_cannot_move_state_backward(self):
  with tempfile.TemporaryDirectory()as directory:
   root=Path(directory);saved=root/'saved';saved.mkdir()
   (saved/'BOS.json').write_text(json.dumps({'as_of':'2026-10-26'}))
   with self.assertRaisesRegex(ValueError,'earlier day'):stage_state(saved,root/'staged','2026-10-25')

if __name__=='__main__':unittest.main()
