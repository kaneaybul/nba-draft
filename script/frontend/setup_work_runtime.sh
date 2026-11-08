#!/usr/bin/env bash
# Install the pinned R/Python dependencies without root or a paid runner.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
repo="$PWD"
runtime="${NBA_WORK_RUNTIME:-$repo/.work-runtime}"
mkdir -p "$runtime"
if [[ ! -x "$runtime/bin/micromamba" ]]; then
  python3 - "$runtime" <<'PY'
import io,pathlib,sys,tarfile,urllib.request
root=pathlib.Path(sys.argv[1])
url='https://micro.mamba.pm/api/micromamba/linux-64/2.10.0'
with urllib.request.urlopen(url,timeout=120) as response:
    data=response.read()
with tarfile.open(fileobj=io.BytesIO(data),mode='r:bz2') as archive:
    archive.extract(archive.getmember('bin/micromamba'),root,filter='data')
PY
fi
if [[ ! -x "$runtime/nba-r/bin/Rscript" ]]; then
  "$runtime/bin/micromamba" create -y -r "$runtime/mamba" -p "$runtime/nba-r" \
    --file "$repo/script/frontend/work_r_packages.lock"
fi
if [[ ! -x "$runtime/nba-python/bin/python3" ]]; then
  python3 -m venv --system-site-packages "$runtime/nba-python"
fi
"$runtime/nba-python/bin/python3" -m pip install \
  -r "$repo/script/asset_history/requirements.txt" blake3==1.0.11
python3 - "$runtime" <<'PY'
import pathlib,shlex,sys
p=pathlib.Path(sys.argv[1]).resolve()
(p/'environment.sh').write_text('export PATH='+shlex.quote(str(p/'nba-python/bin')+':'+str(p/'nba-r/bin'))+':"$PATH"\n')
print('Runtime ready:',p/'environment.sh')
PY
