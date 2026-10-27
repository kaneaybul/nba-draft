import json,tempfile,unittest
from pathlib import Path
from run_player_refresh import stage_state

class DailyState(unittest.TestCase):
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
