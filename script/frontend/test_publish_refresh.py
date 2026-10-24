import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('publish_refresh.sh').resolve()

class PublishRefreshTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / 'remote.git'
        self.work = self.root / 'worker'
        self.git(self.root, 'init', '--bare', '--initial-branch=main', str(self.remote))
        self.git(self.root, 'clone', str(self.remote), str(self.work))
        self.configure(self.work)
        (self.work / 'data').write_text('baseline')
        self.git(self.work, 'add', 'data')
        self.git(self.work, 'commit', '-m', 'baseline')
        self.git(self.work, 'push', 'origin', 'main')
        self.base = self.git(self.work, 'rev-parse', 'HEAD').strip()
        (self.work / 'data').write_text('refreshed')
        self.git(self.work, 'add', 'data')

    def git(self, cwd, *args):
        return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout

    def configure(self, path):
        self.git(path, 'config', 'user.name', 'Refresh test')
        self.git(path, 'config', 'user.email', 'refresh-test@example.invalid')

    def run_publish(self):
        return subprocess.run(['bash', str(SCRIPT), 'Refresh test data'], cwd=self.work, capture_output=True, text=True)

    def test_publishes_current_data(self):
        result = self.run_publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.remote, 'show', 'main:data'), 'refreshed')

    def test_superseded_run_does_not_overwrite_newer_source(self):
        writer = self.root / 'writer'
        self.git(self.root, 'clone', str(self.remote), str(writer))
        self.configure(writer)
        (writer / 'source').write_text('newer model')
        self.git(writer, 'add', 'source')
        self.git(writer, 'commit', '-m', 'New model')
        self.git(writer, 'push', 'origin', 'main')
        result = self.run_publish()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('superseded', result.stdout)
        self.assertEqual(self.git(self.remote, 'show', 'main:data'), 'baseline')
        self.assertEqual(self.git(self.remote, 'show', 'main:source'), 'newer model')

    def test_real_publication_error_still_fails(self):
        self.git(self.work, 'remote', 'set-url', '--push', 'origin', str(self.root / 'missing.git'))
        result = self.run_publish()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Publishing failed without a superseding source change', result.stderr)

if __name__ == '__main__':
    unittest.main()
