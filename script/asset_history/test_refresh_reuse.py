import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from refresh import main
from model_version import METHOD,data_root
from publish import TEAMS
from source_signature import source_signature


class PublishedInputReuse(unittest.TestCase):
    def test_unchanged_validated_inputs_can_be_reused_across_midnight_without_redating(self):
        with tempfile.TemporaryDirectory()as folder:
            args=self.fixture(Path(folder));args.allow_reconstructed=False
            with patch('refresh.subprocess.run')as compute:
                result=main(args)
            self.assertTrue(result['reused_identical_published_inputs'])
            self.assertEqual(result['observation_date'],'2026-11-01')
            compute.assert_not_called()

    def fixture(self,root):
        day='2026-11-01';raw=root/'raw/live';raw.mkdir(parents=True)
        (raw/'player_pool.json').write_text(json.dumps({'generated_at':day+'T12:00:00Z'}))
        out=data_root(root);out.mkdir(parents=True)
        (out/'attribution').mkdir()
        (out/'attribution/manifest.json').write_text(json.dumps({'latest':day,'method':'rolling-production-attribution-v1'}))
        (out/'manifest.json').write_text(json.dumps({'teams':[dict(team=t,latest=day)for t in TEAMS]}))
        (out/'refresh_status.json').write_text(json.dumps(dict(status='success',method=METHOD,
            observation_date=day,source_signature=source_signature(root))))
        return SimpleNamespace(repo=root,work_dir=root/'work',allow_reconstructed=True,reseed=False,draws=10000)

    def test_identical_same_day_inputs_reuse_the_validated_publication(self):
        with tempfile.TemporaryDirectory()as folder:
            args=self.fixture(Path(folder))
            with patch('refresh.subprocess.run')as compute:
                result=main(args)
                self.assertTrue(result['reused_identical_published_inputs'])
                compute.assert_not_called()

    def test_missing_attribution_requires_rebuilding_the_complete_publication(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);args=self.fixture(root)
            (data_root(root)/'attribution/manifest.json').unlink()
            with patch('refresh.subprocess.run',return_value=SimpleNamespace(returncode=1))as compute:
                with self.assertRaisesRegex(ValueError,'Player refresh failed'):main(args)
                compute.assert_called_once()

    def test_fresh_input_runs_the_model_instead_of_reusing_a_cached_quote(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);args=self.fixture(root)
            (root/'raw/live/ratings.json').write_text('{"new_provider_observation":true}')
            with patch('refresh.subprocess.run',return_value=SimpleNamespace(returncode=1))as compute:
                with self.assertRaisesRegex(ValueError,'Player refresh failed'):main(args)
                compute.assert_called_once()


if __name__=='__main__':unittest.main()

