"""Regression coverage for runtime setup in Work containers without a home."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class WorkRuntimeSetupTests(unittest.TestCase):
    def test_bootstrap_uses_runtime_local_home_and_caches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo with spaces'
            scripts = root / 'script/frontend'
            scripts.mkdir(parents=True)
            shutil.copyfile(Path(__file__).with_name('setup_work_runtime.sh'),
                            scripts / 'setup_work_runtime.sh')
            runtime = root / 'runtime with spaces'
            for sub in ('bin', 'nba-python/bin'):
                (runtime / sub).mkdir(parents=True)
            mamba = runtime / 'bin/micromamba'
            mamba.write_text('''#!/bin/sh
set -eu
test -d "$HOME"
while [ "$1" != "-p" ]; do shift; done
shift
mkdir -p "$1/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$1/bin/Rscript"
chmod +x "$1/bin/Rscript"
''')
            python = runtime / 'nba-python/bin/python3'
            python.write_text('''#!/bin/sh
set -eu
test -d "$HOME"
test -d "$PIP_CACHE_DIR"
test "$1" = -m
test "$2" = pip
''')
            mamba.chmod(0o755)
            python.chmod(0o755)
            env = {**os.environ, 'HOME': str(root / 'nonexistent-home'),
                   'NBA_WORK_RUNTIME': str(runtime)}
            subprocess.run(['bash', str(scripts / 'setup_work_runtime.sh')],
                           env=env, check=True, capture_output=True, text=True)
            result = subprocess.run(
                ['bash', '-c', 'source "$1"; printf "%s" "$npm_config_cache"',
                 'test', str(runtime / 'environment.sh')],
                env=env, check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout, str(runtime / 'npm-cache'))
            self.assertFalse((root / 'nonexistent-home').exists())


if __name__ == '__main__':
    unittest.main()
