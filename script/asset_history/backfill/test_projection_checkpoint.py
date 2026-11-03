import tempfile,unittest
from pathlib import Path
from projection_checkpoint import save,reuse,signature,FILES

class ProjectionCheckpoint(unittest.TestCase):
    def test_complete_matching_checkpoint_restores_outputs_and_states(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);output=root/'out';state=root/'state';state.mkdir();teams=['ATL','UTA']
            for t in teams:
                (output/t).mkdir(parents=True)
                for name in FILES:(output/t/name).write_text(t+' known dated input')
                (state/f'{t}.json').write_text(t+' observed state')
            cache=root/'cache';save(cache,output,state,teams,'known')
            destination=root/'restored';self.assertTrue(reuse(cache,destination,state,teams,'known'))
            self.assertEqual((destination/'UTA'/FILES[0]).read_text(),'UTA known dated input')
            self.assertFalse(reuse(cache,destination,state,teams,'different inputs'))
            (cache/'UTA'/FILES[0]).write_text('corrupt')
            self.assertFalse(reuse(cache,destination,state,teams,'known'))
    def test_raw_provider_or_producer_change_invalidates_but_path_target_is_reexported(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);runtime=root/'runtime';runtime.mkdir();(runtime/'input.csv').write_text('dated input')
            injuries=root/'injuries.json';injuries.write_text('[]')
            target=root/'script/asset_history/calibration';target.mkdir(parents=True);(target/'production.py').write_text('target one')
            before=signature(root,runtime,injuries,'2026-11-03')
            (target/'production.py').write_text('target two')
            self.assertEqual(before,signature(root,runtime,injuries,'2026-11-03'))
            (runtime/'input.csv').write_text('new observed input')
            self.assertNotEqual(before,signature(root,runtime,injuries,'2026-11-03'))
            before=signature(root,runtime,injuries,'2026-11-03')
            producer=root/'script/asset_history/backfill';producer.mkdir();(producer/'league_player_values.py').write_text('new producer')
            self.assertNotEqual(before,signature(root,runtime,injuries,'2026-11-03'))
if __name__=='__main__':unittest.main()
