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


if __name__=='__main__':unittest.main()
