import tempfile,unittest
from pathlib import Path
from source_signature import source_signature


class InputFingerprint(unittest.TestCase):
    def test_new_evidence_or_model_changes_invalidate_but_outputs_do_not(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder)
            raw=root/'raw/live/ratings.json';raw.parent.mkdir(parents=True);raw.write_text('{"total":1}')
            code=root/'script/asset_history/model_version.py';code.parent.mkdir(parents=True);code.write_text('METHOD="v4"')
            original=source_signature(root)
            output=root/'frontend/public/data/asset_history/v4/refresh_status.json';output.parent.mkdir(parents=True);output.write_text('{}')
            self.assertEqual(original,source_signature(root))
            raw.write_text('{"total":2}');self.assertNotEqual(original,source_signature(root))
            raw.write_text('{"total":1}');code.write_text('METHOD="v5"')
            self.assertNotEqual(original,source_signature(root))
    def test_new_team_projections_invalidate_pick_portfolio_reuse(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);p=root/'frontend/public/data/v2/team_projections/2027.json'
            p.parent.mkdir(parents=True);p.write_text('[{"team":"UTA","total":0}]')
            old=source_signature(root);p.write_text('[{"team":"UTA","total":1}]')
            self.assertNotEqual(old,source_signature(root))


if __name__=='__main__':unittest.main()
