#!/usr/bin/env python3
"""Upload a validated static ZIP to the existing Pages content-addressed store.

Reads one short-lived project upload JWT from stdin without storing it. Does
not publish a deployment: writes a manifest for the authenticated Pages API.
"""
import base64
import json
import mimetypes
import pathlib
import sys
import termios
import urllib.error
import urllib.request
import zipfile

import blake3

archive = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
files = []
manifest = {}
special = {}
with zipfile.ZipFile(archive) as z:
    bad = z.testzip()
    if bad:
        raise ValueError(f"Corrupt ZIP entry: {bad}")
    for info in z.infolist():
        if info.is_dir():
            continue
        p = pathlib.PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts:
            raise ValueError(f"Unsafe ZIP entry: {p}")
        data = z.read(info)
        if len(data) > 25 * 1024 * 1024:
            raise ValueError(f"Asset exceeds Pages limit: {p}")
        if p.name in ('_headers', '_redirects') and len(p.parts) == 1:
            special[p.name] = data.decode()
            continue
        if p.suffix == '.json':
            json.loads(data)
        value = base64.b64encode(data).decode('ascii')
        key = blake3.blake3((value + p.suffix.lstrip('.')).encode()).hexdigest()[:32]
        manifest['/' + str(p)] = key
        mime = mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
        files.append({'key': key, 'value': value, 'base64': True,
                      'metadata': {'contentType': mime}})
if '/index.html' not in manifest or len(manifest) > 20000:
    raise ValueError('Invalid Pages static manifest')
output.write_text(json.dumps({'manifest': manifest, 'special': special}, separators=(',', ':')))
print(f'Validated {len(files)} assets; waiting for temporary upload credential.', flush=True)

original = termios.tcgetattr(sys.stdin) if sys.stdin.isatty() else None
if original is not None:
    quiet = termios.tcgetattr(sys.stdin)
    quiet[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin, termios.TCSANOW, quiet)
try:
    token = sys.stdin.readline().strip()
finally:
    if original is not None:
        termios.tcsetattr(sys.stdin, termios.TCSANOW, original)
if not token or len(token.split('.')) != 3:
    raise ValueError('A short-lived Pages upload JWT is required')

def request(endpoint, payload):
    req = urllib.request.Request(
        'https://api.cloudflare.com/client/v4/pages/assets/' + endpoint,
        data=json.dumps(payload, separators=(',', ':')).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            result = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'Pages {endpoint} HTTP {e.code}: {e.read(1000).decode()}') from None
    if not result.get('success'):
        raise RuntimeError(f'Pages {endpoint}: {result.get("errors")}')
    return result.get('result')

hashes = list(dict.fromkeys(manifest.values()))
missing = set(request('check-missing', {'hashes': hashes}))
print(f'{len(hashes) - len(missing)} assets already uploaded; {len(missing)} to upload.', flush=True)
seen = set()
pending = []
for f in files:
    if f['key'] in missing and f['key'] not in seen:
        pending.append(f)
        seen.add(f['key'])
batch, size, completed = [], 0, 0
for f in pending:
    n = len(f['value'])
    if batch and size + n > 14 * 1024 * 1024:
        request('upload', batch)
        completed += len(batch)
        print(f'Uploaded {completed}/{len(pending)} new assets.', flush=True)
        batch, size = [], 0
    batch.append(f)
    size += n
if batch:
    request('upload', batch)
    completed += len(batch)
    print(f'Uploaded {completed}/{len(pending)} new assets.', flush=True)
request('upsert-hashes', {'hashes': hashes})
remaining = request('check-missing', {'hashes': hashes})
if remaining:
    raise RuntimeError(f'{len(remaining)} assets still missing')
print(f'UPLOAD_COMPLETE: all {len(hashes)} asset hashes verified.', flush=True)

