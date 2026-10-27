"""Transfer the unchanged runtime archive in bounded, verified binary parts."""
from __future__ import annotations
import argparse,hashlib,json,tempfile
from contextlib import contextmanager
from pathlib import Path

def split_archive(archive,parts_dir,part_bytes=1024*1024):
    archive=Path(archive);parts_dir=Path(parts_dir);parts_dir.mkdir(parents=True,exist_ok=True)
    if part_bytes<=0:raise ValueError('Part size must be positive')
    digest=hashlib.sha256();parts=[];total=0
    with archive.open('rb')as source:
        while block:=source.read(part_bytes):
            name=f'part-{len(parts):03d}.bin';(parts_dir/name).write_bytes(block)
            parts.append({'path':name,'bytes':len(block),'sha256':hashlib.sha256(block).hexdigest()})
            digest.update(block);total+=len(block)
    if not parts:raise ValueError('Runtime archive is empty')
    manifest={'schema_version':1,'archive_name':archive.name,'archive_bytes':total,'archive_sha256':digest.hexdigest(),'part_bytes':part_bytes,'parts':parts}
    temporary=parts_dir/'manifest.tmp';temporary.write_text(json.dumps(manifest,indent=2)+'\n');temporary.replace(parts_dir/'manifest.json')
    return manifest

@contextmanager
def resolved_archive(archive):
    archive=Path(archive)
    if archive.is_file():
        yield archive
        return
    parts_dir=archive.parent/'runtime_seed';manifest=json.loads((parts_dir/'manifest.json').read_text())
    if manifest.get('schema_version')!=1 or manifest.get('archive_name')!=archive.name:raise ValueError('Runtime archive manifest does not match the requested seed')
    parts=manifest.get('parts',[])
    if not parts or len({p['path']for p in parts})!=len(parts):raise ValueError('Runtime archive parts are missing or duplicated')
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(prefix='nba-asset-runtime-',suffix='.zip',delete=False)as target:
            temporary=Path(target.name);digest=hashlib.sha256();total=0
            for item in parts:
                part=(parts_dir/item['path']).resolve()
                if not part.is_relative_to(parts_dir.resolve()):raise ValueError('Unsafe runtime archive part path')
                block=part.read_bytes()
                if len(block)!=item['bytes']or hashlib.sha256(block).hexdigest()!=item['sha256']:raise ValueError('Runtime archive part integrity failure: '+item['path'])
                target.write(block);digest.update(block);total+=len(block)
            if total!=manifest['archive_bytes']or digest.hexdigest()!=manifest['archive_sha256']:raise ValueError('Reassembled runtime archive digest mismatch')
        yield temporary
    finally:
        if temporary:temporary.unlink(missing_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--parts-dir',type=Path,required=True);a=p.parse_args()
    result=split_archive(a.archive,a.parts_dir);print(json.dumps({'parts':len(result['parts']),'bytes':result['archive_bytes'],'sha256':result['archive_sha256']}))
